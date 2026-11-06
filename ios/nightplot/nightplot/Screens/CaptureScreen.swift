import ARKit
import NightplotCore
import SwiftUI

extension Wording {
    nonisolated static let captureNoSurface = "No surface under the reticle."
    nonisolated static let captureCameraNeeded = "Nightplot needs the camera to place points in AR."
    nonisolated static let captureOpenSettings = "Open Settings"
    nonisolated static let captureAROff = "AR capture is not available here. You can view the drawing, edit Details, and export."
    nonisolated static let captureResetTracking = "Reset tracking"
    nonisolated static let captureResetHint =
        "Starts tracking over. Every point stays, but points lose their place until you move or delete them."
    nonisolated static let captureRestart = "Restart"
    nonisolated static let captureNoDrawing = "Nothing to draw yet. Place two points on a string to see the drawing."
    nonisolated static let captureLowConfidence = "Low confidence"

    nonisolated static func captureDepthMode(_ mode: DepthMode?) -> String? {
        switch mode {
        case .lidar?: return "Depth: LiDAR mesh"
        case .planes?: return "Depth: detected planes"
        case nil: return nil
        }
    }

    nonisolated static func captureSurface(_ hit: SurfaceHit, unit: LayoutUnits) -> String {
        let kind: String
        switch hit.kind {
        case .mesh: kind = "Mesh"
        case .plane: kind = "Plane"
        case .estimated: kind = "Estimated"
        }
        return "\(kind) surface, about \(formatUncertainty(hit.uncertaintyM, unit: unit)) uncertain"
    }

    nonisolated static func captureUnanchored(_ count: Int) -> String {
        count == 1 ? "1 point lost its place" : "\(count) points lost their place"
    }

    nonisolated static func captureReuseOffer(pointId: String, stringIds: [String]) -> String {
        stringIds.isEmpty
            ? "Use point \(pointId)?" : "Use point \(pointId) (on \(stringIds.joined(separator: ", ")))?"
    }
}

/// The capture screen (Req 1.3, 1.6, 2.3 to 2.5, 3.1, 3.2, 3.4, 3.5, 3.9, 4.6, 4.9, 5.2, 5.3,
/// 5.6, 5.7, 6.5 to 6.9, 6.11, 7.13, 8.2, 10.1, 13.8, 15.4).
///
/// With AR it shows the camera, the reticle, and the controls. Without AR, without a saved
/// world map, or with the camera denied, it shows the Capture in `FrontViewCanvas`; Details
/// and Export stay available.
struct CaptureScreen: View {
    let model: AppModel
    var onExport: () -> Void = {}
    var onReferenceScan: () -> Void = {}
    var onMarkWraps: () -> Void = {}
    /// Called with the AR controller when it starts and with nil when it is torn down, so the
    /// root can host the scan and wrap flows over the AR view.
    var onController: (ARCaptureController?) -> Void = { _ in }

    @State private var permission = CameraPermissionController()
    @State private var controller: ARCaptureController?
    @State private var showDetails = false
    @State private var message: String?
    @State private var hiddenCountText = ""
    @State private var isActive = false

    @Environment(\.theme) private var theme

    private let arSupported = ARWorldTrackingConfiguration.isSupported

    var body: some View {
        Group {
            if showsAR, let controller {
                arBody(controller)
            } else {
                flatBody
            }
        }
        .navigationTitle(model.document?.capture.label.isEmpty == false ? model.document!.capture.label : "Capture")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Details") { showDetails = true }
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .sheet(isPresented: $showDetails) { CaptureDetailsSheet(model: model) }
        .task {
            isActive = true
            await permission.refresh()
            startIfAllowed()
        }
        .onChange(of: permission.action) { _, _ in startIfAllowed() }
        .onDisappear {
            isActive = false
            // Saves the world map, then stops the session (Req 3.2).
            controller?.pause()
            controller = nil
            onController(nil)
            model.tracking = .notAvailable
            model.currentHit = nil
            model.worldMapMissing = false
        }
    }

