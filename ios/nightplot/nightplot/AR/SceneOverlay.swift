import Combine
import NightplotCore
import Observation
import RealityKit
import SwiftUI
import UIKit
import simd

/// One text label pinned to a world position, already projected to the AR view's coordinates.
struct OverlayLabel: Identifiable, Equatable {
    enum Kind: Equatable { case index, runLength }
    let id: String
    let kind: Kind
    let text: String
    let screen: CGPoint
}

/// Draws the open Capture in the AR view (Req 4.7, 4.8, 5.9, 3.6, 3.9).
///
/// Points are spheres in their string's colour. Lit runs are solid cylinders, wire runs are
/// dashed, hidden runs are translucent grey tubes. A low-confidence point gets an amber dot and
/// an unanchored point gets a hollow dashed ring. Index labels and run lengths are published
/// in `labels` and re-projected every frame; `SceneOverlayLabels` draws them.
@MainActor
@Observable
final class SceneOverlay {
    /// Screen-space labels, refreshed each frame. Empty when nothing is in front of the camera.
    private(set) var labels: [OverlayLabel] = []

    @ObservationIgnored private weak var arView: ARView?
    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private let root = AnchorEntity(world: .zero)
    @ObservationIgnored private var updateSubscription: (any Cancellable)?
    @ObservationIgnored private var anchors: [LabelAnchor] = []
    @ObservationIgnored private var drawn: DrawnState?

    private struct LabelAnchor {
        let id: String
        let kind: OverlayLabel.Kind
        let text: String
        let world: SIMD3<Float>
    }

    private struct DrawnState: Equatable {
        var capture: Capture
        var lost: Set<String>
    }

    // Visual constants, in metres.
    nonisolated static let pointRadius: Float = 0.012
    nonisolated static let runRadius: Float = 0.004
    nonisolated static let beadRadius: Float = 0.006
    nonisolated static let dashLength: Float = 0.03
    nonisolated static let dashGap: Float = 0.02
    nonisolated static let ringRadius: Float = 0.03

