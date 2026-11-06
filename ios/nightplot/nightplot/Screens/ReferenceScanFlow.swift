import ARKit
import NightplotCore
import Observation
import RealityKit
import SwiftUI
import UIKit
import simd

// Copy for the reference scan. None of these strings uses Attach, Apply, Preview, or
// Hardware Done (Req 15.2).
extension Wording {
    static let scanTitle = "Reference scan"
    static let scanClose = "Done"
    static let scanPlaceCylinder = "Place cylinder"
    static let scanPlaceCylinderHint =
        "Aim at the base of the object, then tap Place cylinder. The cylinder is centred half its radius behind that spot, so make the radius a little larger than the object."
    static let scanStart = "Start scan"
    static let scanFinish = "Finish scan"
    static let scanRescan = "Rescan"
    static let scanStartOver = "Start over"
    static let scanRemoveLast = "Remove last point"
    static let scanScanning = "Scanning. Walk slowly around the object so the phone sees every side."
    static let scanPaused = "Scan paused. It continues with what it has once tracking is back."
    static let scanPointsPaused = "Placing points is paused until tracking is back."
    static let scanLowConfidence = "Low confidence: the scan did not fit the surface well. Rescan, or type the circumferences."
    static let scanTooLittleData = "The scan had too little surface data. Rescan, or type the circumferences."
    static let scanTypeHeading = "Type the circumferences"
    static let scanUseTyped = "Use typed values"
    static let scanSet = "Set"
    static let scanBottomLabel = "Bottom circumference"
    static let scanTopLabel = "Top circumference"
    static let scanTypedNote = "typed"
    static let scanScannedNote = "scanned"
    static let scanTopAboveBottom = "The top points must be higher than the bottom points. Place the top three points again."

    static func scanVertexCount(_ n: Int) -> String {
        n == 1 ? "1 point collected" : "\(n) points collected"
    }

    static func scanPointPrompt(index: Int) -> String {
        let labels = [
            "bottom, left edge", "bottom, right edge", "bottom, front",
            "top, left edge", "top, right edge", "top, front",
        ]
        let label = labels[min(max(index, 0), 5)]
        return "Place point \(index + 1) of 6: \(label)"
    }

    static func scanCircumference(_ label: String, metres: Double, typed: Bool, unit: LayoutUnits) -> String {
        "\(label): \(formatCircumference(metres, unit: unit)) (\(typed ? scanTypedNote : scanScannedNote))"
    }

    static func scanTypedRange(label: String, minText: String, maxText: String) -> String {
        "\(label): enter a length from \(minText) to \(maxText)."
    }

    static func scanPointsRejected(_ failure: ScanFailure, height: ScanHeight) -> String {
        let name = height == .bottom ? "bottom" : "top"
        switch failure {
        case .edgesTooClose:
            return "The left and right points are too close together. Place the \(name) three points again."
        case .pointsInLine:
            return "The three points are almost in a straight line. Place the \(name) three points again."
        case .cylinderOutOfRange:
            return scanTopAboveBottom
        case .tooFewVertices, .emptyBand:
            return scanTooLittleData
        }
    }
}

// MARK: - Drawing in the AR view

/// Draws the cylinder, fitted axis and outlines, plane points, and wrap marks in the AR view
/// (Req 9.3). Each kind sits in its own layer so one can change without redrawing the rest.
/// It joins the scene on first use and leaves with `remove()`.
@MainActor
final class ScanOverlayDrawer {
    private weak var arView: ARView?
    private let root = AnchorEntity(world: .zero)
    private var layers: [String: Entity] = [:]
    private var attached = false

    private static let cylinderColor = UIColor.systemYellow
    private static let outlineColor = UIColor.systemCyan
    private static let markColor = UIColor.white

    init(arView: ARView) {
        self.arView = arView
    }

    func remove() {
        for child in Array(root.children) { child.removeFromParent() }
        layers = [:]
        root.removeFromParent()
        attached = false
    }

    private func setLayer(_ name: String, _ children: [Entity]) {
        if !attached, let arView {
            arView.scene.addAnchor(root)
            attached = true
        }
        layers[name]?.removeFromParent()
        layers[name] = nil
        guard !children.isEmpty else { return }
        let layer = Entity()
        for child in children { layer.addChild(child) }
        root.addChild(layer)
        layers[name] = layer
    }

    // MARK: Layers

