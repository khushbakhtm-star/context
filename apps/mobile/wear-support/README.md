# Galaxy Watch companion

The native Wear OS app uses the same package ID and EAS signing key as the standalone
Context phone APK. Install an updated phone APK, enable **Allow watch access** in Context,
and open Context on the phone once. The watch does not require a Play developer account,
calendar login, cloud storage account or separate ledger.

The watch opens at the current minute. Its main screen contains the date heading, Now,
and the 1,440-minute list. Scroll the list or use the touch bezel to step by a minute.
Tap a minute to type with the installed watch keyboard or choose Dictate. The editor
keeps its original date/minute while the clock changes. Tap the date heading to open a
dialog with a `YYYY-MM-DD` field and previous/next day controls. Now returns to the current
minute. Downloaded days remain available offline. An uncached day loads after the paired
phone is running Context.

Saving first commits an atomic private watch journal, then sends an immutable operation
through Wear OS Data Layer. “Waiting for phone” means the phone has not committed it yet.
While the phone app is closed the native inbox can receive edits; ledger updates apply when
Context next runs. Conflicts retain both versions and direct the user to review them in Context
on the phone. The watch shows both versions with a Back button; resolving the conflict in
the phone's watch review updates the original receipt and clears the watch's saved conflict.

## Cloud build

Run from `apps/mobile` using the existing authorized EAS account:

```
eas build --platform android --profile wear-preview --non-interactive
```

The config plugin generates `android/wear` from reviewed sources; the EAS profile runs
`:wear:test :wear:assembleRelease`. The module-level `test` task runs the enabled JVM
tests; AGP 9 only creates unit tests for its selected test build type, which defaults to
debug. Cloud-only `credentials.json` supplies
the same remote signing key used by the phone. The watch version code is 100,000 plus the
phone code (phone 9 becomes watch 100009), reserving separate Play artifact ranges.
Release signing fails if those credentials
are absent. Never create a new watch key, export credentials or change the watch package ID.
Verify both APK package names and public signing certificate hashes before distribution.

Enable watch developer options and wireless debugging. Pair and connect using the two
ports displayed by the watch, then install the watch APK:

```
adb pair WATCH_IP:PAIRING_PORT
adb connect WATCH_IP:DEBUG_PORT
adb -s WATCH_IP:DEBUG_PORT install -r context-wear.apk
```

The first command prompts for the pairing code shown on the watch. The pairing port and
debugging port differ. Hardware verification must cover typing/dictation, bezel scrolling,
midnight/day changes, stale-phone conflicts, reconnect, process restart, long notes, and
a full day Asset exceeding 100 KB. Source tests and successful APK assembly alone do not
confirm the paired-device experience.

## F-Droid

The optional watch build and native phone bridge depend on Google Play services. F-Droid
preparation verifies every file against `fdroid/wear-source-inputs.json` and removes those
exact source inputs before autolinking and scanning. Unknown or changed files stop the build.
The F-Droid app omits this companion transport. An official F-Droid-signed phone also has a
different signing certificate and cannot exchange this app's Data Layer with an Expo-signed
watch. No scanner bypass or private signing key is committed.

Signing layout was checked against Expo's current build-tool sources:
[credential restoration](https://github.com/expo/eas-cli/blob/main/packages/build-tools/src/android/credentials.ts),
[signing template](https://github.com/expo/eas-cli/blob/main/packages/build-tools/src/templates/EasBuildInjectAndroidCredentialsGradle.ts),
and [Android build phases](https://github.com/expo/eas-cli/blob/main/packages/build-tools/src/builders/android.ts).
The current template reads `EAS_BUILD_WORKINGDIR/credentials.json` before Gradle; the
watch follows that same location and `android.keystore` fields, including absolute key path.
