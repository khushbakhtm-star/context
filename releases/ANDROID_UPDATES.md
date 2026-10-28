# Update Context on Android

## Fix “installed 0.1.9, latest 0.1.8”

The original setup followed the FOSS phone edition when its latest APK was 0.1.8 (version code 9). The installed 0.1.9 was the Wear-enabled phone edition (code 10). The **10 → 9** error meant the selected APK would downgrade the app. Both phone editions now offer **0.1.25 (code 26)**.

For an S23 paired with a Galaxy Watch7, or for native Google account sign-in, keep the Wear-enabled phone route and update its existing Obtainium entry using these steps:

1. Open **Obtainium → Context** and confirm its source URL is `https://github.com/khushbakhtm-star/context`.
2. Tap the **pencil** (additional options).
3. Turn **Include prereleases** on, turn **Verify latest tag** off, and set **Sort method** to **Date**.
4. Replace **Filter APKs by regular expression** with:

   ```text
   ^context-[0-9]+\.[0-9]+\.[0-9]+-wear-phone-preview\.apk$
   ```

5. Return to Context’s details to apply the options, then refresh and tap **Update**. Dismiss the keyboard first if needed. It should offer **0.1.25**.

Keep Context installed so its ledger stays on the phone. Change the existing entry; do not add a duplicate entry for the same app or uninstall Context.

## Set up tracking on a new phone

Install [Obtainium from its verified F-Droid listing](https://f-droid.org/en/packages/dev.imranr.obtainium.fdroid/), then choose the phone edition:

| Phone edition | Obtainium setup | Saved configuration |
| --- | --- | --- |
| Wear-enabled phone, including Google account connection and the optional watch bridge | [Add Wear-enabled Context](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522com.context.minuteledger%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Fkhushbakhtm-star%252Fcontext%2522%252C%2522author%2522%253A%2522khushbakhtm-star%2522%252C%2522name%2522%253A%2522Context%2522%252C%2522preferredApkIndex%2522%253A0%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522includePrereleases%255C%2522%253Atrue%252C%255C%2522includeDrafts%255C%2522%253Afalse%252C%255C%2522apkFilterRegEx%255C%2522%253A%255C%2522%255Econtext-%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B-wear-phone-preview%255C%255C%255C%255C.apk%2524%255C%2522%252C%255C%2522invertAPKFilter%255C%2522%253Afalse%252C%255C%2522autoApkFilterByArch%255C%2522%253Afalse%252C%255C%2522verifyLatestTag%255C%2522%253Afalse%252C%255C%2522sortMethodChoice%255C%2522%253A%255C%2522date%255C%2522%252C%255C%2522releaseTitleAsVersion%255C%2522%253Afalse%252C%255C%2522trackOnly%255C%2522%253Afalse%252C%255C%2522versionDetection%255C%2522%253Atrue%252C%255C%2522releaseDateAsVersion%255C%2522%253Afalse%252C%255C%2522useVersionCodeAsOSVersion%255C%2522%253Afalse%252C%255C%2522skipUpdateNotifications%255C%2522%253Afalse%257D%2522%252C%2522allowIdChange%2522%253Afalse%257D) | [context-wear-obtainium.json](context-wear-obtainium.json) |
| FOSS phone, without the optional Google Wear transport | [Add FOSS Context](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522com.context.minuteledger%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Fkhushbakhtm-star%252Fcontext%2522%252C%2522author%2522%253A%2522khushbakhtm-star%2522%252C%2522name%2522%253A%2522Context%2522%252C%2522preferredApkIndex%2522%253A0%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522includePrereleases%255C%2522%253Atrue%252C%255C%2522includeDrafts%255C%2522%253Afalse%252C%255C%2522apkFilterRegEx%255C%2522%253A%255C%2522%255Econtext-%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B-foss-preview%255C%255C%255C%255C.apk%2524%255C%2522%252C%255C%2522invertAPKFilter%255C%2522%253Afalse%252C%255C%2522autoApkFilterByArch%255C%2522%253Afalse%252C%255C%2522verifyLatestTag%255C%2522%253Afalse%252C%255C%2522sortMethodChoice%255C%2522%253A%255C%2522date%255C%2522%252C%255C%2522releaseTitleAsVersion%255C%2522%253Afalse%252C%255C%2522trackOnly%255C%2522%253Afalse%252C%255C%2522versionDetection%255C%2522%253Atrue%252C%255C%2522releaseDateAsVersion%255C%2522%253Afalse%252C%255C%2522useVersionCodeAsOSVersion%255C%2522%253Afalse%252C%255C%2522skipUpdateNotifications%255C%2522%253Afalse%257D%2522%252C%2522allowIdChange%2522%253Afalse%257D) | [context-obtainium.json](context-obtainium.json) |

Review the configuration before confirming. These are single-app links, not backup files; they contain no credentials or installed-version claims. Both phone editions use the same application ID, so track only the edition installed on the phone.

For manual setup, use the same repository URL, enable prereleases and choose the matching APK filter. The Wear-enabled filter is above; the FOSS filter is:

```text
^context-[0-9]+\.[0-9]+\.[0-9]+-foss-preview\.apk$
```

The FOSS route now selects **0.1.25 (code 26)**. It omits native Google account sign-in and the optional Wear transport. Use the Wear-enabled phone route for a paired watch or native Google sign-in. Neither phone filter installs the separate watch APK. Context's previews come from [the publisher's GitHub releases](https://github.com/khushbakhtm-star/context/releases). Official F-Droid inclusion remains pending; no custom Context F-Droid repository has been published.

## Receive future updates

Open **Obtainium → Context → Update** when an update is available, then approve Android's update prompt. Obtainium handles the download. If Android asks, allow Obtainium to install updates.

You can enable Obtainium's background checks and notifications, then allow notifications in the phone's settings. Background limits still apply; the **Update** button remains available. Obtainium can check releases while Context is closed.

Updates require the same application identity, a compatible signing certificate and a higher version code. Investigate an unexpected signing error instead of uninstalling Context and losing its local ledger.

On iPhone, updates will use the App Store or TestFlight after Apple enrollment and distribution are configured. Obtainium is an Android updater.

Sources: [Obtainium links](https://wiki.obtainium.imranr.dev/deep_links/),
[release-source settings](https://wiki.obtainium.imranr.dev/sources/),
[installed versions and background updates](https://wiki.obtainium.imranr.dev/app_tracking/),
[Android signing](https://developer.android.com/studio/publish/app-signing),
[Android versioning](https://developer.android.com/studio/publish/versioning).

## Galaxy Watch7 tile and watch update

The separate [Watch 0.1.10 APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.10/context-0.1.10-wear-preview.apk)
adds a **Record now** tile and current-minute entry. Install it on the watch as an Update
using the previously paired PC; phone Obtainium filters update their phone edition.
After updating, swipe left from the watch face to **Add tiles**, then select **Context**.
The [watch release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10)
includes the exact source, signatures, compiled Tile and package verification receipts.