    // MARK: - Mode

    private var cameraAllowed: Bool { permission.action == .startSession }

    /// True while the camera view is the right thing to show.
    private var showsAR: Bool {
        guard arSupported, cameraAllowed, !model.worldMapMissing else { return false }
        return controller?.state != .unsupported
    }

    private func startIfAllowed() {
        guard isActive, arSupported, cameraAllowed, controller == nil, model.document != nil else {
            return
        }
        let made = ARCaptureController(model: model)
        controller = made
        made.start()
        onController(made)
    }

    // MARK: - AR body

    private func arBody(_ controller: ARCaptureController) -> some View {
        ZStack {
            ARViewContainer(controller: controller)
                .ignoresSafeArea()
                .accessibilityLabel("Camera view with the reticle")
            SceneOverlayLabels(overlay: controller.sceneOverlay)
                .ignoresSafeArea()
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            statusPanel(controller)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            controlPanel(controller: controller)
        }
    }

    private func statusPanel(_ controller: ARCaptureController) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let mode = Wording.captureDepthMode(controller.depthMode) {
                Text(mode)
            }
            if let tracking = trackingMessage(model.tracking) {
                Text(tracking).font(theme.font(.bodyEmphasis))
            } else if let hit = model.currentHit, let unit = model.document?.capture.unit {
                HStack(spacing: 6) {
                    if hit.isLowConfidence {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(theme.colors.primary)
                            .accessibilityHidden(true)
                    }
                    Text(Wording.captureSurface(hit, unit: unit))
                        .font(theme.font(.mono))
                    if hit.isLowConfidence { Text("· \(Wording.captureLowConfidence)") }
                }
            } else {
                Text(Wording.captureNoSurface)
            }
            let lost = model.document?.unanchoredPointIds.count ?? 0
            if lost > 0 {
                Label(Wording.captureUnanchored(lost), systemImage: "exclamationmark.circle")
            }
            if case .stopped(let reason) = controller.state {
                Text(reason.message)
                Button(Wording.captureRestart) { controller.restart() }
                    .buttonStyle(.bordered)
                    .tint(theme.colors.primary)
                    .frame(minHeight: 44)
            }
            if controller.resetTrackingOffered {
                Button(Wording.captureResetTracking) { controller.resetTracking() }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.colors.primary)
                    .frame(minHeight: 44)
                    .accessibilityHint(Wording.captureResetHint)
            }
            if let saveMessage = model.draftSaveMessage {
                Text(saveMessage).foregroundStyle(theme.colors.destructive)
            }
        }
        .font(theme.font(.body))
        .foregroundStyle(theme.colors.foreground)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background { theme.surface() }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Flat body

    private var flatBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                flatNotice
                if model.worldMapMissing {
                    Text(WorldMapStore.missingMessage)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.foreground)
                }
                drawing
                if let lost = model.document?.unanchoredPointIds.count, lost > 0 {
                    Label(Wording.captureUnanchored(lost), systemImage: "exclamationmark.circle")
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.foreground)
                }
                if let saveMessage = model.draftSaveMessage {
                    Text(saveMessage).foregroundStyle(theme.colors.destructive)
                }
            }
            .padding()
        }
        .background(theme.colors.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            controlPanel(controller: nil)
        }
    }

    @ViewBuilder
    private var flatNotice: some View {
        if !arSupported {
            Label(Wording.captureAROff, systemImage: "arkit")
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.foreground)
        } else if permission.action == .showNeedsAccess {
            VStack(alignment: .leading, spacing: 8) {
                Label(Wording.captureCameraNeeded, systemImage: "camera.fill")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.foreground)
                Button(Wording.captureOpenSettings) { permission.openSettings() }
                    .buttonStyle(.bordered)
                    .tint(theme.colors.primary)
                    .frame(minHeight: 44)
            }
        }
    }

    @ViewBuilder
    private var drawing: some View {
        if let document = model.document,
            case .success(let result) = LayoutExporter.export(document, path: model.exportPath)
        {
            FrontViewCanvas(layout: result.layout, document: document)
        } else {
            Text(Wording.captureNoDrawing)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)
        }
    }

    // MARK: - Controls

    private var arActionsEnabled: Bool { controller != nil && showsAR }

    @ViewBuilder
    private func controlPanel(controller: ARCaptureController?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let message {
                Text(message)
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.foreground)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if arActionsEnabled { reuseOffer }
            selectionControls
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                    if arActionsEnabled { placementButtons }
                    editButtons
                    scanButtons
                    Button("Export") { onExport() }
                        .buttonStyle(.borderedProminent)
                        .tint(theme.colors.primary)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .frame(maxHeight: 220)
        }
        .font(theme.font(.body))
        .padding(.horizontal)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { theme.surface() }
    }

    @ViewBuilder
    private var reuseOffer: some View {
        if let hit = model.currentHit, let document = model.document,
            let near = Proximity.nearest(to: hit.position, in: document.capture)
        {
            Button(Wording.captureReuseOffer(pointId: near.pointId, stringIds: near.stringIds)) {
                run(.reusePoint(pointId: near.pointId, darkJump: model.darkJump))
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
        }
    }

    @ViewBuilder
    private var placementButtons: some View {
        Button("Place Point") {
            guard let hit = model.currentHit else { return }
            run(.placePoint(hit, darkJump: model.darkJump))
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(!model.canPlacePoint)
        .frame(maxWidth: .infinity, minHeight: 44)

        Toggle(
            "Dark Jump",
            isOn: Binding(get: { model.darkJump }, set: { model.setDarkJump($0) })
        )
        .toggleStyle(.button)
        .disabled(!model.darkJumpEnabled)
        .frame(maxWidth: .infinity, minHeight: 44)

        Button("Close Loop") { run(.closeLoop(darkJump: model.darkJump)) }
            .buttonStyle(.bordered)
            .disabled(!model.closeLoopEnabled)
            .frame(maxWidth: .infinity, minHeight: 44)
    }

    @ViewBuilder
    private var editButtons: some View {
        Button("Add String") { run(.addString) }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity, minHeight: 44)

        stringPicker
            .frame(maxWidth: .infinity, minHeight: 44)

        Button("Undo") {
            model.undo()
            message = nil
        }
        .buttonStyle(.bordered)
        .disabled(!model.canUndo)
        .frame(maxWidth: .infinity, minHeight: 44)

        Button("Redo") {
            model.redo()
            message = nil
        }
        .buttonStyle(.bordered)
        .disabled(!model.canRedo)
        .frame(maxWidth: .infinity, minHeight: 44)

        Button("Details") { showDetails = true }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity, minHeight: 44)
    }

    @ViewBuilder
    private var scanButtons: some View {
        Button("Reference Scan") { onReferenceScan() }
            .buttonStyle(.bordered)
            .disabled(!arActionsEnabled)
            .frame(maxWidth: .infinity, minHeight: 44)

        if model.document?.spiral.referenceScan != nil {
            Button("Mark Wraps") { onMarkWraps() }
                .buttonStyle(.bordered)
                .disabled(!arActionsEnabled)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    private var stringPicker: some View {
        Picker(
            "String",
            selection: Binding(
                get: { model.activeStringId },
                set: { model.setActiveString($0) })
        ) {
            ForEach(model.document?.capture.strings ?? [], id: \.id) { string in
                Text("String \(string.id)").tag(string.id)
            }
        }
        .pickerStyle(.menu)
        .accessibilityLabel("Active string")
    }

    // MARK: - Selection

    @ViewBuilder
    private var selectionControls: some View {
        if let document = model.document {
            HStack {
                selectionMenu(document.capture)
                Spacer(minLength: 0)
            }
            switch model.selection {
            case .point(let id)?:
                HStack {
                    Text("Point \(id)").font(theme.font(.monoEmphasis))
                    Button("Move") {
                        guard let hit = model.currentHit else {
                            message = Wording.captureNoSurface
                            return
                        }
                        run(.movePoint(pointId: id, to: hit))
                    }
                    .buttonStyle(.bordered)
                    .disabled(!arActionsEnabled || !model.canPlacePoint)
                    .frame(minHeight: 44)
                    Button("Delete", role: .destructive) { run(.deletePoint(pointId: id)) }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                }
            case .run(let id)?:
                runControls(id: id, capture: document.capture)
            case nil:
                EmptyView()
            }
        }
    }

    private func selectionMenu(_ capture: Capture) -> some View {
        Menu {
            ForEach(capture.points, id: \.id) { point in
                Button("Point \(point.id)") { select(.point(point.id)) }
            }
            ForEach(capture.strings, id: \.id) { string in
                ForEach(string.runs, id: \.id) { run in
                    Button("Run \(run.id) on \(string.id)") { select(.run(run.id)) }
                }
            }
            if model.selection != nil {
                Button("Clear selection", role: .cancel) { select(nil) }
            }
        } label: {
            Label(selectionTitle, systemImage: "scope")
                .frame(minHeight: 44)
        }
        .disabled(capture.points.isEmpty)
        .accessibilityHint("Choose a point or run to change")
    }

    private var selectionTitle: String {
        switch model.selection {
        case .point(let id)?: return "Selected point \(id)"
        case .run(let id)?: return "Selected run \(id)"
        case nil: return "Select point or run"
        }
    }

    private func select(_ selection: CaptureSelection?) {
        model.selection = selection
        message = nil
        if case .run(let id)? = selection,
            let run = model.document?.capture.strings.flatMap(\.runs).first(where: { $0.id == id })
        {
            hiddenCountText = String(run.hiddenCount ?? 0)
        }
    }

    @ViewBuilder
    private func runControls(id: String, capture: Capture) -> some View {
        if let selectedRun = capture.strings.flatMap(\.runs).first(where: { $0.id == id }) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Run \(id)").font(theme.font(.monoEmphasis))
                    Button("Insert Point") {
                        guard let hit = model.currentHit else {
                            message = Wording.captureNoSurface
                            return
                        }
                        run(.insertPoint(runId: id, at: hit))
                    }
                    .buttonStyle(.bordered)
                    .disabled(!arActionsEnabled || !model.canPlacePoint)
                    .frame(minHeight: 44)
                }
                Picker(
                    "Run kind",
                    selection: Binding(
                        get: { selectedRun.kind },
                        set: { run(.setRunKind(runId: id, kind: $0)) })
                ) {
                    Text("Lit").tag(RunKind.lit)
                    Text("Wire").tag(RunKind.wire)
                    Text("Hidden").tag(RunKind.hidden)
                }
                .pickerStyle(.segmented)
                .frame(minHeight: 44)
                if selectedRun.kind == .hidden {
                    HStack {
                        TextField("Hidden lights", text: $hiddenCountText)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .frame(minHeight: 44)
                            .accessibilityLabel("Hidden light count")
                            .onSubmit { run(.setHiddenCount(runId: id, text: hiddenCountText)) }
                        Button("Set") { run(.setHiddenCount(runId: id, text: hiddenCountText)) }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                    }
                }
            }
        }
    }

    // MARK: - Running edits

    /// Runs an edit and shows a one-line message when it is refused or carries a notice.
    private func run(_ edit: CaptureEdit) {
        switch model.perform(edit) {
        case .refused(let refusal): message = Wording.refusalMessage(refusal)
        case .applied(let notice): message = notice.map(Wording.refusalMessage)
        case .ignored: message = model.worldMapMissing ? WorldMapStore.missingMessage : nil
        }
    }
}
