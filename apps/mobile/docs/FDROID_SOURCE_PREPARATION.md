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

`fdroid/source-inputs.json` records 28 package identities, npm integrity, 109 exact unused file
removals, and five narrow source patches. Every affected file has a fixed SHA-256; the build never
generates new trusted hashes for itself. Changed inputs fail and require review.

The current refresh adds MIT-licensed `expo-clipboard` 58.0.4 to the reviewed dependency graph.
Its two newly reviewed unused inputs are its local-Maven AAR/source-JAR publications; its
Android module compiles from source through the existing all-module selection. It introduces
no new npm dependency, source patch, scanner exception or toolchain change. The prior Print
58.0.7 and Sharing 58.0.20 inventory remains intact, including Print's Apple-only archives.
The SDK-only `context-calendar-colors` source remains included when optional Wear sources are
removed. Clipboard's registered Android source module is `expo.modules.clipboard.ClipboardModule`.

The 109 entries count reviewed manifest paths, not removals on a particular runner. Linux is
expected to omit the one Windows-only macro input, so an actual Linux audit may record 108;
independent CI must establish its actual count. Temporary-fixture tests verify all eight
Print/Sharing/Clipboard hashes, remove only copied files and confirm installed package bytes
remain unchanged. Cold Linux source scanning, the integrated F-Droid recipe build and APK scans
of the newly pinned source are still required. Historical 0.1.16 results are not evidence that
this refreshed source passed. Native evidence must resolve Print, Sharing, Clipboard and the
calendar-color bridge to actual DEX class definitions, using exact R8 mappings where obfuscated.

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
