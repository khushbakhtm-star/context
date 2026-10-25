# Independent F-Droid verification diagnostics

`.github/workflows/fdroid-verify.yml` runs without Expo, Google, Apple, or GitLab account secrets.
It runs when a `codex/fdroid-*` branch is pushed, with the commit check visible in its pull request.
Manual workflow dispatch is also available after the workflow exists on the default branch.
It checks the reviewed full `CONTEXT_SOURCE_COMMIT`, matching the candidate's commit, version,
and Android code to that checkout. A branch or tag cannot silently change the source.

## Verified 0.1.3 outcome

[Run 40206078084](https://github.com/khushbakhtm-star/context/actions/runs/40206078084), completed on
2026-10-25, passed both jobs for **Context 0.1.3, Android version code 4**:

- Application source: `761264dab4880b91843d6a500591de9c73a9f9f5`.
- Verification controller: `646bb446a8af688a21057490e67ae1875b45094b`.
- Public tagged source and signed preview: [v0.1.3](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.3), published at 15:29:28 UTC on 2026-10-25.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings**, 7 normal informational entries |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; built the exact 0.1.3 source commit |
| Integrated APK scan | Exit 0 |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 10m 55s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.3`, code `4` |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

The Linux input audit records **100 removed files and five narrow source patches**. The seven
informational source findings are the exact hash-checked official Linux Hermes compiler exception
and six normal Gradle-wrapper removals. No broad scanner exclusion or skipped scan was added.

- [Metadata/integrated-build artifact 12603884752](https://github.com/khushbakhtm-star/context/actions/runs/40206078084/artifacts/12603884752): 47,499 bytes; ZIP SHA-256 `7937d6ffb4aa8f67263c86407e8c4d130417eb9dd00bee4843cd34442691455f`.
- [Independent native artifact 12604640234](https://github.com/khushbakhtm-star/context/actions/runs/40206078084/artifacts/12604640234): 32,542,104 bytes; ZIP SHA-256 `522ca01dba4690cb338446d4f4178d87353d9a6d0faaad39f6cfb307f3081d2e`.
- Unsigned diagnostic APK: 77,536,856 bytes; SHA-256 `d2c873e8f2e70fc481b837e391bc2c90725bc88fc681639aa5df1983f19783fe`.

The separately signed [standalone preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.3/context-0.1.3-foss-preview.apk)
is 77,549,160 bytes, SHA-256 `5d008da29fe0921b4a99bb6039f1a68c607bcef5d7ab0a0501572b6a445e009d`.
Its ZIP integrity, embedded version/application identity and configured FOSS distribution were checked,
with no forbidden native class markers found by the preview inspection. Its v2 signing certificate
matches the published 0.1.2 preview; this continuity check is not full cryptographic signature validation.
The signed preview is separate from the unsigned diagnostic artifact and official F-Droid builds.

TypeScript, all **161 app tests**, five release guards, and upstream listing validation passed.
The [v0.1.3 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40207178435)
also passed at that immutable source. Store channel jobs were readiness-gated and skipped.
This update adds inline entry, the square spreadsheet grid, formatting, same-day range fill/clear,
undo/redo, and zoom. Physical-phone validation is pending. Undo restores Context entries and
formatting within the current editing session; calendar or invitation effects can need separate review.

These are independent Ubuntu-toolchain build and scan results. They do not establish byte-for-byte
reproducibility, physical-phone QA, use of F-Droid's official server/VM, official signing, acceptance,
or catalog publication. The existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667)
is pending; no second inclusion request was created for this update. Diagnostic artifacts expire after
30 days; their hashes, source pins, and observed results remain recorded here.

## Historical verified 0.1.2 outcome

[Run 40176383213](https://github.com/khushbakhtm-star/context/actions/runs/40176383213), completed on
2026-10-25, passed both jobs for **Context 0.1.2, Android version code 3**:

- Application source: `49cb65def8d6f951f5709e8ee5bd581d352b1693`.
- Verification controller: `f5d18682e91a309d4098539b2362f2b91b3d9b15`.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings**; exit 0 |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; built 0.1.2 from the exact source commit |
| Integrated APK scan | Scanned known non-free classes and extra signing blocks; logged success |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 12m 5s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.2`, code `3`, compile SDK `37`, all four configured ABIs |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

The seven source-scan informational entries are the exact official Linux Hermes compiler
exception and six normal Gradle-wrapper removals. There is no directory-wide exception, build
`--force`, or skipped scan. The Linux input audit records **100 removed files and five patched
files**; the cross-platform inventory also lists a Windows-only optional file not installed there.
The retained compiler digest is checked against its documented official-package provenance.

- [Metadata/integrated-build artifact 12593026611](https://github.com/khushbakhtm-star/context/actions/runs/40176383213/artifacts/12593026611): logs, source report, input audit, recipe diff, and provenance. ZIP SHA-256: `1a3be9a5e09df5c49f1014a5be427d4d29e79531371c4206d8a5b376409129d4`.
- [Independent native artifact 12592717530](https://github.com/khushbakhtm-star/context/actions/runs/40176383213/artifacts/12592717530): unsigned diagnostic APK, identity/signature/scan results, hashes, and native input audit. ZIP SHA-256: `592b47bd83c53eaf01b557a95bae328f0bc329d69aab9228f9836d716c6a51b1`.

The unsigned diagnostic **APK** SHA-256, read from the verified native artifact, is
`3b0c83e1eac4937b73bf7380765bdcecd7cac90bb7efd856af680442e803eeb0`.
This is distinct from the artifact ZIP digest and any separately signed installable preview.

These results establish the scans and source-built recipe on the recorded Ubuntu toolchain. They
do not establish byte-for-byte reproducibility, physical-phone QA, F-Droid's official server/VM
provisioning, signing, acceptance, or publication. A packager must review the recipe and exact Hermes
exception, run it in the approved server environment, and assess inclusion policy. Native phone
validation remains required. This workflow does not publish an APK or submit anything to F-Droid.

## Actual checks and failure evidence

The **metadata** job copies the concrete disabled candidate at
`fdroid/metadata/com.context.minuteledger.yml` into a scratch repository with the complete official
fdroiddata configuration tree. It runs:

```sh
fdroid lint com.context.minuteledger
fdroid scanner --force --exit-code --json com.context.minuteledger:4
```

Scanner `--force` includes disabled builds. It does not suppress scanner findings. The scanner
runs the candidate's real `init` commands, then scans its prepared source and installed dependency
tree. Its stdout and stderr are retained separately; stdout is not falsely labeled valid JSON if
subprocess output was mixed into it. Actual nonzero exits remain failures. The pinned 2.4.5
scanner has a source-mode exit-code defect: it can emit errors and still exit zero. The helper
therefore independently validates its JSON error arrays and fails when they are nonempty,
preserving the original command exit code and every finding.

A second scratch repository removes only the recipe's `disable` value, verifies that its `gradle`
command resolves to hash-verified Gradle 9.4.1, and runs a normal integrated attempt:

```sh
fdroid build --test --stop --scan-binary com.context.minuteledger:4
```

The candidate and template stay disabled. The ephemeral copy and its full diff are artifacts.
The attempt has no build `--force`, `--skip-scan`, or `scandelete`. Its only `scanignore` is the
exact hash-verified official Linux Hermes compiler under the explicit policy exception.
Scanner findings stop this integrated build normally rather than being bypassed to obtain an APK.
Before invoking the build, the helper uses F-Droid's own pinned VCS API to check out the exact source
commit and establish `SOURCE_DATE_EPOCH`. This avoids 2.4.5's fresh-checkout initialization bug;
normal source preparation, scanning, and building still run.

The **native** job uses a separate clean checkout of the same commit, applies FOSS dependency
preparation, installs the frozen lockfile, and prebuilds with the digest-checked native template
bundled in the locked Expo package. It disables signing and attempts `assembleRelease` with the
official pinned Gradle binary. On success it verifies package/version identity, checks that the
APK is unsigned, hashes it, and runs F-Droid's APK binary scanner. The unsigned diagnostic APK is
retained in CI artifacts. It is not the signed standalone preview or an official F-Droid build.

Every invoked check records its command, exit code, expected exit codes, duration, and log files
in `results.json`. Artifacts are uploaded even when a check fails. Installation/bootstrap failures
remain visible in the job logs and any partial evidence files. A successful independent assembly
cannot override an unsuccessful source scan or integrated recipe attempt.

## Resolved recipe defect: the Gradle wrapper

The original 0.1.0 recipe called `./gradlew`. fdroidserver removes `gradlew`, `gradlew.bat`, and
`gradle-wrapper.jar` during scanning, so that original command was incompatible. The revised recipe
provisions hash-verified Gradle 9.4.1 and invokes it directly. Wrapper state remains an evidence artifact.

Independent assembly alone still does **not** establish that the complete scanned recipe works:

```yaml
build:
  - cd android && EXPO_PUBLIC_CONTEXT_DISTRIBUTION=fdroid gradle --no-daemon assembleRelease
```

The recipe includes provisioning instead of assuming a default server has the right version.
The integrated 0.1.2 build above passed. Its provisioning on F-Droid's official server and recipe
enablement still require packager review. Do not retain the wrapper through a broad exclusion.

## First actual CI findings

Run `40171690827` installed the pinned verifier and native toolchain successfully. Metadata lint
returned zero. The real source scanner reported **91 errors and 9 warnings**, while returning zero
because of the pinned server's defect. The structured-report guard now treats those errors as a
failed check. Raw logs and the first-run artifacts remain unchanged evidence.

| Error category reported by the scanner | Count |
| --- | ---: |
| Android AAR libraries | 12 |
| Java JAR files | 12 |
| Binaries, including esbuild/Hermes and React Native data | 47 |
| Gzip archives, including prebuilt Expo/iOS artifacts and the native template | 11 |
| Shared libraries in expo-sqlite | 4 |
| WebAssembly files | 2 |
| `com.android.installreferrer` dependency in expo-application | 1 |
| Unknown Maven repository expressions | 2 |

These were failures of the original source, resolved by the reviewed preparation and verified
0.1.2 run above. This table does not declare every flagged file proprietary. No finding was removed
through a blanket exclusion. The first
integrated attempt also exposed `SOURCE_DATE_EPOCH=None` before F-Droid cloned the empty scratch
build directory. The explicit official-VCS checkout bootstrap addresses that verifier failure.
That baseline's independent native result did not erase its source findings; the new source scan
and integrated build provide the separate remediation evidence.

That first run's independent native job subsequently **succeeded**: Gradle assembled the unsigned
release in 6 minutes 41 seconds, `aapt2` confirmed `com.context.minuteledger` / version `0.1.0` /
version code `1` / compile SDK `37`, and the APK contains all four configured Android ABIs.
The signature verifier returned the expected unsigned result. F-Droid's APK binary scanner returned
zero after checking known non-free classes and extra signing blocks. Evidence is in
[native diagnostic artifact 12591210515](https://github.com/khushbakhtm-star/context/actions/runs/40171690827/artifacts/12591210515).
This result does not establish source compliance, byte-for-byte reproducibility, successful use
on a physical phone, acceptance of the proposed recipe, or official F-Droid publication.

The revised [source preparation](FDROID_SOURCE_PREPARATION.md) implements the following remediation,
verified by the cold production installation, source scan, and native builds in the 0.1.2 run:

- Package-level `expo.autolinking.android.buildFromSource: [".*"]` selects source-built Expo
  modules. Gradle property `expo.core.buildFromSource=true` separately disables Expo core's native
  prebuilt cache. Exact hash-reviewed unused publications are removed after selecting source builds.
- SQLite vector binaries are explicitly disabled and removed; ordinary SQLite compiles `sqlite3.c`.
- Both the transitive Install Referrer implementation and dependency are removed; application
  identity constants remain available to AuthSession.
- The two publishing-only Maven blocks and Safe Area Context's obsolete local repository are
  narrowly patched. Non-Android archives, web WASM, and iOS language data have exact reviewed cleanup.
- Dev-only tsx/esbuild is omitted. The official Linux Hermes compiler is retained through its exact
  hash-checked policy exception; other host binaries receive no blanket exemption.

See [Expo source-build selection](https://docs.expo.dev/modules/autolinking/#buildfromsource) and
[SQLite options](https://docs.expo.dev/versions/latest/sdk/sqlite/). Repeat real scans and native
tests after each justified packaging change.

## Pinned tools and provenance

| Tool or input | Pinned source |
| --- | --- |
| Latest verified app source | Public commit `761264dab4880b91843d6a500591de9c73a9f9f5` (0.1.3/code 4) |
| Prior verified app source | Public commit `49cb65def8d6f951f5709e8ee5bd581d352b1693` (0.1.2/code 3) |
| fdroidserver | Official 2.4.5 sdist, SHA-256 `f9b52646264c732678e32e37e23a995db20cc61d45622dda5830ce23255547f4`; release source commit `92229a9152a31d005503bac64d773551f0655494` |
| fdroiddata definitions and icons | Commit `dbd57558e5e687a018116b4242c42dd52d00124a` |
| Java | Eclipse Temurin `17.0.21+9` |
| Python | `3.12.15`, with resolved verifier dependencies recorded in `pip-freeze.txt` |
| Node / Corepack / pnpm | `24.19.0` / `0.36.0` / `11.25.0` |
| Android official packages | Command-line tools `23.0`, platform `android-37.0`, Build Tools `37.0.0`, NDK `27.1.12297006`, CMake `3.22.1` |
| Gradle | Official `9.4.1` binary ZIP, SHA-256 `2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb` |
| Expo native template | Locked Expo `template.tgz`, SHA-256 `fd958ca9b434d114ccc70c010d5404b537d49cd6ff09e239c917793ef4872991` |

GitHub Actions are pinned by commit. The runner is Ubuntu 24.04; its image version, installed
Android packages, verifier dependency resolutions, command versions, and downloaded scanner
signature cache/hashes are evidence artifacts. This is not a claim that the rolling GitHub runner,
PyPI transitive dependencies, or latest scanner signatures are byte-for-byte reproducible, nor that
the runner matches F-Droid's official isolated server image.

## Future accepted tag updates

Keep today's `AutoUpdateMode: None` and `UpdateCheckMode: None` while its recipe remains disabled.
After the first complete recipe is proven and accepted, ask the F-Droid packager to configure the
accepted fdroiddata entry with the tracked Expo version fields:

```yaml
AutoUpdateMode: Version v%v
UpdateCheckMode: Tags ^v[0-9]+\.[0-9]+\.[0-9]+$
UpdateCheckData: 'apps/mobile/app.json|"versionCode":\s*(\d+)|.|"version":\s*"([^"]+)"'
```

fdroidserver 2.4.5 supports these file regexes for tag checks. The path is relative to the source
repository root; `.` reuses the same file for the version name. This matters because Context's
native manifests are generated and untracked, so ordinary native-manifest tag detection alone
does not find its release version. Keep `versionCode` increasing and protect released `v*` tags
against replacement. Review `fdroid checkupdates com.context.minuteledger` output in the accepted
packaging checkout before relying on automatic updates.

Enable those settings only in the accepted, verified recipe: auto-update copies its latest build
instructions and enables the generated build entry. Each future source tag then remains subject to
F-Droid's independent scan, build, signing, and publication. This GitHub workflow does not publish
official F-Droid updates or announce an update before F-Droid users can obtain it.

## Primary references

- [fdroidserver 2.4.5 source and dependency requirements](https://gitlab.com/fdroid/fdroidserver/-/blob/92229a9152a31d005503bac64d773551f0655494/setup.py)
- [Scanner implementation and wrapper removal](https://gitlab.com/fdroid/fdroidserver/-/blob/92229a9152a31d005503bac64d773551f0655494/fdroidserver/scanner.py)
- [Tag/version-file check implementation](https://gitlab.com/fdroid/fdroidserver/-/blob/92229a9152a31d005503bac64d773551f0655494/fdroidserver/checkupdates.py)
- [Pinned fdroiddata configuration](https://gitlab.com/fdroid/fdroiddata/-/tree/dbd57558e5e687a018116b4242c42dd52d00124a/config)
- [Official Android package repository](https://dl.google.com/android/repository/repository2-3.xml)
- [Official Gradle checksum](https://services.gradle.org/distributions/gradle-9.4.1-bin.zip.sha256)
- [Temurin 17.0.21+9 release](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.21%2B9)
- [Python 3.12.15](https://www.python.org/downloads/release/python-31215/)
