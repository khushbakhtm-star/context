import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { parseCalendarMinuteLog } from '../utils/calendar-minute-log';

import type { SyncBatch, SyncDocument } from './types';
import { isDescriptionLog } from '../utils/calendar-description';

const ITERATIONS = 600_000;
const MAX_PLAINTEXT_BYTES = 6 * 1024 * 1024;
const MAX_ENVELOPE_CHARS = MAX_PLAINTEXT_BYTES * 2 + 2_048;
const MAX_DOCUMENTS = 500;
const REVISION_PATTERN = /^\d{16}:\d{8}:[A-Za-z0-9_-]{8,128}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const derivedKeys = new Map<string, Uint8Array>();
const pendingKeys = new Map<string, Promise<Uint8Array>>();
let keyCacheGeneration = 0;
let keyDerivationQueue: Promise<void> = Promise.resolve();

type KdfBackend = 'webcrypto' | 'native' | 'portableJs';
export type LedgerCryptoDiagnostics = {
  kdfByBackend: Record<KdfBackend, { calls: number; elapsedMs: number }>;
  keyQueueMs: number;
  cacheHits: number;
  coalescedKeys: number;
  encryptCalls: number;
  encryptMs: number;
  decryptCalls: number;
  decryptMs: number;
};
// Process-local aggregate numbers only. No inputs, identities, salts, keys,
// hashes or payload data are retained, persisted or transmitted.
const cryptoDiagnostics: LedgerCryptoDiagnostics = {
  kdfByBackend: { webcrypto: { calls: 0, elapsedMs: 0 }, native: { calls: 0, elapsedMs: 0 },
    portableJs: { calls: 0, elapsedMs: 0 } },
  keyQueueMs: 0, cacheHits: 0, coalescedKeys: 0,
  encryptCalls: 0, encryptMs: 0, decryptCalls: 0, decryptMs: 0,
};
function diagnosticsNow() {
  const time = globalThis.performance?.now?.() ?? Date.now();
  return Number.isFinite(time) ? time : 0;
}
function diagnosticsElapsed(start: number) {
  return Math.max(0, diagnosticsNow() - start);
}
function recordKdf(backend: KdfBackend, started: number) {
  cryptoDiagnostics.kdfByBackend[backend].calls += 1;
  cryptoDiagnostics.kdfByBackend[backend].elapsedMs += diagnosticsElapsed(started);
}
export function getLedgerCryptoDiagnostics(): LedgerCryptoDiagnostics {
  return { ...cryptoDiagnostics, kdfByBackend: {
    webcrypto: { ...cryptoDiagnostics.kdfByBackend.webcrypto },
    native: { ...cryptoDiagnostics.kdfByBackend.native },
    portableJs: { ...cryptoDiagnostics.kdfByBackend.portableJs },
  } };
}

/** Installed only by the mobile bootstrap. Portable/browser callers need no
 * native runtime and retain WebCrypto or the cooperative JS implementation. */
export type NativeLedgerKeyDeriver = (passphrase: string, saltHex: string) => Promise<string | null>;
let nativeLedgerKeyDeriver: NativeLedgerKeyDeriver | null = null;
export function configureNativeLedgerKeyDeriver(deriver: NativeLedgerKeyDeriver | null) {
  if (nativeLedgerKeyDeriver === deriver) return;
  nativeLedgerKeyDeriver = deriver;
  clearLedgerKeyCache();
}

export function clearLedgerKeyCache() {
  keyCacheGeneration += 1;
  for (const key of derivedKeys.values()) key.fill(0);
  derivedKeys.clear();
  pendingKeys.clear();
}

type RandomSource = (length: number) => Uint8Array | Promise<Uint8Array>;

type EncryptedEnvelope = {
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('The encrypted ledger uses an unsupported data field.');
  }
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Ledger data is nested too deeply.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (value.length > 250_000) throw new Error('A ledger text field is too large.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 2_000) throw new Error('A ledger array is too large.');
    for (const item of value) validateJson(item, depth + 1);
    return;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 100) throw new Error('A ledger object contains too many fields.');
    for (const key of keys) {
      if (UNSAFE_KEYS.has(key) || key.length > 160) throw new Error('Invalid ledger field.');
      validateJson(value[key], depth + 1);
    }
    return;
  }
  throw new Error('Ledger data must contain only JSON values.');
}

function isRealDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validateDocumentKey(key: string) {
  if (/^(?:projection|category):[A-Za-z0-9_.:-]{1,200}$/.test(key)) return;
  const minute = /^minute:(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(key);
  if (
    minute &&
    isRealDate(minute[1]!) &&
    Number(minute[2]) >= 0 &&
    Number(minute[2]) < 1440 &&
    String(Number(minute[2])) === minute[2]
  ) {
    return;
  }
  throw new Error('The ledger contains an invalid record identifier.');
}

/** Validate before importing any decrypted network data into SQLite. */
export function validateBatch(input: unknown): SyncBatch {
  if (!isObject(input)) throw new Error('The ledger batch must be an object.');
  assertExactKeys(input, ['version', 'id', 'documents']);
  if (input.version !== 1 || typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) {
    throw new Error('The ledger batch format is not supported.');
  }
  if (!Array.isArray(input.documents) || input.documents.length > MAX_DOCUMENTS) {
    throw new Error('The ledger batch contains too many records.');
  }
  const seen = new Set<string>();
  for (const candidate of input.documents) {
    if (!isObject(candidate)) throw new Error('Invalid ledger record.');
    assertExactKeys(candidate, ['key', 'revision', 'value']);
    if (typeof candidate.key !== 'string') throw new Error('Invalid ledger identifier.');
    validateDocumentKey(candidate.key);
    if (seen.has(candidate.key)) throw new Error('The batch contains duplicate ledger identifiers.');
    seen.add(candidate.key);
    if (typeof candidate.revision !== 'string' || !REVISION_PATTERN.test(candidate.revision)) {
      throw new Error('Invalid ledger revision.');
    }
    if (candidate.value !== null && !isObject(candidate.value)) {
      throw new Error('A ledger record must contain an object or a deletion marker.');
    }
    validateJson(candidate.value);
    if (candidate.key.startsWith('projection:') && isObject(candidate.value) && isObject(candidate.value.baseEvent) &&
        candidate.value.baseEvent.descriptionLog !== undefined && !isDescriptionLog(candidate.value.baseEvent.descriptionLog)) {
      throw new Error('The ledger contains invalid calendar description metadata.');
    }
  }
  if (utf8ToBytes(JSON.stringify(input)).length > MAX_PLAINTEXT_BYTES) {
    throw new Error('The ledger batch is too large.');
  }
  return input as unknown as SyncBatch;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new Error('Cannot hash a non-JSON value.');
}

/** Stable across object field order and both phone operating systems. */
export function hashValue(value: unknown) {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));
}

