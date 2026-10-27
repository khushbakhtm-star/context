import { emptyLedger, validateState, type BrowserLedgerState } from './ledger';

type CacheRecord = { id: string; generation: number; salt: number[]; iv: number[]; ciphertext: ArrayBuffer };
const encoder = new TextEncoder();
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction was cancelled.'));
  tx.onerror = () => { /* onabort carries the transaction error */ };
});
async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('This browser does not provide persistent storage.');
  const open = indexedDB.open('context-private-browser-v1', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('ledgers', { keyPath: 'id' });
  return request(open);
}
export class BrowserStore {
  private database!: IDBDatabase; private key!: CryptoKey; private salt!: Uint8Array<ArrayBuffer>;
  private generation = 0; private queue: Promise<unknown> = Promise.resolve(); private active = true;
  state!: BrowserLedgerState;
  private constructor(readonly subject: string) {}
  static async unlock(subject: string, passphrase: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(subject)) throw new Error('Google returned an invalid account identity.');
    if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use the same 12–1,024 character ledger passphrase as your phone.');
    const store = new BrowserStore(subject); store.database = await openDatabase();
    const tx = store.database.transaction('ledgers', 'readonly'); const done = completed(tx);
    const saved = await request(tx.objectStore('ledgers').get(subject)) as CacheRecord | undefined; await done;
    store.salt = saved ? new Uint8Array(saved.salt) : crypto.getRandomValues(new Uint8Array(16));
    if (store.salt.length !== 16) throw new Error('Invalid encrypted browser cache.');
    const source = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    store.key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: store.salt, iterations: 600_000, hash: 'SHA-256' },
      source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    if (saved) {
      if (!Number.isSafeInteger(saved.generation) || saved.generation < 1 || saved.iv.length !== 12 ||
          saved.ciphertext.byteLength > MAX_CACHE_BYTES) throw new Error('Invalid encrypted browser cache.');
      let bytes: ArrayBuffer;
      try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(saved.iv), additionalData: encoder.encode(`Context browser cache v1:${subject}`) }, store.key, saved.ciphertext); }
      catch { throw new Error('Cannot unlock the browser cache. Use the passphrase previously used here.'); }
      try { store.state = validateState(JSON.parse(new TextDecoder().decode(bytes))); }
      finally { new Uint8Array(bytes).fill(0); }
      store.generation = saved.generation;
    } else store.state = emptyLedger(`browser_${crypto.randomUUID().replaceAll('-', '')}`);
    return store;
  }
  hasSavedLedger() { return this.generation > 0; }
  update(change: (state: BrowserLedgerState) => BrowserLedgerState): Promise<BrowserLedgerState> {
    const job = this.queue.then(async () => {
      if (!this.active) throw new Error('Unlock Context again before editing.');
      const next = validateState(change(structuredClone(this.state))); const bytes = encoder.encode(JSON.stringify(next));
      if (bytes.byteLength > MAX_CACHE_BYTES - 1024) throw new Error('The browser cache is full. No changes were saved.');
      const iv = crypto.getRandomValues(new Uint8Array(12)); let ciphertext: ArrayBuffer;
      try { ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`Context browser cache v1:${this.subject}`) }, this.key, bytes); }
      finally { bytes.fill(0); }
      if (!this.active) throw new Error('Context was locked before saving.');
      const tx = this.database.transaction('ledgers', 'readwrite'); const done = completed(tx);
      try {
        const table = tx.objectStore('ledgers'); const existing = await request(table.get(this.subject)) as CacheRecord | undefined;
        if ((existing?.generation ?? 0) !== this.generation) { tx.abort(); await done.catch(() => undefined); throw new Error('Context changed in another browser tab. Lock and reconnect before editing here.'); }
        table.put({ id: this.subject, generation: this.generation + 1, salt: [...this.salt], iv: [...iv], ciphertext } satisfies CacheRecord);
        await done; this.state = next; this.generation++; return next;
      } catch (error) { await done.catch(() => undefined); throw error; }
    });
    this.queue = job.catch(() => undefined); return job;
  }
  async drain() { await this.queue; }
  lock() { this.active = false; this.database?.close(); this.state = undefined as never; this.key = undefined as never; }
}
