import React, {useMemo, useState} from 'react';
import {SafeAreaView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {WebView} from 'react-native-webview';
import type {RoomModel} from '../domain/room';

type RoomPreviewScreenProps = {
  room: RoomModel;
  onBack: () => void;
};

export function RoomPreviewScreen({room, onBack}: RoomPreviewScreenProps) {
  const [spatialScene, setSpatialScene] = useState(false);
  const html = useMemo(
    () => createPreviewHtml(room, {spatialOnly: spatialScene}),
    [room, spatialScene],
  );
  const detectedCount =
    room.detectedSurfaceCount ??
    room.surfaces.filter(surface => surface.source !== 'estimated').length;
  const estimatedCount =
    room.estimatedSurfaceCount ??
    room.surfaces.filter(surface => surface.source === 'estimated').length;

  if (spatialScene) {
    return (
      <View style={styles.spatialScene}>
        <WebView
          allowFileAccess
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={['*']}
          source={{html}}
          style={styles.webView}
        />
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setSpatialScene(false)}
          style={styles.spatialBackButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.toolbar}>
        <TouchableOpacity activeOpacity={0.8} onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.toolbarText}>
          <Text style={styles.title}>{room.name}</Text>
          <Text style={styles.subtitle}>
            {room.quality ?? 'estimated'} quality - {detectedCount} detected,{' '}
            {estimatedCount} estimated - {room.wallConfidence ?? 0}% confidence
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setSpatialScene(true)}
          style={styles.spatialButton}>
          <Text style={styles.backButtonText}>Spatial</Text>
        </TouchableOpacity>
      </View>

      <WebView
        allowFileAccess
        domStorageEnabled
        javaScriptEnabled
        originWhitelist={['*']}
        source={{html}}
        style={styles.webView}
      />
    </SafeAreaView>
  );
}

