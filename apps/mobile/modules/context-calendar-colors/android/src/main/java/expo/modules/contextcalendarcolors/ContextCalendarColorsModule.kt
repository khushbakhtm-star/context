package expo.modules.contextcalendarcolors

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.ContentValues
import android.content.ContentProviderOperation
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
    AsyncFunction("getEventPaletteAsync") { calendarIds: List<String> ->
      if (!validRequest(calendarIds, 0.0, 1.0)) return@AsyncFunction emptyList<Map<String, String>>()
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction emptyList<Map<String, String>>()
      requirePermission(context, Manifest.permission.READ_CALENDAR)
      val output = mutableListOf<Map<String, String>>()
      val palettes = mutableMapOf<Pair<String, String>, List<PaletteColor>>()
      for (id in calendarIds.distinct()) {
        val calendar = readWritableGoogleCalendar(context, id) ?: continue
        val palette = palettes.getOrPut(calendar.accountName to calendar.accountType) { readPalette(context, calendar) }
        for (entry in palette) {
          if (output.size >= MAX_ROWS) throw CodedException("ERR_CALENDAR_COLORS_LIMIT", "The event palette is too large.", null)
          output.add(mapOf("calendarId" to id, "key" to entry.key, "color" to entry.color))
        }
      }
      output
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("setEventColorAsync") { calendarId: String, eventId: String, color: String, expectedColor: String,
        startMs: Double, endMs: Double, title: String, notes: String ->
      if (!validRequest(listOf(calendarId), startMs, endMs) || !validId(eventId) ||
          !color.matches(HEX) || !expectedColor.matches(HEX) || title.length > 100_000 || notes.length > 2_000_000) {
        throw CodedException("ERR_CALENDAR_COLOR_REQUEST", "The linked event color request is invalid.", null)
      }
      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("ERR_CALENDAR_COLOR_CONTEXT", "The calendar is unavailable.", null)
      requirePermission(context, Manifest.permission.READ_CALENDAR)
      requirePermission(context, Manifest.permission.WRITE_CALENDAR)
      setEventColor(context, calendarId, eventId, color.uppercase(Locale.ROOT), expectedColor.uppercase(Locale.ROOT),
        startMs.toLong(), endMs.toLong(), title, notes)
    }.runOnQueue(Queues.DEFAULT)
  }

  private data class WritableCalendar(val accountName: String, val accountType: String, val color: String,
    val rawColor: Int, val accessLevel: Int)
  private data class PaletteColor(val key: String, val color: String, val rawColor: Int)

  private fun validId(id: String): Boolean = id.matches(Regex("0|[1-9][0-9]*")) && id.toLongOrNull() != null
  private fun hex(color: Int): String = String.format(Locale.ROOT, "#%06X", color and 0xFFFFFF)
  private fun requirePermission(context: Context, permission: String) {
    if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
      throw CodedException("ERR_CALENDAR_COLOR_PERMISSION", "Allow calendar access before synchronizing event colors.", null)
    }
  }

  private fun readWritableGoogleCalendar(context: Context, id: String): WritableCalendar? {
    val columns = arrayOf(CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE,
      CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CALENDAR_COLOR)
    context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, columns,
      "${CalendarContract.Calendars._ID}=?", arrayOf(id), null)?.use { cursor ->
      if (!cursor.moveToFirst() || cursor.isNull(0) || cursor.getString(1) != "com.google" ||
          cursor.getInt(2) < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR || cursor.isNull(3)) return null
      return WritableCalendar(cursor.getString(0), cursor.getString(1), hex(cursor.getInt(3)), cursor.getInt(3), cursor.getInt(2))
    }
    return null
  }

  private fun readPalette(context: Context, calendar: WritableCalendar): List<PaletteColor> {
    val columns = arrayOf(CalendarContract.Colors.COLOR_KEY, CalendarContract.Colors.COLOR)
    val where = "${CalendarContract.Colors.ACCOUNT_NAME}=? AND ${CalendarContract.Colors.ACCOUNT_TYPE}=? AND ${CalendarContract.Colors.COLOR_TYPE}=?"
    val output = mutableListOf<PaletteColor>()
    context.contentResolver.query(CalendarContract.Colors.CONTENT_URI, columns, where,
      arrayOf(calendar.accountName, calendar.accountType, CalendarContract.Colors.TYPE_EVENT.toString()), null)?.use { cursor ->
      var rows = 0
      while (cursor.moveToNext()) {
        if (++rows > MAX_ROWS) throw CodedException("ERR_CALENDAR_COLORS_LIMIT", "The event palette is too large.", null)
        if (cursor.isNull(0) || cursor.isNull(1)) continue
        val key = cursor.getString(0)
        if (key.isEmpty() || key.length > 200 || key.any { it.code < 32 }) continue
        output.add(PaletteColor(key, hex(cursor.getInt(1)), cursor.getInt(1)))
      }
    }
    return output.distinct().sortedBy { it.key }
  }

  private fun setEventColor(context: Context, calendarId: String, eventId: String, color: String,
      expectedColor: String, start: Long, end: Long, title: String, notes: String): Map<String, Any> {
    val calendar = readWritableGoogleCalendar(context, calendarId)
      ?: throw CodedException("ERR_CALENDAR_COLOR_SOURCE", "Select a writable Google phone calendar for event colors.", null)
    // EVENT_COLOR is sync-adapter-owned. Ordinary applications write an existing
    // account-scoped EVENT_COLOR_KEY; the provider resolves its exact RGB value.
    val palette = readPalette(context, calendar)
    val matches = palette.filter { it.color == color }
    val colorKeys = matches.map { it.key }
    if (colorKeys.isEmpty()) throw CodedException("ERR_CALENDAR_COLOR_UNSUPPORTED",
      "This fill is not in this calendar's event palette. Choose a connected event color.", null)
    val columns = arrayOf(CalendarContract.Events._ID, CalendarContract.Events.CALENDAR_ID,
      CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND, CalendarContract.Events.TITLE,
      CalendarContract.Events.DESCRIPTION, CalendarContract.Events.ALL_DAY, CalendarContract.Events.RRULE,
      CalendarContract.Events.RDATE, CalendarContract.Events.DELETED, CalendarContract.Events.EVENT_COLOR_KEY,
      CalendarContract.Events.EVENT_COLOR)
    val values = linkedMapOf<String, String?>()
    context.contentResolver.query(CalendarContract.Events.CONTENT_URI, columns,
      "${CalendarContract.Events._ID}=? AND ${CalendarContract.Events.CALENDAR_ID}=?", arrayOf(eventId, calendarId), null)?.use { cursor ->
      if (cursor.moveToFirst()) for (column in columns) {
        val index = cursor.getColumnIndexOrThrow(column)
        values[column] = if (cursor.isNull(index)) null else cursor.getString(index)
      }
    }
    if (values.isEmpty() || values[CalendarContract.Events.DTSTART]?.toLongOrNull() != start ||
        values[CalendarContract.Events.DTEND]?.toLongOrNull() != end ||
        values[CalendarContract.Events.TITLE].orEmpty() != title ||
        values[CalendarContract.Events.DESCRIPTION].orEmpty().replace("\r\n", "\n") != notes.replace("\r\n", "\n") ||
        values[CalendarContract.Events.ALL_DAY] != "0" || values[CalendarContract.Events.DELETED] != "0" ||
        !values[CalendarContract.Events.RRULE].isNullOrEmpty() || !values[CalendarContract.Events.RDATE].isNullOrEmpty()) {
      throw CodedException("ERR_CALENDAR_COLOR_CHANGED", "The linked calendar event changed. Refresh before applying its color.", null)
    }
    val effectiveColor = values[CalendarContract.Events.EVENT_COLOR]?.toLongOrNull()?.toInt()?.let(::hex) ?: calendar.color
    if (effectiveColor != expectedColor) throw CodedException("ERR_CALENDAR_COLOR_CHANGED",
      "The calendar event color changed. Refresh before applying another color.", null)
    if (effectiveColor == color) return mapOf("color" to color, "changed" to false)
    val predicates = mutableListOf<String>()
    val arguments = mutableListOf<String>()
    for ((column, value) in values) {
      if (value == null) predicates.add("$column IS NULL")
      else { predicates.add("$column=?"); arguments.add(value) }
    }
    requirePermission(context, Manifest.permission.READ_CALENDAR)
    requirePermission(context, Manifest.permission.WRITE_CALENDAR)
    val selected = matches.first()
    val update = ContentValues().apply { put(CalendarContract.Events.EVENT_COLOR_KEY, selected.key) }
    // Calendar defaults and palette rows are separate from Events. Assert all
    // three scopes in the provider's single batch transaction, with no yield.
    val operations = arrayListOf(
      ContentProviderOperation.newAssertQuery(CalendarContract.Calendars.CONTENT_URI)
        .withSelection("${CalendarContract.Calendars._ID}=? AND ${CalendarContract.Calendars.ACCOUNT_NAME}=? AND ${CalendarContract.Calendars.ACCOUNT_TYPE}=? AND ${CalendarContract.Calendars.CALENDAR_COLOR}=? AND ${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL}=?",
          arrayOf(calendarId, calendar.accountName, calendar.accountType, calendar.rawColor.toString(), calendar.accessLevel.toString()))
        .withExpectedCount(1).build(),
      ContentProviderOperation.newAssertQuery(CalendarContract.Colors.CONTENT_URI)
        .withSelection("${CalendarContract.Colors.ACCOUNT_NAME}=? AND ${CalendarContract.Colors.ACCOUNT_TYPE}=? AND ${CalendarContract.Colors.COLOR_TYPE}=? AND ${CalendarContract.Colors.COLOR_KEY}=? AND ${CalendarContract.Colors.COLOR}=?",
          arrayOf(calendar.accountName, calendar.accountType, CalendarContract.Colors.TYPE_EVENT.toString(), selected.key, selected.rawColor.toString()))
        .withExpectedCount(1).build(),
      ContentProviderOperation.newUpdate(CalendarContract.Events.CONTENT_URI).withValues(update)
        .withSelection(predicates.joinToString(" AND "), arguments.toTypedArray()).withExpectedCount(1).build()
    )
    val results = context.contentResolver.applyBatch(CalendarContract.AUTHORITY, operations)
    val changed = results.getOrNull(2)?.count
    if (changed != 1) throw CodedException("ERR_CALENDAR_COLOR_CHANGED",
      "The linked event changed while applying its color. Refresh and retry.", null)
    // Confirm the provider accepted the key, rather than acknowledging a local
    // write it ignored. No title, location, times, notes or source IDs are changed.
    context.contentResolver.query(CalendarContract.Events.CONTENT_URI,
      arrayOf(CalendarContract.Events.EVENT_COLOR_KEY, CalendarContract.Events.EVENT_COLOR),
      "${CalendarContract.Events._ID}=? AND ${CalendarContract.Events.CALENDAR_ID}=?", arrayOf(eventId, calendarId), null)?.use { cursor ->
      if (cursor.moveToFirst() && !cursor.isNull(0) && cursor.getString(0) in colorKeys &&
          !cursor.isNull(1) && hex(cursor.getInt(1)) == color) return mapOf("color" to color, "changed" to true)
    }
    throw CodedException("ERR_CALENDAR_COLOR_UNCONFIRMED", "The calendar has not confirmed the selected event color. Retry synchronization.", null)
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
    val HEX = Regex("#[0-9a-fA-F]{6}")
    const val MAX_CALENDARS = 256
    const val MAX_INTERVAL_MS = 691_200_000.0
    const val MAX_DATE_MS = 8_640_000_000_000_000.0
    const val MAX_ROWS = 50_000
  }
}
