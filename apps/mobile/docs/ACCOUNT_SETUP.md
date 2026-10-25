# Account connections for Context

The account integrations are native app integrations. They run on the user's phone and require no
client secret in the app and no Context service with access to the private ledger. Both phones must
use the same app registration and authorize the same storage account to exchange ledger batches.

## Google registration

1. Create a Google Cloud project and enable **Google Calendar API** and **Google Drive API**.
2. Configure the OAuth consent screen and add test users while the app is in testing.
3. Create Android OAuth clients for `com.context.minuteledger` and every signing certificate SHA-1
   used by development, preview, and production builds.
4. Create an iOS OAuth client for `com.context.minuteledger`, plus a Web OAuth client in the same
   project. The web client ID identifies the native sign-in configuration; no web client secret is
   shipped in Context.
5. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in the build
   environment. The iOS URL scheme must be the reversed iOS client ID (for example,
   `com.googleusercontent.apps.123-example`). Configure it in the Google Sign-In Expo plugin before
   rebuilding.
6. Review Google's OAuth verification requirements before public distribution. Google Calendar
   access and Drive app-data access must be enabled in the consent configuration.

The native Google SDK maintains one active Google user per installation. Context verifies the
native user ID before requesting or using a token. Connecting a different Google identity replaces
the previous Google connection on that installation; Microsoft can remain connected alongside it.

Context requests Drive's `drive.appdata` scope only when private ledger storage is enabled. It uses
`calendar.events` for calendar write access, or `calendar.events.readonly` for read-only access,
plus `calendar.calendarlist.readonly` to list calendars. These scopes do not grant access to all
ordinary Drive documents.

## Microsoft registration

1. Register Context in Microsoft Entra ID. Choose supported account types that match the intended
   audience (personal Microsoft accounts and organizational accounts, if both are needed).
2. Add a **Mobile and desktop applications** redirect URI exactly matching
   `context://oauth/microsoft` and enable native/public-client authorization code flow. Do not
   register this URI as a single-page web application and do not create a client secret for the app.
3. Add delegated Microsoft Graph permissions `User.Read`, `Files.ReadWrite.AppFolder`, and the
   required calendar permissions (`Calendars.Read` or `Calendars.ReadWrite`). Organizational
   administrators may need to grant consent under their tenant's policy.
4. Set `EXPO_PUBLIC_MICROSOFT_CLIENT_ID`. `EXPO_PUBLIC_MICROSOFT_TENANT` defaults to `common`;
   set it to a tenant ID or `consumers`/`organizations` when the app registration requires that.
   `EXPO_PUBLIC_MICROSOFT_REDIRECT_URI` can override the redirect but must match the registration.
5. Rebuild the native app after changing these values.

Microsoft uses authorization code flow with PKCE in the system browser. OAuth state and the code
verifier are managed by Expo AuthSession. Refresh credentials are stored in the phone's secure
storage, with device-only keychain accessibility on iOS. OneDrive ledger files are limited to the
application folder exposed by `Files.ReadWrite.AppFolder`.

## Other providers through WebDAV

Context can synchronize its encrypted private ledger through a WebDAV service such as Nextcloud.
This is storage access only; WebDAV does not add calendar integration. Google and Microsoft
calendar connections can be used alongside it.

1. Create a dedicated folder named `Context` in the provider's files interface.
2. Obtain its final HTTPS WebDAV folder URL. For Nextcloud, an example is
   `https://cloud.example.com/remote.php/dav/files/USERNAME/Context/`.
3. Create a provider app password, then enter the folder URL, username, and app password in
   **Accounts & Sync → Other storage · WebDAV**. Use the same folder and ledger passphrase on both
   phones. An app password is stored only in the phone's secure credential storage.
4. Grant that app password the narrowest folder access the provider supports. Context requests
   only the selected folder and its direct `context-*.json` children, and never creates folders.

The service must support `PROPFIND` with `Depth: 1`, HTTPS, and conditional file creation using
`PUT` with `If-None-Match: *`. Redirects are refused; use the provider's final folder URL. Only
direct batch files in the chosen origin/folder are read. Ledger responses are capped at 16 MiB and
directory listings at 4 MiB. XML entities and external-document declarations are not supported. Reconnect the same
folder to update its saved app password, or disconnect it to remove that credential from the phone.

## Storage and permission behavior

Context uploads immutable encrypted JSON batch files whose names start with `context-`. The engine
must persist both the pending filename and encrypted bytes before uploading; retries use the same
name and bytes. Google uploads use preallocated file IDs to recover a response lost after creation.
Microsoft uploads use conflict-fail behavior and verify an existing batch on retry.

Disabling a permission stops new requests using that permission inside Context. Disconnecting
removes the local account and Microsoft credential; it does not delete previously synchronized
ledger files or revoke the provider's existing grant. The user can revoke that grant in their Google
or Microsoft account settings. A native request already in flight may finish when a permission is
disabled.

No provider client IDs are included in this repository. Until the app owner configures the
registrations and builds the app, connection buttons return a configuration-needed message.

## References

- [Expo authentication](https://docs.expo.dev/guides/authentication/)
- [Native Google Sign-In API](https://react-native-google-signin.github.io/docs/original)
- [Google Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Microsoft native authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft OneDrive application folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)
- [Nextcloud WebDAV access and app passwords](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html)
- [WebDAV protocol](https://www.rfc-editor.org/rfc/rfc4918)
