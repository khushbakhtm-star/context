import * as Crypto from 'expo-crypto';

import { getSetting, setSetting } from '../data/database';
import { accountFetch, getAccounts, getWebDavCredentials } from './accounts';
import type { ConnectedAccount, LedgerStorage, StorageFile } from './types';
import { createWebDavStorage } from './webdav';
import { accountFetchWithDeadline } from '../utils/account-request-deadline';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FILE_PREFIX = 'context-';

function validFileName(name: string) {
  if (!/^context-[a-zA-Z0-9._-]{1,180}\.json$/.test(name)) {
    throw new Error('The Context storage filename is invalid.');
  }
}

async function requireStorageConsent(account: ConnectedAccount) {
  const current = (await getAccounts()).find((candidate) => candidate.id === account.id);
  if (!current?.consent.ledgerStorage) throw new Error('Ledger storage permission is disabled for this account.');
}

async function expectSuccess(response: Response, action: string) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${action}: reconnect the account and grant Context app-folder access.`);
  }
  if (response.status === 429) throw new Error(`${action}: the provider is busy. Sync will retry later.`);
  throw new Error(`${action} failed (${response.status}).`);
}

function googleFilesUrl(query?: string) {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: query ?? `trashed = false and name contains '${FILE_PREFIX}'`,
    fields: 'nextPageToken,files(id,name)',
    pageSize: '1000',
  });
  return `${DRIVE}/files?${params.toString()}`;
}

async function googleList(account: ConnectedAccount, query?: string) {
  const files: StorageFile[] = [];
  let url: string | null = googleFilesUrl(query);
  while (url) {
    await requireStorageConsent(account);
    const response = await accountFetch(account, url);
    await expectSuccess(response, 'Reading Google app data');
    const body = (await response.json()) as {
      files?: StorageFile[];
      nextPageToken?: string;
    };
    files.push(...(body.files ?? []).filter((file) => file.name.startsWith(FILE_PREFIX)));
    url = body.nextPageToken
      ? `${googleFilesUrl(query)}&pageToken=${encodeURIComponent(body.nextPageToken)}`
      : null;
  }
  return files;
}

async function googleRead(account: ConnectedAccount, file: StorageFile) {
  await requireStorageConsent(account);
  const response = await accountFetch(account, `${DRIVE}/files/${encodeURIComponent(file.id)}?alt=media`);
  await expectSuccess(response, 'Downloading Google ledger data');
  return response.text();
}

async function googleWrite(account: ConnectedAccount, name: string, contents: string) {
  await requireStorageConsent(account);
  validFileName(name);
  const existing = (await googleList(account, `trashed = false and name = '${name}'`))[0];
  if (existing) {
    if ((await googleRead(account, existing)) !== contents) {
      throw new Error('A different immutable Context batch already uses this filename.');
    }
    return;
  }

  // A preallocated ID survives a lost HTTP response. Retrying the same pending batch cannot create
  // another Drive file, even if its first upload completed just before connectivity disappeared.
  const key = `cloud.drive.upload.${account.id}.${name}`;
  let id = await getSetting<string | null>(key, null);
  if (!id) {
    const allocation = await accountFetch(account, `${DRIVE}/files/generateIds?count=1&space=appDataFolder&type=files`);
    await expectSuccess(allocation, 'Preparing Google ledger upload');
    const body = (await allocation.json()) as { ids?: string[] };
    id = body.ids?.[0] ?? null;
    if (!id) throw new Error('Google did not allocate an upload identifier.');
    await setSetting(key, id);
  }
  const boundary = `context_${Crypto.randomUUID().replaceAll('-', '')}`;
  const metadata = JSON.stringify({ id, name, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    contents,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  await requireStorageConsent(account);
  const response = await accountFetch(account, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (response.status === 409) {
    const saved = await googleRead(account, { id, name });
    if (saved !== contents) throw new Error('The saved Google batch differs from the pending upload.');
    return;
  }
  await expectSuccess(response, 'Uploading Google ledger data');
}

function validatedGraphNextLink(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com') {
    throw new Error('Microsoft returned an unexpected pagination URL.');
  }
  return value;
}

async function graphRoot(account: ConnectedAccount) {
  await requireStorageConsent(account);
  const response = await accountFetch(account, `${GRAPH}/me/drive/special/approot?$select=id`);
  await expectSuccess(response, 'Opening the Microsoft Context app folder');
  const root = (await response.json()) as { id?: string };
  if (!root.id) throw new Error('Microsoft did not return the Context app-folder identifier.');
  return root.id;
}

async function graphList(account: ConnectedAccount) {
  const root = await graphRoot(account);
  const files: StorageFile[] = [];
  let url: string | null = `${GRAPH}/me/drive/items/${encodeURIComponent(root)}/children?$select=id,name,file&$top=200`;
  while (url) {
    await requireStorageConsent(account);
    const response = await accountFetch(account, url);
    await expectSuccess(response, 'Reading the Microsoft Context app folder');
    const body = (await response.json()) as {
      value?: (StorageFile & { file?: unknown })[];
      '@odata.nextLink'?: string;
    };
    files.push(...(body.value ?? []).filter((file) => file.file && file.name.startsWith(FILE_PREFIX)));
    url = body['@odata.nextLink'] ? validatedGraphNextLink(body['@odata.nextLink']) : null;
  }
  return files;
}

async function graphRead(account: ConnectedAccount, file: StorageFile) {
  await requireStorageConsent(account);
  // /content redirects to a short-lived download URL. Fetch that URL without an Authorization
  // header, so the OAuth token is never forwarded to a CDN or other download host.
  const metadata = await accountFetch(
    account,
    `${GRAPH}/me/drive/items/${encodeURIComponent(file.id)}?$select=id,@microsoft.graph.downloadUrl`,
  );
  await expectSuccess(metadata, 'Preparing Microsoft ledger download');
  const body = (await metadata.json()) as { '@microsoft.graph.downloadUrl'?: string };
  const downloadUrl = body['@microsoft.graph.downloadUrl'];
  if (!downloadUrl || new URL(downloadUrl).protocol !== 'https:') {
    throw new Error('Microsoft did not provide a secure ledger download URL.');
  }
  await requireStorageConsent(account);
  const response = await accountFetchWithDeadline(downloadUrl);
  await expectSuccess(response, 'Downloading Microsoft ledger data');
  return response.text();
}

async function graphWrite(account: ConnectedAccount, name: string, contents: string) {
  await requireStorageConsent(account);
  validFileName(name);
  const existing = (await graphList(account)).find((file) => file.name === name);
  if (existing) {
    if ((await graphRead(account, existing)) !== contents) {
      throw new Error('A different immutable Context batch already uses this filename.');
    }
    return;
  }
  const root = await graphRoot(account);
  const response = await accountFetch(
    account,
    `${GRAPH}/me/drive/items/${encodeURIComponent(root)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: contents,
    },
  );
  if (response.status === 409 || response.status === 412) {
    const matching = (await graphList(account)).find((file) => file.name === name);
    if (!matching || (await graphRead(account, matching)) !== contents) {
      throw new Error('The saved Microsoft batch differs from the pending upload.');
    }
    return;
  }
  await expectSuccess(response, 'Uploading Microsoft ledger data');
}

export function createLedgerStorage(account: ConnectedAccount): LedgerStorage {
  if (account.provider === 'webdav') {
    return createWebDavStorage(account, () => getWebDavCredentials(account));
  }
  return account.provider === 'google'
    ? {
        listFiles: () => googleList(account),
        readFile: (file) => googleRead(account, file),
        writeFile: (name, contents) => googleWrite(account, name, contents),
      }
    : {
        listFiles: () => graphList(account),
        readFile: (file) => graphRead(account, file),
        writeFile: (name, contents) => graphWrite(account, name, contents),
      };
}
