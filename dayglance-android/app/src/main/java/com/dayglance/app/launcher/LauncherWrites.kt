package com.dayglance.app.launcher

import android.content.Context
import android.util.Log
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * The three launcher-facing writes the web layer makes (docs/launcher-integration.md),
 * shared by the full bridge ([com.dayglance.app.bridge.NativeBridge], the app) and
 * the headless one ([HeadlessBridge], the worker's WebView), so both roots write
 * the store the same way and announce it on the same URI.
 */
object LauncherWrites {
    private const val TAG = "LauncherSnapshot"

    /**
     * Store the snapshot and announce it. With [headless], what a headless run
     * cannot produce is carried from the previous snapshot ([withCarried]).
     */
    fun updateSnapshot(context: Context, store: SharedDataStore, snapshotJson: String, headless: Boolean = false) {
        try {
            store.launcherSnapshot = if (headless) withCarried(snapshotJson, store.launcherSnapshot) else snapshotJson
            store.launcherSnapshotUpdatedAt = System.currentTimeMillis()
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to store the launcher snapshot", e)
        }
    }

    /**
     * [incoming] with what a headless run cannot produce taken from [previous]. Pure.
     *
     *  - Weather: a headless run fetches no forecast, so an absent or empty
     *    collection keeps the previous one; the weather ring would otherwise go
     *    blank until the app next opened.
     *  - Device-calendar events: when the snapshot says `carryDeviceEvents`, it
     *    could not read the calendar. The previous snapshot's `native` task rows
     *    from yesterday on are kept, skipping any id the incoming one has. A sync
     *    never changes these (the OS calendar does), so carrying them is exact
     *    until the app next reads the calendar.
     */
    fun withCarried(incoming: String, previous: String?): String {
        if (previous == null) return incoming
        return try {
            val next = JSONObject(incoming)
            val old = JSONObject(previous)
            var changed = false
            val weather = next.optJSONArray("weather")
            val oldWeather = old.optJSONArray("weather")
            if ((weather == null || weather.length() == 0) && oldWeather != null && oldWeather.length() > 0) {
                next.put("weather", JSONArray(oldWeather.toString()))
                changed = true
            }
            if (next.optBoolean("carryDeviceEvents", false)) {
                val tasks = next.optJSONArray("tasks") ?: JSONArray().also { next.put("tasks", it) }
                val ids = HashSet<String>()
                for (i in 0 until tasks.length()) tasks.optJSONObject(i)?.optString("id")?.let { ids.add(it) }
                val from = next.optString("today").takeIf { it.length == 10 }?.let { dayBefore(it) }
                val oldTasks = old.optJSONArray("tasks") ?: JSONArray()
                for (i in 0 until oldTasks.length()) {
                    val t = oldTasks.optJSONObject(i) ?: continue
                    if (!t.optBoolean("native", false)) continue
                    val id = t.optString("id")
                    if (id.isEmpty() || id in ids) continue
                    val date = t.optString("date")
                    if (from != null && date.isNotEmpty() && date < from) continue
                    tasks.put(JSONObject(t.toString()))
                    ids.add(id)
                    changed = true
                }
            }
            if (changed) next.toString() else incoming
        } catch (e: Exception) {
            incoming
        }
    }

    /** The ISO date before [isoDate] ("2026-10-21" -> "2026-10-20"). */
    private fun dayBefore(isoDate: String): String? = try {
        java.time.LocalDate.parse(isoDate).minusDays(1).toString()
    } catch (e: Exception) { null }

    /** Merge the heartbeat ({checkedAt, syncedAt}) into the stored one and announce it. */
    fun touchHeartbeat(context: Context, store: SharedDataStore, json: String) {
        try {
            val incoming = JSONObject(json)
            val merged = store.launcherHeartbeat?.let { JSONObject(it) } ?: JSONObject()
            for (key in incoming.keys()) merged.put(key, incoming.get(key))
            store.launcherHeartbeat = merged.toString()
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to store the launcher heartbeat", e)
        }
    }

    /** Merge a REFRESH outcome ({clientId, outcome, reason?, durationMs}) into its log entry and announce it. */
    fun recordRefresh(context: Context, store: SharedDataStore, json: String) {
        try {
            val entry = JSONObject(json)
            val clientId = entry.optString("clientId")
            if (clientId.isEmpty()) return
            entry.put("finishedAt", System.currentTimeMillis())
            // The receiver's reason ("process not running: headless run scheduled")
            // describes the request, not the outcome; a report without one replaces it.
            if (!entry.has("reason")) entry.put("reason", JSONObject.NULL)
            store.updateLauncherRefresh(clientId, entry)
            context.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to record a launcher refresh", e)
        }
    }
}
