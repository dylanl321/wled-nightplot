import ARKit
import Foundation
import NightplotCore
import Observation
import RealityKit
import UIKit

/// Why the AR session stopped, in words the operator can act on.
struct ARStopReason: Equatable {
    var message: String
}

/// Whether the session is running, stopped, or not possible on this device.
enum ARSessionState: Equatable {
    case idle
    case running
    case stopped(ARStopReason)
    case unsupported
}

/// Owns the `ARView` and its session. It reports tracking to `AppModel` and
/// never writes the document directly.
@MainActor
@Observable
final class ARCaptureController: NSObject, ARSessionDelegate {
    private(set) var state: ARSessionState = .idle
    /// Fixed when the session first starts and kept for its life.
    private(set) var depthMode: DepthMode?

    @ObservationIgnored let arView: ARView
    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private let worldMaps: WorldMapStore

    /// True once relocalization has run for 10 s without finishing. The screen then offers
    /// "Reset tracking" (Req 3.7).
    private(set) var resetTrackingOffered = false

    /// Relocalization that has not finished is given this long before Reset tracking is offered.
    static let relocalizationPatience: Duration = .seconds(10)

    init(model: AppModel, worldMaps: WorldMapStore? = nil) {
        self.model = model
        self.worldMaps = worldMaps ?? .live()
        self.arView = ARView(frame: .zero)
        super.init()
        arView.automaticallyConfigureSession = false
        arView.session.delegate = self
        sceneOverlay = SceneOverlay(arView: arView, model: model)
    }

    /// Draws the open Capture; `SceneOverlayLabels(overlay:)` draws its labels.
    @ObservationIgnored private(set) var sceneOverlay: SceneOverlay!

    // MARK: - Start and restart

