package com.aash.optimizer

import android.content.Context
import android.view.MotionEvent
import android.webkit.WebView

/**
 * WebView that can hand its touch stream to the platform unbuffered, which removes the input
 * batching delay Android normally adds before delivering events to a view. That is a real,
 * measurable latency reduction for the app's own input pipeline (View.requestUnbufferedDispatch).
 */
class OptimizerWebView(context: Context, private val engine: OptimizerEngine) : WebView(context) {

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (engine.unbuffered) engine.requestUnbuffered(ev, this)
        return super.dispatchTouchEvent(ev)
    }
}
