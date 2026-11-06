import Foundation

/// A ray from the camera through the reticle. `direction` is expected to be a unit vector.
public struct Ray: Equatable, Sendable {
    public var origin: Vec3
    public var direction: Vec3

    public init(origin: Vec3, direction: Vec3) {
        self.origin = origin
        self.direction = direction
    }
}

/// First point where `ray` enters the fitted object, or nil for a miss.
///
/// Marches in 5 mm steps out to `maxDistanceM`. A sample is inside when its height above the axis
/// bottom is within [0, heightM] and its horizontal distance to the axis is at most r(h). The first
/// inside sample is refined by bisection to 1 mm, keeping the inside end so the result is on the
/// object and inside the height range.
public func intersect(ray: Ray, scan: ReferenceScan, maxDistanceM: Double = 15) -> Vec3? {
  let step = 0.005
  let tolerance = 0.001
  guard maxDistanceM.isFinite, maxDistanceM >= 0 else { return nil }
  let axis = scan.axisBottom

  func point(_ t: Double) -> Vec3 { ray.origin + ray.direction * t }
  func inside(_ p: Vec3) -> Bool {
    guard p.x.isFinite, p.y.isFinite, p.z.isFinite else { return false }
    guard let r = scan.radius(atHeight: p.y - axis.y) else { return false }
    return p.horizontalDistance(to: axis) <= r
  }

  var previous = 0.0
  var t = 0.0
  while true {
    if inside(point(t)) {
      var lo = previous
      var hi = t
      while hi - lo > tolerance {
        let mid = (lo + hi) / 2
        if inside(point(mid)) { hi = mid } else { lo = mid }
      }
      return point(hi)
    }
    if t >= maxDistanceM { return nil }
    previous = t
    t = min(t + step, maxDistanceM)
  }
}
