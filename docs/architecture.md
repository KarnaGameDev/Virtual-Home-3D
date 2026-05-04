# Architecture

## Core Idea

The app should feel like one product while using the best scanner available per platform.

```text
React Native UI
  ├── Scanner screen
  ├── 3D room preview
  ├── Prop library
  └── Save/load projects

Native scanner modules
  ├── iOS: RoomPlan + ARKit
  └── Android: ARCore + Depth API + reconstruction

Shared output
  ├── room.json
  ├── room.glb or room.usdz
  └── scene.json
```

## iOS Scanner

The iOS scanner should present `RoomCaptureView`, collect the final `CapturedRoom`, export a USD/USDZ file, and convert the semantic room data into `RoomModel`.

RoomPlan should be treated as the high-quality semantic scanner. It can recognize room structure and common architectural elements on supported LiDAR devices.

## Android Scanner

Android should use ARCore as the capture layer:

- Check ARCore availability.
- Request camera permission.
- Start an ARCore session.
- Detect floor and wall planes.
- Use Depth API when available.
- Accumulate points/depth over time.
- Fit clean surfaces from raw observations.
- Export a simplified GLB mesh and normalized `RoomModel`.

Android needs more custom logic than iOS because ARCore does not provide a full RoomPlan-style semantic room model.

## Scene Save Format

The save format should keep the scanned room separate from placed props:

```json
{
  "room": {
    "id": "room-001",
    "meshUri": "file:///.../room.glb",
    "surfaces": []
  },
  "props": [
    {
      "id": "prop-001",
      "assetId": "sofa-modern-001",
      "position": {"x": 1.2, "y": 0, "z": -2.4},
      "rotation": {"x": 0, "y": 1.57, "z": 0},
      "scale": {"x": 1, "y": 1, "z": 1}
    }
  ]
}
```

This format will be easy to import into Unity later.
