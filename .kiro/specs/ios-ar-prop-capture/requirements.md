# Requirements Document

## Introduction

Nightplot Capture is a native iOS app, built in the existing Xcode project at `ios/nightplot`, that measures a real object with ARKit and turns the measurement into a Nightplot **Prop**. The operator walks up to a well, a window, a tree, or any other shape, points the phone at it, and places ordered points along the path a light string takes: the wire-in, then each turn or new section, in the physical pixel order of the string. A second string can be added that starts anywhere, follows its own order, and crosses or shares points with an earlier string. For a wrapped tree or post, the operator scans the object and marks each wrap of the spiral on the way up, so the spacing between wraps is measured instead of guessed.

The app does not invent a parallel model. A capture becomes the existing `PropLayout` from `packages/shared/src/prop/layout.ts`: corners in metres (x along, y up, front-on), one `LayoutString` per physical string, `LayoutEdge` runs of kind `lit`, `wire`, or `hidden`, and `wrapLengthM` where the real run is longer than the front-on drawing. The finished Prop is saved through the existing `POST /api/props` and `PATCH /api/props/:id` routes in `apps/server/src/prop-setup-routes.ts`, then read back with `GET /api/props`.

The app follows the product rules in `AGENTS.md` and `CONSTITUTION.md`. A Prop is a design. Saving a Prop is not Attach, not Apply, and not Hardware Done. The app writes nothing to a WLED controller. Unknown is not empty: a run whose length the app could not measure is reported as unknown, not as zero.

Out of scope for this feature: attaching a Prop to a Light, Apply, Preview, writing a ledmap, placing the Prop on the Yard from AR (the `yard` point), split-tree pose capture, per-light placement (`manualLights`), and any WLED controller discovery or control from the phone. Finding the Nightplot server on the home network is in scope (Requirement 11). These may follow in later slices.

## Glossary

- **Capture_App**: The native iOS application in `ios/nightplot` described by this document.
- **AR_Session**: The Capture_App's ARKit world-tracking session, including scene reconstruction when the device supports it.
- **Tracking_State**: The AR_Session's world-tracking quality as reported by ARKit: `normal`, `limited` (with a reason), or `notAvailable`.
- **Depth_Mode**: How the AR_Session finds surfaces. `lidar` uses the LiDAR scene mesh. `planes` uses detected planes and feature-point raycasts on devices without LiDAR.
- **Surface_Hit**: The result of one raycast from the screen centre reticle into the scene: a 3D world position in metres, the surface kind it hit (mesh, plane, or estimated), and an estimated uncertainty in metres.
- **Capture**: One in-progress or saved measurement of one Prop. A Capture holds Capture_Points, Capture_Strings, an optional Reference_Scan, a Prop kind, a label, a unit, and an LED spacing.
- **Capture_Point**: One 3D world position in a Capture, in metres, with a stable id that is never reused after deletion.
- **Capture_String**: One physical light string in a Capture. An ordered list of Capture_Points starting at the wire-in, where each consecutive pair is a Capture_Run.
- **Capture_Run**: The span between two consecutive Capture_Points on one Capture_String, with a run kind of `lit`, `wire` (dark jump, no lights), or `hidden` (lights consumed but not shown).
- **Shared_Point**: A Capture_Point that appears on more than one Capture_String, or more than once on the same Capture_String (a backtrack). It maps to one `LayoutCorner` used by several `LayoutEdge` runs.
- **Reference_Scan**: A scan of a round object such as a tree, post, or mailbox, from which the Capture_App estimates a vertical axis and the object's radius at each height.
- **Wrap_Mark**: A Capture_Point the operator places on the front of a Reference_Scan object where one wrap of a spiral crosses the front.
- **Spiral_Analyzer**: The Capture_App component that derives spiral measurements (height, around at the bottom, around at the top, gap) and per-wrap gaps from a Reference_Scan and its Wrap_Marks.
- **Projection_Plane**: The vertical plane the Capture_App fits to a Capture's points and uses as the Prop's front-on drawing, with x along the plane, y up, and origin at the first string's wire-in.
- **Layout_Exporter**: The Capture_App component that converts a Capture into a `PropLayout` and a Prop save request.
- **Draft_Store**: The on-device storage that keeps Captures between app launches.
- **Server_Client**: The Capture_App component that talks HTTP to the Nightplot_Server.
- **Nightplot_Server**: The `apps/server` Hono API on the operator's LAN (default port 43181).
- **LED_Product**: An operator LED product row from `GET /api/led-products`, carrying `pitchMm` (centre-to-centre spacing) or a COB section length.
- **LAN_Address**: A host that `decideProbeAddress` in `packages/shared/src/net/address.ts` allows: loopback, private IPv4 ranges, link-local, or a `.local` name. Public internet addresses are not LAN_Addresses.
- **Dark_Jump**: A one-shot toggle on the capture screen, shown as "Dark Jump". While selected, the next Capture_Run created on the active Capture_String gets kind `wire` instead of `lit`.
- **Close_Loop**: The capture-screen action, shown as "Close Loop", that appends the active Capture_String's first Capture_Point to the end of that Capture_String, closing the shape.
- **Flat**: A per-Capture option the operator sets for shapes that lie on the ground, such as a stake row along a path. When set, the Layout_Exporter uses a horizontal Projection_Plane instead of a vertical one.
- **Keep_Measured_Wraps**: The spiral export choice, shown as "Keep Measured Wraps", that builds the `PropLayout` from each measured gap between Wrap_Marks instead of from the mean gap.
- **Server_Advert**: The Bonjour service of type `_nightplot._tcp` that the Nightplot_Server publishes on the LAN. It carries the server's actual listening port and the TXT entry `service=nightplot-configure`.
- **Server_Browser**: The Capture_App component that browses for `_nightplot._tcp` services with Network.framework and resolves each one to a host and the advertised port.
- **Found_Server**: A Server_Advert that the Server_Browser resolved to a LAN_Address, together with the result of its `GET /health` probe.
- **Browse_Window**: The 5-second period during which the Server_Browser collects Server_Adverts. Each resulting `GET /health` probe then has the 5-second limit in criterion 11.7.
- **Theme**: The set of colour tokens and fonts that the Capture_App applies to every screen. It has a dark set and a light set that follow the system appearance.
- **Bead**: One drawn light on the front view or in the AR view: a small glowing dot on a dark rail. A Bead is a drawing. It is never a lit LED.
- **Rail**: The thin dark line a run of Beads sits on.

## Requirements

### Requirement 1: App target and device support

**User Story:** As an operator, I want the capture tool to be a real iOS app in the repo's existing Xcode project, so that I can install it on my phone and keep it in step with the rest of Nightplot.

#### Acceptance Criteria

