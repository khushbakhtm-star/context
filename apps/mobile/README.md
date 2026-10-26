# Context mobile

Context is an Android/iPhone minute ledger with direct Google and Microsoft account connections,
encrypted ledger synchronization, and a device-calendar bridge for other calendars.

## Everyday use

- In the **Day** grid, tap a minute cell once to select it. Double-tap the cell to edit its existing
  text or enter a new note directly in the grid; the phone keyboard can also provide dictation.
  Neighboring entries stay visible. Text saves after a short pause, when leaving the cell, and when
  the app leaves the foreground. The keyboard checkmark saves the latest text and closes the
  keyboard while retaining the selected cell. A failed save keeps the draft available for retry.
- While editing, hold the text to use the phone's selection handles and native **Cut / Copy / Paste**
  actions on part of the text. Double-tap another cell to edit it, place the caret, then use native
  **Paste**. These actions transfer text only; each cell keeps its own activity, fill, and formatting.
  Close editing with the keyboard checkmark before holding a cell for whole-cell actions.
- Hold a selected cell outside text editing to open the compact cell-action menu. Blank selections
  offer **Cut / Copy / Paste**. Text selections also offer **Clear** and formatting controls for
  **Bold**, **Italic**, **Underline**, text color, and activity fill. Available range actions depend on
  the selection's contents; grouped minutes also offer **Ungroup**. Menu actions use one completed
  tap even while the grid was scrolling or the keyboard was open. You can tap another minute cell
  without first dismissing the menu; holding or scrolling across a command does not execute it.
- To select several minutes, tap the source cell and drag its small corner handle up or down within
  that day. The grid scrolls at its top and bottom edges. Releasing opens the cell-action menu while
  keeping the grid visible. Both endpoints are included. **AutoFill** is available when the range
  contains one distinct nonblank text, with optional blank cells; it fills from a populated source
  even when that source is below the other selected minutes. Different notes can be grouped without
  being overwritten by AutoFill.
- **AutoFill** copies the source minute's text, activity color, and cell formatting into the selected
  minutes. Each minute remains independently editable. **Undo** restores the previous target values.
  Activity fill and text color are separate controls; formatting an empty cell alone does not record
  time. **Clear** removes minute text while retaining its fill, formatting, and group membership.
- Choose **Group** for a selected range, enter its activity title in the compact inline bar, choose a
  fill with the circle, and press **Group**. Every minute keeps its own note, including distinct notes
  within the same activity. Blank group members count toward the activity's time. **Ungroup** removes
  the selected minutes from that activity; any remaining portions above and below become separate
  groups. Hold a grouped cell longer, then drag to move the complete activity to another minute or
  day, preserving its minute notes and formatting.
- Whole-cell **Cut / Copy** captures the selected cells' text, activity fills, and formatting. Select a
  destination and hold it for **Paste**. There is no copied/cut notification banner. Context asks for
  **Replace** confirmation if destination cells contain entries or formatting. Cut leaves its source
  intact until Paste moves the cells in one transaction; **Undo** restores source and destination
  together. This whole-cell clipboard stays inside Context, supports repeated Copy/Paste, and clears
  when the app process ends. It is separate from the phone's text clipboard. Record a minute before
  moving it; an untouched calendar plan is edited through its explicit **Event** action.
- A cell with a source calendar plan offers **Event** in its whole-cell menu. This deliberately opens
  the detailed editor for source-event and recurring-series controls, including ranges crossing
  midnight. Selecting or double-tapping a cell does not open an automatic color/details or range
  popup, and there is no bottom editing toolbar.
