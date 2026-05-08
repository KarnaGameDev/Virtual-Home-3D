package com.roomscanner

import android.app.Activity
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.ar.core.ArCoreApk
import org.json.JSONArray
import org.json.JSONObject

class RoomScannerModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private var scanPromise: Promise? = null
    private val assetServer = AssetServer(reactContext, port = ASSET_SERVER_PORT)

    private val activityEventListener: BaseActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?,
            ) {
                if (requestCode != ROOM_SCAN_REQUEST_CODE) {
                    return
                }

                val promise = scanPromise ?: return
                scanPromise = null

                if (resultCode != Activity.RESULT_OK) {
                    promise.reject("SCAN_CANCELLED", "Room scan was cancelled.")
                    return
                }

                val roomJson = data?.getStringExtra(RoomScanActivity.EXTRA_ROOM_JSON)
                if (roomJson.isNullOrBlank()) {
                    promise.reject("SCAN_EMPTY_RESULT", "Room scan completed without a room model.")
                    return
                }

                try {
                    reactContext
                        .getSharedPreferences(PREFERENCES_NAME, 0)
                        .edit()
                        .putString(LATEST_ROOM_JSON_KEY, roomJson)
                        .apply()
                    promise.resolve(jsonObjectToWritableMap(JSONObject(roomJson)))
                } catch (error: Exception) {
                    promise.reject("SCAN_PARSE_FAILED", "Room scan result could not be parsed.", error)
                }
            }
        }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        try {
            assetServer.start()
        } catch (_: Exception) {
            // A previous module/activity instance may already be serving the preview assets.
        }
    }

    override fun getName(): String = "RoomScannerModule"

    @ReactMethod
    fun isSupported(promise: Promise) {
        val availability = ArCoreApk.getInstance().checkAvailability(reactApplicationContext)
        promise.resolve(availability.isSupported)
    }

    @ReactMethod
    fun scanRoom(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Room scanning needs an active Android activity.")
            return
        }

        if (scanPromise != null) {
            promise.reject("SCAN_IN_PROGRESS", "A room scan is already in progress.")
            return
        }

        scanPromise = promise
        activity.startActivityForResult(
            Intent(activity, RoomScanActivity::class.java),
            ROOM_SCAN_REQUEST_CODE,
        )
    }

    @ReactMethod
    fun getLatestRoom(promise: Promise) {
        val roomJson = reactContext
            .getSharedPreferences(PREFERENCES_NAME, 0)
            .getString(LATEST_ROOM_JSON_KEY, null)

        if (roomJson.isNullOrBlank()) {
            promise.resolve(null)
            return
        }

        try {
            promise.resolve(jsonObjectToWritableMap(JSONObject(roomJson)))
        } catch (error: Exception) {
            promise.reject("LATEST_ROOM_PARSE_FAILED", "Latest room could not be parsed.", error)
        }
    }

    @ReactMethod
    fun saveLatestRoom(roomJson: String, promise: Promise) {
        if (roomJson.isBlank()) {
            promise.reject("LATEST_ROOM_EMPTY", "Latest room JSON cannot be empty.")
            return
        }

        try {
            JSONObject(roomJson)
            reactContext
                .getSharedPreferences(PREFERENCES_NAME, 0)
                .edit()
                .putString(LATEST_ROOM_JSON_KEY, roomJson)
                .apply()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("LATEST_ROOM_SAVE_FAILED", "Latest room could not be saved.", error)
        }
    }

    @ReactMethod
    fun setSkyboxExposure(exposure: Float, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No activity is available.")
            return
        }

        activity.runOnUiThread {
            val webView = findWebView(activity.window.decorView)
            if (webView == null) {
                promise.reject("NO_WEBVIEW", "WebView not found.")
                return@runOnUiThread
            }

            webView.evaluateJavascript("setSkyboxExposure($exposure)", null)
            promise.resolve(true)
        }
    }

    override fun onCatalystInstanceDestroy() {
        assetServer.stop()
        super.onCatalystInstanceDestroy()
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) {
            return view
        }

        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                val found = findWebView(view.getChildAt(index))
                if (found != null) {
                    return found
                }
            }
        }

        return null
    }

    private fun jsonObjectToWritableMap(jsonObject: JSONObject): WritableMap {
        val map = Arguments.createMap()
        val keys = jsonObject.keys()

        while (keys.hasNext()) {
            val key = keys.next()
            when (val value = jsonObject.get(key)) {
                JSONObject.NULL -> map.putNull(key)
                is JSONObject -> map.putMap(key, jsonObjectToWritableMap(value))
                is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
                is Boolean -> map.putBoolean(key, value)
                is Int -> map.putInt(key, value)
                is Long -> map.putDouble(key, value.toDouble())
                is Double -> map.putDouble(key, value)
                is Number -> map.putDouble(key, value.toDouble())
                else -> map.putString(key, value.toString())
            }
        }

        return map
    }

    private fun jsonArrayToWritableArray(jsonArray: JSONArray): WritableArray {
        val array = Arguments.createArray()

        for (index in 0 until jsonArray.length()) {
            when (val value = jsonArray.get(index)) {
                JSONObject.NULL -> array.pushNull()
                is JSONObject -> array.pushMap(jsonObjectToWritableMap(value))
                is JSONArray -> array.pushArray(jsonArrayToWritableArray(value))
                is Boolean -> array.pushBoolean(value)
                is Int -> array.pushInt(value)
                is Long -> array.pushDouble(value.toDouble())
                is Double -> array.pushDouble(value)
                is Number -> array.pushDouble(value.toDouble())
                else -> array.pushString(value.toString())
            }
        }

        return array
    }

    companion object {
        private const val ASSET_SERVER_PORT = 8085
        private const val ROOM_SCAN_REQUEST_CODE = 4301
        private const val PREFERENCES_NAME = "room_scanner"
        private const val LATEST_ROOM_JSON_KEY = "latest_room_json"
    }
}