1. THE Capture_App SHALL build with zero compile errors from the existing `ios/nightplot/nightplot.xcodeproj` project, for both a physical iOS device destination and an iOS Simulator destination, using its `nightplot`, `nightplotTests`, and `nightplotUITests` targets, and SHALL NOT add or require a second Xcode project.
2. THE Capture_App SHALL declare a minimum deployment target of iOS 17.0 on the `nightplot`, `nightplotTests`, and `nightplotUITests` targets.
3. IF the Capture_App launches on a device that does not support ARKit world tracking, THEN THE Capture_App SHALL show a message saying AR capture is unavailable on this device, SHALL disable every action that starts or edits an AR_Session, and SHALL still list every saved Capture in the Draft_Store, open each one for viewing, and allow its export through the Layout_Exporter.
4. IF the Capture_App launches on a device that supports ARKit world tracking and scene reconstruction with LiDAR, THEN THE AR_Session SHALL run in the `lidar` Depth_Mode.
5. IF the Capture_App launches on a device that supports ARKit world tracking without LiDAR scene reconstruction, THEN THE AR_Session SHALL run in the `planes` Depth_Mode with horizontal and vertical plane detection both enabled.
6. WHILE the capture screen is visible, THE Capture_App SHALL show the active Depth_Mode as the text `lidar` or `planes`, and SHALL keep that value the same for the whole life of the AR_Session.
7. THE Capture_App SHALL keep geometry, projection, spiral (Spiral_Analyzer), and export (Layout_Exporter) logic in modules that import neither ARKit nor the camera, and whose unit tests in the `nightplotTests` target build and pass on the iOS Simulator with no AR_Session running.
8. IF the AR_Session fails to start or reports an error after starting, THEN THE Capture_App SHALL show a message that AR capture stopped with the reason, SHALL keep every Capture_Point and Capture_String placed before the failure in the Draft_Store unchanged, and SHALL offer an action to restart the AR_Session.
9. THE repository SHALL track `ios/` as ordinary files in the main repository, with no nested `.git` directory and no submodule under `ios/`.

### Requirement 2: Camera permission

**User Story:** As an operator, I want a clear explanation when the camera is blocked, so that I know how to get capture working.

#### Acceptance Criteria

1. THE Capture_App SHALL include a non-empty `NSCameraUsageDescription` entry stating that the camera is used to measure props in AR.
2. WHEN the operator opens the capture screen and the camera authorization status is not determined, THE Capture_App SHALL request camera access through the iOS system permission prompt exactly once, before it starts the AR_Session.
3. IF the camera authorization status is denied or restricted when the capture screen opens, THEN THE Capture_App SHALL show, on the capture screen, a message stating that capture needs camera access. It SHALL NOT start the AR_Session and SHALL NOT show the iOS system permission prompt again.
4. IF the camera authorization status is denied or restricted, THEN THE Capture_App SHALL show a control on the capture screen that, when tapped, opens the Capture_App's own page in the iOS Settings app.
5. WHILE the camera authorization status is denied or restricted, THE Capture_App SHALL keep every saved Capture in the Draft_Store listable, readable, and exportable through the Layout_Exporter and Server_Client, and SHALL NOT change or delete any saved Capture.
6. WHEN the capture screen is open and the camera authorization status becomes or already is authorized, THE Capture_App SHALL hide the camera-needed message and start the AR_Session without the operator relaunching the app. This covers a grant at the system prompt, opening the screen with access already granted, and returning to the foreground after access was granted in iOS Settings.

### Requirement 3: Tracking and surface hits

**User Story:** As an operator, I want to know when the phone has a good fix on the scene, so that the points I place are where I think they are.

#### Acceptance Criteria

1. WHILE the Tracking_State is `normal` and the most recent reticle raycast returned a Surface_Hit, THE Capture_App SHALL enable the Place Point control.
2. WHILE the Tracking_State is `limited` or `notAvailable`, THE Capture_App SHALL disable the Place Point control and SHALL show, within 0.5 seconds of the Tracking_State change, a one-line message naming the ARKit reason (initializing, excessive motion, insufficient features, or relocalizing) or stating that tracking is not available, using no ARKit enum identifiers.
3. WHILE the Tracking_State is `normal`, THE Capture_App SHALL raycast from the screen-centre reticle at least 10 times per second and SHALL draw a marker at the world position of the most recent Surface_Hit, updated within 100 ms of each raycast result.
4. IF the reticle raycast returns no surface, THEN THE Capture_App SHALL disable the Place Point control, SHALL hide the Surface_Hit marker, and SHALL show a message stating that no surface is under the reticle until a later raycast returns a Surface_Hit.
5. WHILE a Surface_Hit is shown at the reticle, THE Capture_App SHALL show that Surface_Hit's surface kind (mesh, plane, or estimated) and its estimated uncertainty converted to the Capture's unit, with a resolution of at least 0.01 m when the unit is `m` or 0.5 in when the unit is `ft`.
6. IF a Surface_Hit's estimated uncertainty is greater than 0.05 m, THEN THE Capture_App SHALL mark the Surface_Hit as low confidence on the reticle and SHALL keep a low-confidence mark on any Capture_Point placed from that Surface_Hit for as long as that Capture_Point exists, including after the Capture is saved to the Draft_Store and reopened.
7. WHEN the AR_Session relocalizes after an interruption, THE Capture_App SHALL keep each existing Capture_Point whose ARKit anchor relocalized at its anchor's position, and SHALL mark each Capture_Point whose anchor did not relocalize as unanchored while keeping that Capture_Point, its id, its last known position, and its place on every Capture_String.
8. IF the operator taps the Place Point control while it is disabled, THEN THE Capture_App SHALL add no Capture_Point and SHALL leave every existing Capture_String unchanged.
9. WHILE one or more Capture_Points in the open Capture are marked unanchored, THE Capture_App SHALL show the number of unanchored Capture_Points and SHALL show each unanchored Capture_Point with an unanchored mark distinct from the low-confidence mark.

### Requirement 4: Placing points along a string

**User Story:** As an operator, I want to tap the wire-in and then each turn of the string in order, so that the Prop follows the real pixel order.

#### Acceptance Criteria

