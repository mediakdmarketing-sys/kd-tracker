package com.kdmarketing.workbuddy

import android.app.Application

/** Holds the few objects the screen and the capture service share. */
class App : Application() {
    val tokens by lazy { TokenStore(this) }
    val api by lazy { Api(tokens) }
    val outbox by lazy { Outbox(this) }
}
