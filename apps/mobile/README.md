# Context mobile

Context is an Android/iPhone minute ledger with direct Google and Microsoft account connections,
encrypted ledger synchronization, and a device-calendar bridge for other calendars.

## Everyday use

- Tap a minute cell on Today to type or dictate directly in the grid. Text saves after a short pause,
  when leaving the cell, and when the app leaves the foreground. Neighboring entries stay visible.
- Tap the active minute cell again to open its color/details popup. An explicitly colored minute
  can stay blank and still count toward its activity's time totals. Choose **Details** in the popup
  for ranges spanning midnight and advanced calendar-source controls. Holding or dragging text
  inside the active input retains normal text selection.
- The bottom editing bar applies bold, italic, and text color to a cell or selected minute range.
  The **+** control selects a range for grouping, filling, or clearing. Formatting an empty cell does not record
  an activity or add time to reports. Activity color and text color remain separate controls.
- Hold an inactive cell, then tap the last cell in the same day to select a range and open its
  **Auto fill / Group** popup. The **+** control also opens that popup with editable range times.
- With no minute selected, **+** opens the phone calendar's new-event form. Its date fields use
  that calendar app's date picker. With a minute selected, the editing bar's **+** opens range actions.
- To make one activity from several cells, tap a minute, choose **+**, set the first and last minute,
  enter an activity title, choose its color, and tap **Group**. The last minute is included. Every
  cell keeps its own note and remains editable directly in the grid. Blank grouped minutes also
  count toward the activity's time. Group members use a solid activity-color fill and a title badge;
  open **+** from a member to edit the group. Tapping the title area follows the same inline-entry
  behavior as the rest of the cell. **Auto fill** copies a nonblank active
  minute's text with the chosen activity color. An empty source preserves occupied target notes.
