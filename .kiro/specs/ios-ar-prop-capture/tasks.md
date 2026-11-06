# Implementation Plan: iOS AR Prop Capture

## Overview

The work runs in four layers, in this order:

1. Repository and Xcode project setup: make `ios/` ordinary files, fix project settings, and add the local `NightplotCore` package and the PropertyBased test dependency.
2. NightplotCore, the Foundation-only Swift package: the `PropLayout` mirror and TypeScript ports with parity vectors, geometry, the Capture model and editor with undo, export, spiral analysis, drafts, and the server client with its save flow.
3. The server change: a `LightsStore` interface, `InMemoryLightsStore`, a behaviour suite run on both stores, and the Swift fixture acceptance test.
4. The app target: `AppModel`, the ARKit and RealityKit layer, SwiftUI screens, scene wiring, and UI tests.

Swift code lives in `ios/NightplotCore` and `ios/nightplot`. Server code is TypeScript in `apps/server` and `packages/shared`. Swift tests use Swift Testing and PropertyBased in the `nightplotTests` target. TypeScript tests use vitest.

Swift test command, used at every checkpoint:

```bash
xcodebuild test -project ios/nightplot/nightplot.xcodeproj -scheme nightplot \
  -destination 'platform=iOS Simulator,name=<an installed iPhone simulator>'
```

Repository test commands: `corepack pnpm test` and `corepack pnpm typecheck` from the repository root. vitest runs once per invocation (`vitest run`), never in watch mode.

Test file conventions:

- Property tests go in `ios/nightplot/nightplotTests/Properties/`, one file per property, named `P<nn><Title>Tests.swift`.
- Each property test is one `@Test`. It calls `propertyCheck(count: 100, …)` or more (200 for geometry fits) and carries the comment `// Feature: ios-ar-prop-capture, Property <n>: <title>`.
- Generators go in `ios/nightplot/nightplotTests/Generators/`, one file per family. Fakes go in `ios/nightplot/nightplotTests/Fakes/`. Example tests go in `ios/nightplot/nightplotTests/Examples/`.

## Tasks

- [x] 1. Repository and Xcode project setup
  - [x] 1.1 Back up and remove the nested `ios/nightplot/.git`, and add Xcode ignores
    - Run `git -C ios/nightplot status --porcelain` and report anything uncommitted to the operator
    - Create a bundle outside the repository: `git -C ios/nightplot bundle create ~/Backups/nightplot-ios-history.bundle --all`
    - Verify it with `git bundle verify ~/Backups/nightplot-ios-history.bundle`. Stop if verification fails
    - Stop and ask the operator for an explicit go-ahead before removing anything. State the bundle path and that removal deletes the nested history
    - Only after the operator confirms, remove `ios/nightplot/.git`
    - Add `xcuserdata/`, `*.xcuserstate`, `DerivedData/`, `.build/`, and `.swiftpm/` to the root `.gitignore`. Keep `Package.resolved` tracked
    - Check that `find ios -name .git` and `git submodule status` print nothing, and that `git status` shows no build output or user data under `ios/`
    - _Requirements: 1.9_

  - [x] 1.2 Fix the Xcode project settings and remove `ContentView.swift`
    - In `nightplot.xcodeproj/project.xcproj`: set `IPHONEOS_DEPLOYMENT_TARGET = 17.0` at project level and remove the `27.2` override on `nightplotTests`, so all three targets inherit 17.0
    - Remove `INFOPLIST_KEY_UIRequiredDeviceCapabilities = arkit`
    - Set `INFOPLIST_KEY_NSCameraUsageDescription` to "Nightplot Capture uses the camera to measure props in AR."
    - Add `INFOPLIST_KEY_NSLocalNetworkUsageDescription` = "Nightplot Capture connects to your Nightplot server on your home network to save props."
    - In `nightplot/Info.plist`, add `NSAppTransportSecurity` with `NSAllowsLocalNetworking = YES`, and `NSExceptionDomains` for `lan`, `home.arpa`, and `internal`, each with `NSIncludesSubdomains` and `NSExceptionAllowsInsecureHTTPLoads`
    - Delete `nightplot/ContentView.swift` and any reference to it. Leave `AppDelegate` and `SceneDelegate` hosting a placeholder SwiftUI view until task 18.5
    - Confirm `xcodebuild build` succeeds for an iOS Simulator destination and for `generic/platform=iOS`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 11.4_

  - [x] 1.3 Create the NightplotCore local package and link the test dependency
    - Create `ios/NightplotCore/Package.swift` (swift-tools-version 6.0, platforms iOS 17 and macOS 14, one library target `NightplotCore`, Swift 6 language mode, no default actor isolation)
    - Create `Sources/NightplotCore/` with the folders `Capture`, `Geometry`, `Layout`, `Export`, `Spiral`, `Drafts`, `Net`, and `Display`, plus one placeholder file so the target builds
    - Add the local package to the project and link `NightplotCore` to `nightplot` and `nightplotTests`
    - Add `https://github.com/x-sheep/swift-property-based` from `2.0.0` and link it to `nightplotTests` only
    - Verify with `xcodebuild -resolvePackageDependencies` and a Simulator build. Commit `Package.resolved`
    - _Requirements: 1.1, 1.7_

  - [ ]* 1.4 Write project smoke tests
    - Add a test that scans every file under `ios/NightplotCore/Sources` (located through `#filePath`) and fails if any imports `ARKit`, `RealityKit`, `AVFoundation`, `UIKit`, or `SwiftUI`
    - Add a test that reads the app bundle's `Info.plist` and asserts non-empty `NSCameraUsageDescription` and `NSLocalNetworkUsageDescription`, and no `UIRequiredDeviceCapabilities` entry for `arkit`
    - Add a test that the app's `MinimumOSVersion` is `17.0`
    - _Requirements: 1.2, 1.3, 1.7, 2.1, 11.4_

- [x] 2. Layout mirror, wire types, and TypeScript ports
  - [x] 2.1 Implement `jsRound` and the `PropLayout` mirror
    - `Layout/JSRound.swift`: `jsRound(x) = (x + 0.5).rounded(.down)`, matching JavaScript `Math.round` on halves and negatives
    - `Layout/PropLayout.swift`: `LayoutSource`, `LayoutUnits`, `RunKind`, `PropLayout`, `LayoutCorner`, `LayoutEdge`, `LayoutString`, `PlacedLight`, `LayoutFace`, `LayoutBody`, `LayoutArc`, `LayoutTemplate`, and `LayoutNet`, with field names and optionality exactly as in `packages/shared/src/prop/layout.ts`
    - Encode optionals with `encodeIfPresent`. Provide a shared `JSONEncoder` factory with `.sortedKeys` and the default throwing non-conforming float strategy
    - Decoding ignores unknown keys
    - _Requirements: 14.1, 14.2, 14.4, 14.6_

  - [x] 2.2 Implement the wire types
    - `Net/WireTypes.swift`: `HealthBody`, `LedProductSummary`, `ProductsBody`, `SaveBody`, `RemotePropHeader`, `RemoteProp`, `PropsBody`, and `Measurements` (`custom` encodes as `{"shape":"custom"}`, `spiral` as `{shape, height, around, aroundTop, gap}`)
    - `LenientElement<T>` decodes one array element and stores either the value or the error, so one bad element does not fail the array
    - _Requirements: 7.6, 12.1, 14.6, 14.7_

  - [ ]* 2.3 Write property test for lenient decoding
    - Create `Generators/LayoutGen.swift` with a generator for `PropLayout` values that fill every optional field, and a helper that adds random extra keys at each object level
    - **Property 24: Lenient decoding of server props**
    - **Validates: Requirements 14.6, 14.7**

  - [x] 2.4 Port `isPropLayout`
    - `Layout/LayoutValidation.swift`: `isPropLayout(_ json: Any)` that runs on `JSONSerialization` output and checks types as the TypeScript does, `isValid(_ layout: PropLayout)` that encodes and runs the `Any` form, and a finite-number check over every numeric field
    - _Requirements: 8.9, 8.16, 14.4, 14.5_

  - [x] 2.5 Port the layout math
    - `Layout/LayoutMath.swift`: `layoutStrings`, `edgeLengthM`, `drawnLengthM`, `lightsOnLength`, `edgeLightCount`, and `countLayout`, including the `wrapCounts` chain rule (consecutive wrapped lit edges counted along the whole chain, restarted by a wire, hidden, or unwrapped edge), `lockedLights`, and `manualLights`
    - `formatLength` and `parseLength` for `ft` and `m`, with `toFixed(2)` emulated as `String(format: "%.2f", jsRound(x * 100) / 100)`
    - `parsePitchCm` (regex `^\d+(?:\.\d+)?$` after trimming, 0 < cm ≤ 200) and `formatPitchCm`
    - Use `jsRound` for every `Math.round` and keep the TypeScript operation order
    - _Requirements: 4.8, 7.8, 7.10, 7.11, 7.13_

  - [x] 2.6 Port the spiral template
    - `Layout/SpiralTemplate.swift`: `SpiralInput`, `spiralTurns`, `spiralLengthM(input, t0, t1)`, and `spiralLayout(params)` from `packages/shared/src/prop/wraps.ts`
    - Same step count `max(8, ceil(turns × 96 × |Δt|))` and the same rounding to 1e−6
    - _Requirements: 10.6, 10.7, 10.8_

  - [x] 2.7 Port `isLanAllowed`
    - `Net/LanAddress.swift`: `LanAddress.isAllowed(_:)` with the same private, loopback, and link-local ranges and the suffixes `.local`, `.lan`, `.home.arpa`, `.internal` as `packages/shared/src/net/address.ts`
    - _Requirements: 11.2_

  - [ ]* 2.8 Write the TypeScript-owned parity vectors
    - Create `packages/shared/src/prop/ios-parity.test.ts`. It holds input lists, computes outputs with the TypeScript originals, and compares them with `ios/fixtures/parity/*.json`. With `NIGHTPLOT_UPDATE_PARITY=1` it writes the files instead
    - Files: `format-length.json`, `parse-length.json`, `pitch-cm.json`, `lan-hosts.json`, `count-layout.json`, and `spiral.json`, with the inputs listed in the design's parity table (negatives, exact halves, Unicode primes, 0 and 200.01 cm, wrapped chains broken by a wire, hidden runs, `lockedLights`, `manualLights`, cylinders and cones near the turn limits)
    - Generate the files and commit them
    - _Requirements: 4.8, 7.10, 7.13, 10.8, 11.2_

  - [ ]* 2.9 Write the Swift parity vector tests
    - `nightplotTests/Parity/ParityVectorTests.swift` reads every file in `ios/fixtures/parity/` and asserts the Swift ports return the same outputs: strings and integers exactly, lengths within 1e−12 relative
    - _Requirements: 4.8, 7.10, 7.13, 10.8, 11.2_

