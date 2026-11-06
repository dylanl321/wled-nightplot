import Foundation

/// A world-space vector in metres. +y is up.
public struct Vec3: Equatable, Hashable, Sendable, Codable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.init(x: x, y: y, z: z)
    }

    public static let zero = Vec3(x: 0, y: 0, z: 0)

    public static func + (a: Vec3, b: Vec3) -> Vec3 {
        Vec3(x: a.x + b.x, y: a.y + b.y, z: a.z + b.z)
    }

    public static func - (a: Vec3, b: Vec3) -> Vec3 {
        Vec3(x: a.x - b.x, y: a.y - b.y, z: a.z - b.z)
    }

    public static func * (v: Vec3, s: Double) -> Vec3 {
        Vec3(x: v.x * s, y: v.y * s, z: v.z * s)
    }

    public static func * (s: Double, v: Vec3) -> Vec3 {
        v * s
    }

    public func add(_ o: Vec3) -> Vec3 { self + o }
    public func subtract(_ o: Vec3) -> Vec3 { self - o }
    public func scale(_ s: Double) -> Vec3 { self * s }

    public func dot(_ o: Vec3) -> Double {
        x * o.x + y * o.y + z * o.z
    }

    public func cross(_ o: Vec3) -> Vec3 {
        Vec3(
            x: y * o.z - z * o.y,
            y: z * o.x - x * o.z,
            z: x * o.y - y * o.x
        )
    }

    public var length: Double {
        dot(self).squareRoot()
    }

    /// Distance in the horizontal (x, z) plane to another point.
    public func horizontalDistance(to o: Vec3) -> Double {
        let dx = x - o.x
        let dz = z - o.z
        return (dx * dx + dz * dz).squareRoot()
    }

    /// Unit vector in the same direction, or nil when the length is zero or not finite.
    public func normalized() -> Vec3? {
        let l = length
        guard l.isFinite, l > 0 else { return nil }
        return self * (1 / l)
    }
}