- Activity/group color choices use [documented Google Calendar hex colors](https://developers.google.com/apps-script/reference/calendar/color)
  plus exact colors imported from connected [Google palettes](https://developers.google.com/workspace/calendar/api/v3/reference/colors)
  and [calendar labels](https://developers.google.com/workspace/calendar/api/guides/labels). This offline fallback
  does not claim to enumerate the current 24-color event picker. Arbitrary new activity hex values are unavailable.
  Historical activity colors remain intact, and text formatting retains its separate palette.
- Tap today's date number in the header to return to the current minute in today's column.
- Choose **12-hour** or **24-hour** in the calendar header's view menu. The preference is saved
  on this phone. The minute column measures the selected time label and uses minimal padding;
  for example, the 24-hour display shows `13:11` without an AM/PM suffix.
- Pinch to zoom both axes, or use the zoom controls in the header's view menu. Wider day columns
  scroll horizontally while minute labels remain fixed. Zoom is remembered separately on each phone.
- Undo and redo restore Context entries and cell formatting within the running editing session.
  Changes already sent to calendars, especially invitation cancellations, may need separate review.
- Connect accounts under **Settings → Accounts & phone synchronization**.
- Grant ledger storage, calendar reading, calendar writing, original-occurrence replacement, and
  calendar-edit import separately. Each can be disabled later.
- Select the calendars to display and the default calendar for actual activity.
- Manage any number of activity categories under Settings. Import Google event colors/custom labels,
  Outlook master categories, or device-calendar colors; create, rename, recolor, or archive your own.
  Provider mappings use that calendar's available palette/labels rather than inventing unsupported colors.
- The Reports tab filters one category or all categories for a chosen day, week, month, or year.
  The Week tab keeps the chronological view.
- When confirming an original account-calendar plan, the editor's **Replace this plan occurrence**
  switch links the saved activity to that one event instance. Other days of a recurring series keep
  their original schedule. Turning the switch off records a separate actual activity.
- Invitation editing and whole-series editing have separate account permissions. Selecting
  **Recurring series** or changing an invitation asks for confirmation before the source change.
  The provider's own organizer/guest permissions still apply, and it may notify attendees.
- Changes to linked calendar titles, times, timestamped description lines, and deletions flow back
  into the minute ledger when edit import is enabled. Concurrent local/calendar changes require a
  choice in account settings. Retained ledger alternatives can also be restored there.
- Sleep spanning midnight stays one calendar activity. Interruptions split it into separate blocks;
  filling the interruption later retires redundant child events.

## Synchronize two phones

Install the same configured app on both phones, authorize the same Google or Microsoft storage
account (or the same dedicated WebDAV folder), and enter the same encryption passphrase. Ledger
batches are AES-256-GCM encrypted on the phone before upload. The passphrase stays in secure device
storage. Calendar notes remain readable to the people who can access that calendar.

Synchronization runs after edits, while Context is open, on returning to the foreground, or through
**Sync now**. A phone can keep recording offline. Durable revisions, tombstones, per-account upload
acknowledgments, immutable upload files, and retained alternatives allow the phones to converge
without reviving deleted minutes. This version does not promise background delivery while the app
is terminated. Do not use different passphrases for the same ledger; changing keys requires a future
explicit migration workflow.

The storage implementations are Google Drive's private app-data area, Microsoft's OneDrive app
folder, and an existing dedicated HTTPS WebDAV folder. Storage access does not require granting
calendar changes. Google and Microsoft are the direct calendar providers; other calendars can still
be displayed through the phone's calendar database. Additional account services can implement the
LedgerStorage interface.

## Build and account configuration

The app owner must create the Google OAuth clients and Microsoft app registration. No client IDs,
secrets, provider credentials, or user accounts are provisioned by this repository. See
[ACCOUNT_SETUP.md](docs/ACCOUNT_SETUP.md) and copy .env.example to .env.local with the public client
IDs. app.config.ts derives the Google iOS callback scheme at native build time. Android Google
sign-in requires the matching package name and signing-certificate SHA-1 registration.

1. Install dependencies with `pnpm install`.
2. Sign in using `pnpm --package=eas-cli@25.3.0 dlx eas login`.
3. Configure EAS using `pnpm --package=eas-cli@25.3.0 dlx eas build:configure`.
4. Android APK: `pnpm --package=eas-cli@25.3.0 dlx eas build --profile preview --platform android`.
5. iPhone development build: `pnpm --package=eas-cli@25.3.0 dlx eas build --profile development --platform ios`.
6. Install a development build, then use `pnpm start` for the development client.

Calendar, secure storage, and native Google sign-in require a native development/preview build;
Expo Go is insufficient. Signed iPhone distribution needs the app owner's Apple developer access.
After changing native auth configuration, rebuild both apps.

Google Play/App Store production profiles and an F-Droid build path are documented in
[DISTRIBUTION.md](docs/DISTRIBUTION.md). A source checkout is not a published store listing.

## Verification

- `pnpm run typecheck`
- `pnpm test`
- `pnpm exec expo export --platform android --output-dir dist-android`
- `pnpm exec expo export --platform ios --output-dir dist-ios`

The tests use actual SQLite and encryption with mocked HTTP/OAuth. Provider consent screens,
signing, native redirects, and live calendar behavior still require configured accounts and
physical-phone validation. JavaScript exports are not signed APK/IPA files.

## Current boundaries

The day grid retains 1,440 civil labels. Calendar endpoints are resolved in the activity's captured
IANA zone, so travel and offset changes do not silently move events. Ambiguous repeated-hour
endpoints and repeated-hour calendar imports are held for review; the grid still needs a full
instant/fold migration to show both occurrences separately. Summaries count recorded civil slots.

The account layer manages direct-account projections created by this version. Old device-only
projections keep their existing device mappings until explicitly relinked; native IDs cannot be
assumed to equal cloud provider IDs. Account writing takes over from native writeback to avoid
writing both copies. Select a calendar through one connection path to avoid duplicate plan overlays.

Local SQLite content is protected by the device rather than a separate database password. Cloud
ledger files are encrypted; calendar descriptions use the calendar provider's normal sharing and
retention. Disconnecting stops future access and removes local account credentials, but keeps local
history and previously stored provider files/events. Immutable files currently accumulate; scheduled
compaction and a coordinated cloud-delete/key-rotation flow are future work.