1. WHEN the operator starts a new Capture, THE Capture_App SHALL create one Capture_String with zero Capture_Points and make that Capture_String active.
2. WHEN the operator presses Place Point while a Surface_Hit is shown at the reticle, THE Capture_App SHALL create one Capture_Point at the Surface_Hit's 3D world position, attach one ARKit anchor to the Capture_Point, and append the Capture_Point to the end of the active Capture_String.
3. WHEN the first Capture_Point is appended to a Capture_String, THE Capture_App SHALL mark that Capture_Point as the Capture_String's wire-in and SHALL create no Capture_Run.
4. WHEN a second or later Capture_Point is appended to a Capture_String while Dark Jump is not selected, THE Capture_App SHALL create one Capture_Run of kind `lit` from the Capture_Point that was the previous end of that Capture_String to the new Capture_Point.
5. WHEN a second or later Capture_Point is appended to a Capture_String while Dark Jump is selected, THE Capture_App SHALL create that Capture_Run with kind `wire` and SHALL then clear the Dark Jump selection, so the following Capture_Run defaults to `lit`.
6. WHILE the active Capture_String has zero Capture_Points, THE Capture_App SHALL disable the Dark Jump control.
7. THE Capture_App SHALL draw every Capture_Point and Capture_Run in the AR view at the Capture_Points' world positions, SHALL draw each Capture_String in a colour different from every other Capture_String in the same Capture, and SHALL label each Capture_Point with its index in string order starting at 0 at the wire-in.
8. THE Capture_App SHALL show the 3D straight-line length between the two Capture_Points of each Capture_Run in the Capture's unit, formatted the same way as `formatLength` in `packages/shared/src/prop/layout.ts` (feet and inches such as `3' 11"`, or metres to two decimals), and SHALL update the shown length within 1 second after either Capture_Point's position changes.
9. WHILE the active Capture_String has 3 or more Capture_Points and the distance between the current Surface_Hit and the active Capture_String's first Capture_Point is 0.03 m or less, THE Capture_App SHALL enable Close Loop.
10. WHEN the operator chooses Close Loop, THE Capture_App SHALL append the active Capture_String's first Capture_Point to the end of that Capture_String, create one Capture_Run from the previous end to that first Capture_Point with kind `wire` if Dark Jump is selected and kind `lit` otherwise, and keep that Capture_String active.

### Requirement 5: Several strings, interleaved and shared points

**User Story:** As an operator, I want to add more strings that weave through or start from an earlier string, so that a well or a window with two strings is captured as it is built.

#### Acceptance Criteria

1. WHEN the operator chooses Add String, THE Capture_App SHALL create a new Capture_String with zero Capture_Points, give the new Capture_String the id `s<n>` where n is one greater than the highest string number ever used in the Capture (so `s1`, `s2`, `s3`, with no id reused after a Capture_String is deleted), and make the new Capture_String the active Capture_String.
2. IF the operator chooses Add String while the Capture already holds 16 Capture_Strings, THEN THE Capture_App SHALL leave the Capture unchanged, keep the current active Capture_String, and show a message indicating that the 16-string limit has been reached.
3. WHEN the operator presses Place Point while the 3D distance between the current Surface_Hit position and one or more existing Capture_Points in the Capture is 0.03 m or less, THE Capture_App SHALL offer to reuse the nearest of those Capture_Points, identified by its id and the Capture_Strings it already belongs to, instead of creating a new Capture_Point.
4. WHEN the operator accepts the offer to reuse an existing Capture_Point, THE Capture_App SHALL append that same Capture_Point id to the end of the active Capture_String without creating a new Capture_Point, so that the Capture_Point becomes a Shared_Point.
5. WHEN the operator declines the offer to reuse an existing Capture_Point, THE Capture_App SHALL create a new Capture_Point with a new id at the current Surface_Hit position and append the new Capture_Point to the end of the active Capture_String.
6. IF the operator accepts the offer to reuse the Capture_Point that is already the last Capture_Point of the active Capture_String, THEN THE Capture_App SHALL leave the Capture_String unchanged and show a message indicating that a Capture_Run needs two different Capture_Points.
7. WHEN the operator selects a Capture_String from the Capture's list of Capture_Strings, THE Capture_App SHALL make that Capture_String the active Capture_String and show which Capture_String is active.
8. THE Capture_App SHALL append Capture_Points placed or reused by Place Point only to the active Capture_String, and SHALL leave the Capture_Point order of every other Capture_String unchanged.
9. THE Capture_App SHALL keep each Capture_String's own Capture_Point order, with each Capture_String's pixel numbering starting at 0 at that Capture_String's first Capture_Point (its wire-in), independent of the numbering of any other Capture_String.
10. THE Capture_App SHALL keep Capture_Runs on different Capture_Strings that cross each other in 3D as separate Capture_Runs, and SHALL create a Shared_Point between Capture_Strings only when the operator accepts an offer to reuse an existing Capture_Point.

### Requirement 6: Editing and undo

**User Story:** As an operator, I want to fix a misplaced point without starting over, so that one bad tap does not cost me the whole capture.

#### Acceptance Criteria

1. WHEN the operator chooses Undo, THE Capture_App SHALL restore the open Capture to its state before the most recent edit, where an edit is any one of: placing a Capture_Point, Move, Delete, Insert Point, changing a Capture_Run's kind, changing a hidden light count, adding or removing a Capture_String, or changing the Capture's Prop kind, label, unit, or LED spacing.
2. WHEN the operator chooses Redo after one or more Undo actions, THE Capture_App SHALL reapply the most recently undone edit, restoring the Capture to its state immediately after that edit.
3. THE Capture_App SHALL keep at least the 100 most recent edits of undo history for the open Capture, and WHEN a 101st edit is made, THE Capture_App SHALL discard only the oldest edit from the undo history.
4. FOR ALL sequences of 1 to 100 edits followed by the same number of Undo actions, THE Capture_App SHALL produce a Capture equal to the Capture before the first edit, including Capture_Point ids, Capture_Run ids, run kinds, hidden light counts, and Capture_String order (undo round-trip property).
5. WHEN the operator selects a Capture_Point, chooses Move, and places a Surface_Hit, THE Capture_App SHALL set the Capture_Point's position to that Surface_Hit's world position, keep the Capture_Point's id, and keep the Capture_Point at the same position in every Capture_String that uses it; IF the operator cancels Move before placing a Surface_Hit, THEN THE Capture_App SHALL leave the Capture unchanged and record no edit.
6. WHEN the operator selects a Capture_Point and chooses Delete, THE Capture_App SHALL remove the Capture_Point from every Capture_String that uses it, retire the Capture_Point's id, and, on each Capture_String where the Capture_Point had a Capture_Run on both sides, replace the two Capture_Runs with one Capture_Run that has the kind of the earlier run and, if both runs are `hidden`, a hidden light count equal to the sum of their counts; where the Capture_Point was the first or last point of a Capture_String, THE Capture_App SHALL remove the one adjacent Capture_Run without joining.
7. WHEN the operator selects a Capture_Run, chooses Insert Point, and places a Surface_Hit, THE Capture_App SHALL add a new Capture_Point at that Surface_Hit's world position between the Capture_Run's two Capture_Points on that Capture_String only, and split the Capture_Run into two Capture_Runs of the original kind, retiring the original Capture_Run's id; IF the original kind is `hidden`, THEN THE Capture_App SHALL give the first new run the original hidden light count and the second new run a hidden light count of 0.
8. WHEN the operator selects a Capture_Run and chooses a run kind, THE Capture_App SHALL set that Capture_Run's kind to `lit`, `wire`, or `hidden`, and WHEN the kind changes to `hidden`, THE Capture_App SHALL set its hidden light count to 0.
9. WHERE a Capture_Run's kind is `hidden`, THE Capture_App SHALL require a whole-number hidden light count from 0 to 10,000 for that Capture_Run; IF the operator enters a value that is negative, not a whole number, empty, or above 10,000, THEN THE Capture_App SHALL reject the value, keep the previous hidden light count, and show an error message indicating the allowed range.
10. THE Capture_App SHALL issue new Capture_Point and Capture_Run ids that are not equal to any id in the Capture's retired id list, and WHEN Undo or Redo restores a Capture_Point or Capture_Run, THE Capture_App SHALL restore it with its original id.
11. IF the open Capture's undo history is empty, THEN THE Capture_App SHALL disable Undo, and IF no undone edit is available to reapply, THEN THE Capture_App SHALL disable Redo.
12. WHEN the operator makes a new edit after one or more Undo actions, THE Capture_App SHALL discard all undone edits so that Redo is disabled.

