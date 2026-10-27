import { clearLedgerKeyCache, decryptBatch, encryptBatch, hashValue } from '../shared/sync/codec';
import type { SyncBatch, SyncDocument } from '../shared/sync/types';
import { mergeLedger } from './ledger';
import type { BrowserStore } from './store';

declare global { interface Window { google?: any; } }
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export type GoogleIdentity = { subject: string; email: string };
export type BrowserPlan = { id: string; title: string; start: string; end: string; color: string; allDay: boolean };
export class GoogleConnection {
  private token = ''; private expires = 0; identity: GoogleIdentity | null = null; private granted = new Set<string>();
  private session = 0; private running: Promise<{ downloaded: number; uploaded: number }> | null = null;
  constructor(readonly clientId: string) {}
  async authorize(calendarRead = false): Promise<GoogleIdentity> {
    if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in has not loaded. Check the connection and retry.');
    const generation = ++this.session;
    const response: any = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({ client_id: this.clientId,
        scope: ['openid', 'email', DRIVE_SCOPE, ...(calendarRead ? [CALENDAR_SCOPE, LIST_SCOPE] : [])].join(' '),
        include_granted_scopes: true, callback: (value: any) => value.error ? reject(new Error('Google authorization was not completed.')) : resolve(value),
        error_callback: () => reject(new Error('Google sign-in was closed or blocked. Try Connect Google again.')) });
      client.requestAccessToken({ prompt: this.identity ? '' : 'select_account' });
    });
    if (generation !== this.session || !response.access_token) throw new Error('Google sign-in was cancelled.');
    if (!Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 60 || Number(response.expires_in) > 86_400) throw new Error('Google returned an invalid token lifetime.');
    const token = String(response.access_token); const scopes = new Set(String(response.scope ?? '').split(' '));
    if (!scopes.has(DRIVE_SCOPE)) throw new Error('Allow Context’s private app-folder access to synchronize your ledger.');
    const user = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20_000) });
    if (!user.ok) throw new Error('Google account verification failed.');
    const body = await user.json();
    if (generation !== this.session || typeof body.sub !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(body.sub)) throw new Error('Google returned an invalid account identity.');
    if (this.identity && this.identity.subject !== body.sub) throw new Error('Lock Context before changing Google accounts.');
    this.token = token; this.expires = Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
    this.granted = scopes; this.identity = { subject: body.sub, email: typeof body.email === 'string' ? body.email : 'Google account' };
    return this.identity;
  }
  isAuthorized() { return Boolean(this.token && this.identity && Date.now() < this.expires); }
  canReadCalendars() { return this.granted.has(CALENDAR_SCOPE) && this.granted.has(LIST_SCOPE); }
  lock() { this.session++; this.token = ''; this.expires = 0; this.identity = null; this.granted.clear(); clearLedgerKeyCache(); }
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.isAuthorized()) throw new Error('Google access expired. Choose Connect Google to authorize synchronization again.');
    const endpoint = new URL(url); const method = init.method ?? 'GET';
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'www.googleapis.com' || !['GET', 'POST'].includes(method) ||
        !['/drive/v3/', '/upload/drive/v3/', '/calendar/v3/'].some((prefix) => endpoint.pathname.startsWith(prefix))) throw new Error('Unsupported Google request.');
    const session = this.session; const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${this.token}`);
    const response = await fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (session !== this.session) throw new Error('Google connection changed.');
    if (response.status === 401 || response.status === 403) throw new Error('Google access needs attention. Connect Google and review the requested permissions.');
    if (!response.ok && response.status !== 409) throw new Error(`Google request failed (${response.status}). No local notes were removed.`);
    return response;
  }
  async listFiles() {
    const files: { id: string; name: string }[] = []; let page = ''; const seen = new Set<string>();
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and name contains 'context-'", fields: 'nextPageToken,files(id,name)', pageSize: '1000', ...(page ? { pageToken: page } : {}) });
      const body = await (await this.request(`${DRIVE}/files?${params}`)).json();
      if (!Array.isArray(body.files)) throw new Error('Google returned an invalid file list.');
      for (const file of body.files) if (typeof file.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(file.id) && /^context-[A-Za-z0-9._-]{1,180}\.json$/.test(file.name)) files.push({ id: file.id, name: file.name });
      if (files.length > 20_000) throw new Error('This ledger needs more files than this browser can safely load.');
      page = body.nextPageToken ?? ''; if (page && (typeof page !== 'string' || seen.has(page))) throw new Error('Google returned repeated pagination.'); seen.add(page);
    } while (page);
    return files;
  }
  private async readFile(id: string) {
    const response = await this.request(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
    const reader = response.body?.getReader(); if (!reader) throw new Error('The ledger download is unavailable.');
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
      if (length > 13 * 1024 * 1024) { await reader.cancel(); throw new Error('The encrypted ledger download is too large.'); } chunks.push(value); }
    const all = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(all);
  }
  sync(store: BrowserStore, passphrase: string) {
    if (this.running) return this.running;
    const generation = this.session;
    this.running = this.performSync(store, passphrase).finally(() => { this.running = null; if (generation !== this.session || !this.identity) clearLedgerKeyCache(); }); return this.running;
  }
  private async performSync(store: BrowserStore, passphrase: string) {
    const session = this.session; const requireCurrent = () => {
      if (session !== this.session || this.identity?.subject !== store.subject) throw new Error('The active Google account changed.');
    };
    requireCurrent(); const files = await this.listFiles(); let verified = false; let downloaded = 0; let uploaded = 0;
    // Always authenticate at least one remote batch before trusting a saved passphrase or uploading.
    for (const file of files) {
      requireCurrent(); if (store.state.seen.includes(file.id) && verified) continue;
      const batch = await decryptBatch(await this.readFile(file.id), passphrase); requireCurrent(); verified = true;
      if (store.state.seen.includes(file.id)) continue;
      await store.update((state) => { const next = mergeLedger(state, batch.documents); next.seen.push(file.id); return next; }); downloaded++;
    }
    if (!files.length && !store.state.documents.length) throw new Error('No phone ledger was found in this Google account. Synchronize Context on your phone first, then retry here.');
    for (let chunk = 0; chunk < 100; chunk++) {
      requireCurrent(); let pending = store.state.upload;
      if (!pending) {
        const documents: SyncDocument[] = store.state.documents.filter((doc) => store.state.pending[doc.key] === doc.revision).slice(0, 100);
        if (!documents.length) break;
        while (documents.length > 1 && new TextEncoder().encode(JSON.stringify(documents)).byteLength > 2 * 1024 * 1024) documents.pop();
        const batch: SyncBatch = { version: 1, id: crypto.randomUUID(), documents }; const ciphertext = await encryptBatch(batch, passphrase); requireCurrent();
        pending = { name: `context-${batch.id}.json`, ciphertext, batch };
        const prepared = pending; await store.update((state) => ({ ...state, upload: prepared }));
      }
      const checked = await decryptBatch(pending.ciphertext, passphrase);
      if (hashValue(checked) !== hashValue(pending.batch)) throw new Error('The pending upload failed its integrity check.');
      const matching = files.find((file) => file.name === pending!.name);
      if (matching) {
        if (await this.readFile(matching.id) !== pending.ciphertext) throw new Error('A different immutable ledger batch has this name.');
      } else {
        if (!pending.driveId) {
          const body = await (await this.request(`${DRIVE}/files/generateIds?count=1&space=appDataFolder&type=files`)).json();
          if (!Array.isArray(body.ids) || !/^[A-Za-z0-9_-]{1,200}$/.test(body.ids[0])) throw new Error('Google did not allocate an upload ID.');
          const driveId = body.ids[0]; requireCurrent(); await store.update((state) => ({ ...state, upload: { ...state.upload!, driveId } })); pending = store.state.upload!;
        }
        const boundary = `context_${crypto.randomUUID().replaceAll('-', '')}`;
        const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ id: pending.driveId, name: pending.name, parents: ['appDataFolder'], mimeType: 'application/json' }),
          `--${boundary}`, 'Content-Type: application/json', '', pending.ciphertext, `--${boundary}--`, ''].join('\r\n');
        requireCurrent(); const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
        if (response.status === 409 && await this.readFile(pending.driveId!) !== pending.ciphertext) throw new Error('The saved immutable batch differs from this upload.');
      }
      requireCurrent(); const completed = pending;
      await store.update((state) => { for (const doc of completed.batch.documents) if (state.pending[doc.key] === doc.revision) delete state.pending[doc.key]; state.upload = null; return state; }); uploaded++;
    }
    return { downloaded, uploaded };
  }
  async calendars() {
    if (!this.canReadCalendars()) throw new Error('Choose Connect calendars to allow read-only calendar access.');
    const values: { id: string; title: string; color: string; primary: boolean }[] = []; let page = ''; const seen = new Set<string>();
    do { const body = await (await this.request(`https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)).json();
      if (!Array.isArray(body.items)) throw new Error('Google returned an invalid calendar list.');
      for (const item of body.items) if (typeof item.id === 'string') values.push({ id: item.id, title: String(item.summary ?? 'Calendar'), color: color(item.backgroundColor), primary: item.primary === true });
      page = body.nextPageToken ?? ''; if (page && (typeof page !== 'string' || seen.has(page))) throw new Error('Google returned repeated calendar pagination.'); seen.add(page); if (values.length > 2000) throw new Error('Too many calendars to display.');
    } while (page); return values;
  }
  async activityColors(): Promise<{ color: string; providerColorId: string }[]> {
    if (!this.canReadCalendars()) throw new Error('Connect calendars to load their Google colors.');
    const body = await (await this.request('https://www.googleapis.com/calendar/v3/colors')).json();
    if (!body.event || typeof body.event !== 'object' || Array.isArray(body.event)) throw new Error('Google returned an invalid event palette.');
    return Object.entries(body.event as Record<string, { background?: unknown }>).flatMap(([id, item]) =>
      /^\d{1,8}$/.test(id) && typeof item?.background === 'string' && /^#[0-9a-f]{6}$/i.test(item.background)
        ? [{ color: item.background.toUpperCase(), providerColorId: id }] : []);
  }
  async plans(day: string, calendars: { id: string; color: string }[]): Promise<BrowserPlan[]> {
    if (!this.canReadCalendars()) return [];
    const start = new Date(`${day}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1);
    const paletteBody = await (await this.request('https://www.googleapis.com/calendar/v3/colors')).json();
    const plans: BrowserPlan[] = [];
    for (const calendar of calendars) { let page = ''; const seen = new Set<string>();
      do { const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', ...(page ? { pageToken: page } : {}) });
        const body = await (await this.request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`)).json();
        if (!Array.isArray(body.items)) throw new Error('Google returned an invalid event list.');
        for (const item of body.items) if (item.status !== 'cancelled' && typeof item.id === 'string' && item.start && item.end) plans.push({ id: `${calendar.id}:${item.id}`,
          title: String(item.summary ?? '(Untitled)'), start: item.start.dateTime ?? item.start.date, end: item.end.dateTime ?? item.end.date,
          allDay: !item.start.dateTime, color: color(paletteBody.event?.[item.colorId]?.background, calendar.color) });
        page = body.nextPageToken ?? ''; if (page && (typeof page !== 'string' || seen.has(page))) throw new Error('Google returned repeated event pagination.'); seen.add(page); if (plans.length > 10_000) throw new Error('Too many events to display.');
      } while (page);
    } return plans;
  }
}
export const color = (value: unknown, fallback = '#777777') => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
