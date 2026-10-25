# Packaging review: Context (com.context.minuteledger)

## Source and release

- Source: https://github.com/khushbakhtm-star/context
- Issue tracker: https://github.com/khushbakhtm-star/context/issues
- Releases: https://github.com/khushbakhtm-star/context/releases
- Candidate: 0.1.7 (Android version code 8)
- Immutable source: d7cf4d61b7b7e175c18d91693027bde33fef8490
- Published source tag and Android preview: https://github.com/khushbakhtm-star/context/releases/tag/v0.1.7
- Signed preview APK: https://github.com/khushbakhtm-star/context/releases/download/v0.1.7/context-0.1.7-foss-preview.apk
- Preview APK SHA-256: `67e36f7b84ed0366a36e9c25e3baf8c57b44cfc8e690290061ad771551dd131c`
- Publication: 2026-10-25 at 22:46:20 UTC; signed APK size 77,672,804 bytes
- License: MIT
- Summary: Capture your day minute by minute alongside your calendars

This is a new public project requesting packaging review and an inclusion-policy
assessment. It is not an accepted F-Droid app. The 0.1.7 source tag and signed
Android preview are public. Both cold-build verification jobs passed; the older
0.1.0 release is not the remediated source candidate.

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
use a solid color fill with a readable foreground. First tap types inline, a second
tap opens color/details. Holding a cell or releasing a dragged range opens compact
floating Cut / Copy / Auto fill / Clear actions while the grid remains visible. Today's date jumps to the current minute. A measured time
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
Paste asks for Replace confirmation if the reviewed destination is occupied. Cut
moves both dates atomically, guards the original source and reviewed destination,
and supports session Undo. Today/Day resets the view to one full day despite prior
zoom. Drag endpoint mapping accounts for the captured grip offset.

The Android reader uses current overlap semantics, serializes per-calendar reads,
and preserves readable calendars when another fails. Settings' local Check connection
results show counts/error codes and available visibility/synchronization flags,
without event titles or descriptions. The user reported 0.1.6 still blank on an S23
with the same calendar checked; successful physical visibility on 0.1.7 is not yet
confirmed. These diagnostics and build checks do not establish that the problem is fixed.

The F-Droid edition omits Google's native sign-in SDK and the Expo development
client. It has no direct Google account sign-in. Calendars supplied to Android by
another installed application can still be used through device-calendar access.
Optional Microsoft calendar/OneDrive support uses proprietary services and needs
a publisher-configured Microsoft registration, which is not configured in this
release. NonFreeNet is disclosed. The ledger, device calendars, and HTTPS WebDAV
storage work without a Microsoft account. Synchronization runs while Context is
open or returning to the foreground; terminated-app delivery is not claimed.

## Packaging remediation and evidence

The original 0.1.0 check found 91 source errors and nine warnings. Its unsigned
native assembly and binary scan succeeded, but that did not establish source
compliance. The revised source selects Expo Android modules and core for source
compilation; records 101 precisely reviewed removable binary inputs by fixed hash;
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

## Latest 0.1.7 verification

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
