# Context calendar colors

This local, MIT-licensed Expo module reads Android calendar display colors. It uses only
Android SDK APIs and remains present in the F-Droid build when the optional Wear bridge
is removed. It declares no permissions and never requests access, writes events or logs
calendar data. The app's existing `READ_CALENDAR` permission is required.

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
