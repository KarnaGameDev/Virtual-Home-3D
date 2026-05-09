import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  deleteSavedRoom,
  getSavedRooms,
  isRoomScanningSupported,
  scanRoom,
} from '../native/RoomScannerModule';
import type {RoomModel} from '../domain/room';

type HomeScreenProps = {
  onPreviewRoom: (room: RoomModel) => void;
};

type ScanState = 'checking' | 'ready' | 'unsupported' | 'scanning' | 'error';

export function HomeScreen({onPreviewRoom}: HomeScreenProps) {
  const [scanState, setScanState] = useState<ScanState>('checking');
  const [rooms, setRooms] = useState<RoomModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    isRoomScanningSupported()
      .then(supported => {
        if (mounted) {
          setScanState(supported ? 'ready' : 'unsupported');
        }
      })
      .catch(() => {
        if (mounted) {
          setScanState('unsupported');
        }
      });

    getSavedRooms()
      .then(savedRooms => {
        if (mounted) {
          setRooms(savedRooms);
        }
      })
      .catch(() => {
        // A missing or older native cache should not block a new scan.
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleScan() {
    setError(null);
    setScanState('scanning');

    try {
      const nextRoom = await scanRoom();
      setRooms(currentRooms => upsertRoom(currentRooms, nextRoom));
      setScanState('ready');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed');
      setScanState('error');
    }
  }

  function confirmDeleteRoom(room: RoomModel) {
    Alert.alert(
      'Delete layout?',
      `Delete ${room.name}? This cannot be undone.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            handleDeleteRoom(room).catch(() => undefined);
          },
        },
      ],
    );
  }

  async function handleDeleteRoom(room: RoomModel) {
    if (!room.id) {
      setError('This layout cannot be deleted because it has no saved id.');
      return;
    }

    setError(null);
    try {
      await deleteSavedRoom(room.id);
      setRooms(currentRooms =>
        currentRooms.filter(savedRoom => savedRoom.id !== room.id),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Layout could not be deleted',
      );
    }
  }

  const canScan = scanState === 'ready' || scanState === 'error';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Room Scanner</Text>
          <Text style={styles.subtitle}>
            Scan a real room, create a clean 3D layout, then place reusable props.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Scanner</Text>
          <Text style={styles.panelText}>{statusText(scanState)}</Text>

          {scanState === 'checking' || scanState === 'scanning' ? (
            <ActivityIndicator color="#1f8a70" />
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!canScan}
            onPress={handleScan}
            style={[styles.button, !canScan && styles.buttonDisabled]}>
            <Text style={styles.buttonText}>Start Room Scan</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Saved Layouts</Text>
          {rooms.length ? (
            rooms.map(savedRoom => (
              <View key={savedRoom.id} style={styles.layoutItem}>
                <View style={styles.layoutText}>
                  <Text style={styles.layoutName}>{savedRoom.name}</Text>
                  <Text style={styles.panelText}>
                    {formatRoomDate(savedRoom.createdAt)}
                  </Text>
                </View>
                <View style={styles.layoutActions}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => onPreviewRoom(savedRoom)}
                    style={styles.viewButton}>
                    <Text style={styles.secondaryButtonText}>View</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => confirmDeleteRoom(savedRoom)}
                    style={styles.deleteButton}>
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.panelText}>
              No saved layouts yet. Start a room scan to create one.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function upsertRoom(rooms: RoomModel[], nextRoom: RoomModel) {
  return [nextRoom]
    .concat(rooms.filter(room => room.id !== nextRoom.id))
    .slice(0, 12);
}

function formatRoomDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return date.toLocaleString();
}

function statusText(scanState: ScanState) {
  switch (scanState) {
    case 'checking':
      return 'Checking this device for room scanning support.';
    case 'ready':
      return 'This device is ready to scan.';
    case 'unsupported':
      return 'This device does not expose the required native scanner yet.';
    case 'scanning':
      return 'Scanning in progress.';
    case 'error':
      return 'The last scan did not complete.';
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101418',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  title: {
    color: '#f8fbfa',
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    color: '#b9c7c2',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  panel: {
    backgroundColor: '#182025',
    borderRadius: 8,
    padding: 18,
    gap: 12,
  },
  panelTitle: {
    color: '#f8fbfa',
    fontSize: 18,
    fontWeight: '700',
  },
  panelText: {
    color: '#c8d6d1',
    fontSize: 15,
    lineHeight: 22,
  },
  error: {
    color: '#ffb4ab',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1f8a70',
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    backgroundColor: '#41504b',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  viewButton: {
    alignItems: 'center',
    backgroundColor: '#263630',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3e5e54',
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#dff7ee',
    fontSize: 15,
    fontWeight: '700',
  },
  layoutItem: {
    alignItems: 'center',
    borderColor: '#33443f',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  layoutText: {
    flex: 1,
    gap: 4,
  },
  layoutName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  layoutActions: {
    flexDirection: 'row',
    gap: 8,
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: '#8f3d35',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  deleteButtonText: {
    color: '#fff4f2',
    fontSize: 15,
    fontWeight: '700',
  },
});
