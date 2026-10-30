# Context mobile

## Current published phone builds

Phone **0.1.31/code32** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-foss-preview.apk) updates. Context 0.1.31 moves cell formatting into the selected-cell popup and closes the text bar after saving. The popup centers its icons and offers a circled bold, italic, underlined A for formatting, with matching cut, copy, paste, event-border, Reset and static Sync artwork. Wrapped minute text is measured as a whole before display, fitted to the cell height and width, then shrinks and fades as rows contract. Pinching uses a prewarmed native-animation graph with one value updated per gesture frame, and keeps its preview until the visible labels are ready. Day columns retain their widths. Event titles remain separate from minute notes; exact source identity and conflict checks remain in force. Hold Sync for its actual current step. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.14 release.

## Previous phone release: 0.1.30

Phone **0.1.30/code31** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.30/context-0.1.30-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.30/context-0.1.30-foss-preview.apk) updates. Context 0.1.30 replaces an edited event range while retaining the original calendar event identity. Removed uniform range-fill cells return to their default state; distinct notes outside the new bounds remain private without the old fill or border. The editor uses inclusive Through minutes: Through 07:24 includes the whole 07:24 cell, and Google Calendar ends at 07:25. Pinching uses a passive native-transform preview and commits the minute layout once on release, keeping day-column widths fixed. A tap on the view icon returns to today and now; a press-and-hold opens the view choices. One circular Reset clears text and all formatting. Pencil, hollow scissors and the static Sync circuit use matching strokes. Event titles remain separate from minute notes; exact source identity and conflict checks remain in force. Hold Sync for its actual current step. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.12 release.

## Previous phone release: 0.1.29

Phone **0.1.29/code30** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.29/context-0.1.29-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.29/context-0.1.29-foss-preview.apk) updates. Context 0.1.29 adds a pencil range editor with text, start/end dates and times, and an optional named event border. An overnight span can fill yesterday and today in one undoable edit. The held-cell menu uses compact icons, and vertical zoom changes minute height while retaining the selected day columns. Event titles remain separate from minute notes; exact source identity and conflict checks remain in force. Hold Sync for its actual current step. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.12 release.

## Previous phone release: 0.1.28

Phone **0.1.28/code29** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.28/context-0.1.28-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.28/context-0.1.28-foss-preview.apk) updates. Context 0.1.28 uses a static closed arrow loop while synchronization is active and an open arrow loop while idle. The error badge and accessible Sync status remain visible without a moving spinner. The paired-watch path prioritizes local note acknowledgements over optional day snapshots; cloud synchronization remains independent. Existing phone-linked events retain their original identity. Hold Sync for its actual current step. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.11 release.

## Previous phone release: 0.1.27

Phone **0.1.27/code28** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-foss-preview.apk) updates. Context 0.1.27 schedules the next automatic full account poll 15 seconds after the previous poll completes. A slow active poll no longer immediately starts another full poll when an interval tick has already elapsed. A recently completed manual or edit-triggered account cycle also postpones the next automatic poll. Committed local edits still request prompt synchronization, and manual Sync keeps its existing action and source checks. Existing phone-linked events retain their original identity. Hold Sync for its actual current step. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.26

Phone **0.1.26/code27** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-foss-preview.apk) updates. Context 0.1.26 batches legacy activity-title queries and reads legacy projection minutes through the exact block/date index. A synthetic regression checks a full 1,440-minute unlabeled day using three bounded queries instead of 1,440 scalar reads. Hold Sync to inspect local stage durations, key-derivation backend timings and phone-provider acknowledgements; Copy timings copies only fixed labels and aggregate numbers. A phone-provider acknowledgement confirms a local SDK operation, not upload to Google Calendar. Existing phone-linked events retain their original identity. Hold Sync for its actual current step. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.25

Phone **0.1.25/code26** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-foss-preview.apk) updates. Synchronization observers join existing work without forcing a second full pass. Each pass shares scoped provider color metadata, and confirmed immutable uploads can skip redundant downloads after the passphrase is verified. Existing phone-linked events retain their original identity. Hold Sync for its actual current step. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.24

Phone **0.1.24/code25** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-foss-preview.apk) updates. Encrypted-ledger key preparation uses a dedicated Android native thread with the same 600,000-round PBKDF2 and existing encrypted-file format. Existing phone-linked events retain their original identity. Hold Sync for its actual current step. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.23

Phone **0.1.23/code24** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-foss-preview.apk) updates. Verified Google event palettes and guarded phone-calendar color writeback accompany per-activity review isolation and coalesced account refreshes. Hold Sync for the actual current step. Existing phone-linked events retain their original identity. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.22

Phone **0.1.22/code23** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-foss-preview.apk) updates. Account synchronization starts before optional phone-calendar refreshes; hold Sync for current phase details. Existing phone-linked events retain their original exact connection when explicitly enabled. Local editing stays available and source/ledger checks remain in force. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.21

