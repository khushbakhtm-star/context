# Context F-Droid submission preparation

The owner authorized a public MIT source release and a request for F-Droid review. This checkout
contains an upstream listing and a disabled build candidate. It is not an accepted F-Droid listing,
and the source release does not itself install an APK.

The existing public request is [Context RFP 4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
Use that request for further evidence rather than creating another. The last verified FOSS
candidate is 0.1.8/code 9; 0.1.13/code 14 is being prepared for a new source-pinned build and
scanner run. See [`FDROID_VERIFICATION.md`](FDROID_VERIFICATION.md) for the refresh gates and
the exact historical receipts. A newer phone preview alone is not a verified F-Droid update.

## Prepared material

- `fastlane/metadata/android/en-US/` at the repository root contains the title, descriptions,
  version-code-1 changelog, and a byte-for-byte copy of the approved Context logo.
- `apps/mobile/fdroid/com.context.minuteledger.yml.template` declares MIT, current `Calendar & Agenda`
  and `Time Tracker` categories, and `NonFreeNet` for optional Microsoft services.
- `apps/mobile/fdroid/prepare-submission.cjs` checks the local listing and can generate a candidate
  metadata file and packaging request for a real public source URL and immutable release commit.
  It preserves the disabled native build. It does not publish source or contact F-Droid.

No screenshots have been supplied. Add only genuine captures from the installed native app under
`fastlane/metadata/android/en-US/images/phoneScreenshots/`; do not label a design mockup as a capture.
Screenshots are useful listing material, and missing graphics can affect discovery, but they are
not a substitute for testing the app.

## Release and request

Publish the source, license, approved assets, lockfile, and listing in a real public repository.
Use a source-only prerelease while native verification remains pending. Do not upload private
ledger exports, credentials, account tokens, keystores, or generated working folders. Confirm that
the released source has the same `0.1.0` / `1` version values as the metadata, then tag that exact
release commit `v0.1.0`.

From the repository root, check the listing:

```sh
node apps/mobile/fdroid/prepare-submission.cjs --check
```

After a real public source repository exists, supply its actual URLs and the full local release
commit hash. The following arguments are placeholders to replace, not a ready-to-run command:

```sh
node apps/mobile/fdroid/prepare-submission.cjs --repo PUBLIC_HTTPS_REPOSITORY_URL --issues PUBLIC_ISSUES_URL --releases PUBLIC_RELEASES_URL --commit FULL_RELEASE_COMMIT_HASH
```

The helper verifies the release commit exists locally and contains the required source/listing
files, and writes under `tmp/fdroid-submission/<commit>/`. Verify the repository can be cloned
anonymously and that tag `v0.1.0` resolves to the supplied commit. The helper cannot prove that an
HTTPS URL is public or that the remote has the intended commit.

Use the generated `REQUEST_FOR_PACKAGING.md` in the [F-Droid submission queue](https://gitlab.com/fdroid/rfp/-/issues/new)
after signing in to the owner's GitLab account. It explicitly discloses the unverified build and
new-project status so a reviewer can advise on packaging. Keep unchecked evidence as unchecked.
The more complete route is a tested metadata merge request to
[fdroiddata](https://gitlab.com/fdroid/fdroiddata); generated local files do not create either request.

## Native build verification still needed

Use a clean Linux checkout of the release commit and the F-Droid source-build steps in
[`DISTRIBUTION.md`](DISTRIBUTION.md). Record the server image, Node/pnpm provisioning, JDK, Android
SDK/NDK, build commands, APK hash, scanner output, and device results. The candidate names the
locally used Node 24.19.0 and pnpm 11.25.0 but does not install them on an F-Droid server. Determine
the accepted pinned toolchain through the first real native build.

In a separate fdroiddata checkout with fdroidserver installed, place the generated candidate at
`metadata/com.context.minuteledger.yml`, then run:

```sh
fdroid rewritemeta com.context.minuteledger
fdroid lint com.context.minuteledger
fdroid scanner --force --exit-code com.context.minuteledger:1
```

The build entry stays disabled until a packager has resolved the toolchain and actual scanner
findings. Remove its `disable` field in that review checkout only when ready to attempt:

```sh
fdroid build --server com.context.minuteledger:1
```

No fdroidserver validation or unsigned native build is claimed by the listing checks. Do not add
blanket scanner exclusions. F-Droid must review the complete dependency graph, including native
build tooling. Optional Microsoft services are disclosed even when the publisher has not yet
configured Microsoft sign-in; offline use and user-selected WebDAV remain alternatives.

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
