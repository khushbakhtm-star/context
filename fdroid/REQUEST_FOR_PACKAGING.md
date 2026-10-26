# Packaging review: Context (com.context.minuteledger)

## Source and release

- Source: https://github.com/khushbakhtm-star/context
- Issue tracker: https://github.com/khushbakhtm-star/context/issues
- Releases: https://github.com/khushbakhtm-star/context/releases
- Candidate: 0.1.15 FOSS phone (Android version code 16)
- Immutable source: e34e2856d9449521560d316edb49c00d0bade5ab
- Published source tag and Android preview: https://github.com/khushbakhtm-star/context/releases/tag/v0.1.15
- Signed preview APK: https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-preview.apk
- Preview APK SHA-256: `92f5c27fbbccbdf50e16ef59436f3b37dcdd11877dea7bf5bc30932e9a078d06`
- Release publication: 2026-10-26 at 20:07:42 UTC; signed FOSS APK size 78,118,759 bytes
- FOSS preview availability: 2026-10-26 at 20:12:17 UTC; asset 679330669
- License: MIT
- Summary: Capture your day minute by minute alongside your calendars

This is a new public project requesting packaging review and an inclusion-policy
assessment. It is not an accepted F-Droid app. The 0.1.15 source tag and signed FOSS
Android preview are public. Both independent source-build verification jobs passed
for the exact current candidate. Historical receipts remain below.

## Application and edition

Context implements a local minute-by-minute activity ledger, activity
colors, reports for day/week/month/year, Android device-calendar access, and
optional encrypted ledger synchronization through a dedicated HTTPS WebDAV folder.
The current source also includes day/three-day/week minute views, light/dark
appearance, inline text entry, cell formatting, session undo/redo, same-day range
fill/clear, and zoom. Multiple minute cells can share one activity title and
color while each keeps its own independently editable note; blank grouped minutes
count toward that activity. Calendar and storage access require user consent. Undo restores
Context entries and formatting; effects already sent to calendars or invitations
can need separate review.

Activity/group color choices use the 21 documented CalendarApp.Color values as an
offline fallback plus exact imported Google API palette and label colors. This is
not a claim to enumerate the current 24-color event picker. Historical activity
colors remain intact; text formatting keeps its separate palette. Activity cells
use a solid color fill with a readable foreground. A single tap selects a cell and a
double tap edits inline, with native partial-text selection. Holding a cell after
editing or releasing a dragged range opens compact floating clipboard, AutoFill,
Group, Clear and formatting actions. The action overlay is outside the grid scroll
responders. The binder single tap requests Now in the current view, a double tap
opens view choices, and a long press opens Pick/Range date selection. A measured time
column supports a saved 12-hour/24-hour preference. With no minute selected, **+**
requires calendar read access and an available phone calendar explicitly checked in
Settings; missing setup opens connection guidance without selecting calendars for
the user. Android opens its calendar event editor in a separate app task. Returning
to Context refreshes plans, with bounded retries after one and four seconds; Today
also polls device plans every 15 seconds while visible. The event must be saved in
a checked calendar, and provider synchronization can still take time.

A selected cell's corner handle drags up/down in the same day with edge scrolling;
release opens the floating cell actions. Auto fill copies the original recorded text to the
inclusive range without requiring a color, retaining the source activity/formatting
unless another Google activity color is chosen. Each copied minute remains editable;
Undo restores target contents within the editing session. A calendar plan's untouched
title is not recorded source text and must be entered or recorded first. With a blank
source, an explicit color-only fill preserves target notes. Group retains each note.
Cut or Copy uses a private in-app clipboard; after navigating to another date/minute,
Copying one cell and pasting into an explicitly selected minute range broadcasts
its text, fill and formatting to each selected minute in one guarded, undoable
transaction. Cut retains its move semantics. Paste asks for Replace confirmation if the reviewed destination is occupied. Cut
moves both dates atomically, guards the original source and reviewed destination,
and supports session Undo. Day uses a one-day minute view; Now retains the chosen
view and zoom and reveals today in Day/Week/Month/Year/Schedule. Drag endpoint
mapping accounts for the captured grip offset.