- [x] 3. Geometry
  - [x] 3.1 Implement `Vec3` and `Ray`
    - `Geometry/Vec3.swift`: `Vec3` (`Codable`, `Hashable`) with add, subtract, scale, dot, cross, length, horizontal distance, and normalise
    - `Geometry/RayProfile.swift`: the `Ray` struct only. The surface intersection comes in task 10.6
    - _Requirements: 8.1_

  - [x] 3.2 Implement the projection plane fits
    - `Geometry/PlaneFit.swift`: `ProjectionFrame` with `project(_:)`, `PlaneFitError`, and `PlaneFit.vertical`, `PlaneFit.flat`, and `PlaneFit.offPlaneCount`
    - Vertical fit: fail with `noHorizontalSpread` unless two points are at least 0.05 m apart horizontally. Closed-form 2×2 scatter eigenvector for the along direction, the tie rule within 1e−9 × trace, normal flipped toward the mean device position with the mean-heading fallback within 1e−6, `right = (n_z, 0, −n_x)`, and `up = +y`
    - Flat fit: `away` from the mean device position to the centroid (mean-heading fallback within 0.05 m), `right = (−away_z, 0, away_x)`, and projection that drops the vertical component
    - The origin is the given wire-in, so `project(origin)` is exactly (0, 0)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.12, 8.14_

  - [ ]* 3.3 Write geometry generators
    - `Generators/GeometryGen.swift`: `Gen.vec3(in:)` within ±5 m horizontally and 0 to 4 m up with a minimum-separation option, point sets with device positions on a random side, near-planar sets (within 0.1 m of a random vertical plane), and exact-planar sets (every point on z = c)

  - [ ]* 3.4 Write property test for the vertical fit
    - **Property 17: The vertical plane fit is least squares and projects along the normal**
    - **Validates: Requirements 8.1**

  - [ ]* 3.5 Write property test for frame orientation and origin
    - Check at the `PlaneFit` level with generated points, device positions, and a chosen wire-in
    - **Property 18: Frame orientation and origin**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 3.6 Implement the circle fits
    - `Geometry/CircleFit.swift`: algebraic (Kåsa) least-squares circle fit on (x, z) points, and the circumcircle through three points
    - _Requirements: 9.1, 9.2_

- [x] 4. Device, tracking, and wording decisions in the core
  - [x] 4.1 Implement device support and the camera gate
    - `Display/DepthModeChoice.swift`: `DepthMode`, `ARSupport`, and `chooseARSupport(worldTracking:meshReconstruction:)`
    - In the same file: `CameraAuthStatus`, `CameraGateAction`, and `cameraGate(_:alreadyRequested:)` (`requestOnce` for not determined and not yet requested, `showNeedsAccess` for denied or restricted, `startSession` for authorized)
    - _Requirements: 1.3, 1.4, 1.5, 2.2, 2.3, 2.6_

  - [x] 4.2 Implement tracking copy, surface hits, and unit display
    - `Display/TrackingCopy.swift`: `TrackingStatus`, `LimitedReason`, `trackingMessage(_:)` with the exact copy from the design table, `SurfaceKind`, `SurfaceHit` with `isLowConfidence` (> 0.05 m), `DepthConfidence`, `estimateUncertainty(kind:distanceM:depthConfidence:)` using the design's heuristic table, and `placePointEnabled(tracking:hit:)`
    - `Display/Units.swift`: `formatUncertainty(_:unit:)` to 0.01 m for `m` and 0.5 in for `ft`, and a circumference formatter that rounds to 0.01 of the unit
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.8, 9.3_

  - [x] 4.3 Implement the wording strings
    - `Display/Wording.swift`: every save-related control label, status, and result string from the design, including the honesty statement "Saving puts this Prop in Nightplot as a design. It does not attach it to a controller, does not Apply, and does not light anything." and the confirmed-save statement
    - Use "string" for a physical light string and the `AGENTS.md` meanings for Prop, Lights, Segments, Attach, and Apply
    - _Requirements: 12.7, 15.1, 15.2, 15.3_

  - [ ]* 4.4 Write surface hit and tracking generators
    - `Generators/HitGen.swift`: `Gen.surfaceHit` (kind, uncertainty from 0 to 0.15 m, device position 0.3 to 6 m from the hit) and `Gen.trackingStatus`

  - [ ]* 4.5 Write property test for Place Point enablement
    - Covers `placePointEnabled`. The no-op tap on the document is checked against `AppModel` in task 16.2
    - **Property 1: Place Point is enabled only with normal tracking and a hit**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.8**

  - [ ]* 4.6 Write property test for uncertainty display
    - **Property 2: Uncertainty display resolution and the low-confidence threshold**
    - **Validates: Requirements 3.5, 3.6**

  - [ ]* 4.7 Write example tests for device, camera, tracking, and wording
    - `chooseARSupport` for no world tracking, world tracking only, and world tracking with mesh
    - `cameraGate` for each status, including denied after a request (no second prompt)
    - The exact message for each tracking status, with no ARKit identifiers
    - A scan of `Wording.swift` that fails on Attach, Apply, Preview, or Hardware Done outside the one negating honesty statement
    - _Requirements: 1.3, 1.4, 1.5, 2.2, 2.3, 2.6, 3.2, 15.2_

