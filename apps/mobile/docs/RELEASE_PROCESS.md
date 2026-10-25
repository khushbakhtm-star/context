# Coordinated Context releases

Every Context release targets Google Play, Apple App Store, and F-Droid from one immutable source
tag. Store availability and user notices follow actual publication in each channel. The source
workflow does not treat a successful build, TestFlight upload, or F-Droid request as a public update.

The checked-in [release workflow](../../../.github/workflows/release.yml) prepares that process.
It has not been enabled in a public GitHub repository or demonstrated to submit a store build.
Google Play and Apple developer enrollment, store app records, signing/submission credentials,
native testing, and F-Droid acceptance remain pending. The release plan currently records all
native verification flags as `false`; the public update feed is empty.

## Before enabling automation

Publish the complete MIT source in the owner's actual public GitHub repository. Protect its default
branch and the `v*` release tags. Restrict tag creation and changes to trusted maintainers; prevent
tag deletion/replacement. The workflow accepts only numeric `vMAJOR.MINOR.PATCH` tags pointing to a
commit in default-branch history and rechecks the remote tag before using release credentials.
Manual workflow runs must select an existing release tag, not a branch or an arbitrary commit.

Create GitHub environments named `source-release`, `google-play`, `apple-app-store`, and `fdroid`.
Restrict their deployments to the protected release tags. Configure environment reviewers if the
owner wants a further approval gate. Put a narrowly scoped Expo access token in each build
environment as secret `EXPO_TOKEN`. Store native signing and store service credentials in EAS;
do not commit them, paste them into release notes, or put JSON credential files in artifacts.

Complete the Expo project link and at least one interactive signing setup before noninteractive
CI. Register the final OAuth clients for production certificates and bundle IDs if account
connections will be offered. A token alone does not create Google Play, Apple, or F-Droid accounts.

For Google Play, complete enrollment/app creation and configure EAS's Google service-account
credential. For Apple, complete paid developer enrollment/app creation, signing, EAS's App Store
Connect API credential, and `ascAppId` in the Apple submit profile. Keep the committed Google submit
profile on `internal` + `draft`. Apple submission uploads for processing/TestFlight; App Review and
public release follow separately. Resolve real provider testing/consent and disclosure requirements.

Set these repository variables to the literal string `true` only after the matching setup works:

| Variable | Effect |
| --- | --- |
| `CONTEXT_SOURCE_RELEASES_ENABLED` | Publish source artifacts as a GitHub prerelease after checks |
| `CONTEXT_EAS_BUILDS_ENABLED` | Permit the three EAS channel jobs on protected release tags |
| `CONTEXT_GOOGLE_PLAY_BUILD_READY` | Build the Google Play AAB with profile `google-play` |
| `CONTEXT_APPLE_BUILD_READY` | Build the iPhone IPA with profile `apple-app-store` |
| `CONTEXT_FDROID_BUILD_READY` | Build the FOSS owner-signed preview with profile `fdroid-preview` |
| `CONTEXT_GOOGLE_PLAY_SUBMIT_READY` | Stage the exact finished Android build as an internal draft after Android native verification |
| `CONTEXT_APPLE_SUBMIT_READY` | Stage the exact finished iPhone build after iOS native verification |

Per-channel readiness variables may instead live in their corresponding environment. The two
global enable variables must be repository variables because GitHub evaluates job gates before
loading an environment. Unset switches leave jobs disabled and do not imply that a release happened.

## Prepare each version

1. Update `apps/mobile/app.json` and `apps/mobile/package.json` to the same marketing version.
   Increase Android `versionCode` and iOS `buildNumber` as positive integers. Context uses local
   source versions and disables EAS auto-increment so the three builds retain the source identity.
   The workflow rejects a version or build number that does not increase over the preceding tag.
2. Update `.github/release-plan.json` with the version, both source build numbers, accurate notes,
   and native verification states. Keep a platform `false` until its actual native phone checks
   have passed for this source. Retain test evidence with the release review.
3. Add the F-Droid changelog at `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`,
   at most 500 characters. Review the description, genuine screenshots, privacy disclosures,
   migrations, and supported account configuration.
4. Run typecheck/tests and the local release checks below. Merge the reviewed source to the
   protected default branch. Tag that exact commit `v<version>` and push the tag.

```sh
RELEASE_TAG=v0.1.0 node .github/scripts/release-tools.cjs check
node --test .github/scripts/release-tools.test.cjs
node apps/mobile/fdroid/prepare-submission.cjs --check
```

Replace the example version with the release being prepared. The first command is a local plan
check; the CI `verify` command additionally proves the tag, default-branch ancestry, remote tag,
and prior release build numbers. EAS CLI is pinned to `25.3.0`, Node to `24.19.0`, and pnpm to
`11.25.0`. Action dependencies are pinned to verified commit hashes.

## What the tag workflow does

The first job validates release identity, runs the mobile typecheck/tests and release guard tests,
checks listing limits/logo identity, and generates a disabled F-Droid candidate for the exact commit.
Its artifacts contain the source plan, release notes, candidate recipe, and draft packaging request.
The candidate helper reads files from the selected Git commit rather than an uncommitted checkout.

When enabled, the source job publishes a **prerelease** and attaches those files. It refuses to
overwrite an existing stable release. The channel jobs use the same commit, wait for finished EAS
builds, and record only IDs, status, source version, and native build numbers. They exclude raw EAS
responses and artifact URLs from uploaded artifacts. Store staging always uses that exact build ID;
it never selects whichever build happens to be `latest`.

The workflow can be rerun after a failed submission, but first inspect EAS for an existing finished
build: restarting the build job creates another build. Use its recorded build ID to retry only the
submission when appropriate. A workflow timeout can leave the remote cloud build running.
F-Droid preview signing differs from official F-Droid signing; see the channel-migration warning in
[`DISTRIBUTION.md`](DISTRIBUTION.md).

## Publish in each store, then notify its users

Complete Google Play release/testing requirements and promote the reviewed draft when ready.
Submit the processed Apple build for App Review and release it after approval. For F-Droid, follow
[`FDROID_SUBMISSION.md`](FDROID_SUBMISSION.md): submit the verified recipe or update its accepted
fdroiddata entry. Ask maintainers to configure appropriate tag-based updates once the source build
is accepted; every future tag still goes through F-Droid's own build, signing, and publication.
This GitHub workflow cannot accept a recipe on F-Droid's behalf.

Check each public listing from a normal user account and confirm the intended version/build is
actually obtainable before adding that channel to `releases/latest.json`. Use that build's real
native identity, correct channel, exact official store URL, `released: true`, and real publication
time. Do not announce the owner-signed FOSS preview as an official F-Droid release. Keep a channel
absent while its store is reviewing or rolling out an unavailable build. Review the feed change
like source code and publish it at the HTTPS URL configured into installed Context apps.

The runtime schema and trust checks are in [`releases/README.md`](../../../releases/README.md).
Users who opt in receive an in-app update notice on a foreground check when a newer published build
matches their platform, application ID, distribution channel, and trusted store link. Notices are
not guaranteed while Context is terminated. Native store update settings may also notify users.
A release tag or a GitHub source prerelease alone never sets `released: true`.

## References

- [EAS CLI reference](https://docs.expo.dev/eas/cli/)
- [Expo automatic submission behavior](https://docs.expo.dev/build/automate-submissions/)
- [Google Play submission setup](https://docs.expo.dev/submit/android/)
- [Apple submission setup and App Review](https://docs.expo.dev/submit/ios/)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
- [F-Droid source inclusion](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