The Android reader uses current overlap semantics, serializes per-calendar reads,
and preserves readable calendars when another fails. Settings' local Check connection
results show counts/error codes and available visibility/synchronization flags,
without event titles or descriptions. The user initially reported 0.1.6 still blank on an S23. In a later 0.1.7 test,
Check connection returned eight timed events and those events then appeared in Today;
the user confirmed the reported blank-calendar issue was resolved. This is that
specific phone observation, not physical verification of 0.1.8 or its watch companion.

The F-Droid edition omits Google's native sign-in SDK, the Expo development
client, and the optional Google Play services Wear transport/native watch project. It has no direct Google account sign-in. Calendars supplied to Android by
another installed application can still be used through device-calendar access.
Optional Microsoft calendar/OneDrive support uses proprietary services and needs
a publisher-configured Microsoft registration, which is not configured in this
release. NonFreeNet is disclosed. The ledger, device calendars, and HTTPS WebDAV
storage work without a Microsoft account. Synchronization runs while Context is
open or returning to the foreground; terminated-app delivery is not claimed.

The separately distributed Wear-enabled phone and Wear OS APKs are optional editions,
not F-Droid candidate binaries. Source preparation verifies and removes 21 mandatory
Wear source inputs before autolinking/scanning; both final independent CI jobs assert
that removal. The FOSS APK has no Wear listener, transport/API or forbidden native
markers. The publisher-signed Wear pair shares a package and signing certificate;
an eventual official F-Droid signer is different and cannot supply this Data Layer
pairing. Physical Galaxy Watch7 validation remains pending.

## Packaging remediation and evidence

The original 0.1.0 check found 91 source errors and nine warnings. Its unsigned
native assembly and binary scan succeeded, but that did not establish source
compliance. The revised source selects Expo Android modules and core for source
compilation; records 107 precisely reviewed removable binary-input paths across 27 packages by fixed hash;
and applies five narrow patches, including removal of transitive Install Referrer
source/dependency and unused local Maven publication/repository blocks.

There are no directory-wide scanner exclusions or scandelete rules. The sole
exception is the exact official Linux Hermes compiler, verified by fixed hash
under F-Droid's explicit Hermes policy. See
[compiler provenance](../apps/mobile/fdroid/HERMES_COMPILER.md) and
[source preparation](../apps/mobile/docs/FDROID_SOURCE_PREPARATION.md).
Patches detach pnpm hardlinks before writing, preserving the shared package cache.

The recipe provisions hash-verified Node 24.19.0 and Gradle 9.4.1, with
Corepack 0.36.0/pnpm 11.25.0 and OpenJDK 17. It uses system Gradle after F-Droid
removes wrappers. Required Android SDK packages are recorded in the metadata.

## Latest 0.1.15 verification

- Scope: matching icons for the four hamburger-menu entries and Copy of one cell into a selected minute range, retaining text/fill/formatting. TypeScript, 509 full-suite tests and 69 focused tests passed; no physical 0.1.15 phone behavior is inferred.