export function compareRevisions(left: string, right: string) {
  if (!REVISION_PATTERN.test(left) || !REVISION_PATTERN.test(right)) {
    throw new Error('Cannot compare invalid ledger revisions.');
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

/** A deterministic join: tombstones participate exactly like updates. */
export function mergeDocuments(...groups: SyncDocument[][]): SyncDocument[] {
  const result = new Map<string, SyncDocument>();
  for (const group of groups) {
    for (const candidate of group) {
      const existing = result.get(candidate.key);
      const order = existing ? compareRevisions(candidate.revision, existing.revision) : 1;
      if (order > 0) result.set(candidate.key, candidate);
      else if (order === 0 && existing && hashValue(candidate.value) !== hashValue(existing.value)) {
        // A revision identifies exactly one mutation. Reject corruption rather than diverge by
        // whichever file a particular storage provider happened to list first.
        throw new Error('Conflicting ledger values have the same revision.');
      }
    }
  }
  return [...result.values()].sort((left, right) => left.key.localeCompare(right.key));
}

async function secureRandom(length: number): Promise<Uint8Array> {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }
  const crypto = await import('expo-crypto');
  return crypto.getRandomBytesAsync(length);
}

function validatePassphrase(passphrase: string) {
  if (passphrase.length < 12 || passphrase.length > 1_024) {
    throw new Error('Use an encryption passphrase of 12 to 1,024 characters on both phones.');
  }
}

function associatedData(envelope: Omit<EncryptedEnvelope, 'ciphertext'>) {
  return utf8ToBytes(canonicalJson(envelope));
}

/**
 * RFC 8018 PBKDF2-HMAC-SHA256, one 32-byte block. A real task boundary lets
 * Hermes/browser input and rendering run; noble 1.8's async KDF uses microtask
 * yields, which do not release the UI event loop. The primitive and work factor
 * are unchanged. Reuse noble's HMAC state rather than allocating per round.
 */
async function deriveKeyCooperatively(password: Uint8Array, salt: Uint8Array, requireCurrent: () => void) {
  const prf = hmac.create(sha256, password);
  const salted = prf.clone().update(salt);
  let working: ReturnType<typeof prf.clone> | undefined;
  const u = new Uint8Array(32);
  const result = new Uint8Array(32);
  const block = new Uint8Array([0, 0, 0, 1]);
  let completed = false;
  try {
    requireCurrent();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    requireCurrent();
    working = salted.clone();
    working.update(block).digestInto(u);
    result.set(u);
    let quantumStart = Date.now();
    for (let round = 1; round < ITERATIONS; round += 1) {
      working = prf._cloneInto(working);
      working.update(u).digestInto(u);
      for (let byte = 0; byte < result.length; byte += 1) result[byte] = result[byte]! ^ u[byte]!;
      // Check the clock in bounded chunks; every derivation shares one queue so
      // concurrent cloud reads cannot multiply the main-thread work quantum.
      if ((round & 255) === 0) {
        const elapsed = Date.now() - quantumStart;
        if (elapsed >= 8 || elapsed < 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          requireCurrent();
          quantumStart = Date.now();
        }
      }
    }
    requireCurrent();
    completed = true;
    return result;
  } finally {
    prf.destroy();
    salted.destroy();
    working?.destroy();
    password.fill(0);
    u.fill(0);
    block.fill(0);
    if (!completed) result.fill(0);
  }
}

// Java PBKDF2 password encoders must not reinterpret an unpaired UTF-16
// surrogate. The existing UTF-8 replacement semantics remain the JS fallback.
function hasUnpairedSurrogate(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

async function deriveKeyBytes(passphrase: string, salt: Uint8Array, requireCurrent: () => void) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.importKey && subtle.deriveBits) {
    // Standards-native WebCrypto runs the same PBKDF2 operation off the browser
    // JS thread. Hermes without SubtleCrypto uses the optional native bridge or
    // the cooperative path below.
    const password = new Uint8Array(utf8ToBytes(passphrase));
    let key: Uint8Array | undefined;
    let started: number | undefined;
    try {
      requireCurrent();
      started = diagnosticsNow();
      const secret = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      requireCurrent();
      key = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
        iterations: ITERATIONS, salt: new Uint8Array(salt) }, secret, 256));
      requireCurrent();
      if (key.length !== 32) throw new Error('Secure ledger key derivation failed.');
      return key;
    } catch (error) {
      key?.fill(0);
      throw error;
    } finally {
      password.fill(0);
      if (started !== undefined) recordKdf('webcrypto', started);
    }
  }
  const native = nativeLedgerKeyDeriver;
  if (native && !hasUnpairedSurrogate(passphrase)) {
    requireCurrent();
    const started = diagnosticsNow();
    let hex: string | null;
    try { hex = await native(passphrase, bytesToHex(salt)); }
    catch (error) { recordKdf('native', started); throw error; }
    if (hex !== null) recordKdf('native', started);
    requireCurrent();
    if (hex !== null) {
      if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/.test(hex)) {
        throw new Error('Secure ledger key derivation failed.');
      }
      return hexToBytes(hex);
    }
  }
  const started = diagnosticsNow();
  try { return await deriveKeyCooperatively(utf8ToBytes(passphrase), salt, requireCurrent); }
  finally { recordKdf('portableJs', started); }
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const cacheId = bytesToHex(sha256(utf8ToBytes(`${passphrase}\u0000${bytesToHex(salt)}`)));
  const cached = derivedKeys.get(cacheId);
  if (cached) { cryptoDiagnostics.cacheHits += 1; return new Uint8Array(cached); }
  const generation = keyCacheGeneration;
  const requireCurrent = () => {
    if (generation !== keyCacheGeneration) throw new Error('The ledger was locked. Unlock it before synchronizing again.');
  };
  let pending = pendingKeys.get(cacheId);
  if (!pending) {
    const queuedAt = diagnosticsNow();
    pending = keyDerivationQueue.then(async () => {
      cryptoDiagnostics.keyQueueMs += diagnosticsElapsed(queuedAt);
      requireCurrent();
      const key = await deriveKeyBytes(passphrase, salt, requireCurrent);
      try { requireCurrent(); }
      catch (error) { key.fill(0); throw error; }
      derivedKeys.set(cacheId, key);
      if (derivedKeys.size > 24) {
        const oldest = derivedKeys.keys().next().value!;
        derivedKeys.get(oldest)!.fill(0);
        derivedKeys.delete(oldest);
      }
      return key;
    });
    pendingKeys.set(cacheId, pending);
    keyDerivationQueue = pending.then(() => undefined, () => undefined);
  } else cryptoDiagnostics.coalescedKeys += 1;
  try {
    const key = await pending;
    requireCurrent();
    return new Uint8Array(key);
  } finally {
    if (pendingKeys.get(cacheId) === pending) pendingKeys.delete(cacheId);
  }
}

