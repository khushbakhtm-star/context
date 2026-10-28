import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { isWellFormedUtf16, ledgerKeyRequest, ledgerKeyValue } from './src/values';

type NativeLedgerCrypto = {
  deriveKeyAsync?: (passphrase: string, saltHex: string) => Promise<unknown>;
};

/** Optional Android acceleration; null retains the existing byte-compatible JS implementation. */
export async function deriveLedgerKeyAsync(passphrase: string, saltHex: string): Promise<string | null> {
  const request = ledgerKeyRequest(passphrase, saltHex);
  if (Platform.OS !== 'android' || !isWellFormedUtf16(request.passphrase)) return null;
  const api = Number(Platform.Version);
  if (Number.isFinite(api) && api < 26) return null;
  const native = requireOptionalNativeModule<NativeLedgerCrypto>('ContextLedgerCrypto');
  if (typeof native?.deriveKeyAsync !== 'function') return null;
  const result = await native.deriveKeyAsync(request.passphrase, request.saltHex);
  // Only the native SDK eligibility check may opt out; errors and invalid keys fail closed.
  return result === null ? null : ledgerKeyValue(result);
}
