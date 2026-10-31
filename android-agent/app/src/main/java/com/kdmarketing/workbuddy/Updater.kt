package com.kdmarketing.workbuddy

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/** A newer APK that is available to install. */
data class UpdateInfo(val versionCode: Int, val versionName: String, val apkUrl: String)

/**
 * Looks for a newer build of the app. The feed is a folder on a static host holding `version.json`
 * (`{"versionCode": 12, "versionName": "0.1.12", "apk": "WorkBuddy.apk"}`) next to the APK. Android
 * will not install an update silently outside the Play Store, so this only downloads it and opens
 * the system installer; the employee taps Install.
 */
class Updater(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private val base = BuildConfig.UPDATE_URL.trimEnd('/')

    /** Blocking: call off the main thread. Null when up to date, not configured, or unreachable. */
    fun check(): UpdateInfo? {
        if (base.isEmpty()) return null
        return try {
            client.newCall(Request.Builder().url("$base/version.json").build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val json = JSONObject(res.body?.string() ?: return null)
                val code = json.optInt("versionCode", 0)
                if (code <= BuildConfig.VERSION_CODE) return null
                UpdateInfo(code, json.optString("versionName"), "$base/${json.optString("apk", "WorkBuddy.apk")}")
            }
        } catch (_: Exception) {
            // Offline or the host is down: the next check will try again.
            null
        }
    }

    /** Blocking: downloads the APK and returns the system installer intent, or null on failure. */
    fun download(info: UpdateInfo): Intent? {
        return try {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            val file = File(dir, "WorkBuddy-${info.versionCode}.apk")
            client.newCall(Request.Builder().url(info.apkUrl).build()).execute().use { res ->
                if (!res.isSuccessful) return null
                res.body?.byteStream()?.use { input -> file.outputStream().use { input.copyTo(it) } }
                    ?: return null
            }
            val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        } catch (_: Exception) {
            null
        }
    }
}
