export type PlatformScanner = 'ios-roomplan' | 'android-arcore';

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type RoomSurfaceType = 'floor' | 'wall';

export type RoomSurfaceSource = 'detected' | 'estimated';

export type RoomScanQuality = 'good' | 'estimated' | 'poor';

export type RoomOpeningType = 'door' | 'window' | 'opening';

export type RoomSurface = {
  id: string;
  type: RoomSurfaceType;
  center: Vec3;
  size: Vec3;
  rotation: Vec3;
  source?: RoomSurfaceSource;
};

export type RoomOpening = {
  id: string;
  type: RoomOpeningType;
  parentSurfaceId: string;
  center: Vec3;
  size: Vec3;
};

export type RoomModel = {
  id: string;
  name: string;
  createdAt: string;
  scanner: PlatformScanner;
  units: 'meters';
  surfaces: RoomSurface[];
  openings: RoomOpening[];
  quality?: RoomScanQuality;
  detectedSurfaceCount?: number;
  estimatedSurfaceCount?: number;
  depthEnabled?: boolean;
  depthFrameCount?: number;
  depthPointCount?: number;
  rawDepthConfidence?: number;
  wallConfidence?: number;
  markedCornerCount?: number;
  manualCorners?: Vec3[];
  scanDurationMs?: number;
  scanPhase?: string;
  meshUri?: string;
  previewImageUri?: string;
};

export type PlacedProp = {
  id: string;
  assetId: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

export type RoomScene = {
  room: RoomModel;
  props: PlacedProp[];
};
