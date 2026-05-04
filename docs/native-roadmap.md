# Native Scanner Roadmap

## iOS RoomPlan Steps

1. Add iOS project and CocoaPods configuration.
2. Add camera usage description to `Info.plist`.
3. Create a native `RoomCaptureViewController`. Done.
4. Present it from `RoomScannerModule.scanRoom()`. Done.
5. Implement RoomPlan capture delegate callbacks. Done.
6. Export `CapturedRoom` as USDZ/USD.
7. Convert rotations and parent wall references more precisely.
8. Resolve the React Native promise with the normalized model. Done.

## Android ARCore Steps

1. Add camera permission flow. Done.
2. Create `RoomScanActivity`. Done.
3. Configure ARCore session with plane detection. Done.
4. Enable depth mode when supported. Done.
5. Track floor, wall, and ceiling candidates.
6. Add guided user capture for walls and corners.
7. Build a reconstruction module that fits clean planes from observations.
8. Export GLB plus normalized `RoomModel`.
9. Resolve the React Native promise with the scan result. Done with starter geometry.

## Quality Strategy

High quality requires different implementations:

- iOS quality comes from RoomPlan and LiDAR-capable devices.
- Android quality comes from ARCore Depth API plus a strong reconstruction pipeline.
- Unsupported devices should fall back to a guided manual room builder rather than pretending automatic scanning is available.
