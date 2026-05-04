# Cross-Platform Room Scanner

React Native app for scanning rooms on iOS and Android, creating a normalized 3D room model, placing premade props, and saving the result for later AR/VR use.

## Product Direction

The app is a single codebase with platform-specific scanner engines:

- iOS uses Apple RoomPlan and ARKit.
- Android uses Google ARCore, Depth API, plane detection, and a custom reconstruction layer.
- React Native owns the shared UI, room schema, save flow, and prop placement workflow.

## Current Status

This repository contains the first scaffold:

- Shared React Native app entrypoint.
- Shared TypeScript `RoomModel` and `RoomScene` schema.
- React Native native module bridge named `RoomScannerModule`.
- iOS Swift bridge that presents a RoomPlan capture view and returns normalized room metadata.
- Android Kotlin bridge that launches an ARCore scan activity, enables Depth API when available, and returns starter room geometry.
- Basic home screen that checks scanner support and starts a scan.

The Android reconstruction layer is still an MVP shell. The next development pass should replace starter geometry with measured surfaces from ARCore observations:

- ARCore frame loop and plane tracking.
- Guided corner/wall marking.
- Plane fitting from depth and tracked feature points.
- GLB mesh export.

## Repository Layout

```text
.
├── App.tsx
├── src/
│   ├── domain/
│   │   └── room.ts
│   ├── native/
│   │   └── RoomScannerModule.ts
│   └── screens/
│       └── HomeScreen.tsx
├── ios/
│   └── RoomScanner/
│       ├── RoomScannerModule.swift
│       └── RoomScannerModule.m
└── android/
    └── app/src/main/java/com/roomscanner/
        ├── MainActivity.kt
        ├── MainApplication.kt
        ├── RoomScannerModule.kt
        └── RoomScannerPackage.kt
```

## Shared Output Format

Both native scanners must return the same shape:

```ts
type RoomModel = {
  id: string;
  name: string;
  createdAt: string;
  scanner: 'ios-roomplan' | 'android-arcore';
  units: 'meters';
  surfaces: RoomSurface[];
  openings: RoomOpening[];
  meshUri?: string;
  previewImageUri?: string;
};
```

This lets the later prop placement and Unity import flows work the same way on both platforms.

## Setup

Install dependencies:

```sh
npm install
```

Start Metro:

```sh
npm start
```

Run Android:

```sh
npm run android
```

Android native builds require Android Studio or a local JDK with `JAVA_HOME` set.

On Windows PowerShell, prefer the helper scripts because PowerShell may block `npm.ps1`:

```bat
scripts\start-metro.bat
scripts\android-build.bat
scripts\android-install-run.bat
scripts\typecheck.bat
scripts\lint.bat
```

If you run commands manually in PowerShell, use `cmd /c`:

```powershell
cmd /c npm start
cmd /c npm run typecheck
cmd /c npm run lint
cmd /c android\gradlew.bat -v
```

Run iOS from macOS:

```sh
cd ios
pod install
cd ..
npm run ios
```

## Next Milestones

1. Generate/complete full React Native native project files from the selected RN version.
2. Add iOS USD/USDZ export from `CapturedRoom`.
3. Replace Android starter room geometry with measured ARCore reconstruction.
4. Add a 3D preview/editor using GLB assets.
5. Add prop placement and save `scene.json`.
6. Add Unity export/import documentation.
