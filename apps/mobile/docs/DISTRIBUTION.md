# Context distribution

The repository prepares three release channels. No store listing or signed public release has been
created. Native builds and account sign-in still need physical Android/iPhone verification and the
owner's signing/store accounts.

## Google Play

From `apps/mobile`, sign into the owner's Expo account and build:

```sh
pnpm --package=eas-cli@25.3.0 dlx eas build --platform android --profile google-play
```

The profile creates an Android App Bundle (`.aab`) for Google Play. Register the final package ID
`com.context.minuteledger` and signing certificate SHA-1 values with Google OAuth. After the Play
Console app is created and its first binary uploaded, configure the owner's Google service account
for later EAS submissions. The provided submission profile targets an internal draft release:

```sh
pnpm --package=eas-cli@25.3.0 dlx eas submit --platform android --profile google-play
```

Publish from Play Console after completing the real listing, privacy/data-safety disclosures,
required testing, and account configuration. The source tree contains no service-account key.

## Apple App Store

```sh
pnpm --package=eas-cli@25.3.0 dlx eas build --platform ios --profile apple-app-store
pnpm --package=eas-cli@25.3.0 dlx eas submit --platform ios --profile apple-app-store
```

Use the owner's Apple Developer and App Store Connect accounts, register the bundle ID
`com.context.minuteledger`, and configure the iOS Google OAuth client before building. This profile
targets a real iPhone store build, not the simulator. Uploading a binary makes it available for
processing/TestFlight; the owner completes the listing and App Review submission in App Store
Connect. Complete Apple's encryption/export-compliance questions for the encrypted ledger; no
exemption answer has been assumed in the app configuration.

## F-Droid source edition

The F-Droid variant omits Google's native sign-in module and the Expo development client. Its
calendar connection uses Android's calendar provider. Encrypted ledger sync remains available with
WebDAV and optional Microsoft account access. Native Google account connection explains the
edition's supported alternatives instead of loading an unavailable SDK.

The F-Droid directory includes a **disabled metadata template**, not an accepted recipe. Public
source, a real release commit, and a verified build-server toolchain must be supplied before
submission. The owner selected MIT for the source and the root `LICENSE` records that choice. See
[`../fdroid/LICENSE_DECISION.md`](../fdroid/LICENSE_DECISION.md).

To exercise the unsigned source build, use a separate clean Linux checkout with Android SDK/JDK,
Node 24.19.0, and pnpm 11.25.0. The committed lockfile pins package resolutions; the deterministic
preparation step removes the proprietary Google wrapper and development-client dependency from
the root manifest and lock importer before installation. The FOSS build does not install those
unused packages. Run every preparation/build command with the distribution variable set:

```sh
export EXPO_PUBLIC_CONTEXT_DISTRIBUTION=fdroid
export CONTEXT_FDROID_SOURCE_BUILD=1
node scripts/prepare-fdroid.cjs --apply
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec expo prebuild --platform android --no-install
node scripts/prepare-fdroid.cjs --unsigned-android
cd android
./gradlew --no-daemon assembleRelease
```

The APK output is `android/app/build/outputs/apk/release/app-release-unsigned.apk`. Signing is
separate; the metadata candidate lets F-Droid build and sign its own artifact. No keystore or
password is stored in the source. Verify the unsigned native dependency graph with F-Droid's
scanner, review any bundled build tools and native binaries against its policies, and fix actual
findings rather than hiding them with broad scanner exclusions. Exact APK reproducibility has not
yet been demonstrated; pin the Android SDK/NDK, JDK, Gradle repositories, and accepted server
environment when the first native source build is verified.

For a privately signed preview of the FOSS variant, EAS also provides `fdroid-preview`. That profile
uses the same dependency pruning through the guarded `eas-build-pre-install` hook in EAS's clean
build checkout. The hook is a no-op for store/development builds and refuses to mutate an ordinary
local checkout when invoked in F-Droid EAS mode. This preview does not itself constitute an official
F-Droid build:

```sh
pnpm --package=eas-cli@25.3.0 dlx eas build --platform android --profile fdroid-preview
```

All channels use the same Android application ID. Different signing certificates do not update
each other's installations; plan the signing identity and ledger migration before changing a
device's distribution channel. F-Droid reviewers determine whether optional proprietary cloud
services need an anti-feature declaration; the offline ledger and WebDAV storage work without them.

## References

- [Expo Android APK/AAB builds](https://docs.expo.dev/build-reference/apk/)
- [Expo Google Play submission](https://docs.expo.dev/submit/android/)
- [Expo Apple submission](https://docs.expo.dev/submit/ios/)
- [Expo native autolinking exclusions](https://docs.expo.dev/modules/autolinking/)
- [F-Droid inclusion policy](https://f-droid.org/docs/Inclusion_Policy/)
- [F-Droid metadata reference](https://f-droid.org/docs/Build_Metadata_Reference/)
- [F-Droid submission guide](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
