import {NativeModules, Platform} from 'react-native';
import type {RoomModel} from '../domain/room';

type NativeRoomScannerModule = {
  isSupported(): Promise<boolean>;
  scanRoom(): Promise<RoomModel>;
  getLatestRoom(): Promise<RoomModel | null>;
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
