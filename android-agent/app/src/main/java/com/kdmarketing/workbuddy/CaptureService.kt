package com.kdmarketing.workbuddy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlin.random.Random

/**
 * Takes the screenshots and audio samples while the person is punched in and not on a break.
 *
 * Android only allows this in the open: the service runs in the foreground with a permanent
 * notification, and the person approved screen capture on the system dialog that started it.
 * Nothing here starts by itself and nothing is hidden. The server decides when capture is
 * allowed (`captureAllowed` / `audioAllowed` on /api/attendance/status), exactly as it does for
 * the desktop agent.
 */
class CaptureService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val frameLock = Any()

    private lateinit var api: Api
    private lateinit var outbox: Outbox
    private lateinit var uploader: Uploader
    private lateinit var power: PowerManager
    private lateinit var keyguard: KeyguardManager

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var frameThread: HandlerThread? = null
    private var latest: Image? = null

    private var width = 0
    private var height = 0

    @Volatile private var captureAllowed = false
    @Volatile private var audioAllowed = false
    private var screenshotMin = 300
    private var screenshotMax = 600
    private var audioSeconds = 300
    private var audioGap = 480
    private var maxUploadBytes = 5 * 1024 * 1024

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            shutdown()
            return START_NOT_STICKY
        }
        if (running) return START_NOT_STICKY

        val app = application as App
        api = app.api
        outbox = app.outbox
        uploader = Uploader(api, outbox)
        power = getSystemService(Context.POWER_SERVICE) as PowerManager
        keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        if (data == null || resultCode == 0) {
            stopSelf()
            return START_NOT_STICKY
        }

        createChannel()
        val withMic = intent?.getBooleanExtra(EXTRA_WITH_AUDIO, false) == true &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (withMic) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Starting…"), type)
        } catch (e: Exception) {
            lastError = e.message
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            startProjection(resultCode, data)
        } catch (e: Exception) {
            lastError = e.message
            shutdown()
            return START_NOT_STICKY
        }

        running = true
        scope.launch { statusLoop() }
        scope.launch { screenshotLoop() }
        if (withMic) scope.launch { audioLoop() }
        scope.launch { activityLoop() }
        scope.launch { uploadLoop() }
        return START_NOT_STICKY
    }

    // --- Screen capture ---------------------------------------------------------------------

    private fun startProjection(resultCode: Int, data: Intent) {
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val p = manager.getMediaProjection(resultCode, data)
            ?: throw IllegalStateException("Screen capture was not allowed")
        projection = p

        // Android 14 refuses to create a display without a callback registered first.
        p.registerCallback(
            object : MediaProjection.Callback() {
                override fun onStop() {
                    // The person stopped sharing from the system chip, or the system ended it.
                    lastError = "Screen capture was stopped"
                    shutdown()
                }
            },
            Handler(Looper.getMainLooper()),
        )

        val metrics = resources.displayMetrics
        val scale = minOf(1.0, MAX_EDGE.toDouble() / maxOf(metrics.widthPixels, metrics.heightPixels))
        width = (metrics.widthPixels * scale).toInt() and 1.inv()
        height = (metrics.heightPixels * scale).toInt() and 1.inv()

        val thread = HandlerThread("workbuddy-frames").also { it.start() }
        frameThread = thread
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener({ source ->
            val image = try {
                source.acquireLatestImage()
            } catch (_: Exception) {
                null
            }
            if (image != null) {
                // Keep only the newest frame: a still screen sends no new frames, so the last
                // one is what a capture a few minutes later should show.
                synchronized(frameLock) {
                    latest?.close()
                    latest = image
                }
            }
        }, Handler(thread.looper))
        reader = r

        display = p.createVirtualDisplay(
            "WorkBuddy",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            r.surface,
            null,
            null,
        )
    }

    private fun currentFrameAsJpeg(): ByteArray? {
        synchronized(frameLock) {
            val image = latest ?: return null
            val plane = image.planes[0]
            val buffer = plane.buffer
            buffer.rewind()
            val pixelStride = plane.pixelStride
            val rowPadding = plane.rowStride - pixelStride * image.width
            val padded = Bitmap.createBitmap(
                image.width + rowPadding / pixelStride,
                image.height,
                Bitmap.Config.ARGB_8888,
            )
            padded.copyPixelsFromBuffer(buffer)
            val cropped = if (padded.width != image.width) {
                Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
            } else {
                padded
            }
            val out = ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            cropped.recycle()
            return out.toByteArray()
        }
    }

    private fun takeScreenshot() {
        val jpeg = currentFrameAsJpeg() ?: return
        if (jpeg.size > maxUploadBytes * 0.7) return
        val payload = JSONObject()
            .put("captureId", UUID.randomUUID().toString())
            .put("captureGroupId", UUID.randomUUID().toString())
            .put("displayIndex", 0)
            .put("displayCount", 1)
            .put("displayLabel", Build.MODEL ?: "Phone")
            .put("contentType", "image/jpeg")
            .put("capturedAt", Instant.now().toString())
        outbox.enqueue("/api/screenshots/upload", "imageBase64", payload, jpeg)
    }

    // --- Loops ------------------------------------------------------------------------------

    private suspend fun statusLoop() {
        loadConfig()
        while (scope.isActive) {
            val result = api.request("GET", "/api/attendance/status")
            val body = result.body
            if (result.ok && body != null) {
                if (body.optString("state") == "punched_out") {
                    lastError = null
                    shutdown()
                    return
                }
                captureAllowed = body.optBoolean("captureAllowed")
                audioAllowed = body.optBoolean("audioAllowed")
                updateNotification(
                    if (body.optString("state") == "on_break") {
                        "On break: nothing is being captured"
                    } else {
                        "Capturing your screen" + if (audioAllowed) " and microphone" else ""
                    },
                )
            } else if (result.status == 401 || result.status == 403) {
                lastError = "You were signed out"
                shutdown()
                return
            }
            delay(STATUS_EVERY_MS)
        }
    }

    private fun loadConfig() {
        val result = api.request("GET", "/api/config")
        val body = result.body ?: return
        if (!result.ok) return
        body.optJSONObject("screenshot")?.let {
            screenshotMin = it.optInt("minIntervalSeconds", screenshotMin).coerceAtLeast(30)
            screenshotMax = it.optInt("maxIntervalSeconds", screenshotMax).coerceAtLeast(screenshotMin)
        }
        body.optJSONObject("audio")?.let {
            audioSeconds = it.optInt("sampleDurationSeconds", audioSeconds).coerceIn(5, 600)
            audioGap = it.optInt("sampleGapSeconds", audioGap).coerceAtLeast(30)
        }
        maxUploadBytes = body.optInt("maxUploadBytes", maxUploadBytes)
    }

    private fun screenIsOn(): Boolean = power.isInteractive && !keyguard.isKeyguardLocked

    private suspend fun screenshotLoop() {
        delay(8_000) // first one soon after the person starts, like the desktop agent
        while (scope.isActive) {
            if (captureAllowed && screenIsOn()) {
                try {
                    takeScreenshot()
                } catch (e: Exception) {
                    lastError = e.message
                }
            }
            delay(Random.nextLong(screenshotMin * 1000L, screenshotMax * 1000L + 1))
        }
    }

    private suspend fun audioLoop() {
        delay(20_000)
        while (scope.isActive) {
            if (captureAllowed && audioAllowed) {
                try {
                    recordSample()
                } catch (e: Exception) {
                    lastError = e.message
                }
            }
            delay(audioGap * 1000L)
        }
    }

    private suspend fun recordSample() {
        val file = File(cacheDir, "sample.ogg").also { it.delete() }
        val recorder = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
        var completed = false
        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.OGG)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            recorder.setAudioSamplingRate(16_000)
            recorder.setAudioEncodingBitRate(24_000)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()
            val recordedAt = Instant.now().toString()
            var elapsed = 0
            var peak = 0
            // One second at a time, so a break or a punch-out ends the sample straight away.
            // The loudest moment is kept: if it never rises above the noise floor the mic was
            // almost certainly muted or switched off, and HR and the team leader are told.
            while (scope.isActive && elapsed < audioSeconds && captureAllowed && audioAllowed) {
                delay(1_000)
                elapsed += 1
                peak = maxOf(peak, recorder.maxAmplitude)
            }
            recorder.stop()
            completed = elapsed >= 5
            if (completed && file.length() in 1..(maxUploadBytes * 0.7).toLong()) {
                val payload = JSONObject()
                    .put("captureId", UUID.randomUUID().toString())
                    .put("durationSeconds", elapsed)
                    .put("contentType", "audio/ogg")
                    .put("recordedAt", recordedAt)
                    .put("micMuted", peak < SILENCE_PEAK)
                outbox.enqueue("/api/audio/upload", "audioBase64", payload, file.readBytes())
            }
        } finally {
            try {
                recorder.release()
            } catch (_: Exception) {
            }
            file.delete()
        }
    }

    /**
     * One presence entry a minute while the screen is on and unlocked. Android has no way to
     * count keystrokes in other apps (and this app does not try); the server derives idle time
     * from the gaps between entries, so presence is what it needs.
     */
    private suspend fun activityLoop() {
        while (scope.isActive) {
            delay(60_000)
            if (captureAllowed && screenIsOn()) {
                val entry = JSONObject()
                    .put("keystrokeCount", 0)
                    .put("mouseCount", 0)
                    .put("timestamp", Instant.now().toString())
                api.request("POST", "/api/activity/log", entry)
            }
        }
    }

    private suspend fun uploadLoop() {
        while (scope.isActive) {
            if (uploader.drain()) {
                lastError = "Please sign in again"
                shutdown()
                return
            }
            delay(UPLOAD_EVERY_MS)
        }
    }

    // --- Notification and shutdown -----------------------------------------------------------

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "WorkBuddy capture", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Shown while WorkBuddy is capturing your screen during your shift"
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("WorkBuddy")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, notification(text))
    }

    private fun shutdown() {
        running = false
        scope.cancel()
        try {
            display?.release()
        } catch (_: Exception) {
        }
        try {
            projection?.stop()
        } catch (_: Exception) {
        }
        synchronized(frameLock) {
            latest?.close()
            latest = null
        }
        reader?.close()
        frameThread?.quitSafely()
        display = null
        projection = null
        reader = null
        frameThread = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.kdmarketing.workbuddy.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_WITH_AUDIO = "withAudio"

        private const val CHANNEL_ID = "capture"
        private const val NOTIFICATION_ID = 1
        private const val MAX_EDGE = 1280

        /** Peak amplitude (of 32767) under which a sample counts as silence: about -50 dBFS. */
        private const val SILENCE_PEAK = 100
        private const val JPEG_QUALITY = 65
        private const val STATUS_EVERY_MS = 45_000L
        private const val UPLOAD_EVERY_MS = 15_000L

        /** True while capture is running; the screen reads this to show its state. */
        @Volatile var running = false

        /** The last reason capture stopped or failed, for the screen to show. */
        @Volatile var lastError: String? = null

        fun start(context: Context, resultCode: Int, data: Intent, withAudio: Boolean) {
            lastError = null
            val intent = Intent(context, CaptureService::class.java)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_RESULT_DATA, data)
                .putExtra(EXTRA_WITH_AUDIO, withAudio)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            if (!running) return
            try {
                context.startService(Intent(context, CaptureService::class.java).setAction(ACTION_STOP))
            } catch (_: Exception) {
                // Not allowed to start a service from the background; the service stops itself
                // at the next status check once the person has punched out.
            }
        }
    }
}
