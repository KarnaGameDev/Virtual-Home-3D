package com.roomscanner

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.Image
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.google.ar.core.Camera
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.NotYetAvailableException
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.time.Instant
import java.util.UUID
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class RoomScanActivity : Activity() {
    private var session: Session? = null
    private lateinit var surfaceView: GLSurfaceView
    private lateinit var renderer: ArCameraRenderer
    private lateinit var statusText: TextView
    private lateinit var finishButton: Button
    private lateinit var undoCornerButton: Button
    private var depthEnabled = false
    private var latestStats = ScanStats()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLayout()

        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startArCoreSession()
        } else {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
        }
    }

    override fun onResume() {
        super.onResume()
        session?.resume()
        surfaceView.onResume()
    }

    override fun onPause() {
        surfaceView.onPause()
        session?.pause()
        super.onPause()
    }

    override fun onDestroy() {
        session?.close()
        session = null
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (
            requestCode == CAMERA_PERMISSION_REQUEST &&
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        ) {
            startArCoreSession()
        } else {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    private fun buildLayout() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF101418.toInt())
        }

        renderer = ArCameraRenderer(::onFrameUpdated)
        surfaceView = GLSurfaceView(this).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) {
                    renderer.queueCornerTap(event.x, event.y)
                }
                true
            }
        }

        statusText = TextView(this).apply {
            text = "Preparing ARCore."
            textSize = 15f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xAA101418.toInt())
            setPadding(24, 18, 24, 18)
        }

        finishButton = Button(this).apply {
            text = "Scan first"
            isEnabled = false
            setOnClickListener { finishWithRoomModel() }
        }
        undoCornerButton = Button(this).apply {
            text = "Undo Corner"
            isEnabled = false
            setOnClickListener { renderer.undoLastCorner() }
        }
        val bottomControls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(
                undoCornerButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            addView(
                finishButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }

        root.addView(
            surfaceView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        root.addView(
            statusText,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP,
            ),
        )
        root.addView(
            bottomControls,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM,
            ).apply {
                leftMargin = 32
                rightMargin = 32
                bottomMargin = 48
            },
        )

        setContentView(root)
    }

    private fun startArCoreSession() {
        try {
            val nextSession = Session(this)
            val config = Config(nextSession).apply {
                planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                focusMode = Config.FocusMode.AUTO
                lightEstimationMode = Config.LightEstimationMode.ENVIRONMENTAL_HDR
            }

            if (nextSession.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY)) {
                config.depthMode = Config.DepthMode.RAW_DEPTH_ONLY
                depthEnabled = true
            } else if (nextSession.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                config.depthMode = Config.DepthMode.AUTOMATIC
                depthEnabled = true
            }

            nextSession.configure(config)
            session = nextSession
            renderer.setSession(nextSession)
            nextSession.resume()
            surfaceView.onResume()

            latestStats = ScanStats(depthEnabled = depthEnabled)
            updateScanUiV2(latestStats)
        } catch (error: Exception) {
            statusText.text = "ARCore could not start on this device: ${error.localizedMessage}"
            finishButton.visibility = View.GONE
        }
    }

    private fun onFrameUpdated(stats: ScanStats) {
        runOnUiThread {
            latestStats = stats.copy(depthEnabled = depthEnabled)
            updateScanUiV2(latestStats)
        }
    }

    private fun updateScanUiV2(stats: ScanStats) {
        val tracking = if (stats.cameraTracking) "tracking" else "finding position"
        val floorText = if (stats.floorFound) "floor found" else "scan floor"
        val depthText = if (stats.depthFrameCount > 0) {
            "depth active"
        } else if (depthEnabled) {
            "depth waiting"
        } else {
            "depth off"
        }
        val qualityLabel = stats.quality.replaceFirstChar { it.uppercase() }

        statusText.text = "${stats.scanPhase} - $qualityLabel - $tracking - $depthText\n" +
            "$floorText - ${stats.markedCornerCount} corners - ${stats.stableWallDirections}/2 wall directions - ${stats.wallConfidence}% confidence\n" +
            guidanceForV2(stats)

        finishButton.isEnabled = stats.isGoodEnough
        finishButton.text = if (stats.isGoodEnough) {
            "Finish Scan"
        } else {
            "Keep Scanning"
        }
        undoCornerButton.isEnabled = stats.markedCornerCount > 0
    }

    private fun guidanceForV2(stats: ScanStats): String {
        if (!stats.cameraTracking) return "Move slowly so ARCore can lock onto the room."
        if (!stats.floorFound) return "Find floor: point at the floor and move side to side."
        if (stats.markedCornerCount < 3) return "Tap room corners on the floor edge, in order. Minimum 3 corners."
        if (stats.markedCornerCount >= 3) return "Corner room ready. Add more corners or finish."
        if (stats.stableWallDirections == 0) return "Scan wall 1: stand 1-3m back and move sideways slowly."
        if (stats.stableWallDirections < 2) return "Scan wall 2: turn to another wall, avoid furniture in front."
        if (stats.wallConfidence < READY_WALL_CONFIDENCE) return "Scan corners: slowly sweep along wall edges."
        return "Ready. You can finish, or scan more for a cleaner layout."
    }

    private fun updateScanUi(stats: ScanStats) {
        val tracking = if (stats.cameraTracking) "tracking" else "finding position"
        val floorText = if (stats.floorFound) "floor found" else "scan floor"
        val depthText = if (depthEnabled) "depth on" else "depth off"
        val qualityLabel = stats.quality.replaceFirstChar { it.uppercase() }
        val guidance = guidanceFor(stats)

        statusText.text = "$qualityLabel scan • $tracking • $depthText\n" +
            "$floorText • ${stats.wallCount} walls • ${stats.planeCount} planes\n" +
            guidance

        finishButton.isEnabled = stats.hasAnyUsablePlane
        finishButton.text = if (stats.isGoodEnough) {
            "Finish Scan"
        } else if (stats.hasAnyUsablePlane) {
            "Finish Estimated Scan"
        } else {
            "Move to Detect Surfaces"
        }
    }

    private fun guidanceFor(stats: ScanStats): String {
        if (!stats.cameraTracking) return "Move slowly so ARCore can lock onto the room."
        if (!stats.floorFound) return "Point at the floor and move side to side."
        if (stats.wallCount < 2) return "Point at different walls and room corners."
        if (stats.planeCount < GOOD_SCAN_PLANE_COUNT) return "Scan slowly along the wall edges."
        return "Good coverage. You can finish or scan a little more."
    }

    private fun finishWithRoomModel() {
        val roomJson = createRoomModelFromTrackedPlanes()
        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(EXTRA_ROOM_JSON, roomJson.toString()),
        )
        finish()
    }

    private fun createRoomModelFromTrackedPlanes(): JSONObject {
        val geometry = renderer.buildRoomGeometry()
        val detectedSurfaces = geometry.surfaces.filter { it.source == "detected" }
        val estimatedSurfaces = geometry.surfaces.filter { it.source == "estimated" }
        val stats = geometry.stats.copy(depthEnabled = depthEnabled, cameraTracking = latestStats.cameraTracking)
        val quality = geometry.quality

        return JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("name", "Android ARCore Scan")
            .put("createdAt", Instant.now().toString())
            .put("scanner", "android-arcore")
            .put("units", "meters")
            .put("quality", quality)
            .put("detectedSurfaceCount", detectedSurfaces.size)
            .put("estimatedSurfaceCount", estimatedSurfaces.size)
            .put("depthEnabled", depthEnabled)
            .put("depthFrameCount", stats.depthFrameCount)
            .put("depthPointCount", stats.depthPointCount)
            .put("rawDepthConfidence", stats.rawDepthConfidence)
            .put("wallConfidence", stats.wallConfidence)
            .put("markedCornerCount", stats.markedCornerCount)
            .put("scanDurationMs", stats.scanDurationMs)
            .put("scanPhase", stats.scanPhase)
            .put("manualCorners", JSONArray().apply {
                geometry.manualCorners.forEach { put(it.toJson()) }
            })
            .put("surfaces", JSONArray().apply {
                geometry.surfaces.forEach { put(it.toJson()) }
            })
            .put("openings", JSONArray())
    }

    companion object {
        const val EXTRA_ROOM_JSON = "room_json"
        private const val CAMERA_PERMISSION_REQUEST = 8301
        private const val GOOD_SCAN_PLANE_COUNT = 4
        private const val READY_WALL_CONFIDENCE = 45
    }
}

