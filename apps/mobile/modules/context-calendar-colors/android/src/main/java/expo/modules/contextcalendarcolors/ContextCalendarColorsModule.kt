package expo.modules.contextcalendarcolors

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class ContextCalendarColorsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ContextCalendarColors")
    // Expo's DEFAULT async queue is off the UI thread; no additional runtime dependency is needed.
    AsyncFunction("getEventColorsAsync") { calendarIds: List<String>, startMs: Double, endMs: Double ->
      if (!validRequest(calendarIds, startMs, endMs)) return@AsyncFunction emptyMap<String, String>()
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction emptyMap<String, String>()
      if (context.checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
        return@AsyncFunction emptyMap<String, String>()
      }
      try { readColors(context, calendarIds.distinct(), startMs.toLong(), endMs.toLong()) }
      catch (_: SecurityException) { emptyMap<String, String>() }
      catch (error: CodedException) { throw error }
      catch (_: Exception) { throw CodedException("ERR_CALENDAR_COLORS_UNAVAILABLE", "Calendar colors could not be read.", null) }
    }.runOnQueue(Queues.DEFAULT)
  }

  private fun validRequest(ids: List<String>, start: Double, end: Double): Boolean =
    ids.isNotEmpty() && ids.size <= MAX_CALENDARS && ids.all { it.matches(Regex("0|[1-9][0-9]*")) && it.toLongOrNull() != null } &&
      start.isFinite() && end.isFinite() && start % 1.0 == 0.0 && end % 1.0 == 0.0 &&
      kotlin.math.abs(start) <= MAX_DATE_MS && kotlin.math.abs(end) <= MAX_DATE_MS && end > start && end - start <= MAX_INTERVAL_MS

  private fun readColors(context: Context, ids: List<String>, start: Long, end: Long): Map<String, String> {
    val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().let { builder ->
      ContentUris.appendId(builder, start)
      ContentUris.appendId(builder, end)
      builder.build()
    }
    val selection = "${CalendarContract.Instances.CALENDAR_ID} IN (${ids.joinToString(",") { "?" }})"
    val base = arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END)
    // DISPLAY_COLOR is the provider's effective event override / calendar fallback. Some OEM
    // providers omit that optional projection, so retry with the underlying standard columns.
    val colorProjections = listOf(
      arrayOf(CalendarContract.Instances.DISPLAY_COLOR, CalendarContract.Instances.EVENT_COLOR, CalendarContract.Instances.CALENDAR_COLOR),
      arrayOf(CalendarContract.Instances.EVENT_COLOR, CalendarContract.Instances.CALENDAR_COLOR),
      arrayOf(CalendarContract.Instances.CALENDAR_COLOR)
    )
    for (colors in colorProjections) {
      try {
        val output = linkedMapOf<String, String>()
        context.contentResolver.query(uri, base + colors, selection, ids.toTypedArray(), "${CalendarContract.Instances.BEGIN} ASC")?.use { cursor ->
          val idIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_ID)
          val beginIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
          val endIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
          val colorIndices = colors.map { cursor.getColumnIndex(it) }
          var rows = 0
          while (cursor.moveToNext()) {
            if (++rows > MAX_ROWS) throw CodedException("ERR_CALENDAR_COLORS_LIMIT", "The calendar color request is too large.", null)
            if (cursor.isNull(idIndex) || cursor.isNull(beginIndex) || cursor.isNull(endIndex)) continue
            val begin = cursor.getLong(beginIndex)
            // Match the requested half-open day, including an instantaneous event at its start.
            if (begin >= end || cursor.getLong(endIndex) < start) continue
            val id = cursor.getLong(idIndex)
            if (id < 0) continue
            val colorIndex = colorIndices.firstOrNull { it >= 0 && !cursor.isNull(it) } ?: continue
            val color = String.format(Locale.ROOT, "#%06X", cursor.getInt(colorIndex) and 0xFFFFFF)
            // EVENT_ID matches expo-calendar's EventEntity.id; exceptions have their own event ID.
            output[id.toString()] = color
            output["$id@$begin"] = color
          }
        }
        return output
      } catch (_: IllegalArgumentException) { /* Retry a projection unsupported by this provider. */ }
    }
    return emptyMap()
  }

  private companion object {
    const val MAX_CALENDARS = 256
    const val MAX_INTERVAL_MS = 691_200_000.0
    const val MAX_DATE_MS = 8_640_000_000_000_000.0
    const val MAX_ROWS = 50_000
  }
}
