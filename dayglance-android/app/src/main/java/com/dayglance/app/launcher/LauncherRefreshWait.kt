package com.dayglance.app.launcher

import org.json.JSONObject

/** When a live renderer has answered a REFRESH. Pure, tested on the JVM. */
object LauncherRefreshWait {
    private val WAITING = setOf("queued", "scheduled")

    /**
     * True once the entry has an outcome the web layer (or the worker) recorded:
     * anything but queued/scheduled, or a finish stamp. A missing entry (pruned
     * from the log, or never written) is nothing to wait for.
     */
    fun answered(entry: JSONObject?): Boolean {
        if (entry == null) return true
        if (entry.has("finishedAt") && !entry.isNull("finishedAt")) return true
        return entry.optString("outcome") !in WAITING
    }
}