private class ArCameraRenderer(
    private val onFrameUpdated: (ScanStats) -> Unit,
) : GLSurfaceView.Renderer {
    private var session: Session? = null
    private var textureId = 0
    private var cameraProgram = 0
    private var planeProgram = 0
    private var positionAttribute = 0
    private var texCoordAttribute = 0
    private var textureUniform = 0
    private var planePositionAttribute = 0
    private var planeMvpUniform = 0
    private var planeColorUniform = 0
    private var viewportWidth = 1
    private var viewportHeight = 1
    private var frameCounter = 0

    private val quadCoords = floatBuffer(
        -1f, -1f,
        1f, -1f,
        -1f, 1f,
        1f, 1f,
    )
    private val texCoordBuffer = floatBuffer(
        0f, 1f,
        1f, 1f,
        0f, 0f,
        1f, 0f,
    )
    private val viewMatrix = FloatArray(16)
    private val projectionMatrix = FloatArray(16)
    private val modelMatrix = FloatArray(16)
    private val modelViewProjectionMatrix = FloatArray(16)
    private val modelViewMatrix = FloatArray(16)
    private val geometryBuilder = PersistentRoomGeometryBuilder()
    private val pendingCornerTaps = mutableListOf<Pair<Float, Float>>()

    fun setSession(nextSession: Session) {
        session = nextSession
        geometryBuilder.reset()
        if (textureId != 0) {
            nextSession.setCameraTextureName(textureId)
        }
    }

    fun buildRoomGeometry(): RoomGeometry {
        return geometryBuilder.buildRoomGeometry()
    }

    fun queueCornerTap(x: Float, y: Float) {
        synchronized(pendingCornerTaps) {
            pendingCornerTaps.add(x to y)
        }
    }

    fun undoLastCorner() {
        geometryBuilder.undoLastManualCorner()
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        textureId = createExternalTexture()
        cameraProgram = createProgram(CAMERA_VERTEX_SHADER, CAMERA_FRAGMENT_SHADER)
        planeProgram = createProgram(PLANE_VERTEX_SHADER, PLANE_FRAGMENT_SHADER)
        positionAttribute = GLES20.glGetAttribLocation(cameraProgram, "a_Position")
        texCoordAttribute = GLES20.glGetAttribLocation(cameraProgram, "a_TexCoord")
        textureUniform = GLES20.glGetUniformLocation(cameraProgram, "u_Texture")
        planePositionAttribute = GLES20.glGetAttribLocation(planeProgram, "a_Position")
        planeMvpUniform = GLES20.glGetUniformLocation(planeProgram, "u_ModelViewProjection")
        planeColorUniform = GLES20.glGetUniformLocation(planeProgram, "u_Color")
        session?.setCameraTextureName(textureId)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        viewportWidth = width
        viewportHeight = height
        GLES20.glViewport(0, 0, width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val currentSession = session ?: return

        try {
            currentSession.setDisplayGeometry(0, viewportWidth, viewportHeight)
            val frame = currentSession.update()
            drawCameraFrame(frame)
            processPendingCornerTaps(frame)
            drawTrackedPlanes(currentSession, frame.camera)
            drawManualCorners(frame.camera)
            maybeReportScanStats(currentSession, frame, frame.camera)
        } catch (_: Exception) {
            // ARCore can briefly throw while camera permissions/session state settle.
        }
    }

    private fun drawCameraFrame(frame: Frame) {
        if (frame.hasDisplayGeometryChanged()) {
            frame.transformCoordinates2d(
                Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,
                quadCoords,
                Coordinates2d.TEXTURE_NORMALIZED,
                texCoordBuffer,
            )
        }

        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glUseProgram(cameraProgram)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glUniform1i(textureUniform, 0)

        quadCoords.position(0)
        GLES20.glVertexAttribPointer(positionAttribute, 2, GLES20.GL_FLOAT, false, 0, quadCoords)
        GLES20.glEnableVertexAttribArray(positionAttribute)

        texCoordBuffer.position(0)
        GLES20.glVertexAttribPointer(texCoordAttribute, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer)
        GLES20.glEnableVertexAttribArray(texCoordAttribute)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(positionAttribute)
        GLES20.glDisableVertexAttribArray(texCoordAttribute)
    }

    private fun processPendingCornerTaps(frame: Frame) {
        val taps = synchronized(pendingCornerTaps) {
            pendingCornerTaps.toList().also { pendingCornerTaps.clear() }
        }
        if (taps.isEmpty() || frame.camera.trackingState != TrackingState.TRACKING) return

        taps.forEach { tap ->
            val hit = frame.hitTest(tap.first, tap.second)
                .firstOrNull { hitResult ->
                    val plane = hitResult.trackable as? Plane
                    plane != null &&
                        plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING &&
                        plane.trackingState == TrackingState.TRACKING &&
                        plane.isPoseInPolygon(hitResult.hitPose)
                }
            if (hit != null) {
                val pose = hit.hitPose
                geometryBuilder.addManualCorner(
                    Vec3(
                        x = pose.tx().toDouble(),
                        y = 0.0,
                        z = pose.tz().toDouble(),
                    ),
                )
            }
        }
    }

    private fun drawTrackedPlanes(currentSession: Session, camera: Camera) {
        if (camera.trackingState != TrackingState.TRACKING) return

        camera.getViewMatrix(viewMatrix, 0)
        camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 100f)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(planeProgram)

        currentSession
            .getAllTrackables(Plane::class.java)
            .filter(::isRenderableRoomPlane)
            .forEach { plane -> drawPlane(plane) }

        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawManualCorners(camera: Camera) {
        val corners = geometryBuilder.manualCorners()
        if (corners.isEmpty() || camera.trackingState != TrackingState.TRACKING) return

        camera.getViewMatrix(viewMatrix, 0)
        camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 100f)
        Matrix.multiplyMM(modelViewProjectionMatrix, 0, projectionMatrix, 0, viewMatrix, 0)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(planeProgram)
        GLES20.glUniformMatrix4fv(planeMvpUniform, 1, false, modelViewProjectionMatrix, 0)

        if (corners.size >= 2) {
            val linePoints = mutableListOf<Float>()
            corners.forEach { corner ->
                linePoints.add(corner.x.toFloat())
                linePoints.add((corner.y + CORNER_MARKER_HEIGHT_METERS).toFloat())
                linePoints.add(corner.z.toFloat())
            }
            if (corners.size >= 3) {
                linePoints.add(corners.first().x.toFloat())
                linePoints.add((corners.first().y + CORNER_MARKER_HEIGHT_METERS).toFloat())
                linePoints.add(corners.first().z.toFloat())
            }
            val lineBuffer = floatBuffer(*linePoints.toFloatArray())
            GLES20.glUniform4fv(planeColorUniform, 1, floatArrayOf(1f, 0.86f, 0.28f, 0.92f), 0)
            GLES20.glVertexAttribPointer(planePositionAttribute, 3, GLES20.GL_FLOAT, false, 0, lineBuffer)
            GLES20.glEnableVertexAttribArray(planePositionAttribute)
            GLES20.glLineWidth(6f)
            GLES20.glDrawArrays(GLES20.GL_LINE_STRIP, 0, linePoints.size / 3)
            GLES20.glDisableVertexAttribArray(planePositionAttribute)
        }

        val pointBuffer = floatBuffer(*corners.flatMap { corner ->
            listOf(
                corner.x.toFloat(),
                (corner.y + CORNER_MARKER_HEIGHT_METERS).toFloat(),
                corner.z.toFloat(),
            )
        }.toFloatArray())
        GLES20.glUniform4fv(planeColorUniform, 1, floatArrayOf(0.18f, 0.96f, 0.74f, 1f), 0)
        GLES20.glVertexAttribPointer(planePositionAttribute, 3, GLES20.GL_FLOAT, false, 0, pointBuffer)
        GLES20.glEnableVertexAttribArray(planePositionAttribute)
        GLES20.glDrawArrays(GLES20.GL_POINTS, 0, corners.size)
        GLES20.glDisableVertexAttribArray(planePositionAttribute)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawPlane(plane: Plane) {
        val polygon = plane.polygon.asReadOnlyBuffer()
        if (polygon.limit() < 6) return

        val vertices = FloatArray((polygon.limit() / 2) * 3)
        polygon.position(0)
        var vertexIndex = 0
        while (polygon.remaining() >= 2) {
            vertices[vertexIndex++] = polygon.get()
            vertices[vertexIndex++] = 0f
            vertices[vertexIndex++] = polygon.get()
        }

        plane.centerPose.toMatrix(modelMatrix, 0)
        Matrix.multiplyMM(modelViewMatrix, 0, viewMatrix, 0, modelMatrix, 0)
        Matrix.multiplyMM(modelViewProjectionMatrix, 0, projectionMatrix, 0, modelViewMatrix, 0)

        val color = when (plane.type) {
            Plane.Type.VERTICAL -> floatArrayOf(0.82f, 0.92f, 0.9f, 0.34f)
            Plane.Type.HORIZONTAL_UPWARD_FACING -> floatArrayOf(0.12f, 0.74f, 0.58f, 0.34f)
            Plane.Type.HORIZONTAL_DOWNWARD_FACING -> floatArrayOf(0.12f, 0.74f, 0.58f, 0.34f)
        }
        val vertexBuffer = floatBuffer(*vertices)

        GLES20.glUniformMatrix4fv(planeMvpUniform, 1, false, modelViewProjectionMatrix, 0)
        GLES20.glUniform4fv(planeColorUniform, 1, color, 0)
        GLES20.glVertexAttribPointer(planePositionAttribute, 3, GLES20.GL_FLOAT, false, 0, vertexBuffer)
        GLES20.glEnableVertexAttribArray(planePositionAttribute)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_FAN, 0, vertices.size / 3)
        GLES20.glDisableVertexAttribArray(planePositionAttribute)
    }

    private fun maybeReportScanStats(currentSession: Session, frame: Frame, camera: Camera) {
        frameCounter += 1
        if (frameCounter % GEOMETRY_SAMPLE_FRAME_INTERVAL != 0) return

        val planes = currentSession
            .getAllTrackables(Plane::class.java)
            .filter(::isRenderableRoomPlane)
        val depthSample = acquireDepthSample(frame, camera)
        geometryBuilder.processPlanes(planes, depthSample, camera.pose)
        if (frameCounter % UI_REPORT_FRAME_INTERVAL != 0) return

        val stats = geometryBuilder.currentStats(
            planeCount = planes.size,
            cameraTracking = camera.trackingState == TrackingState.TRACKING,
        )
        onFrameUpdated(stats)
    }

    private fun acquireDepthSample(frame: Frame, camera: Camera): DepthSample? {
        return try {
            frame.acquireRawDepthImage16Bits().use { rawDepthImage ->
                frame.acquireRawDepthConfidenceImage().use { confidenceImage ->
                    sampleRawDepthImages(rawDepthImage, confidenceImage, camera)
                }
            }
        } catch (_: NotYetAvailableException) {
            acquireFallbackDepthSample(frame)
        } catch (_: Exception) {
            acquireFallbackDepthSample(frame)
        }
    }

    private fun acquireFallbackDepthSample(frame: Frame): DepthSample? {
        return try {
            frame.acquireDepthImage16Bits().use(::sampleDepthImage)
        } catch (_: Exception) {
            null
        }
    }

    private fun sampleRawDepthImages(depthImage: Image, confidenceImage: Image, camera: Camera): DepthSample {
        val depthPlane = depthImage.planes.first()
        val depthBuffer = depthPlane.buffer.order(ByteOrder.nativeOrder())
        val confidencePlane = confidenceImage.planes.first()
        val confidenceBuffer = confidencePlane.buffer.order(ByteOrder.nativeOrder())
        val width = min(depthImage.width, confidenceImage.width)
        val height = min(depthImage.height, confidenceImage.height)
        val depthRowStride = depthPlane.rowStride
        val depthPixelStride = depthPlane.pixelStride
        val confidenceRowStride = confidencePlane.rowStride
        val confidencePixelStride = confidencePlane.pixelStride
        val sampleStep = calculateImageSubsamplingStep(width, height, RAW_DEPTH_POINT_LIMIT)
        var validCount = 0
        var highConfidenceCount = 0
        var closeCount = 0
        var totalMeters = 0.0
        val points = mutableListOf<DepthPoint>()
        val intrinsics = camera.textureIntrinsics
        val focalLength = intrinsics.focalLength
        val principalPoint = intrinsics.principalPoint
        val imageDimensions = intrinsics.imageDimensions
        val scaleX = width.toDouble() / imageDimensions[0].toDouble()
        val scaleY = height.toDouble() / imageDimensions[1].toDouble()
        val fx = focalLength[0] * scaleX
        val fy = focalLength[1] * scaleY
        val cx = principalPoint[0] * scaleX
        val cy = principalPoint[1] * scaleY

        for (y in 0 until height step sampleStep) {
            for (x in 0 until width step sampleStep) {
                val depthOffset = y * depthRowStride + x * depthPixelStride
                val confidenceOffset = y * confidenceRowStride + x * confidencePixelStride
                if (depthOffset + 1 >= depthBuffer.limit() || confidenceOffset >= confidenceBuffer.limit()) {
                    continue
                }

                val millimeters = depthBuffer.getShort(depthOffset).toInt() and 0xFFFF
                if (millimeters <= 0) continue

                val confidence = confidenceBuffer.get(confidenceOffset).toInt() and 0xFF

                val meters = millimeters / 1000.0
                validCount += 1
                totalMeters += meters
                if (confidence >= MIN_RAW_DEPTH_CONFIDENCE) {
                    highConfidenceCount += 1
                }
                if (meters < CLOSE_OBJECT_DEPTH_METERS) {
                    closeCount += 1
                }
                if (confidence >= MIN_RAW_POINT_CONFIDENCE && meters in MIN_POINT_DEPTH_METERS..MAX_POINT_DEPTH_METERS) {
                    val cameraX = ((x - cx) * meters / fx).toFloat()
                    val cameraY = ((cy - y) * meters / fy).toFloat()
                    val cameraZ = (-meters).toFloat()
                    val worldPoint = camera.pose.transformPoint(floatArrayOf(cameraX, cameraY, cameraZ))
                    points.add(
                        DepthPoint(
                            x = worldPoint[0].toDouble(),
                            y = worldPoint[1].toDouble(),
                            z = worldPoint[2].toDouble(),
                            confidence = confidence / 255.0,
                        ),
                    )
                }
            }
        }

        return DepthSample(
            averageMeters = if (validCount > 0) totalMeters / validCount else 0.0,
            closeObjectRatio = if (validCount > 0) closeCount.toDouble() / validCount else 0.0,
            highConfidenceRatio = if (validCount > 0) highConfidenceCount.toDouble() / validCount else 0.0,
            validCount = validCount,
            points = points,
        )
    }

    private fun sampleDepthImage(image: Image): DepthSample {
        val plane = image.planes.first()
        val buffer = plane.buffer.order(ByteOrder.nativeOrder())
        val width = image.width
        val height = image.height
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        var validCount = 0
        var closeCount = 0
        var totalMeters = 0.0

        for (yIndex in 1..DEPTH_SAMPLE_GRID_SIZE) {
            val y = yIndex * height / (DEPTH_SAMPLE_GRID_SIZE + 1)
            for (xIndex in 1..DEPTH_SAMPLE_GRID_SIZE) {
                val x = xIndex * width / (DEPTH_SAMPLE_GRID_SIZE + 1)
                val offset = y * rowStride + x * pixelStride
                if (offset + 1 >= buffer.limit()) continue
                val millimeters = buffer.getShort(offset).toInt() and 0xFFFF
                if (millimeters <= 0) continue
                val meters = millimeters / 1000.0
                validCount += 1
                totalMeters += meters
                if (meters < CLOSE_OBJECT_DEPTH_METERS) {
                    closeCount += 1
                }
            }
        }

        return DepthSample(
            averageMeters = if (validCount > 0) totalMeters / validCount else 0.0,
            closeObjectRatio = if (validCount > 0) closeCount.toDouble() / validCount else 0.0,
            highConfidenceRatio = if (validCount > 0) 0.5 else 0.0,
            validCount = validCount,
            points = emptyList(),
        )
    }

    private fun calculateImageSubsamplingStep(width: Int, height: Int, pointLimit: Int): Int {
        if (width <= 0 || height <= 0 || pointLimit <= 0) return 1
        return kotlin.math.ceil(kotlin.math.sqrt(width.toDouble() * height.toDouble() / pointLimit.toDouble()))
            .roundToInt()
            .coerceAtLeast(1)
    }

    private fun isRenderableRoomPlane(plane: Plane): Boolean {
        if (plane.trackingState != TrackingState.TRACKING || plane.subsumedBy != null) {
            return false
        }

        return when (plane.type) {
            Plane.Type.HORIZONTAL_UPWARD_FACING ->
                plane.extentX >= RENDER_MIN_FLOOR_SIZE_METERS &&
                    plane.extentZ >= RENDER_MIN_FLOOR_SIZE_METERS
            Plane.Type.VERTICAL -> {
                val width = max(plane.extentX, plane.extentZ)
                val height = min(plane.extentX, plane.extentZ)
                val area = plane.extentX * plane.extentZ
                val centerY = plane.centerPose.ty()

                width >= RENDER_MIN_WALL_WIDTH_METERS &&
                    height >= RENDER_MIN_WALL_HEIGHT_METERS &&
                    area >= RENDER_MIN_WALL_AREA_METERS &&
                    centerY >= RENDER_MIN_WALL_CENTER_Y_METERS
            }
            Plane.Type.HORIZONTAL_DOWNWARD_FACING -> false
        }
    }

    private fun createExternalTexture(): Int {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textures[0])
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return textures[0]
    }

    private fun createProgram(vertexShaderCode: String, fragmentShaderCode: String): Int {
        val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode)
        val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode)
        return GLES20.glCreateProgram().also { nextProgram ->
            GLES20.glAttachShader(nextProgram, vertexShader)
            GLES20.glAttachShader(nextProgram, fragmentShader)
            GLES20.glLinkProgram(nextProgram)
        }
    }

    private fun loadShader(type: Int, shaderCode: String): Int {
        return GLES20.glCreateShader(type).also { shader ->
            GLES20.glShaderSource(shader, shaderCode)
            GLES20.glCompileShader(shader)
        }
    }

    companion object {
        private const val CAMERA_VERTEX_SHADER = """
            attribute vec4 a_Position;
            attribute vec2 a_TexCoord;
            varying vec2 v_TexCoord;
            void main() {
                gl_Position = a_Position;
                v_TexCoord = a_TexCoord;
            }
        """

        private const val CAMERA_FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES u_Texture;
            varying vec2 v_TexCoord;
            void main() {
                gl_FragColor = texture2D(u_Texture, v_TexCoord);
            }
        """

        private const val PLANE_VERTEX_SHADER = """
            uniform mat4 u_ModelViewProjection;
            attribute vec4 a_Position;
            void main() {
                gl_Position = u_ModelViewProjection * a_Position;
                gl_PointSize = 20.0;
            }
        """

        private const val PLANE_FRAGMENT_SHADER = """
            precision mediump float;
            uniform vec4 u_Color;
            void main() {
                gl_FragColor = u_Color;
            }
        """

        private const val CLOSE_OBJECT_DEPTH_METERS = 0.85
        private const val CORNER_MARKER_HEIGHT_METERS = 0.035
        private const val DEPTH_SAMPLE_GRID_SIZE = 9
        private const val GEOMETRY_SAMPLE_FRAME_INTERVAL = 5
        private const val MAX_POINT_DEPTH_METERS = 5.5
        private const val MIN_RAW_POINT_CONFIDENCE = 112
        private const val MIN_RAW_DEPTH_CONFIDENCE = 128
        private const val MIN_POINT_DEPTH_METERS = 0.75
        private const val RAW_DEPTH_POINT_LIMIT = 1800
        private const val UI_REPORT_FRAME_INTERVAL = 20
        private const val RENDER_MIN_FLOOR_SIZE_METERS = 0.45f
        private const val RENDER_MIN_WALL_AREA_METERS = 0.18f
        private const val RENDER_MIN_WALL_CENTER_Y_METERS = 0.25f
        private const val RENDER_MIN_WALL_HEIGHT_METERS = 0.3f
        private const val RENDER_MIN_WALL_WIDTH_METERS = 0.55f
    }
}

private data class ScanStats(
    val planeCount: Int = 0,
    val wallCount: Int = 0,
    val stableWallDirections: Int = 0,
    val wallConfidence: Int = 0,
    val floorFound: Boolean = false,
    val depthEnabled: Boolean = false,
    val depthFrameCount: Int = 0,
    val depthPointCount: Int = 0,
    val rawDepthConfidence: Int = 0,
    val markedCornerCount: Int = 0,
    val scanDurationMs: Long = 0,
    val scanPhase: String = "Find floor",
    val cameraTracking: Boolean = false,
) {
    val hasAnyUsablePlane: Boolean
        get() = markedCornerCount >= 3 || floorFound || wallCount > 0 || planeCount > 0 || depthFrameCount > 0
    val isGoodEnough: Boolean
        get() = markedCornerCount >= 3 || (floorFound && stableWallDirections >= 2 && wallConfidence >= 45)
    val quality: String
        get() = when {
            markedCornerCount >= 4 -> "good"
            isGoodEnough && wallConfidence >= 70 -> "good"
            hasAnyUsablePlane -> "estimated"
            else -> "poor"
        }
}

private data class DepthSample(
    val averageMeters: Double,
    val closeObjectRatio: Double,
    val highConfidenceRatio: Double,
    val validCount: Int,
    val points: List<DepthPoint>,
)

private data class DepthPoint(
    val x: Double,
    val y: Double,
    val z: Double,
    val confidence: Double,
)

private data class RoomGeometry(
    val surfaces: List<SurfaceDraft>,
    val stats: ScanStats,
    val quality: String,
    val manualCorners: List<Vec3> = emptyList(),
)

private class PersistentRoomGeometryBuilder {
    private val lock = Any()
    private val floorCandidates = mutableListOf<FloorCandidate>()
    private val wallCandidates = mutableListOf<WallCandidate>()
    private val depthPoints = mutableListOf<DepthPoint>()
    private val manualCorners = mutableListOf<Vec3>()
    private var processedPlaneCount = 0
    private var depthFrameCount = 0
    private var rawDepthConfidenceTotal = 0.0
    private var scanStartedAtMs = SystemClock.elapsedRealtime()

    val floorFound: Boolean
        get() = synchronized(lock) { floorCandidates.isNotEmpty() }

    val wallCount: Int
        get() = synchronized(lock) { wallCandidates.size.coerceAtMost(4) }

    fun reset() {
        synchronized(lock) {
            floorCandidates.clear()
            wallCandidates.clear()
            depthPoints.clear()
            manualCorners.clear()
            processedPlaneCount = 0
            depthFrameCount = 0
            rawDepthConfidenceTotal = 0.0
            scanStartedAtMs = SystemClock.elapsedRealtime()
        }
    }

    fun addManualCorner(corner: Vec3) {
        synchronized(lock) {
            if (manualCorners.any { distance2d(it, corner) < MIN_MANUAL_CORNER_SPACING_METERS }) {
                return
            }
            if (manualCorners.size >= MAX_MANUAL_CORNERS) {
                manualCorners.removeAt(0)
            }
            manualCorners.add(corner)
        }
    }

    fun undoLastManualCorner() {
        synchronized(lock) {
            if (manualCorners.isNotEmpty()) {
                manualCorners.removeAt(manualCorners.lastIndex)
            }
        }
    }

    fun manualCorners(): List<Vec3> {
        return synchronized(lock) { manualCorners.toList() }
    }

    fun processPlanes(
        planes: List<Plane>,
        depthSample: DepthSample?,
        cameraPose: com.google.ar.core.Pose,
    ) {
        synchronized(lock) {
            processedPlaneCount += planes.size
            if (depthSample != null && depthSample.validCount > 0) {
                depthFrameCount += 1
                rawDepthConfidenceTotal += depthSample.highConfidenceRatio
                depthPoints.addAll(depthSample.points)
                if (depthPoints.size > MAX_ACCUMULATED_DEPTH_POINTS) {
                    depthPoints.subList(0, depthPoints.size - MAX_ACCUMULATED_DEPTH_POINTS).clear()
                }
            }
            planes.forEach { plane -> processPlane(plane, depthSample, cameraPose) }
        }
    }

    fun currentStats(
        planeCount: Int,
        cameraTracking: Boolean,
    ): ScanStats {
        synchronized(lock) {
            return statsFor(
                planeCount = planeCount,
                stableWalls = stableWallCandidates(),
                cameraTracking = cameraTracking,
            )
        }
    }

    fun buildRoomGeometry(): RoomGeometry {
        synchronized(lock) {
            if (manualCorners.size >= MIN_MANUAL_CORNERS_FOR_ROOM) {
                return buildManualRoomGeometry()
            }

            val floor = bestFloorCandidate()?.toSurface()
            val stableWalls = stableWallCandidates()
            val bounds = roomBoundsFromEvidence(floor, stableWalls, stableDepthPoints())
            val floorSurface = floor ?: estimatedSurface(
                id = "estimated-floor",
                type = "floor",
                centerX = bounds.centerX,
                centerY = 0.0,
                centerZ = bounds.centerZ,
                sizeX = bounds.width,
                sizeY = SURFACE_THICKNESS_METERS,
                sizeZ = bounds.depth,
                yaw = 0.0,
            )
            val walls = estimatedWalls(bounds)
            val surfaces = listOf(floorSurface) + walls
            val stats = statsFor(
                planeCount = processedPlaneCount,
                stableWalls = stableWalls,
                cameraTracking = floorCandidates.isNotEmpty() || wallCandidates.isNotEmpty(),
            )
            val quality = when {
                stats.isGoodEnough && stats.wallConfidence >= 70 -> "good"
                stats.hasAnyUsablePlane -> "estimated"
                else -> "poor"
            }

            return RoomGeometry(surfaces = surfaces, stats = stats, quality = quality)
        }
    }

    private fun buildManualRoomGeometry(): RoomGeometry {
        val bounds = roomBoundsFromManualCorners(manualCorners)
        val floorSurface = SurfaceDraft(
            id = "manual-floor",
            type = "floor",
            center = Vec3(bounds.centerX, 0.0, bounds.centerZ),
            size = Vec3(bounds.width, SURFACE_THICKNESS_METERS, bounds.depth),
            rotation = Vec3(0.0, 0.0, 0.0),
            source = "detected",
        )
        val walls = manualWalls(manualCorners)
        val stableWalls = stableWallCandidates()
        val stats = statsFor(
            planeCount = processedPlaneCount,
            stableWalls = stableWalls,
            cameraTracking = true,
        )
        val quality = if (manualCorners.size >= 4) "good" else "estimated"
        return RoomGeometry(
            surfaces = listOf(floorSurface) + walls,
            stats = stats,
            quality = quality,
            manualCorners = manualCorners.toList(),
        )
    }

    private fun processPlane(
        plane: Plane,
        depthSample: DepthSample?,
        cameraPose: com.google.ar.core.Pose,
    ) {
        when (plane.type) {
            Plane.Type.HORIZONTAL_UPWARD_FACING -> {
                if (!isLikelyFloor(plane)) return
                floorCandidates.add(
                    FloorCandidate(
                        center = Vec3(
                            plane.centerPose.tx().toDouble(),
                            0.0,
                            plane.centerPose.tz().toDouble(),
                        ),
                        size = Vec3(
                            max(plane.extentX.toDouble(), MIN_ESTIMATED_ROOM_SIZE),
                            SURFACE_THICKNESS_METERS,
                            max(plane.extentZ.toDouble(), MIN_ESTIMATED_ROOM_SIZE),
                        ),
                    ),
                )
                if (floorCandidates.size > MAX_FLOOR_CANDIDATES) {
                    floorCandidates.sortByDescending { it.area }
                    floorCandidates.subList(MAX_FLOOR_CANDIDATES, floorCandidates.size).clear()
                }
            }
            Plane.Type.VERTICAL -> {
                if (!isLikelyWall(plane)) return
                val candidate = WallCandidate.fromPlane(plane, cameraPose, depthSample)
                val existing = wallCandidates.firstOrNull { it.isSameWall(candidate) }
                if (existing != null) {
                    existing.merge(candidate)
                } else {
                    wallCandidates.add(candidate)
                }
            }
            Plane.Type.HORIZONTAL_DOWNWARD_FACING -> Unit
        }
    }

    private fun bestFloorCandidate(): FloorCandidate? {
        return floorCandidates.maxByOrNull { it.area }
    }

    private fun statsFor(
        planeCount: Int,
        stableWalls: List<WallCandidate>,
        cameraTracking: Boolean,
    ): ScanStats {
        val depthEvidence = stableDepthPoints()
        val confidence = max(wallConfidence(stableWalls), depthWallConfidence(depthEvidence))
        val stableDirections = max(stableWallDirections(stableWalls), depthBoundaryDirections(depthEvidence))
        return ScanStats(
            planeCount = planeCount,
            wallCount = max(stableWalls.size.coerceAtMost(4), stableDirections),
            stableWallDirections = stableDirections,
            wallConfidence = confidence,
            floorFound = floorCandidates.isNotEmpty(),
            depthFrameCount = depthFrameCount,
            depthPointCount = depthPoints.size,
            rawDepthConfidence = rawDepthConfidencePercent(),
            markedCornerCount = manualCorners.size,
            scanDurationMs = SystemClock.elapsedRealtime() - scanStartedAtMs,
            scanPhase = scanPhase(floorCandidates.isNotEmpty(), stableDirections, confidence, manualCorners.size),
            cameraTracking = cameraTracking,
        )
    }

    private fun stableWallCandidates(): List<WallCandidate> {
        val stable = wallCandidates.filter { it.confidence >= STABLE_WALL_CONFIDENCE }
        return stable.ifEmpty {
            wallCandidates
                .sortedByDescending { it.confidence }
                .take(MAX_FALLBACK_WALLS_FOR_BOUNDS)
        }
    }

    private fun stableWallDirections(walls: List<WallCandidate>): Int {
        return walls
            .filter { it.confidence >= STABLE_WALL_CONFIDENCE }
            .map { it.directionBucket }
            .toSet()
            .size
    }

    private fun wallConfidence(walls: List<WallCandidate>): Int {
        val stable = walls.sortedByDescending { it.confidence }.take(4)
        if (stable.isEmpty()) return 0
        return stable.map { it.confidence }.average().roundToInt().coerceIn(0, 100)
    }

    private fun depthWallConfidence(points: List<DepthPoint>): Int {
        if (points.size < MIN_DEPTH_WALL_POINTS) return 0
        val bounds = depthPercentileBounds(points) ?: return 0
        val width = bounds.maxX - bounds.minX
        val depth = bounds.maxZ - bounds.minZ
        val spreadScore = min((max(width, depth) / MIN_ESTIMATED_ROOM_SIZE) * 36.0, 36.0)
        val coverageScore = min(points.size / 9.0, 34.0)
        val confidenceScore = points.map { it.confidence }.average() * 30.0
        return (spreadScore + coverageScore + confidenceScore)
            .roundToInt()
            .coerceIn(0, 88)
    }

    private fun depthBoundaryDirections(points: List<DepthPoint>): Int {
        if (points.size < MIN_DEPTH_WALL_POINTS) return 0
        val bounds = depthPercentileBounds(points) ?: return 0
        val width = bounds.maxX - bounds.minX
        val depth = bounds.maxZ - bounds.minZ
        var directions = 0
        if (width >= MIN_DEPTH_BOUNDARY_SPREAD_METERS) directions += 1
        if (depth >= MIN_DEPTH_BOUNDARY_SPREAD_METERS) directions += 1
        return directions
    }

    private fun rawDepthConfidencePercent(): Int {
        if (depthFrameCount == 0) return 0
        return ((rawDepthConfidenceTotal / depthFrameCount) * 100.0)
            .roundToInt()
            .coerceIn(0, 100)
    }

    private fun scanPhase(
        hasFloor: Boolean,
        stableDirections: Int,
        confidence: Int,
        cornerCount: Int,
    ): String {
        if (cornerCount >= MIN_MANUAL_CORNERS_FOR_ROOM) return "Corner room ready"
        if (cornerCount > 0) return "Mark corners"
        if (!hasFloor) return "Find floor"
        if (stableDirections == 0) return "Scan wall 1"
        if (stableDirections < 2) return "Scan wall 2"
        if (confidence < READY_WALL_CONFIDENCE) return "Scan corners"
        return "Ready"
    }

    private fun roomBoundsFromEvidence(
        floor: SurfaceDraft?,
        stableWalls: List<WallCandidate>,
        stableDepthPoints: List<DepthPoint>,
    ): RoomBounds {
        var minX = floor?.let { it.center.x - it.size.x / 2.0 } ?: Double.POSITIVE_INFINITY
        var maxX = floor?.let { it.center.x + it.size.x / 2.0 } ?: Double.NEGATIVE_INFINITY
        var minZ = floor?.let { it.center.z - it.size.z / 2.0 } ?: Double.POSITIVE_INFINITY
        var maxZ = floor?.let { it.center.z + it.size.z / 2.0 } ?: Double.NEGATIVE_INFINITY

        stableWalls.forEach { wall ->
            val halfLength = wall.length / 2.0
            if (wall.runsAlongX) {
                minX = min(minX, wall.center.x - halfLength)
                maxX = max(maxX, wall.center.x + halfLength)
                minZ = min(minZ, wall.center.z)
                maxZ = max(maxZ, wall.center.z)
            } else {
                minX = min(minX, wall.center.x)
                maxX = max(maxX, wall.center.x)
                minZ = min(minZ, wall.center.z - halfLength)
                maxZ = max(maxZ, wall.center.z + halfLength)
            }
        }

        depthPercentileBounds(stableDepthPoints)?.let { depthBounds ->
            minX = min(minX, depthBounds.minX)
            maxX = max(maxX, depthBounds.maxX)
            minZ = min(minZ, depthBounds.minZ)
            maxZ = max(maxZ, depthBounds.maxZ)
        }

        if (!minX.isFinite() || !minZ.isFinite()) {
            minX = -DEFAULT_ROOM_WIDTH / 2.0
            maxX = DEFAULT_ROOM_WIDTH / 2.0
            minZ = -DEFAULT_ROOM_DEPTH / 2.0
            maxZ = DEFAULT_ROOM_DEPTH / 2.0
        }

        val centerX = (minX + maxX) / 2.0
        val centerZ = (minZ + maxZ) / 2.0
        val width = max(maxX - minX, MIN_ESTIMATED_ROOM_SIZE)
        val depth = max(maxZ - minZ, MIN_ESTIMATED_ROOM_SIZE)
        return RoomBounds(centerX, centerZ, width, depth)
    }

    private fun roomBoundsFromManualCorners(corners: List<Vec3>): RoomBounds {
        val minX = corners.minOf { it.x }
        val maxX = corners.maxOf { it.x }
        val minZ = corners.minOf { it.z }
        val maxZ = corners.maxOf { it.z }
        val centerX = (minX + maxX) / 2.0
        val centerZ = (minZ + maxZ) / 2.0
        val width = max(maxX - minX, MIN_ESTIMATED_ROOM_SIZE)
        val depth = max(maxZ - minZ, MIN_ESTIMATED_ROOM_SIZE)
        return RoomBounds(centerX, centerZ, width, depth)
    }

    private fun manualWalls(corners: List<Vec3>): List<SurfaceDraft> {
        val height = ESTIMATED_WALL_HEIGHT_METERS
        return corners.indices.map { index ->
            val start = corners[index]
            val end = corners[(index + 1) % corners.size]
            val dx = end.x - start.x
            val dz = end.z - start.z
            val length = kotlin.math.hypot(dx, dz).coerceAtLeast(WALL_THICKNESS_METERS)
            SurfaceDraft(
                id = "manual-wall-${index + 1}",
                type = "wall",
                center = Vec3(
                    x = (start.x + end.x) / 2.0,
                    y = height / 2.0,
                    z = (start.z + end.z) / 2.0,
                ),
                size = Vec3(length, height, WALL_THICKNESS_METERS),
                rotation = Vec3(0.0, -atan2(dz, dx), 0.0),
                source = "detected",
            )
        }
    }

    private fun stableDepthPoints(): List<DepthPoint> {
        if (depthPoints.isEmpty()) return emptyList()
        val floorY = bestFloorCandidate()?.center?.y ?: 0.0
        return depthPoints
            .asSequence()
            .filter { it.confidence >= MIN_ACCUMULATED_POINT_CONFIDENCE }
            .filter { it.y in (floorY + MIN_WALL_POINT_HEIGHT_METERS)..(floorY + ESTIMATED_WALL_HEIGHT_METERS) }
            .toList()
    }

    private fun depthPercentileBounds(points: List<DepthPoint>): DepthBounds? {
        if (points.size < MIN_DEPTH_WALL_POINTS) return null
        val xs = points.map { it.x }.sorted()
        val zs = points.map { it.z }.sorted()
        return DepthBounds(
            minX = percentile(xs, DEPTH_BOUNDARY_LOW_PERCENTILE),
            maxX = percentile(xs, DEPTH_BOUNDARY_HIGH_PERCENTILE),
            minZ = percentile(zs, DEPTH_BOUNDARY_LOW_PERCENTILE),
            maxZ = percentile(zs, DEPTH_BOUNDARY_HIGH_PERCENTILE),
        )
    }

    private fun percentile(sorted: List<Double>, ratio: Double): Double {
        if (sorted.isEmpty()) return 0.0
        val index = ((sorted.size - 1) * ratio).roundToInt().coerceIn(0, sorted.lastIndex)
        return sorted[index]
    }

    private fun estimatedWalls(bounds: RoomBounds): List<SurfaceDraft> {
        val height = ESTIMATED_WALL_HEIGHT_METERS
        return listOf(
            estimatedSurface("estimated-wall-north", "wall", bounds.centerX, height / 2.0, bounds.centerZ - bounds.depth / 2.0, bounds.width, height, WALL_THICKNESS_METERS, 0.0),
            estimatedSurface("estimated-wall-south", "wall", bounds.centerX, height / 2.0, bounds.centerZ + bounds.depth / 2.0, bounds.width, height, WALL_THICKNESS_METERS, PI),
            estimatedSurface("estimated-wall-west", "wall", bounds.centerX - bounds.width / 2.0, height / 2.0, bounds.centerZ, bounds.depth, height, WALL_THICKNESS_METERS, PI / 2.0),
            estimatedSurface("estimated-wall-east", "wall", bounds.centerX + bounds.width / 2.0, height / 2.0, bounds.centerZ, bounds.depth, height, WALL_THICKNESS_METERS, -PI / 2.0),
        )
    }

    private fun isLikelyFloor(plane: Plane): Boolean {
        return plane.extentX >= MIN_FLOOR_SIZE_METERS &&
            plane.extentZ >= MIN_FLOOR_SIZE_METERS
    }

    private fun isLikelyWall(plane: Plane): Boolean {
        val width = max(plane.extentX, plane.extentZ)
        val height = min(plane.extentX, plane.extentZ)
        val area = plane.extentX * plane.extentZ
        val centerY = plane.centerPose.ty()

        return width >= MIN_WALL_WIDTH_METERS &&
            height >= MIN_WALL_HEIGHT_METERS &&
            area >= MIN_WALL_AREA_METERS &&
            centerY >= MIN_WALL_CENTER_Y_METERS
    }

    private fun estimatedSurface(
        id: String,
        type: String,
        centerX: Double,
        centerY: Double,
        centerZ: Double,
        sizeX: Double,
        sizeY: Double,
        sizeZ: Double,
        yaw: Double,
    ): SurfaceDraft {
        return SurfaceDraft(
            id = id,
            type = type,
            center = Vec3(centerX, centerY, centerZ),
            size = Vec3(sizeX, sizeY, sizeZ),
            rotation = Vec3(0.0, yaw, 0.0),
            source = "estimated",
        )
    }

    private companion object {
        private const val DEFAULT_ROOM_DEPTH = 5.0
        private const val DEFAULT_ROOM_WIDTH = 4.0
        private const val ESTIMATED_WALL_HEIGHT_METERS = 2.8
        private const val DEPTH_BOUNDARY_HIGH_PERCENTILE = 0.9
        private const val DEPTH_BOUNDARY_LOW_PERCENTILE = 0.1
        private const val MAX_ACCUMULATED_DEPTH_POINTS = 2400
        private const val MAX_FALLBACK_WALLS_FOR_BOUNDS = 2
        private const val MAX_FLOOR_CANDIDATES = 24
        private const val MAX_MANUAL_CORNERS = 12
        private const val MIN_ACCUMULATED_POINT_CONFIDENCE = 0.5
        private const val MIN_DEPTH_BOUNDARY_SPREAD_METERS = 2.2
        private const val MIN_DEPTH_WALL_POINTS = 80
        private const val MIN_ESTIMATED_ROOM_SIZE = 3.2
        private const val MIN_FLOOR_SIZE_METERS = 0.45f
        private const val MIN_MANUAL_CORNERS_FOR_ROOM = 3
        private const val MIN_MANUAL_CORNER_SPACING_METERS = 0.25
        private const val MIN_WALL_POINT_HEIGHT_METERS = 0.25
        private const val MIN_WALL_AREA_METERS = 0.22f
        private const val MIN_WALL_CENTER_Y_METERS = 0.25f
        private const val MIN_WALL_HEIGHT_METERS = 0.3f
        private const val MIN_WALL_WIDTH_METERS = 0.6f
        private const val READY_WALL_CONFIDENCE = 45
        private const val STABLE_WALL_CONFIDENCE = 22
        private const val SURFACE_THICKNESS_METERS = 0.02
        private const val WALL_THICKNESS_METERS = 0.04
    }
}

private data class FloorCandidate(
    val center: Vec3,
    val size: Vec3,
) {
    val area: Double
        get() = size.x * size.z

    fun toSurface(): SurfaceDraft {
        return SurfaceDraft(
            id = "detected-floor",
            type = "floor",
            center = center,
            size = size,
            rotation = Vec3(0.0, 0.0, 0.0),
            source = "detected",
        )
    }
}

private data class RoomBounds(
    val centerX: Double,
    val centerZ: Double,
    val width: Double,
    val depth: Double,
)

private data class DepthBounds(
    val minX: Double,
    val maxX: Double,
    val minZ: Double,
    val maxZ: Double,
)

private data class WallCandidate(
    var center: Vec3,
    var normalX: Double,
    var normalZ: Double,
    var length: Double,
    var area: Double,
    var averageDistanceMeters: Double,
    var closeObjectPenalty: Double,
    var rawDepthConfidence: Double,
    var observations: Int = 1,
) {
    val runsAlongX: Boolean
        get() = kotlin.math.abs(normalZ) >= kotlin.math.abs(normalX)
    val directionBucket: Int
        get() {
            val angle = atan2(normalZ, normalX)
            return ((angle / (PI / 2.0)).roundToInt() % 4 + 4) % 4
        }
    val confidence: Int
        get() {
            val observationScore = min(observations * 9.0, 36.0)
            val areaScore = min(area * 18.0, 28.0)
            val distanceScore = when {
                averageDistanceMeters in 1.0..3.8 -> 22.0
                averageDistanceMeters in 0.7..5.0 -> 12.0
                else -> 4.0
            }
            val rawDepthScore = rawDepthConfidence * 14.0
            val objectPenalty = closeObjectPenalty * 30.0
            return (observationScore + areaScore + distanceScore + rawDepthScore - objectPenalty)
                .roundToInt()
                .coerceIn(0, 100)
        }

    fun isSameWall(other: WallCandidate): Boolean {
        val dot = normalX * other.normalX + normalZ * other.normalZ
        val distance = kotlin.math.hypot(center.x - other.center.x, center.z - other.center.z)
        return kotlin.math.abs(dot) > 0.86 && distance < 1.45
    }

    fun merge(other: WallCandidate) {
        val total = observations + other.observations
        center = Vec3(
            x = (center.x * observations + other.center.x * other.observations) / total,
            y = (center.y * observations + other.center.y * other.observations) / total,
            z = (center.z * observations + other.center.z * other.observations) / total,
        )
        normalX = (normalX * observations + other.normalX * other.observations) / total
        normalZ = (normalZ * observations + other.normalZ * other.observations) / total
        length = max(length, other.length)
        area = max(area, other.area)
        averageDistanceMeters =
            (averageDistanceMeters * observations + other.averageDistanceMeters * other.observations) / total
        closeObjectPenalty =
            (closeObjectPenalty * observations + other.closeObjectPenalty * other.observations) / total
        rawDepthConfidence =
            (rawDepthConfidence * observations + other.rawDepthConfidence * other.observations) / total
        observations = total
    }

    companion object {
        fun fromPlane(
            plane: Plane,
            cameraPose: com.google.ar.core.Pose,
            depthSample: DepthSample?,
        ): WallCandidate {
            val pose = plane.centerPose
            val normal = pose.getZAxis()
            val distance = kotlin.math.sqrt(
                square((pose.tx() - cameraPose.tx()).toDouble()) +
                    square((pose.ty() - cameraPose.ty()).toDouble()) +
                    square((pose.tz() - cameraPose.tz()).toDouble()),
            )
            return WallCandidate(
                center = Vec3(pose.tx().toDouble(), pose.ty().toDouble(), pose.tz().toDouble()),
                normalX = normal[0].toDouble(),
                normalZ = normal[2].toDouble(),
                length = max(plane.extentX.toDouble(), plane.extentZ.toDouble()),
                area = (plane.extentX * plane.extentZ).toDouble(),
                averageDistanceMeters = distance,
                closeObjectPenalty = depthSample?.closeObjectRatio ?: 0.0,
                rawDepthConfidence = depthSample?.highConfidenceRatio ?: 0.0,
            )
        }
    }
}

private data class SurfaceDraft(
    val id: String,
    val type: String,
    val center: Vec3,
    val size: Vec3,
    val rotation: Vec3,
    val source: String,
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("type", type)
            .put("center", center.toJson())
            .put("size", size.toJson())
            .put("rotation", rotation.toJson())
            .put("source", source)
    }
}

private data class Vec3(
    val x: Double,
    val y: Double,
    val z: Double,
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("x", x)
            .put("y", y)
            .put("z", z)
    }
}

private fun floatBuffer(vararg values: Float): FloatBuffer {
    return ByteBuffer
        .allocateDirect(values.size * FLOAT_BYTES)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .apply {
            put(values)
            position(0)
        }
}

private fun com.google.ar.core.Pose.yAxisYawRadians(): Double {
    val zAxis = getZAxis()
    val zAxisX = zAxis[0]
    val zAxisZ = zAxis[2]
    return atan2(zAxisX.toDouble(), zAxisZ.toDouble())
}

private fun square(value: Double): Double = value * value

private fun distance2d(first: Vec3, second: Vec3): Double {
    return kotlin.math.hypot(first.x - second.x, first.z - second.z)
}

private const val FLOAT_BYTES = 4
