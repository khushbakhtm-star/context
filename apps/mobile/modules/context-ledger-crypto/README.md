# Context ledger key derivation

This MIT-licensed local Expo module uses only Android's SDK cryptography provider. Android 26+ derives the existing 32-byte PBKDF2-HMAC-SHA256 ledger key with 600,000 iterations and a 16-byte salt on a dedicated serial CPU executor. The wire envelope, AES-GCM encryption and permissions remain unchanged.

Before handling a real passphrase, the selected provider must match fixed UTF-8 reference vectors (ASCII, Arabic, emoji, composed/decomposed accents, NUL and HMAC length boundaries). It uses the same JCA path for those checks and production derivation. A failed self-test rejects the operation. No secrets are logged, persisted or cached by this module. Mutable password, salt and derived-byte buffers are cleared after use; immutable bridge strings and opaque provider-internal copies cannot be guaranteed erased.

The optional JS wrapper returns null on other platforms, absent native support, Android 24–25, or unmatched UTF-16 surrogates. Those cases retain the existing cooperative JavaScript path and its exact TextEncoder semantics. Invalid requests or malformed native keys reject. Provider errors never become a successful key.
