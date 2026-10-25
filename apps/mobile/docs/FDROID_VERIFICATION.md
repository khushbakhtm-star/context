# Independent F-Droid verification diagnostics

`.github/workflows/fdroid-verify.yml` runs without Expo, Google, Apple, or GitLab account secrets.
It runs when a `codex/fdroid-*` branch is pushed, with the commit check visible in its pull request.
Manual workflow dispatch is also available after the workflow exists on the default branch.
It checks the fixed public `v0.1.0` source commit
`eae2abdb22afb092c273acef4e60cbdb17c2743f`; changing a branch or providing a different tag cannot
silently change the application being tested.

The [first CI run](https://github.com/khushbakhtm-star/context/actions/runs/40171690827) installed the
toolchain and ran the real metadata/source checks. Its results and the specific verifier fixes
are recorded below. Read each later run's actual artifacts rather than inferring success from the
workflow's presence. It does not publish an APK or submit anything to F-Droid.

## Actual checks and failure evidence

The **metadata** job copies the concrete disabled candidate at
`fdroid/metadata/com.context.minuteledger.yml` into a scratch repository with the complete official
fdroiddata configuration tree. It runs:

```sh
fdroid lint com.context.minuteledger
fdroid scanner --force --exit-code --json com.context.minuteledger:1
```

Scanner `--force` includes disabled builds. It does not suppress scanner findings. The scanner
runs the candidate's real `init` commands, then scans its prepared source and installed dependency
tree. Its stdout and stderr are retained separately; stdout is not falsely labeled valid JSON if
subprocess output was mixed into it. Actual nonzero exits remain failures. The pinned 2.4.5
scanner has a source-mode exit-code defect: it can emit errors and still exit zero. The helper
therefore independently validates its JSON error arrays and fails when they are nonempty,
preserving the original command exit code and every finding.

A second scratch repository creates an explicitly proposed recipe: it removes the build's
`disable` value and replaces its exact `./gradlew` invocation with `gradle`, after verifying that
`PATH` resolves to the hash-verified Gradle 9.4.1 binary supplied by this workflow. It then runs a
normal integrated attempt:

```sh
fdroid build --test --stop --scan-binary com.context.minuteledger:1
```

The original candidate and template stay disabled. The proposed ephemeral copy and its full diff
are artifacts; it is not represented as the unchanged original recipe. The attempt has no build
`--force`, `--skip-scan`, `scanignore`, or `scandelete`.
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

## Known recipe defect: the Gradle wrapper

The concrete candidate currently calls `./gradlew` manually. fdroidserver removes `gradlew`,
`gradlew.bat`, and `gradle-wrapper.jar` while scanning prepared source. Therefore this candidate's
manual build command is incompatible with the normal scanned build, even if all other scanner
findings are resolved. `post-scanner-wrapper-state.json` records what remains after the real scan.

The independent native job deliberately uses the verified Gradle distribution directly and
therefore does **not** establish that the current scanned recipe works. A packager must provision
an approved pinned Gradle 9.4.1 command on the F-Droid server and change the recipe to use it, for
example with this command after establishing that exact version on `PATH`:

```yaml
build:
  - cd android && EXPO_PUBLIC_CONTEXT_DISTRIBUTION=fdroid gradle --no-daemon assembleRelease
```

That example alone does not install Gradle or establish that a default server image contains the
right version. Its provisioning and the resulting full integrated build must be reviewed before
enabling the recipe. Do not retain the wrapper through a broad scanner exclusion. Other actual
scanner findings, including binaries used by npm build tools, still need individual resolution.

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

These findings require source-build, dependency, and packaging review; this table does not declare
every flagged file proprietary. No finding is removed through a blanket exclusion. The first
integrated attempt also exposed `SOURCE_DATE_EPOCH=None` before F-Droid cloned the empty scratch
build directory. The explicit official-VCS checkout bootstrap addresses that verifier failure.
The separate native job's result must be read independently and cannot erase these source findings.

That first run's independent native job subsequently **succeeded**: Gradle assembled the unsigned
release in 6 minutes 41 seconds, `aapt2` confirmed `com.context.minuteledger` / version `0.1.0` /
version code `1` / compile SDK `37`, and the APK contains all four configured Android ABIs.
The signature verifier returned the expected unsigned result. F-Droid's APK binary scanner returned
zero after checking known non-free classes and extra signing blocks. Evidence is in
[native diagnostic artifact 12591210515](https://github.com/khushbakhtm-star/context/actions/runs/40171690827/artifacts/12591210515).
This result does not establish source compliance, byte-for-byte reproducibility, successful use
on a physical phone, acceptance of the proposed recipe, or official F-Droid publication.

Review of the locked dependency source identifies concrete next work; none of these changes has
been applied by the diagnostic workflow:

- Package-level `expo.autolinking.android.buildFromSource: [".*"]` selects source-built Expo
  modules. Gradle property `expo.core.buildFromSource=true` separately disables Expo core's native
  prebuilt cache. Unused published AAR/JAR files remain scanner inputs until exact-path cleanup is
  justified against the resolved Gradle graph.
- SQLite vector binaries are optional and disabled by default. Review their unused status
  separately from ordinary SQLite's compiled `sqlite3.c` implementation.
- `expo-application` imports Install Referrer classes and declares its dependency. A source patch
  must remove the unused implementation as well as the dependency; deleting only the dependency
  breaks compilation.
- The two unknown Maven expressions are publishing destinations, including React Native's
  `file:///tmp/maven-local`; review their actual build participation rather than assuming a remote
  dependency service. Non-Android archives, web WASM, and language data need target-specific review.
- Linux esbuild and Hermes executables are actual build tools. Resolve their source-built
  replacements or accepted packaging treatment; deleting every binary is not a working build path.

See [Expo source-build selection](https://docs.expo.dev/modules/autolinking/#buildfromsource) and
[SQLite options](https://docs.expo.dev/versions/latest/sdk/sqlite/). Repeat real scans and native
tests after each justified packaging change.

## Pinned tools and provenance

| Tool or input | Pinned source |
| --- | --- |
| App source | Public release commit `eae2abdb22afb092c273acef4e60cbdb17c2743f` |
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
