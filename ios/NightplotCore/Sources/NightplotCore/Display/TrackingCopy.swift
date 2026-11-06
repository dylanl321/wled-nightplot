import Foundation

/// Camera tracking state, mapped from ARKit in the app target.
public enum TrackingStatus: Equatable, Sendable {
  case normal
  case limited(LimitedReason)
  case notAvailable
}

public enum LimitedReason: Sendable { case initializing, excessiveMotion, insufficientFeatures, relocalizing }

/// Plain-words tracking copy. `nil` when tracking is normal.
public func trackingMessage(_ status: TrackingStatus) -> String? {
  switch status {
  case .normal: return nil
  case .limited(.initializing): return "Starting up. Move the phone slowly."
  case .limited(.excessiveMotion): return "Moving too fast. Slow down."
  case .limited(.insufficientFeatures):
    return "Not enough detail here. Point at something with texture, or add light."
  case .limited(.relocalizing): return "Finding where you were. Point back at the area you captured."
  case .notAvailable: return "Tracking is not available."
  }
}

public enum SurfaceKind: String, Codable, Sendable { case mesh, plane, estimated }

public struct SurfaceHit: Equatable, Sendable {
  public var position: Vec3
  public var kind: SurfaceKind
  public var uncertaintyM: Double
  /// Camera to hit, metres.
  public var distanceM: Double
  public var devicePosition: Vec3
  /// Horizontal unit vector of the camera's forward axis.
  public var deviceHeading: Vec3

  public init(
    position: Vec3, kind: SurfaceKind, uncertaintyM: Double, distanceM: Double,
    devicePosition: Vec3, deviceHeading: Vec3
  ) {
    self.position = position
    self.kind = kind
    self.uncertaintyM = uncertaintyM
    self.distanceM = distanceM
    self.devicePosition = devicePosition
    self.deviceHeading = deviceHeading
  }

  /// Above 0.05 m the reticle shows a low-confidence mark (Req 3.6).
  public var isLowConfidence: Bool { uncertaintyM > 0.05 }
}

public enum DepthConfidence: Sendable { case low, medium, high }

/// A stated estimate, not a measurement. ARKit gives no error bar for a raycast.
/// - mesh: depth confidence (high 0.01, medium 0.03, low 0.08; none is treated as low) + 0.005 m per metre
/// - plane: 0.02 m + 0.005 m per metre
/// - estimated: 0.05 m + 0.01 m per metre
public func estimateUncertainty(kind: SurfaceKind, distanceM: Double, depthConfidence: DepthConfidence?) -> Double {
  let d = max(0, distanceM)
  switch kind {
  case .mesh:
    let base: Double
    switch depthConfidence {
    case .high: base = 0.01
    case .medium: base = 0.03
    case .low, .none: base = 0.08
    }
    return base + 0.005 * d
  case .plane:
    return 0.02 + 0.005 * d
  case .estimated:
    return 0.05 + 0.01 * d
  }
}

/// Place Point is enabled only with normal tracking and a surface hit (Req 3.1, 3.4, 3.8).
public func placePointEnabled(tracking: TrackingStatus, hit: SurfaceHit?) -> Bool {
  tracking == .normal && hit != nil
}