- [x] 5. Capture model, proximity, and placing points
  - [x] 5.1 Implement the Capture data model
    - `Capture/Capture.swift`: `Capture`, `CapturePoint`, `CaptureString`, `CaptureRun`, and `PropKindChoice`
    - `Capture/CaptureDocument.swift`: `CaptureDocument` with `version`, `draftId`, `capture`, `ids`, `lostAnchorIds` (encoded as a sorted array), `propId`, `flat`, `spiral`, `depthMode`, and `editedAtMs`. Add `CaptureDocument.new(draftId:now:)` with one empty active string `s1`, kind `custom`, unit `ft`, no spacing, and an empty label
    - Add `unanchoredPointIds` (live points whose `anchorId` is in `lostAnchorIds`) and `markAnchorsLost(_:)`, which changes only `lostAnchorIds`
    - `Capture/IdAllocator.swift`: `c<n>`, `e<n>`, and `s<n>` allocation that never re-issues a number and skips ids in an `avoiding` set
    - `Spiral/ReferenceScan.swift` and `Spiral/WrapMarks.swift`: the data types `ScanCylinder`, `RadiusBand`, `ScanSource`, `CircumferenceValue`, `ReferenceScan`, `ScanHeight`, and `WrapMark` only, so `SpiralState` compiles. The fitting and placement logic comes in section 10
    - All optionals use `encodeIfPresent`
    - _Requirements: 3.7, 3.9, 4.1, 5.1, 6.10, 7.3, 7.4, 13.3_

  - [x] 5.2 Implement the proximity search
    - `Capture/Proximity.swift`: `Proximity.nearest(to:in:within:)` returns the nearest point id within 0.03 m and the ids of the strings it already belongs to, or nil
    - _Requirements: 5.3_

  - [x] 5.3 Implement the edit types and the append edits
    - `Capture/CaptureEdit.swift`: `CaptureEdit` (all cases from the design) and `EditRefusal`
    - `Capture/CaptureEditor.swift`: `EditResult` and `CaptureEditor.apply(_:to:activeStringId:newAnchorId:)` for `placePoint`, `reusePoint`, `closeLoop`, `addString`, and `removeString`. Other cases return `unknownTarget` until section 6
    - Place on an empty string makes the wire-in with no run. Place or reuse on a non-empty string appends one run, `wire` with Dark Jump and `lit` without
    - `reusePoint` of the active string's last point is refused with `sameAsLastPoint`
    - Close Loop appends the first point id. Add `closeLoopEnabled(document:activeStringId:hit:)` (3 or more points, hit within 0.03 m of the first point) and `darkJumpEnabled(document:activeStringId:)` (active string has points)
    - Add String allocates `s<n>`, refuses at 16 strings with `stringLimitReached`, and picks the lowest palette index not used by a live string
    - Remove String removes its runs and any points no other string uses, and retires all their ids
    - A refusal returns the document unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.10, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 5.4 Write capture generators
    - `Generators/CaptureGen.swift`: `Gen.appendSequence` (place, reuse, close loop, and add string over a new document, weighted toward place and reuse), `Gen.lostSubset(of:)`, and `Gen.labelText` (ASCII, padded, emoji, and combining marks around 64 UTF-16 units)

  - [ ]* 5.5 Write property test for lost anchors
    - **Property 3: Losing anchors marks exactly those points and changes nothing else**
    - **Validates: Requirements 3.7, 3.9**

  - [ ]* 5.6 Write property test for the reuse offer
    - Compare against a brute-force scan
    - **Property 7: The reuse offer is the nearest point within 0.03 m**
    - **Validates: Requirements 5.3**

  - [ ]* 5.7 Write property test for appending points
    - **Property 4: Appending points affects only the active string**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 5.4, 5.5, 5.6, 5.8, 5.10**

  - [ ]* 5.8 Write property test for Close Loop
    - **Property 5: Close Loop enablement and effect**
    - **Validates: Requirements 4.9, 4.10**

- [x] 6. Structural and settings edits
  - [x] 6.1 Implement Move, Delete, Insert Point, run kind, hidden count, and anchor updates
    - In `Capture/CaptureEditor.swift`:
    - `movePoint`: sets position, surface kind, and uncertainty from the hit and issues a new `anchorId`. The id and string memberships do not change
    - `deletePoint`: the design's delete algorithm. Join runs around a middle occurrence, keeping the earlier run's id and kind and summing hidden counts when both are hidden. Drop the one adjacent run at either end. Remove self-joining runs. Retire the point id and every dropped run id
    - `insertPoint`: split one run on one string into two runs of the original kind and retire the original id. A hidden original gives the first piece its count and the second piece 0
    - `setRunKind`: `hidden` sets the count to 0, and `lit` or `wire` drops the count
    - `setHiddenCount`: accepts `^\d+$` from 0 to 10,000, otherwise `hiddenCountOutOfRange`
    - `CaptureEditor.anchorMoved(_:anchorId:position:)` updates a position without an undo step
    - _Requirements: 3.7, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 15.6_

  - [x] 6.2 Implement the settings edits
    - In `Capture/CaptureEditor.swift`: `setKind`, `setLabel` (stores the text trimmed of `.whitespacesAndNewlines`), and `setUnit` (changes only `unit`)
    - `setTypedSpacing`: accepts only text that `LayoutMath.parsePitchCm` parses, otherwise `spacingInvalid` with the old spacing kept
    - `attachProduct`: sets `ledProductId`. With `pitchMm`, spacing becomes `pitchMm / 1000`. Without it, spacing is unchanged and the result carries a `productHasNoSpacing` notice while the attach is still recorded
    - `detachProduct`: clears `ledProductId` and keeps the spacing
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.8, 7.9, 7.10, 7.11_

  - [ ]* 6.3 Extend the capture generators with every edit
    - In `Generators/CaptureGen.swift`: `Gen.edit(for:)` valid for the current document (all `CaptureEdit` cases, including invalid hidden-count and spacing text), `Gen.editSequence(1...100)`, and `Gen.validCapture` (trimmed label of 1 to 64 UTF-16 units, a spacing, at least one run, no lost anchors, horizontal spread of at least 0.05 m), with near-planar and exact-planar options built on `GeometryGen`

  - [ ]* 6.4 Write property test for Move
    - **Property 9: Move changes only the moved point's measurement**
    - **Validates: Requirements 6.5, 15.6**

  - [ ]* 6.5 Write property test for Delete
    - **Property 10: Delete removes the point everywhere and joins runs correctly**
    - **Validates: Requirements 6.6**

  - [ ]* 6.6 Write property test for Insert Point
    - **Property 11: Insert Point splits one run on one string**
    - **Validates: Requirements 6.7**

  - [ ]* 6.7 Write property test for run kind and hidden count
    - **Property 12: Run kind and hidden count input**
    - **Validates: Requirements 6.8, 6.9**

  - [ ]* 6.8 Write property test for spacing input
    - **Property 15: Spacing input follows parsePitchCm and product pitch**
    - **Validates: Requirements 7.8, 7.9, 7.10, 7.11**

- [x] 7. Undo history
  - [x] 7.1 Implement `UndoHistory`
    - `Capture/UndoHistory.swift`: whole-`Capture` snapshots, limit 100 (the oldest past entry is dropped on the 101st record), `record(before:)` clears the future, and `undo(current:)`, `redo(current:)`, `canUndo`, and `canRedo`
    - Only `capture` is snapshotted. `ids`, `lostAnchorIds`, `propId`, `flat`, and `spiral` are outside the history
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.10, 6.11, 6.12_

  - [ ]* 7.2 Write property test for the undo round trip
    - **Property 8: Undo and Redo round trip**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.12**

  - [ ]* 7.3 Write property test for Capture invariants
    - Check invariants I1 to I6 after random edit sequences that include refused edits and interleaved Undo and Redo
    - **Property 6: Edit sequences preserve the Capture invariants**
    - **Validates: Requirements 4.7, 5.1, 5.2, 5.9, 6.10, 10.12**

  - [ ]* 7.4 Write example tests for the editor and history
    - New Capture defaults, the 101st edit dropping only the oldest entry, Undo and Redo disabled when empty, the 16-string refusal, the same-as-last-point refusal, and that Undo never re-issues an id
    - _Requirements: 4.1, 5.2, 5.6, 6.3, 6.10, 6.11, 7.3, 7.4_

