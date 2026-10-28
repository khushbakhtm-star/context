# Context F-Droid submission preparation

## Verified 0.1.21 candidate

The current independent candidate is [0.1.21/code22](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.21), source [`f929b89c526e8dea1c4c2eaaee315329848384bb`](https://github.com/khushbakhtm-star/context/commit/f929b89c526e8dea1c4c2eaaee315329848384bb). Both phone editions and all twelve public evidence files match verified local sizes/digests. [Run 40613164391](https://github.com/khushbakhtm-star/context/actions/runs/40613164391), controller `68c38dcd8cdb424ee21bc07f7765c0606fc9cee8`, passed independent native and integrated recipe/APK scans. Structured source results: **0 errors, 0 warnings**, 7 information findings. Audits recorded 108 removals, 5 patches and 33 exact optional Wear-source removals.

The FOSS APK is **78,274,463 bytes**, SHA-256 `4419dc82df187d9d0097c5989c1021be0c5619db88d10c86061411167b84d1f2`. [Permanent evidence](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-foss-build-evidence.zip) retains 23 checked entries, SHA-256 `7419f43d56ea70e01d91cedd9d7f58ec112dd3adf7a56e22e62c2fb9ea834b5a`. Original publisher signatures, protected content, four actual native module class definitions and 16 KiB alignment passed. TypeScript and 740 mobile tests passed, including 50 focused named checks in that same run.

Update [the existing request4667](https://gitlab.com/fdroid/rfp/-/work_items/4667). This independent publisher preview is **not** official catalog approval, F-Droid signing or a server reproducibility claim. Earlier candidate preparation below is preserved as historical context and does not supersede this current receipt.

The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40614354153) passed at the exact application source.

## Historical candidate preparation

## Verified 0.1.20 candidate

The current independent candidate is [0.1.20/code21](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.20), source [`c7f38c21755a4ff5f2b3bcac6ef463a66fb13608`](https://github.com/khushbakhtm-star/context/commit/c7f38c21755a4ff5f2b3bcac6ef463a66fb13608). Both phone editions and all twelve public evidence files match verified local sizes/digests. [Run 40601269959](https://github.com/khushbakhtm-star/context/actions/runs/40601269959), controller `33104a60c0cd625de782105755b6253f40b28ee3`, passed independent native and integrated recipe/APK scans. Structured source results: **0 errors, 0 warnings**, 7 information findings. Audits recorded 108 removals, 5 patches and 33 exact optional Wear-source removals.

The FOSS APK is **78,262,175 bytes**, SHA-256 `317cb8b6f0903333b7eaac09a66f9a01d9ed46cc5962b0d7509ba48a007220eb`. [Permanent evidence](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-foss-build-evidence.zip) retains 23 checked entries, SHA-256 `ee00d6fb3e627bf68f7cd790913f72fd31fc9979e578c1c86e577730a361e8c7`. Original publisher signatures, protected content, four actual native module class definitions and 16 KiB alignment passed. TypeScript and 719 mobile tests passed, including 43 focused named checks in that same run.

Update [the existing request4667](https://gitlab.com/fdroid/rfp/-/work_items/4667). This independent publisher preview is **not** official catalog approval, F-Droid signing or a server reproducibility claim. Earlier candidate preparation below is preserved as historical context and does not supersede this current receipt.

The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40602915532) passed at the exact application source.

## Historical candidate preparation

## Verified 0.1.19 candidate

The current independent candidate is [0.1.19/code20](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.19), source [`488b37e0c7bb2a07456af48a8f00b7ab3e3300ba`](https://github.com/khushbakhtm-star/context/commit/488b37e0c7bb2a07456af48a8f00b7ab3e3300ba). Both phone editions and all twelve public evidence files match verified local sizes/digests. [Run 40563208413](https://github.com/khushbakhtm-star/context/actions/runs/40563208413), controller `a5b0066a8c03b907d96b0ca2bdafc09cb62ef3ef`, passed independent native and integrated recipe/APK scans. Structured source results: **0 errors, 0 warnings**, 7 information findings. Audits recorded 108 removals, 5 patches and 33 exact optional Wear-source removals.

The FOSS APK is **78,225,311 bytes**, SHA-256 `a2becc79816355eac74b71ba264e577ca94e2b03819f7bae4531b6d85d8591fd`. [Permanent evidence](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-foss-build-evidence.zip) retains 23 checked entries, SHA-256 `1a39622d0695203842856d413ddc62196ad57435c5848b120ab6e18d191c090a`. Original publisher signatures, protected content, four actual native module class definitions and 16 KiB alignment passed. TypeScript and 675 mobile tests passed, including 40 focused named checks in that same run.

Update [the existing request4667](https://gitlab.com/fdroid/rfp/-/work_items/4667). This independent publisher preview is **not** official catalog approval, F-Droid signing or a server reproducibility claim. Earlier candidate preparation below is preserved as historical context and does not supersede this current receipt.

The [original tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40564739856) passed TypeScript and all 675 tests, then **failed upstream listing validation** because the immutable tag omitted changelogs/20.txt. [Main-branch metadata repair](https://github.com/khushbakhtm-star/context/commit/e4298e98f8f2c049e12874594a30c398a37b1016) adds only that changelog; a separate listing check passed. The complete mobile runtime subtree is unchanged. The tag and both APKs remain at 488b37e0c7bb2a07456af48a8f00b7ab3e3300ba; this is not a successful rerun of the original workflow.

## Historical candidate preparation

The owner authorized a public MIT source release and a request for F-Droid review. The current
verified source candidate is **0.1.17 / Android code 18**, pinned to
[`9fb9d951d1757631aa826f5cc132de8e7dfe4c30`](https://github.com/khushbakhtm-star/context/commit/9fb9d951d1757631aa826f5cc132de8e7dfe4c30).
Both independent build/scanner jobs passed; the publisher-signed FOSS preview and durable
source-to-DEX evidence are [public](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.17).
See [`FDROID_VERIFICATION.md`](FDROID_VERIFICATION.md) for exact receipts and preserved history.

The existing request is [Context RFP 4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
Update that request with current evidence instead of creating another. Independent verification
and a publisher release do **not** mean F-Droid has accepted, signed or listed the application.
Official inclusion assessment, server-toolchain approval, signing and catalog publication remain
pending; the published build candidate stays disabled.

## Prepared material

- `fastlane/metadata/android/en-US/` at the repository root contains the title, descriptions,
  version-code changelogs and a byte-for-byte copy of the approved Context logo.
- [`fdroid/metadata/com.context.minuteledger.yml`](../../../fdroid/metadata/com.context.minuteledger.yml)
  is the tested disabled 0.1.17/code18 candidate with the exact public source pin.
- `apps/mobile/fdroid/com.context.minuteledger.yml.template` is reusable scaffolding, with MIT,
  `Calendar & Agenda`, `Time Tracker` and `NonFreeNet` for optional Microsoft services. Generated
  template output is a draft, not a replacement for the exact tested recipe and its receipts.
- `apps/mobile/fdroid/prepare-submission.cjs` checks listing inputs and can generate a source-specific
  candidate under `tmp/fdroid-submission/<commit>/`. It does not publish source or contact F-Droid.

No screenshots have been supplied. Add only genuine captures from the installed native app under
`fastlane/metadata/android/en-US/images/phoneScreenshots/`; do not label a mockup as a capture.
Screenshots do not replace runtime testing or maintainer approval.

## Current public evidence

[Run 40490567930](https://github.com/khushbakhtm-star/context/actions/runs/40490567930), controller
`0e664023faafb73941015fca13fdd9cf9ff0e1c2`, passed metadata lint, structured source scanning
(**zero errors, zero warnings**), integrated F-Droid recipe/APK scanning, and separate unsigned
native assembly/APK scanning. Both jobs recorded 108 actual removals, five source patches and
21 exact optional Wear-source removals. The inventory reviews 28 packages and 109 removable
paths; the Windows-only input absent on Linux explains the difference.

Print, Sharing, Clipboard and the SDK-only calendar-color module were verified as actual APK
class definitions using the exact R8 mapping and generated registration evidence. The source
build uses no broad scanner exclusion: only the documented hash-verified official Linux Hermes
compiler exception remains.

The [FOSS preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-preview.apk)
is 78,213,023 bytes, SHA-256
`0ab23399d40c8a0f72a71889b2548ebb02ff7fa5909788027d2f26ca75562c8a`.
It uses the existing publisher certificate, with official v2/v3 signature verification, 16 KiB
alignment and protected-content preservation checks. It is not signed by F-Droid.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-build-evidence.zip)
contains 23 checked entries, 7,723,235 bytes, SHA-256
`82a6ea3fa543f22203bc48698567169b505248cf50b3b1ee74edc29921c85638`.
This preserves review evidence beyond expiring GitHub Actions artifacts.

The [source-tag workflow 40492679557](https://github.com/khushbakhtm-star/context/actions/runs/40492679557)
passed at the exact application source. TypeScript, 648 full-suite tests and 119 focused tests
passed. These checks do not establish physical phone gestures, live clipboard/calendar flows,
printing, two-phone behavior or independent-machine byte reproducibility.

## Release and request

Keep source, MIT license, approved assets, lockfile and listing public. Do not upload private
ledger exports, credentials, account tokens, keystores or generated working folders. The current
tag `v0.1.17` resolves to the source above and matches code18. Later application releases must
increase their version/build numbers; do not repoint a published tag to a new implementation.

From the repository root, listing validation remains available:

```sh
node apps/mobile/fdroid/prepare-submission.cjs --check
```

For later releases, supply actual public URLs and the exact locally available application commit
to the helper; review its generated draft against the tested recipe. The arguments below are
placeholders, not a ready-to-run publication command:

```sh
node apps/mobile/fdroid/prepare-submission.cjs --repo PUBLIC_HTTPS_REPOSITORY_URL --issues PUBLIC_ISSUES_URL --releases PUBLIC_RELEASES_URL --commit FULL_RELEASE_COMMIT_HASH
```

Verify anonymous cloning, the exact release tag and source/native identity independently. A helper
cannot prove a remote URL is public or that its intended commit is present. Use the existing RFP
for current receipts and reviewer questions. A later tested metadata merge request belongs in
[fdroiddata](https://gitlab.com/fdroid/fdroiddata); local generation creates neither a request nor
an accepted catalog listing.

## Official build review still needed

The independent Linux build is complete for this source, with Node 24.19.0, Corepack 0.36.0,
pnpm 11.25.0, Gradle 9.4.1, Android platform 37.0/Build Tools 37.0.0, NDK 27.1.12297006
and CMake 3.22.1. Approval/provisioning on F-Droid's official builders remains separate.
Retain the exact source pin and disabled flag in the public candidate while that review proceeds.

A reviewer can validate an isolated fdroiddata checkout with fdroidserver 2.4.5 and the current
candidate at `metadata/com.context.minuteledger.yml`, for example:

```sh
fdroid rewritemeta com.context.minuteledger
fdroid lint com.context.minuteledger
fdroid scanner --force --exit-code com.context.minuteledger:18
```

Only an ephemeral review/build copy removes `disable` when actually attempting the recipe.
Official server testing belongs to the maintainer-approved build environment:

```sh
fdroid build --server com.context.minuteledger:18
```

Preserve the complete dependency graph and exact sanitation audits. Optional Microsoft services
remain disclosed; local Android-calendar access and user-selected WebDAV remain alternatives.
The FOSS phone edition omits native Google sign-in and optional Wear transport. Source/native
packaging checks do not substitute for testing the installed app or approving its inclusion.

## Project age and actual users

The current inclusion policy asks for at least three months of active development, with exceptions
for demonstrated users, prior F-Droid app maintenance, or an event-specific application. This
project's available history does not establish those conditions. A request may ask reviewers for
guidance, but must not claim an exception or invent earlier maintenance or users. Record real
native-phone use and maintain the public project while review is pending.

All distributions currently share `com.context.minuteledger`. An APK signed by Expo/the owner and
one signed by F-Droid cannot update one another unless their signing identity is compatible.
Explain backup/migration before switching the installed channel.

## References

- [Submission quick start](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
- [Upstream listing formats](https://f-droid.org/docs/All_About_Descriptions_Graphics_and_Screenshots/)
- [Build metadata](https://f-droid.org/docs/Build_Metadata_Reference/)
- [Current categories](https://gitlab.com/fdroid/fdroiddata/-/blob/master/config/categories.yml)
- [Non-Free Network Services](https://f-droid.org/docs/Anti-Features/#NonFreeNet)
- [Inclusion policy](https://f-droid.org/docs/Inclusion_Policy/)