- Exact source `e34e2856d9449521560d316edb49c00d0bade5ab`, Android code 16, passed both jobs in [run 40390963846](https://github.com/khushbakhtm-star/context/actions/runs/40390963846), controlled by `487d879edfc1743a17701c8e01ba262ff3b6430e`.
- [Exact tested recipe](https://github.com/khushbakhtm-star/context/blob/487d879edfc1743a17701c8e01ba262ff3b6430e/fdroid/metadata/com.context.minuteledger.yml) remains disabled pending official maintainer review.
- All 17 metadata and 15 native checks succeeded: lint exit 0; source JSON **0 errors, 0 warnings, 7 informational entries**; integrated F-Droid build/APK scan exit 0 (604.15 seconds); independent assembly `BUILD SUCCESSFUL in 12m 37s`; exact package 0.1.15/code16; expected unsigned-signature exit 1; binary scan exit 0.
- Both actual audits record **106 removals, 5 source patches and 21 exact optional Wear-source removals**. The reviewed inventory contains 107 removable paths across 27 packages; one Windows-only input is absent on Linux. Only the hash-verified official Linux Hermes compiler scanner exception remains.
- Locally downloaded/hashed [metadata artifact 12685506010](https://github.com/khushbakhtm-star/context/actions/runs/40390963846/artifacts/12685506010): 4,481,040 bytes; ZIP SHA-256 `777c3ab3ad568dd5be876eb074a77af34e27879fa92195449c8892053389f3c2`. [Native artifact 12686335809](https://github.com/khushbakhtm-star/context/actions/runs/40390963846/artifacts/12686335809): 37,195,503 bytes; ZIP SHA-256 `8ffc57179320ccdc5cad1ea54eae06d98ae7e515cb7bb3b24e858a923ec22ae0`. ZIP CRC, exact provenance, check results and source/Wear audits passed.
- The [durable R8 build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-build-evidence.zip) is 7,682,938 bytes, SHA-256 `14016c3a4d5a3f84f0ad1d50fa70b83dce9af72840483075b2df18d0870ffebb`. Its 23 allowlisted entries retain exact mappings/configuration/seeds/registration, public receipts and per-file hashes; CRC and every manifest hash passed. The mapped Print, Sharing and calendar-color modules resolve to actual APK DEX class definitions.
- Unsigned source-built APK: 78,018,116 bytes, SHA-256 `be3e8ebab4eda2fae880559a1a002c3c593e90f4ef1af32e26a7b2eed175522e`. Published signed preview: 78,118,759 bytes, SHA-256 `92f5c27fbbccbdf50e16ef59436f3b37dcdd11877dea7bf5bc30932e9a078d06`, matching the verified public asset.
- Official `apksigner` v2/v3, 16 KiB alignment, custom protected-content checks and original publisher-certificate continuity passed. All original unsigned protected entries, including `META-INF/services`, remain byte-identical after signing.
- [Full verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md) retain exact source-to-DEX details, receipt links and historical 0.1.14 results. Public GitHub preview publication is separate from official F-Droid review, server provisioning/signing and catalog listing. Physical 0.1.15 phone gestures and calendar runtime behavior are not established by these checks.

## Historical 0.1.14 verification

- Exact source `a388cc8eeba09664cd6fe0a4dc52da07ab19184f`, Android code 15, passed both jobs in [run 40384762580](https://github.com/khushbakhtm-star/context/actions/runs/40384762580), controlled by `acf7e140316ac22e32ed5aca989c5b7945cc1335`.
- [Exact tested recipe](https://github.com/khushbakhtm-star/context/blob/acf7e140316ac22e32ed5aca989c5b7945cc1335/fdroid/metadata/com.context.minuteledger.yml) remains disabled pending official maintainer review.
- All 17 metadata and 15 native checks succeeded: lint exit 0; source JSON **0 errors, 0 warnings, 7 informational entries**; integrated F-Droid build/APK scan exit 0 (628.63 seconds); independent assembly `BUILD SUCCESSFUL in 8m 55s`; exact package 0.1.14/code15; expected unsigned-signature exit 1; binary scan exit 0.
- Both actual audits record **106 removals, 5 source patches and 21 exact optional Wear-source removals**. The reviewed inventory contains 107 removable paths across 27 packages; one Windows-only input is absent on Linux. Only the hash-verified official Linux Hermes compiler scanner exception remains.
- Locally downloaded/hashed [metadata artifact 12680312413](https://github.com/khushbakhtm-star/context/actions/runs/40384762580/artifacts/12680312413): 4,481,244 bytes; ZIP SHA-256 `81ac72edb6328df580e137f150e73eeeb9707ed119248d19a57d3b767dc7dff7`. [Native artifact 12680447150](https://github.com/khushbakhtm-star/context/actions/runs/40384762580/artifacts/12680447150): 37,196,089 bytes; ZIP SHA-256 `4c53a1a70c2211954b50c631999679297d652e56805dff90bfd619f110d5196e`. ZIP CRC, exact provenance, check results and source/Wear audits passed.
- The [durable R8 build-evidence bundle](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-foss-build-evidence.zip) is 7,684,132 bytes, SHA-256 `1b1735f794b7ce626699eabc9bcb4192a25d999dd90f0e15cc601dd1a70ccea7`. Its 23 allowlisted entries retain exact mappings/configuration/seeds/registration, public receipts and per-file hashes; CRC and every manifest hash passed. The mapped Print, Sharing and calendar-color modules resolve to actual APK DEX class definitions.
- Unsigned source-built APK: 78,016,724 bytes, SHA-256 `d2b1c52e81763060169af114e96b0f46fab945fa4ebc9df81ab44df92b7b0a4e`. Published signed preview: 78,114,663 bytes, SHA-256 `64af76c4c98c45f2fe647f248f4258383ed26e117fda998aab9ab565321bda86`, matching the verified public asset.
- Official `apksigner` v2/v3, 16 KiB alignment, custom protected-content checks and original publisher-certificate continuity passed. All original unsigned protected entries, including `META-INF/services`, remain byte-identical after signing.
- [Full verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md) retain exact source-to-DEX details, receipt links and historical 0.1.13 results. Public GitHub preview publication is separate from official F-Droid review, server provisioning/signing and catalog listing. Physical 0.1.14 phone gestures and calendar runtime behavior are not established by these checks.

## Historical 0.1.13 verification

The [0.1.13 FOSS source candidate](../apps/mobile/docs/FDROID_VERIFICATION.md#verified-0113-foss-source-candidate)
used source `4c92502370158dfd7422471d17ffff9c5e15f87f`, controller
`9e942ea8929dca7c0031857ebc2bee3d4cf04fe4` and [run 40351936739](https://github.com/khushbakhtm-star/context/actions/runs/40351936739).
Both jobs passed; the source scanner recorded 0 errors, 0 warnings and 7 informational entries,
and actual audits recorded 106 removals, 5 patches and 21 Wear removals. Its public signed preview,
R8 evidence and exact hashes remain recorded in the historical diagnostics. These are separate
results, not evidence substituted for 0.1.14.

## Historical 0.1.8 verification

- Final phone/FOSS source: `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24`; final [independent CI 40245685971](https://github.com/khushbakhtm-star/context/actions/runs/40245685971) completed successfully with controller `994a269bbe1f861d9dcb318aa871a57a11efa0d5`.
- [Exact final tested recipe](https://github.com/khushbakhtm-star/context/blob/994a269bbe1f861d9dcb318aa871a57a11efa0d5/fdroid/metadata/com.context.minuteledger.yml); the candidate remains disabled for official maintainer review.
- Both CI jobs explicitly assert removal of the 21 mandatory hash-reviewed Wear source inputs. Earlier releases' dependency-cleanup counts are not substituted for this run.
- Decoded final metadata job logs show lint exit 0, source scanner exit 0 with zero errors/zero warnings, and successful normal integrated F-Droid build of final 7d292 / 0.1.8 plus APK scanning.
- Decoded native job logs show unsigned assembly exit 0 (`BUILD SUCCESSFUL in 12m 26s`), actual package/version/code 0.1.8/9, expected unsigned-signature exit 1 and binary-scanner exit 0.
- [Metadata artifact 12618753467](https://github.com/khushbakhtm-star/context/actions/runs/40245685971/artifacts/12618753467) is API-reported as 49,411 bytes, ZIP SHA-256 `d3c88eddb6367e63a97df1460c287428bf10c6ec5fdf8176d4c6e29120fdd113`; [native artifact 12619260247](https://github.com/khushbakhtm-star/context/actions/runs/40245685971/artifacts/12619260247) is API-reported as 32,608,379 bytes, ZIP SHA-256 `2c4ad9ca878864c0901e022a439faa708a254e184f03f89bd331d1c1fda75d0a`. These archives were not independently downloaded and hashed locally; verified decoded logs support the check results. No actual unsigned-APK checksum or dependency-cleanup totals are inferred from earlier versions.
- The [exact v0.1.8 tag workflow 40246819174](https://github.com/khushbakhtm-star/context/actions/runs/40246819174) completed successfully at final source `7d2921c526bf619c0d0aa12b4d6e80f8bf71dc24`.

- The published FOSS phone APK is `com.context.minuteledger` / 0.1.8 / code 9, with embedded F-Droid distribution. Its size/SHA-256 are recorded above; Wear listener/API and Google Wear/native-forbidden markers are absent.
- All three published APKs passed ZIP/native-manifest checks and custom APK v2 signature, certificate public-key binding, algorithm-list and protected-content digest verification. They share certificate SHA-256 `44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772`, matching 0.1.7.
- These checks are distinct from official Android `apksigner`; v1/v3/v4 and full official signature verification were not performed locally. Native assembly/inspection do not establish physical watch compatibility.
- The source tag is final phone/FOSS source. The watch was built from `d84fcacbd0484954f5c715b8976c37ba70e9c2fc`; the reviewed final diff leaves watch compilation inputs unchanged. That actual build provenance remains explicit.
- See [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md) for per-edition hashes, build identities and the final CI evidence.

The candidate remains disabled pending official F-Droid packager review. Public GitHub
preview availability does not establish official catalog publication or physical
Galaxy Watch7 validation.

## Historical 0.1.7 verification

- TypeScript, all 226 app tests, five release guards, and upstream listing validation passed.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40240522368) passed both jobs for source `d7cf4d61b7b7e175c18d91693027bde33fef8490`, version 0.1.7, code 8.
- All 17 metadata checks passed. Metadata lint: exit 0. Structured source scanner: 0 errors, 0 warnings, 7 informational entries.
- Integrated `fdroid build --test --stop --scan-binary com.context.minuteledger:8`: exit 0; built the exact 0.1.7 source commit in 795.53 seconds, including its source rescan and APK scan.
- All 15 independent native checks passed: `BUILD SUCCESSFUL in 12m 50s`, package `com.context.minuteledger` / 0.1.7 / code 8, expected unsigned signature exit 1, binary scan exit 0.
- Both actual Linux input audits recorded 100 exact removals and five narrow source patches, with the sole hash-pinned official Hermes compiler exception.
- Unsigned diagnostic APK: 77,660,500 bytes, SHA-256 `5f89e6c444b888468532676f8dd9c5c4ba6e96a90e2762164a3d9babc9ec3583`.
- Tested recipe controller: `5bfca0eb2f4fb505673ccc7ef5db91f3a1be0588`; [concrete recipe](https://github.com/khushbakhtm-star/context/blob/5bfca0eb2f4fb505673ccc7ef5db91f3a1be0588/fdroid/metadata/com.context.minuteledger.yml).
- [Metadata artifact 12617008779](https://github.com/khushbakhtm-star/context/actions/runs/40240522368/artifacts/12617008779) and [native artifact 12617023909](https://github.com/khushbakhtm-star/context/actions/runs/40240522368/artifacts/12617023909); ZIP sizes/hashes and scope are in [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md).
- The signed preview's application/configuration and native-marker checks passed; its v2 signing certificate matches public 0.1.6. Certificate continuity is not full cryptographic signature validation.
- The signed and unsigned bundles contain the expected four cell-action markers and five modern calendar-reader/diagnostic strings. Physical S23 calendar visibility remains unconfirmed.

These are independent Ubuntu-toolchain diagnostics. Official F-Droid provisioning,
recipe enablement, signing, inclusion-policy assessment, and publication remain
maintainer decisions. The candidate remains disabled. This is the phone 0.1.7 release;
separate watch-companion development is not included.

## Historical 0.1.6 verification

- TypeScript, all 201 app tests, five release guards, and upstream listing validation passed.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40236099682) passed both jobs for source `36d94201013d51e41dc0ad4b3814c5ff6d736b7f`, version 0.1.6, code 7.
- All 17 metadata checks passed. Metadata lint: Exit 0. Structured source scanner: 0 errors, 0 warnings, 7 informational entries.
- Integrated `fdroid build --test --stop --scan-binary com.context.minuteledger:7`: Exit 0; built the exact final 0.1.6 source commit (783.05 seconds), including its source rescan and APK scan.
- Independent unsigned assembly/identity/signature/binary checks: All 15 checks passed; assembly `BUILD SUCCESSFUL in 12m 16s`, package `com.context.minuteledger` / 0.1.6 / code 7, expected unsigned signature exit 1, binary scan exit 0.
- Linux input audit: 100 exact removals and 5 narrow source patches.
- Unsigned diagnostic APK: 77,591,624 bytes, SHA-256 `49146a6356ee900dbab163baccf4562d7d0ec8b62234920a7778c1ff74380e48`.
- Tested recipe controller: `d89828858dedf3c311f54ed3473431a19b217685`; [concrete recipe](https://github.com/khushbakhtm-star/context/blob/d89828858dedf3c311f54ed3473431a19b217685/fdroid/metadata/com.context.minuteledger.yml).
- [Metadata artifact 12615252744](https://github.com/khushbakhtm-star/context/actions/runs/40236099682/artifacts/12615252744) and [native artifact 12615337394](https://github.com/khushbakhtm-star/context/actions/runs/40236099682/artifacts/12615337394); full hashes and scope are in [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md).
- Signed preview ZIP integrity, embedded com.context.minuteledger / 0.1.6 / code 7, configured FOSS distribution, and forbidden native-marker checks passed. Its v2 signing certificate matches the public 0.1.5 preview. Certificate continuity is not full cryptographic signature validation. Physical-phone QA remains pending.

These are independent Ubuntu-toolchain diagnostics. Official F-Droid provisioning,
recipe enablement, signing, inclusion-policy assessment, and publication remain
maintainer decisions. The candidate remains disabled.

## Historical 0.1.5 verification

- TypeScript, all 183 app tests, five release guards, and upstream listing validation passed.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40217570243) passed both jobs for source `87cc9df388e4350a51e5e6fc07bcf7a19447c600`, version 0.1.5, code 6.
- All 17 metadata checks passed. Metadata lint: exit 0. Structured source scanner: 0 errors, 0 warnings, 7 informational entries.
- Integrated `fdroid build --test --stop --scan-binary com.context.minuteledger:6`: Exit 0; built the exact final 0.1.5 source commit (828.97 seconds), including its source rescan and APK scan.
- Independent unsigned assembly/identity/signature/binary checks: All 15 checks passed; assembly `BUILD SUCCESSFUL in 11m 46s`, package `com.context.minuteledger` / 0.1.5 / code 6, expected unsigned signature exit 1, binary scan exit 0.
- Linux input audit: 100 exact removals and 5 narrow source patches.
- Unsigned diagnostic APK: 77,578,252 bytes, SHA-256 `6d027f10150fe3e7c8acc8981563079374fcc9da42d200bf7ae6362b8c5dea0e`.
- Tested recipe controller: `8aa08423a746b0cc6fd57032fa7b2c2e64ec429b`; [concrete recipe](https://github.com/khushbakhtm-star/context/blob/8aa08423a746b0cc6fd57032fa7b2c2e64ec429b/fdroid/metadata/com.context.minuteledger.yml).
- [Metadata artifact 12608720370](https://github.com/khushbakhtm-star/context/actions/runs/40217570243/artifacts/12608720370) and [native artifact 12608363201](https://github.com/khushbakhtm-star/context/actions/runs/40217570243/artifacts/12608363201); full hashes and scope are in [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md).
- Signed preview ZIP integrity, embedded com.context.minuteledger / 0.1.5 / code 6, configured FOSS distribution, and forbidden native-marker checks passed. Its v2 signing certificate matches the public 0.1.4 preview. Certificate continuity is not full cryptographic signature validation. Physical-phone QA remains pending.

These are independent Ubuntu-toolchain diagnostics. Official F-Droid provisioning,
recipe enablement, signing, inclusion-policy assessment, and publication remain
maintainer decisions. The candidate remains disabled.

## Historical 0.1.4 verification

- TypeScript, all 169 app tests, five release guards, and upstream listing validation passed.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40208555966) passed both jobs for source `95050ec1956ee78ee1fbf98bf6df8c6c3067cbe9`, version 0.1.4, code 5.
- All 17 metadata checks passed. Metadata lint: exit 0. Structured source scanner: 0 errors, 0 warnings, 7 informational entries.
- Integrated `fdroid build --test --stop --scan-binary com.context.minuteledger:5`: Exit 0; built the exact 0.1.4 source commit, including the source rescan and APK scan.
- Independent unsigned assembly/identity/signature/binary checks: All 15 checks passed; assembly `BUILD SUCCESSFUL in 8m 22s`, package `com.context.minuteledger` / 0.1.4 / code 5, expected unsigned signature exit 1, binary scan exit 0.
- Linux input audit: 100 exact removals and 5 narrow source patches.
- Unsigned diagnostic APK: 77,553,624 bytes, SHA-256 `602b872210275e8d7912cbeee53e1b21d59432cfbced6d1f43d8d83a3a36150a`.
- Tested recipe controller: `309142bbb2e4e8f806cee4f05a10f43144d90bd5`; [concrete recipe](https://github.com/khushbakhtm-star/context/blob/309142bbb2e4e8f806cee4f05a10f43144d90bd5/fdroid/metadata/com.context.minuteledger.yml).
- [Metadata artifact 12604437989](https://github.com/khushbakhtm-star/context/actions/runs/40208555966/artifacts/12604437989) and [native artifact 12605201922](https://github.com/khushbakhtm-star/context/actions/runs/40208555966/artifacts/12605201922); full hashes and scope are in [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md).
- Signed preview ZIP integrity, embedded `com.context.minuteledger` / 0.1.4 / code 5, configured FOSS distribution, and forbidden native-marker checks passed. The v2 signing certificate matches the published 0.1.3 preview. This continuity check is not full cryptographic signature validation. Physical-phone QA remains pending.

These are independent Ubuntu-toolchain diagnostics. Official F-Droid provisioning,
recipe enablement, signing, inclusion-policy assessment, and publication remain
maintainer decisions. The candidate remains disabled.

## Historical 0.1.3 verification

- TypeScript, all 161 app tests, five release guards, and upstream listing validation pass.
- The hardlink regression test passes outside Windows's restricted filesystem sandbox.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40206078084) passed both jobs against source `761264dab4880b91843d6a500591de9c73a9f9f5`.
- Metadata lint passed. The real source scanner reported zero errors, zero warnings, and seven normal informational entries.
- The integrated `fdroid build --test --stop --scan-binary com.context.minuteledger:4` completed successfully, including its source rescan and APK scan.
- Independent unsigned Android assembly, package/version identity, unsigned-signature check, and APK binary scan also passed.
- The Linux input audit recorded 100 actual removals and five source patches. The unsigned diagnostic APK is 77,536,856 bytes, SHA-256 `d2c873e8f2e70fc481b837e391bc2c90725bc88fc681639aa5df1983f19783fe`.
- The workflow checks metadata lint, structured source-scanner findings, the full enabled recipe in an ephemeral copy, independent unsigned assembly, package/version identity, and APK binary scanning.
- Scanner JSON errors are checked explicitly because fdroidserver 2.4.5 can exit zero despite source errors.
- The committed candidate remains disabled. No result is represented as an official F-Droid build-server acceptance.
- Exact tested recipe: https://github.com/khushbakhtm-star/context/blob/646bb446a8af688a21057490e67ae1875b45094b/fdroid/metadata/com.context.minuteledger.yml. The integrated test removed only the disable field in an ephemeral copy; maintainers retain control over enabling official builds.
- Metadata artifact: https://github.com/khushbakhtm-star/context/actions/runs/40206078084/artifacts/12603884752. Native artifact: https://github.com/khushbakhtm-star/context/actions/runs/40206078084/artifacts/12604640234. These diagnostic artifacts expire after 30 days; [verification diagnostics](../apps/mobile/docs/FDROID_VERIFICATION.md) record their hashes and observed results.
- The signed preview's ZIP/configuration checks passed, and its v2 signing certificate matches the published 0.1.2 preview. This continuity check is not full cryptographic signature validation. The signed preview is distinct from the unsigned CI artifact and official F-Droid builds.
- Native phone verification and genuine app screenshots are pending for this candidate.

The prior 0.1.2 source `49cb65def8d6f951f5709e8ee5bd581d352b1693` also passed its
[cold-build verification](https://github.com/khushbakhtm-star/context/actions/runs/40176383213).
Its historical results and artifact hashes remain in the verification diagnostics. The latest
candidate was independently rebuilt and rescanned; earlier results are not substituted for it.

## Project history and inclusion

The first public source release was published on 2026-10-25. Three months of
maintenance and prior F-Droid app maintenance are not established. The author has
reported using Context on an actual Android phone and provided device-layout bug
reports; independent user numbers and an applicable policy exception are not
claimed. Please advise whether that use qualifies for the inclusion-policy user
exception or whether inclusion should wait while public maintenance continues.

The author explicitly requested public MIT source publication and official
F-Droid inclusion. A search for the application ID found no existing request or
listing before this draft was prepared. No donation is claimed.

## Submission receipt

Submitted on 2026-10-25 as [F-Droid packaging request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
The issue is open for maintainer review. Submission does not establish acceptance
or catalog publication. The initial 0.1.2 source tag, APK digest, and tagged-source
[workflow](https://github.com/khushbakhtm-star/context/actions/runs/40199617523)
were independently verified after publication. The later 0.1.3 source tag and APK
were also verified, and its tagged-source
[workflow](https://github.com/khushbakhtm-star/context/actions/runs/40207178435)
passed. Store publication jobs were readiness-gated and skipped; no store availability
is claimed. Updates belong on the existing request rather than a duplicate inclusion issue. The 0.1.4
source tag and public signed APK were also independently verified, and its
[tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40209430440)
passed. Store publication jobs remained skipped.

The [v0.1.5 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40218692984)
passed at final source `87cc9df388e4350a51e5e6fc07bcf7a19447c600`. Store publication jobs were
readiness-gated and skipped.

The [v0.1.6 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40236999059) passed at final source `36d94201013d51e41dc0ad4b3814c5ff6d736b7f`. Store publication jobs were readiness-gated and skipped.

The [v0.1.7 tagged-source workflow](https://github.com/khushbakhtm-star/context/actions/runs/40241739878)
passed at phone source `d7cf4d61b7b7e175c18d91693027bde33fef8490`. This receipt does not claim
an official store/F-Droid publication or a successful physical S23 calendar-import test.

The [0.1.8 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.8) was published
on 2026-10-25 at 23:54:13 UTC; the tag and all three asset sizes/digests were verified. Its exact-tag
workflow completed successfully at final source 7d292, as recorded above. The earlier 0.1.7 S23-unconfirmed statement
is preserved as its then-current receipt; the later human confirmation appears above.
