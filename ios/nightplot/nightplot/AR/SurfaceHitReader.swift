import ARKit
import Combine
import CoreVideo
import Foundation
import NightplotCore
import RealityKit
import UIKit

/// Raycasts from the screen centre at 15 Hz while tracking is normal, turns the
/// result into a `SurfaceHit`, and moves the reticle entity in the same frame.
/// Reports nil when nothing is hit or tracking is not normal.
@MainActor
final class SurfaceHitReader {
    /// Req 3.3 asks for at least 10 per second.
    static let rateHz: Double = 15

    private let arView: ARView
    private let depthMode: DepthMode
    private let tracking: () -> TrackingStatus
    private let report: (SurfaceHit?) -> Void
    private let reticle: AnchorEntity
    private var subscription: Cancellable?
    private var lastRun: TimeInterval = 0

    init(
        arView: ARView,
        depthMode: DepthMode,
        tracking: @escaping () -> TrackingStatus,
        report: @escaping (SurfaceHit?) -> Void
    ) {
        self.arView = arView
        self.depthMode = depthMode
        self.tracking = tracking
        self.report = report
        self.reticle = AnchorEntity(world: .zero)
        let marker = ModelEntity(
            mesh: .generateSphere(radius: 0.006),
            materials: [UnlitMaterial(color: .white)])
        reticle.addChild(marker)
        reticle.isEnabled = false
    }

    func start() {
        guard subscription == nil else { return }
        arView.scene.addAnchor(reticle)
        subscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    func stop() {
        subscription?.cancel()
        subscription = nil
        reticle.removeFromParent()
        reticle.isEnabled = false
        report(nil)
    }

    private func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastRun >= 1.0 / Self.rateHz else { return }
        lastRun = now
        guard tracking() == .normal, let hit = read() else {
            reticle.isEnabled = false
            report(nil)
            return
        }
        reticle.position = SIMD3<Float>(
            Float(hit.position.x), Float(hit.position.y), Float(hit.position.z))
        reticle.isEnabled = true
        report(hit)
    }

    private func read() -> SurfaceHit? {
        guard let frame = arView.session.currentFrame, arView.bounds.width > 0 else { return nil }
        let centre = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)

        // Existing plane geometry first, then the estimated plane.
        var result: ARRaycastResult?
        var kind: SurfaceKind = depthMode == .lidar ? .mesh : .estimated
        if let query = arView.makeRaycastQuery(from: centre, allowing: .existingPlaneGeometry, alignment: .any),
            let first = arView.session.raycast(query).first
        {
            result = first
            kind = .plane
        } else if let query = arView.makeRaycastQuery(from: centre, allowing: .estimatedPlane, alignment: .any),
            let first = arView.session.raycast(query).first
        {
            result = first
        }
        guard let result else { return nil }

        let hit = result.worldTransform.columns.3
        let cam = frame.camera.transform
        let camPos = cam.columns.3
        let position = Vec3(Double(hit.x), Double(hit.y), Double(hit.z))
        let device = Vec3(Double(camPos.x), Double(camPos.y), Double(camPos.z))
        let distance = sqrt(
            pow(position.x - device.x, 2) + pow(position.y - device.y, 2) + pow(position.z - device.z, 2))

        // Camera forward is -z; flatten to the horizontal plane.
        let fx = Double(-cam.columns.2.x)
        let fz = Double(-cam.columns.2.z)
        let len = (fx * fx + fz * fz).squareRoot()
        let heading = len > 1e-6 ? Vec3(fx / len, 0, fz / len) : Vec3(0, 0, -1)

        let confidence = kind == .mesh ? depthConfidence(frame: frame, at: centre) : nil
        return SurfaceHit(
            position: position,
            kind: kind,
            uncertaintyM: estimateUncertainty(kind: kind, distanceM: distance, depthConfidence: confidence),
            distanceM: distance,
            devicePosition: device,
            deviceHeading: heading)
    }

    /// Samples the LiDAR confidence map under the reticle. Nil when there is none.
    private func depthConfidence(frame: ARFrame, at viewPoint: CGPoint) -> DepthConfidence? {
        guard let map = frame.sceneDepth?.confidenceMap else { return nil }
        let size = arView.bounds.size
        let orientation = arView.window?.windowScene?.interfaceOrientation ?? .portrait
        let toView = frame.displayTransform(for: orientation, viewportSize: size)
        let normalized = viewPoint
            .applying(CGAffineTransform(scaleX: 1 / size.width, y: 1 / size.height))
            .applying(toView.inverted())
        guard (0...1).contains(normalized.x), (0...1).contains(normalized.y) else { return nil }

        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        let w = CVPixelBufferGetWidth(map)
        let h = CVPixelBufferGetHeight(map)
        let x = min(w - 1, max(0, Int(normalized.x * CGFloat(w))))
        let y = min(h - 1, max(0, Int(normalized.y * CGFloat(h))))
        let row = base.advanced(by: y * CVPixelBufferGetBytesPerRow(map))
        let value = row.assumingMemoryBound(to: UInt8.self)[x]
        switch ARConfidenceLevel(rawValue: Int(value)) {
        case .high: return .high
        case .medium: return .medium
        default: return .low
        }
    }
}
