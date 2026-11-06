/// How the AR session finds surfaces. Fixed for the life of a session.
public enum DepthMode: String, Codable, Sendable { case lidar, planes }

/// Device support for capture.
public enum ARSupport: Equatable, Sendable {
  case unsupported
  case supported(DepthMode)
}

/// Chooses the depth mode from what ARKit reports.
/// No world tracking is unsupported, whatever the mesh flag says.
public func chooseARSupport(worldTracking: Bool, meshReconstruction: Bool) -> ARSupport {
  guard worldTracking else { return .unsupported }
  return .supported(meshReconstruction ? .lidar : .planes)
}

/// Camera authorization, mapped from the platform status in the app target.
public enum CameraAuthStatus: Equatable, Sendable {
  case notDetermined, authorized, denied, restricted
}

public enum CameraGateAction: Equatable, Sendable {
  case requestOnce, startSession, showNeedsAccess
}

/// Decides what the capture screen does about the camera.
/// The system prompt is shown at most once: if it was already requested and the
/// status is still not determined, the screen shows the needs-access state
/// rather than prompting again.
public func cameraGate(_ status: CameraAuthStatus, alreadyRequested: Bool) -> CameraGateAction {
  switch status {
  case .authorized: return .startSession
  case .denied, .restricted: return .showNeedsAccess
  case .notDetermined: return alreadyRequested ? .showNeedsAccess : .requestOnce
  }
}
