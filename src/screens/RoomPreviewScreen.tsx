import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {WebView} from 'react-native-webview';
import type {RoomModel, RoomOpening, RoomSurface, Vec3} from '../domain/room';
import {saveLatestRoom} from '../native/RoomScannerModule';

type RoomPreviewScreenProps = {
  room: RoomModel;
  onBack: () => void;
};

type PreviewCameraState = {
  mode: 'orbit' | 'spatial';
  yaw: number;
  pitch: number;
  distance: number;
  spatialYaw: number;
  spatialPitch: number;
  spatialPosition: [number, number, number];
};

export function RoomPreviewScreen({room, onBack}: RoomPreviewScreenProps) {
  const [editableRoom, setEditableRoom] = useState(room);
  const [spatialScene, setSpatialScene] = useState(false);
  const [editingOpenings, setEditingOpenings] = useState(false);
  const [spatialEditorVisible, setSpatialEditorVisible] = useState(true);
  const [selectedWallIndex, setSelectedWallIndex] = useState(0);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const walls = editableRoom.surfaces.filter(surface => surface.type === 'wall');
  const selectedWall = walls.length
    ? walls[((selectedWallIndex % walls.length) + walls.length) % walls.length]
    : undefined;
  const selectedOpening = editableRoom.openings.find(
    opening => opening.id === selectedOpeningId,
  );
  const cameraStateRef = useRef<PreviewCameraState | null>(null);
  const previewRef = useRef<WebView>(null);
  const html = useMemo(
    () =>
      createPreviewHtml(editableRoom, {
        spatialOnly: spatialScene,
        selectedWallId:
          editingOpenings || spatialScene ? selectedWall?.id : undefined,
        selectedOpeningId:
          editingOpenings || spatialScene ? selectedOpeningId ?? undefined : undefined,
        initialCamera: cameraStateRef.current,
      }),
    [spatialScene],
  );
  const detectedCount =
    editableRoom.detectedSurfaceCount ??
    editableRoom.surfaces.filter(surface => surface.source !== 'estimated').length;
  const estimatedCount =
    editableRoom.estimatedSurfaceCount ??
    editableRoom.surfaces.filter(surface => surface.source === 'estimated').length;

  useEffect(() => {
    const payload = JSON.stringify({
      selectedWallId:
        editingOpenings || spatialScene ? selectedWall?.id ?? null : null,
      selectedOpeningId:
        editingOpenings || spatialScene ? selectedOpeningId ?? null : null,
      focusOpening: spatialScene && selectedOpeningId != null,
    }).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    previewRef.current?.injectJavaScript(
      `window.applyPreviewSelection && window.applyPreviewSelection(JSON.parse('${payload}')); true;`,
    );
  }, [editingOpenings, selectedOpeningId, selectedWall?.id, spatialScene]);

  useEffect(() => {
    const payload = JSON.stringify(editableRoom)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
    previewRef.current?.injectJavaScript(
      `window.applyPreviewRoom && window.applyPreviewRoom(JSON.parse('${payload}')); true;`,
    );
  }, [editableRoom]);

  function handlePreviewMessage(event: {nativeEvent: {data: string}}) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        camera?: PreviewCameraState;
      };
      if (message.type === 'camera' && message.camera) {
        cameraStateRef.current = message.camera;
      }
    } catch {
      // Camera state messages are best-effort; bad WebView messages should not break editing.
    }
  }

  async function persistRoom(nextRoom: RoomModel) {
    setEditableRoom(nextRoom);
    setSaveMessage('Saving...');
    try {
      await saveLatestRoom(nextRoom);
      setSaveMessage('Saved');
    } catch {
      setSaveMessage('Could not save changes');
    }
  }

  function updateOpenings(updater: (openings: RoomOpening[]) => RoomOpening[]) {
    persistRoom({
      ...editableRoom,
      openings: updater(editableRoom.openings || []),
    }).catch(() => undefined);
  }

  function addOpening(type: 'door' | 'window' | 'opening') {
    if (!selectedWall) {
      return;
    }

    const isSlidingDoor = type === 'opening';
    const width = isSlidingDoor ? 1.75 : type === 'door' ? 0.9 : 1.15;
    const height = isSlidingDoor ? 2.15 : type === 'door' ? 2.05 : 0.95;
    const wallHeight = Math.max(selectedWall.size.y, 2.4);
    const centerY =
      type === 'door' || isSlidingDoor
        ? wallBottom(selectedWall) + height / 2
        : wallBottom(selectedWall) + Math.min(1.35, wallHeight - height / 2 - 0.15);
    const opening = clampOpeningToWall(
      {
        id: `${type}-${Date.now()}`,
        type,
        parentSurfaceId: selectedWall.id,
        center: wallLocalToWorld(selectedWall, 0, centerY),
        size: {x: width, y: height, z: 0.08},
      },
      selectedWall,
    );

    setSelectedOpeningId(opening.id);
    updateOpenings(openings => openings.concat(opening));
  }

  function moveSelectedOpening(deltaAlongWall: number, deltaY = 0) {
    if (!selectedOpening) {
      return;
    }
    const wallForOpening = walls.find(
      wall => wall.id === selectedOpening.parentSurfaceId,
    );
    if (!wallForOpening) {
      return;
    }

    updateOpenings(openings =>
      openings.map(opening => {
        if (opening.id !== selectedOpening.id) {
          return opening;
        }
        const local = worldToWallLocal(wallForOpening, opening.center);
        const nextCenterY =
          opening.type === 'door' || opening.type === 'opening'
            ? wallBottom(wallForOpening) + opening.size.y / 2
            : opening.center.y + deltaY;
        return clampOpeningToWall(
          {
            ...opening,
            center: wallLocalToWorld(
              wallForOpening,
              local.x + deltaAlongWall,
              nextCenterY,
            ),
          },
          wallForOpening,
        );
      }),
    );
  }

  function resizeSelectedOpening(deltaWidth: number, deltaHeight: number) {
    if (!selectedOpening) {
      return;
    }
    const wallForOpening = walls.find(
      wall => wall.id === selectedOpening.parentSurfaceId,
    );
    if (!wallForOpening) {
      return;
    }

    updateOpenings(openings =>
      openings.map(opening => {
        if (opening.id !== selectedOpening.id) {
          return opening;
        }
        const nextHeight = clamp(
          opening.size.y + deltaHeight,
          opening.type === 'door' || opening.type === 'opening' ? 1.75 : 0.45,
          Math.max(wallForOpening.size.y - 0.18, 0.6),
        );
        return clampOpeningToWall(
          {
            ...opening,
            size: {
              ...opening.size,
              x: clamp(opening.size.x + deltaWidth, 0.45, wallForOpening.size.x - 0.18),
              y: nextHeight,
            },
          },
          wallForOpening,
        );
      }),
    );
  }

  function deleteSelectedOpening() {
    if (!selectedOpeningId) {
      return;
    }

    updateOpenings(openings =>
      openings.filter(opening => opening.id !== selectedOpeningId),
    );
    setSelectedOpeningId(null);
  }

  function selectOpening(opening: RoomOpening) {
    const wallIndex = walls.findIndex(wall => wall.id === opening.parentSurfaceId);
    if (wallIndex >= 0) {
      setSelectedWallIndex(wallIndex);
    }
    setSelectedOpeningId(opening.id);
  }

  function renderOpeningEditor(spatial = false) {
    return (
      <View style={spatial ? styles.spatialEditorPanel : styles.editorPanel}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.editorRow}>
            <Text style={styles.editorLabel}>
              Wall {walls.length ? selectedWallIndex + 1 : 0}/{walls.length}
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!walls.length}
              onPress={() =>
                setSelectedWallIndex(index =>
                  walls.length ? (index - 1 + walls.length) % walls.length : 0,
                )
              }
              style={[styles.toolButton, !walls.length && styles.toolButtonDisabled]}>
              <Text style={styles.toolButtonText}>Prev Wall</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!walls.length}
              onPress={() =>
                setSelectedWallIndex(index =>
                  walls.length ? (index + 1) % walls.length : 0,
                )
              }
              style={[styles.toolButton, !walls.length && styles.toolButtonDisabled]}>
              <Text style={styles.toolButtonText}>Next Wall</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!selectedWall}
              onPress={() => addOpening('door')}
              style={[styles.toolButton, !selectedWall && styles.toolButtonDisabled]}>
              <Text style={styles.toolButtonText}>Add Door</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!selectedWall}
              onPress={() => addOpening('window')}
              style={[styles.toolButton, !selectedWall && styles.toolButtonDisabled]}>
              <Text style={styles.toolButtonText}>Add Window</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!selectedWall}
              onPress={() => addOpening('opening')}
              style={[styles.toolButton, !selectedWall && styles.toolButtonDisabled]}>
              <Text style={styles.toolButtonText}>Sliding</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.editorRow}>
            <Text style={styles.editorLabel}>
              {selectedOpening
                ? `${selectedOpening.type} ${
                    editableRoom.openings.findIndex(
                      opening => opening.id === selectedOpening.id,
                    ) + 1
                  }`
                : `${editableRoom.openings.length} openings`}
            </Text>
            {editableRoom.openings.map(opening => (
              <TouchableOpacity
                activeOpacity={0.8}
                key={opening.id}
                onPress={() => selectOpening(opening)}
                style={[
                  styles.toolButton,
                  selectedOpeningId === opening.id && styles.activeButton,
                ]}>
                <Text style={styles.toolButtonText}>
                  {opening.type === 'door'
                    ? 'Door'
                    : opening.type === 'opening'
                      ? 'Sliding'
                      : 'Window'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.editorGrid}>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => moveSelectedOpening(-0.15)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Left</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => moveSelectedOpening(0.15)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Right</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening || selectedOpening.type === 'door'}
            onPress={() => moveSelectedOpening(0, 0.12)}
            style={[
              styles.toolButton,
              (!selectedOpening || selectedOpening.type === 'door') &&
                styles.toolButtonDisabled,
            ]}>
            <Text style={styles.toolButtonText}>Up</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening || selectedOpening.type === 'door'}
            onPress={() => moveSelectedOpening(0, -0.12)}
            style={[
              styles.toolButton,
              (!selectedOpening || selectedOpening.type === 'door') &&
                styles.toolButtonDisabled,
            ]}>
            <Text style={styles.toolButtonText}>Down</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => resizeSelectedOpening(-0.12, 0)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Narrow</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => resizeSelectedOpening(0.12, 0)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Wider</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => resizeSelectedOpening(0, 0.12)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Taller</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={() => resizeSelectedOpening(0, -0.12)}
            style={[styles.toolButton, !selectedOpening && styles.toolButtonDisabled]}>
            <Text style={styles.toolButtonText}>Shorter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!selectedOpening}
            onPress={deleteSelectedOpening}
            style={[
              styles.deleteButton,
              !selectedOpening && styles.toolButtonDisabled,
            ]}>
            <Text style={styles.toolButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.editorStatus}>
          {saveMessage ??
            (spatial
              ? 'Spatial edit: choose a wall, add a door or window, then inspect it in place.'
              : 'Select a wall, add a door or window, then adjust it.')}
        </Text>
      </View>
    );
  }

  if (spatialScene) {
    return (
      <View style={styles.spatialScene}>
        <WebView
          ref={previewRef}
          allowFileAccess
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={['*']}
          onMessage={handlePreviewMessage}
          source={{html}}
          style={styles.webView}
        />
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setSpatialScene(false)}
          style={styles.spatialBackButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setSpatialEditorVisible(value => !value)}
          style={styles.spatialPlaceButton}>
          <Text style={styles.backButtonText}>
            {spatialEditorVisible ? 'Hide Tools' : 'Place'}
          </Text>
        </TouchableOpacity>
        {spatialEditorVisible ? renderOpeningEditor(true) : null}
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
          <Text style={styles.title}>{editableRoom.name}</Text>
          <Text style={styles.subtitle}>
            {editableRoom.quality ?? 'estimated'} quality - {detectedCount} detected,{' '}
            {estimatedCount} estimated - {editableRoom.wallConfidence ?? 0}% confidence
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setEditingOpenings(value => !value)}
          style={[styles.spatialButton, editingOpenings && styles.activeButton]}>
          <Text style={styles.backButtonText}>
            {editingOpenings ? 'Preview' : 'Edit'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setSpatialScene(true)}
          style={styles.spatialButton}>
          <Text style={styles.backButtonText}>Spatial</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={previewRef}
        allowFileAccess
        domStorageEnabled
        javaScriptEnabled
        originWhitelist={['*']}
        onMessage={handlePreviewMessage}
        source={{html}}
        style={styles.webView}
      />

      {editingOpenings ? renderOpeningEditor() : null}
    </SafeAreaView>
  );
}