Phone **0.1.21/code22** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-foss-preview.apk) updates. Minute editing stays available while synchronization runs; slow connections report a retryable state. Private-ledger unlocking preserves the existing encrypted format and permissions. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.20

Phone **0.1.20/code21** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-foss-preview.apk) updates. Only bordered activities create new calendar events. Event titles stay separate from minute notes; Reset cells and guarded source-edit imports preserve the remaining activity boundaries. Automated source/native checks passed; physical-phone and live-calendar behavior still need confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

## Previous phone release: 0.1.19

Phone **0.1.19/code20** is available as [Wear-enabled](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-wear-phone-preview.apk) and [FOSS](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-foss-preview.apk) updates. The minute composer now accounts for the keyboard while retaining the selected minute, draft and cursor. Automated source/native checks passed; physical keyboard behavior still needs device confirmation. Use the Wear-enabled edition with the independent Watch 0.1.10 release.

Context is an Android/iPhone minute ledger with direct Google and Microsoft account connections,
encrypted ledger synchronization, and a device-calendar bridge for other calendars.

## Everyday use

Local ledger rows load independently of optional device-calendar and account source reads. Saved notes
remain available offline while those sources refresh separately.
Where a valid prior account/day snapshot exists, approved Google/Microsoft plans can display
from the device-local cache during a refresh or outage. Changed/revoked account access or
calendar selection excludes that snapshot. Refresh failures remain visible for retry; Print
requires complete readable sources instead of silently printing an offline cache as current.
An account refresh has a ten-second caller deadline. Matching callers share its raw request
for a sixty-second lease; a later retry can replace a stuck request after the lease. Superseded
results are rejected, and old cleanup cannot remove the replacement request.

Account write permission alone does not select an actuals destination or disable the existing
phone-calendar writer. A configured direct-account destination takes that route; source-specific
account projections retain ownership of their exact activity blocks. Native and account imports
must not compete to recolor the same owned activity. Source-event note updates retain its title and
provider color unless a deliberate title or mapped color change is requested. Overlapping account
and phone plans use a stable display order instead of changing with request completion order.

- In the **Day** grid, tap a minute cell once to select it and reveal its bottom text box. Tap that
  box to type or dictate; the box and selected cell mirror the latest text while neighboring entries
  remain visible. Double-tapping a cell focuses this same box. Text saves after a short pause,
  when leaving the cell, and when the app leaves the foreground. The first checkmark saves the
  latest draft, closes the keyboard and replaces the box with **Bold**, **Italic**, **Underline**,
  text-color, fill-color and event-border controls. The second checkmark closes those controls while keeping the
  cell selected. A failed save keeps the draft available for retry.
- While editing in the bottom box, hold the text to use the phone's selection handles and native
  **Cut / Copy / Paste** actions on part of the text. Edit another cell, place the caret, then use native
  **Paste**. These actions transfer text only; each cell keeps its own activity, fill, and formatting.
  Close editing with the keyboard checkmark before holding a cell for whole-cell actions.
- Hold a selected cell outside text editing to open the compact cell-action menu. Blank selections
  offer **Cut / Copy / Paste**. **Clear**, **AutoFill**, **Group**, **Ungroup** and **Reset cells** appear only when
  relevant to the selection; formatting controls appear after saving the bottom text box. The menu
  fits its visible actions instead of filling unused width. Menu actions use one completed
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
  Both color palettes start with **Reset**. Text Reset restores the default text color while keeping
  the words. Fill Reset removes the fill without erasing words or group membership.
- Only named, bordered blocks create new calendar events. Notes outside a border stay private in
  Context. Existing linked events retain their calendar identity and borders. Calendar event titles
  appear once on the border; the individual minute cells contain only their own notes.
- Choose **Group** from a cell selection or the outside-border icon in the formatting bar. Enter an
  event title, choose a fill with the circle, and confirm with the checkmark. A single blank minute
  can also start an event. Every minute keeps its own note; blank members count toward the event's
  duration. Redefining a single event's border retains its existing calendar linkage.
- **Ungroup** detaches selected minutes without erasing their notes. **Reset cells** detaches them
  and clears all text, formatting and fill. Remaining event portions become separately bordered
  blocks; the first remaining portion retains the original approved calendar event. These actions
  are undoable. **Clear** remains text-only. Hold a grouped cell longer, then drag to move the whole
  event to another minute or day, preserving its title, minute notes and formatting.
- Hold a recorded cell or selected minute range longer, then drag its preview to another minute or
  visible date. The source stays intact until a successful drop. Occupied destinations require
  **Replace** confirmation, and one **Undo** restores both locations. Moving part of a named group
  detaches that portion and splits the remaining portions; moving a complete group retains its
  existing approved calendar-event identity. Moving cells does not replace the clipboard.
