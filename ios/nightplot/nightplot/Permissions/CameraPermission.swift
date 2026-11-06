import AVFoundation
import Foundation
import NightplotCore
import Observation
import UIKit

/// Source of camera authorization. The platform implementation wraps
/// `AVCaptureDevice`; tests substitute their own.
nonisolated protocol CameraAuthorizing {
  var status: CameraAuthStatus { get }
  /// Shows the system prompt. Returns true when access was granted.
  func request() async -> Bool
}

nonisolated struct AVCameraAuthorizer: CameraAuthorizing {
  var status: CameraAuthStatus {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return .authorized
    case .denied: return .denied
    case .restricted: return .restricted
    case .notDetermined: return .notDetermined
    @unknown default: return .restricted
    }
  }

  func request() async -> Bool {
    await AVCaptureDevice.requestAccess(for: .video)
  }
}

/// Drives `cameraGate` for the capture screen. Call `refresh()` on screen
/// appear; it also re-evaluates after the prompt returns and whenever the app
/// becomes active again (for example after a trip to Settings).
@MainActor
@Observable
final class CameraPermissionController {
  private(set) var status: CameraAuthStatus
  private(set) var action: CameraGateAction
  private var alreadyRequested = false
  @ObservationIgnored private let authorizer: CameraAuthorizing
  @ObservationIgnored private var activeObserver: NSObjectProtocol?

  init(
    authorizer: CameraAuthorizing = AVCameraAuthorizer(),
    notificationCenter: NotificationCenter = .default
  ) {
    self.authorizer = authorizer
    let current = authorizer.status
    status = current
    action = cameraGate(current, alreadyRequested: false)
    activeObserver = notificationCenter.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.evaluate() }
    }
  }

  deinit {
    if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
  }

  /// Re-reads the status and, when the gate says so, shows the prompt once.
  func refresh() async {
    evaluate()
    guard action == .requestOnce else { return }
    alreadyRequested = true
    _ = await authorizer.request()
    evaluate()
  }

  private func evaluate() {
    status = authorizer.status
    action = cameraGate(status, alreadyRequested: alreadyRequested)
  }

  /// Opens this app's page in Settings.
  func openSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
  }
}
