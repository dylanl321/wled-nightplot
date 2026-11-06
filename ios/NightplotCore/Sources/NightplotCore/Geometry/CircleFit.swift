import Foundation

/// A circle in the horizontal (x, z) plane, in metres.
public struct Circle2D: Equatable, Sendable {
    public var cx: Double
    public var cz: Double
    public var radius: Double

    public init(cx: Double, cz: Double, radius: Double) {
        self.cx = cx
        self.cz = cz
        self.radius = radius
    }
}

public enum CircleFit {
    /// Algebraic (Kåsa) least-squares circle fit on (x, z) points.
    /// Works on a partial arc. Returns nil with fewer than 3 points, non-finite input,
    /// or points that are collinear (or all the same).
    public static func kasa(points: [(x: Double, z: Double)]) -> Circle2D? {
        let n = Double(points.count)
        guard points.count >= 3 else { return nil }
        guard points.allSatisfy({ $0.x.isFinite && $0.z.isFinite }) else { return nil }

        // Centre on the mean for numerical stability.
        let mx = points.reduce(0.0) { $0 + $1.x } / n
        let mz = points.reduce(0.0) { $0 + $1.z } / n

        var suu = 0.0, suv = 0.0, svv = 0.0
        var suuu = 0.0, svvv = 0.0, suvv = 0.0, svuu = 0.0
        for p in points {
            let u = p.x - mx
            let v = p.z - mz
            suu += u * u
            suv += u * v
            svv += v * v
            suuu += u * u * u
            svvv += v * v * v
            suvv += u * v * v
            svuu += v * u * u
        }

        let det = suu * svv - suv * suv
        let scale = max(suu * svv, 1e-300)
        guard det.isFinite, abs(det) > 1e-12 * scale else { return nil }

        let b1 = 0.5 * (suuu + suvv)
        let b2 = 0.5 * (svvv + svuu)
        let uc = (b1 * svv - b2 * suv) / det
        let vc = (suu * b2 - suv * b1) / det

        let r2 = uc * uc + vc * vc + (suu + svv) / n
        guard r2.isFinite, r2 > 0 else { return nil }
        return Circle2D(cx: mx + uc, cz: mz + vc, radius: r2.squareRoot())
    }

    /// Circle through three points on (x, z). Returns nil when the points are collinear
    /// or non-finite. Callers apply their own closeness thresholds before calling.
    public static func circumcircle(
        _ a: (x: Double, z: Double),
        _ b: (x: Double, z: Double),
        _ c: (x: Double, z: Double)
    ) -> Circle2D? {
        let all = [a.x, a.z, b.x, b.z, c.x, c.z]
        guard all.allSatisfy({ $0.isFinite }) else { return nil }

        // Translate so `a` is the origin.
        let bx = b.x - a.x, bz = b.z - a.z
        let cx = c.x - a.x, cz = c.z - a.z
        let d = 2 * (bx * cz - bz * cx)
        let scale = max(abs(bx * cz), abs(bz * cx), 1e-300)
        guard abs(d) > 1e-12 * scale else { return nil }

        let b2 = bx * bx + bz * bz
        let c2 = cx * cx + cz * cz
        let ux = (cz * b2 - bz * c2) / d
        let uz = (bx * c2 - cx * b2) / d
        let r = (ux * ux + uz * uz).squareRoot()
        guard r.isFinite, r > 0 else { return nil }
        return Circle2D(cx: a.x + ux, cz: a.z + uz, radius: r)
    }

    /// Circumcircle through three `Vec3` points using their (x, z).
    public static func circumcircle(_ a: Vec3, _ b: Vec3, _ c: Vec3) -> Circle2D? {
        circumcircle((a.x, a.z), (b.x, b.z), (c.x, c.z))
    }

    /// Kåsa fit on the (x, z) of `Vec3` points.
    public static func kasa(vertices: [Vec3]) -> Circle2D? {
        kasa(points: vertices.map { (x: $0.x, z: $0.z) })
    }
}
