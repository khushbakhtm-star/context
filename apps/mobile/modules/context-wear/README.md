# Optional Context Wear phone bridge

This local Android Expo module is MIT-licensed Context source. It is included only
in the Wear-enabled/store phone build and removed from F-Droid source preparation.
Google Play Services Wearable 20.0.1 supplies transport; both apps must have package
`com.context.minuteledger` and the same signing certificate.

The native API is documented in `../../src/wear/NATIVE_API.md`, and the wire format
is in `../../wear-support/PROTOCOL.md`. Watch access defaults off. The app-private
inbox and consent flag live under Android `noBackupFilesDir`, outside OS backup.
Native transport never writes the ledger: JavaScript applies and deduplicates
edits transactionally, publishes a reply, then acknowledges the native inbox.

The bounded receiver does not log note contents. Queue pressure leaves persistent
watch DataItems and the watch's operation journal intact for a later rescan.
