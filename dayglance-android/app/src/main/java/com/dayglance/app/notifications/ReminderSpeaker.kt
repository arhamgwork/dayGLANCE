package com.dayglance.app.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Day planner: reads a task out loud when its alarm fires.
 *
 * Runs inside the receiver's goAsync() window, so the process stays alive
 * while the on-device engine speaks (no network, works on GrapheneOS with any
 * installed TTS engine). Plays on the alarm stream so it is heard with the
 * ringer on silent, the way an alarm clock is. Gives up after [TIMEOUT_MS] so
 * the broadcast always finishes.
 */
object ReminderSpeaker {
    private const val TIMEOUT_MS = 9_000L
    private const val UTTERANCE_ID = "dayglance-reminder"

    fun speak(context: Context, text: String, pending: BroadcastReceiver.PendingResult) {
        val handler = Handler(Looper.getMainLooper())
        var tts: TextToSpeech? = null
        var finished = false
        val finish = {
            if (!finished) {
                finished = true
                runCatching { tts?.shutdown() }
                runCatching { pending.finish() }
            }
        }
        handler.postDelayed({ finish() }, TIMEOUT_MS)

        tts = TextToSpeech(context.applicationContext) { status ->
            val engine = tts
            if (status != TextToSpeech.SUCCESS || engine == null) {
                handler.post { finish() }
                return@TextToSpeech
            }
            runCatching {
                val lang = engine.isLanguageAvailable(Locale.getDefault())
                if (lang >= TextToSpeech.LANG_AVAILABLE) engine.language = Locale.getDefault()
                engine.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) { handler.post { finish() } }
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) { handler.post { finish() } }
                })
                engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
            }.onFailure { handler.post { finish() } }
        }
    }
}
