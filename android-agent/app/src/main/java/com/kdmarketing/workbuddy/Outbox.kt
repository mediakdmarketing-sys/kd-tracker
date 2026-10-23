package com.kdmarketing.workbuddy

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Captures waiting to be uploaded. One small `.json` (what to send, and where) and one `.bin`
 * (the image or audio itself) per item, in the app's private storage, so a capture taken with
 * no signal survives a restart and goes out when the connection is back.
 */
class Outbox(context: Context) {
    private val dir = File(context.filesDir, "outbox").apply { mkdirs() }

    class Item(
        val id: String,
        val endpoint: String,
        val blobField: String,
        val payload: JSONObject,
        val attempts: Int,
        val nextAt: Long,
        val createdAt: Long,
    )

    @Synchronized
    fun enqueue(endpoint: String, blobField: String, payload: JSONObject, blob: ByteArray) {
        val id = UUID.randomUUID().toString()
        File(dir, "$id.bin").writeBytes(blob)
        val meta = JSONObject()
            .put("id", id)
            .put("endpoint", endpoint)
            .put("blobField", blobField)
            .put("payload", payload)
            .put("attempts", 0)
            .put("nextAt", 0L)
            .put("createdAt", System.currentTimeMillis())
        File(dir, "$id.json").writeText(meta.toString())
        trim()
    }

    /** Items ready to send now, oldest first. Anything the server would refuse as too old is dropped. */
    @Synchronized
    fun due(now: Long): List<Item> {
        val items = all()
        val result = ArrayList<Item>()
        for (item in items) {
            if (now - item.createdAt > MAX_AGE_MS) {
                remove(item)
            } else if (item.nextAt <= now) {
                result.add(item)
            }
        }
        return result
    }

    @Synchronized
    fun pending(): Int = dir.listFiles { f -> f.extension == "json" }?.size ?: 0

    @Synchronized
    fun readBlob(item: Item): ByteArray? = try {
        File(dir, "${item.id}.bin").readBytes()
    } catch (_: Exception) {
        null
    }

    @Synchronized
    fun remove(item: Item) {
        File(dir, "${item.id}.json").delete()
        File(dir, "${item.id}.bin").delete()
    }

    /** Try again later, waiting longer each time (30s, 1m, 2m ... capped at 15 minutes). */
    @Synchronized
    fun backoff(item: Item, now: Long) {
        val attempts = item.attempts + 1
        val waitMs = minOf(30_000L shl minOf(attempts - 1, 5), 15 * 60_000L)
        val file = File(dir, "${item.id}.json")
        try {
            val meta = JSONObject(file.readText())
            meta.put("attempts", attempts).put("nextAt", now + waitMs)
            file.writeText(meta.toString())
        } catch (_: Exception) {
            remove(item)
        }
    }

    fun bodyFor(item: Item, blob: ByteArray): JSONObject =
        JSONObject(item.payload.toString()).put(item.blobField, Base64.encodeToString(blob, Base64.NO_WRAP))

    private fun all(): List<Item> {
        val files = dir.listFiles { f -> f.extension == "json" } ?: return emptyList()
        return files.sortedBy { it.lastModified() }.mapNotNull { file ->
            try {
                val m = JSONObject(file.readText())
                Item(
                    id = m.getString("id"),
                    endpoint = m.getString("endpoint"),
                    blobField = m.getString("blobField"),
                    payload = m.getJSONObject("payload"),
                    attempts = m.optInt("attempts"),
                    nextAt = m.optLong("nextAt"),
                    createdAt = m.optLong("createdAt", file.lastModified()),
                )
            } catch (_: Exception) {
                file.delete()
                null
            }
        }
    }

    /** Never let a long outage fill the phone: keep the newest [MAX_ITEMS]. */
    private fun trim() {
        val items = all()
        if (items.size > MAX_ITEMS) items.take(items.size - MAX_ITEMS).forEach { remove(it) }
    }

    companion object {
        private const val MAX_ITEMS = 300
        private const val MAX_AGE_MS = 6L * 24 * 60 * 60 * 1000 // the server refuses anything older than 7 days
    }
}
