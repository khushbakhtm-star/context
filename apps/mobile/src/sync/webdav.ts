import { fetch as nativeFetch } from 'expo/fetch';

import type { ConnectedAccount, LedgerStorage, StorageFile } from './types';
import { accountFetchWithDeadline, accountRequestDeadline } from '../utils/account-request-deadline';

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_LISTING_BYTES = 4 * 1024 * 1024;
const MAX_XML_NODES = 100_000;
const FILE_NAME = /^context-[a-zA-Z0-9._-]{1,180}\.json$/;
const DAV = 'DAV:';
const PROPERTIES = '<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

export type WebDavCredentials = { username: string; password: string };
type XmlNode = { name: string; namespace: string; text: string; children: XmlNode[] };

function decodedPath(path: string) {
  const segments = path.split('/').map((part) => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new Error('The WebDAV path contains invalid escaping.'); }
    if (decoded === '.' || decoded === '..' || /[\\/%\u0000-\u001F\u007F]/.test(decoded)) {
      throw new Error('The WebDAV path contains an unsafe path segment.');
    }
    return decoded;
  });
  return segments.join('/');
}

function rawAbsolutePath(value: string) {
  const match = /^https:\/\/[^/?#]+(\/[^?#]*)?$/i.exec(value);
  if (!match) throw new Error('Use an HTTPS WebDAV folder URL without a query or fragment.');
  return match[1] ?? '/';
}

export function normalizeWebDavFolder(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes('\\')) throw new Error('The WebDAV folder URL contains an unsafe separator.');
  const path = rawAbsolutePath(trimmed);
  decodedPath(path);
  const url = new URL(trimmed);
  if (url.username || url.password || !url.hostname) {
    throw new Error('Put WebDAV credentials in the username and app-password fields.');
  }
  if (url.pathname === '/') throw new Error('Choose an existing dedicated Context folder rather than the server root.');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function basicAuthorization({ username, password }: WebDavCredentials) {
  if (!username || username.includes(':') || /[\r\n]/.test(username) || !password || /[\r\n]/.test(password)) {
    throw new Error('Enter a valid WebDAV username and app password.');
  }
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const bits = (a << 16) | (b << 8) | c;
    encoded += alphabet[(bits >>> 18) & 63]! + alphabet[(bits >>> 12) & 63]! +
      (index + 1 < bytes.length ? alphabet[(bits >>> 6) & 63] : '=') +
      (index + 2 < bytes.length ? alphabet[bits & 63] : '=');
  }
  return `Basic ${encoded}`;
}

function scopedFileUrl(folder: string, href: string) {
  const base = new URL(folder);
  if (href.includes('\\') || href.includes('?') || href.includes('#')) {
    throw new Error('The WebDAV server returned an unsafe file address.');
  }
  const rawPath = href.startsWith('/') ? href : rawAbsolutePath(href);
  const decoded = decodedPath(rawPath);
  const url = new URL(href, base);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new Error('The WebDAV server returned a file outside the selected account origin.');
  }
  const basePath = decodedPath(base.pathname);
  if (!decoded.startsWith(basePath)) throw new Error('The WebDAV server returned a file outside the selected folder.');
  const name = decoded.slice(basePath.length);
  if (!FILE_NAME.test(name)) throw new Error('The WebDAV file is not a direct Context batch in the selected folder.');
  return { id: url.toString(), name };
}

function entityText(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_entity, key: string) => {
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    if (!Number.isInteger(code) || code < 32 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
      throw new Error('The WebDAV response contains an invalid XML character.');
    }
    return String.fromCodePoint(code);
  });
}

function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_LISTING_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('The WebDAV directory response is too large or contains unsupported XML declarations.');
  }
  const document: XmlNode = { name: '#document', namespace: '', text: '', children: [] };
  const stack: { node: XmlNode; tag: string; namespaces: Record<string, string> }[] = [
    { node: document, tag: '', namespaces: {} },
  ];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g;
  let cursor = 0;
  let nodes = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) throw new Error('The WebDAV response is malformed XML.');
    const token = match[0];
    cursor += token.length;
    const current = stack.at(-1)!;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { current.node.text += token.slice(9, -3); continue; }
    if (!token.startsWith('<')) { current.node.text += entityText(token); continue; }
    if (token.startsWith('</')) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== current.tag) throw new Error('The WebDAV response has mismatched XML tags.');
      stack.pop();
      continue;
    }
    const selfClosing = token.endsWith('/>');
    const content = token.slice(1, selfClosing ? -2 : -1).trim();
    const nameMatch = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s|$)/.exec(content);
    if (!nameMatch || ++nodes > MAX_XML_NODES || stack.length > 32) throw new Error('The WebDAV response contains unsupported XML.');
    const tag = nameMatch[1]!;
    const namespaces = { ...current.namespaces };
    let attributes = content.slice(tag.length);
    while (attributes.trim()) {
      attributes = attributes.trimStart();
      const attribute = /^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attributes);
      if (!attribute) throw new Error('The WebDAV response has invalid XML attributes.');
      if (attribute[1] === 'xmlns') namespaces[''] = entityText(attribute[2] ?? attribute[3] ?? '');
      else if (attribute[1]!.startsWith('xmlns:')) namespaces[attribute[1]!.slice(6)] = entityText(attribute[2] ?? attribute[3] ?? '');
      attributes = attributes.slice(attribute[0].length);
    }
    const parts = tag.split(':');
    const prefix = parts.length === 2 ? parts[0]! : '';
    if (prefix && !(prefix in namespaces)) throw new Error('The WebDAV response uses an unbound namespace.');
    const node: XmlNode = { name: parts.at(-1)!, namespace: namespaces[prefix] ?? '', text: '', children: [] };
    current.node.children.push(node);
    if (!selfClosing) stack.push({ node, tag, namespaces });
  }
  if (cursor !== xml.length || stack.length !== 1 || document.children.length !== 1) throw new Error('The WebDAV response is malformed XML.');
  return document.children[0]!;
}

