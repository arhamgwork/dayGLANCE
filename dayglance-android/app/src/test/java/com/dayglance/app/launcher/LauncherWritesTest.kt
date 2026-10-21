package com.dayglance.app.launcher

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** What a headless snapshot keeps from the previous one: it reads neither the forecast nor the device calendar. */
class LauncherWritesTest {
    private val withWeather = """{"version":1,"tasks":[],"weather":[{"id":"2026-10-19","date":"2026-10-19","hours":[{"hour":9,"temp":55}]}]}"""
    private val without = """{"version":1,"tasks":[{"id":"t2"}],"weather":[]}"""

    @Test
    fun `an empty weather collection takes the previous snapshot's`() {
        val merged = JSONObject(LauncherWrites.withCarried(without, withWeather))
        assertEquals("t2", merged.getJSONArray("tasks").getJSONObject(0).getString("id"))
        assertEquals(55, merged.getJSONArray("weather").getJSONObject(0).getJSONArray("hours").getJSONObject(0).getInt("temp"))
    }

    @Test
    fun `a snapshot with weather, or one with nothing to carry from, is stored as is`() {
        assertSame(withWeather, LauncherWrites.withCarried(withWeather, without))
        assertSame(without, LauncherWrites.withCarried(without, null))
        assertSame(without, LauncherWrites.withCarried(without, """{"version":1,"weather":[]}"""))
        assertSame(without, LauncherWrites.withCarried(without, "not json"))
    }

    private val previous = """
        {"version":1,"today":"2026-10-20","weather":[],
         "tasks":[{"id":"t1","date":"2026-10-20","native":false},
                  {"id":"n-old","date":"2026-10-19","native":true},
                  {"id":"n-yday","date":"2026-10-20","native":true},
                  {"id":"n-tmrw","date":"2026-10-22","native":true,"title":"Dentist"},
                  {"id":"n-dup","date":"2026-10-22","native":true,"title":"old copy"}]}
    """.trimIndent()

    @Test
    fun `a headless snapshot keeps the previous device events from yesterday on, never duplicating`() {
        val incoming = """{"version":1,"today":"2026-10-21","carryDeviceEvents":true,"weather":[],
            "tasks":[{"id":"t1","date":"2026-10-21","native":false},{"id":"n-dup","date":"2026-10-22","native":true,"title":"new copy"}]}"""
        val tasks = JSONObject(LauncherWrites.withCarried(incoming, previous)).getJSONArray("tasks")
        val ids = (0 until tasks.length()).map { tasks.getJSONObject(it).getString("id") }
        // n-old is before yesterday; t1 is not native; n-dup is already in the incoming one.
        assertEquals(listOf("t1", "n-dup", "n-yday", "n-tmrw"), ids)
        assertEquals("new copy", tasks.getJSONObject(1).getString("title"))
        assertEquals("Dentist", tasks.getJSONObject(3).getString("title"))
    }

    @Test
    fun `a snapshot that read the calendar itself carries nothing`() {
        val incoming = """{"version":1,"today":"2026-10-21","weather":[{"id":"x","hours":[]}],"tasks":[{"id":"t1","native":false}]}"""
        assertSame(incoming, LauncherWrites.withCarried(incoming, previous))
    }
}
