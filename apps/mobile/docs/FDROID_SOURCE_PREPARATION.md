# Context Android source preparation

Preparation transforms a separate clean checkout. Its presence does not establish review success:
the next immutable public source must pass the real source scan, integrated F-Droid build, and APK
scan before the disabled recipe is enabled.

## Lifecycle

1. `prepare-fdroid.cjs --apply` requires the F-Droid distribution and explicit source-build flag,
   checks clean tracked Git files, removes Google native sign-in/development-client and root dev
   dependencies from the manifest/importer, and records the lock digest/canonical checkout path.
   EAS's pre-install hook instead requires its own ephemeral cloud build checkout.
2. Install with `corepack pnpm install --prod --frozen-lockfile --ignore-scripts`. The locked package
   graph is preserved. `tsx` is esbuild's only incoming lock dependency and is a development test
   runner, not an Android bundler requirement. Ordinary developer checkouts retain their test tools.
3. The F-Droid-only config plugin sets package-level
   `expo.autolinking.android.buildFromSource: [".*"]` and Gradle
   `expo.core.buildFromSource=true`. These independently select all Expo Android modules and native
   core C++ source, including the newly added Navigation Bar/System UI modules.
4. After Expo extracts its native template, the plugin sanitizes installed inputs using the
   committed inventory. It retains the template for EAS and never changes EAS signing.
5. Official source builds call `--unsigned-android` after prebuild. This additionally removes the
   consumed template archive, disables release signing, and enforces the source/vector properties.
   `--sanitize` is also an explicit post-prebuild sanitation command.
6. F-Droid scans the prepared tree, removes wrappers normally, and uses the pinned system Gradle
   9.4.1 command. The recipe no longer depends on deleted `./gradlew` files.

## Optional Wear source removal

The Wear-enabled phone and watch use Google Play services. Before dependency installation,
preparation verifies and removes all 21 files in `fdroid/wear-source-inputs.json`, including
the native phone module, watch Gradle/Kotlin sources, and generation plugin. Changed or unknown
files stop preparation before any removal. The local protocol/UI handles an absent bridge;
no Wear SDK is installed or linked in this edition. The manifest also excludes `context-wear`
from autolinking. CI compares the full removal receipt with the committed inventory and checks
that every listed source is absent, retaining `source-wear-pruning.json` and
`native-wear-pruning.json` alongside the existing dependency audits. The F-Droid edition does
not offer this Google-dependent watch transport. No broad scanner exclusion is added.

## Reviewed inputs

`fdroid/source-inputs.json` records 27 package identities, npm integrity, 107 exact unused file
removals, and five narrow source patches. Every affected file has a fixed SHA-256; the build never
generates new trusted hashes for itself. Changed inputs fail and require review.

The current refresh adds only `expo-print` 58.0.7 and `expo-sharing` 58.0.20 to the previously
reviewed dependency graph. Both are MIT-licensed Expo modules and use the existing source-build
selection. Their six newly reviewed removals are the two modules' local-Maven AAR/source-JAR
publications and Print's debug/release Apple XCFramework archives. No new source patch, scanner
exception, Android SDK change, or proprietary dependency is introduced by this refresh. The
standalone `context-calendar-colors` module uses Android SDK source APIs and remains included
when the optional Wear sources are removed.

The 107 entries count reviewed manifest paths, not the number removed on any particular runner.
A unique temporary-fixture test verifies the six new hashes, removes only copied fixture files,
and checks that the installed package files remain unchanged. Cold Linux scanning, an integrated
F-Droid recipe build, and APK scanning of the newly pinned application commit are still required;
the earlier 0.1.8 verification is not evidence that this refreshed source has passed them.

- Prebuilt Expo local-Maven AAR/JAR publications and core's unused native cache are removed after
  selecting source compilation. Apple XCFramework/Swift-macro files, non-Linux Hermes hosts, and
  iOS `.lproj` resources are not Android inputs. DotSlash belongs to debugger-shell launch functions
  and is not used by noninteractive release assembly.
- SQLite vector `.so` files are unused with `expo.sqlite.withSQLiteVecExtension=false`; SQLCipher
  is also false. Normal SQLite compiles bundled `sqlite3.c`. Web/developer-plugin WASM is omitted
  from this native Android build.
- AuthSession still depends transitively on `expo-application`. Its Install Referrer dependency
  and Kotlin implementation are patched together, retaining identity/version constants. Referrer
  calls explicitly report unsupported behavior instead of linking Google's library.
- Two publishing-only local Maven destination blocks are removed from Expo core/React Native.
  Safe Area Context's obsolete local npm React Native Maven block is removed because RN 0.88 no
  longer ships that directory. Trusted Google/Maven Central repositories remain.

There are no directory-wide scanner exclusions or deletion rules. The sole retained official
Linux Hermes compiler has an exact-file, hash-checked [policy exception](../fdroid/HERMES_COMPILER.md).

## Safety and evidence

Sanitation rejects other roots, path escapes, symlinked input files, changed locks, and unprepared
manifests. It unlinks a project file before patching bytes, detaching pnpm hardlinks and preserving
the global store. A real hardlink test verifies the simulated shared cache is unchanged; negative
tests cover changed hashes and path escapes.

`.context-fdroid-input-audit.json` records each removed/patched path, hashes, reason, and retained
compiler provenance. CI copies it into diagnostic artifacts. Actual source/native scans remain
required; sanitation alone is not a pass.

## Release and toolchain pins

The metadata provisions official Node 24.19.0/Gradle 9.4.1 archives with SHA-256 verification,
Corepack 0.36.0/pnpm 11.25.0, and Debian OpenJDK 17. The approved server SDK must provide platform
37.0, Build Tools 37.0.0, NDK 27.1.12297006, and CMake 3.22.1. CI records its exact environment.

The verifier requires a reviewed full `CONTEXT_SOURCE_COMMIT`, checks checkout identity, and
compares metadata version/code with that commit's `app.json`. Publish source commit B first, then
controller/metadata commit C pinning B. Keep the recipe disabled until that exact source passes.
Future changes need a new immutable pin and another real run.