function children(node: XmlNode, name: string) {
  return node.children.filter((child) => child.namespace === DAV && child.name === name);
}

export function parseWebDavListing(xml: string, folderValue: string): StorageFile[] {
  const folder = normalizeWebDavFolder(folderValue);
  const root = parseXml(xml);
  if (root.namespace !== DAV || root.name !== 'multistatus') throw new Error('The server did not return a WebDAV directory listing.');
  const files = new Map<string, StorageFile>();
  for (const response of children(root, 'response')) {
    const hrefs = children(response, 'href');
    if (hrefs.length !== 1) throw new Error('The WebDAV response contains an ambiguous file address.');
    const href = hrefs[0]!.text.trim();
    const props = children(response, 'propstat').filter((propstat) =>
      children(propstat, 'status').some((status) => /^HTTP\/\d(?:\.\d)? 2\d\d(?:\s|$)/.test(status.text.trim())),
    ).flatMap((propstat) => children(propstat, 'prop'));
    if (props.length === 0) continue;
    const collection = props.some((prop) => children(prop, 'resourcetype').some((resource) => children(resource, 'collection').length > 0));
    if (collection) continue;
    // Directory roots, unrelated files, and nested resources are never requested. A malicious href
    // cannot cause a later authenticated GET outside the chosen direct-child Context batch names.
    try {
      const file = scopedFileUrl(folder, href);
      files.set(file.id, file);
    } catch { continue; }
  }
  return [...files.values()];
}

async function limitedText(response: Response, limit = MAX_BODY_BYTES) {
  return accountRequestDeadline(async (signal) => {
  if (Number(response.headers.get('Content-Length') ?? 0) > limit) throw new Error('The WebDAV response is too large.');
  if (!response.body) {
    const text = await response.text();
    if (text.length > limit) throw new Error('The WebDAV response is too large.');
    return text;
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { finished = true; break; }
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('The WebDAV response is too large.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  });
}

async function request(folder: string, url: string, credentials: WebDavCredentials, init: RequestInit) {
  const base = new URL(normalizeWebDavFolder(folder));
  const target = new URL(url);
  if (target.origin !== base.origin || target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('The WebDAV request is outside the selected origin.');
  }
  if (url !== base.toString()) scopedFileUrl(base.toString(), url);
  const headers = new Headers(init.headers);
  headers.set('Authorization', basicAuthorization(credentials));
  const response = await accountFetchWithDeadline(url, { ...init, headers, redirect: 'manual', credentials: 'omit' }, nativeFetch);
  if (response.status >= 300 && response.status < 400) {
    throw new Error('WebDAV redirects are disabled. Enter the final HTTPS folder URL shown by your provider.');
  }
  if (response.redirected || (response.url && new URL(response.url).origin !== base.origin)) {
    throw new Error('The WebDAV service unexpectedly redirected the request.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('WebDAV access was denied. Check the username, app password, and folder permission.');
  return response;
}

export async function probeWebDavFolder(url: string, credentials: WebDavCredentials) {
  const folder = normalizeWebDavFolder(url);
  const response = await request(folder, folder, credentials, {
    method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROPERTIES,
  });
  if (response.status !== 207) throw new Error('This WebDAV folder must already exist and support PROPFIND (Depth 1).');
  parseWebDavListing(await limitedText(response, MAX_LISTING_BYTES), folder);
  return folder;
}

export function createWebDavStorage(
  account: ConnectedAccount,
  credentials: () => Promise<WebDavCredentials>,
): LedgerStorage {
  const folder = normalizeWebDavFolder(account.storageUrl ?? '');
  return {
    async listFiles() {
      const response = await request(folder, folder, await credentials(), {
        method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROPERTIES,
      });
      if (response.status !== 207) throw new Error(`WebDAV directory listing failed (${response.status}).`);
      return parseWebDavListing(await limitedText(response, MAX_LISTING_BYTES), folder);
    },
    async readFile(file) {
      const safe = scopedFileUrl(folder, file.id);
      if (safe.name !== file.name) throw new Error('The WebDAV filename changed unexpectedly.');
      const response = await request(folder, safe.id, await credentials(), { method: 'GET' });
      if (!response.ok) throw new Error(`WebDAV ledger download failed (${response.status}).`);
      return limitedText(response);
    },
    async writeFile(name, contents) {
      if (!FILE_NAME.test(name)) throw new Error('The WebDAV batch filename is invalid.');
      if (new TextEncoder().encode(contents).byteLength > MAX_BODY_BYTES) throw new Error('The WebDAV ledger batch is too large.');
      const url = new URL(encodeURIComponent(name), folder).toString();
      const response = await request(folder, url, await credentials(), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' }, body: contents,
      });
      if (response.status === 412 || response.status === 409) {
        const prior = await this.readFile({ id: url, name });
        if (prior !== contents) throw new Error('An existing immutable WebDAV ledger batch has different contents.');
        return scopedFileUrl(folder, url);
      }
      if (!response.ok) throw new Error(`WebDAV ledger upload failed (${response.status}).`);
      return scopedFileUrl(folder, url);
    },
  };
}
