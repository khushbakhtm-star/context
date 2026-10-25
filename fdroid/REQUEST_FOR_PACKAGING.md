# Packaging review: Context (com.context.minuteledger)

## Source and release

- Source: https://github.com/khushbakhtm-star/context
- Issue tracker: https://github.com/khushbakhtm-star/context/issues
- Releases: https://github.com/khushbakhtm-star/context/releases
- Requested version: 0.1.0 (version code 1)
- Release commit: eae2abdb22afb092c273acef4e60cbdb17c2743f
- Verified public tag: v0.1.0
- Source prerelease: https://github.com/khushbakhtm-star/context/releases/tag/v0.1.0
- License: MIT
- Summary: Capture your day minute by minute alongside your calendars

Please review Context for F-Droid packaging. This is a new public project; initial
toolchain guidance is requested and inclusion-policy eligibility is not claimed.

## Application and edition

Context implements a local minute-by-minute activity ledger, custom categories,
day/week/month/year category reports, Android device-calendar access, and optional
encrypted ledger synchronization through a dedicated HTTPS WebDAV folder.

The F-Droid source preparation removes Google's native sign-in dependency and the
Expo development client before dependency installation. It has no direct Google
account sign-in. Optional Microsoft calendar and OneDrive features need the
publisher's Microsoft app registration; that configuration is not included in this
source release. NonFreeNet is disclosed for those optional proprietary services.
Local ledger, Android calendars, and WebDAV do not need a Microsoft account.

## Packaging status and help requested

- [x] MIT license and upstream listing files are present in the selected local commit.
- [x] The approved logo is supplied as the listing icon; no mock screenshots are presented as captures.
- [x] The source was fetched anonymously over HTTPS and v0.1.0 resolves to the release commit above.
- [ ] Establish and pin the accepted Linux/Android/Node/pnpm build-server environment.
- [ ] Run fdroidserver metadata lint, dependency scanner, and an unsigned native build.
- [ ] Install and validate the native source edition on an Android phone.
- [ ] Capture genuine screenshots after native verification.

An owner-signed standalone FOSS preview APK was built successfully through Expo
EAS on Linux and is attached to the source prerelease. Its SHA-256 is
be36109d6b00219e66795c844abd828fcae3bea8a118ea47f11862242ea41917.
This does not verify the F-Droid build-server recipe or dependency scanner.
Local validation passed 109 app tests, five release-tool tests, and TypeScript.
The tagged source verification workflow also passed:
https://github.com/khushbakhtm-star/context/actions/runs/40169911653.

The accompanying metadata is an explicitly disabled build candidate. The source
has not yet been demonstrated to build on F-Droid's server. Please advise on the
Expo/React Native packaging and any actual scanner findings before enabling it.
No blanket scanner exclusions are proposed.

## Project history

The first public source release was published on 2026-10-25. The available history
does not establish three months of active development, prior F-Droid maintenance,
or an applicable policy exception. Physical-phone verification and evidence of
actual users remain pending. Please advise whether packaging guidance can begin
now or whether this request should wait for maintenance history and user evidence.