function wallBottom(wall: RoomSurface) {
  return wall.center.y - Math.max(wall.size.y, 0.1) / 2;
}

function wallTop(wall: RoomSurface) {
  return wall.center.y + Math.max(wall.size.y, 0.1) / 2;
}

function wallLocalToWorld(wall: RoomSurface, localX: number, worldY: number): Vec3 {
  const yaw = wall.rotation?.y ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: wall.center.x + localX * c,
    y: worldY,
    z: wall.center.z - localX * s,
  };
}

function worldToWallLocal(wall: RoomSurface, point: Vec3) {
  const yaw = wall.rotation?.y ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = point.x - wall.center.x;
  const dz = point.z - wall.center.z;
  return {
    x: dx * c - dz * s,
    y: point.y - wall.center.y,
  };
}

function clampOpeningToWall(opening: RoomOpening, wall: RoomSurface): RoomOpening {
  const wallWidth = Math.max(wall.size.x, 0.6);
  const wallHeight = Math.max(wall.size.y, 0.8);
  const openingWidth = Math.min(Math.max(opening.size.x, 0.35), wallWidth - 0.12);
  const openingHeight = Math.min(Math.max(opening.size.y, 0.35), wallHeight - 0.12);
  const local = worldToWallLocal(wall, opening.center);
  const maxX = Math.max((wallWidth - openingWidth) / 2 - 0.04, 0);
  const minY = wallBottom(wall) + openingHeight / 2 + 0.04;
  const maxY = wallTop(wall) - openingHeight / 2 - 0.04;
  const centerY =
    opening.type === 'door' || opening.type === 'opening'
      ? wallBottom(wall) + openingHeight / 2
      : clamp(opening.center.y, minY, Math.max(minY, maxY));

  return {
    ...opening,
    center: wallLocalToWorld(wall, clamp(local.x, -maxX, maxX), centerY),
    size: {
      ...opening.size,
      x: openingWidth,
      y: openingHeight,
      z: opening.size.z || 0.08,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createPreviewHtml(
  room: RoomModel,
  options?: {
    spatialOnly?: boolean;
    selectedWallId?: string;
    selectedOpeningId?: string;
    initialCamera?: PreviewCameraState | null;
  },
) {
  const roomJson = JSON.stringify(room).replace(/</g, '\\u003c');
  const spatialOnly = options?.spatialOnly === true;
  const selectedWallId = JSON.stringify(options?.selectedWallId ?? null);
  const selectedOpeningId = JSON.stringify(options?.selectedOpeningId ?? null);
  const initialCameraJson = JSON.stringify(options?.initialCamera ?? null);

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
    let room = ${roomJson};
    const spatialOnly = ${spatialOnly ? 'true' : 'false'};
    let selectedWallId = ${selectedWallId};
    let selectedOpeningId = ${selectedOpeningId};
    const initialCamera = ${initialCameraJson};
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
    let hdrSky = null;

    let surfaces = createPreviewSurfaces(room.surfaces || []);
    let openings = room.openings || [];
    let bounds = getRoomBounds(surfaces);
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
      let orbitGeometry = buildGeometry(surfaces, 'orbit');
      let spatialGeometry = buildGeometry(surfaces, 'spatial');

      loadHdrSkybox().then(sky => {
        hdrSky = sky;
        refreshGeometry();
        draw();
      }).catch(() => {});

      window.applyPreviewSelection = function(selection) {
        selectedWallId = selection && selection.selectedWallId || null;
        selectedOpeningId = selection && selection.selectedOpeningId || null;
        refreshGeometry();
        if (selection && selection.focusOpening && mode === 'spatial') {
          focusSelectedOpening();
        }
        draw();
      };

      window.applyPreviewRoom = function(nextRoom) {
        if (!nextRoom) return;
        room = nextRoom;
        surfaces = createPreviewSurfaces(room.surfaces || []);
        openings = room.openings || [];
        bounds = getRoomBounds(surfaces);
        spatialPosition = clampSpatialPosition(spatialPosition, bounds);
        refreshGeometry();
        draw();
      };

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
        sendCameraState();
      }

      function refreshGeometry() {
        orbitGeometry = buildGeometry(surfaces, 'orbit');
        spatialGeometry = buildGeometry(surfaces, 'spatial');
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

      function restoreCamera(camera) {
        if (!camera || camera.mode !== mode) {
          resetView();
          return;
        }
        yaw = Number.isFinite(camera.yaw) ? camera.yaw : yaw;
        pitch = Number.isFinite(camera.pitch) ? camera.pitch : pitch;
        distance = Number.isFinite(camera.distance) ? camera.distance : distance;
        spatialYaw = Number.isFinite(camera.spatialYaw) ? camera.spatialYaw : spatialYaw;
        spatialPitch = Number.isFinite(camera.spatialPitch) ? camera.spatialPitch : spatialPitch;
        if (Array.isArray(camera.spatialPosition) && camera.spatialPosition.length === 3) {
          spatialPosition = clampSpatialPosition(camera.spatialPosition, bounds);
        }
      }

      function sendCameraState() {
        if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'camera',
          camera: {
            mode,
            yaw,
            pitch,
            distance,
            spatialYaw,
            spatialPitch,
            spatialPosition
          }
        }));
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

      function focusSelectedOpening() {
        const opening = openings.find(item => item.id === selectedOpeningId);
        if (!opening) return;
        const wall = surfaces.find(surface => surface.id === opening.parentSurfaceId);
        if (!wall) return;
        const local = worldToWallLocal(wall, opening.center);
        const standPoint = transformPoint([local.x, -wall.center.y + 1.45, 1.35], wall);
        const target = [opening.center.x || 0, Math.max(opening.center.y || 1.2, 1.2), opening.center.z || 0];
        const clamped = clampSpatialPosition([standPoint[0], 1.55, standPoint[2]], bounds);
        spatialPosition = clamped;
        const dx = target[0] - spatialPosition[0];
        const dy = target[1] - spatialPosition[1];
        const dz = target[2] - spatialPosition[2];
        spatialYaw = Math.atan2(dx, -dz);
        spatialPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.42, 0.42);
      }

      restoreCamera(initialCamera);
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
      } else {
        addSkyDome(positions, colors);
      }
      const visibleItems = viewMode === 'spatial'
        ? items.filter(surface => surface.type !== 'floor')
        : items;
      for (const surface of visibleItems) {
        addSurface(surface, positions, colors, viewMode);
      }
      if (viewMode === 'spatial') {
        addSpatialShell(positions, colors);
        addRoomDetails(items, positions, colors);
      }
      addOpenings(openings, items, positions, colors, viewMode);
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

    function addSkyDome(positions, colors) {
      const radius = Math.max(bounds.width, bounds.depth, 8) * 2.15;
      const rings = 14;
      const segments = 36;
      const baseY = -0.35;
      for (let ring = 0; ring < rings; ring++) {
        const phi0 = (ring / rings) * Math.PI * 0.58;
        const phi1 = ((ring + 1) / rings) * Math.PI * 0.58;
        for (let segment = 0; segment < segments; segment++) {
          const theta0 = (segment / segments) * Math.PI * 2;
          const theta1 = ((segment + 1) / segments) * Math.PI * 2;
          const a = skyPoint(radius, baseY, phi0, theta0);
          const b = skyPoint(radius, baseY, phi1, theta0);
          const c = skyPoint(radius, baseY, phi1, theta1);
          const d = skyPoint(radius, baseY, phi0, theta1);
          addSkyVertex(a, positions, colors);
          addSkyVertex(b, positions, colors);
          addSkyVertex(c, positions, colors);
          addSkyVertex(a, positions, colors);
          addSkyVertex(c, positions, colors);
          addSkyVertex(d, positions, colors);
        }
      }
    }

    function skyPoint(radius, baseY, phi, theta) {
      const y = Math.cos(phi) * radius + baseY;
      const groundRadius = Math.sin(phi) * radius;
      return [
        bounds.centerX + Math.sin(theta) * groundRadius,
        y,
        bounds.centerZ + Math.cos(theta) * groundRadius
      ];
    }

    function addSkyVertex(point, positions, colors) {
      positions.push(point[0], point[1], point[2]);
      const color = sampleSkyPoint(point);
      colors.push(color[0], color[1], color[2], color[3]);
    }

    function sampleSkyPoint(point) {
      const dir = normalize([
        point[0] - bounds.centerX,
        point[1],
        point[2] - bounds.centerZ
      ]);
      return sampleSkyDirection(dir);
    }

    function sampleSkyDirection(dir) {
      if (hdrSky) {
        return hdrSky.sample(dir);
      }
      const t = clamp(dir[1] * 0.85 + 0.15, 0, 1);
      const horizonWarmth = Math.max(0, 1 - Math.abs(dir[1]) * 2.2);
      return [
        clamp(0.88 * (1 - t) + 0.38 * t + horizonWarmth * 0.08, 0, 1),
        clamp(0.64 * (1 - t) + 0.66 * t + horizonWarmth * 0.04, 0, 1),
        clamp(0.42 * (1 - t) + 0.86 * t, 0, 1),
        1
      ];
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
      addSurfaceOutline(ceiling, positions, colors, [0.9, 0.94, 0.92, 0.22], 0.025);
    }

    function addRoomDetails(items, positions, colors) {
      const walls = items.filter(surface => surface.type === 'wall');
      for (const wall of walls) {
        addBaseboard(wall, positions, colors);
        addWallContactShadow(wall, positions, colors);
      }
    }

    function addBaseboard(wall, positions, colors) {
      const length = Math.max(wall.size && wall.size.x || 0.04, 0.04);
      const yaw = wall.rotation && wall.rotation.y || 0;
      const bottomLocalY = -Math.max(wall.size && wall.size.y || 0.1, 0.1) / 2 + 0.055;
      const center = transformPoint([0, bottomLocalY, 0.075], wall);
      addThinBox(positions, colors, {
        center: {x: center[0], y: center[1], z: center[2]},
        size: {x: length, y: 0.11, z: 0.055},
        rotation: {y: yaw}
      }, [0.73, 0.68, 0.59, wall.source === 'estimated' ? 0.7 : 0.92]);
    }

    function addWallContactShadow(wall, positions, colors) {
      const length = Math.max(wall.size && wall.size.x || 0.04, 0.04);
      const yaw = wall.rotation && wall.rotation.y || 0;
      const center = transformPoint([0, -wall.center.y + 0.018, 0.16], wall);
      addThinBox(positions, colors, {
        center: {x: center[0], y: 0.012, z: center[2]},
        size: {x: length, y: 0.006, z: 0.32},
        rotation: {y: yaw}
      }, [0.05, 0.045, 0.035, wall.source === 'estimated' ? 0.12 : 0.18]);
    }

    function addSurface(surface, positions, colors, viewMode) {
      const color = colorFor(surface, viewMode);
      addThinBox(positions, colors, surface, color);
      if (viewMode === 'spatial') {
        if (surface.id === selectedWallId) {
          addThinBox(positions, colors, {
            ...surface,
            center: {x: surface.center.x, y: surface.center.y, z: surface.center.z},
            size: {
              x: Math.max(surface.size && surface.size.x || 0.04, 0.04) + 0.02,
              y: Math.max(surface.size && surface.size.y || 0.04, 0.04) + 0.02,
              z: Math.max(surface.size && surface.size.z || 0.04, 0.04) + 0.025
            }
          }, [0.95, 0.68, 0.22, 0.28]);
        }
        return;
      } else if (surface.source === 'estimated') {
        addDashedOutline(surface, positions, colors);
      } else if (surface.id === selectedWallId) {
        addSurfaceOutline(surface, positions, colors, [0.98, 0.78, 0.34, 0.92], 0.035);
      }
    }

    function addOpenings(rawOpenings, allSurfaces, positions, colors, viewMode) {
      for (const opening of rawOpenings) {
        const wall = allSurfaces.find(surface => surface.id === opening.parentSurfaceId);
        if (!wall || wall.type !== 'wall') continue;
        const selected = opening.id === selectedOpeningId;
        if (opening.type === 'door') {
          addDoor(opening, wall, positions, colors, viewMode, selected);
        } else if (opening.type === 'opening') {
          addSlidingDoor(opening, wall, positions, colors, viewMode, selected);
        } else {
          addWindow(opening, wall, positions, colors, viewMode, selected);
        }
      }
    }

    function addDoor(opening, wall, positions, colors, viewMode, selected) {
      const depth = viewMode === 'spatial' ? 0.075 : 0.055;
      const surface = openingSurface(opening, wall, depth);
      addOpeningContactShadow(opening, wall, positions, colors, viewMode);
      addThinBox(positions, colors, surface, [0.43, 0.31, 0.2, 0.98]);
      addOpeningFrame(opening, wall, positions, colors, [0.2, 0.14, 0.09, 1], selected);
      const local = worldToWallLocal(wall, opening.center);
      const knobLocalX = Math.max(opening.size.x / 2 - 0.16, 0.08);
      const knobLocalY = opening.center.y - wall.center.y - opening.size.y * 0.12;
      const knobCenter = transformPoint([local.x + knobLocalX, knobLocalY, 0.055], wall);
      addThinBox(positions, colors, {
        center: {x: knobCenter[0], y: knobCenter[1], z: knobCenter[2]},
        size: {x: 0.055, y: 0.055, z: 0.04},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      }, [0.92, 0.73, 0.35, 1]);
    }

    function addWindow(opening, wall, positions, colors, viewMode, selected) {
      const surface = openingSurface(opening, wall, viewMode === 'spatial' ? 0.06 : 0.045);
      addSkyView(opening, wall, positions, colors, viewMode, 0.058);
      addOpeningContactShadow(opening, wall, positions, colors, viewMode);
      addThinBox(positions, colors, surface, glassColor(opening, wall, 0.12));
      addWindowLight(opening, wall, positions, colors, viewMode, 0.12);
      addOpeningFrame(opening, wall, positions, colors, [0.88, 0.86, 0.78, 1], selected);
      addOpeningBar(opening, wall, positions, colors, 0, true);
      addOpeningBar(opening, wall, positions, colors, 0, false);
    }

    function addSlidingDoor(opening, wall, positions, colors, viewMode, selected) {
      const leftPanel = openingPanel(opening, wall, -opening.size.x * 0.18, opening.size.x * 0.58, viewMode);
      const rightPanel = openingPanel(opening, wall, opening.size.x * 0.18, opening.size.x * 0.58, viewMode);
      addSkyView(opening, wall, positions, colors, viewMode, 0.06);
      addOpeningContactShadow(opening, wall, positions, colors, viewMode);
      addThinBox(positions, colors, leftPanel, glassColor(opening, wall, 0.14));
      addThinBox(positions, colors, rightPanel, glassColor(opening, wall, 0.1));
      addWindowLight(opening, wall, positions, colors, viewMode, 0.14);
      addOpeningFrame(opening, wall, positions, colors, [0.82, 0.8, 0.72, 1], selected);
      addOpeningBar(opening, wall, positions, colors, 0, false, 0.045, [0.88, 0.86, 0.78, 1]);
      addOpeningBar(opening, wall, positions, colors, 0, true, 0.04, [0.88, 0.86, 0.78, 1]);
    }

    function addSkyView(opening, wall, positions, colors, viewMode, depth) {
      const local = worldToWallLocal(wall, opening.center);
      const yaw = wall.rotation && wall.rotation.y || 0;
      const upper = transformPoint([local.x, local.y + opening.size.y * 0.22, depth], wall);
      const lower = transformPoint([local.x, local.y - opening.size.y * 0.22, depth + 0.006], wall);
      const upperColor = exteriorSkyColor(wall, 0.62, viewMode === 'spatial' ? 1 : 0.72);
      const lowerColor = horizonSkyColor(wall, viewMode === 'spatial' ? 1 : 0.68);
      addThinBox(positions, colors, {
        center: {x: upper[0], y: upper[1], z: upper[2]},
        size: {x: opening.size.x * 0.96, y: opening.size.y * 0.58, z: 0.012},
        rotation: {y: yaw}
      }, upperColor);
      addThinBox(positions, colors, {
        center: {x: lower[0], y: lower[1], z: lower[2]},
        size: {x: opening.size.x * 0.96, y: opening.size.y * 0.46, z: 0.012},
        rotation: {y: yaw}
      }, lowerColor);
      addSkyHighlight(opening, wall, positions, colors, viewMode, depth + 0.012);
    }

    function openingPanel(opening, wall, offsetX, width, viewMode) {
      const local = worldToWallLocal(wall, opening.center);
      const depth = viewMode === 'spatial' ? 0.065 : 0.05;
      const center = transformPoint([local.x + offsetX, local.y, depth], wall);
      return {
        id: opening.id + '-panel-' + offsetX,
        type: 'opening',
        source: 'detected',
        center: {x: center[0], y: center[1], z: center[2]},
        size: {x: width, y: opening.size.y, z: 0.03},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      };
    }

    function addWindowLight(opening, wall, positions, colors, viewMode, strength) {
      if (viewMode !== 'spatial') return;
      const local = worldToWallLocal(wall, opening.center);
      const y = Math.max(opening.center.y - opening.size.y * 0.34, 0.04);
      const floorCenter = transformPoint([local.x, y - wall.center.y, 0.55], wall);
      const sun = exteriorSkyColor(wall, 0.34, strength);
      addThinBox(positions, colors, {
        center: {x: floorCenter[0], y: 0.018, z: floorCenter[2]},
        size: {x: opening.size.x * 2.05, y: 0.008, z: 1.9},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      }, [sun[0] * 0.82, sun[1] * 0.86, sun[2], strength]);
      const wallGlow = transformPoint([local.x, local.y, 0.095], wall);
      addThinBox(positions, colors, {
        center: {x: wallGlow[0], y: wallGlow[1], z: wallGlow[2]},
        size: {x: opening.size.x * 1.18, y: opening.size.y * 1.12, z: 0.02},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      }, [sun[0] * 0.86, sun[1] * 0.9, sun[2], strength * 0.42]);
    }

    function addSkyHighlight(opening, wall, positions, colors, viewMode, depth) {
      if (viewMode !== 'spatial') return;
      const local = worldToWallLocal(wall, opening.center);
      const yaw = wall.rotation && wall.rotation.y || 0;
      const center = transformPoint([local.x - opening.size.x * 0.18, local.y + opening.size.y * 0.18, depth], wall);
      addThinBox(positions, colors, {
        center: {x: center[0], y: center[1], z: center[2]},
        size: {x: opening.size.x * 0.42, y: opening.size.y * 0.12, z: 0.01},
        rotation: {y: yaw}
      }, [0.9, 0.96, 1, 0.26]);
    }

    function addOpeningContactShadow(opening, wall, positions, colors, viewMode) {
      if (viewMode !== 'spatial') return;
      const local = worldToWallLocal(wall, opening.center);
      const center = transformPoint([local.x, -wall.center.y + 0.018, 0.25], wall);
      addThinBox(positions, colors, {
        center: {x: center[0], y: 0.014, z: center[2]},
        size: {x: opening.size.x * 1.12, y: 0.006, z: 0.5},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      }, [0.04, 0.035, 0.028, 0.18]);
    }

    function glassColor(opening, wall, alpha) {
      const sky = exteriorSkyColor(wall, 0.35, 1);
      return [
        clamp(sky[0] * 0.62 + 0.16, 0, 1),
        clamp(sky[1] * 0.68 + 0.2, 0, 1),
        clamp(sky[2] * 0.74 + 0.22, 0, 1),
        alpha
      ];
    }

    function exteriorSkyColor(wall, upward, alpha) {
      const yaw = wall.rotation && wall.rotation.y || 0;
      const dir = normalize([Math.sin(yaw), upward, Math.cos(yaw)]);
      const sky = sampleSkyDirection(dir);
      return [sky[0], sky[1], sky[2], alpha];
    }

    function horizonSkyColor(wall, alpha) {
      const sky = exteriorSkyColor(wall, 0.18, 1);
      return [
        clamp(sky[0] * 0.72 + 0.18, 0, 1),
        clamp(sky[1] * 0.76 + 0.18, 0, 1),
        clamp(sky[2] * 0.86 + 0.12, 0, 1),
        alpha
      ];
    }

    function openingSurface(opening, wall, depth) {
      const yaw = wall.rotation && wall.rotation.y || 0;
      const local = worldToWallLocal(wall, opening.center);
      const center = transformPoint([local.x, local.y, depth], wall);
      return {
        id: opening.id + '-visual',
        type: 'opening',
        source: 'detected',
        center: {x: center[0], y: center[1], z: center[2]},
        size: {x: opening.size.x, y: opening.size.y, z: 0.035},
        rotation: {y: yaw}
      };
    }

    function addOpeningFrame(opening, wall, positions, colors, color, selected) {
      const local = worldToWallLocal(wall, opening.center);
      const frame = selected ? [0.98, 0.78, 0.34, 1] : color;
      const thickness = selected ? 0.075 : 0.055;
      const halfW = opening.size.x / 2;
      const halfH = opening.size.y / 2;
      addOpeningBar(opening, wall, positions, colors, -halfW, false, thickness, frame);
      addOpeningBar(opening, wall, positions, colors, halfW, false, thickness, frame);
      addOpeningBar(opening, wall, positions, colors, local.y + halfH, true, thickness, frame, true);
      if (opening.type !== 'door' && opening.type !== 'opening') {
        addOpeningBar(opening, wall, positions, colors, local.y - halfH, true, thickness, frame, true);
      }
    }

    function addOpeningBar(opening, wall, positions, colors, offset, horizontal, thickness, color, absoluteY) {
      const local = worldToWallLocal(wall, opening.center);
      const barThickness = thickness || 0.035;
      const barColor = color || [0.86, 0.91, 0.88, 1];
      const centerLocalX = horizontal ? local.x : local.x + offset;
      const centerLocalY = horizontal ? (absoluteY ? offset : local.y + offset) : local.y;
      const center = transformPoint([centerLocalX, centerLocalY, 0.085], wall);
      addThinBox(positions, colors, {
        center: {x: center[0], y: center[1], z: center[2]},
        size: horizontal
          ? {x: opening.size.x + barThickness, y: barThickness, z: 0.045}
          : {x: barThickness, y: opening.size.y, z: 0.045},
        rotation: {y: wall.rotation && wall.rotation.y || 0}
      }, barColor);
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

    function worldToWallLocal(surface, point) {
      const yaw = surface.rotation && surface.rotation.y || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const dx = (point.x || 0) - (surface.center.x || 0);
      const dz = (point.z || 0) - (surface.center.z || 0);
      return {
        x: dx * c - dz * s,
        y: (point.y || 0) - (surface.center.y || 0),
        z: dx * s + dz * c
      };
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
      const sideFill = Math.max(dot(normal, normalize([0.42, 0.22, -0.68])), 0);
      const sky = sampleSkyDirection(normalize([normal[0] * 0.35, Math.max(normal[1], 0.25), normal[2] * 0.35]));
      const warmAmbient = 0.68;
      const intensity = Math.min(warmAmbient + directional * 0.36 + sideFill * 0.08 + upward * 0.12, 1.18);
      return [
        Math.min(color[0] * intensity + sky[0] * 0.055, 1),
        Math.min(color[1] * intensity + sky[1] * 0.05, 1),
        Math.min(color[2] * intensity + sky[2] * 0.045, 1),
        color[3]
      ];
    }

    function colorFor(surface, viewMode) {
      const estimated = surface.source === 'estimated';
      if (viewMode === 'spatial') {
        if (surface.type === 'floor') return estimated ? [0.42, 0.34, 0.25, 0.96] : [0.5, 0.4, 0.29, 1];
        if (surface.type === 'ceiling') return [0.78, 0.76, 0.69, 0.9];
        return estimated ? [0.62, 0.6, 0.53, 0.88] : [0.72, 0.69, 0.61, 0.96];
      }
      if (surface.type === 'floor') return estimated ? [0.5, 0.42, 0.32, 0.28] : [0.58, 0.47, 0.34, 0.82];
      return estimated ? [0.82, 0.82, 0.74, 0.18] : [0.84, 0.84, 0.76, 0.62];
    }

    async function loadHdrSkybox() {
      const response = await fetch('file:///android_asset/skyboxes/autumn_field_puresky_1k.hdr');
      if (!response.ok) {
        throw new Error('HDR skybox missing');
      }
      return parseHdrSkybox(await response.arrayBuffer());
    }

    function parseHdrSkybox(buffer) {
      const bytes = new Uint8Array(buffer);
      let offset = 0;
      function readLine() {
        let end = offset;
        while (end < bytes.length && bytes[end] !== 10) end++;
        let line = '';
        for (let i = offset; i < end; i++) {
          if (bytes[i] !== 13) line += String.fromCharCode(bytes[i]);
        }
        offset = end + 1;
        return line;
      }

      let line = readLine();
      if (line.indexOf('#?RADIANCE') !== 0 && line.indexOf('#?RGBE') !== 0) {
        throw new Error('Unsupported HDR file');
      }
      do {
        line = readLine();
      } while (line && line[0] !== '-' && line[0] !== '+');

      const sizeMatch = line.match(/-Y\\s+(\\d+)\\s+\\+X\\s+(\\d+)/);
      if (!sizeMatch) {
        throw new Error('Unsupported HDR orientation');
      }
      const height = Number(sizeMatch[1]);
      const width = Number(sizeMatch[2]);
      const data = new Float32Array(width * height * 3);
      const scanline = new Uint8Array(width * 4);

      for (let y = 0; y < height; y++) {
        if (bytes[offset] === 2 && bytes[offset + 1] === 2 && (bytes[offset + 2] & 128) === 0) {
          const scanlineWidth = (bytes[offset + 2] << 8) | bytes[offset + 3];
          offset += 4;
          if (scanlineWidth !== width) {
            throw new Error('HDR scanline width mismatch');
          }
          for (let channel = 0; channel < 4; channel++) {
            let x = 0;
            while (x < width) {
              const count = bytes[offset++];
              if (count > 128) {
                const run = count - 128;
                const value = bytes[offset++];
                for (let i = 0; i < run; i++) {
                  scanline[x++ * 4 + channel] = value;
                }
              } else {
                for (let i = 0; i < count; i++) {
                  scanline[x++ * 4 + channel] = bytes[offset++];
                }
              }
            }
          }
        } else {
          for (let x = 0; x < width; x++) {
            scanline[x * 4 + 0] = bytes[offset++];
            scanline[x * 4 + 1] = bytes[offset++];
            scanline[x * 4 + 2] = bytes[offset++];
            scanline[x * 4 + 3] = bytes[offset++];
          }
        }

        for (let x = 0; x < width; x++) {
          const rgbe = x * 4;
          const exponent = scanline[rgbe + 3];
          const out = (y * width + x) * 3;
          if (exponent) {
            const scale = Math.pow(2, exponent - 136);
            data[out] = scanline[rgbe] * scale;
            data[out + 1] = scanline[rgbe + 1] * scale;
            data[out + 2] = scanline[rgbe + 2] * scale;
          }
        }
      }

      return {
        sample(direction) {
          const u = (Math.atan2(direction[0], direction[2]) / (Math.PI * 2) + 1) % 1;
          const v = clamp(Math.acos(clamp(direction[1], -1, 1)) / Math.PI, 0, 1);
          const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
          const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
          const index = (y * width + x) * 3;
          return toneMapHdr(data[index], data[index + 1], data[index + 2]);
        }
      };
    }

    function toneMapHdr(r, g, b) {
      const exposure = 0.95;
      const gamma = 1 / 2.2;
      const mapped = [
        Math.pow(1 - Math.exp(-r * exposure), gamma),
        Math.pow(1 - Math.exp(-g * exposure), gamma),
        Math.pow(1 - Math.exp(-b * exposure), gamma)
      ];
      return [
        clamp(mapped[0] * 0.92 + 0.04, 0, 1),
        clamp(mapped[1] * 0.92 + 0.04, 0, 1),
        clamp(mapped[2] * 0.92 + 0.04, 0, 1),
        1
      ];
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
  spatialEditorPanel: {
    backgroundColor: 'rgba(16, 20, 24, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 8,
    borderWidth: 1,
    elevation: 30,
    gap: 10,
    height: 292,
    left: 12,
    padding: 10,
    position: 'absolute',
    right: 12,
    top: 88,
    zIndex: 30,
  },
  activeButton: {
    backgroundColor: '#b07b27',
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: '#8f3d35',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 12,
  },
  editorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  editorLabel: {
    alignSelf: 'center',
    color: '#d9e8e2',
    fontSize: 13,
    fontWeight: '700',
    paddingRight: 2,
  },
  editorPanel: {
    backgroundColor: 'rgba(16, 20, 24, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    bottom: 12,
    gap: 10,
    left: 12,
    padding: 10,
    position: 'absolute',
    right: 12,
    zIndex: 20,
    elevation: 20,
  },
  editorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  editorStatus: {
    color: '#b9c7c2',
    fontSize: 12,
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
    zIndex: 40,
    elevation: 40,
  },
  spatialPlaceButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(176, 123, 39, 0.94)',
    borderRadius: 8,
    elevation: 40,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 14,
    top: 18,
    zIndex: 40,
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
  toolButton: {
    alignItems: 'center',
    backgroundColor: '#263630',
    borderColor: '#3e5e54',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 78,
    paddingHorizontal: 12,
  },
  toolButtonDisabled: {
    backgroundColor: '#303a37',
    borderColor: '#3a4541',
    opacity: 0.48,
  },
  toolButtonText: {
    color: '#f0faf6',
    fontSize: 13,
    fontWeight: '700',
  },
});