    /// The operator's cylinder: a ring at the bottom, a ring at the top, and four edges.
    func showCylinder(_ cylinder: ScanCylinder?) {
        guard let c = cylinder else { return setLayer("cylinder", []) }
        let x = Float(c.axisX), z = Float(c.axisZ), y0 = Float(c.bottomY)
        let y1 = y0 + Float(c.heightM), r = Float(c.radiusM)
        var entities: [Entity] = []
        let rings = [(center: SIMD3<Float>(x, y0, z), radius: r), (center: SIMD3<Float>(x, y1, z), radius: r)]
        if let ring = Self.ringsEntity(rings, color: Self.cylinderColor) { entities.append(ring) }
        for (dx, dz) in [(r, Float(0)), (0, r), (-r, 0), (0, -r)] {
            if let edge = Self.segment(
                from: SIMD3(x + dx, y0, z + dz), to: SIMD3(x + dx, y1, z + dz),
                thickness: 0.004, color: Self.cylinderColor)
            {
                entities.append(edge)
            }
        }
        setLayer("cylinder", entities)
    }

    /// The fitted axis, and one ring per band (LiDAR) or one at each end (planes, typed).
    func showScan(_ scan: ReferenceScan?) {
        guard let scan, scan.heightM > 0 else { return setLayer("scan", []) }
        var entities: [Entity] = []
        if let axis = Self.segment(
            from: Self.simd(scan.axisBottom), to: Self.simd(scan.axisTop),
            thickness: 0.006, color: Self.outlineColor)
        {
            entities.append(axis)
        }
        var heights: [Double] = []
        if scan.source == .lidar, !scan.bands.isEmpty {
            heights = scan.bands.map { min(scan.heightM, $0.y0 + ReferenceScan.bandHeightM / 2) }
        } else {
            heights = [0, scan.heightM]
        }
        let rings: [(center: SIMD3<Float>, radius: Float)] = heights.compactMap { h in
            guard let r = scan.radius(atHeight: h) else { return nil }
            return (center: Self.axisPoint(scan, h), radius: Float(r))
        }
        if let ring = Self.ringsEntity(rings, color: Self.outlineColor) { entities.append(ring) }
        setLayer("scan", entities)
    }

    /// Small spheres where the operator has placed points.
    func showPoints(_ points: [Vec3]) {
        setLayer("points", points.map { Self.sphere(at: Self.simd($0), color: Self.cylinderColor) })
    }

    /// Wrap marks.
    func showMarks(_ marks: [WrapMark]) {
        setLayer("marks", marks.map { Self.sphere(at: Self.simd($0.position), color: Self.markColor) })
    }

    // MARK: Geometry

    private static func simd(_ v: Vec3) -> SIMD3<Float> {
        SIMD3(Float(v.x), Float(v.y), Float(v.z))
    }

    private static func axisPoint(_ scan: ReferenceScan, _ h: Double) -> SIMD3<Float> {
        let t = Float(scan.heightM > 0 ? h / scan.heightM : 0)
        let b = simd(scan.axisBottom), top = simd(scan.axisTop)
        return b + (top - b) * t
    }

    private static func sphere(at p: SIMD3<Float>, color: UIColor) -> ModelEntity {
        let e = ModelEntity(mesh: .generateSphere(radius: 0.012), materials: [UnlitMaterial(color: color)])
        e.position = p
        return e
    }

    private static func segment(
        from a: SIMD3<Float>, to b: SIMD3<Float>, thickness: Float, color: UIColor
    ) -> ModelEntity? {
        let d = b - a
        let len = simd_length(d)
        guard len.isFinite, len > 1e-5 else { return nil }
        let e = ModelEntity(
            mesh: .generateBox(size: SIMD3(thickness, len, thickness)),
            materials: [UnlitMaterial(color: color)])
        e.position = (a + b) / 2
        e.orientation = simd_quatf(from: SIMD3(0, 1, 0), to: d / len)
        return e
    }