### Requirement 7: Prop kind, label, unit, and spacing

**User Story:** As an operator, I want to name the prop and pick its LED spacing, so that the light count comes out right when it reaches Nightplot.

#### Acceptance Criteria

1. THE Capture_App SHALL accept a Capture label of 1 to 64 characters after trimming leading and trailing whitespace, and SHALL store the trimmed label.
2. IF the operator starts an export while the Capture's trimmed label is empty or longer than 64 characters, THEN THE Capture_App SHALL block the export, show a message next to the label field saying the label is required or too long, and keep the Capture's points, strings, and settings unchanged.
3. THE Capture_App SHALL let the operator choose exactly one Prop kind from `roofline`, `window`, `arch`, `tree`, `stake-row`, `spiral`, `zigzag`, and `custom`, and SHALL set `custom` as the Prop kind of every new Capture.
4. THE Capture_App SHALL let the operator choose the Capture's unit as `ft` or `m`, SHALL set `ft` as the unit of every new Capture, and SHALL store every Capture_Point position and run length in metres whichever unit is chosen.
5. WHEN the operator changes the Capture's unit, THE Capture_App SHALL change only the displayed lengths, and SHALL leave every stored Capture_Point position, Capture_Run length, spacing value, and light count unchanged.
6. WHEN the Server_Client gets a successful response from `GET /api/led-products` on a reachable Nightplot_Server, THE Capture_App SHALL list every returned LED_Product and let the operator attach at most one LED_Product to the Capture, or detach the attached one.
7. IF `GET /api/led-products` fails, times out, or no Nightplot_Server is reachable, THEN THE Capture_App SHALL show that LED products are unavailable, keep the typed spacing field usable, and keep any LED_Product already attached to the Capture.
8. WHEN the operator attaches an LED_Product that has `pitchMm`, THE Capture_App SHALL set the Capture's spacing to that `pitchMm` converted to metres, replacing any spacing typed earlier, and SHALL show that spacing in the spacing field formatted by `formatPitchCm` in `packages/shared/src/prop/layout.ts`.
9. IF the operator attaches an LED_Product that has no `pitchMm`, THEN THE Capture_App SHALL leave the Capture's spacing unchanged and show that this product gives no spacing.
10. WHEN the operator types a spacing in centimetres, THE Capture_App SHALL accept it only if `parsePitchCm` in `packages/shared/src/prop/layout.ts` returns a value (a plain decimal number with no sign, letters, or unit, greater than 0 and at most 200 after trimming), and SHALL set the Capture's spacing to that value in metres.
11. IF the operator types a spacing that `parsePitchCm` rejects (blank, zero, negative, letters, or more than 200), THEN THE Capture_App SHALL mark the spacing field invalid and keep the Capture's previous spacing, or no spacing if none was set.
12. WHILE a Capture has no LED_Product with `pitchMm` and no accepted typed spacing, THE Capture_App SHALL show the light count of each `lit` Capture_Run, each Capture_String, and the Capture total as unknown, never as 0.
13. WHILE a Capture has a spacing, THE Capture_App SHALL show the light count of each `lit` Capture_Run, of each Capture_String, and of the Capture total using the same rules as `countLayout` in `packages/shared/src/prop/layout.ts`, and SHALL update the shown counts within 1 second of any change to the spacing, a Capture_Point, or a run kind.

### Requirement 8: Projecting the capture onto the Prop drawing

**User Story:** As an operator, I want the 3D points turned into the same front-on drawing the web editor uses, so that the Prop opens and edits normally in Nightplot.

#### Acceptance Criteria

1. WHEN a Capture that the operator has not marked Flat is exported, THE Layout_Exporter SHALL fit a vertical Projection_Plane to the Capture's Capture_Points, using gravity from the AR_Session as the vertical direction. The fit SHALL minimise the sum of squared horizontal perpendicular distances from every Capture_Point to the plane, and each Capture_Point SHALL be projected onto the plane along the plane's normal.
2. WHERE the operator has chosen Flat for the Capture, THE Layout_Exporter SHALL use the horizontal plane through the first Capture_String's wire-in as the Projection_Plane instead of a vertical plane, and SHALL project each Capture_Point onto it along the gravity direction.
3. THE Layout_Exporter SHALL orient a vertical Projection_Plane so that x increases to the operator's right and y increases upward, as seen from the side of the plane where the device was on average while the Capture_Points were placed. For a Flat Projection_Plane, x SHALL increase to the operator's right and y SHALL increase away from the operator, using that same average device position.
4. THE Layout_Exporter SHALL place the Projection_Plane origin at the wire-in of the first Capture_String, so that this wire-in's `LayoutCorner` has x = 0 and y = 0.
5. THE Layout_Exporter SHALL map each Capture_Point to exactly one `LayoutCorner` that keeps the Capture_Point's id and has finite x and y in metres. Each Shared_Point SHALL map to one `LayoutCorner` that every `LayoutEdge` touching the Shared_Point uses.
6. THE Layout_Exporter SHALL map each Capture_String to one `LayoutString` with the same id and a `startId` equal to the wire-in corner. Each `LayoutString` SHALL hold one `LayoutEdge` per Capture_Run, in string order, with the Capture_Run's kind (`lit`, `wire`, or `hidden`), and every `LayoutEdge` id in the layout SHALL be unique.
7. IF a `lit` Capture_Run's measured 3D length differs from its length on the Projection_Plane by more than 1e-9 m, THEN THE Layout_Exporter SHALL set that `LayoutEdge`'s `wrapLengthM` to the 3D length in metres. A `lit` `LayoutEdge` whose difference is 1e-9 m or less SHALL have no `wrapLengthM`.
8. THE Layout_Exporter SHALL set the layout's `source` to `trace`, `units` to the Capture's unit (`ft` or `m`), `pitchM` to the Capture's LED spacing in metres, `startOffsetM` to 0, `run` equal to the first `LayoutString`'s run, and `retiredIds` to the Capture's retired ids.
9. FOR ALL valid Captures, THE Layout_Exporter SHALL produce a `PropLayout` that passes `isPropLayout` in `packages/shared/src/prop/layout.ts`.
10. FOR ALL valid Captures, THE Layout_Exporter SHALL produce a `PropLayout` whose total `lit` length (using `edgeLengthM`) is within 0.01 m of the sum of the Capture's `lit` Capture_Run 3D lengths (length-preserving property).
11. FOR ALL valid Captures, THE Layout_Exporter SHALL produce the same number of `LayoutString`s as Capture_Strings and the same number of `LayoutEdge`s on each `LayoutString` as Capture_Runs on the matching Capture_String (structure invariant).
12. IF the operator requests export of a Capture not marked Flat and any Capture_Point's perpendicular distance from the fitted vertical Projection_Plane exceeds 0.5 m, THEN THE Capture_App SHALL show a warning, before the preview and before any Server_Client request, that states the shape is not flat, gives the number of off-plane Capture_Points, and says that runs off the plane will use their 3D length. The warning SHALL offer Continue, which proceeds to the preview, and Cancel, which returns to the Capture with the Capture unchanged.
13. WHEN the operator requests export and any not-flat warning has been continued, THE Capture_App SHALL show a front-on preview of the projected `PropLayout` that draws every `LayoutCorner`, draws every `LayoutEdge` with `lit`, `wire`, and `hidden` runs visually distinct, and marks each `LayoutString`'s wire-in. THE Capture_App SHALL send no Server_Client save request until the operator confirms the preview.
14. IF a Capture not marked Flat has no two Capture_Points at least 0.05 m apart horizontally, so that a vertical Projection_Plane cannot be fitted, THEN THE Capture_App SHALL block export, show an error saying the points do not define a front-on plane and suggesting Flat or more points, and keep the Capture unchanged in the Draft_Store.
15. IF a Capture has no LED spacing greater than 0, or has no Capture_String with at least one Capture_Run, THEN THE Capture_App SHALL block export and show an error naming the missing item, with the Capture unchanged in the Draft_Store.
16. IF the `PropLayout` produced by the Layout_Exporter fails `isPropLayout`, THEN THE Capture_App SHALL send no Server_Client save request, show an error saying the drawing could not be built, and keep the Capture unchanged in the Draft_Store.

