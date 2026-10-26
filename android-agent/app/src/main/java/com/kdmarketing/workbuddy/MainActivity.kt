package com.kdmarketing.workbuddy

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The whole app is this one screen: sign in, accept the monitoring notice, punch in and out,
 * take breaks, and start or stop capture. It is built in code to keep the project small.
 */
class MainActivity : AppCompatActivity() {
    private val app get() = application as App
    private val api get() = app.api
    private val tokens get() = app.tokens

    private lateinit var content: LinearLayout

    private var status: JSONObject? = null
    private var consentRequired = false
    private var disclosure: String? = null
    private var message: String? = null
    private var busy = false

    // The clock ticks locally between status reads.
    private var baseWorked = 0L
    private var baseAtMs = 0L
    private var clock: TextView? = null
    private var audioConsentBox: CheckBox? = null

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) {
                CaptureService.start(this, result.resultCode, data, wantsAudio())
                message = null
            } else {
                message = "Screen capture was not allowed, so nothing is being captured."
            }
            render()
        }

    private val micLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { askForScreenCapture() }

    private val notificationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        scroll.addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContentView(scroll)

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        render()

        // Re-reads the server every 30 seconds while the screen is open, and ticks the clock.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    while (true) {
                        refresh()
                        delay(30_000)
                    }
                }
                launch {
                    while (true) {
                        delay(1_000)
                        tickClock()
                    }
                }
            }
        }
    }

    // --- Data -------------------------------------------------------------------------------

    private suspend fun refresh() {
        if (!tokens.signedIn) {
            withContext(Dispatchers.Main) { render() }
            return
        }
        val result = withContext(Dispatchers.IO) {
            val s = api.request("GET", "/api/attendance/status")
            val me = api.request("GET", "/api/auth/me")
            Pair(s, me)
        }
        val (s, me) = result
        withContext(Dispatchers.Main) {
            if (!tokens.signedIn) {
                status = null
            } else if (s.ok) {
                status = s.body
                baseWorked = s.body?.optLong("workedSeconds") ?: 0L
                baseAtMs = SystemClock.elapsedRealtime()
                if (message?.startsWith("Could not reach") == true) message = null
            } else if (s.status == 0) {
                message = "Could not reach the server. Showing the last known state."
            } else if (s.body?.optJSONObject("error")?.optString("code") == "PASSWORD_CHANGE_REQUIRED") {
                // A temporary password from HR has to be replaced on the web portal first.
                status = null
                message = "Choose your own password first: sign in on the web portal " +
                    "(use the button below), then come back here and sign in again."
            }
            if (me.ok) {
                val employee = me.body?.optJSONObject("employee") ?: me.body
                consentRequired = employee?.optJSONObject("consent")?.optBoolean("required") == true
            }
            render()
        }
    }

    private fun act(work: () -> ApiResult, then: () -> Unit = {}) {
        if (busy) return
        busy = true
        message = null
        render()
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { work() }
            if (!result.ok) message = result.message(if (result.status == 0) "Could not reach the server." else "Something went wrong")
            busy = false
            refresh()
            if (result.ok) then()
        }
    }

    private fun wantsAudio(): Boolean =
        status?.optBoolean("audioAllowed") == true &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    /** Asks for the microphone first when the server allows audio, then for screen capture. */
    private fun beginCapture() {
        if (status?.optBoolean("audioAllowed") == true &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            askForScreenCapture()
        }
    }

    private fun askForScreenCapture() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun loadDisclosure() {
        if (disclosure != null) return
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { api.request("GET", "/api/auth/consent") }
            val body = result.body
            if (result.ok && body != null) {
                val text = StringBuilder()
                body.optJSONArray("captured")?.let { list ->
                    for (i in 0 until list.length()) {
                        val item = list.getJSONObject(i)
                        text.append("• ").append(item.optString("title")).append(": ")
                            .append(item.optString("detail")).append("\n\n")
                    }
                }
                text.append(body.optString("retention")).append("\n\n")
                text.append(body.optString("access")).append("\n\n")
                text.append(body.optString("purpose"))
                disclosure = text.toString()
                render()
            }
        }
    }

    // --- Screens ----------------------------------------------------------------------------

    private fun render() {
        content.removeAllViews()
        clock = null
        audioConsentBox = null

        content.addView(title("WorkBuddy"))
        if (!tokens.signedIn) {
            renderLogin()
        } else {
            renderMain()
        }
    }

    private fun renderLogin() {
        content.addView(muted("Sign in with your work email."))
        val email = EditText(this).apply {
            hint = "you@company.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            setSingleLine()
        }
        val password = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        content.addView(email, spaced(top = 16))
        content.addView(password, spaced(top = 8))
        message?.let { content.addView(error(it), spaced(top = 8)) }
        content.addView(
            primary(if (busy) "Signing in…" else "Sign in") {
                val e = email.text.toString().trim()
                val p = password.text.toString()
                if (e.isEmpty() || p.isEmpty()) {
                    message = "Enter your email and password."
                    render()
                } else {
                    act({ api.login(e, p) })
                }
            }.also { it.isEnabled = !busy },
            spaced(top = 16),
        )
        content.addView(muted("The first sign-in can take up to a minute while the server wakes up."), spaced(top = 12))
    }

    private fun renderMain() {
        val s = status
        val state = s?.optString("state") ?: ""
        val name = tokens.name ?: ""
        content.addView(muted(if (name.isEmpty()) "Signed in" else "Hello, ${name.substringBefore(' ')}"))
        message?.let { content.addView(error(it), spaced(top = 8)) }
        CaptureService.lastError?.let { if (!CaptureService.running) content.addView(error(it), spaced(top = 8)) }

        if (consentRequired) {
            renderConsent()
            content.addView(secondary("Sign out") { signOut() }, spaced(top = 24))
            return
        }

        if (s == null) {
            content.addView(muted("Loading…"), spaced(top = 16))
            content.addView(secondary("Sign out") { signOut() }, spaced(top = 24))
            return
        }

        val label = when (state) {
            "working" -> "Working"
            "on_break" -> "On break"
            else -> "Not punched in"
        }
        content.addView(heading(label), spaced(top = 16))
        content.addView(muted("Worked today"), spaced(top = 8))
        clock = TextView(this).apply {
            textSize = 40f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1A1B2E"))
        }
        content.addView(clock)
        tickClock()

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        when (state) {
            "working" -> {
                row.addView(secondary("Start break") { act({ api.request("POST", "/api/attendance/break-start") }) }, weight())
                row.addView(danger("Punch out") {
                    act({ api.request("POST", "/api/attendance/punch-out") }, then = { CaptureService.stop(this) })
                }, weight())
            }
            "on_break" -> {
                row.addView(secondary("End break") { act({ api.request("POST", "/api/attendance/break-end") }) }, weight())
                row.addView(danger("Punch out") {
                    act({ api.request("POST", "/api/attendance/punch-out") }, then = { CaptureService.stop(this) })
                }, weight())
            }
            else -> {
                row.addView(primary("Punch in") {
                    act({ api.request("POST", "/api/attendance/punch-in") }, then = { beginCapture() })
                }, weight())
            }
        }
        content.addView(row, spaced(top = 16))

        if (state != "punched_out") renderCapture(state)

        val waiting = app.outbox.pending()
        if (waiting > 0) content.addView(muted("$waiting capture(s) waiting to upload"), spaced(top = 12))

        content.addView(
            secondary("Open the web portal") {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.PORTAL_URL)))
            },
            spaced(top = 28),
        )
        content.addView(secondary("Sign out") { signOut() }, spaced(top = 8))
    }

    private fun renderCapture(state: String) {
        content.addView(heading("Capture"), spaced(top = 24))
        if (CaptureService.running) {
            val audio = status?.optBoolean("audioAllowed") == true
            content.addView(
                muted(
                    if (state == "on_break") {
                        "Paused while you are on a break. Nothing is captured."
                    } else {
                        "Your screen is being captured" + if (audio) " and short audio samples are recorded." else "."
                    },
                ),
                spaced(top = 4),
            )
            content.addView(secondary("Stop capture") { CaptureService.stop(this) }, spaced(top = 8))
        } else {
            content.addView(
                muted(
                    "Capture is off. Android asks you to allow screen capture each time you start it. " +
                        "While it runs, a notification stays visible.",
                ),
                spaced(top = 4),
            )
            content.addView(primary("Start capture") { beginCapture() }, spaced(top = 8))
        }
    }

    private fun renderConsent() {
        loadDisclosure()
        content.addView(heading("Before you start"), spaced(top = 16))
        content.addView(muted("Please read what WorkBuddy records and accept it to punch in."), spaced(top = 4))
        content.addView(TextView(this).apply {
            text = disclosure ?: "Loading…"
            textSize = 14f
            setTextColor(Color.parseColor("#1A1B2E"))
        }, spaced(top = 12))
        val audio = CheckBox(this).apply { text = "Also allow short audio samples (optional)" }
        audioConsentBox = audio
        content.addView(audio, spaced(top = 12))
        content.addView(
            primary("I understand and accept") {
                val withAudio = audioConsentBox?.isChecked == true
                act({
                    api.request(
                        "POST",
                        "/api/auth/consent",
                        JSONObject().put("monitoringConsent", true).put("audioConsent", withAudio),
                    )
                })
            }.also { it.isEnabled = disclosure != null && !busy },
            spaced(top = 16),
        )
    }

    private fun signOut() {
        CaptureService.stop(this)
        lifecycleScope.launch {
            withContext(Dispatchers.IO) { api.logout() }
            status = null
            consentRequired = false
            message = null
            render()
        }
    }

    private fun tickClock() {
        val view = clock ?: return
        val s = status ?: return
        val working = s.optString("state") == "working"
        val extra = if (working) (SystemClock.elapsedRealtime() - baseAtMs) / 1000 else 0L
        val total = baseWorked + extra
        view.text = String.format("%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    // --- Small view helpers -----------------------------------------------------------------

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun spaced(top: Int = 0) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(top) }

    private fun weight() =
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(4)
            marginEnd = dp(4)
        }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        textSize = 28f
        setTypeface(null, Typeface.BOLD)
        setTextColor(Color.parseColor("#5B3FD6"))
    }

    private fun heading(text: String) = TextView(this).apply {
        this.text = text
        textSize = 20f
        setTypeface(null, Typeface.BOLD)
        setTextColor(Color.parseColor("#1A1B2E"))
    }

    private fun muted(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        setTextColor(Color.parseColor("#625F78"))
    }

    private fun error(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        setTextColor(Color.parseColor("#A30D33"))
    }

    private fun primary(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#6D5EF0"))
        setOnClickListener { onClick() }
        isEnabled = !busy
    }

    private fun danger(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#A30D33"))
        setOnClickListener { onClick() }
        isEnabled = !busy
        gravity = Gravity.CENTER
    }

    private fun secondary(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        setOnClickListener { onClick() }
        isEnabled = !busy
    }
}
