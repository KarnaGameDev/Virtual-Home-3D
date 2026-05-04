# Android Scanner Module

This folder owns the Android implementation of `RoomScannerModule`.

Planned native stack:

- Kotlin
- Google ARCore
- Depth API where available
- Plane detection and hit testing
- Room reconstruction from floor, wall, ceiling, openings, and accumulated depth data
- GLB export plus JSON conversion into the shared `RoomModel` schema in `src/domain/room.ts`

Current implementation:

- Checks ARCore support.
- Requests camera permission.
- Starts an ARCore `Session`.
- Enables horizontal/vertical plane finding.
- Enables automatic Depth API mode when supported.
- Returns starter rectangular room geometry through the shared React Native bridge.

Android does not have a direct equivalent of Apple RoomPlan. The scanner still needs a guided capture flow and reconstruction layer built on ARCore primitives before it can produce measured production-quality rooms.
