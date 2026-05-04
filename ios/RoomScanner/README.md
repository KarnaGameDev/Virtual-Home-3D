# iOS Scanner Module

This folder owns the iOS implementation of `RoomScannerModule`.

Planned native stack:

- Swift
- Apple RoomPlan
- ARKit
- USD/USDZ export
- JSON conversion into the shared `RoomModel` schema in `src/domain/room.ts`

Current implementation:

- Checks RoomPlan support.
- Presents `RoomCaptureView`.
- Runs a `RoomCaptureSession`.
- Receives the finalized `CapturedRoom`.
- Converts RoomPlan surfaces and openings into the shared `RoomModel` shape.

The next implementation step is USD/USDZ export and stronger transform conversion for rotations.
