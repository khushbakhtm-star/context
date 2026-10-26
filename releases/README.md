# Installed-app update notices

`latest.json` is the public availability feed. It announces the verified public Wear-enabled Android
phone 0.1.12 (build 13), published on 2026-10-26 at 13:15:49 UTC. The FOSS phone and watch remain at
0.1.8, published on 2026-10-25 at 23:54:13 UTC. Official store entries remain absent pending actual
availability. A source tag alone, unpublished upload, review submission, or queued release must not
add a released entry.
The release plan is separate from this feed. Commit an availability entry only after checking
that an ordinary user in the intended audience can actually obtain that exact channel's release.
When a rollout is limited, keep the entry out until availability matches the feed's audience.

## Published 0.1.12 Wear-phone update

[Download the 0.1.12 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.12/context-0.1.12-wear-phone-preview.apk)
from the [release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.12), available since
**2026-10-26 at 13:15:49 UTC**. Choose **Update** and keep Context installed to retain its ledger.
This is the Wear-enabled phone edition, code **13**; the existing watch 0.1.8 remains compatible.
[Share the permanent installation guide and QR code](SHARE_CONTEXT.md) for Obtainium updates.

Generated calendar descriptions now contain timestamped notes without category labels, Context IDs or
footers. Private metadata preserves account event ownership, original descriptions and editable minute
logs. Existing owned legacy events are cleaned on their next authorized update. Uncertain native links
pause for review; enabling account editing alone does not adopt an existing native-calendar event.
Single-phone backups remain supported, and a verified second ledger actor enables peer safeguards.

The release also adds contextual cell menus, group moves and partial Ungroup; direct header controls;
Day/Week/Month/Year/Schedule; Pick or a finger-glide Range of up to 28 days; full source event color
fills; configurable calendar/Schedule/Dashboard PDF printing; and recorded/unrecorded Dashboard bars.

