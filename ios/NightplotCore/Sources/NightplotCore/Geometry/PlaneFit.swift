import Foundation

/// A drawing frame: an origin and two unit axes that map world points to drawing (x, y) in metres.
public struct ProjectionFrame: Equatable, Sendable {
    /// The first string's wire-in. `project(origin)` is exactly (0, 0).
    public var origin: Vec3
    /// Unit vector, drawing +x.
    public var right: Vec3
    /// Unit vector, drawing +y. (0, 1, 0) for a vertical fit, away from the operator for Flat.
    public var up: Vec3
    /// Unit vector toward the operator (vertical fit) or (0, 1, 0) (Flat).
    public var normal: Vec3

    public init(origin: Vec3, right: Vec3, up: Vec3, normal: Vec3) {
        self.origin = origin
        self.right = right
        self.up = up
        self.normal = normal
    }

    public func project(_ p: Vec3) -> (x: Double, y: Double) {
        let d = p - origin
        return (d.dot(right), d.dot(up))
    }
}

public enum PlaneFitError: Error, Equatable, Sendable {
    case noHorizontalSpread
    case noPoints
}

public enum PlaneFit {
    /// Minimum horizontal separation between two points for a vertical fit.
    static let minSpreadM = 0.05

    /// Least-squares vertical plane through the points, projecting along the plane normal.
    public static func vertical(
        points: [Vec3],
        origin: Vec3,
        devicePositions: [Vec3],
        deviceHeadings: [Vec3]
    ) -> Result<ProjectionFrame, PlaneFitError> {
        guard !points.isEmpty else { return .failure(.noPoints) }
        guard hasHorizontalSpread(points) else { return .failure(.noHorizontalSpread) }

        let n = Double(points.count)
        let mx = points.reduce(0) { $0 + $1.x } / n
        let mz = points.reduce(0) { $0 + $1.z } / n
        var a = 0.0, b = 0.0, c = 0.0
        for p in points {
            let dx = p.x - mx
            let dz = p.z - mz
            a += dx * dx
            b += dx * dz
            c += dz * dz
        }
        let trace = a + c
        let gap = ((a - c) * (a - c) + 4 * b * b).squareRoot()

        var along: Vec3
        if gap <= 1e-9 * trace {
            // Eigenvalues tie: use the horizontal direction from the origin to the farthest point.
            var best = origin
            var bestD = -1.0
            for p in points {
                let d = origin.horizontalDistance(to: p)
                if d > bestD {
                    bestD = d
                    best = p
                }
            }
            let dir = Vec3(best.x - origin.x, 0, best.z - origin.z)
            along = dir.normalized() ?? Vec3(1, 0, 0)
        } else {
            let theta = 0.5 * atan2(2 * b, a - c)
            along = Vec3(cos(theta), 0, sin(theta))
        }

        var normal = Vec3(-along.z, 0, along.x)
        let centroid = Vec3(mx, 0, mz)

        if let meanDevice = mean(devicePositions) {
            let toDevice = Vec3(meanDevice.x - centroid.x, 0, meanDevice.z - centroid.z)
            let s = normal.dot(toDevice)
            if abs(s) > 1e-6 {
                if s < 0 { normal = normal * -1 }
            } else if let h = mean(deviceHeadings) {
                // Camera looks at the plane, so the normal points against the heading.
                if normal.dot(h) > 0 { normal = normal * -1 }
            }
        } else if let h = mean(deviceHeadings), normal.dot(h) > 0 {
            normal = normal * -1
        }

        let yAxis = Vec3(0, 1, 0)
        let right = Vec3(normal.z, 0, -normal.x)
        return .success(ProjectionFrame(origin: origin, right: right, up: yAxis, normal: normal))
    }

    /// Horizontal plane through the wire-in, projecting along gravity.
    public static func flat(
        points: [Vec3],
        origin: Vec3,
        devicePositions: [Vec3],
        deviceHeadings: [Vec3]
    ) -> Result<ProjectionFrame, PlaneFitError> {
        guard !points.isEmpty else { return .failure(.noPoints) }

        let n = Double(points.count)
        let centroid = Vec3(
            points.reduce(0) { $0 + $1.x } / n,
            0,
            points.reduce(0) { $0 + $1.z } / n
        )

        var away: Vec3?
        if let meanDevice = mean(devicePositions) {
            let d = Vec3(centroid.x - meanDevice.x, 0, centroid.z - meanDevice.z)
            if d.length >= 0.05 { away = d.normalized() }
        }
        if away == nil, let h = mean(deviceHeadings) {
            away = Vec3(h.x, 0, h.z).normalized()
        }
        let awayDir = away ?? Vec3(0, 0, -1)

        let right = Vec3(-awayDir.z, 0, awayDir.x)
        return .success(
            ProjectionFrame(origin: origin, right: right, up: awayDir, normal: Vec3(0, 1, 0))
        )
    }

    /// Number of points more than `limitM` from the plane through the centroid along the frame normal.
    public static func offPlaneCount(points: [Vec3], frame: ProjectionFrame, limitM: Double) -> Int {
        guard !points.isEmpty else { return 0 }
        let n = Double(points.count)
        let m = Vec3(
            points.reduce(0) { $0 + $1.x } / n,
            points.reduce(0) { $0 + $1.y } / n,
            points.reduce(0) { $0 + $1.z } / n
        )
        return points.filter { abs(($0 - m).dot(frame.normal)) > limitM }.count
    }

    private static func hasHorizontalSpread(_ points: [Vec3]) -> Bool {
        for i in points.indices {
            for j in points.indices where j > i {
                if points[i].horizontalDistance(to: points[j]) >= minSpreadM { return true }
            }
        }
        return false
    }

    private static func mean(_ vs: [Vec3]) -> Vec3? {
        guard !vs.isEmpty else { return nil }
        let n = Double(vs.count)
        return Vec3(
            vs.reduce(0) { $0 + $1.x } / n,
            vs.reduce(0) { $0 + $1.y } / n,
            vs.reduce(0) { $0 + $1.z } / n
        )
    }
}
