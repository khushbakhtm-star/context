# Context on Galaxy Watch7

## Current matching releases

Use the [Wear-enabled phone 0.1.26/code27](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.25

Use the [Wear-enabled phone 0.1.25/code26](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.24

Use the [Wear-enabled phone 0.1.24/code25](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.23

Use the [Wear-enabled phone 0.1.23/code24](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.22

Use the [Wear-enabled phone 0.1.22/code23](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.21

Use the [Wear-enabled phone 0.1.21/code22](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.20

Use the [Wear-enabled phone 0.1.20/code21](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.19

Use the [Wear-enabled phone 0.1.19/code20](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

This companion uses Wear OS. It opens at the current minute and lets you scroll earlier or later minutes, move between dates, and tap a minute to type or dictate a remembered activity. The editor keeps the selected date and minute while you write. **Now** returns to the current minute. A downloaded day is available offline.

## Matching phone edition

The companion needs the **Wear-enabled Android phone APK**, not the FOSS preview APK. Both APKs must use application ID com.context.minuteledger and the same signing certificate. Existing publisher-signed phone previews can be updated in place; keep Context installed to retain its ledger. Never uninstall merely to work around a signing error.

In the phone app, open **☰ → Settings → Paired watch** and turn on **Allow paired watch access** after reading the explanation. This permits the paired watch to read requested days and write minute notes. It starts off. Keep Context open on the phone while synchronizing.

A watch save first commits a private local journal. **Waiting for phone** means the phone has not confirmed the ledger write yet; the note remains on the watch. Reopening Context on the phone applies waiting edits. If the same minute changed on both devices, review both notes in phone Settings and choose **Keep phone note**, **Append watch note**, or **Use watch note**. A newer phone edit requires a fresh review.

Turning watch access off stops further phone transport and withdraws queued phone snapshots when Play services is available. Previously downloaded watch data and unsaved watch notes remain on the watch. Access is granted to the paired app through Wear OS Data Layer; Context does not request another calendar account login on the watch.

## Install a verified preview

Release assets are published only after the actual native builds and package/signing checks pass. Until then, this guide is source preparation, not a claim that a watch release is available.

1. Update the phone with the release's **wear-phone-preview.apk** asset. Choose **Update**, keeping the current installation.
2. Install the matching **wear-preview.apk** asset on the watch. A phone APK cannot run as a watch APK.
3. Open both apps, enable paired watch access on the phone, and allow synchronization to complete.

Without a configured Play Store publisher release, watch installation uses Wear OS wireless debugging from a computer. The user must enable this access and approve pairing on the watch. The pairing port and connection port are different. Android's official platform tools then support:

~~~text
adb pair WATCH_IP:PAIRING_PORT
adb connect WATCH_IP:CONNECTION_PORT
adb -s WATCH_IP:CONNECTION_PORT install -r PATH_TO_VERIFIED_WATCH_APK
~~~

Enter the code shown by the watch only at the pairing prompt. After installation and testing, turn off wireless debugging if it is no longer needed. This is separate from Context's in-app paired watch access.

## Updates and F-Droid

For the Wear-enabled phone edition, configure Obtainium with the same GitHub repository, Include prereleases, and this APK filter:

~~~text
^context-[0-9]+\.[0-9]+\.[0-9]+-wear-phone-preview\.apk$
~~~

The single-app configuration is [context-wear-obtainium.json](context-wear-obtainium.json). Replace the existing FOSS APK filter when switching editions; do not add another entry for the same installed application. Watch updates require the watch installer until Play distribution is configured. The phone update feed uses a separate standalone-wear channel so it cannot offer the FOSS edition as a Wear update.

The optional watch transport uses Google Play services. Context's F-Droid preparation removes the reviewed native Wear project and phone bridge before scanning/building; that edition does not provide this transport. Official F-Droid inclusion remains under maintainer review. Google Play and Apple distribution still require the publisher accounts and their separate reviews.

Physical checks on the paired Galaxy Watch7 remain required: small round-screen layout, typing/dictation, scrolling, earlier-day entry, midnight, offline save/reconnect, phone restart, conflict review, and access revocation. Source tests and native assembly alone do not establish those results.

Official references: [Wear OS debugging](https://developer.android.com/training/wearables/get-started/debugging), [Data Layer](https://developer.android.com/training/wearables/data/overview), [Android platform tools](https://developer.android.com/tools/releases/platform-tools).

## Watch 0.1.10 dictation update

The separate [Watch 0.1.10 APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.10/context-0.1.10-wear-preview.apk) saves an accepted dictation
result automatically to the minute opened by that editor. Keyboard entry still uses Save.
Install as an Update on the watch; use the Wear-enabled phone 0.1.26. The [release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10)
contains the exact source and automated build/package/signature receipts. Physical dictation
and reconnect behavior still need checking after this watch update.