    /// Every ring is a thin horizontal ribbon in one mesh, in world coordinates.
    private static func ringsEntity(
        _ rings: [(center: SIMD3<Float>, radius: Float)], color: UIColor
    ) -> ModelEntity? {
        let sides = 32
        let half: Float = 0.004
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        for ring in rings where ring.radius.isFinite && ring.radius > 0 {
            let base = UInt32(positions.count)
            for i in 0..<sides {
                let a = Float(i) / Float(sides) * 2 * .pi
                let n = SIMD3<Float>(cos(a), 0, sin(a))
                let p = ring.center + n * ring.radius
                positions.append(p - SIMD3(0, half, 0))
                positions.append(p + SIMD3(0, half, 0))
                normals.append(n)
                normals.append(n)
            }
            for i in 0..<sides {
                let b0 = base + UInt32(i * 2), t0 = b0 + 1
                let b1 = base + UInt32(((i + 1) % sides) * 2), t1 = b1 + 1
                indices += [b0, b1, t0, t0, b1, t1]
                indices += [b0, t0, b1, t0, t1, b1]
            }
        }
        guard !positions.isEmpty else { return nil }
        var descriptor = MeshDescriptor(name: "rings")
        descriptor.positions = MeshBuffers.Positions(positions)
        descriptor.normals = MeshBuffers.Normals(normals)
        descriptor.primitives = .triangles(indices)
        guard let mesh = try? MeshResource.generate(from: [descriptor]) else { return nil }
        return ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
    }
}

// MARK: - Session

/// The reference scan, step by step (Req 9.1 to 9.8). It reads the AR view and the model, and
/// writes only `SpiralState`, through `AppModel.updateSpiral`.
@MainActor
@Observable
final class ReferenceScanSession {
    enum Phase: Equatable {
        /// LiDAR: the operator places and sizes the cylinder.
        case positioning
        /// LiDAR: vertices are being collected.
        case scanning
        /// Planes: six points, in order.
        case placingPoints
        /// LiDAR scan failed or is low confidence: Rescan or type.
        case needsTyped
        /// A scan is stored.
        case finished
    }

    private(set) var phase: Phase
    private(set) var cylinder: ScanCylinder
    private(set) var cylinderPlaced: Bool
    private(set) var vertexCount = 0
    private(set) var collectionPaused = false
    private(set) var planePoints: [Vec3] = []
    private(set) var message: String?
    /// Why the screen is asking for typed values.
    private(set) var needsTypedReason: String?
    /// A low-confidence fit that is shown but not stored.
    private(set) var pending: ReferenceScan?
    private(set) var typedError: String?
    private(set) var bottomError: String?
    private(set) var topError: String?
    var bottomText = ""
    var topText = ""

    let isLidar: Bool

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored private let controller: ARCaptureController
    @ObservationIgnored private var collector: MeshCollector?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var drawer: ScanOverlayDrawer?

    init(model: AppModel, controller: ARCaptureController) {
        self.model = model
        self.controller = controller
        isLidar = controller.depthMode == .lidar
        let spiral = model.document?.spiral
        let saved = spiral?.cylinder
        cylinder = saved ?? ScanCylinder(axisX: 0, axisZ: 0, bottomY: 0, heightM: 2, radiusM: 0.5)
        cylinderPlaced = saved != nil
        if spiral?.referenceScan != nil {
            phase = .finished
        } else {
            phase = isLidar ? .positioning : .placingPoints
        }
    }

    var unit: LayoutUnits { model.document?.capture.unit ?? .ft }
    var tracking: TrackingStatus { model.tracking }
    var trackingReason: String? { trackingMessage(model.tracking) }
    var storedScan: ReferenceScan? { model.document?.spiral.referenceScan }
    var canPlace: Bool { placePointEnabled(tracking: model.tracking, hit: model.currentHit) }

    // MARK: Lifecycle

    func start() {
        refreshOverlay()
    }

    func stop() {
        loop?.cancel()
        loop = nil
        drawer?.remove()
        drawer = nil
    }

    // MARK: Cylinder (LiDAR)

    func placeCylinder() {
        guard model.tracking == .normal, let hit = model.currentHit else {
            message = trackingReason ?? Wording.captureNoSurface
            return
        }
        let push = cylinder.radiusM * 0.5
        cylinder.axisX = hit.position.x + hit.deviceHeading.x * push
        cylinder.axisZ = hit.position.z + hit.deviceHeading.z * push
        cylinder.bottomY = hit.position.y
        cylinderPlaced = true
        message = nil
        refreshOverlay()
    }

    func setRadius(_ value: Double) {
        cylinder.radiusM = min(3, max(0.05, value))
        refreshOverlay()
    }

    func setHeight(_ value: Double) {
        cylinder.heightM = min(10, max(0.2, value))
        refreshOverlay()
    }

