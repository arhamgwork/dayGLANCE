package com.dayglance.app.launcher

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the awake hold may end: once the web layer has recorded an outcome for the request. */
class LauncherRefreshWaitTest {
    private fun entry(json: String) = JSONObject(json)

    @Test
    fun `a request still queued is waited on`() {
        assertFalse(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","liveness":"alive"}""")))
        assertFalse(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","finishedAt":null}""")))
    }

    @Test
    fun `an outcome or a finish stamp ends the wait`() {
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"ran","durationMs":240,"finishedAt":1}""")))
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"failed","reason":"vault: offline"}""")))
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","finishedAt":1792644336246}""")))
    }

    @Test
    fun `a request no longer in the log is nothing to wait for`() {
        assertTrue(LauncherRefreshWait.answered(null))
    }
}
