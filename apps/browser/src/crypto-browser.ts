// Shared codec fallback import. Browser builds never resolve native Expo code.
export async function getRandomBytesAsync(length: number) { return crypto.getRandomValues(new Uint8Array(length)); }
