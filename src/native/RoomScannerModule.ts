import {NativeModules, Platform} from 'react-native';
import type {RoomModel} from '../domain/room';

type NativeRoomScannerModule = {
  isSupported(): Promise<boolean>;
  scanRoom(): Promise<RoomModel>;
  getLatestRoom(): Promise<RoomModel | null>;
  getSavedRooms?(): Promise<RoomModel[]>;
  saveLatestRoom(roomJson: string): Promise<void>;
  deleteSavedRoom?(roomId: string): Promise<void>;
};

const moduleName = 'RoomScannerModule';
const nativeModule = NativeModules[moduleName] as
  | NativeRoomScannerModule
  | undefined;

export async function isRoomScanningSupported(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.isSupported();
}

export async function scanRoom(): Promise<RoomModel> {
  if (!nativeModule) {
    throw new Error(
      `Room scanning is not available on ${Platform.OS}. Native module ${moduleName} is missing.`,
    );
  }

  return nativeModule.scanRoom();
}

export async function getLatestRoom(): Promise<RoomModel | null> {
  if (!nativeModule?.getLatestRoom) {
    return null;
  }

  return nativeModule.getLatestRoom();
}

export async function getSavedRooms(): Promise<RoomModel[]> {
  if (nativeModule?.getSavedRooms) {
    return nativeModule.getSavedRooms();
  }

  const latestRoom = await getLatestRoom();
  return latestRoom ? [latestRoom] : [];
}

export async function saveLatestRoom(room: RoomModel): Promise<void> {
  if (!nativeModule?.saveLatestRoom) {
    return;
  }

  await nativeModule.saveLatestRoom(JSON.stringify(room));
}

export async function deleteSavedRoom(roomId: string): Promise<void> {
  if (!nativeModule?.deleteSavedRoom) {
    return;
  }

  await nativeModule.deleteSavedRoom(roomId);
}