/** AES-GCM authentication protects data and envelope parameters; no ledger text is uploaded. */
export async function encryptBatch(
  batch: SyncBatch,
  passphrase: string,
  randomSource: RandomSource = secureRandom,
): Promise<string> {
  cryptoDiagnostics.encryptCalls += 1;
  const validationStarted = diagnosticsNow();
  try { validatePassphrase(passphrase); validateBatch(batch); }
  finally { cryptoDiagnostics.encryptMs += diagnosticsElapsed(validationStarted); }
  const salt = await randomSource(16);
  const nonce = await randomSource(12);
  if (salt.length !== 16 || nonce.length !== 12) throw new Error('Secure random generation failed.');
  const header: Omit<EncryptedEnvelope, 'ciphertext'> = {
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
  };
  const key = await deriveKey(passphrase, salt);
  const encryptionStarted = diagnosticsNow();
  try {
    const ciphertext = gcm(key, nonce, associatedData(header)).encrypt(
      utf8ToBytes(JSON.stringify(batch)),
    );
    return JSON.stringify({ ...header, ciphertext: bytesToHex(ciphertext) });
  } finally {
    key.fill(0);
    cryptoDiagnostics.encryptMs += diagnosticsElapsed(encryptionStarted);
  }
}

export async function decryptBatch(text: string, passphrase: string): Promise<SyncBatch> {
  cryptoDiagnostics.decryptCalls += 1;
  const validationStarted = diagnosticsNow();
  validatePassphrase(passphrase);
  if (text.length > MAX_ENVELOPE_CHARS) throw new Error('The encrypted ledger file is too large.');
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('The encrypted ledger file is not valid JSON.');
  }
  if (!isObject(envelope)) throw new Error('Invalid encrypted ledger envelope.');
  assertExactKeys(envelope, [
    'version', 'cipher', 'kdf', 'iterations', 'salt', 'nonce', 'ciphertext',
  ]);
  if (
    envelope.version !== 1 ||
    envelope.cipher !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== ITERATIONS ||
    typeof envelope.salt !== 'string' ||
    !/^[a-f0-9]{32}$/.test(envelope.salt) ||
    typeof envelope.nonce !== 'string' ||
    !/^[a-f0-9]{24}$/.test(envelope.nonce) ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length < 32 ||
    envelope.ciphertext.length % 2 !== 0 ||
    !/^[a-f0-9]+$/.test(envelope.ciphertext)
  ) {
    throw new Error('The encrypted ledger format is not supported.');
  }
  const typed = envelope as EncryptedEnvelope;
  const { ciphertext, ...header } = typed;
  cryptoDiagnostics.decryptMs += diagnosticsElapsed(validationStarted);
  const key = await deriveKey(passphrase, hexToBytes(typed.salt));
  const decryptionStarted = diagnosticsNow();
  try {
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, hexToBytes(typed.nonce), associatedData(header)).decrypt(
      hexToBytes(ciphertext),
    );
  } catch {
    throw new Error('Cannot unlock this ledger. Check the passphrase used on your other phone.');
  } finally {
    key.fill(0);
  }
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return validateBatch(decoded);
  } finally {
    plaintext.fill(0);
  }
  } finally { cryptoDiagnostics.decryptMs += diagnosticsElapsed(decryptionStarted); }
}

export type ProjectedMinuteLine = { minuteIndex: number; text: string };

/** Accepts the 24-hour and AM/PM timestamps Context writes, including multiline entries. */
export function parseProjectedMinutes(description: string, options: { legacyMetadata?: boolean; ranges?: boolean } = {}): ProjectedMinuteLine[] {
  if (options.ranges) return parseCalendarMinuteLog(description);
  const entries: ProjectedMinuteLine[] = [];
  for (const line of description.split(/\r?\n/)) {
    if (options.legacyMetadata !== false && /^(?:Context (?:block|projection|category):|Full minute record available in Context\.)/.test(line)) {
      continue;
    }
    const timestamp = /^\s*(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?[ \t]+(.*)$/i.exec(line);
    if (timestamp) {
      let hour = Number(timestamp[1]);
      const meridiem = timestamp[3]?.toUpperCase();
      if ((meridiem && (hour < 1 || hour > 12)) || (!meridiem && hour > 23)) continue;
      if (meridiem) hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
      const minuteIndex = hour * 60 + Number(timestamp[2]);
      if (entries.some((entry) => entry.minuteIndex === minuteIndex)) {
        throw new Error('The calendar description contains duplicate minute timestamps.');
      }
      entries.push({ minuteIndex, text: timestamp[4] ?? '' });
    } else if (entries.length > 0 && line.trim()) {
      const previous = entries[entries.length - 1]!;
      previous.text += `\n${line}`;
    }
  }
  return entries;
}
