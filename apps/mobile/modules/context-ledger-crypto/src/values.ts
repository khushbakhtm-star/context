export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 1_024;

/** Preserve the existing TextEncoder fallback for unmatched UTF-16 surrogate code units. */
export function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function ledgerKeyRequest(passphrase: unknown, saltHex: unknown): { passphrase: string; saltHex: string } {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH ||
      passphrase.length > MAX_PASSPHRASE_LENGTH || typeof saltHex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(saltHex)) {
    throw new Error('The ledger key request is invalid.');
  }
  return { passphrase, saltHex: saltHex.toLowerCase() };
}

export function ledgerKeyValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('The phone could not verify its ledger key derivation.');
  }
  return value;
}
