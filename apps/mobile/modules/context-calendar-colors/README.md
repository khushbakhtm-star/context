# Context calendar colors

This local, MIT-licensed Expo module reads Android calendar display colors and applies
explicitly chosen event colors to exact existing Google phone-calendar events. It uses only
Android SDK APIs and remains present in the F-Droid build when the optional Wear bridge
is removed. It declares no permissions, requests no access, and logs no calendar data.
Reads require the app's existing `READ_CALENDAR` permission; color writes also require
its existing `WRITE_CALENDAR` permission and the caller's current private binding guards.

`getEventColorsAsync(calendarIds, startMs, endMs)` returns effective `#RRGGBB` colors by
native event ID and by `eventId@instanceBeginMilliseconds`. Expo Calendar 58 maps
`Instances.EVENT_ID` to its event `id`, including exception IDs. Occurrence keys should
be preferred when available. The provider's `DISPLAY_COLOR` is read before `EVENT_COLOR`
and `CALENDAR_COLOR`; unsupported OEM projections are retried with the fallback columns.

Requests are limited to 256 selected calendar IDs, an eight-day timestamp interval
(including a civil week crossing daylight saving), and 50,000 instance rows. The query
runs on Expo's background async queue and closes its cursor on every exit. iOS,
missing native bindings, revoked permission or unavailable provider colors return an
empty map through the optional JS wrapper; the caller keeps its calendar-color fallback.

`getEventPaletteAsync(calendarIds)` returns only account-scoped event keys and their exact
RGB colors for writable Google calendars. Account names are used internally for the query
and never returned. It does not create colors or substitute a nearby shade.

`setEventColorAsync(input)` compares the exact calendar/event identity, title, description,
times and previous effective color before applying a provider palette key. A conditional
update compares the complete previously read row, including its old color key. It writes
only `EVENT_COLOR_KEY`, then confirms the provider's resulting key and color. It never
impersonates a sync adapter or writes the sync-adapter-owned `EVENT_COLOR` column.
Recurring, missing, changed, unsupported or unconfirmed events remain pending for review;
no title, notes, location, duration or source IDs are changed by this module.

The optional getter falls back safely on older builds. The explicit setter throws when
unavailable so synchronization cannot acknowledge a color that was never applied.