- [x] 8. Checkpoint - core model
  - Run the Swift test command on an iOS Simulator destination and `corepack pnpm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Export gate, trace export, and counting
  - [x] 9.1 Implement the export gate
    - `Export/ExportGate.swift`: `ExportBlock`, `UnanchoredEntry`, `LowConfidenceEntry`, `ExportCheck`, `ExportPath`, `ExportGate.check(_:path:)`, and `ExportGate.lowConfidence(_:)`
    - Label length in UTF-16 units (`labelRequired` for 0, `labelTooLong` above 64). `noSpacing`. `noRuns` on the trace path. `noFrontPlane` on the trace path when not Flat and `PlaneFit.vertical` fails. `spiralNeedsTwoMarks` on spiral paths below 2 marks. `unanchored` with one entry per string occurrence
    - All blockers are returned together. When there are none and the trace path is not Flat, return `warnNotFlat(n)` with `n = offPlaneCount(limitM: 0.5)` if n > 0
    - The low-confidence list has one entry per string occurrence of each point above 0.05 m and never blocks
    - _Requirements: 7.2, 8.12, 8.14, 8.15, 10.11, 15.5, 15.6, 15.7_

  - [x] 9.2 Implement the trace exporter and the save request
    - `Export/LayoutExporter.swift`: `ExportResult`, `PropSaveRequest` (encodes `ledProductId` as JSON `null` when absent), `LayoutExporter.wrapDifferenceM = 1e-9`, and `LayoutExporter.export(_:path:)` for `.trace`. Spiral paths return `layoutInvalid` until task 10.10
    - One corner per point in creation order, coordinates from `frame.project` with no rounding. One `LayoutString` per non-empty Capture_String with `startId` = wire-in. One edge per run with id, `from`, `to`, kind, and `hiddenCount` on hidden edges
    - `wrapLengthM` = 3D length on every lit edge where `|len3D − drawnLengthM| > 1e−9`, using the port on the corners as written. Never on wire or hidden edges
    - `source = trace`, `units`, `pitchM`, `startOffsetM = 0`, `run = strings[0].run`, and `retiredIds` (omitted when empty)
    - Run `LayoutValidation` and the finite check. On failure return `.layoutInvalid` and build no request
    - Build the request: label, kind, unit, `pitchMm = spacingM × 1000`, `ledProductId`, layout, and `Measurements.custom`
    - _Requirements: 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.16, 12.1, 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 9.3 Implement the capture counter
    - `Export/CaptureCounter.swift`: `Measured<T>`, `CaptureCounts`, and `CaptureCounter.counts(_:)`
    - Run length is the 3D straight-line length. A run touching an unanchored point has unknown length and count, and so do its string's totals and the overall total
    - With no spacing every light count is `.unknown`
    - With spacing, run `LayoutMath.countLayout` on the exporter's layout. When no front plane exists yet, use the provisional layout (placeholder corners, `wrapLengthM` = 3D length on every lit run)
    - _Requirements: 4.8, 7.12, 7.13, 15.4_

  - [ ]* 9.4 Write property test for label checks
    - **Property 13: Labels are stored trimmed and checked in UTF-16 units**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 9.5 Write property test for the not-flat warning
    - Compare against a brute-force off-plane count
    - **Property 25: The not-flat warning counts off-plane points**
    - **Validates: Requirements 8.12**

  - [ ]* 9.6 Write property test for the export gate
    - **Property 26: The export gate reports exactly the blockers that apply**
    - **Validates: Requirements 8.14, 8.15, 10.11, 15.5, 15.6, 15.7**

  - [ ]* 9.7 Write property test for the exported structure
    - **Property 19: Exported structure matches the Capture**
    - **Validates: Requirements 8.5, 8.6, 8.8, 8.11**

  - [ ]* 9.8 Write property test for `wrapLengthM`
    - Include exact-planar Captures so the no-`wrapLengthM` branch runs
    - **Property 20: wrapLengthM is set exactly on lit runs that differ from the drawing**
    - **Validates: Requirements 8.7, 14.3**

  - [ ]* 9.9 Write property test for length preservation
    - **Property 21: Total lit length is preserved**
    - **Validates: Requirements 8.10**

  - [ ]* 9.10 Write property test for clean layout JSON
    - Include a hand-built layout with a non-finite number and assert encoding fails and no request is built
    - **Property 22: Exported layout JSON is valid and clean**
    - **Validates: Requirements 8.9, 8.16, 14.1, 14.2, 14.4, 14.5**

  - [ ]* 9.11 Write property test for light counts
    - **Property 16: Light counts are unknown when unmeasurable, else match countLayout**
    - **Validates: Requirements 7.12, 7.13, 15.4**

  - [ ]* 9.12 Write property test for unit changes
    - **Property 14: Changing the unit changes only the unit**
    - **Validates: Requirements 7.4, 7.5**

- [x] 10. Reference scan, wrap marks, and spiral export
  - [x] 10.1 Implement the reference scan fits
    - `Spiral/ReferenceScanFit.swift`: `ScanFailure` and `ReferenceScanFit.lidar(vertices:cylinder:)` (fail below 100 vertices, Kåsa axis fit, 0.05 m bands, `emptyBand`, RMS, low confidence above 0.05 m), `planesHeight` (`edgesTooClose` below 0.02 m, `pointsInLine` within 0.01 m, otherwise circumcircle), `planes`, `typed`, and `applyTyped` (parsed with `parseLength` in the Capture's unit, accepted from 0.1 m to 30 m, otherwise `outOfRange(minText:maxText:)` with the scan unchanged)
    - In `Spiral/ReferenceScan.swift`: `radius(atHeight:)`. For lidar, interpolate between band centres, then scale linearly in height so typed ends match exactly. For planes and typed-only, interpolate linearly. Return nil outside [0, heightM]. Validate cylinder ranges (radius 0.05 to 3 m, height 0.2 to 10 m)
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.8_

  - [ ]* 10.2 Write spiral generators
    - `Generators/SpiralGen.swift`: `Gen.referenceScan` (axis, height 0.2 to 10 m, linear or wavy radius profile 0.05 to 3 m, optional typed end), `Gen.meshSamples(for:)` (front arc of 90° to 200°, up to 5 mm noise, plus empty-band and fewer-than-100 variants), and `Gen.wrapMarkHeights` (2 to 40 heights at least 0.01 m apart, plus an equal-gap variant)

  - [ ]* 10.3 Write property test for the three-point circle fit
    - **Property 27: Three-point circle fit**
    - **Validates: Requirements 9.2, 9.8**

  - [ ]* 10.4 Write property test for the LiDAR fit
    - **Property 28: The LiDAR fit recovers a scanned object**
    - **Validates: Requirements 9.1, 9.4, 9.6**

  - [ ]* 10.5 Write property test for typed circumferences
    - **Property 29: Typed circumference range and effect**
    - **Validates: Requirements 9.5**

  - [x] 10.6 Implement the surface intersection and wrap marks
    - In `Geometry/RayProfile.swift`: `intersect(ray:scan:maxDistanceM:)` marching in 5 mm steps out to 15 m, then bisecting to 1 mm
    - In `Spiral/WrapMarks.swift`: `WrapMarkRefusal` and `WrapMarks.place` (`outsideObject` for a miss or a hit outside [0, heightM], `tooCloseTo(number)` within 0.01 m, marks kept sorted by height), `delete`, and `numbered` (1 = lowest)
    - Mark ids come from the point allocator. Deleted ids go into `spiral.retiredIds` and are never re-issued
    - _Requirements: 10.1, 10.2, 10.3, 10.10, 10.12_

  - [ ]* 10.7 Write property test for wrap marks
    - **Property 30: Wrap marks sit on the surface, in order, and at least 0.01 m apart**
    - **Validates: Requirements 10.2, 10.3, 10.10, 10.12**

  - [x] 10.8 Implement the spiral analyzer
    - `Spiral/SpiralAnalyzer.swift`: `SpiralReport` and `SpiralAnalyzer.report(scan:marks:)` (nil below 2 marks): height, bottom and top circumference at the lowest and highest mark heights, gaps bottom up, mean gap `heightM / Double(count − 1)`, and the uneven flag when the largest gap exceeds 1.5 × mean, naming the two marks around it
    - `meanGapMeasurements(_:unit:)` converts to the Capture's unit (metres ÷ 0.3048 for `ft`)
    - _Requirements: 10.4, 10.5, 10.9_

  - [ ]* 10.9 Write property test for the spiral report
    - **Property 31: Spiral report formulas**
    - **Validates: Requirements 10.4, 10.5, 10.9**

  - [x] 10.10 Implement the spiral export paths
    - `Spiral/MeasuredWraps.swift`: build the Keep Measured Wraps layout. For each gap, a front edge and a back edge (`Wrap k front`, `Wrap k back`) with `wrapLengthM` from `spiralLengthM` over [0, 0.5] and [0.5, 1] of a one-turn `SpiralInput` using the radii at the gap's two marks. Corners at (W − r_a, h_k − h₁), (W + r_mid, mid − h₁), and (W − r_b, h_{k+1} − h₁), shared between gaps. One string `s1`, ids `c1…` and `e1…`, `source = trace`
    - In `Export/LayoutExporter.swift`: `.spiralMeanGap` builds kind `spiral`, the mean-gap measurements, and the layout from `SpiralTemplate.spiralLayout` with those measurements. `.spiralMeasured` uses `MeasuredWraps` with the mean-gap measurements. Both run validation and the finite check
    - _Requirements: 10.6, 10.7, 10.8, 10.11, 14.5_

  - [ ]* 10.11 Write property test for mean-gap export
    - **Property 32: Mean-gap spiral export**
    - **Validates: Requirements 10.6**

  - [ ]* 10.12 Write property test for Keep Measured Wraps
    - **Property 33: Keep Measured Wraps structure and length**
    - **Validates: Requirements 10.7, 10.8**

  - [ ]* 10.13 Write property test for the layout JSON round trip
    - Cover trace, mean-gap spiral, and measured-wraps layouts
    - **Property 23: Layout JSON round trip**
    - **Validates: Requirements 14.8**

- [x] 11. Drafts
  - [x] 11.1 Implement the draft codec
    - `Drafts/DraftCodec.swift`: `currentVersion = 1`, `encode` with sorted keys and finite numbers only, and `decode` returning `malformed`, `missingVersion`, or `versionTooNew(n)`
    - _Requirements: 13.3, 13.4, 13.5_

  - [x] 11.2 Implement the draft store
    - `Drafts/DraftFileSystem.swift`: the `DraftFileSystem` protocol and a `FileManager` implementation over `Application Support/Drafts/` that writes with `Data.write(options: .atomic)`
    - `Drafts/DraftStore.swift`: actor with `list()` (readable entries newest first by `editedAtMs`, every other file as `unreadable(fileName)`), `load`, `save` (returns `DraftSaveError`, leaves the last good file in place on failure), and `delete` (removes `<draftId>.json` and `<draftId>.worldmap` only)
    - Unreadable files are never rewritten or deleted automatically
    - _Requirements: 13.1, 13.2, 13.6, 13.7, 13.9_

  - [ ]* 11.3 Write property test for the draft round trip
    - Include absent `propId`, `ledProductId`, spacing, reference scan, and depth mode
    - **Property 42: Draft round trip with absent fields omitted**
    - **Validates: Requirements 3.6, 13.3, 13.4, 13.5, 13.8**

  - [ ]* 11.4 Write property test for draft listing
    - Create `Fakes/InMemoryDraftFileSystem.swift` with an optional write failure
    - **Property 43: Draft listing**
    - **Validates: Requirements 13.2, 13.6**

  - [ ]* 11.5 Write example tests for the draft store
    - A failed write returns `DraftSaveError` and keeps the previous bytes. Delete removes the `.json` and `.worldmap` files. An unreadable file's bytes are unchanged after `list` and `load`
    - _Requirements: 13.6, 13.7, 13.9_

- [x] 12. Server address, client, and save flow
  - [x] 12.1 Implement server address validation and routes
    - `Net/ServerAddress.swift`: `ServerAddress`, `AddressError`, and `ServerAddressInput.validate(host:portText:)` (trimmed host 1 to 253 characters, port `^\d+$` from 1 to 65535, then `LanAddress.isAllowed`) with `defaultPort = 43181`. Bracket IPv6 literals when building a URL
    - `Net/ServerRoute.swift`: `ServerRoute` (`health`, `ledProducts`, `props`, `prop(id:)`) with method and path, percent-encoding the id as one path segment. Make it the only way to build a request URL
    - _Requirements: 11.1, 11.2, 11.3, 12.10_

  - [x] 12.2 Implement the HTTP transport
    - `Net/HTTPTransport.swift`: `HTTPRequest`, `HTTPResponse`, `TransportError`, and the `HTTPTransport` protocol
    - `Net/URLSessionTransport.swift`: an ephemeral `URLSession` with no cookies or cache. Set `timeoutInterval` and race the request against `Task.sleep(for: timeout)`. Map `URLError.timedOut` to `timedOut` and connection, ATS, and local-network failures to `cannotConnect`
    - _Requirements: 11.7, 12.9, 12.12_

  - [ ]* 12.3 Write network generators and fakes
    - `Generators/NetGen.swift`: `Gen.hostText`, `Gen.portText`, `Gen.transportOutcome`, and `Gen.remotePropsList` (props built from `LayoutGen` layouts with random corruption on a subset)
    - `Fakes/RecordingTransport.swift` (scripted responses, records requests in order, optional delay) and `Fakes/EffectLog.swift`

  - [ ]* 12.4 Write property test for address validation
    - **Property 34: Server address validation**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [x] 12.5 Implement the server client
    - `Net/ServerClient.swift`: `HealthResult`, `UnreachableReason`, `ProductsResult`, `SaveOutcome`, `ReadbackPart`, `ReadbackResult`, `RemotePropError`, and `ServerClient`
    - `health()` (5 s): reachable only for HTTP 200 with `service == "nightplot-configure"`, else `cannotConnect`, `timedOut`, `status(code)`, or `wrongService`
    - `ledProducts()` (5 s): products or `unavailable`
    - `create` (10 s, POST with all seven fields) and `update(id:)` (10 s, PATCH with `label`, `kind`, `layout`, and `measurements` only), mapped to `created`, `createdWithoutId`, `updated`, `goneFromYard` (PATCH 404), `rejected(status:message:)`, or `didNotReach`
    - `readback(id:expected:)` (10 s): find the prop, then compare the label, the set of string ids (with `layoutStrings` fallback), and the set of edge ids, reporting the first failing part. Network errors, timeouts, and non-2xx give `failed`
    - `props()`: lenient per-prop decoding
    - _Requirements: 7.6, 7.7, 11.5, 11.6, 11.7, 12.1, 12.3, 12.4, 12.5, 12.6, 12.8, 12.9, 12.12, 14.6, 14.7_

  - [ ]* 12.6 Write property test for health classification
    - **Property 35: Health classification**
    - **Validates: Requirements 11.5, 11.7**

  - [ ]* 12.7 Write property test for the save request shape
    - **Property 36: Save request shape**
    - **Validates: Requirements 12.1, 12.3**

  - [ ]* 12.8 Write property test for the readback comparison
    - **Property 38: Readback comparison**
    - **Validates: Requirements 12.5, 12.6**

  - [ ]* 12.9 Write property test for rejected saves
    - **Property 39: Rejected saves keep the draft and show the server text**
    - **Validates: Requirements 12.8**

  - [ ]* 12.10 Write property test for allowed routes
    - Use arbitrary Prop ids including `/`, `..`, `?`, `#`, and spaces
    - **Property 40: Only allowed routes are requested**
    - **Validates: Requirements 12.10**

  - [x] 12.11 Implement the save flow
    - `Net/SaveFlow.swift`: `SaveState` and the `SaveFlow` actor with `save(_:storedPropId:)`, `retryReadback(propId:expected:)`, `saveAsNew(_:)`, and `inFlight`
    - A call while in flight returns the current state and sends nothing
    - After POST success with an id, call `persistPropId` before the readback. If it returns false, still read back and flag that the id is not saved on this phone
    - PATCH 404 gives `goneFromYard`. `saveAsNew` clears the id and POSTs. `retryReadback` sends only `GET /api/props`
    - Result text comes from `Wording` (server `message` or `HTTP <status>` for rejections)
    - _Requirements: 12.2, 12.4, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12_

  - [ ]* 12.12 Write property test for persist-before-readback order
    - **Property 37: The Prop id is stored before the readback**
    - **Validates: Requirements 12.2**

  - [ ]* 12.13 Write property test for repeated save taps
    - **Property 41: Repeated save taps create at most one Prop**
    - **Validates: Requirements 12.11**

  - [ ]* 12.14 Write example tests for the client and save flow
    - Gone-from-yard then save as new (one PATCH, then one POST). Cancel keeps the id. Retry readback sends no POST or PATCH. `createdWithoutId` gives not confirmed. A failed `persistPropId` adds the note. `URLSessionTransport`'s timeout race with a 50 ms budget against a server that never answers
    - _Requirements: 12.2, 12.4, 12.6, 12.9, 12.12_

