# Update Context on Android

After a one-time setup, open **Obtainium → Context → Update** when a new version is available.
You do not need to find and download a new APK manually each time. The updater handles the download.

Context's preview APKs currently come from [the publisher's GitHub releases](https://github.com/khushbakhtm-star/context/releases).
The official F-Droid listing is still pending; no custom Context F-Droid repository has been published.

1. Install **[Obtainium from its verified F-Droid listing](https://f-droid.org/en/packages/dev.imranr.obtainium.fdroid/)** on your Android phone.
2. On the phone, tap **[Add Context to Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522com.context.minuteledger%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Fkhushbakhtm-star%252Fcontext%2522%252C%2522author%2522%253A%2522khushbakhtm-star%2522%252C%2522name%2522%253A%2522Context%2522%252C%2522preferredApkIndex%2522%253A0%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522includePrereleases%255C%2522%253Atrue%252C%255C%2522includeDrafts%255C%2522%253Afalse%252C%255C%2522apkFilterRegEx%255C%2522%253A%255C%2522%255Econtext-%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B%255C%255C%255C%255C.%255B0-9%255D%252B-foss-preview%255C%255C%255C%255C.apk%2524%255C%2522%252C%255C%2522invertAPKFilter%255C%2522%253Afalse%252C%255C%2522autoApkFilterByArch%255C%2522%253Afalse%252C%255C%2522verifyLatestTag%255C%2522%253Afalse%252C%255C%2522sortMethodChoice%255C%2522%253A%255C%2522date%255C%2522%252C%255C%2522releaseTitleAsVersion%255C%2522%253Afalse%252C%255C%2522trackOnly%255C%2522%253Afalse%252C%255C%2522versionDetection%255C%2522%253Atrue%252C%255C%2522releaseDateAsVersion%255C%2522%253Afalse%252C%255C%2522useVersionCodeAsOSVersion%255C%2522%253Afalse%252C%255C%2522skipUpdateNotifications%255C%2522%253Afalse%257D%2522%252C%2522allowIdChange%2522%253Afalse%257D)**. Review the configuration before confirming. It includes preview releases and selects only Context's universal FOSS preview APK.
3. If Context is already installed, keep that installation. Let Obtainium check its installed version. Allow Obtainium to install app updates when Android asks.
4. When Obtainium shows an update for Context, tap **Update** and approve Android's update prompt.

If the link does not open, use Obtainium's **Add App** screen with this source:

```text
https://github.com/khushbakhtm-star/context
```

Enable **Include prereleases** and set **Filter APKs by regular expression** to:

```text
^context-[0-9]+\.[0-9]+\.[0-9]+-foss-preview\.apk$
```

The link's configuration is saved in [context-obtainium.json](context-obtainium.json).
It contains no account credentials or installed-version claims. This is a single-app deep-link
configuration, not an Obtainium backup file.

Updates keep the existing Context installation and its ledger. Do not uninstall Context to apply
an update. Android requires the same app identity and a compatible signing certificate; each new
release must also have a higher version code. An unexpected signing error needs investigation,
rather than uninstalling the app and losing its local data.

You can optionally enable Obtainium's background checks and notifications, then allow notifications
in your phone's settings. Phone background limits still apply. Automatic installation has additional
Android and installer-ownership requirements; the **Update** button remains available.
Obtainium can check releases while Context is closed.

On iPhone, updates will use the App Store or TestFlight after Apple enrollment and distribution
are configured. Obtainium is an Android updater.

Sources: [Obtainium links](https://wiki.obtainium.imranr.dev/deep_links/),
[release-source settings](https://wiki.obtainium.imranr.dev/sources/),
[installed versions and background updates](https://wiki.obtainium.imranr.dev/app_tracking/),
[Android signing](https://developer.android.com/studio/publish/app-signing),
[Android versioning](https://developer.android.com/studio/publish/versioning).
