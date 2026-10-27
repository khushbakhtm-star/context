# Independent F-Droid verification diagnostics

`.github/workflows/fdroid-verify.yml` runs without Expo, Google, Apple, or GitLab account secrets.
It runs when a `codex/fdroid-*` branch is pushed, with the commit check visible in its pull request.
Manual workflow dispatch is also available after the workflow exists on the default branch.
It checks the reviewed full `CONTEXT_SOURCE_COMMIT`, matching the candidate's commit, version,
and Android code to that checkout. A branch or tag cannot silently change the source.

## Verified 0.1.17 FOSS source candidate

[Final independent run 40490567930](https://github.com/khushbakhtm-star/context/actions/runs/40490567930)
passed both jobs against application source `9fb9d951d1757631aa826f5cc132de8e7dfe4c30`, using
FOSS controller `0e664023faafb73941015fca13fdd9cf9ff0e1c2`. The
[disabled tested recipe](https://github.com/khushbakhtm-star/context/blob/0e664023faafb73941015fca13fdd9cf9ff0e1c2/fdroid/metadata/com.context.minuteledger.yml)
retains that immutable source and Android code 18. Earlier evidence remains below, separate
from this run; no historical build is substituted for the current package checks.

The source adds explicit plain-text spreadsheet Paste, bottom text entry with two-step
save/format controls, contextual Group/Ungroup, color Reset and selected-cell dragging.
Day/Week columns stay fixed while pinching row height. Exact account/native ownership and
native write receipts guard detected external calendar changes; receiptless legacy links
can guard changed times but cannot reconstruct a missing earlier content snapshot.
TypeScript, **648 full-suite tests and 119 focused final tests** passed. These are source
checks, not a physical 0.1.17 clipboard, gesture, calendar-delivery or two-phone test.

All **17 metadata checks and 15 independent native checks** succeeded. Downloaded diagnostic
archives matched GitHub byte lengths and ZIP SHA-256 values, then ZIP CRC, immutable
source/version/code, recorded checks, exact sanitation inputs and optional Wear removal.

| Actual check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings, 7 informational entries** |
| Integrated F-Droid recipe and APK scan | Exit 0; exact 0.1.17/code18 source; 505.62 seconds |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 10m 4s` |
| Independent APK identity | `com.context.minuteledger` / 0.1.17 / code 18; minimum SDK 24, target SDK 36 |
| Unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Actual source sanitation in each job | 108 removed inputs, 5 source patches, 21 exact optional Wear-source removals |

The reviewed inventory contains **28 packages and 109 removable paths**. One Windows-only
macro executable is absent on Linux, so both actual audits record 108 removals. Print,
Sharing, Clipboard and Expo Android core/modules compile from source; the SDK-only
calendar-color bridge remains. The sole scanner exception is the documented hash-verified
official Linux Hermes compiler. No directory-wide scanner exclusion was added.

| Downloaded diagnostic artifact | ZIP bytes | Locally verified ZIP SHA-256 |
| --- | ---: | --- |
| [Metadata 12727973423](https://github.com/khushbakhtm-star/context/actions/runs/40490567930/artifacts/12727973423) | 4,501,810 | `609627b4bc44419517e7c05583f80955a27380591bebd7ea4ed7d32017755cac` |
| [Native 12728559057](https://github.com/khushbakhtm-star/context/actions/runs/40490567930/artifacts/12728559057) | 37,260,060 | `84f45f79a247582228e884ef08de004a8d8d1af770a7319a93cb80b7317c8a49` |

The public [durable build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-build-evidence.zip)
is **7,723,235 bytes**, ZIP SHA-256
`82a6ea3fa543f22203bc48698567169b505248cf50b3b1ee74edc29921c85638`.
Its 23-entry allowlist preserves 95,871,436 uncompressed bytes of actual native/integrated
R8 mapping, configuration, seeds and generated module registration, public provenance,
scanner/sanitation receipts and a per-file hash manifest. ZIP CRC and every manifest hash passed.
It excludes APKs, usage/full runtime logs, credentials, personal ledger data and desktop/private
paths. Public ephemeral GitHub runner comments remain unchanged in exact configuration bytes.

The exact R8 mapping resolves the required modules to inspected DEX `class_defs`, rather
than relying on JavaScript or DEX string presence:

| Original required module | Actual mapped class definition | APK DEX |
| --- | --- | --- |
| `expo.modules.print.PrintModule` | `Lf02;` | `classes.dex` |
| `expo.modules.sharing.SharingModule` | `Lfp2;` | `classes.dex` |
| `expo.modules.contextcalendarcolors.ContextCalendarColorsModule` | `Lgy;` | `classes.dex` |
| `expo.modules.clipboard.ClipboardModule` | `Lau;` | `classes.dex` |

The unsigned source-built APK is **78,112,344 bytes**, SHA-256
`b446d53fd1e2b53b95f6aa8f057349bdd377d770379d06db9c21810a9301eb8c`.
The published [publisher-signed FOSS preview](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-preview.apk),
asset 681323222, is **78,213,023 bytes**, SHA-256
`0ab23399d40c8a0f72a71889b2548ebb02ff7fa5909788027d2f26ca75562c8a`.
Official `apksigner` v2/v3 verification, 16 KiB alignment, custom v2 protected-content checks
and certificate continuity passed. The original publisher certificate SHA-256 remains
`44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`.
The signed package preserves the unsigned protected entry set and every original byte,
including runtime `META-INF/services`; only newly generated signature files are added.

The [public 0.1.17 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.17)
points to the exact application source above. Its
[exact source-tag workflow 40492679557](https://github.com/khushbakhtm-star/context/actions/runs/40492679557)
passed. All twelve public asset sizes/digests match the locally verified packages and receipts.
The FOSS edition and complete combined evidence were available by **2026-10-27 11:03:13 UTC**.
Public [native](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-fdroid-native-verification.json),
[metadata](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-fdroid-metadata-verification.json)
and [signed-package](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-apk-verification.json)
receipts retain the exact provenance.

These independent checks establish source-build and packaged scope. They do **not** establish
physical phone gestures, live calendar/clipboard behavior, independent-machine byte
reproducibility, official F-Droid provisioning, policy acceptance, signing or catalog listing.
The recipe stays disabled; the existing
[packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) remains the review route.
The separate watch companion is still 0.1.8, and no new iOS binary is announced.

## Verified 0.1.16 FOSS source candidate

[Final independent run 40415367808](https://github.com/khushbakhtm-star/context/actions/runs/40415367808)
passed both jobs against application source `7e43f1e59d389fdbcac2b057605d7928c0b22611`, using
FOSS controller `1aeef5f7d97d276a95fb8ada1113a91ffe4f893e`. The
[disabled tested recipe](https://github.com/khushbakhtm-star/context/blob/1aeef5f7d97d276a95fb8ada1113a91ffe4f893e/fdroid/metadata/com.context.minuteledger.yml)
retains that immutable source and Android code 17. Historical 0.1.15 evidence below remains
separate; its results are not substituted for this run.

This source publishes SQLite minute notes independently of provider requests and other dates.
Month/Schedule use separate bounded queues for ledger, local cache, native calendars and accounts.
Only a valid previously loaded account/day snapshot can supply offline calendar plans, scoped to
current consent, account identity, selected calendars and civil-day/timezone bounds. Account reads
have a 10-second caller deadline and a 60-second raw-request lease; later requests can supersede
stuck work, with identity guards rejecting obsolete results and protecting the replacement slot.
Print retains strict failure handling instead of silently treating cached plans as current.
TypeScript, **535 full-suite tests and 95 focused tests** passed. These are source checks, not a
physical 0.1.16 offline, phone-gesture or calendar-delivery test.

All **17 metadata checks and 15 independent native checks** succeeded. The downloaded diagnostic
archives were checked against GitHub's byte lengths and ZIP SHA-256 values, then ZIP CRC,
source/version/code, actual check results, exact sanitation inputs and optional Wear removal.

| Actual check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings, 7 informational entries** |
| Integrated F-Droid recipe and APK scan | Exit 0; exact 0.1.16/code17 source; 554.80 seconds |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 9m 54s` |
| Independent APK identity | `com.context.minuteledger` / 0.1.16 / code 17; minimum SDK 24, target SDK 36 |
| Unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Actual source sanitation in each job | 106 removed inputs, 5 source patches, 21 exact optional Wear-source removals |

The reviewed inventory still contains **27 packages and 107 removable paths**. The Windows-only
macro executable is absent on Linux, so each actual audit records 106 removals. Print, Sharing
and Expo Android core/modules compile from source; the SDK-only calendar-color bridge remains.
The sole scanner exception is the documented hash-verified official Linux Hermes compiler.

| Downloaded diagnostic artifact | ZIP bytes | Locally verified ZIP SHA-256 |
| --- | ---: | --- |
| [Metadata 12694913862](https://github.com/khushbakhtm-star/context/actions/runs/40415367808/artifacts/12694913862) | 4,480,970 | `1f6cd75cfecc8f42fd20996f842947f41950604964dd246e76483f14b2ce6c28` |
| [Native 12695008763](https://github.com/khushbakhtm-star/context/actions/runs/40415367808/artifacts/12695008763) | 37,204,453 | `6a5214c7b51a0503caf4b074f210be86673be0ab4d54577147812c3c3230add4` |

The public [durable build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.16/context-0.1.16-foss-build-evidence.zip)
is **7,683,764 bytes**, ZIP SHA-256
`758c9269d31b93eb064f36cfd0167406c9116d6e1c693c1194f62b11f942bf82`.
Its 23-entry allowlist preserves 95,375,890 uncompressed bytes of actual native/integrated R8
mapping, configuration, seeds and generated module registration, public provenance, scanner and
sanitation receipts, and a per-file hash manifest. ZIP CRC and every manifest hash passed.
It excludes APKs, usage/full runtime logs, credentials, personal ledger data and desktop/private
paths. Public ephemeral GitHub runner comments remain unchanged in exact configuration bytes.

The exact R8 mapping resolves the required modules to inspected DEX `class_defs`, rather than
relying on JavaScript or DEX string presence:

| Original required module | Actual mapped class definition | APK DEX |
| --- | --- | --- |
| `expo.modules.print.PrintModule` | `Lkz1;` | `classes.dex` |
| `expo.modules.sharing.SharingModule` | `Ljo2;` | `classes.dex` |
| `expo.modules.contextcalendarcolors.ContextCalendarColorsModule` | `Lqx;` | `classes.dex` |

The unsigned source-built APK is **78,042,996 bytes**, SHA-256
`b0c73ef512923a2e5dd059dde839b705c588177c1d66d29a617982e6303168f3`.
The published [publisher-signed FOSS preview](https://github.com/khushbakhtm-star/context/releases/download/v0.1.16/context-0.1.16-foss-preview.apk),
asset 679763077, is **78,143,335 bytes**, SHA-256
`f5b9bd54972329674afdae397b0eddddfff3ae2e63cac1a60523da5dfec3f6f1`.
Official `apksigner` v2/v3 verification, 16 KiB ZIP alignment, custom v2 protected-content checks,
and certificate continuity passed. The original publisher certificate SHA-256 remains
`44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`.
The signed package preserves the unsigned protected entry set and every original byte, including
runtime `META-INF/services`; only newly generated signature files are added.

The [public 0.1.16 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.16)
points to the application source above. Its [exact source-tag workflow 40416783638](https://github.com/khushbakhtm-star/context/actions/runs/40416783638) passed. Actual public asset sizes/digests match the local verified
artifacts and receipts. The FOSS edition became available at **2026-10-26 23:05:32 UTC**.
These independent checks establish the source-build and packaged scope;
they do **not** establish physical phone gestures, calendar/runtime behavior, independent-machine
byte reproducibility, official F-Droid provisioning, policy acceptance, signing or catalog listing.
The recipe remains disabled and the existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667)
remains the review route. The separate watch companion is still 0.1.8.

## Verified 0.1.15 FOSS source candidate

[Final independent run 40390963846](https://github.com/khushbakhtm-star/context/actions/runs/40390963846)
passed both jobs against application source `e34e2856d9449521560d316edb49c00d0bade5ab`, using
FOSS controller `487d879edfc1743a17701c8e01ba262ff3b6430e`. The
[disabled tested recipe](https://github.com/khushbakhtm-star/context/blob/487d879edfc1743a17701c8e01ba262ff3b6430e/fdroid/metadata/com.context.minuteledger.yml)
retains that immutable source and Android code 16. Historical 0.1.14 evidence below remains
separate; its results are not substituted for this run.

This source adds matching Dashboard/Print/Search/Settings menu icons and broadcasts a single
copied cell into a selected minute range, retaining its text, fill and formatting. TypeScript,
**509 full-suite tests and 69 focused tests** passed. These are source checks, not a physical
0.1.15 phone test.

All **17 metadata checks and 15 independent native checks** succeeded. The downloaded diagnostic
archives were checked against GitHub's byte lengths and ZIP SHA-256 values, then ZIP CRC,
source/version/code, actual check results, exact sanitation inputs and optional Wear removal.

| Actual check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings, 7 informational entries** |
| Integrated F-Droid recipe and APK scan | Exit 0; exact 0.1.15/code16 source; 604.15 seconds |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 12m 37s` |
| Independent APK identity | `com.context.minuteledger` / 0.1.15 / code 16; minimum SDK 24, target SDK 36 |
| Unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Actual source sanitation in each job | 106 removed inputs, 5 source patches, 21 exact optional Wear-source removals |

The reviewed inventory still contains **27 packages and 107 removable paths**. The Windows-only
macro executable is absent on Linux, so each actual audit records 106 removals. Print, Sharing
and Expo Android core/modules compile from source; the SDK-only calendar-color bridge remains.
The sole scanner exception is the documented hash-verified official Linux Hermes compiler.

| Downloaded diagnostic artifact | ZIP bytes | Locally verified ZIP SHA-256 |
| --- | ---: | --- |
| [Metadata 12685506010](https://github.com/khushbakhtm-star/context/actions/runs/40390963846/artifacts/12685506010) | 4,481,040 | `777c3ab3ad568dd5be876eb074a77af34e27879fa92195449c8892053389f3c2` |
| [Native 12686335809](https://github.com/khushbakhtm-star/context/actions/runs/40390963846/artifacts/12686335809) | 37,195,503 | `8ffc57179320ccdc5cad1ea54eae06d98ae7e515cb7bb3b24e858a923ec22ae0` |

The public [durable build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-build-evidence.zip)
is **7,682,938 bytes**, ZIP SHA-256
`14016c3a4d5a3f84f0ad1d50fa70b83dce9af72840483075b2df18d0870ffebb`.
Its 23-entry allowlist preserves 95,375,890 uncompressed bytes of actual native/integrated R8
mapping, configuration, seeds and generated module registration, public provenance, scanner and
sanitation receipts, and a per-file hash manifest. ZIP CRC and every manifest hash passed.
It excludes APKs, usage/full runtime logs, credentials, personal ledger data and desktop/private
paths. Public ephemeral GitHub runner comments remain unchanged in exact configuration bytes.

The exact R8 mapping resolves the required modules to inspected DEX `class_defs`, rather than
relying on JavaScript or DEX string presence:

| Original required module | Actual mapped class definition | APK DEX |
| --- | --- | --- |
| `expo.modules.print.PrintModule` | `Lkz1;` | `classes.dex` |
| `expo.modules.sharing.SharingModule` | `Ljo2;` | `classes.dex` |
| `expo.modules.contextcalendarcolors.ContextCalendarColorsModule` | `Lqx;` | `classes.dex` |

The unsigned source-built APK is **78,018,116 bytes**, SHA-256
`be3e8ebab4eda2fae880559a1a002c3c593e90f4ef1af32e26a7b2eed175522e`.
The published [publisher-signed FOSS preview](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-preview.apk),
asset 679330669, is **78,118,759 bytes**, SHA-256
`92f5c27fbbccbdf50e16ef59436f3b37dcdd11877dea7bf5bc30932e9a078d06`.
Official `apksigner` v2/v3 verification, 16 KiB ZIP alignment, custom v2 protected-content checks,
and certificate continuity passed. The original publisher certificate SHA-256 remains
`44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`.
The signed package preserves the unsigned protected entry set and every original byte, including
runtime `META-INF/services`; only newly generated signature files are added.

The [public 0.1.15 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.15)
points to the application source above. Actual public asset sizes/digests match the local verified
artifacts and receipts. The FOSS edition became available at **2026-10-26 20:12:17 UTC**.
These independent checks establish the source-build and packaged scope;
they do **not** establish physical phone gestures, calendar/runtime behavior, independent-machine
byte reproducibility, official F-Droid provisioning, policy acceptance, signing or catalog listing.
The recipe remains disabled and the existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667)
remains the review route. The separate watch companion is still 0.1.8.

## Verified 0.1.14 FOSS source candidate

[Final independent run 40384762580](https://github.com/khushbakhtm-star/context/actions/runs/40384762580)
passed both jobs against application source `a388cc8eeba09664cd6fe0a4dc52da07ab19184f`, using
FOSS controller `acf7e140316ac22e32ed5aca989c5b7945cc1335`. The
[disabled tested recipe](https://github.com/khushbakhtm-star/context/blob/acf7e140316ac22e32ed5aca989c5b7945cc1335/fdroid/metadata/com.context.minuteledger.yml)
retains that immutable source and Android code 15. Historical 0.1.13 evidence below remains
separate; its results are not substituted for this run.

All **17 metadata checks and 15 independent native checks** succeeded. The downloaded diagnostic
archives were checked against GitHub's byte lengths and ZIP SHA-256 values, then ZIP CRC,
source/version/code, actual check results, exact sanitation inputs and optional Wear removal.

| Actual check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings, 7 informational entries** |
| Integrated F-Droid recipe and APK scan | Exit 0; exact 0.1.14/code15 source; 628.63 seconds |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 8m 55s` |
| Independent APK identity | `com.context.minuteledger` / 0.1.14 / code 15; minimum SDK 24, target SDK 36 |
| Unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Actual source sanitation in each job | 106 removed inputs, 5 source patches, 21 exact optional Wear-source removals |

The reviewed inventory still contains **27 packages and 107 removable paths**. The Windows-only
macro executable is absent on Linux, so each actual audit records 106 removals. Print, Sharing
and Expo Android core/modules compile from source; the SDK-only calendar-color bridge remains.
The sole scanner exception is the documented hash-verified official Linux Hermes compiler.

| Downloaded diagnostic artifact | ZIP bytes | Locally verified ZIP SHA-256 |
| --- | ---: | --- |
| [Metadata 12680312413](https://github.com/khushbakhtm-star/context/actions/runs/40384762580/artifacts/12680312413) | 4,481,244 | `81ac72edb6328df580e137f150e73eeeb9707ed119248d19a57d3b767dc7dff7` |
| [Native 12680447150](https://github.com/khushbakhtm-star/context/actions/runs/40384762580/artifacts/12680447150) | 37,196,089 | `4c53a1a70c2211954b50c631999679297d652e56805dff90bfd619f110d5196e` |

The public [durable build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-foss-build-evidence.zip)
is **7,684,132 bytes**, ZIP SHA-256
`1b1735f794b7ce626699eabc9bcb4192a25d999dd90f0e15cc601dd1a70ccea7`.
Its 23-entry allowlist preserves 95,375,891 uncompressed bytes of actual native/integrated R8
mapping, configuration, seeds and generated module registration, public provenance, scanner and
sanitation receipts, and a per-file hash manifest. ZIP CRC and every manifest hash passed.
It excludes APKs, usage/full runtime logs, credentials, personal ledger data and desktop/private
paths. Public ephemeral GitHub runner comments remain unchanged in exact configuration bytes.

The exact R8 mapping resolves the required modules to inspected DEX `class_defs`, rather than
relying on JavaScript or DEX string presence:

| Original required module | Actual mapped class definition | APK DEX |
| --- | --- | --- |
| `expo.modules.print.PrintModule` | `Lkz1;` | `classes.dex` |
| `expo.modules.sharing.SharingModule` | `Ljo2;` | `classes.dex` |
| `expo.modules.contextcalendarcolors.ContextCalendarColorsModule` | `Lqx;` | `classes.dex` |

The unsigned source-built APK is **78,016,724 bytes**, SHA-256
`d2b1c52e81763060169af114e96b0f46fab945fa4ebc9df81ab44df92b7b0a4e`.
The published [publisher-signed FOSS preview](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-foss-preview.apk),
asset 679215007, is **78,114,663 bytes**, SHA-256
`64af76c4c98c45f2fe647f248f4258383ed26e117fda998aab9ab565321bda86`.
Official `apksigner` v2/v3 verification, 16 KiB ZIP alignment, custom v2 protected-content checks,
and certificate continuity passed. The original publisher certificate SHA-256 remains
`44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`.
The signed package preserves the unsigned protected entry set and every original byte, including
runtime `META-INF/services`; only newly generated signature files are added.

The [public 0.1.14 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.14)
points to the application source above. Actual public asset sizes/digests match the local verified
artifacts and receipts. These independent checks establish the source-build and packaged scope;
they do **not** establish physical phone gestures, calendar/runtime behavior, independent-machine
byte reproducibility, official F-Droid provisioning, policy acceptance, signing or catalog listing.
The recipe remains disabled and the existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667)
remains the review route. The separate watch companion is still 0.1.8.

## Verified 0.1.13 FOSS source candidate

[Final independent run 40351936739](https://github.com/khushbakhtm-star/context/actions/runs/40351936739)
passed both jobs against application source `4c92502370158dfd7422471d17ffff9c5e15f87f`, using
FOSS controller `9e942ea8929dca7c0031857ebc2bee3d4cf04fe4`. The controller adds read-only collection
of actual R8 mapping/configuration/seeds and generated module registration; it does not change
the application source or add keep rules. Superseded runs are not evidence for this candidate.

The downloaded metadata artifact and native artifact were checked locally against GitHub's
reported byte lengths and ZIP SHA-256 values, followed by ZIP CRC, exact source/version/code,
actual check results, reviewed input hashes and optional Wear-source removal verification.

| Actual check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | **0 errors, 0 warnings, 7 informational entries** |
| Integrated F-Droid recipe and APK scan | Exit 0; built 0.1.13 from the exact application commit above |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 12m 53s` |
| Independent APK identity | `com.context.minuteledger` / 0.1.13 / code 14; minimum SDK 24, target SDK 36 |
| Unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Actual source sanitation in each job | 106 removed inputs, 5 source patches, 21 exact optional Wear-source removals |

The reviewed inventory contains **27 packages and 107 removable paths**. The Windows-only
`@expo/modules-macros-win32-x64/ExpoModulesMacros.exe` input is absent on Linux, explaining the
106 actual removals. Print and Sharing add six reviewed unused publications/archives and compile
their Android modules from source. The SDK-only calendar-color bridge remains in the FOSS build.
The documented, hash-verified official Linux Hermes compiler is the sole scanner exception.

| Downloaded diagnostic artifact | ZIP bytes | Locally verified ZIP SHA-256 |
| --- | ---: | --- |
| [Metadata 12665516746](https://github.com/khushbakhtm-star/context/actions/runs/40351936739/artifacts/12665516746) | 4,481,311 | `10ab16d438d1cb9124ad51610739a8f6f1f7f23952d066145c937d05153cc2ab` |
| [Native 12665575835](https://github.com/khushbakhtm-star/context/actions/runs/40351936739/artifacts/12665575835) | 37,189,547 | `486a2bc648e0e8f156b59e1cec62eaefc2041eb9e43783142b0720c5abefcc07` |

The [durable build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.13/context-0.1.13-foss-build-evidence.zip)
is **7,683,399 bytes**, ZIP SHA-256
`794dc675595f7e92d1ade49e21782e587014eafc9d42b920de34a182a95cf46b`.
Its explicit 23-entry allowlist preserves 95,375,892 uncompressed bytes of exact native/integrated
R8 mapping, configuration, seeds and generated module registration, plus public provenance,
sanitation/scanner receipts and a per-file hash manifest. ZIP CRC and all manifest hashes were
independently checked. It contains no APK, usage/log output, credentials, personal ledger or
desktop/private paths. Public ephemeral GitHub runner location comments remain unchanged in the
configuration files; command paths are omitted from the public check-result summaries.

The native artifact's exact R8 mapping resolves these required modules to actual definitions in
the inspected APK. The checks parse DEX `class_defs`, table bounds and checksums; JavaScript or
DEX string presence alone is not used to establish native module presence.

| Original required module | Actual mapped class definition | APK DEX |
| --- | --- | --- |
| `expo.modules.print.PrintModule` | `Lkz1;` | `classes.dex` |
| `expo.modules.sharing.SharingModule` | `Ljo2;` | `classes.dex` |
| `expo.modules.contextcalendarcolors.ContextCalendarColorsModule` | `Lqx;` | `classes.dex` |

The actual unsigned FOSS APK is **78,006,692 bytes**, SHA-256
`97f669f4c8523574674f380dc15baabb1a1591429f0d566f0367f9ab976632f5`.
The locally verified publisher-signed preview is **78,106,471 bytes**, SHA-256
`3d2cf466e1a6e436c0adf2351c0ca33f0981fa02131c7d120c07a287772bdc41`.
Official `apksigner` v2/v3 verification, 16 KiB ZIP alignment, custom v2 protected-content checks
and original publisher-certificate continuity passed. The certificate SHA-256 is
`44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`.
The signed APK has exactly the unsigned protected entry set and bytes, including runtime
`META-INF/services` content; only newly generated signature files are added.

This source edition omits native Google sign-in and the Google-dependent Wear transport while
retaining Android calendar access. These checks do not establish physical phone behavior,
byte-for-byte reproducibility across independent machines, official F-Droid server provisioning,
inclusion-policy eligibility, maintainer acceptance, F-Droid signing or catalog publication.
The disabled metadata remains a review candidate in the existing
[packaging request](https://gitlab.com/fdroid/rfp/-/work_items/4667).

## Refreshing later FOSS candidates

After a later application commit is public:

1. Set `CONTEXT_SOURCE_COMMIT` in `.github/workflows/fdroid-verify.yml` and the single build's
   `commit` in `fdroid/metadata/com.context.minuteledger.yml` to that same full immutable hash.
   Set the metadata version/code and CurrentVersion fields to that release's exact values, keep `disable`, and
   replace old verification claims with a pending receipt. Keep the accepted scanner exception
   and toolchain pins unchanged unless new diagnostics establish a necessary change.
2. Commit the controller separately, push it, and dispatch **F-Droid independent source
   verification** at that controller ref. A `codex/fdroid-*` branch push also starts both jobs.
   This workflow needs no Expo quota and has no signing or publication step.
3. Require success from both `metadata` and `native`. Inspect the structured source findings
   in addition to process exits: fdroidserver 2.4.5 source mode can return zero despite errors.
   Check the integrated build/APK scanner, independent assembly/APK scanner, exact package
   identity, actual input audit and Wear-pruning receipt. Retain the provenance and exact logs.
4. The native diagnostics contain an unsigned FOSS APK. Download and hash its actual bytes,
   align and sign a separate preview copy with the established publisher key, then verify its
   package/version/code, certificate continuity and signature. An official F-Droid release
   requires F-Droid's own review, build, signing and catalog publication.
5. Update this receipt and the existing [packaging request](https://gitlab.com/fdroid/rfp/-/work_items/4667)
   with only the results actually observed. Request maintainer guidance or submit a tested
   fdroiddata merge request as appropriate; do not open a duplicate packaging request.

Both diagnostic artifacts are uploaded even on failure. The expected names are
`context-fdroid-metadata-diagnostics` and `context-fdroid-native-diagnostics`; their `results.json`,
`provenance.json`, logs, source scanner summary and input/removal audits identify their scope.
An unsigned artifact or successful GitHub run does not establish an official F-Droid listing.

## Verified 0.1.8 editions and exact source provenance

The [0.1.8 public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.8)
was published on 2026-10-25 at **23:54:13 UTC** (release 423736509). The public tag resolves to
`7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24`, the final source used for the published phone/FOSS
builds. The watch build used `d84fcacbd0484954f5c715b8976c37ba70e9c2fc`; a reviewed Git diff
confirms its watch compilation inputs are unchanged in the final tag. The actual watch build
source is kept explicit rather than attributed to another revision. Earlier ca49 candidate builds
and their CI are not substituted for the final phone/FOSS release.

[Final independent CI 40245685971](https://github.com/khushbakhtm-star/context/actions/runs/40245685971)
completed **SUCCESS** against final source `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24`, controlled by
`994a269bbe1f861d9dcb318aa871a57a11efa0d5`. Both jobs explicitly assert that the 21 mandatory
hash-reviewed optional Wear source inputs are removed before FOSS autolinking/scanning. Earlier
releases' dependency-cleanup/scanner counts are not used as findings for this run.

### Exact final FOSS CI checks and artifact scope

The decoded logs for metadata job `121326637622` and native job `121326637769` were read for
that final run. They record the following actual results:

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | Exit 0; report contains **0 errors and 0 warnings** |
| Normal integrated F-Droid build | Exit 0; built final source `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24` / 0.1.8; integrated APK scan passed |
| Independent unsigned assembly | Exit 0; `BUILD SUCCESSFUL in 12m 26s` |
| Independent native package identity | `com.context.minuteledger` / 0.1.8 / code 9 |
| Independent unsigned signature check | Expected exit 1 |
| Independent APK binary scanner | Exit 0 |
| Mandatory Wear-source pruning | Both jobs assert all 21 required inputs are removed |

GitHub's API reports these diagnostic archive sizes and SHA-256 digests:

- [Metadata artifact 12618753467](https://github.com/khushbakhtm-star/context/actions/runs/40245685971/artifacts/12618753467): 49,411 bytes; API-reported ZIP SHA-256 `d3c88eddb6367e63a97df1460c287428bf10c6ec5fdf8176d4c6e29120fdd113`.
- [Native artifact 12619260247](https://github.com/khushbakhtm-star/context/actions/runs/40245685971/artifacts/12619260247): 32,608,379 bytes; API-reported ZIP SHA-256 `2c4ad9ca878864c0901e022a439faa708a254e184f03f89bd331d1c1fda75d0a`.

Those archive digests were **not independently verified by a local download**. Critical check
results above were verified from the decoded job logs. No actual unsigned-APK SHA-256, source
informational-entry count, or old 100-removal/five-patch baseline is claimed for this run. Archive
ZIP digests are not APK digests. The separately downloaded signed APK checks below have their own
local verification scope.

The [exact v0.1.8 tag workflow 40246819174](https://github.com/khushbakhtm-star/context/actions/runs/40246819174)
completed **SUCCESS** at final source `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24`. This does not
establish an official store/F-Droid publication or physical watch validation.

### Published APK identities and hashes

All three APKs have package `com.context.minuteledger`, version 0.1.8 and publisher certificate
SHA-256 `44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`, matching 0.1.7.
The phone APKs use native code 9; the watch uses native code 100009 and declares the required
`android.hardware.type.watch` feature with a phone companion. The verified minimum SDK is 24 for
both phone editions and 30 for the watch; all three target SDK 36.

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [FOSS phone](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-foss-preview.apk), asset 676456994 | 77,716,460 | `b10b831c2d880921a511d5106d1b5ebb1ff6345aecbbd6ef7826520e1cd4bfb7` |
| [Wear-enabled phone](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-phone-preview.apk), asset 676456851 | 78,425,067 | `b0bf558a37bef8ad0f5f01033c4b68f476482c571fe6193b9e3fb211aa416ba6` |
| [Wear OS watch](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-preview.apk), asset 676456980 | 5,847,126 | `4ff818bc7ae11a173b9643bc31fd7b95a884f2cc8c9e03b5fb73d8c51d901d1f` |

Public asset sizes/digests were checked against the actual inspected APKs. ZIP CRC/native manifest
checks passed. Custom APK Signature Scheme v2 verification passed signed-data signatures,
certificate/public-key binding, algorithm-list consistency and protected-content digests for all
three. This is stronger evidence than certificate continuity alone, but remains distinct from
Android's official `apksigner`; local v1/v3/v4 and full official signature verification were not
performed. Installation/device compatibility and runtime behavior are separate checks.

### Actual native builds and packaged feature checks

| Edition / actual source | EAS build | Finished (UTC, 2026-10-25) | Observed native evidence |
| --- | --- | --- | --- |
| Wear phone / final `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24` | `52359721-3d51-4931-a95f-33828caae032` | 23:47:00.068 | Native bridge compiled, R8 and release assembly passed; build 8m 17s |
| FOSS phone / final `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24` | `6ea17de5-467e-41da-b718-4fa1d28cb835` | 23:47:59.377 | Finished APK passed the FOSS identity and absence checks below |
| Wear watch / `d84fcacbd0484954f5c715b8976c37ba70e9c2fc` | `8bc35262-7b03-420f-a71b-ce1224770328` | 23:36:26.684 | Native `:wear:test :wear:assembleRelease` passed; build 2m 36s |

The Wear-phone native manifest contains the exported listener with its expected Data Layer filter.
Stable exported ContextWear module/method literals remain in DEX, with verified R8 renaming of the
original helper/module classes. Its Expo bundle is 2,165,592 bytes, SHA-256
`77c8f91af59111ea9f2ee86f68df5af19af5c9e8d0301dd75d85274985c59c23`; the requested consent,
sync, conflict-review and `standalone-wear` markers are present. Embedded distribution `store`
is expected for this edition; its separately compiled update channel is `standalone-wear`.

The FOSS APK embeds distribution `fdroid` and has no ContextWear listener, Wear module/API literals,
Google Wear transport, native Google sign-in, Install Referrer or development-launcher markers in
the inspected DEX. Its publisher-signed preview channel remains `standalone`; embedded distribution
and update channel are distinct. The native watch has its expected launcher/activity/service,
Data Layer receiver filter and implementation markers. It is a native watch APK without an Expo
JavaScript bundle. These presence/absence checks establish packaged contents, not physical watch
behavior.

The optional Wear phone/watch pair depends on Google Play services. The F-Droid source preparation
removes its exact reviewed source files; it does not retain that transport through a scanner
exception. FOSS users retain the ledger/calendar features. An eventual official F-Droid-signed
phone has a different signer and cannot pair with this publisher-signed watch under the Data
Layer's same-package/same-signer requirement.

### Later human phone observation and physical-watch limit

The earlier 0.1.7 receipt recorded S23 calendar visibility as unconfirmed at that time. The user
later ran Check connection, reported **eight timed events**, then confirmed those events appeared
in Today. This resolves that reported 0.1.7 blank-calendar test on the S23. Preserve the original
receipt as its historical state; do not transfer this observation to an unperformed 0.1.8 or
Galaxy Watch7 physical test.

Watch access defaults off and requires explicit paired-watch consent. The watch can journal notes
offline; the native phone inbox can retain them while the app is closed, and JavaScript applies
guarded ledger transactions when Context runs. Conflicts retain alternatives for review. Native
unit/assembly, protocol tests, marker checks and signatures do not verify typing/dictation, bezel
scrolling, reconnection, midnight/date navigation or paired-device conflict handling on hardware.
**Physical Galaxy Watch7 validation remains pending.** Official F-Droid build-server provisioning,
signing, inclusion/acceptance and catalog publication also remain pending. No byte-for-byte
reproducibility or official store availability is established by these publisher-signed previews.

## Historical verified phone 0.1.7 outcome

[Run 40240522368](https://github.com/khushbakhtm-star/context/actions/runs/40240522368) passed both jobs
for **Context phone 0.1.7, Android version code 8**:

- Application source: `d7cf4d61b7b7e175c18d91693027bde33fef8490`.
- Verification controller: `5bfca0eb2f4fb505673ccc7ef5db91f3a1be0588`.
- Public tagged source and signed preview: [v0.1.7](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.7), published on 2026-10-25 at 22:46:20 UTC.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | 0 errors, 0 warnings, 7 informational entries |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; exact 0.1.7 source, 795.53 seconds |
| Integrated APK scan | Exit 0 |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 12m 50s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.7`, code `8` |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

All **17 metadata checks and 15 independent native checks** passed. Both actual input audits
recorded **100 removed files and five narrow source patches**, with the sole hash-pinned official
Linux Hermes compiler exception. Its SHA-256 is
`44d76b1e385b6584380e95e5c63d9f98a4f812cd3cc7aa0500bacd3c39fe0987`.
The seven source informational entries comprise that exception and six normal Gradle-wrapper
removals. No directory-wide exclusion, skipped scan, or official build-server acceptance is claimed.

- [Metadata/integrated artifact 12617008779](https://github.com/khushbakhtm-star/context/actions/runs/40240522368/artifacts/12617008779): 47,491 bytes; ZIP SHA-256 `8afef1ceeb3a1735f8a4c9113e2fe3d44542eba61e5c6bb9859da699abb78678`.
- [Independent native artifact 12617023909](https://github.com/khushbakhtm-star/context/actions/runs/40240522368/artifacts/12617023909): 32,589,263 bytes; ZIP SHA-256 `0cb6c9f478372015ca39b78bea1dc17956a3360e0fd03b9cf7793e6ac128628f`.
- Unsigned diagnostic APK: 77,660,500 bytes; SHA-256 `5f89e6c444b888468532676f8dd9c5c4ba6e96a90e2762164a3d9babc9ec3583`.

The separately signed [standalone preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.7/context-0.1.7-foss-preview.apk)
is 77,672,804 bytes, SHA-256 `67e36f7b84ed0366a36e9c25e3baf8c57b44cfc8e690290061ad771551dd131c`.
The public tag resolves directly to the application source above. The preview's configuration and
native-marker checks passed, and its v2 signing certificate matches public 0.1.6. Certificate
continuity is not full cryptographic signature validation. The signed preview is distinct from the
unsigned diagnostic artifact and any official F-Droid build.

Its `assets/index.android.bundle` is 2,111,352 bytes, SHA-256
`b9db6abab5d576df9ad5ebe5738ca4cd3cbc89ebe24bb5ab1a8d6217b7ecdcef`.
Four expected cell-action markers and five modern calendar-reader/diagnostic strings were found;
the unsigned bundle passes the same marker checks. These confirm packaged contents, not successful
use on a physical phone. The signed EAS build `8a602959-ae35-436a-8254-ac033ec511bb` finished on
2026-10-25 at 22:39:29.085 UTC; its build log reported success in 8m 26s. That separate build's duration
is not the independent diagnostic assembly duration.

TypeScript, all **226 app tests**, five release guards, and upstream listing validation passed.
The [v0.1.7 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40241739878)
also passed at that exact phone source.

This release adds compact floating Cut / Copy / Auto fill / Clear actions, a private in-app clipboard,
and cross-date Paste. Occupied destinations require replacement confirmation tied to the reviewed
contents; Cut guards the original source, moves both dates atomically, and supports session Undo.
Today/Day resets to one full day, and drag mapping accounts for the captured grip offset. Android
opens the calendar editor in a separate app task. The Android reader serializes per-calendar reads,
uses modern overlap handling, and preserves readable calendars when another fails. Settings exposes
local counts/errors and available visibility/synchronization flags without event titles or descriptions.

The user reported that the checked calendar remained blank on an S23 using 0.1.6. Successful calendar
visibility on 0.1.7 remains **unconfirmed**; the physical-phone question is pending. Native build,
scan, tests, and marker checks do not confirm that this real-device issue is fixed. Physical QA and
official F-Droid acceptance/publication remain separate. This receipt covers phone 0.1.7; separate
0.1.8 watch-companion development is not included in this source or APK.

These independent Ubuntu-toolchain results do not establish byte-for-byte reproducibility, use of
F-Droid's official server/VM, official signing, acceptance, or catalog publication. Updates belong
on existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667). Diagnostic
artifacts expire after 30 days; source pins, hashes, and observed results remain recorded here.

## Historical verified 0.1.6 outcome

[Run 40236099682](https://github.com/khushbakhtm-star/context/actions/runs/40236099682), completed on
2026-10-25, passed both jobs for **Context 0.1.6, Android version code 7**:

- Application source: `36d94201013d51e41dc0ad4b3814c5ff6d736b7f`.
- Verification controller: `d89828858dedf3c311f54ed3473431a19b217685`.
- Public tagged source and signed preview: [v0.1.6](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.6), published on 2026-10-25 at 21:45:41 UTC.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | 0 errors, 0 warnings, 7 informational entries |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; built the exact final 0.1.6 source commit (783.05 seconds) |
| Integrated APK scan | Exit 0 |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 12m 16s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.6`, code `7` |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

All **17 metadata checks and 15 independent native checks** passed.
The Linux input audit records **100 removed files and 5 narrow source patches**.
Both actual input audits confirm those counts. The sole hash-checked official Linux Hermes compiler exception and six normal Gradle-wrapper removals account for the seven source informational entries. Its retained compiler SHA-256 is `44d76b1e385b6584380e95e5c63d9f98a4f812cd3cc7aa0500bacd3c39fe0987`. The wrapper script, batch file, and JAR were absent before the successful normal integrated build. No broad scanner exclusion or skipped scan was added.

- [Metadata/integrated-build artifact 12615252744](https://github.com/khushbakhtm-star/context/actions/runs/40236099682/artifacts/12615252744): 47,502 bytes; ZIP SHA-256 `ae7a5341b4761b85ea083143d55b5b83f7ea65f7fb5857473b56a07799f1ff83`.
- [Independent native artifact 12615337394](https://github.com/khushbakhtm-star/context/actions/runs/40236099682/artifacts/12615337394): 32,567,398 bytes; ZIP SHA-256 `7672c5ff695d63513dea103d8176fdeee6cc5247c988576826ed924224a37194`.
- Unsigned diagnostic APK: 77,591,624 bytes; SHA-256 `49146a6356ee900dbab163baccf4562d7d0ec8b62234920a7778c1ff74380e48`.

The separately signed [standalone preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.6/context-0.1.6-foss-preview.apk)
is 77,603,928 bytes, SHA-256 `6e238e0eb9e4cf294c452f75194470c23650b5c5762b9524d5eb036d0aad2f8a`.
Signed preview ZIP integrity, embedded com.context.minuteledger / 0.1.6 / code 7, configured FOSS distribution, and forbidden native-marker checks passed. Its v2 signing certificate matches the public 0.1.5 preview. A certificate continuity check is not full cryptographic signature
validation. This signed preview is distinct from the unsigned diagnostic artifact and any official
F-Droid build.

The signed APK's `assets/index.android.bundle` is 2,042,476 bytes, SHA-256
`ec13b315be35ede6b62252b2956aff67c8a268510931dc3757b53159d32c3b55`.
Three expected drag-selection/calendar-connection markers were found using ASCII/UTF-8 and
UTF-16LE checks. The unsigned diagnostic APK also passes all three markers. These checks confirm bundle contents,
not successful use on a physical phone.

TypeScript, all **201 app tests**, five release guards, and upstream listing validation passed.
The [v0.1.6 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40236999059) passed at final source `36d94201013d51e41dc0ad4b3814c5ff6d736b7f`. Store publication jobs were readiness-gated and skipped.
The calendar fix requires read access and an explicitly selected, available phone calendar before
opening the native editor, provides Settings guidance, waits for the editor return, and refreshes
plans afterward. Refresh retries are bounded at one/four seconds; foreground return and a 15-second
visible-Today poll also reload device plans. No calendar is automatically selected.

The original cell's corner handle selects a same-day range upward or downward with edge scrolling;
release opens Auto fill / Group. Auto fill copies exact recorded source text to inclusive endpoints
without requiring a color. Source activity color and formatting are retained unless another Google
activity color is chosen. Copied minutes remain independently editable and support session Undo.
An untouched calendar plan title is not recorded source text; enter or record the source minute
first. A blank source with an explicit color preserves existing target notes. Group retains notes.
Physical-phone validation remains pending.

These are independent Ubuntu-toolchain build and scan results. They do not establish byte-for-byte
reproducibility, physical-phone QA, use of F-Droid's official server/VM, official signing, acceptance,
or catalog publication. Updates belong on existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
Diagnostic artifacts expire after 30 days; source pins, hashes, and observed results remain recorded here.

## Historical verified 0.1.5 outcome

[Run 40217570243](https://github.com/khushbakhtm-star/context/actions/runs/40217570243), completed on
2026-10-25, passed both jobs for **Context 0.1.5, Android version code 6**:

- Application source: `87cc9df388e4350a51e5e6fc07bcf7a19447c600`.
- Verification controller: `8aa08423a746b0cc6fd57032fa7b2c2e64ec429b`.
- Public tagged source and signed preview: [v0.1.5](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.5), published on 2026-10-25 at 17:54:11 UTC.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | 0 errors, 0 warnings, 7 informational entries |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; built the exact final 0.1.5 source commit (828.97 seconds) |
| Integrated APK scan | Exit 0 |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 11m 46s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.5`, code `6` |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

All **17 metadata checks and 15 independent native checks** passed.
The Linux input audit records **100 removed files and five narrow source patches**. The sole
hash-checked official Linux Hermes compiler exception and six normal Gradle-wrapper removals account
for the seven source informational entries. The wrapper script, batch file, and JAR were absent
before the successful normal integrated build. No broad scanner exclusion or skipped scan was added.

- [Metadata/integrated-build artifact 12608720370](https://github.com/khushbakhtm-star/context/actions/runs/40217570243/artifacts/12608720370): ZIP SHA-256 `fa0ec5a63329268bde54a352d4a87474ffac35c3ad484fc3994af74f5ac1f179`.
- [Independent native artifact 12608363201](https://github.com/khushbakhtm-star/context/actions/runs/40217570243/artifacts/12608363201): 32,559,343 bytes; ZIP SHA-256 `60a5e15d28905ef06c87f4047e40be547c199639d645f3e3e0f3ad63d9ea9736`.
- Unsigned diagnostic APK: 77,578,252 bytes; SHA-256 `6d027f10150fe3e7c8acc8981563079374fcc9da42d200bf7ae6362b8c5dea0e`.

The separately signed [standalone preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.5/context-0.1.5-foss-preview.apk)
is 77,590,552 bytes, SHA-256 `2b112699c91a657d15fb0c15d7a30781b46dd962282487fecb9b6369c98fe176`.
Signed preview ZIP integrity, embedded `com.context.minuteledger` / 0.1.5 / code 6, configured FOSS
distribution, and forbidden native-marker checks passed. Its v2 signing certificate matches the
public 0.1.4 preview. A certificate continuity check is not full cryptographic signature
validation. This signed preview is distinct from the unsigned diagnostic artifact and any official
F-Droid build.

TypeScript, all **183 app tests**, five release guards, and upstream listing validation passed.
The [v0.1.5 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40218692984)
passed at final source `87cc9df388e4350a51e5e6fc07bcf7a19447c600`. Store publication jobs were
readiness-gated and skipped.
Activity/group color choices use the 21 documented CalendarApp.Color values as an offline fallback
plus exact imported Google API palette and label colors. This does not claim to enumerate the current
24-color event picker. Historical activity colors remain intact, and text formatting keeps its own
palette. Activity cells have solid fills with readable foregrounds. The first tap types inline, the
second opens color/details; long-press an inactive cell and choose an endpoint for Auto fill / Group.
Today's date jumps to the current minute. The measured time column supports a saved 12-hour/24-hour
setting. With no minute selected, **+** opens the phone calendar's new-event form and
its date picker; with a selected minute, the editing bar's **+** opens Auto fill / Group.
Physical-phone validation is pending.

These are independent Ubuntu-toolchain build and scan results. They do not establish byte-for-byte
reproducibility, physical-phone QA, use of F-Droid's official server/VM, official signing, acceptance,
or catalog publication. Updates belong on existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
Diagnostic artifacts expire after 30 days; source pins, hashes, and observed results remain recorded here.

## Historical verified 0.1.4 outcome

[Run 40208555966](https://github.com/khushbakhtm-star/context/actions/runs/40208555966), completed on
2026-10-25, passed both jobs for **Context 0.1.4, Android version code 5**:

- Application source: `95050ec1956ee78ee1fbf98bf6df8c6c3067cbe9`.
- Verification controller: `309142bbb2e4e8f806cee4f05a10f43144d90bd5`.
- Public tagged source and signed preview: [v0.1.4](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.4), published on 2026-10-25 at 15:58:12 UTC.

| Check | Observed result |
| --- | --- |
| Metadata lint | Exit 0 |
| Structured source scanner | 0 errors, 0 warnings, 7 informational entries |
| Normal integrated `fdroid build --test --stop --scan-binary` | Exit 0; built the exact 0.1.4 source commit |
| Integrated APK scan | Exit 0 |
| Independent unsigned Gradle assembly | Exit 0; `BUILD SUCCESSFUL in 8m 22s` |
| Independent APK identity | `com.context.minuteledger`, version `0.1.4`, code `5` |
| Independent signature check | Expected unsigned result, exit 1 |
| Independent APK binary scan | Exit 0 |

All **17 metadata checks and 15 independent native checks** passed.
The Linux input audit records **100 removed files and five narrow source patches**. The sole
hash-checked official Linux Hermes compiler exception and six normal Gradle-wrapper removals account
for the seven source informational entries. Wrappers were absent before the successful normal
integrated build. No broad scanner exclusion or skipped scan was added.

- [Metadata/integrated-build artifact 12604437989](https://github.com/khushbakhtm-star/context/actions/runs/40208555966/artifacts/12604437989): 47,466 bytes; ZIP SHA-256 `a4b8e88295e8ca86f87d5a354248a8e145cbd3cb30de363eca00e3461c105b01`.
- [Independent native artifact 12605201922](https://github.com/khushbakhtm-star/context/actions/runs/40208555966/artifacts/12605201922): 32,550,255 bytes; ZIP SHA-256 `a9f4666bc4da4caad1774c614c44479da47c0980a678f8057c54dca7a968cfb5`.
- Unsigned diagnostic APK: 77,553,624 bytes; SHA-256 `602b872210275e8d7912cbeee53e1b21d59432cfbced6d1f43d8d83a3a36150a`.

The separately signed [standalone preview APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.4/context-0.1.4-foss-preview.apk)
is 77,565,928 bytes, SHA-256 `41e7110867ff3bb02358fafb17cd3389ce598b89b43e37acb48a5cff4e4e1144`.
ZIP integrity, embedded `com.context.minuteledger` / 0.1.4 / code 5, configured FOSS distribution,
and forbidden native-marker checks passed. The v2 signing certificate matches the published 0.1.3
preview. A signing-certificate continuity check is not full cryptographic
signature validation. This signed preview is distinct from the unsigned diagnostic artifact and
any official F-Droid build.

TypeScript, all **169 app tests**, five release guards, and upstream listing validation passed.
The [v0.1.4 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40209430440)
also passed at that immutable source. Store publication jobs were readiness-gated and skipped.
This update groups several minutes under one activity title and color while preserving each
minute's independent, directly editable note. The selected final minute is included; blank grouped
minutes also count toward the activity. Physical-phone validation is pending. Undo restores Context
entries within the editing session; calendar and invitation effects may need separate review.

These are independent Ubuntu-toolchain build and scan results. They do not establish byte-for-byte
reproducibility, physical-phone QA, use of F-Droid's official server/VM, official signing, acceptance,
or catalog publication. Updates belong on existing [packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
Diagnostic artifacts expire after 30 days; source pins, hashes, and observed results remain recorded here.

## Historical verified 0.1.3 outcome

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
fdroid scanner --force --exit-code --json com.context.minuteledger:9
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
fdroid build --test --stop --scan-binary com.context.minuteledger:9
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
| Latest verified FOSS/phone source | Public commit `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24` (0.1.8/code 9) |
| Published watch build source | Public commit `d84fcacbd0484954f5c715b8976c37ba70e9c2fc` (0.1.8/code 100009; reviewed watch inputs unchanged in final tag) |
| Prior verified app source | Public commit `d7cf4d61b7b7e175c18d91693027bde33fef8490` (0.1.7/code 8) |
| Prior verified app source | Public commit `36d94201013d51e41dc0ad4b3814c5ff6d736b7f` (0.1.6/code 7) |
| Prior verified app source | Public commit `87cc9df388e4350a51e5e6fc07bcf7a19447c600` (0.1.5/code 6) |
| Prior verified app source | Public commit `95050ec1956ee78ee1fbf98bf6df8c6c3067cbe9` (0.1.4/code 5) |
| Prior verified app source | Public commit `761264dab4880b91843d6a500591de9c73a9f9f5` (0.1.3/code 4) |
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