    func startScan() {
        guard phase == .positioning, cylinderPlaced else { return }
        collector = MeshCollector(cylinder: cylinder)
        vertexCount = 0
        collectionPaused = false
        message = nil
        phase = .scanning
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        refreshOverlay()
    }

    private func tick() {
        guard phase == .scanning, let collector else { return }
        let anchors = controller.arView.session.currentFrame?.anchors ?? []
        collector.collect(from: anchors, tracking: model.tracking)
        vertexCount = collector.vertexCount
        collectionPaused = collector.isPaused
    }

    func finishScan() {
        guard phase == .scanning, let collector else { return }
        loop?.cancel()
        loop = nil
        switch ReferenceScanFit.lidar(vertices: collector.vertices, cylinder: cylinder) {
        case .success(let scan) where scan.lowConfidence:
            // Shown, not stored. Rescan or type both circumferences (Req 9.4).
            pending = scan
            needsTypedReason = Wording.scanLowConfidence
            phase = .needsTyped
        case .success(let scan):
            store(scan, cylinder: cylinder, resetMarks: true)
            phase = .finished
        case .failure:
            // No scan is stored for this attempt (Req 9.6).
            pending = nil
            needsTypedReason = Wording.scanTooLittleData
            phase = .needsTyped
        }
        self.collector = nil
        typedError = nil
        refreshOverlay()
    }

    func rescan() {
        loop?.cancel()
        loop = nil
        collector = nil
        pending = nil
        planePoints = []
        message = nil
        typedError = nil
        needsTypedReason = nil
        vertexCount = 0
        phase = isLidar ? .positioning : .placingPoints
        refreshOverlay()
    }

    // MARK: Typed values (Req 9.5)

    /// Both values at once, after a failed or low-confidence scan. Nothing is stored unless both pass.
    func useTypedValues() {
        let base = pending
            ?? ReferenceScanFit.typed(cylinder: cylinder, bottomCircumferenceM: 1, topCircumferenceM: 1)
        let bottom = ReferenceScanFit.applyTyped(base, height: .bottom, text: bottomText, unit: unit)
        guard case .success(let withBottom) = bottom else {
            typedError = Self.rangeMessage(bottom, label: Wording.scanBottomLabel)
            return
        }
        let top = ReferenceScanFit.applyTyped(withBottom, height: .top, text: topText, unit: unit)
        guard case .success(let both) = top else {
            typedError = Self.rangeMessage(top, label: Wording.scanTopLabel)
            return
        }
        store(both, cylinder: cylinder, resetMarks: true)
        pending = nil
        typedError = nil
        bottomText = ""
        topText = ""
        phase = .finished
        refreshOverlay()
    }

    /// One height, on a stored scan. A bad value changes nothing.
    func setTyped(_ height: ScanHeight) {
        guard let scan = storedScan else { return }
        let text = height == .bottom ? bottomText : topText
        let result = ReferenceScanFit.applyTyped(scan, height: height, text: text, unit: unit)
        switch result {
        case .success(let next):
            store(next, cylinder: nil, resetMarks: false)
            if height == .bottom {
                bottomError = nil
                bottomText = ""
            } else {
                topError = nil
                topText = ""
            }
            refreshOverlay()
        case .failure:
            let label = height == .bottom ? Wording.scanBottomLabel : Wording.scanTopLabel
            let text = Self.rangeMessage(result, label: label)
            if height == .bottom { bottomError = text } else { topError = text }
        }
    }

    private static func rangeMessage(
        _ result: Result<ReferenceScan, TypedCircumferenceError>, label: String
    ) -> String? {
        guard case .failure(.outOfRange(let minText, let maxText)) = result else { return nil }
        return Wording.scanTypedRange(label: label, minText: minText, maxText: maxText)
    }

    // MARK: Six points (planes)

    func placePlanePoint() {
        guard planePoints.count < 6, model.tracking == .normal else { return }
        guard let hit = model.currentHit else {
            message = Wording.captureNoSurface
            return
        }
        planePoints.append(hit.position)
        message = nil
        let p = planePoints
        if p.count == 3 {
            if case .failure(let failure) = ReferenceScanFit.planesHeight(
                left: p[0], right: p[1], front: p[2])
            {
                planePoints = []
                message = Wording.scanPointsRejected(failure, height: .bottom)
            }
        } else if p.count == 6 {
            switch ReferenceScanFit.planes(bottom: (p[0], p[1], p[2]), top: (p[3], p[4], p[5])) {
            case .success(let scan):
                store(scan, cylinder: nil, resetMarks: true)
                planePoints = []
                phase = .finished
            case .failure(let failure):
                // The bottom three passed on their own. Only the top three are placed again.
                planePoints = Array(p.prefix(3))
                message = Wording.scanPointsRejected(failure, height: .top)
            }
        }
        refreshOverlay()
    }

