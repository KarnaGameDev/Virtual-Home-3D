import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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

const PREVIEW_BASE_URL =
  'http://localhost:8085/room_preview.html?v=20260508-1705';

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

function escapeForInject(json: string) {
  return json.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

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
  const previewUrl = useMemo(
    () =>
      spatialScene
        ? `${PREVIEW_BASE_URL}#mode=spatial&panel=hide`
        : PREVIEW_BASE_URL,
    [spatialScene],
  );
  const detectedCount =
    editableRoom.detectedSurfaceCount ??
    editableRoom.surfaces.filter(surface => surface.source !== 'estimated').length;
  const estimatedCount =
    editableRoom.estimatedSurfaceCount ??
    editableRoom.surfaces.filter(surface => surface.source === 'estimated').length;

  const pushPreviewSelection = useCallback(() => {
    const payload = escapeForInject(
      JSON.stringify({
        selectedWallId:
          editingOpenings || spatialScene ? selectedWall?.id ?? null : null,
        selectedOpeningId:
          editingOpenings || spatialScene ? selectedOpeningId ?? null : null,
        focusOpening: spatialScene && selectedOpeningId != null,
      }),
    );
    previewRef.current?.injectJavaScript(
      `window.applyPreviewSelection && window.applyPreviewSelection(JSON.parse('${payload}')); true;`,
    );
  }, [editingOpenings, selectedOpeningId, selectedWall?.id, spatialScene]);

  const pushPreviewRoom = useCallback(() => {
    const payload = escapeForInject(JSON.stringify(editableRoom));
    previewRef.current?.injectJavaScript(
      `window.applyPreviewRoom && window.applyPreviewRoom(JSON.parse('${payload}')); true;`,
    );
  }, [editableRoom]);

  const pushPreviewCamera = useCallback(() => {
    const camera = cameraStateRef.current;
    if (!camera) {
      return;
    }
    const payload = escapeForInject(JSON.stringify(camera));
    previewRef.current?.injectJavaScript(
      `window.restoreCamera && window.restoreCamera(JSON.parse('${payload}')); true;`,
    );
  }, []);

  useEffect(() => {
    pushPreviewSelection();
  }, [pushPreviewSelection]);

  useEffect(() => {
    pushPreviewRoom();
  }, [pushPreviewRoom]);

  function handlePreviewMessage(event: {nativeEvent: {data: string}}) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        camera?: PreviewCameraState;
      };
      if (message.type === 'camera' && message.camera) {
        cameraStateRef.current = message.camera;
      } else if (message.type === 'ready') {
        pushPreviewRoom();
        pushPreviewSelection();
        pushPreviewCamera();
      }
    } catch {
      // Best-effort; bad WebView messages should not break editing.
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
          cacheEnabled={false}
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={['*']}
          onMessage={handlePreviewMessage}
          source={{uri: previewUrl}}
          style={styles.webView}
          mixedContentMode="always"
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
        cacheEnabled={false}
        domStorageEnabled
        javaScriptEnabled
        originWhitelist={['*']}
        onMessage={handlePreviewMessage}
        source={{uri: previewUrl}}
        style={styles.webView}
        mixedContentMode="always"
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
