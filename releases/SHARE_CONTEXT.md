# Share Context

Send this page or its QR code to someone with an **Android phone**. The setup follows new phone releases automatically; this link does not change for each release.

![Install Context and set up updates](context-install-qr.png)

1. [Install Obtainium](https://f-droid.org/en/packages/dev.imranr.obtainium.fdroid/).
2. [Add Context and its update settings](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522com.context.minuteledger%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Fkhushbakhtm-star%252Fcontext%2522%252C%2522author%2522%253A%2522khushbakhtm-star%2522%252C%2522name%2522%253A%2522Context%2522%252C%2522preferredApkIndex%2522%253A0%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522includePrereleases%255C%2522%253Atrue%252C%255C%2522includeDrafts%255C%2522%253Afalse%252C%255C%2522apkFilterRegEx%255C%2522%253A%255C%2522%255Econtext-%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B-wear-phone-preview%255C%255C%255C%255C.apk%2524%255C%2522%252C%255C%2522invertAPKFilter%255C%2522%253Afalse%252C%255C%2522autoApkFilterByArch%255C%2522%253Afalse%252C%255C%2522verifyLatestTag%255C%2522%253Afalse%252C%255C%2522sortMethodChoice%255C%2522%253A%255C%2522date%255C%2522%252C%255C%2522releaseTitleAsVersion%255C%2522%253Afalse%252C%255C%2522trackOnly%255C%2522%253Afalse%252C%255C%2522versionDetection%255C%2522%253Atrue%252C%255C%2522releaseDateAsVersion%255C%2522%253Afalse%252C%255C%2522useVersionCodeAsOSVersion%255C%2522%253Afalse%252C%255C%2522skipUpdateNotifications%255C%2522%253Afalse%257D%2522%252C%2522allowIdChange%2522%253Afalse%257D), review the configuration, and confirm.
3. In Obtainium, choose **Install**. Allow installation and notifications when Android asks. Keep background updates enabled globally and for Context.

The configuration selects the phone APK, includes previews, and excludes watch and older FOSS-edition downloads. Existing users should keep Context installed and choose **Update** to preserve their ledger.

Obtainium checks new releases and can install updates in the background on supported Android 12+ devices when it is the app's installer. This is best effort; otherwise it notifies the user to tap Update. [Update requirements](https://wiki.obtainium.imranr.dev/app_tracking/)

Context is a preview. Direct Google account connection is still limited to approved test accounts; on-device calendars and the local ledger use the phone's permissions. iPhone distribution through TestFlight or the App Store is not available yet. The watch companion has a [separate setup](../apps/mobile/wear-support/README.md).

For manual setup, see [Android updates](ANDROID_UPDATES.md). Public builds and source are in [Context releases](https://github.com/khushbakhtm-star/context/releases).