- The top row contains the three-bar menu, previous arrow, current-view calendar icon, next arrow,
  **Undo**, **Redo**, and the two-arrow **Sync** icon. The calendar icon matches **Day**, **Week**,
  **Month**, **Year**, or **Schedule**. Tap it once to return to now without changing that view or
  pinch zoom: the minute grid reveals the current minute, Month/Year reveal today, and Schedule
  positions today's heading at the top. A short delay distinguishes a single tap from a double-tap.
  Double-tap the icon to choose **Day / Week / Month / Year / Schedule**; there is no separate
  triangle button. Hold it to choose dates. **Pick** selects individual days; **Range** selects a
  continuous span of up to 28 days. Up to seven selected days show minute columns; larger selections
  use a calendar overview. Going to now clears a custom date selection so today can be displayed.
- Pinch to zoom the minute rows and day columns. Wider columns scroll horizontally while the time
  rail remains fixed. Zoom is remembered separately on each phone. Choose **12-hour** or **24-hour**
  only in **Settings**; the minute column fits the selected time labels, such as `13:11`. Light,
  dark, and system appearance are also available in Settings.
- The three-bar menu opens **Dashboard**, **Print**, **Search**, and **Settings**, in that order.
  Explanations in Settings and account controls are available through their information icons.
  Hold **Sync** to read any synchronization error; the icon has no added information badge.
  **Dashboard** shows recorded time
  by activity color for a day, week, month, or year, with minute/hour totals and percentages. Its
  **Recorded / Unrecorded** toggle distinguishes recorded activity from the remaining civil-minute
  slots; future slots are unrecorded too. Calendar plans alone are not recorded ledger time.
- **Print** lets you choose dates, view, orientation, and colors, with additional schedule or
  Dashboard options. **Save PDF** opens the phone's PDF sharing/saving flow; **Print** opens the system
  print dialog. Full minute notes can be included without depending on a calendar provider's
  description limit. Context does not automatically select or contact a printer.
- When no cell is selected, the floating **+** opens the phone calendar's new-event form. It requires
  read access and an available calendar checked under
  **Settings → Calendar connection → Calendars used for plans**. If either is missing, Context guides
  you to Settings without selecting a calendar for you. Save into a checked calendar so its event
  appears in Context. Plans refresh after the editor closes, on returning to Context, while the grid
  remains open, and through the top **Sync** control. The phone's calendar provider may need time to
  synchronize.
- If plans are missing, use **Settings → Calendar connection → Check connection** for the selected
  date. Local diagnostics show per-calendar counts or error codes without event titles or
  descriptions. One unreadable calendar does not discard other readable plans. Linked calendar color
  changes can fill the corresponding actual minutes on refresh without replacing their notes;
  unsaved local text and simultaneous local/calendar changes are held for review.
- Activity/group color choices use [documented Google Calendar hex colors](https://developers.google.com/apps-script/reference/calendar/color)
  plus exact colors imported from connected [Google palettes](https://developers.google.com/workspace/calendar/api/v3/reference/colors)
  and [calendar labels](https://developers.google.com/workspace/calendar/api/guides/labels). This offline fallback
  does not claim to enumerate the current 24-color event picker. Arbitrary new activity hex values are unavailable.
  Displayed plans use their provider's event color when available, otherwise the calendar color;
  this does not expand the manual activity picker. Historical activity colors remain intact, and
  text formatting retains its separate palette.
- Undo and redo restore Context entries and cell formatting within the running editing session.
  Changes already sent to calendars, especially invitation cancellations, may need separate review.
- Connect accounts under **Settings → Accounts & phone synchronization**.
- Grant ledger storage, calendar reading, calendar writing, original-occurrence replacement, and
  calendar-edit import separately. Each can be disabled later.
- Select the calendars to display and the default calendar for actual activity.
- Manage any number of activity categories under Settings. Import Google event colors/custom labels,
  Outlook master categories, or device-calendar colors; create, rename, recolor, or archive your own.
  Provider mappings use that calendar's available palette/labels rather than inventing unsupported colors.
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

Calendar descriptions can compact consecutive identical notes into time ranges while the private
ledger keeps every minute editable. Update both participating Android phones to 0.1.13 before
exchanging version-two calendar descriptions; older clients refuse this newer compact format.

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