Application source is [`2ef41523c124007968ae10163867d8cba3dc0c87`](https://github.com/khushbakhtm-star/context/commit/2ef41523c124007968ae10163867d8cba3dc0c87).
TypeScript and **426 tests** passed. The [unsigned build](https://github.com/khushbakhtm-star/context/actions/runs/40326992220)
used controller `32d699895851b275fc757308baaf66911bfce3b4`; publisher signing stayed local. The builder
preserves three audited native module identities through R8 so its strict DEX checks remain valid.
The [exact tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40329070841) passed at that source.
Public release **424270052**, APK asset **678216768**, matches the verified local signed APK:
**78,773,362 bytes**, SHA-256 `797c59d1fab41984b8392aa8f0865a4a10f91b74315f27a90704eb82ecf0f8eb`.

The release's attached receipts record native package identity, Google/Wear configuration, native
Print/Sharing/calendar-color definitions, official APK signatures, certificate continuity, 16 KiB ZIP
alignment and packaged UI labels. These checks do not establish physical gestures, printing, calendar
runtime behavior or two-phone synchronization; **physical 0.1.12 validation remains pending**.
Google OAuth remains in Testing. No new FOSS, watch or iOS binary is included; official store and
F-Droid catalog availability remain pending.


## Published 0.1.11 Wear-phone update

[Download the 0.1.11 Wear-phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.11/context-0.1.11-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.11), available
since **2026-10-26 at 05:45:40 UTC**, then open it and choose **Update**. Keep Context installed to
retain its ledger. This is the phone-only 0.1.11/code 12 update; the compatible watch 0.1.8 companion
is unchanged. No new FOSS, watch or iOS binary is included. The verified F-Droid candidate remains 0.1.8.

Gray previous/next arrows flank the calendar icon, which always shows today's date. Tap it to reach
the current minute, or hold it to select exact dates. One to seven selected dates use minute columns;
eight or more use a month overview showing event times and titles. **Day**, **3 days**, and **Week**
remain directly in the main menu. The grid uses pinch zoom, without the old month popup, date-entry
box, zoom buttons or percentage. Choose **12-hour time with AM/PM** or **24-hour time** in Settings.
Settings and account screens use concise action labels with gray information buttons for explanations,
while connection states, errors and review notes remain visible.

The public tag resolves to exact application source
[`0d39268f375721f4f98729100ee8ac8f79b468e8`](https://github.com/khushbakhtm-star/context/commit/0d39268f375721f4f98729100ee8ac8f79b468e8).
TypeScript, **272 tests**, scoped source checks and review passed. The
[unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40275001446) passed
at controller `ebdd7a239d79b6fc995a37f762b6d912fdbd92fa`, with native assembly successful in 6m56s.
Publisher signing followed locally using the existing key, after Expo's monthly Android build quota
was exhausted. The [exact v0.1.11 tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40275968460)
also passed at that application source.

Public release **423894793**, APK asset **677156691**, matches the locally checked signed APK:
**78,548,026 bytes**, SHA-256
`0bf9d623ea93441cbb1629a8536dce6ce295b655ee005540dd7d56eee7497318`.
Native package/version checks, official `apksigner` v2/v3 verification, publisher-certificate continuity
and 16 KiB alignment checks passed. The published verification receipts also confirm the packaged
Google/Wear configuration and required UI strings, with obsolete Today labels absent. These binary
checks do not establish screen layout or gesture behavior; **physical 0.1.11 interface validation remains pending**.

Google OAuth remains in **Testing** for approved accounts. The user confirmed Google sign-in on the
S23 in 0.1.9 and an existing watch note reaching the phone ledger; those observations do not establish
physical 0.1.11 UI validation or encrypted-ledger synchronization between two phones. The earlier
0.1.10/code 11 APK was verified locally but superseded before publication; there is no public 0.1.10
release, tag or availability entry.

## Published 0.1.9 Wear-phone update

[Download the 0.1.9 Wear-phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.9/context-0.1.9-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.9), available
since **2026-10-26 at 03:27:45 UTC**, then open it and choose **Update**. Keep Context installed to
retain its ledger. It uses version 0.1.9/code 10 and the existing compatible publisher certificate.
The existing 0.1.8 watch APK remains compatible and unchanged. No new FOSS or iOS binary is included;
the verified F-Droid candidate remains 0.1.8.

The phone was built from `cf09982de3b70a1278786572a9d0b49264bc7e46` through the
[unsigned GitHub build](https://github.com/khushbakhtm-star/context/actions/runs/40262475236), controlled by
`b9081edfd6c69ff1089307db42b2ae2e708e2ce6`, then signed locally after Expo's monthly Android build
quota was exhausted. The public tag resolves to that exact application source. Public asset
676873751's size/digest match the locally inspected signed APK: 78,515,258 bytes,
SHA-256 `d4f0e5338138d2f489850ac6ff53484faa24cf85493520eea408897b57e8bedd`.
Native identity checks show 0.1.9/code 10, minimum SDK 24 and target SDK 36. Official `apksigner`
v2/v3 verification, publisher-certificate continuity and 16 KiB alignment checks passed.
The [exact v0.1.9 tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40264191419)
also passed at that application source.

Google OAuth is configured for the publisher's approved **Testing** accounts only. The user confirmed
Google sign-in on their Galaxy S23. That confirmation covers sign-in on that phone; synchronization
of the encrypted ledger between two phones remains unverified. The iOS client ID is configured,
but no iOS app was built.

## Install the Android preview update

Open the [0.1.8 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.8), expand
**Assets**, and choose the APK for the device and edition:

| APK | Install on | Included features |
| --- | --- | --- |
| [context-0.1.8-foss-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-foss-preview.apk) | Android phone | Ledger/calendars; excludes the optional Google Wear transport |
| [context-0.1.8-wear-phone-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-phone-preview.apk) | Android phone paired with a Wear OS watch | Ledger/calendars plus the optional native watch bridge |
| [context-0.1.8-wear-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-preview.apk) | Wear OS watch | Native watch companion; requires the matching Wear-enabled phone app |

Choose one phone edition, open its downloaded APK, and choose **Update** over Context 0.1.7.
Keep Context installed to preserve its ledger. Both phone editions use the existing application ID,
compatible publisher certificate and increasing version code 9; the watch uses code 100009.
The watch APK belongs on the watch. Follow the separate [watch setup](../apps/mobile/wear-support/README.md)
for wireless installation. Open the Wear-enabled phone app and explicitly enable **Settings → Paired
watch** access. The native watch app offers a minute list, date navigation, typing/dictation and an
offline note journal. Phone ledger changes apply when Context runs; conflicts retain both versions
for review. The user confirmed that a note entered on their Galaxy Watch7 reached the phone ledger.

The user later confirmed the phone 0.1.7 calendar result on the S23: Check connection showed eight
timed events, and the events then appeared in Today. This resolves that reported blank-calendar
test.

The existing [Obtainium setup](ANDROID_UPDATES.md) selects only `-foss-preview.apk` phone assets.
For a Wear-enabled phone, configure its APK filter to select only:

```text
^context-[0-9]+\.[0-9]+\.[0-9]+-wear-phone-preview\.apk$
```

Keep prereleases enabled. This avoids selecting either the watch APK or the FOSS phone edition as
a Wear-phone update. Context's release checks distinguish `standalone` and `standalone-wear` phone
channels; a release in one channel does not announce an update in the other.

Official F-Droid inclusion remains pending at [request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
These publisher-signed GitHub previews are not official F-Droid, Google Play or Apple store listings.
The F-Droid edition omits the optional Google Wear transport and watch project; an eventual official
F-Droid signer also differs from this publisher-signed watch's required same-signer phone companion.

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
`google-play`, `apple-app-store`, `fdroid`, `standalone`, or `standalone-wear`. A FOSS preview APK is `standalone`, even if it
uses the FOSS dependencies; it cannot be updated by an F-Droid signing key. A clean F-Droid source
build defaults to `fdroid` through its distribution variable. Other unlabelled builds default to
`standalone` rather than guessing which store signed them. The Wear-enabled phone uses embedded
`store` distribution with the separate `standalone-wear` update channel; those are distinct settings.

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
| `channel` | `google-play`, `apple-app-store`, `fdroid`, `standalone`, or `standalone-wear` |
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