### Requirement 9: Reference scan for round objects

**User Story:** As an operator, I want to scan a tree or post first, so that the app knows its shape when I mark the spiral.

#### Acceptance Criteria

1. WHERE the Depth_Mode is `lidar`, WHEN the operator starts a Reference_Scan, THE Capture_App SHALL collect scene-mesh vertices inside a vertical cylinder that the operator positions over the object, with a cylinder radius from 0.05 m to 3 m and a cylinder height from 0.2 m to 10 m. From those vertices it SHALL fit one vertical axis and one radius for each 0.05 m band of height, from the bottom of the cylinder to the top.
2. WHERE the Depth_Mode is `planes`, WHEN the operator starts a Reference_Scan, THE Capture_App SHALL ask the operator to place six points in order: left edge, right edge, and front of the object at the bottom, then the same three at the top. For each of the two heights, it SHALL estimate the axis position and the radius of the circle through that height's three points.
3. WHEN a Reference_Scan finishes, THE Capture_App SHALL show the estimated circumference at the bottom and at the top, in the Capture's unit, rounded to 0.01 of that unit. It SHALL also draw the fitted axis and the fitted outline at each fitted height in the AR view.
4. WHERE the Depth_Mode is `lidar`, IF the root-mean-square distance between the collected vertices and the fitted surface is above 0.05 m, THEN THE Capture_App SHALL show the fit as low confidence and offer two choices: rescan, or type the circumference at the bottom and at the top.
5. WHEN the operator types a bottom or top circumference from 0.1 m to 30 m (or the same range converted to the Capture's unit), THE Capture_App SHALL replace the scanned value for that height with the typed value, mark that value as typed, and use it for that height in all later Spiral_Analyzer measurements. IF the typed value is outside that range or is not a number, THEN THE Capture_App SHALL reject it, show an error message giving the allowed range, and keep the previous value.
6. WHERE the Depth_Mode is `lidar`, IF a Reference_Scan finishes with fewer than 100 vertices inside the cylinder, or with any 0.05 m height band that holds no vertices, THEN THE Capture_App SHALL save no Reference_Scan for that attempt, show an error message saying the scan had too little surface data, and offer to rescan or type the circumferences.
7. WHILE a Reference_Scan is in progress, IF the Tracking_State is not `normal`, THEN THE Capture_App SHALL pause vertex collection and point placement, show the tracking reason, and resume the scan with the data collected so far once the Tracking_State returns to `normal`.
8. WHERE the Depth_Mode is `planes`, IF the left-edge and right-edge points at one height are less than 0.02 m apart, or the three points at one height lie within 0.01 m of a single straight line, THEN THE Capture_App SHALL reject the three points for that height, keep the points for the other height, and ask the operator to place that height's three points again.

### Requirement 10: Marking spiral wraps

**User Story:** As an operator, I want to tap each wrap of the lights on the way up the tree, so that the real spacing between wraps is measured.

#### Acceptance Criteria

1. WHILE a Capture has a finished Reference_Scan, THE Capture_App SHALL show the Mark Wraps action, and WHILE a Capture has no finished Reference_Scan, THE Capture_App SHALL hide or disable the Mark Wraps action.
2. WHEN the operator places a Wrap_Mark, THE Capture_App SHALL snap the Wrap_Mark to the fitted Reference_Scan surface at the reticle's height and record the Wrap_Mark's height above the bottom of the Reference_Scan, in metres along the Reference_Scan's vertical axis.
3. THE Capture_App SHALL keep Wrap_Marks ordered by height from the bottom and number them from 1 (lowest) upward. IF a new Wrap_Mark would lie within 0.01 m of the height of an existing Wrap_Mark, THEN THE Capture_App SHALL refuse it, leave the existing Wrap_Marks unchanged, and show a message naming the existing mark by its number.
4. WHEN a Capture has 2 or more Wrap_Marks, THE Spiral_Analyzer SHALL report, in the Capture's unit: the height from the lowest to the highest Wrap_Mark; the circumference of the Reference_Scan at the lowest Wrap_Mark's height (bottom) and at the highest Wrap_Mark's height (top); each gap between neighbouring Wrap_Marks; and the mean gap. THE Spiral_Analyzer SHALL recalculate these values each time a Wrap_Mark is added or deleted.
5. IF the largest gap between neighbouring Wrap_Marks is more than 1.5 times the mean gap, THEN THE Spiral_Analyzer SHALL flag the gaps as uneven and name, by number, the two Wrap_Marks on either side of the largest gap. IF the largest gap is 1.5 times the mean gap or less, THEN THE Spiral_Analyzer SHALL show no uneven-gap flag.
6. WHEN the operator accepts the spiral without choosing Keep Measured Wraps, THE Layout_Exporter SHALL build the Prop with kind `spiral` and spiral measurements (`height`, `around`, `aroundTop`, `gap`) in the Capture's unit, set from the Spiral_Analyzer's height, bottom circumference, top circumference, and mean gap.
7. WHEN the Spiral_Analyzer has flagged uneven gaps and the operator chooses Keep Measured Wraps, THE Layout_Exporter SHALL build a `PropLayout` with one front run and one back run for each gap between neighbouring Wrap_Marks. Each run SHALL have a `wrapLengthM` equal to the helix length of that half wrap, computed from that gap and from the Reference_Scan radii at the heights of the two Wrap_Marks that bound the gap.
8. FOR ALL Wrap_Mark sets with equal gaps, THE Layout_Exporter SHALL produce a total `lit` length from Keep Measured Wraps within 1% of `spiralLengthM` in `packages/shared/src/prop/wraps.ts` for the same height, circumferences, and gap (model-based property).
9. FOR ALL Wrap_Mark sets of 2 or more marks, THE Spiral_Analyzer SHALL report a mean gap equal to the height from the lowest to the highest Wrap_Mark divided by the number of gaps, where the number of gaps is the number of Wrap_Marks minus 1 (invariant).
10. IF the reticle's height is below the bottom or above the top of the Reference_Scan, or the reticle does not hit the fitted Reference_Scan surface, THEN THE Capture_App SHALL refuse the Wrap_Mark, leave the existing Wrap_Marks unchanged, and show a message saying the mark is outside the scanned object.
11. IF the operator tries to accept the spiral while the Capture has fewer than 2 Wrap_Marks, THEN THE Capture_App SHALL refuse to build the Prop, leave the Capture unchanged, and show a message saying that at least 2 Wrap_Marks are needed.
12. WHEN the operator deletes a Wrap_Mark, THE Capture_App SHALL remove it from the Capture, renumber the remaining Wrap_Marks from the bottom, and never reuse the deleted Wrap_Mark's Capture_Point id.

### Requirement 11: Connecting to the Nightplot server

**User Story:** As an operator, I want the app to find my Nightplot server on my home network, so that captured props land in the same yard.

#### Acceptance Criteria

1. THE Capture_App SHALL let the operator enter the Nightplot_Server address as a host of 1 to 253 characters and a port that is a whole number from 1 to 65535, with the port field pre-filled with 43181 when no address has been saved.
2. IF the entered host is not a LAN_Address, THEN THE Server_Client SHALL refuse the address before sending any HTTP request, show an error message stating that only addresses on the home network are allowed, and keep the previously saved Nightplot_Server address unchanged.
3. IF the entered host is empty or longer than 253 characters, or the entered port is not a whole number from 1 to 65535, THEN THE Capture_App SHALL refuse to save the address, show an error message naming the invalid field, send no HTTP request, and keep the previously saved Nightplot_Server address unchanged.
4. THE Capture_App SHALL include an `NSLocalNetworkUsageDescription` entry that states the app connects to the operator's Nightplot server on the home network.
5. WHEN the operator saves a Nightplot_Server address that passes criteria 2 and 3, THE Server_Client SHALL call `GET /health` on that address and show the server as reachable only when the response is HTTP 200 with `service` equal to `nightplot-configure`.
6. WHEN the Capture_App launches with a saved Nightplot_Server address, THE Server_Client SHALL call `GET /health` on that address once and show the result using the same reachable and unreachable rules as criteria 5 and 7.
7. IF `GET /health` fails to connect, does not respond within 5 seconds, returns a status other than HTTP 200, or returns a `service` other than `nightplot-configure`, THEN THE Server_Client SHALL show the server as unreachable with a reason naming which of these four cases occurred, and SHALL keep capture, Draft_Store reads, and Draft_Store writes available.
8. WHEN the Capture_App launches, THE Capture_App SHALL pre-fill the host and port fields with the last saved Nightplot_Server address, with the address kept across app launches until the operator saves a different one.
9. IF no Nightplot_Server address has been saved, THEN THE Capture_App SHALL show the server as not configured, as distinct from unreachable, and SHALL send no HTTP request to any host, except the `GET /health` probes of Server_Adverts that criteria 11.17 and 11.19 allow.
10. WHERE the Nightplot_Server is bound to a non-loopback address, THE Nightplot_Server SHALL publish a Server_Advert with its actual listening port and the TXT entries `service=nightplot-configure` and `version=<server version>`.
11. IF the Nightplot_Server is bound only to a loopback address, THEN THE Nightplot_Server SHALL publish no Server_Advert.
12. WHEN the Nightplot_Server shuts down, THE Nightplot_Server SHALL withdraw its Server_Advert.
13. IF publishing the Server_Advert fails, THEN THE Nightplot_Server SHALL log the failure and SHALL continue to serve its API.
14. THE Capture_App SHALL list `_nightplot._tcp` in its `NSBonjourServices` Info.plist entry.
15. WHEN the Server_Browser browses, THE Server_Browser SHALL resolve each Server_Advert to a host and the port the Server_Advert carries, and THE Capture_App SHALL NOT supply a port the Server_Advert did not carry.
16. IF a Server_Advert resolves to a host that is not a LAN_Address, THEN THE Server_Browser SHALL drop that Server_Advert from the results.
17. WHEN the operator chooses Find on the server settings screen, THE Capture_App SHALL browse for the Browse_Window, send `GET /health` to each resolved Server_Advert, and list each one with its name, host:port, and health result. THE Capture_App SHALL offer a row for use only when its `GET /health` returns HTTP 200 with `service` equal to `nightplot-configure`. A row whose probe fails SHALL show as unreachable with the reason from criterion 11.7, and SHALL NOT show as found or reachable.
18. WHEN the operator chooses a found row, THE Capture_App SHALL save that host and port through the same validation as a typed address (criteria 11.2, 11.3, and 11.5).
19. WHEN the Capture_App launches with no saved Nightplot_Server address, THE Capture_App SHALL browse for the Browse_Window without operator action.
20. WHEN exactly one Found_Server returns a reachable `GET /health` result after the automatic browse in criterion 11.19, THE Capture_App SHALL save that Found_Server's address and show the server as reachable with text saying it was found automatically and can be changed.
21. IF the automatic browse ends with zero or more than one reachable Found_Server, THEN THE Capture_App SHALL save no address, SHALL list the Found_Servers that were resolved, and SHALL show the server as not configured, as distinct from unreachable.
22. WHEN no Server_Advert resolves in the automatic browse and no address is saved, THE Capture_App SHALL send no HTTP request, as criterion 11.9 requires.
23. IF the iOS Local Network permission is denied, THEN THE Server_Browser SHALL return no results, THE Capture_App SHALL show the Local Network hint from criterion 11.7, and THE Capture_App SHALL NOT state that no server exists.
24. THE Capture_App SHALL keep the typed host and port entry of criteria 11.1 to 11.3 available and unchanged beside Find.
25. WHILE a Capture_App browse is running, THE Capture_App SHALL keep capture, Draft_Store reads, and Draft_Store writes available.

### Requirement 12: Saving the capture as a Prop

**User Story:** As an operator, I want to send the finished capture to Nightplot as a Prop, so that I can attach and Apply it from the web app later.

#### Acceptance Criteria

1. WHEN the operator exports a Capture that has no stored Prop id, THE Server_Client SHALL send `POST /api/props` with the Capture's `label`, `kind`, `unit`, `pitchMm`, `ledProductId` (or null when no LED_Product is selected), the exported `layout`, and `measurements` (the spiral measurements for a `spiral` Capture, otherwise `{ "shape": "custom" }`).
2. WHEN `POST /api/props` returns a success response containing a `prop` with a non-empty id, THE Capture_App SHALL store that Prop id on the Capture and persist it in the Draft_Store before starting the readback in criterion 5.
3. WHEN the operator exports a Capture that already has a stored Prop id, THE Server_Client SHALL send `PATCH /api/props/:id`, using the stored id, with the Capture's `label`, `kind`, `layout`, and `measurements`.
4. IF `PATCH /api/props/:id` returns 404, THEN THE Capture_App SHALL show that the Prop is no longer in the yard, keep the Capture unchanged as a draft, and offer two choices: save as a new Prop, or cancel. If the operator chooses save as a new Prop, THE Capture_App SHALL clear the stored Prop id and send the request in criterion 1. If the operator cancels, THE Capture_App SHALL keep the stored Prop id unchanged.
5. WHEN a save request returns success, THE Server_Client SHALL call `GET /api/props` and confirm that a Prop with the stored id exists, that its label equals the sent label, and that its layout contains exactly the same set of `LayoutString` ids and exactly the same set of `LayoutEdge` ids as the sent layout, with none missing and none extra.
6. IF the `GET /api/props` readback is missing the Prop, has a different label, or has missing or extra `LayoutString` or `LayoutEdge` ids, or IF a `POST /api/props` success response has no `prop` id, THEN THE Capture_App SHALL show the save as not confirmed, name which part differed (Prop missing, label, string ids, or edge ids), and keep the Capture as a draft.
7. WHEN the readback matches, THE Capture_App SHALL show the server's `message` text and a statement that the Prop is saved in Nightplot, is not attached to a controller, and that nothing was sent to a controller.
8. IF a save request returns HTTP 400, 422, or any other non-success status, THEN THE Capture_App SHALL show the server's `message` text (or the HTTP status when the response has no `message`) and keep the Capture unchanged as a draft, with any stored Prop id unchanged.
9. IF a save request fails on the network or receives no response within 10 seconds, THEN THE Capture_App SHALL show that the save did not reach the server and keep the Capture unchanged as a draft, with any stored Prop id unchanged.
10. THE Capture_App SHALL send requests only to `/health`, `/api/led-products`, and `/api/props` routes on the Nightplot_Server.
11. WHILE a save request or its `GET /api/props` readback is in progress, THE Capture_App SHALL show that the save is in progress and SHALL NOT send another save request for the same Capture, so that repeated export taps create at most one Prop.
12. IF the `GET /api/props` readback fails on the network, receives no response within 10 seconds, or returns a non-success status, THEN THE Capture_App SHALL show the save as not confirmed because the readback could not be completed, keep the stored Prop id and the Capture as a draft, and offer to retry the readback without resending the save request.

### Requirement 13: Drafts on the device

**User Story:** As an operator, I want captures kept on the phone, so that I can capture outside without signal and send them later.

#### Acceptance Criteria

1. WHEN a Capture is edited, THE Draft_Store SHALL save the Capture to the app's local storage within 1 second of the edit. An edit is any change that adds, moves, or deletes a Capture_Point, adds or deletes a Capture_String, changes a run kind, stores a Reference_Scan result or Wrap_Mark, changes the label, kind, unit, spacing, or LED_Product id, or records a stored Prop id. Saving SHALL NOT need a network connection.
2. WHEN the Capture_App launches, THE Draft_Store SHALL list every saved Capture with its label, kind, string count, and the time of its last edit, ordered by last edit time with the most recent first.
3. THE Draft_Store SHALL save each Capture's points, strings, runs, retired ids, Reference_Scan result, Wrap_Marks, label, kind, unit, spacing, LED_Product id, and stored Prop id. A value that was never set, such as a missing LED_Product id or stored Prop id, SHALL be saved as absent, not as zero or an empty string.
4. THE Draft_Store SHALL encode each Capture as versioned JSON with an integer `version` field equal to the encoding version the Capture_App writes.
5. FOR ALL valid Captures, encoding with the Draft_Store and then decoding SHALL produce a Capture equal to the original, including point ids, point order on each Capture_String, run kinds, and retired ids (round-trip property).
6. IF a saved Capture file cannot be decoded, or its `version` is higher than the highest version the Capture_App can read, THEN THE Draft_Store SHALL list the file as unreadable with its file name, prevent it from being opened for editing or export, and keep the file on disk unchanged.
7. WHEN the operator deletes a Capture from the draft list and confirms the deletion in a confirmation prompt, THE Draft_Store SHALL remove the Capture file, remove the Capture from the list, and leave any Prop already saved on the Nightplot_Server unchanged. If the operator cancels the prompt, THE Draft_Store SHALL keep the file and the list entry unchanged.
8. WHEN a saved Capture is reopened after the AR_Session has ended, THE Capture_App SHALL show the same Capture_Points, Capture_Strings, and run kinds as when the Capture was last saved in the front-on preview, and allow label, kind, unit, spacing, run-kind edits, and export.
9. IF saving a Capture to local storage fails, for example because the device is out of space, THEN THE Capture_App SHALL show an error message saying the draft was not saved, keep the Capture's unsaved edits in memory, keep the last successfully saved file on disk unchanged, and try the save again on the next edit.

### Requirement 14: Layout JSON encoding

**User Story:** As a developer, I want the app's `PropLayout` JSON to match what the server accepts, so that a captured Prop is never rejected or quietly altered.

#### Acceptance Criteria

1. WHEN the Layout_Exporter encodes a `PropLayout` to JSON, THE Layout_Exporter SHALL use the field names, value types, and enumerated values (`source`, `units`, and run `kind` of `lit`, `wire`, or `hidden`) defined in `packages/shared/src/prop/layout.ts`, with all lengths and coordinates in metres.
2. WHEN the Layout_Exporter encodes an optional field that has no value, THE Layout_Exporter SHALL omit the field from the JSON instead of writing `null`, an empty string, or `0`.
3. IF a Capture_Run's 3D length was not measured, THEN THE Layout_Exporter SHALL omit `wrapLengthM` for that run's `LayoutEdge` and SHALL NOT write `0` in its place.
4. THE Layout_Exporter SHALL encode every number as a finite JSON number and SHALL NOT write `NaN`, `Infinity`, or `-Infinity` to any field.
5. IF the `PropLayout` produced from a Capture contains a non-finite number or fails the field rules of criteria 1 to 4, THEN THE Capture_App SHALL not send the save request, SHALL show an error message indicating the Prop could not be prepared for saving, and SHALL keep the Capture in the Draft_Store unchanged.
6. WHEN the Server_Client receives a Prop from `GET /api/props`, THE Capture_App SHALL decode its `PropLayout` JSON, including all fields defined in `packages/shared/src/prop/layout.ts`, and SHALL accept and ignore fields it does not recognise.
7. IF a Prop's layout JSON from `GET /api/props` cannot be decoded as a `PropLayout`, THEN THE Capture_App SHALL show that Prop as unreadable with an error message naming the Prop, SHALL continue decoding the remaining Props in the response, and SHALL NOT send a `PATCH /api/props/:id` request for the unreadable Prop.
8. FOR ALL `PropLayout` values produced by the Layout_Exporter, encoding then decoding then encoding SHALL produce JSON whose parsed value equals the first encoding exactly, with every number equal to the same double-precision value and every field present or absent in both (round-trip property).
9. THE Capture_App test suite SHALL include `PropLayout` JSON fixtures produced by the Layout_Exporter that together cover: one Capture_String; two Capture_Strings sharing at least one Shared_Point; a backtrack on one Capture_String; at least one `lit`, one `wire`, and one `hidden` run; at least one run with `wrapLengthM`; at least one run with an unmeasured 3D length; and both `units` values `m` and `ft`.
10. THE repository SHALL add an in-memory implementation of the server's lights store, the store that `createApp` in `apps/server/src/app.ts` receives as `AppDeps.store` (currently implemented only by `FileLightsStore` in `apps/server/src/store/lights-store.ts`), and THE repository test suite SHALL check that each fixture from criterion 9 passes `isPropLayout`, is accepted by `POST /api/props` on an app created with the in-memory lights store, and is returned by `GET /api/props` from that app with a layout whose parsed value equals the fixture's parsed value.
11. THE repository test suite SHALL run the same `POST /api/props`, `PATCH /api/props/:id`, and `GET /api/props` behaviour tests against both the in-memory lights store and `FileLightsStore`, and both stores SHALL pass every one of those tests.

### Requirement 15: Honest wording

**User Story:** As an operator, I want the app to say plainly what it did and did not do, so that I never mistake a saved drawing for lit hardware.

#### Acceptance Criteria

1. THE Capture_App SHALL use the product words Prop, Lights, Segments, Attach, and Apply only with the meanings defined in `AGENTS.md`, and SHALL use "string" for a physical light string.
2. THE Capture_App SHALL NOT use the words Attach, Apply, Preview, or Hardware Done on any control label, status, or confirmation that describes saving a Prop to the Nightplot_Server.
3. WHILE the export screen is displayed, THE Capture_App SHALL show, on the same screen as the export confirm control, a statement that saving a Prop does not attach the Prop to a controller, does not Apply, and does not light anything.
4. WHILE a Capture_Run's length is unknown because one of the Capture_Run's Capture_Points is unanchored, THE Capture_App SHALL show that Capture_Run's length and light count as unknown rather than as zero, and SHALL show the containing Capture_String's total length and total light count as unknown rather than as a sum that omits or zeroes that Capture_Run.
5. IF a Capture contains one or more unanchored Capture_Points, THEN THE Capture_App SHALL disable the export confirm control and list each unanchored Capture_Point by the Capture_String it belongs to and its 0-based index in that Capture_String's order (the same index shown in the AR view, with the wire-in at 0), listing a Shared_Point once for every Capture_String index it occupies.
6. WHEN the operator moves or deletes the last unanchored Capture_Point in a Capture, THE Capture_App SHALL remove the unanchored list and enable the export confirm control, provided no other export requirement blocks export.
7. IF a Capture contains one or more low-confidence Capture_Points (placed from a Surface_Hit whose estimated uncertainty exceeded 0.05 m), THEN THE Capture_App SHALL list each of those Capture_Points on the export screen, before the operator confirms export, by Capture_String, 0-based index in that Capture_String's order (the same index shown in the AR view), and estimated uncertainty in the Capture's unit, and SHALL still allow export.

### Requirement 16: Visual design

**User Story:** As an operator, I want the app to look like Nightplot on the web, so that the phone and the yard tool feel like one product and the lights read clearly outdoors at night.

#### Acceptance Criteria

1. THE Capture_App SHALL apply one Theme to every screen it shows, with the dark colour set as the primary look and the light colour set used when the system appearance is light. The Theme tokens SHALL equal the dark and light tokens in `apps/web/src/app/globals.css`.
2. WHEN the system appearance changes, THE Capture_App SHALL switch between the dark and light Theme sets without a relaunch.
3. THE Capture_App SHALL bundle IBM Plex Sans for body text, IBM Plex Mono for numbers and ids (lengths, counts, string and point ids such as `s1·3`, and host:port), and Fraunces for screen titles, together with each font's OFL licence file.
4. THE Capture_App SHALL scale every Theme font with the operator's Dynamic Type setting.
5. IF a bundled font fails to load, THEN THE Capture_App SHALL use the matching system font for that text role.
6. THE Capture_App SHALL draw each lit run on the front view as Beads on a Rail, spaced by the Capture's spacing, with the number of Beads on each run equal to that run's light count from `CaptureCounter`.
7. IF a lit run's spacing or light count is unknown, THEN THE Capture_App SHALL draw that run as an unlit dashed Rail with the text "unknown" and SHALL draw no Beads on it.
8. THE Capture_App SHALL draw each `wire` run as a thin dark Rail with no Beads.
9. THE Capture_App SHALL draw each `hidden` run as dim grey Beads with a label giving the run's hidden light count.
10. THE Capture_App SHALL draw the Beads of each Capture_String in that Capture_String's colour from the 16-colour string palette, and SHALL keep the wire-in ring, the string and point labels, and the dash patterns so that colour is not the only signal.
11. THE Capture_App SHALL draw each unanchored Capture_Point grey with the unanchored mark, and SHALL NOT draw it in a string colour.
12. WHILE the front view is shown, THE Capture_App SHALL show the caption "Drawing — not lit" on it, and SHALL NOT caption the front view or the AR view as live, lit, or showing hardware.
13. THE Capture_App SHALL draw each lit run in the AR view as a chain of small emissive spheres at the Capture's spacing when the spacing is known, and as the existing solid or dashed tube when the spacing is unknown.
14. WHEN the AR view would draw more than 400 Beads in total, THE Capture_App SHALL draw the runs that do not fit under that limit as tubes.
15. THE Capture_App SHALL use a text and background colour pair on every screen with a contrast ratio of at least 4.5:1 for body text and at least 3:1 for large text and interface glyphs, in both the dark and the light Theme sets.
16. WHILE Reduce Motion is on, THE Capture_App SHALL draw Beads and status indicators without animated glow or pulse.
17. WHILE Reduce Transparency is on, THE Capture_App SHALL draw panels and sheets as solid Theme surfaces instead of translucent materials.
18. THE Capture_App SHALL keep every touch target at 44 points or larger and SHALL keep every existing VoiceOver label unchanged.
19. THE Capture_App SHALL show the server status chip on the drafts screen in the online colour when the server is reachable, in the quiet colour when it is not configured, and in the destructive colour when it is unreachable, with the status text always shown beside the colour.
20. THE Capture_App SHALL apply the Theme to the drafts, server settings, capture, details, export, reference scan, and wrap mark screens, and SHALL set the launch screen background to the dark Theme background.
21. THE Capture_App SHALL NOT use the words Attach, Apply, Preview, or Hardware Done in the caption or labels added by this requirement.
