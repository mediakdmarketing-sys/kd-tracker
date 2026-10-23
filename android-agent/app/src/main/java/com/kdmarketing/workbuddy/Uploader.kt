package com.kdmarketing.workbuddy

/**
 * Sends what is in the [Outbox]. The rules for what an answer means are the desktop agent's
 * (ADR-0004): success removes the item; "try again later" answers keep it; a refusal that
 * retrying cannot fix (bad request, no open shift, consent withdrawn) drops it, because
 * holding it forever would only block everything behind it.
 */
class Uploader(private val api: Api, private val outbox: Outbox) {

    /** Returns true if the session has ended and the person must sign in again. */
    fun drain(): Boolean {
        val now = System.currentTimeMillis()
        for (item in outbox.due(now)) {
            val blob = outbox.readBlob(item)
            if (blob == null) {
                outbox.remove(item)
                continue
            }
            val result = api.request("POST", item.endpoint, outbox.bodyFor(item, blob))
            when {
                result.ok -> outbox.remove(item)
                result.status == 0 -> {
                    // No answer at all: offline. Leave the rest alone and try again later.
                    outbox.backoff(item, now)
                    return false
                }
                result.status == 401 -> return true
                result.status == 429 || result.status >= 500 -> outbox.backoff(item, now)
                else -> outbox.remove(item)
            }
        }
        return false
    }
}
