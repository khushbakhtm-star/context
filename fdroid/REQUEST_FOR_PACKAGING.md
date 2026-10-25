# Packaging review: Context (com.context.minuteledger)

## Source and release

- Source: https://github.com/khushbakhtm-star/context
- Issue tracker: https://github.com/khushbakhtm-star/context/issues
- Releases: https://github.com/khushbakhtm-star/context/releases
- Candidate: 0.1.3 (Android version code 4)
- Immutable source: 761264dab4880b91843d6a500591de9c73a9f9f5
- Published source tag and Android preview: https://github.com/khushbakhtm-star/context/releases/tag/v0.1.3
- Signed preview APK: https://github.com/khushbakhtm-star/context/releases/download/v0.1.3/context-0.1.3-foss-preview.apk
- Preview APK SHA-256: `5d008da29fe0921b4a99bb6039f1a68c607bcef5d7ab0a0501572b6a445e009d`
- Publication: 2026-10-25 at 15:29:28 UTC; signed APK size 77,549,160 bytes
- License: MIT
- Summary: Capture your day minute by minute alongside your calendars

This is a new public project requesting packaging review and an inclusion-policy
assessment. It is not an accepted F-Droid app. The 0.1.3 source tag and signed
Android preview are public. Both cold-build verification jobs passed; the older
0.1.0 release is not the remediated source candidate.

## Application and edition

Context implements a local minute-by-minute activity ledger, custom activity
colors, reports for day/week/month/year, Android device-calendar access, and
optional encrypted ledger synchronization through a dedicated HTTPS WebDAV folder.
The current source also includes day/three-day/week minute views, light/dark
appearance, inline text entry, cell formatting, session undo/redo, same-day range
fill/clear, and zoom. Calendar and storage access require user consent. Undo restores
Context entries and formatting; effects already sent to calendars or invitations
can need separate review.

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

- TypeScript, all 161 app tests, five release guards, and upstream listing validation pass.
- The hardlink regression test passes outside Windows's restricted filesystem sandbox.
- [Cold Linux verification](https://github.com/khushbakhtm-star/context/actions/runs/40206078084) passed both jobs against the immutable 0.1.3 source above.
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
is claimed. Updates belong on the existing request rather than a duplicate inclusion issue.