- [x] 13. Checkpoint - NightplotCore complete
  - Run the Swift test command on an iOS Simulator destination. Ensure all tests pass, ask the user if questions arise.

- [x] 14. Server lights store and fixture acceptance
  - [x] 14.1 Extract the `LightsStore` interface and `TextLightsStore`
    - In `apps/server/src/store/lights-store.ts`: add `LightsStoreShape` and the `LightsStore` interface (`path: string | undefined` plus every current public method of `FileLightsStore`)
    - Add the abstract `TextLightsStore` with `readText`, `writeText`, and `location`. Move today's private `read`, `readForWrite`, and `write` logic into it unchanged, calling `readText` and `writeText` in place of the file calls
    - Make `FileLightsStore extends TextLightsStore`, with `path` narrowed to `string`, ENOENT read as `null`, and the existing `mkdirSync`, `keepLastGood`, temp file, and `renameSync` steps in `writeText`
    - `StoreUnreadableError` takes `location` where it took `filePath`
    - Existing `FileLightsStore` tests pass with no edit
    - _Requirements: 14.10_

  - [x] 14.2 Implement `InMemoryLightsStore`
    - `apps/server/src/store/in-memory-lights-store.ts`: `path = undefined`, holds JSON text, seeds with `JSON.stringify(seed)` with no validation, and `location` is `"memory"`
    - _Requirements: 14.10_

  - [x] 14.3 Use `LightsStore` across the server
    - Replace `FileLightsStore` with `LightsStore` in `AppDeps.store`, `LookRouteDeps.store`, `SyncRouteDeps.store`, `PropSetupDeps.store`, `persistWireframeOnLight`, `renameProp`, and `yardFrom`, and `Pick<FileLightsStore, …>` with `Pick<LightsStore, …>` in `planLedmapsFor` and `stringStartsOnLight`
    - When `store.path` is undefined: `POST /api/backups/:id/restore` and the season restore route return 409 `restore-unsupported` with the design's message before any safety backup or write, and `createApp` puts the yard undo file at `join(tmpdir(), \`nightplot-yard-undo-${randomUUID()}.json\`)`
    - `index.ts` still passes a `FileLightsStore`. Run `corepack pnpm typecheck`
    - _Requirements: 14.10_

  - [x] 14.4 Write the store behaviour suite
    - `apps/server/src/prop-routes.store-parity.test.ts`: `describe.each` over a `FileLightsStore` temp-file factory and an `InMemoryLightsStore` factory, with the same fakes the existing prop tests use
    - Scenarios from the design table: create a traced Prop, label trimmed and cut at 64 UTF-16 units (with an emoji), refused creates change nothing, two creates keep order, update a Prop (id, position, and `design.ledProductId` kept), update an unknown Prop (404), refused update changes nothing, an unreadable row blocks writes (503 `store-unreadable` with the seed unchanged), and an empty store reads as empty
    - An in-memory-only case: both restore routes return 409 `restore-unsupported` and `GET /api/props` is unchanged
    - _Requirements: 14.10, 14.11_

  - [x] 14.5 Write the Swift layout fixtures
    - `nightplotTests/Fixtures/FixtureCaptures.swift`: fixed Captures for `one-string-ft`, `two-strings-shared-m`, `backtrack-wire-hidden-ft`, `closed-loop-retired-m`, `spiral-measured-wraps-m`, and `spiral-mean-gap-ft` as described in the design
    - `nightplotTests/Fixtures/LayoutFixtureTests.swift`: export each Capture and write `{ request, layout, expectedLightTotal, litLengthM }` with sorted keys to `ios/fixtures/prop-layouts/<name>.json` (located through `#filePath`). By default compare bytes with the committed file and fail on any difference. With `NIGHTPLOT_UPDATE_FIXTURES=1`, write the files
    - A coverage test asserts the fixtures together contain every item in Requirement 14.9
    - Generate the files and commit them
    - _Requirements: 14.9_

  - [x] 14.6 Write the server fixture acceptance test
    - `apps/server/src/ios-capture-fixtures.test.ts`: for every file in `ios/fixtures/prop-layouts/`, assert `isPropLayout`, assert `countLayout(layout).total` equals the fixture total and lit `edgeLengthM` matches within 1e−9, check the measured-wraps fixture within 1% of `spiralLengthM` and the mean-gap fixture against `layoutFromMeasurements`, then `POST /api/props` on `createApp` with a new `InMemoryLightsStore` (expect 200 and a `prop.id`) and assert `GET /api/props` returns a layout deep-equal to the fixture's parsed layout
    - _Requirements: 14.9, 14.10_

