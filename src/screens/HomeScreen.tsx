import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getLatestRoom,
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
  const [room, setRoom] = useState<RoomModel | null>(null);
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

    getLatestRoom()
      .then(latestRoom => {
        if (mounted && latestRoom) {
          setRoom(latestRoom);
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
      setRoom(nextRoom);
      setScanState('ready');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed');
      setScanState('error');
    }
  }

  const canScan = scanState === 'ready' || scanState === 'error';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
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
        <Text style={styles.panelTitle}>Latest Room</Text>
        {room ? (
          <>
            <Text style={styles.roomName}>{room.name}</Text>
            <Text style={styles.panelText}>
              {room.surfaces.length} surfaces, {room.openings.length} openings
            </Text>
            <Text style={styles.panelText}>
              Quality: {room.quality ?? 'unknown'} - Detected:{' '}
              {room.detectedSurfaceCount ?? room.surfaces.length} - Estimated:{' '}
              {room.estimatedSurfaceCount ?? 0}
            </Text>
            <Text style={styles.panelText}>
              Wall confidence: {room.wallConfidence ?? 0}% - Depth frames:{' '}
              {room.depthFrameCount ?? 0}
            </Text>
            <Text style={styles.panelText}>
              Raw depth confidence: {room.rawDepthConfidence ?? 0}%
            </Text>
            <Text style={styles.panelText}>
              Depth points: {room.depthPointCount ?? 0}
            </Text>
            <Text style={styles.panelText}>Scanner: {room.scanner}</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => onPreviewRoom(room)}
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Open 3D Preview</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.panelText}>No room has been scanned yet.</Text>
        )}
      </View>
    </SafeAreaView>
  );
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
  roomName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
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
  secondaryButton: {
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
});
