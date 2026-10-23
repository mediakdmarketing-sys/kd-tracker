package com.kdmarketing.workbuddy

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** An HTTP answer. `status` is 0 when there was no answer at all (offline, timeout). */
class ApiResult(val status: Int, val body: JSONObject?) {
    val ok: Boolean get() = status in 200..299

    /** The server's own error sentence, or a generic one. */
    fun message(fallback: String = "Something went wrong"): String =
        body?.optJSONObject("error")?.optString("message")?.takeIf { it.isNotEmpty() } ?: fallback
}

/**
 * Thin client for the WorkBuddy backend. Adds the bearer token, and on a 401 refreshes the
 * session once and repeats the call. Calls block, so run them off the main thread.
 */
class Api(private val tokens: TokenStore) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS) // the free host can take a while to wake up
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()
    private val json = "application/json; charset=utf-8".toMediaType()
    private val refreshLock = Any()

    fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): ApiResult {
        var result = send(method, path, body, auth)
        if (auth && result.status == 401 && refresh()) result = send(method, path, body, auth)
        return result
    }

    fun login(email: String, password: String): ApiResult {
        val result = request(
            "POST",
            "/api/auth/login",
            JSONObject().put("email", email).put("password", password).put("client", "android"),
            auth = false,
        )
        if (result.ok) saveSession(result.body)
        return result
    }

    fun logout() {
        val refresh = tokens.refreshToken
        if (refresh != null) {
            try {
                send("POST", "/api/auth/logout", JSONObject().put("refreshToken", refresh), auth = false)
            } catch (_: Exception) {
                // Signing out on this phone must work even with no network.
            }
        }
        tokens.clear()
    }

    private fun saveSession(body: JSONObject?) {
        if (body == null) return
        tokens.accessToken = body.optString("accessToken")
        tokens.refreshToken = body.optString("refreshToken")
        body.optJSONObject("employee")?.optString("name")?.let { tokens.name = it }
    }

    /** Exchanges the refresh token for a new pair. False when the session cannot be renewed. */
    private fun refresh(): Boolean {
        synchronized(refreshLock) {
            val refresh = tokens.refreshToken ?: return false
            val result = send("POST", "/api/auth/refresh", JSONObject().put("refreshToken", refresh), auth = false)
            if (result.ok) {
                saveSession(result.body)
                return true
            }
            // Rejected outright (signed out by HR, or the account was deactivated): drop it. A
            // status of 0 is only "no network", which must not sign anybody out.
            if (result.status == 401 || result.status == 403) tokens.clear()
            return false
        }
    }

    private fun send(method: String, path: String, body: JSONObject?, auth: Boolean): ApiResult {
        val builder = Request.Builder().url(BuildConfig.API_BASE_URL + path)
        if (auth) tokens.accessToken?.let { builder.header("Authorization", "Bearer $it") }
        if (method == "GET") {
            builder.get()
        } else {
            builder.method(method, (body?.toString() ?: "{}").toRequestBody(json))
        }
        return try {
            http.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val parsed = try {
                    if (text.isNotEmpty()) JSONObject(text) else null
                } catch (_: Exception) {
                    null
                }
                ApiResult(response.code, parsed)
            }
        } catch (_: java.io.IOException) {
            ApiResult(0, null)
        }
    }
}
