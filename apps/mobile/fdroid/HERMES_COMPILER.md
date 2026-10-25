# Exact official Hermes compiler exception

Context's Linux Android builder uses official `hermes-compiler@260318099.0.4` to compile the
JavaScript bundle. Its Linux executable is not copied into the Android APK.

[F-Droid's policy](https://f-droid.org/docs/Inclusion_Policy/#build-transparency-and-reproducibility)
explicitly permits official Hermes prebuilts until Debian alternatives exist. This recipe requests
that exception for one checked file. It grants no exception to other binaries or complete directories.
Reviewers still assess the full recipe.

- Package license: MIT.
- [Official npm metadata](https://registry.npmjs.org/hermes-compiler/260318099.0.4).
- [Published source commit](https://github.com/facebook/hermes/commit/d412d3bd851278712c20cca25d094e32641a0465): `d412d3bd851278712c20cca25d094e32641a0465`.
- npm integrity: `sha512-8odcPFkPC82HlqCl0C5QI9mBN4rEAT+IAo55sJhzwKw//K3qZloiv3ex6J2O8CuBbhdmkJozfidNsset2KH25w==`.
- File: `hermesc/linux64-bin/hermesc`.
- SHA-256: `44d76b1e385b6584380e95e5c63d9f98a4f812cd3cc7aa0500bacd3c39fe0987`.

The only metadata `scanignore` is:

```text
apps/mobile/node_modules/.pnpm/hermes-compiler@260318099.0.4/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc
```

Source preparation verifies the version and file digest before scanning. A mismatch stops the
build. macOS/Windows compiler files are separately removed by reviewed hashes. The generated
input audit records the retained compiler's provenance; Android Expo modules/core compile from source.