    /// Picks the depth mode from what ARKit reports and runs the session.
    /// Calling it again after a mode is chosen reuses that mode.
    func start() {
        let mode: DepthMode
        if let depthMode {
            mode = depthMode
        } else {
            let choice = chooseARSupport(
                worldTracking: ARWorldTrackingConfiguration.isSupported,
                meshReconstruction: ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh))
            switch choice {
            case .unsupported:
                state = .unsupported
                model?.tracking = .notAvailable
                return
            case .supported(let chosen):
                mode = chosen
                depthMode = chosen
            }
        }
        let worldMap = prepareCapture()
        observeBackgrounding()
        observeDocument()
        run(mode: mode, options: [], worldMap: worldMap)
    }

    /// Restart after a failure. Reuses the depth mode and keeps anchors.
    func restart() {
        guard let depthMode else { return start() }
        run(mode: depthMode, options: [.resetTracking])
    }

    /// Call when leaving the capture screen. Saves the world map first.
    func pause() {
        saveWorldMap()
        surfaceHitReader?.stop()
        arView.session.pause()
    }

    @ObservationIgnored private var surfaceHitReader: SurfaceHitReader?

    private func startSurfaceHitReader(mode: DepthMode) {
        if surfaceHitReader == nil {
            surfaceHitReader = SurfaceHitReader(
                arView: arView, depthMode: mode,
                tracking: { [weak self] in self?.model?.tracking ?? .notAvailable },
                report: { [weak self] hit in self?.model?.currentHit = hit })
        }
        surfaceHitReader?.start()
    }

    private func run(mode: DepthMode, options: ARSession.RunOptions, worldMap: ARWorldMap? = nil) {
        let config = Self.configuration(for: mode)
        config.initialWorldMap = worldMap
        arView.session.run(config, options: options)
        startSurfaceHitReader(mode: mode)
        state = .running
        lastTracking = .limited(.initializing)
        model?.tracking = .limited(.initializing)
    }

    static func configuration(for mode: DepthMode) -> ARWorldTrackingConfiguration {
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal, .vertical]
        if mode == .lidar {
            config.sceneReconstruction = .mesh
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
        }
        return config
    }

    // MARK: - Tracking mapping

    nonisolated static func status(for camera: ARCamera.TrackingState) -> TrackingStatus {
        switch camera {
        case .normal: return .normal
        case .notAvailable: return .notAvailable
        case .limited(let reason):
            switch reason {
            case .initializing: return .limited(.initializing)
            case .excessiveMotion: return .limited(.excessiveMotion)
            case .insufficientFeatures: return .limited(.insufficientFeatures)
            case .relocalizing: return .limited(.relocalizing)
            @unknown default: return .limited(.insufficientFeatures)
            }
        }
    }

    // MARK: - ARSessionDelegate

    nonisolated func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        let mapped = Self.status(for: camera.trackingState)
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.state == .running else { return }
                self.trackingChanged(to: mapped)
            }
        }
    }

    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        // Only the Capture_Point anchors carry a name.
        let moved: [(String, Vec3)] = anchors.compactMap { anchor in
            guard let name = anchor.name else { return nil }
            let c = anchor.transform.columns.3
            return (name, Vec3(Double(c.x), Double(c.y), Double(c.z)))
        }
        guard !moved.isEmpty else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.anchorsMoved(moved) }
        }
    }

    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        let message = "Camera tracking stopped: \(error.localizedDescription)"
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.state = .stopped(ARStopReason(message: message))
                self.model?.tracking = .notAvailable
                self.model?.currentHit = nil
            }
        }
    }

    nonisolated func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool {
        true
    }

    // MARK: - Anchors and relocalization (Req 3.7, 3.9)

    @ObservationIgnored private var lastTracking: TrackingStatus = .notAvailable
    @ObservationIgnored private var relocalizationTimer: Task<Void, Never>?
    /// True from resuming with a saved world map until the first anchor check.
    @ObservationIgnored private var awaitingRelocalizationCheck = false
    @ObservationIgnored private var preparedDraftId: UUID?
    @ObservationIgnored private var observingDocument = false
    @ObservationIgnored private var backgroundObserver: NSObjectProtocol?

    private static func isRelocalizing(_ status: TrackingStatus) -> Bool {
        if case .limited(.relocalizing) = status { return true }
        return false
    }

    private static func isNormal(_ status: TrackingStatus) -> Bool {
        if case .normal = status { return true }
        return false
    }

    /// On first start for a Capture: load its world map when it has points. With points and
    /// no map, AR placement is disabled for it. Opening without AR never marks anchors lost.
    private func prepareCapture() -> ARWorldMap? {
        guard let model, let document = model.document, preparedDraftId != document.draftId else {
            return nil
        }
        preparedDraftId = document.draftId
        model.worldMapMissing = false
        awaitingRelocalizationCheck = false
        guard !document.capture.points.isEmpty else { return nil }
        if let map = worldMaps.load(draftId: document.draftId) {
            awaitingRelocalizationCheck = true
            return map
        }
        model.worldMapMissing = true
        return nil
    }

    private func trackingChanged(to status: TrackingStatus) {
        let wasRelocalizing = Self.isRelocalizing(lastTracking)
        lastTracking = status
        model?.tracking = status

        if Self.isRelocalizing(status) {
            if relocalizationTimer == nil {
                relocalizationTimer = Task { [weak self] in
                    try? await Task.sleep(for: Self.relocalizationPatience)
                    guard !Task.isCancelled else { return }
                    self?.resetTrackingOffered = true
                }
            }
        } else {
            relocalizationTimer?.cancel()
            relocalizationTimer = nil
            resetTrackingOffered = false
        }

        if Self.isNormal(status), wasRelocalizing || awaitingRelocalizationCheck {
            markMissingAnchorsLost()
        }
        reconcileAnchors()
    }

    /// Compares the session's anchor names with every live point's `anchorId`. Ids that are
    /// not there are lost.
    private func markMissingAnchorsLost() {
        awaitingRelocalizationCheck = false
        guard let model, let document = model.document else { return }
        let live = Set((arView.session.currentFrame?.anchors ?? []).compactMap(\.name))
        let missing = document.capture.points.map(\.anchorId)
            .filter { !document.lostAnchorIds.contains($0) && !live.contains($0) }
        if !missing.isEmpty { model.markAnchorsLost(missing) }
    }

    /// "Reset tracking": starts over with no anchors. Every live point becomes unanchored.
    func resetTracking() {
        guard let depthMode, let model else { return }
        relocalizationTimer?.cancel()
        relocalizationTimer = nil
        resetTrackingOffered = false
        awaitingRelocalizationCheck = false
        pendingAnchorIds.removeAll()
        if let document = model.document {
            model.markAnchorsLost(document.capture.points.map(\.anchorId))
        }
        // The new frame has no map, so the old one cannot block placement any more.
        model.worldMapMissing = false
        run(mode: depthMode, options: [.resetTracking, .removeExistingAnchors])
    }

    /// ARKit refined an anchor. The point follows it, with no undo step.
    private func anchorsMoved(_ moved: [(String, Vec3)]) {
        guard let model, let document = model.document else { return }
        for (anchorId, position) in moved {
            guard let point = document.capture.points.first(where: { $0.anchorId == anchorId }),
                !document.lostAnchorIds.contains(anchorId)
            else { continue }
            let p = point.position
            let distance = max(abs(p.x - position.x), abs(p.y - position.y), abs(p.z - position.z))
            if distance > 1e-4 { model.anchorMoved(anchorId: anchorId, position: position) }
        }
    }

    /// Makes the session's anchors match the live points: adds a missing one unless its id is
    /// lost, and removes one whose point is gone. Runs after every edit, Undo and Redo.
    /// It waits for normal tracking and for the post-resume anchor check, so a point is never
    /// re-anchored into the wrong frame.
    func reconcileAnchors() {
        guard state == .running, let model, let document = model.document,
            Self.isNormal(model.tracking), !awaitingRelocalizationCheck
        else { return }
        let session = arView.session
        let existing = (session.currentFrame?.anchors ?? []).filter { $0.name != nil }
        let present = Set(existing.compactMap(\.name))
        let liveIds = Set(document.capture.points.map(\.anchorId))

        for anchor in existing where type(of: anchor) == ARAnchor.self {
            if let name = anchor.name, !liveIds.contains(name) { session.remove(anchor: anchor) }
        }
        for point in document.capture.points
        where !document.lostAnchorIds.contains(point.anchorId)
            && !present.contains(point.anchorId) && !pendingAnchorIds.contains(point.anchorId)
        {
            var transform = matrix_identity_float4x4
            transform.columns.3 = SIMD4(
                Float(point.position.x), Float(point.position.y), Float(point.position.z), 1)
            session.add(anchor: ARAnchor(name: point.anchorId, transform: transform))
            pendingAnchorIds.insert(point.anchorId)
        }
        // An anchor added this pass shows up in `currentFrame` on a later frame.
        pendingAnchorIds.formIntersection(liveIds.subtracting(present))
    }

    /// Anchors added but not yet seen in a frame, so they are not added twice.
    @ObservationIgnored private var pendingAnchorIds = Set<String>()

    /// Re-runs `reconcileAnchors` whenever the document or tracking changes.
    private func observeDocument() {
        guard !observingDocument else { return }
        observingDocument = true
        armDocumentObservation()
    }

    private func armDocumentObservation() {
        withObservationTracking {
            _ = model?.document
            _ = model?.tracking
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.reconcileAnchors()
                self.armDocumentObservation()
            }
        }
    }

    // MARK: - World map (Req 3.2)

    private func observeBackgrounding() {
        guard backgroundObserver == nil else { return }
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.saveWorldMap() }
        }
    }

    /// Saves the current world map beside the draft. It skips a Capture with no points, one
    /// whose old map is missing, and one still waiting to relocalize, because none of those
    /// maps would share a frame with the saved points.
    func saveWorldMap() {
        guard state == .running, let model, let document = model.document,
            !document.capture.points.isEmpty, !model.worldMapMissing,
            !awaitingRelocalizationCheck
        else { return }
        let store = worldMaps
        let draftId = document.draftId
        arView.session.getCurrentWorldMap { @Sendable map, _ in
            // ARKit refuses while it has mapped too little. The previous map stays.
            guard let map else { return }
            try? store.save(map, draftId: draftId)
        }
    }
}