    func removeLastPlanePoint() {
        guard !planePoints.isEmpty else { return }
        planePoints.removeLast()
        message = nil
        refreshOverlay()
    }

    // MARK: Storing

    /// A new scan clears the wrap marks, because their heights belong to the old scan. Their ids
    /// are retired so no id is issued twice (Req 10.12).
    private func store(_ scan: ReferenceScan, cylinder: ScanCylinder?, resetMarks: Bool) {
        model.updateSpiral { spiral in
            if resetMarks {
                let ids = spiral.wrapMarks.map(\.pointId)
                for id in ids where !spiral.retiredIds.contains(id) { spiral.retiredIds.append(id) }
                spiral.wrapMarks = []
                spiral.accepted = false
                spiral.keepMeasuredWraps = false
            }
            spiral.referenceScan = scan
            if let cylinder { spiral.cylinder = cylinder }
        }
    }

    // MARK: Overlay

    func refreshOverlay() {
        let drawer = self.drawer ?? ScanOverlayDrawer(arView: controller.arView)
        self.drawer = drawer
        switch phase {
        case .positioning, .scanning:
            drawer.showCylinder(cylinderPlaced ? cylinder : nil)
            drawer.showScan(nil)
            drawer.showPoints([])
        case .placingPoints:
            drawer.showCylinder(nil)
            drawer.showScan(nil)
            drawer.showPoints(planePoints)
        case .needsTyped:
            drawer.showCylinder(cylinderPlaced ? cylinder : nil)
            drawer.showScan(pending)
            drawer.showPoints([])
        case .finished:
            drawer.showCylinder(nil)
            drawer.showScan(storedScan)
            drawer.showPoints([])
        }
    }
}

// MARK: - View

/// The reference scan panel (Req 9.1 to 9.8). Host it over the AR view; `onClose` is called
/// from Done.
struct ReferenceScanFlow: View {
    let model: AppModel
    let controller: ARCaptureController
    var onClose: () -> Void = {}

    @State private var session: ReferenceScanSession
    @Environment(\.theme) private var theme

