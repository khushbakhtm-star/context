# Installed-app update notices

`latest.json` is the public availability feed. It announces the verified public Android standalone
preview 0.1.7 (build 8), published on 2026-10-25 at 22:46:20 UTC. Official store entries remain absent
pending actual availability. A source tag alone, unpublished upload, review submission, or queued
release must not add a released entry.
The release plan is separate from this feed. Commit an availability entry only after checking
that an ordinary user in the intended audience can actually obtain that exact channel's release.
When a rollout is limited, keep the entry out until availability matches the feed's audience.

## Install the Android preview update

Open the [0.1.7 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.7), expand
**Assets**, and download `context-0.1.7-foss-preview.apk`. Open the downloaded APK and choose
**Update** over the existing Context installation. Keep Context installed to preserve its ledger.
The new preview uses the same application ID and signing certificate as the verified 0.1.6 preview,
with version code 8.

Cell actions now float over the grid: **Cut / Copy / Auto fill / Clear**, with **Paste** available
after copying or cutting. Hold a cell, choose Cut or Copy, navigate to another day/minute, then tap
the destination and Paste. Occupied destinations require Replace confirmation. Cut moves source and
destination together, and session Undo restores both. The clipboard stays inside Context.

Drag a cell's corner handle up or down in the same date column; release opens the floating actions.
Auto fill retains the original recorded source text, activity color and formatting unless you choose
another Google activity color. Each copied minute remains editable. **Today / Day** restores one
full day across the screen even after zooming.

Android calendar reading now isolates failures per calendar and includes local **Settings → Calendar
connection → Check connection** counts/errors and available visibility/synchronization flags.
Android opens the event editor as a separate calendar-app task; return to Context to refresh plans.
The reported S23 problem—checked calendar events still missing—has not been confirmed resolved on
the phone. Physical verification is pending; build and scan success do not establish that result.

For an ongoing **Update** button, follow the one-time [Obtainium setup](ANDROID_UPDATES.md).
Official F-Droid inclusion remains pending at [request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667);
this GitHub preview does not create an official F-Droid catalog entry. Apple distribution also remains pending.

## Update notices

The app checks only when the user enables **Settings → Check for released updates**, while it is
open. It checks on launch/return to the foreground and periodically while active, at most once every
six hours, with a manual **Check now** option. Failed automatic requests remain silent. No ledger,
account, device identifier, or installed version is sent in the request; the HTTPS host still sees
ordinary connection metadata. Notices can be dismissed separately for each release. Settings keeps
the release link available after dismissal. The app never downloads or installs a binary itself.

This is an in-app notice, not a push notification while Context is closed. Older installed binaries
without this feature need a normal app update before they can show these notices. Play, App Store,
and F-Droid clients provide their own update mechanisms independently.

## Build configuration

The default feed is the publisher's public `releases/latest.json` on the `main` branch of
[`khushbakhtm-star/context`](https://github.com/khushbakhtm-star/context). A fork can override
`EXPO_PUBLIC_CONTEXT_RELEASE_MANIFEST_URL` with its own public HTTPS JSON URL and rebuild;
an explicit empty value disables the feed. The build profile sets `EXPO_PUBLIC_CONTEXT_RELEASE_CHANNEL` to one of
`google-play`, `apple-app-store`, `fdroid`, or `standalone`. A preview APK is `standalone`, even if it
uses the FOSS dependencies; it cannot be updated by an F-Droid signing key. A clean F-Droid source
build defaults to `fdroid` through its distribution variable. Other unlabelled builds default to
`standalone` rather than guessing which store signed them.

Apple builds additionally require `EXPO_PUBLIC_CONTEXT_APP_STORE_ID`, the actual numeric app ID
created in App Store Connect. Standalone builds trust the publisher's GitHub releases page by default;
`EXPO_PUBLIC_CONTEXT_STANDALONE_RELEASE_URL` overrides that exact trusted HTTPS release-page URL.
A fork must supply its own feed and signing-channel release page. The Apple store ID remains unset
until that destination exists. Missing required configuration disables checking.
Release identity comes from the embedded Expo configuration; iOS also uses its installed
Info.plist build number. These builds use source-controlled local version numbers and do not
enable remote JavaScript updates. Release checks validate the native build identity against the
source configuration. Expo Go and development bundles are excluded. Context has no direct
`expo-application` dependency for release identity. AuthSession still reaches it transitively;
the F-Droid preparation patches out its Android Install Referrer source and dependency.

## Schema version 1

The root contains `schemaVersion: 1` and a `releases` array (at most 100 entries). Each entry has:

| Field | Required value |
| --- | --- |
| `platform` | `android` or `ios` |
| `channel` | `google-play`, `apple-app-store`, `fdroid`, or `standalone` |
| `applicationId` | Exact installed Android application ID or iOS bundle ID |
| `version` | Numeric `major.minor.patch`, such as `0.1.1` |
| `buildNumber` | Android positive integer version code; iOS positive numeric build string, optionally dotted |
| `released` | Boolean `true`, only after verified availability |
| `publishedAt` | Actual UTC publication timestamp in ISO format, such as `2026-10-25T12:00:00.000Z` |
| `url` | Validated HTTPS destination for that channel |

Entries must match the installed platform, channel, and application ID. Android requires a newer
build number and a version at least as new as the installed version. iOS requires a newer marketing
version, or a newer build within the same marketing version. Future publication timestamps,
draft/pending entries, malformed versions, mismatched channels, and untrusted links are ignored.

Google Play URLs must use `play.google.com/store/apps/details` with only `id` set to the installed
package. F-Droid URLs must use `f-droid.org/packages/<installed-package>/`. Apple URLs must use
`apps.apple.com` and the actual configured numeric app ID. Standalone URLs must exactly match the
trusted release page compiled into the installed app. Links with HTTP, credentials, explicit
nonstandard ports, fragments, or unrelated hosts do not qualify. The feed request omits credentials,
rejects redirects, times out after ten seconds, and caps its accepted response size.

`apps/mobile/src/services/updates.ts` exports `parseReleaseManifest` and `selectAvailableRelease`
for runtime and release-tool validation. A syntactically valid feed is not proof of public store
availability; the publisher must perform that check before committing a released entry. Removing
an unavailable entry stops future checks from offering it; it cannot retract a link already shown
on a phone until that phone fetches the feed again.
