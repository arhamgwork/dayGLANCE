package com.dayglance.app.launcher

import com.dayglance.app.data.SharedDataStore

/**
 * How far a live REFRESH got, stamped on its log entry on the way so an
 * unanswered one says where it stopped (LauncherRefreshWait.unansweredPatch):
 * the wake reached the app ([markWoken]), then the page took the request off
 * the queue ([markPickedUp]). Each is written once, and never on an answered entry.
 */
object LauncherRefreshTrace {
    /** The app's wake receiver ran: stamp the newest request still waiting. */
    fun markWoken(store: SharedDataStore, now: Long = System.currentTimeMillis()) {
        val clientId = store.lastLauncherRefresh()?.optString("clientId")?.takeIf { it.isNotEmpty() } ?: return
        store.updateLauncherRefreshIf(clientId) { LauncherRefreshWait.stampPatch(it, LauncherRefreshWait.WOKEN_AT, now) }
    }

    /** The page drained the launcher queue: stamp each REFRESH it took. */
    fun markPickedUp(store: SharedDataStore, drainedJson: String, now: Long = System.currentTimeMillis()) {
        for (clientId in LauncherRefreshWait.refreshIds(drainedJson, LauncherIntentReceiver.ACTION_REFRESH)) {
            store.updateLauncherRefreshIf(clientId) { LauncherRefreshWait.stampPatch(it, LauncherRefreshWait.PICKED_UP_AT, now) }
        }
    }
}