- [x] 15. Checkpoint - server and fixtures
  - Run `corepack pnpm typecheck`, `corepack pnpm test`, and the Swift test command on an iOS Simulator destination. Ensure all tests pass, ask the user if questions arise.

- [x] 16. App model
  - [x] 16.1 Implement `AppEnvironment` and `AppModel`
    - `nightplot/App/AppEnvironment.swift`: builds the `DraftStore` over the file system implementation, the `URLSessionTransport`, the `UserDefaults` address store (`nightplot.server.host`, `nightplot.server.port`), and an injectable clock
    - `nightplot/App/AppModel.swift`: `@Observable`, main actor. Owns the open `CaptureDocument`, `UndoHistory`, the active string, Dark Jump, the selection, `CaptureCounts`, server status (`notConfigured`, reachable, or unreachable with a reason), LED products, and the export flow state
    - `perform(_:)`: run the editor, record history on success, clear Dark Jump after any append, recompute counts, and save the draft. `undo()` and `redo()` do the same without recording
    - Non-undoable changes (lost anchors, `propId`, `flat`, spiral state, depth mode) save the draft without touching history
    - Coalesce draft saves within 200 ms. On `DraftSaveError`, keep the document, show "This draft was not saved. Your changes are still open.", and retry on the next edit
    - On launch, pre-fill the address fields and call `health()` once if an address is saved. With no saved address, show not configured and send nothing. On a valid address save, store it and call `health()`
    - Export flow: gate check, not-flat warning with Continue and Cancel, export, then `SaveFlow` with `persistPropId` writing the id to the document and draft before the readback
    - Ignore Place Point when `placePointEnabled` is false
    - _Requirements: 3.8, 4.5, 6.1, 6.2, 6.11, 6.12, 7.6, 7.7, 8.12, 8.13, 11.5, 11.6, 11.8, 11.9, 12.2, 12.11, 13.1, 13.9_

  - [ ]* 16.2 Write example tests for `AppModel`
    - A disabled Place Point tap leaves the document unchanged (the second half of Property 1). Saves coalesce and land within 1 s using the injected clock. Launch with a saved address calls `/health` exactly once. No saved address sends zero requests. Deleting a draft sends no request. Undo never rolls back a stored Prop id. A draft write failure keeps the edits in memory
    - _Requirements: 3.8, 11.6, 11.9, 12.2, 13.1, 13.7, 13.9_

- [x] 17. ARKit and RealityKit layer
  - [x] 17.1 Implement camera permission
    - `nightplot/Permissions/CameraPermission.swift`: the `CameraAuthorizing` protocol and an `AVCaptureDevice` implementation, mapped to `CameraAuthStatus`. Drive it with `cameraGate`, re-evaluated on screen appear, after the prompt returns, and on `UIApplication.didBecomeActiveNotification`. "Open Settings" opens `UIApplication.openSettingsURLString`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 17.2 Implement the AR session controller and view
    - `nightplot/AR/ARViewContainer.swift`: RealityKit `ARView` in a `UIViewRepresentable`
    - `nightplot/AR/ARCaptureController.swift`: `start()` uses `chooseARSupport`. `lidar` runs `sceneReconstruction = .mesh`, horizontal and vertical plane detection, and `.sceneDepth` when supported. `planes` runs horizontal and vertical plane detection. Both use `.gravity` alignment. The depth mode is fixed for the session's life
    - As `ARSessionDelegate`: map tracking state to `TrackingStatus` on the main queue, move to `ARStopped(reason)` on failure with a Restart action that reuses the depth mode, and return `true` from `sessionShouldAttemptRelocalization`
    - The controller sends events to `AppModel` and never writes the document directly
    - _Requirements: 1.4, 1.5, 1.6, 1.8, 3.2_

  - [x] 17.3 Implement the reticle raycast loop
    - `nightplot/AR/SurfaceHitReader.swift`: subscribe to scene updates and raycast from the screen centre at 15 Hz while tracking is normal (`.estimatedPlane`, alignment `.any`, preferring existing-plane geometry). Map the target to `mesh`, `plane`, or `estimated` by depth mode. Build `SurfaceHit` with `estimateUncertainty`, camera position, and horizontal heading. Move the reticle entity in the same frame. Report nil when nothing is hit
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_

  - [x] 17.4 Implement anchors, relocalization, and world maps
    - In `ARCaptureController.swift`: wire `SurfaceHitReader`, add one `ARAnchor(name: anchorId)` per placed or moved point, forward anchor updates through `CaptureEditor.anchorMoved`, and after relocalizing compare live anchor names with point `anchorId`s and mark missing ones lost
    - Offer "Reset tracking" after 10 s of incomplete relocalization. It runs `.resetTracking` and `.removeExistingAnchors` and marks every live point's anchor lost
    - Reconcile anchors after Undo and Redo, re-adding missing anchors unless the id is lost
    - `nightplot/AR/WorldMapStore.swift`: save `getCurrentWorldMap` to `<draftId>.worldmap` on backgrounding and on leaving the capture screen, and load it as `initialWorldMap` on resume. With no world map, AR point placement is disabled for that Capture
    - _Requirements: 3.7, 3.9, 4.2, 6.5_

  - [x] 17.5 Implement the scene overlay
    - `nightplot/AR/SceneOverlay.swift`: spheres for points in their string's colour, lit runs as solid cylinders, wire as dashed segments, hidden as translucent grey tubes, low-confidence (amber dot) and unanchored (hollow dashed ring) marks, and SwiftUI overlays positioned with `ARView.project(_:)` for per-string index labels (for example `s1·3  s2·0`) and run lengths formatted with `formatLength`
    - _Requirements: 3.6, 3.9, 4.7, 4.8, 5.9_

  - [x] 17.6 Implement mesh collection for reference scans
    - `nightplot/AR/MeshCollector.swift`: read `ARMeshAnchor` geometry, transform vertices to world space, keep those inside the operator's cylinder, de-duplicate on a 5 mm grid, and pause while tracking is not normal
    - _Requirements: 9.1, 9.7_