function createPreviewHtml(room: RoomModel, options?: {spatialOnly?: boolean}) {
  const roomJson = JSON.stringify(room).replace(/</g, '\\u003c');
  const spatialOnly = options?.spatialOnly === true;

  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #app, canvas {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #101418;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      touch-action: none;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 8px;
      background: #1f8a70;
      color: #ffffff;
      font: 700 13px system-ui, sans-serif;
      min-height: 38px;
      padding: 0 14px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    #panel {
      position: fixed;
      left: 12px;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #dbe8e3;
      background: rgba(16, 20, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 10px 12px;
      pointer-events: none;
    }
    #panel button {
      pointer-events: auto;
    }
    #title {
      color: #f8fbfa;
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 3px;
    }
    #stats, #hint {
      color: #b9c7c2;
      font-size: 12px;
      line-height: 17px;
    }
    #hint {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: 12px;
      background: rgba(16, 20, 24, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 9px 12px;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="app"><canvas id="canvas"></canvas></div>
  <div id="panel" style="${spatialOnly ? 'display:none' : ''}">
    <div>
      <div id="title">Room preview</div>
      <div id="stats"></div>
    </div>
    <div class="actions">
      <button id="reset" type="button">Reset</button>
    </div>
  </div>
  <div id="hint" style="${spatialOnly ? 'display:none' : ''}">Drag to rotate. Pinch to zoom. Solid surfaces are detected; transparent surfaces complete the estimated room shell.</div>
  <script>
    const room = ${roomJson};
    const spatialOnly = ${spatialOnly ? 'true' : 'false'};
    const canvas = document.getElementById('canvas');
    const stats = document.getElementById('stats');
    const hint = document.getElementById('hint');
    const reset = document.getElementById('reset');
    const gl = canvas.getContext('webgl', {antialias: true, alpha: false});
    let width = 1;
    let height = 1;
    let yaw = -0.68;
    let pitch = -0.46;
    let distance = 8.2;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pinchDistance = 0;
    let mode = spatialOnly ? 'spatial' : 'orbit';
    let spatialYaw = 0;
    let spatialPitch = 0;
    let spatialPosition = [0, 1.55, 0];

    const surfaces = createPreviewSurfaces(room.surfaces || []);
    const bounds = getRoomBounds(surfaces);
    spatialPosition = [bounds.centerX, 1.55, bounds.centerZ];
    const detected = surfaces.filter(surface => surface.source !== 'estimated').length;
    const estimated = surfaces.length - detected;
    if (stats) {
      stats.textContent = (room.quality || 'estimated') + ' quality - ' + detected + ' detected, ' + estimated + ' estimated - ' + (room.wallConfidence || 0) + '% wall confidence - ' + (room.depthFrameCount || 0) + ' depth frames - ' + (room.depthPointCount || 0) + ' points - ' + (room.rawDepthConfidence || 0) + '% raw depth';
    }

    if (!gl) {
      document.body.innerHTML = '<div style="color:#fff;padding:20px">WebGL is not available on this device.</div>';
    } else {
      boot();
    }

    function boot() {
      const program = createProgram(vertexShaderSource(), fragmentShaderSource());
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const colorLocation = gl.getAttribLocation(program, 'a_color');
      const matrixLocation = gl.getUniformLocation(program, 'u_matrix');
      const positionBuffer = gl.createBuffer();
      const colorBuffer = gl.createBuffer();
      const orbitGeometry = buildGeometry(surfaces, 'orbit');
      const spatialGeometry = buildGeometry(surfaces, 'spatial');

      if (reset) {
        reset.addEventListener('click', () => {
          resetView();
          draw();
        });
      }
      canvas.addEventListener('pointerdown', event => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove', event => {
        if (!dragging) return;
        if (mode === 'spatial') {
          spatialYaw += (event.clientX - lastX) * 0.01;
          spatialPitch = clamp(spatialPitch - (event.clientY - lastY) * 0.006, -0.78, 0.78);
        } else {
          yaw += (event.clientX - lastX) * 0.01;
          pitch = clamp(pitch + (event.clientY - lastY) * 0.008, -1.16, -0.12);
        }
        lastX = event.clientX;
        lastY = event.clientY;
        draw();
      });
      canvas.addEventListener('pointerup', event => {
        dragging = false;
        pinchDistance = 0;
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      });
      canvas.addEventListener('wheel', event => {
        if (mode === 'spatial') {
          moveSpatial(event.deltaY > 0 ? -0.22 : 0.22);
        } else {
          distance = clamp(distance + event.deltaY * 0.01, 3.2, 15);
        }
        draw();
      }, {passive: true});
      canvas.addEventListener('touchmove', event => {
        if (event.touches.length !== 2) return;
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const nextDistance = Math.hypot(dx, dy);
        if (pinchDistance > 0) {
          if (mode === 'spatial') {
            moveSpatial((nextDistance - pinchDistance) * 0.006);
          } else {
            distance = clamp(distance - (nextDistance - pinchDistance) * 0.018, 3.2, 15);
          }
          draw();
        }
        pinchDistance = nextDistance;
      }, {passive: true});
      window.addEventListener('resize', resize);
      resize();

      function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = Math.max(1, window.innerWidth);
        height = Math.max(1, window.innerHeight);
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        gl.viewport(0, 0, canvas.width, canvas.height);
        draw();
      }

      function draw() {
        gl.clearColor(0.063, 0.078, 0.094, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(program);
        const geometry = mode === 'spatial' ? spatialGeometry : orbitGeometry;

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(colorLocation);
        gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);

        const aspect = canvas.width / canvas.height;
        const projection = perspective(mode === 'spatial' ? Math.PI / 3 : Math.PI / 4, aspect, 0.05, 100);
        const view = mode === 'spatial' ? spatialViewMatrix() : orbitViewMatrix();
        const matrix = multiply(projection, view);
        gl.uniformMatrix4fv(matrixLocation, false, matrix);
        gl.drawArrays(gl.TRIANGLES, 0, geometry.positions.length / 3);
      }

      function resetView() {
        if (mode === 'spatial') {
          spatialYaw = 0;
          spatialPitch = 0;
          spatialPosition = [bounds.centerX, 1.55, bounds.centerZ];
        } else {
          yaw = -0.68;
          pitch = -0.46;
          distance = Math.max(bounds.width, bounds.depth, 5) * 1.45;
        }
      }

      function updateHint() {
        if (!hint) return;
        hint.textContent = mode === 'spatial'
          ? 'Spatial view: solid colors show walls and floor. Drag to look around; pinch or wheel to move forward and back.'
          : 'Drag to rotate. Pinch to zoom. Solid surfaces are detected; transparent surfaces complete the estimated room shell.';
      }

      function orbitViewMatrix() {
        const eye = [
          bounds.centerX + Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(-pitch) * distance + 1.3,
          bounds.centerZ + Math.cos(yaw) * Math.cos(pitch) * distance
        ];
        return lookAt(eye, [bounds.centerX, 1.15, bounds.centerZ], [0, 1, 0]);
      }

      function spatialViewMatrix() {
        const direction = [
          Math.sin(spatialYaw) * Math.cos(spatialPitch),
          Math.sin(spatialPitch),
          -Math.cos(spatialYaw) * Math.cos(spatialPitch)
        ];
        const target = [
          spatialPosition[0] + direction[0],
          spatialPosition[1] + direction[1],
          spatialPosition[2] + direction[2]
        ];
        return lookAt(spatialPosition, target, [0, 1, 0]);
      }

      function moveSpatial(amount) {
        spatialPosition[0] += Math.sin(spatialYaw) * amount;
        spatialPosition[2] += -Math.cos(spatialYaw) * amount;
        spatialPosition = clampSpatialPosition(spatialPosition, bounds);
      }

      resetView();
      updateHint();
    }

    function createPreviewSurfaces(rawSurfaces) {
      const normalized = rawSurfaces.map(surface => ({
        ...surface,
        source: surface.source || (surface.id && String(surface.id).indexOf('estimated') === 0 ? 'estimated' : 'detected')
      }));
      if (normalized.length >= 4) return normalized;

      const floor = normalized.find(surface => surface.type === 'floor');
      const center = floor ? floor.center : {x: 0, y: 0, z: 0};
      const roomWidth = Math.max(floor && floor.size ? floor.size.x : 4, 3.2);
      const roomDepth = Math.max(floor && floor.size ? floor.size.z : 5, 3.2);
      const roomHeight = 2.8;
      return normalized.concat([
        {id: 'preview-estimated-floor', type: 'floor', source: 'estimated', center: {x: center.x, y: 0, z: center.z}, size: {x: roomWidth, y: 0.02, z: roomDepth}, rotation: {x: 0, y: 0, z: 0}},
        {id: 'preview-estimated-wall-north', type: 'wall', source: 'estimated', center: {x: center.x, y: roomHeight / 2, z: center.z - roomDepth / 2}, size: {x: roomWidth, y: roomHeight, z: 0.04}, rotation: {x: 0, y: 0, z: 0}},
        {id: 'preview-estimated-wall-south', type: 'wall', source: 'estimated', center: {x: center.x, y: roomHeight / 2, z: center.z + roomDepth / 2}, size: {x: roomWidth, y: roomHeight, z: 0.04}, rotation: {x: 0, y: Math.PI, z: 0}},
        {id: 'preview-estimated-wall-west', type: 'wall', source: 'estimated', center: {x: center.x - roomWidth / 2, y: roomHeight / 2, z: center.z}, size: {x: roomDepth, y: roomHeight, z: 0.04}, rotation: {x: 0, y: Math.PI / 2, z: 0}},
        {id: 'preview-estimated-wall-east', type: 'wall', source: 'estimated', center: {x: center.x + roomWidth / 2, y: roomHeight / 2, z: center.z}, size: {x: roomDepth, y: roomHeight, z: 0.04}, rotation: {x: 0, y: -Math.PI / 2, z: 0}}
      ]);
    }

    function buildGeometry(items, viewMode) {
      const positions = [];
      const colors = [];
      if (viewMode === 'orbit') {
        addGrid(positions, colors);
      }
      const visibleItems = viewMode === 'spatial'
        ? items.filter(surface => surface.type !== 'floor')
        : items;
      for (const surface of visibleItems) {
        addSurface(surface, positions, colors, viewMode);
      }
      if (viewMode === 'spatial') {
        addSpatialShell(positions, colors);
      }
      return {
        positions: new Float32Array(positions),
        colors: new Float32Array(colors)
      };
    }

    function getRoomBounds(items) {
      const floor = items.find(surface => surface.type === 'floor');
      let minX = floor ? floor.center.x - Math.max(floor.size.x, 0.1) / 2 : Infinity;
      let maxX = floor ? floor.center.x + Math.max(floor.size.x, 0.1) / 2 : -Infinity;
      let minZ = floor ? floor.center.z - Math.max(floor.size.z, 0.1) / 2 : Infinity;
      let maxZ = floor ? floor.center.z + Math.max(floor.size.z, 0.1) / 2 : -Infinity;
      for (const surface of items) {
        const sx = Math.max(surface.size && surface.size.x || 0.04, 0.04);
        const sz = Math.max(surface.size && surface.size.z || 0.04, 0.04);
        const corners = [[-sx/2,0,-sz/2],[sx/2,0,-sz/2],[sx/2,0,sz/2],[-sx/2,0,sz/2]].map(point => transformPoint(point, surface));
        for (const corner of corners) {
          minX = Math.min(minX, corner[0]);
          maxX = Math.max(maxX, corner[0]);
          minZ = Math.min(minZ, corner[2]);
          maxZ = Math.max(maxZ, corner[2]);
        }
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minZ)) {
        minX = -2;
        maxX = 2;
        minZ = -2.5;
        maxZ = 2.5;
      }
      return {
        minX, maxX, minZ, maxZ,
        centerX: (minX + maxX) / 2,
        centerZ: (minZ + maxZ) / 2,
        width: Math.max(maxX - minX, 1),
        depth: Math.max(maxZ - minZ, 1)
      };
    }

    function clampSpatialPosition(position, roomBounds) {
      const margin = 0.18;
      return [
        clamp(position[0], roomBounds.minX + margin, roomBounds.maxX - margin),
        1.55,
        clamp(position[2], roomBounds.minZ + margin, roomBounds.maxZ - margin)
      ];
    }

    function addGrid(positions, colors) {
      for (let i = -6; i <= 6; i++) {
        addThinBox(positions, colors, {center: {x: 0, y: -0.012, z: i}, size: {x: 12, y: 0.01, z: 0.01}, rotation: {y: 0}}, [0.52, 0.62, 0.58, 0.22]);
        addThinBox(positions, colors, {center: {x: i, y: -0.011, z: 0}, size: {x: 0.01, y: 0.01, z: 12}, rotation: {y: 0}}, [0.52, 0.62, 0.58, 0.22]);
      }
    }

    function addSpatialShell(positions, colors) {
      const floor = {
        id: 'spatial-inspection-floor',
        type: 'floor',
        source: 'detected',
        center: {x: bounds.centerX, y: -0.025, z: bounds.centerZ},
        size: {x: bounds.width, y: 0.035, z: bounds.depth},
        rotation: {x: 0, y: 0, z: 0}
      };
      const ceiling = {
        id: 'spatial-inspection-ceiling',
        type: 'ceiling',
        source: 'detected',
        center: {x: bounds.centerX, y: 2.82, z: bounds.centerZ},
        size: {x: bounds.width, y: 0.035, z: bounds.depth},
        rotation: {x: 0, y: 0, z: 0}
      };
      addSurface(floor, positions, colors, 'spatial');
      addSurface(ceiling, positions, colors, 'spatial');
    }

    function addSurface(surface, positions, colors, viewMode) {
      const color = colorFor(surface, viewMode);
      addThinBox(positions, colors, surface, color);
      if (viewMode === 'spatial') {
        return;
      } else if (surface.source === 'estimated') {
        addDashedOutline(surface, positions, colors);
      }
    }

    function addThinBox(positions, colors, surface, color) {
      const sx = Math.max(surface.size && surface.size.x || 0.04, 0.04);
      const sy = Math.max(surface.size && surface.size.y || 0.04, 0.04);
      const sz = Math.max(surface.size && surface.size.z || 0.04, 0.04);
      const x = sx / 2;
      const y = sy / 2;
      const z = sz / 2;
      const corners = [
        [-x,-y,-z], [x,-y,-z], [x,y,-z], [-x,y,-z],
        [-x,-y,z], [x,-y,z], [x,y,z], [-x,y,z]
      ].map(point => transformPoint(point, surface));
      const faces = [
        {indices: [0,1,2, 0,2,3], normal: [0, 0, -1]},
        {indices: [4,6,5, 4,7,6], normal: [0, 0, 1]},
        {indices: [0,4,5, 0,5,1], normal: [0, -1, 0]},
        {indices: [3,2,6, 3,6,7], normal: [0, 1, 0]},
        {indices: [1,5,6, 1,6,2], normal: [1, 0, 0]},
        {indices: [0,3,7, 0,7,4], normal: [-1, 0, 0]}
      ];
      for (const face of faces) {
        const faceColor = shadeColor(color, transformDirection(face.normal, surface));
        for (const index of face.indices) {
          positions.push(corners[index][0], corners[index][1], corners[index][2]);
          colors.push(faceColor[0], faceColor[1], faceColor[2], faceColor[3]);
        }
      }
    }

    function addDashedOutline(surface, positions, colors) {
      addSurfaceOutline(surface, positions, colors, [1, 1, 1, 0.28], 0.025);
    }

    function addSurfaceOutline(surface, positions, colors, lineColor, thickness) {
      const sx = Math.max(surface.size && surface.size.x || 0.04, 0.04);
      const sy = Math.max(surface.size && surface.size.y || 0.04, 0.04);
      const sz = Math.max(surface.size && surface.size.z || 0.04, 0.04);
      const isWall = surface.type === 'wall';
      const segments = isWall
        ? [[-sx/2,-sy/2,0],[sx/2,-sy/2,0],[sx/2,sy/2,0],[-sx/2,sy/2,0]]
        : [[-sx/2,0,-sz/2],[sx/2,0,-sz/2],[sx/2,0,sz/2],[-sx/2,0,sz/2]];
      for (let i = 0; i < segments.length; i++) {
        const a = transformPoint(segments[i], surface);
        const b = transformPoint(segments[(i + 1) % segments.length], surface);
        addLineAsBox(a, b, positions, colors, lineColor, thickness);
      }
    }

    function addLineAsBox(a, b, positions, colors, color, thickness) {
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const cz = (a[2] + b[2]) / 2;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.max(Math.hypot(dx, dz), Math.abs(b[1] - a[1]), 0.01);
      const yaw = Math.atan2(-dz, dx);
      const edge = Math.max(thickness || 0.025, 0.01);
      addThinBox(positions, colors, {center: {x: cx, y: cy, z: cz}, size: {x: length, y: edge, z: edge}, rotation: {y: yaw}}, color);
    }

    function transformPoint(point, surface) {
      const yaw = surface.rotation && surface.rotation.y || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const x = point[0];
      const y = point[1];
      const z = point[2];
      return [
        (surface.center.x || 0) + x * c + z * s,
        (surface.center.y || 0) + y,
        (surface.center.z || 0) - x * s + z * c
      ];
    }

    function transformDirection(direction, surface) {
      const yaw = surface.rotation && surface.rotation.y || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const x = direction[0];
      const y = direction[1];
      const z = direction[2];
      return normalize([x * c + z * s, y, -x * s + z * c]);
    }

    function shadeColor(color, normal) {
      const light = normalize([-0.35, 0.86, 0.38]);
      const directional = Math.max(dot(normal, light), 0);
      const upward = Math.max(normal[1], 0);
      const warmAmbient = 0.72;
      const intensity = Math.min(warmAmbient + directional * 0.34 + upward * 0.12, 1.18);
      return [
        Math.min(color[0] * intensity + 0.035, 1),
        Math.min(color[1] * intensity + 0.03, 1),
        Math.min(color[2] * intensity + 0.025, 1),
        color[3]
      ];
    }

    function colorFor(surface, viewMode) {
      const estimated = surface.source === 'estimated';
      if (viewMode === 'spatial') {
        if (surface.type === 'floor') return estimated ? [0.16, 0.36, 0.32, 0.96] : [0.18, 0.43, 0.37, 1];
        if (surface.type === 'ceiling') return [0.62, 0.66, 0.64, 0.88];
        return estimated ? [0.42, 0.52, 0.56, 0.88] : [0.5, 0.62, 0.66, 0.94];
      }
      if (surface.type === 'floor') return estimated ? [0.12, 0.54, 0.44, 0.28] : [0.12, 0.66, 0.52, 0.82];
      return estimated ? [0.76, 0.86, 0.84, 0.18] : [0.76, 0.9, 0.86, 0.62];
    }

    function vertexShaderSource() {
      return 'attribute vec4 a_position;attribute vec4 a_color;uniform mat4 u_matrix;varying vec4 v_color;void main(){gl_Position=u_matrix*a_position;v_color=a_color;}';
    }

    function fragmentShaderSource() {
      return 'precision mediump float;varying vec4 v_color;void main(){gl_FragColor=v_color;}';
    }

    function createProgram(vertexSource, fragmentSource) {
      const program = gl.createProgram();
      const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      return program;
    }

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    }

    function perspective(fov, aspect, near, far) {
      const f = Math.tan(Math.PI * 0.5 - 0.5 * fov);
      const rangeInv = 1 / (near - far);
      return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (near + far) * rangeInv, -1,
        0, 0, near * far * rangeInv * 2, 0
      ];
    }

    function lookAt(camera, target, up) {
      const zAxis = normalize([camera[0] - target[0], camera[1] - target[1], camera[2] - target[2]]);
      const xAxis = normalize(cross(up, zAxis));
      const yAxis = normalize(cross(zAxis, xAxis));
      return [
        xAxis[0], yAxis[0], zAxis[0], 0,
        xAxis[1], yAxis[1], zAxis[1], 0,
        xAxis[2], yAxis[2], zAxis[2], 0,
        -dot(xAxis, camera), -dot(yAxis, camera), -dot(zAxis, camera), 1
      ];
    }

    function multiply(a, b) {
      const out = new Array(16);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          out[col * 4 + row] =
            a[0 * 4 + row] * b[col * 4 + 0] +
            a[1 * 4 + row] * b[col * 4 + 1] +
            a[2 * 4 + row] * b[col * 4 + 2] +
            a[3 * 4 + row] * b[col * 4 + 3];
        }
      }
      return out;
    }

    function normalize(v) {
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / len, v[1] / len, v[2] / len];
    }

    function cross(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }

    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101418',
  },
  toolbar: {
    alignItems: 'center',
    backgroundColor: '#182025',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#1f8a70',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  toolbarText: {
    flex: 1,
  },
  spatialButton: {
    alignItems: 'center',
    backgroundColor: '#1f8a70',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  spatialScene: {
    flex: 1,
    backgroundColor: '#101418',
  },
  spatialBackButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(31, 138, 112, 0.92)',
    borderRadius: 8,
    justifyContent: 'center',
    left: 14,
    minHeight: 42,
    paddingHorizontal: 16,
    position: 'absolute',
    top: 18,
  },
  title: {
    color: '#f8fbfa',
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: '#b9c7c2',
    fontSize: 13,
    marginTop: 2,
  },
  webView: {
    flex: 1,
    backgroundColor: '#101418',
  },
});