- Copying one whole cell into a selected multi-minute range repeats its text, activity fill, and
  formatting into every selected minute. Each minute remains editable. Occupied targets require
  **Replace** confirmation, and **Undo** restores the complete paste together. This range-fill
  behavior applies to **Copy**; **Cut** continues to move its captured cells rather than repeat them.
- Whole-cell **Cut / Copy** captures the selected cells' text, activity fills, and formatting. Select a
  destination and hold it for **Paste**. There is no copied/cut notification banner. Context asks for
  **Replace** confirmation if destination cells contain entries or formatting. Cut leaves its source
  intact until Paste moves the cells in one transaction; **Undo** restores source and destination
  together. Rich whole-cell snapshots stay inside Context and clear when the app process ends;
  Copy/Cut also places a plain-text version on the phone clipboard. Record a minute before
  moving it; an untouched calendar plan is edited through its explicit **Event** action.
- Copy a rectangular cell selection in Google Sheets or Excel, select its top-left destination in
  Context, hold the cell, and choose **Paste**. Each source row fills the next minute; each source
  column fills the next consecutive date. Tabs, quoted multiline notes and blank cells keep their
  positions. A single source cell repeats through a selected minute range. External paste transfers
  text, retaining the destination's Context fill, formatting and group membership; spreadsheet
  formulas are not evaluated and spreadsheet formatting is not imported. Pasting into existing
  entries asks for **Replace**, and one **Undo** restores the complete rectangle across dates.
  Choose an earlier starting minute if the rows would extend past midnight. Clipboard access occurs
  when choosing **Paste**, without background clipboard polling. Native text-editor Paste still
  inserts text into the cell being edited. If iOS asks, allow Paste for Context.
- A cell with a source calendar plan offers **Event** in its fill-color panel. This deliberately opens
  the detailed editor for source-event and recurring-series controls, including ranges crossing
  midnight. Selecting or double-tapping a cell does not open an automatic color/details or range
  popup. The bottom entry and formatting bars close after their respective checkmarks.
- The top row contains the three-bar menu, previous arrow, current-view calendar icon, next arrow,
  **Undo**, **Redo**, and the two-arrow **Sync** icon. The calendar icon matches **Day**, **Week**,
  **Month**, **Year**, or **Schedule**. Tap it once to choose a view or open **Pick / Range**.
  Double-tap to return to now without changing the view or pinch zoom: the minute grid reveals
  the current minute, Month/Year reveal today, and Schedule reveals the current minute's position.
  A short delay distinguishes the single tap from a double-tap. Switching views keeps the date
  and minute you were working on; Schedule shows a non-event time marker at that position.
  There is no separate triangle or long-press date shortcut. **Pick** selects individual days; **Range** selects a
  continuous span of up to 28 days. Up to seven selected days show minute columns; larger selections
  use a calendar overview. Going to now clears a custom date selection so today can be displayed.
- Pinch changes only minute-row height. **Day** always fits one day and **Week** fits all seven days;
  column widths and the time rail remain fixed. Swipe horizontally to the previous or next day,
  week or month for the chosen view. Month shows activity text and fill without start times or
  empty placeholders; only today's day number is highlighted. Year initially fits all twelve
  months across the available screen. Pinching enlarges text and reflows the months from three
  columns to two, then one, with vertical scrolling and no horizontal overflow.
  Zoom is remembered separately on each phone.
  Choose **12-hour** or **24-hour**
  only in **Settings**; the minute column fits the selected time labels, such as `13:11`. Light,
  dark, and system appearance are also available in Settings.
- The three-bar menu opens **Dashboard**, **Print**, **Search**, and **Settings**, in that order.
  These four entries have matching monochrome icons.
  Explanations in Settings and account controls are available through their information icons.
  Calendar-load warnings appear as a small exclamation mark on **Sync**. Tap to retry or hold for
  details. Secondary screens use matching back arrows to return to the calendar.
  Settings section headings share the same size and weight. Selected appearance/time choices stay
  highlighted; navigation rows and access status stay neutral. **Check connection**, **Check now**
  and **Sync watch** use the same action-button style. **Calendars used for plans** initially shows
  checked calendars; expand **Other calendars** to change the remaining choices. Expanding the list
  does not change permissions or select a calendar.
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

Calendar descriptions list each note with its first minute timestamp. Consecutive exactly identical
notes appear once, while blank minutes remain blank and each private minute stays editable. Hidden,
bounded layout metadata preserves repeated notes and gaps on round trips; the visible description
contains no Context bookkeeping. Update both participating phones to 0.1.20 before exchanging this
version-three format. Older clients hold an unsupported format for review rather than guess its cells.

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