- [x] 18. Screens and wiring
  - [x] 18.1 Implement the front view and export screen
    - `nightplot/Screens/FrontViewCanvas.swift`: draws a `PropLayout` front-on with lit solid, wire dashed, and hidden dotted grey edges, and each wire-in marked with a ring and its string id
    - `nightplot/Screens/ExportScreen.swift`: export blocks with each missing item named, the not-flat warning with Continue and Cancel, "Check the drawing" front view, the unanchored list (confirm disabled), the low-confidence list with uncertainty in the Capture's unit, the honesty statement next to "Save to Nightplot", progress, results, gone-from-yard choices, retry readback, unreadable remote props by name, and the note when the attached LED product differs from the one sent at creation
    - All copy comes from `Wording`
    - _Requirements: 7.2, 8.12, 8.13, 8.14, 8.15, 8.16, 12.4, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12, 14.5, 14.7, 15.2, 15.3, 15.5, 15.6, 15.7_

  - [x] 18.2 Implement the drafts and server settings screens
    - `nightplot/Screens/DraftsScreen.swift`: server status chip, one row per draft (label, kind, string count, last edit, newest first), unreadable rows by file name that cannot be opened, delete with a confirmation prompt, New Capture, and the "AR capture is not available on this device." banner
    - `nightplot/Screens/ServerSettingsScreen.swift`: host and port fields pre-filled from the saved address or port 43181, Save, field-specific errors, the last health result, and the Local Network hint on "could not connect"
    - _Requirements: 1.3, 11.1, 11.2, 11.3, 11.5, 11.7, 11.8, 11.9, 13.2, 13.6, 13.7_

  - [x] 18.3 Implement the capture screen and details sheet
    - `nightplot/Screens/CaptureScreen.swift`: the AR view with reticle kind and uncertainty, depth-mode text, tracking message, "No surface under the reticle.", unanchored count, and camera-access message. Controls: Place Point (with the reuse offer "Use point c7 (on s1, s2)?"), Dark Jump, Close Loop, Add String, string picker, Undo, Redo, Details, Reference Scan, Mark Wraps (only with a finished scan), and Export. Point selection offers Move and Delete. Run selection offers Insert Point, kind, and hidden count. Refusals show one-line messages
    - When AR is unavailable, there is no world map, or the camera is denied, show the Capture in `FrontViewCanvas` with Details and Export available
    - `nightplot/Screens/CaptureDetailsSheet.swift`: label, the 8 kinds, unit, Flat toggle, spacing in cm (marked invalid on refusal and shown with `formatPitchCm`), the LED product picker or "LED products are unavailable", "This product gives no spacing.", and counts per run, per string, and in total with unknown shown as unknown
    - _Requirements: 1.3, 1.6, 2.3, 2.4, 2.5, 3.1, 3.2, 3.4, 3.5, 3.9, 4.6, 4.9, 5.2, 5.3, 5.6, 5.7, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 7.1, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9, 7.11, 7.12, 7.13, 8.2, 10.1, 13.8, 15.4_

  - [x] 18.4 Implement the reference scan and wrap mark flows
    - `nightplot/Screens/ReferenceScanFlow.swift`: in `lidar` mode, place and size the cylinder, collect with `MeshCollector`, and fit. In `planes` mode, place six points in order. Show bottom and top circumference, draw the axis and outlines, show failures and the low-confidence notice with Rescan or Type, accept typed circumferences with range errors, and pause on tracking loss
    - `nightplot/Screens/WrapMarkFlow.swift`: place and delete marks with refusal messages, a numbered marks list, gaps, mean, the uneven flag, Accept spiral, and Keep Measured Wraps
    - Present both from `CaptureScreen`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.11, 10.12_

  - [x] 18.5 Wire the root view and scene delegate
    - `nightplot/App/RootView.swift`: navigation between Drafts, Capture, Export, and Server Settings
    - In `SceneDelegate.swift`: build `AppEnvironment` and `AppModel`, host `RootView` in `UIHostingController`, and observe `didBecomeActiveNotification` for the camera gate and world-map save on background
    - Confirm the app builds for an iOS Simulator destination and for `generic/platform=iOS`
    - _Requirements: 1.1, 1.3, 2.6, 11.6_

- [ ] 19. UI tests
  - [ ]* 19.1 Write UI tests for the unsupported-device path
    - In `nightplotUITests`, on the Simulator (no world tracking): the AR-unavailable banner shows, AR actions are disabled, a seeded draft is listed and opens in the front view, the export screen shows the honesty statement, and no save-related control uses Attach, Apply, Preview, or Hardware Done
    - _Requirements: 1.3, 13.2, 13.8, 15.2, 15.3_

- [x] 20. Final checkpoint - Ensure all tests pass
  - Run `corepack pnpm typecheck`, `corepack pnpm test`, and the Swift test command on an iOS Simulator destination. Ensure all tests pass, ask the user if questions arise.

- [x] 21. Server advert
  - [x] 21.1 Implement the advert module
    - `apps/server/src/discovery/advertise.ts`: `NIGHTPLOT_SERVICE_TYPE`, `isLoopbackBind(hostname)` (127.0.0.0/8, `::1`, `localhost`, returning false for `0.0.0.0` and `::`), and `startAdvert({ hostname, port, version }, deps?)` that returns `null` on a loopback bind and otherwise publishes PTR, SRV (with the passed port), TXT (`service=nightplot-configure`, `version`), and A records over `multicast-dns`, filtering interfaces the same way as `discovery/interfaces.ts`. `stop()` sends a goodbye and destroys the responder. Catch and log any responder error so the API keeps serving
    - Wire it in `apps/server/src/index.ts`: call `startAdvert` inside the `serve` listening callback with `info.port`, and call `stop()` on `SIGINT` and `SIGTERM`
    - _Requirements: 11.10, 11.11, 11.12, 11.13_

  - [ ]* 21.2 Write vitest tests for the advert module
    - `apps/server/src/discovery/advertise.test.ts` with a fake responder: loopback bind publishes nothing; a LAN bind answers a PTR query with the passed port and the `service` TXT; `stop()` sends a goodbye; a responder that throws or errors leaves `startAdvert` returning and a `createApp` `/health` still 200
    - _Requirements: 11.10, 11.11, 11.12, 11.13_

  - [x] 21.3 Update CHANGELOG and docs in the same commit
    - Add the `_nightplot._tcp` advert to `CHANGELOG.md` and note in the README and `AGENTS.md` deployment notes that `NIGHTPLOT_API_HOST` must be a LAN bind (not `127.0.0.1`) for the phone to find and reach the server
    - _Requirements: 11.10, 11.11_

- [x] 22. Server discovery decisions in the core
  - [x] 22.1 Implement `ServerDiscovery`
    - `ios/NightplotCore/Sources/NightplotCore/Net/ServerDiscovery.swift`: `AdvertisedServer`, `BrowseOutcome`, the `ServerBrowsing` protocol, `FoundServer`, `FindState`, `browseWindow = .seconds(5)`, `serviceType`, `candidates` (LAN filter via `LanAddress.isAllowed`, port 1 to 65535, dedupe by `host:port`, stable sort, never fills a port), `isUsable` (reachable only), and `autoPick` (the one usable row, else nil)
    - _Requirements: 11.15, 11.16, 11.17, 11.20, 11.21_

  - [ ]* 22.2 Write property test for browse candidates
    - **Property 44: Browse candidates are LAN, deduplicated, and keep their advertised ports**
    - **Validates: Requirements 11.15, 11.16**

  - [ ]* 22.3 Write property test for usability and auto-pick
    - **Property 45: A row is usable only when healthy, and auto-pick needs exactly one**
    - **Validates: Requirements 11.17, 11.20, 11.21**

- [x] 23. App browser, first-launch auto-find, and the Find UI
  - [x] 23.1 Implement the NWBrowser and Info.plist entry
    - `ios/nightplot/nightplot/Net/NWServerBrowser.swift`: `NWServerBrowser: ServerBrowsing` over `NWBrowser` for `_nightplot._tcp` in `local.`, resolving each result to host and advertised port, mapping a policy-denied state to `permissionDenied` and other failures to empty results, stopping at the window end
    - Add `_nightplot._tcp` to `NSBonjourServices` in `Info.plist` (the Local Network usage description already exists)
    - _Requirements: 11.14, 11.15, 11.16, 11.23_

  - [x] 23.2 Wire browse and first-launch auto-find into `AppModel`
    - In `AppModel`: `findServers(auto:)` that browses, filters with `candidates`, probes each with `ServerClient.health()` (5 s each), and sets `FindState`. On `permissionDenied`, set `localNetworkDenied` and save nothing. `launch()` runs `findServers(auto: true)` only when no address is saved; on `autoPick` it saves through the existing save path and shows "Found automatically. You can change it."; otherwise it saves nothing, keeps the resolved rows, and stays not configured. Send `GET /health` only to resolved LAN hosts, never when the browse resolves nothing
    - _Requirements: 11.19, 11.20, 11.21, 11.22, 11.23, 11.25_

  - [x] 23.3 Add the Find control to the server settings screen
    - In `nightplot/Screens/ServerSettingsScreen.swift`: a Find button that lists each resolved row with its name, `host:port`, and health badge. A usable row gets a Use button that saves through the typed-address validation; an unreachable row shows the four-reason copy from Req 11.7 with no Use button. Keep the typed host and port fields and Save unchanged beside Find
    - _Requirements: 11.17, 11.18, 11.24_

  - [ ]* 23.4 Write example tests for the browse flows
    - In `nightplotTests/Examples/`: first launch with one healthy server auto-saves and shows the note; two healthy, one-healthy-one-failing, and none each save nothing and stay not configured; zero results sends zero HTTP requests; `permissionDenied` yields `localNetworkDenied` with nothing saved; a saved address at launch never calls the browser
    - _Requirements: 11.19, 11.20, 11.21, 11.22, 11.23_