    init(model: AppModel, controller: ARCaptureController, onClose: @escaping () -> Void = {}) {
        self.model = model
        self.controller = controller
        self.onClose = onClose
        _session = State(initialValue: ReferenceScanSession(model: model, controller: controller))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Wording.scanTitle).font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button(Wording.scanClose) {
                    session.stop()
                    onClose()
                }
                .buttonStyle(.bordered)
                .tint(theme.colors.primary)
                .frame(minWidth: 44, minHeight: 44)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    content
                    if let message = session.message {
                        Text(message)
                            .font(theme.font(.body))
                            .foregroundStyle(theme.colors.foreground)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 340)
        }
        .font(theme.font(.body))
        .foregroundStyle(theme.colors.foreground)
        .tint(theme.colors.primary)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { theme.surface() }
        .onAppear { session.start() }
        .onDisappear { session.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch session.phase {
        case .positioning: positioning
        case .scanning: scanning
        case .placingPoints: placingPoints
        case .needsTyped: needsTyped
        case .finished: finished
        }
    }

    // MARK: Phases

    private var positioning: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Wording.scanPlaceCylinderHint).font(.subheadline)
            trackingNote
            Button(Wording.scanPlaceCylinder) { session.placeCylinder() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!session.canPlace)
                .frame(minHeight: 44)
            Stepper(
                value: Binding(get: { session.cylinder.radiusM }, set: { session.setRadius($0) }),
                in: 0.05...3, step: 0.05
            ) {
                Text("Cylinder radius: \(formatLength(session.cylinder.radiusM, session.unit))")
            }
            .frame(minHeight: 44)
            Stepper(
                value: Binding(get: { session.cylinder.heightM }, set: { session.setHeight($0) }),
                in: 0.2...10, step: 0.1
            ) {
                Text("Cylinder height: \(formatLength(session.cylinder.heightM, session.unit))")
            }
            .frame(minHeight: 44)
            Button(Wording.scanStart) { session.startScan() }
                .buttonStyle(.borderedProminent)
                .disabled(!session.cylinderPlaced)
                .frame(minHeight: 44)
        }
        .font(.subheadline)
    }

    private var scanning: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Wording.scanScanning).font(.subheadline)
            Text(Wording.scanVertexCount(session.vertexCount))
                .font(.subheadline.bold())
                .accessibilityAddTraits(.updatesFrequently)
            if session.collectionPaused {
                Text(Wording.scanPaused).font(.subheadline.bold())
                trackingNote
            }
            HStack {
                Button(Wording.scanFinish) { session.finishScan() }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.collectionPaused)
                    .frame(minHeight: 44)
                Button(Wording.scanRescan) { session.rescan() }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
        }
    }

    private var placingPoints: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Wording.scanPointPrompt(index: min(session.planePoints.count, 5)))
                .font(.subheadline.bold())
            if session.tracking != .normal {
                Text(Wording.scanPointsPaused).font(.subheadline)
                trackingNote
            }
            Button("Place point") { session.placePlanePoint() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!session.canPlace)
                .frame(minHeight: 44)
            HStack {
                Button(Wording.scanRemoveLast) { session.removeLastPlanePoint() }
                    .buttonStyle(.bordered)
                    .disabled(session.planePoints.isEmpty)
                    .frame(minHeight: 44)
                Button(Wording.scanStartOver) { session.rescan() }
                    .buttonStyle(.bordered)
                    .disabled(session.planePoints.isEmpty)
                    .frame(minHeight: 44)
            }
        }
    }

    private var needsTyped: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let reason = session.needsTypedReason {
                Label(reason, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
            }
            if let pending = session.pending {
                Text(Wording.scanCircumference(
                    Wording.scanBottomLabel, metres: pending.bottom.metres, typed: false, unit: session.unit))
                Text(Wording.scanCircumference(
                    Wording.scanTopLabel, metres: pending.top.metres, typed: false, unit: session.unit))
            }
            Button(Wording.scanRescan) { session.rescan() }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            Text(Wording.scanTypeHeading).font(.subheadline.bold())
            lengthField(Wording.scanBottomLabel, text: Bindable(session).bottomText)
            lengthField(Wording.scanTopLabel, text: Bindable(session).topText)
            if let error = session.typedError {
                Text(error).font(theme.font(.body)).foregroundStyle(theme.colors.destructive)
            }
            Button(Wording.scanUseTyped) { session.useTypedValues() }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
        }
        .font(.subheadline)
    }

    @ViewBuilder
    private var finished: some View {
        if let scan = session.storedScan {
            VStack(alignment: .leading, spacing: 10) {
                Text(Wording.scanCircumference(
                    Wording.scanBottomLabel, metres: scan.bottom.metres, typed: scan.bottom.typed,
                    unit: session.unit))
                Text(Wording.scanCircumference(
                    Wording.scanTopLabel, metres: scan.top.metres, typed: scan.top.typed,
                    unit: session.unit))
                typedRow(Wording.scanBottomLabel, text: Bindable(session).bottomText, error: session.bottomError) {
                    session.setTyped(.bottom)
                }
                typedRow(Wording.scanTopLabel, text: Bindable(session).topText, error: session.topError) {
                    session.setTyped(.top)
                }
                Button(Wording.scanRescan) { session.rescan() }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
            .font(.subheadline)
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private var trackingNote: some View {
        if let reason = session.trackingReason {
            Text(reason).font(.subheadline.bold())
        } else if session.phase != .scanning, session.canPlace == false {
            Text(Wording.captureNoSurface).font(.subheadline)
        }
    }

    private func lengthField(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text, prompt: Text(session.unit == .ft ? "for example 4' 3\"" : "for example 1.30"))
            .keyboardType(.numbersAndPunctuation)
            .textFieldStyle(.roundedBorder)
            .frame(minHeight: 44)
            .accessibilityLabel(label)
    }

    private func typedRow(
        _ label: String, text: Binding<String>, error: String?, set: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                lengthField(label, text: text)
                    .onSubmit(set)
                Button(Wording.scanSet, action: set)
                    .buttonStyle(.bordered)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Set \(label.lowercased())")
            }
            if let error {
                Text(error).font(theme.font(.body)).foregroundStyle(theme.colors.destructive)
            }
        }
    }
}
