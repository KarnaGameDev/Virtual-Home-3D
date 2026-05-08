package com.roomscanner

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import java.io.IOException

class AssetServer(
    private val context: Context,
    port: Int = 8085
) : NanoHTTPD(port) {

    override fun serve(session: IHTTPSession): Response {
        // Strip leading slash → asset path
        val path = session.uri.trimStart('/')

        return try {
            if (path == "latest_room.json") {
                val roomJson = context
                    .getSharedPreferences("room_scanner", 0)
                    .getString("latest_room_json", null)

                return newFixedLengthResponse(
                    if (roomJson.isNullOrBlank()) Response.Status.NOT_FOUND else Response.Status.OK,
                    "application/json",
                    roomJson ?: "{}"
                ).apply {
                    addHeader("Access-Control-Allow-Origin", "*")
                    addHeader("Cache-Control", "no-store")
                }
            }

            val stream = context.assets.open(path)
            val mime = when {
                path.endsWith(".hdr") -> "application/octet-stream"
                path.endsWith(".glb") -> "model/gltf-binary"
                path.endsWith(".gltf") -> "model/gltf+json"
                path.endsWith(".js")  -> "application/javascript"
                path.endsWith(".html")-> "text/html"
                path.endsWith(".png") -> "image/png"
                path.endsWith(".jpg") -> "image/jpeg"
                else -> "application/octet-stream"
            }
            newChunkedResponse(Response.Status.OK, mime, stream).apply {
                addHeader("Access-Control-Allow-Origin", "*")
                if (path.endsWith(".html")) {
                    addHeader("Cache-Control", "no-store")
                } else {
                    addHeader("Cache-Control", "public, max-age=86400")
                }
            }
        } catch (e: IOException) {
            newFixedLengthResponse(
                Response.Status.NOT_FOUND, "text/plain", "Not found: $path"
            )
        }
    }
}