- [x] 24. Theme and fonts
  - [x] 24.1 Implement theme tokens and the contrast helper in the core
    - `ios/NightplotCore/Sources/NightplotCore/Display/ThemeTokens.swift`: `ThemeTokens` with the dark and light sets from `apps/web/src/app/globals.css`, the 16-entry `stringPalette`, `Contrast.ratio`/`meetsAA` (WCAG 2.1 relative luminance), and `ThemeUse.textPairs`
    - _Requirements: 16.1, 16.15_

  - [x] 24.2 Implement the app Theme and bundle fonts
    - `ios/nightplot/nightplot/Theme/Theme.swift`: `Theme.colors(for:)` and `Theme.font(_:)` scaled with `UIFontMetrics(relativeTo:)`, falling back to system fonts when a bundled font is missing. Register fonts via `UIAppFonts`. Add IBM Plex Sans, IBM Plex Mono, and Fraunces with their OFL licence files under `nightplot/Resources/Fonts/`. Inject Theme through the SwiftUI environment, set `.tint` and the nav/tab bar appearances, and add a dark-background launch screen colour asset. Read `accessibilityReduceTransparency` for solid surfaces and keep `BeadStyle` free of animation for Reduce Motion
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.16, 16.17, 16.20_

  - [ ]* 24.3 Write example tests for tokens, contrast, and fallback
    - In `nightplotTests/Examples/`: token parity against `globals.css` read by path; `Contrast.ratio` meets 4.5:1 (3:1 for large and glyphs) for every `ThemeUse.textPairs` entry in both sets and every `stringPalette` entry on `rail` and `background`; a missing font name falls back to the matching system font; the chip colour map for the three server states
    - _Requirements: 16.1, 16.5, 16.15, 16.19_

- [x] 25. Beads on the front view and in AR
  - [x] 25.1 Implement bead layout in the core
    - `ios/NightplotCore/Sources/NightplotCore/Display/BeadLayout.swift`: `BeadStatus`, `EdgeBeads`, `BeadLayout.beads(layout:counts:)` (lit known → centres from `CaptureCounter`; lit unknown → `unknown`, no centres; wire → no centres; hidden → `min(count, hiddenBeadDrawCap)` centres), the `canvasBeadCap` fallback to a Rail, and `sceneBeads(runs:cap:)` with `sceneBeadCap = 400` planning bead chains at spacing and tubes for the rest, in string order
    - _Requirements: 16.6, 16.7, 16.8, 16.9, 16.13, 16.14_

  - [ ]* 25.2 Write property test for bead layout
    - **Property 46: Bead layout matches the counts and never invents beads**
    - **Validates: Requirements 16.6, 16.7, 16.8, 16.9**

  - [ ]* 25.3 Write property test for the scene bead cap
    - **Property 47: Scene beads stay under the cap**
    - **Validates: Requirements 16.13, 16.14**

  - [x] 25.4 Render beads and the caption on the front view
    - In `nightplot/Screens/FrontViewCanvas.swift`: draw a Rail per edge then Beads from `BeadLayout.beads`, each bead a filled circle in the string's palette colour with a static glow; hidden beads dim with the count label; unknown lit runs as an unlit dashed Rail with "unknown". Keep the wire-in ring, string and point labels, and dash patterns. Draw unanchored points grey with the unanchored mark, never a string colour. Show the persistent caption "Drawing — not lit"
    - _Requirements: 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.21_

  - [x] 25.5 Render bead chains in the AR overlay
    - In `nightplot/nightplot/AR/SceneOverlay.swift`: draw lit runs with known spacing as emissive sphere chains from `BeadLayout.sceneBeads`, keeping the existing tubes for runs beyond the 400 cap, runs with unknown spacing, and wire and hidden runs. Keep `SceneOverlay` copy free of live or lit wording
    - _Requirements: 16.13, 16.14, 16.21_

- [x] 26. Restyle the screens
  - [x] 26.1 Apply the Theme to every screen
    - Restyle `DraftsScreen` (dark cards, Fraunces title, server chip in the online/quiet/destructive token with text beside the colour), `ServerSettingsScreen`, `CaptureScreen` panels, `CaptureDetailsSheet`, `ExportScreen`, `ReferenceScanFlow`, and `WrapMarkFlow` with Theme surfaces, fonts, and tint. Use mono for lengths, counts, ids, and `host:port`. Keep 44-point targets and existing VoiceOver labels
    - _Requirements: 16.2, 16.17, 16.18, 16.19, 16.20_

  - [ ]* 26.2 Write a UI test for the caption
    - In `nightplotUITests`, on the Simulator: a reopened draft shows "Drawing — not lit" on the front view, and no front-view or AR-view copy says live or lit
    - _Requirements: 16.12, 16.21_

- [-] 27. Final checkpoint - server find and the Nightplot look
  - Run `corepack pnpm typecheck`, `corepack pnpm test`, and the Swift test command on an iOS Simulator destination. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Tasks 14.4, 14.5, and 14.6 are tests but are not optional, because Requirements 14.9 to 14.11 require them.
- Task 1.1 deletes the nested repository's history. It must stop for an explicit operator confirmation after the bundle backup is verified.
- Tasks 21 to 27 add server find (Requirement 11.10 to 11.25) and the Nightplot look (Requirement 16). Task 21.3 lands CHANGELOG and docs in the same commit as the advert code (AGENTS.md). Contrast is checked by number only. Full WCAG validation, the Local Network prompt, a Bonjour browse against a LAN-bound server, and 400-bead AR performance remain manual device checks.
- Each task references requirement clauses for traceability. Each property test names its design property.
- The Simulator has no ARKit world tracking, so a green Simulator run covers only the software path. Device checks on a LiDAR iPhone and a non-LiDAR iPhone remain manual and are not tasks here.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "14.1"] },
    { "id": 1, "tasks": ["1.2", "2.8", "14.2", "14.3"] },
    { "id": 2, "tasks": ["1.3", "14.4"] },
    { "id": 3, "tasks": ["1.4", "2.1", "2.7", "3.1", "4.1", "4.3", "12.2"] },
    { "id": 4, "tasks": ["2.2", "2.4", "2.5", "3.2", "3.3", "3.6", "4.2", "12.1"] },
    { "id": 5, "tasks": ["2.3", "2.6", "3.4", "3.5", "4.4", "4.7", "5.1"] },
    { "id": 6, "tasks": ["2.9", "4.5", "4.6", "5.2", "5.3", "7.1", "11.1", "12.3"] },
    { "id": 7, "tasks": ["5.4", "6.1", "10.1", "11.2", "12.4"] },
    { "id": 8, "tasks": ["5.5", "5.6", "5.7", "5.8", "6.2", "10.2", "10.6", "11.4"] },
    { "id": 9, "tasks": ["6.3", "7.4", "9.1", "10.3", "10.4", "10.5", "10.7", "10.8", "11.5"] },
    { "id": 10, "tasks": ["6.4", "6.5", "6.6", "6.7", "6.8", "7.2", "7.3", "9.2", "9.4", "9.5", "9.6", "10.9", "11.3"] },
    { "id": 11, "tasks": ["9.3", "9.7", "9.8", "9.9", "9.10", "10.10", "12.5"] },
    { "id": 12, "tasks": ["9.11", "9.12", "10.11", "10.12", "10.13", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "14.5"] },
    { "id": 13, "tasks": ["12.12", "12.13", "12.14", "14.6", "16.1"] },
    { "id": 14, "tasks": ["16.2", "17.1", "17.2", "18.1", "18.2"] },
    { "id": 15, "tasks": ["17.3", "17.5", "17.6"] },
    { "id": 16, "tasks": ["17.4"] },
    { "id": 17, "tasks": ["18.3"] },
    { "id": 18, "tasks": ["18.4"] },
    { "id": 19, "tasks": ["18.5"] },
    { "id": 20, "tasks": ["19.1"] },
    { "id": 21, "tasks": ["21.1", "22.1", "24.1"] },
    { "id": 22, "tasks": ["21.2", "21.3", "22.2", "22.3", "24.2", "24.3", "25.1"] },
    { "id": 23, "tasks": ["23.1", "25.2", "25.3", "25.4", "25.5"] },
    { "id": 24, "tasks": ["23.2", "26.1"] },
    { "id": 25, "tasks": ["23.3", "26.2"] },
    { "id": 26, "tasks": ["23.4"] }
  ]
}
```
