import Foundation

/// Nearest-point search used for the reuse offer (Req 5.3).
public enum Proximity {
  /// Default reuse radius in metres.
  public static let defaultRadiusM: Double = 0.03

  /// The nearest point within `radius` (inclusive) of `position`, and the ids of the
  /// strings that already use it, in string order. Returns nil when no point is that close.
  /// Ties go to the point that comes first in `capture.points`.
  public static func nearest(
    to position: Vec3,
    in capture: Capture,
    within radius: Double = defaultRadiusM
  ) -> (pointId: String, stringIds: [String])? {
    var best: (id: String, distance: Double)?
    for point in capture.points {
      let d = (point.position - position).length
      guard d.isFinite, d <= radius else { continue }
      if best == nil || d < best!.distance {
        best = (point.id, d)
      }
    }
    guard let found = best else { return nil }
    let stringIds = capture.strings
      .filter { $0.pointIds.contains(found.id) }
      .map(\.id)
    return (found.id, stringIds)
  }
}