    init(arView: ARView, model: AppModel) {
        self.arView = arView
        self.model = model
        arView.scene.addAnchor(root)
        updateSubscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] _ in
            MainActor.assumeIsolated { self?.projectLabels() }
        }
        observeDocument()
    }

    // MARK: - Following the document

    /// Re-draws whenever the open document changes. `withObservationTracking` fires once, so
    /// each change re-arms it.
    private func observeDocument() {
        guard let model else { return }
        let document = withObservationTracking {
            model.document
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observeDocument() }
        }
        redraw(document)
    }

    /// Rebuilds the entities when the Capture or the lost-anchor set changed.
    func redraw(_ document: CaptureDocument?) {
        guard let document else {
            clear()
            return
        }
        let state = DrawnState(capture: document.capture, lost: document.lostAnchorIds)
        guard state != drawn else { return }
        drawn = state
        rebuild(document)
    }

    private func clear() {
        drawn = nil
        anchors = []
        labels = []
        for child in Array(root.children) { child.removeFromParent() }
    }

    // MARK: - Building

    private func rebuild(_ document: CaptureDocument) {
        for child in Array(root.children) { child.removeFromParent() }
        var labelAnchors: [LabelAnchor] = []
        let capture = document.capture
        let positions = Dictionary(
            capture.points.map { ($0.id, Self.simd($0.position)) },
            uniquingKeysWith: { first, _ in first })

        // Points: one sphere per point, coloured by the first string that holds it.
        var indexText: [String: [String]] = [:]
        var firstColor: [String: Int] = [:]
        for string in capture.strings {
            var indexes: [String: [Int]] = [:]
            for (i, pid) in string.pointIds.enumerated() {
                indexes[pid, default: []].append(i)
                if firstColor[pid] == nil { firstColor[pid] = string.colorIndex }
            }
            for (pid, list) in indexes {
                indexText[pid, default: []].append(
                    "\(string.id)·\(list.map(String.init).joined(separator: ","))")
            }
        }
        for point in capture.points {
            let at = Self.simd(point.position)
            let color = Self.color(forIndex: firstColor[point.id] ?? 0)
            root.addChild(Self.sphere(at: at, radius: Self.pointRadius, color: color))
            if point.uncertaintyM > 0.05 {
                // Amber dot above the point: low confidence (Req 3.6).
                root.addChild(
                    Self.sphere(
                        at: at + SIMD3(0, Self.pointRadius * 2.4, 0),
                        radius: Self.pointRadius * 0.5, color: Self.amber))
            }
            if document.lostAnchorIds.contains(point.anchorId) {
                // Hollow dashed ring: unanchored, distinct from the amber dot (Req 3.9).
                root.addChild(Self.dashedRing(at: at, color: color))
            }
            if let texts = indexText[point.id] {
                // Strings are in capture order; order inside a string follows point order.
                labelAnchors.append(
                    LabelAnchor(
                        id: "p-\(point.id)", kind: .index,
                        text: texts.sorted().joined(separator: "  "),
                        world: at + SIMD3(0, Self.pointRadius * 3.5, 0)))
            }
        }

        // Lit runs draw as bead chains when their spacing is known and both ends
        // are anchored, and as tubes otherwise. `BeadLayout.sceneBeads` plans all
        // lit runs together, in string order, so the 400-sphere scene cap holds
        // across the whole Capture. Wire and hidden runs keep their own styles.
        // A Bead here is a drawing of where a light goes, never a lit LED (Req 16.13, 16.14, 16.21).
        let lostIds = Set(document.unanchoredPointIds)
        var runInputs: [RunBeadInput] = []
        for string in capture.strings {
            for (i, run) in string.runs.enumerated()
            where run.kind == .lit && i + 1 < string.pointIds.count {
                let fromId = string.pointIds[i]
                let toId = string.pointIds[i + 1]
                guard let from = capture.points.first(where: { $0.id == fromId }),
                    let to = capture.points.first(where: { $0.id == toId })
                else { continue }
                let anchored = !lostIds.contains(fromId) && !lostIds.contains(toId)
                runInputs.append(
                    RunBeadInput(
                        stringId: string.id, edgeId: run.id,
                        startM: from.position, endM: to.position,
                        spacingM: capture.spacingM, anchored: anchored))
            }
        }
        var planByEdge: [String: RunBeadPlan] = [:]
        for plan in BeadLayout.sceneBeads(runs: runInputs) {
            switch plan {
            case .chain(_, let edgeId, _), .tube(_, let edgeId, _, _):
                planByEdge[edgeId] = plan
            }
        }

        // Runs: between consecutive points of each string.
        for string in capture.strings {
            let color = Self.color(forIndex: string.colorIndex)
            for (i, run) in string.runs.enumerated() where i + 1 < string.pointIds.count {
                guard let a = positions[string.pointIds[i]],
                    let b = positions[string.pointIds[i + 1]]
                else { continue }
                switch run.kind {
                case .lit:
                    // A planned chain draws emissive spheres at the spacing; anything
                    // else (unknown spacing, unanchored end, or over the cap) keeps the tube.
                    if case .chain(_, _, let centres)? = planByEdge[run.id] {
                        for centre in centres {
                            root.addChild(
                                Self.bead(at: Self.simd(centre), color: color))
                        }
                    } else if let e = Self.cylinder(
                        from: a, to: b, radius: Self.runRadius, color: color)
                    {
                        root.addChild(e)
                    }
                case .wire:
                    for e in Self.dashes(from: a, to: b, color: color) { root.addChild(e) }
                case .hidden:
                    if let e = Self.cylinder(
                        from: a, to: b, radius: Self.runRadius * 2.5,
                        color: UIColor.gray.withAlphaComponent(0.35), translucent: true)
                    {
                        root.addChild(e)
                    }
                }
                let metres = Double(simd_distance(a, b))
                labelAnchors.append(
                    LabelAnchor(
                        id: "r-\(run.id)", kind: .runLength,
                        text: formatLength(metres, capture.unit),
                        world: (a + b) / 2))
            }
        }
        anchors = labelAnchors
        projectLabels()
    }

    // MARK: - Projection

    /// Moves every label to where its world position lands on screen this frame.
    private func projectLabels() {
        guard let arView, !anchors.isEmpty else {
            if !labels.isEmpty { labels = [] }
            return
        }
        let bounds = arView.bounds
        var next: [OverlayLabel] = []
        next.reserveCapacity(anchors.count)
        for a in anchors {
            guard let p = arView.project(a.world), bounds.contains(p) else { continue }
            next.append(OverlayLabel(id: a.id, kind: a.kind, text: a.text, screen: p))
        }
        if next != labels { labels = next }
    }

    // MARK: - Entities

    nonisolated static let amber = UIColor(red: 1.0, green: 0.75, blue: 0.0, alpha: 1)

    /// 16 distinct hues, one per `colorIndex` (0..<16).
    nonisolated static func color(forIndex index: Int) -> UIColor {
        let i = ((index % 16) + 16) % 16
        // Step by 7/16 of the wheel so neighbouring indexes are far apart.
        let hue = CGFloat((i * 7) % 16) / 16
        return UIColor(hue: hue, saturation: i % 2 == 0 ? 0.85 : 0.6, brightness: 0.95, alpha: 1)
    }

    private nonisolated static func simd(_ v: Vec3) -> SIMD3<Float> {
        SIMD3(Float(v.x), Float(v.y), Float(v.z))
    }

    private static func material(_ color: UIColor, translucent: Bool = false) -> UnlitMaterial {
        var m = UnlitMaterial(color: color)
        if translucent { m.blending = .transparent(opacity: .init(floatLiteral: 0.35)) }
        return m
    }

    private static func sphere(at p: SIMD3<Float>, radius: Float, color: UIColor) -> ModelEntity {
        let e = ModelEntity(
            mesh: .generateSphere(radius: radius), materials: [material(color)])
        e.position = p
        return e
    }

    /// One Bead: a small sphere glowing in its string's colour. `UnlitMaterial`
    /// renders the colour flat, unaffected by scene lighting, which reads as a
    /// steady emissive dot. There is no animation path, so Reduce Motion is
    /// honoured by construction (Req 16.16). A Bead is a drawing of where a
    /// light goes, never a lit LED.
    private static func bead(at p: SIMD3<Float>, color: UIColor) -> ModelEntity {
        sphere(at: p, radius: beadRadius, color: color)
    }

    /// An open-ended 8-sided tube along +y, centred on the origin. `MeshResource.generateCylinder`
    /// needs iOS 18, so this builds the same shape from a descriptor.
    private static func cylinderMesh(height: Float, radius: Float) -> MeshResource {
        let sides = 8
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        for i in 0..<sides {
            let a = Float(i) / Float(sides) * 2 * .pi
            let n = SIMD3<Float>(cos(a), 0, sin(a))
            positions.append(n * radius + SIMD3(0, -height / 2, 0))
            positions.append(n * radius + SIMD3(0, height / 2, 0))
            normals.append(n)
            normals.append(n)
        }
        for i in 0..<sides {
            let b0 = UInt32(i * 2), t0 = b0 + 1
            let b1 = UInt32(((i + 1) % sides) * 2), t1 = b1 + 1
            indices += [b0, b1, t0, t0, b1, t1]
            // Back faces too, so the tube reads from inside as well.
            indices += [b0, t0, b1, t0, t1, b1]
        }
        var d = MeshDescriptor(name: "tube")
        d.positions = MeshBuffers.Positions(positions)
        d.normals = MeshBuffers.Normals(normals)
        d.primitives = .triangles(indices)
        // The descriptor is valid by construction; a sphere is the safe fallback.
        return (try? MeshResource.generate(from: [d])) ?? .generateSphere(radius: radius)
    }

    /// A cylinder from `a` to `b`, or nil when they coincide.
    private static func cylinder(
        from a: SIMD3<Float>, to b: SIMD3<Float>, radius: Float, color: UIColor,
        translucent: Bool = false
    ) -> ModelEntity? {
        let d = b - a
        let len = simd_length(d)
        guard len.isFinite, len > 1e-5 else { return nil }
        let e = ModelEntity(
            mesh: cylinderMesh(height: len, radius: radius),
            materials: [material(color, translucent: translucent)])
        e.position = (a + b) / 2
        e.orientation = simd_quatf(from: SIMD3(0, 1, 0), to: d / len)
        return e
    }

    /// A chain of short cylinders along a→b.
    private static func dashes(from a: SIMD3<Float>, to b: SIMD3<Float>, color: UIColor)
        -> [ModelEntity]
    {
        let d = b - a
        let len = simd_length(d)
        guard len.isFinite, len > 1e-5 else { return [] }
        let dir = d / len
        var out: [ModelEntity] = []
        var t: Float = 0
        // Cap the count so a very long wire stays cheap.
        let step = max(dashLength + dashGap, len / 200)
        while t < len {
            let end = min(t + dashLength, len)
            if let e = cylinder(
                from: a + dir * t, to: a + dir * end, radius: runRadius * 0.8, color: color)
            {
                out.append(e)
            }
            t += step
        }
        return out
    }

    /// A ring of small dashes lying flat (horizontal) around `center`.
    private static func dashedRing(at center: SIMD3<Float>, color: UIColor) -> Entity {
        let ring = Entity()
        ring.position = center
        let segments = 12
        for i in 0..<segments {
            let a0 = Float(i) / Float(segments) * 2 * .pi
            let a1 = (Float(i) + 0.55) / Float(segments) * 2 * .pi
            let p0 = SIMD3(cos(a0), 0, sin(a0)) * ringRadius
            let p1 = SIMD3(cos(a1), 0, sin(a1)) * ringRadius
            if let e = cylinder(from: p0, to: p1, radius: runRadius * 0.7, color: color) {
                ring.addChild(e)
            }
        }
        return ring
    }
}

/// Draws the overlay's labels over the AR view. Place it above `ARViewContainer` in a ZStack.
struct SceneOverlayLabels: View {
    let overlay: SceneOverlay

    /// The AR view's own honest caption. The beads are a drawing of where
    /// lights go, not lit hardware, so this never says live or lit (Req 16.12, 16.21).
    static let caption = "Drawing"

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(overlay.labels) { label in
                Text(label.text)
                    .font(
                        .system(
                            label.kind == .index ? .caption2 : .caption, design: .monospaced
                        ).weight(.semibold)
                    )
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(
                        .black.opacity(label.kind == .index ? 0.55 : 0.4),
                        in: RoundedRectangle(cornerRadius: 4)
                    )
                    .fixedSize()
                    .position(label.screen)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Text(Self.caption)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.black.opacity(0.4), in: Capsule())
                .padding(8)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
