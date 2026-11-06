import ARKit
import Foundation
import NightplotCore
import simd

/// Collects LiDAR mesh vertices for a reference scan (Req 9.1, 9.7).
///
/// Vertices are moved to world space, kept when inside the operator's
/// cylinder, and de-duplicated on a 5 mm grid. Collection pauses while
/// tracking is not normal and resumes with what it already holds.
@MainActor
final class MeshCollector {
    static let gridM = 0.005

    private struct Cell: Hashable {
        var x: Int32
        var y: Int32
        var z: Int32
    }

    private(set) var cylinder: ScanCylinder
    private var seen = Set<Cell>()
    private var points: [Vec3] = []

    /// True while collection is skipping frames because tracking is limited.
    private(set) var isPaused = false

    init(cylinder: ScanCylinder) {
        self.cylinder = cylinder
    }

    /// Unique vertices collected so far.
    var vertexCount: Int { points.count }

    /// Vertices to hand to `ReferenceScanFit.lidar`.
    var vertices: [Vec3] { points }

    func reset(cylinder: ScanCylinder? = nil) {
        if let cylinder { self.cylinder = cylinder }
        seen.removeAll(keepingCapacity: true)
        points.removeAll(keepingCapacity: true)
        isPaused = false
    }

    /// Reads every mesh anchor. Returns the number of new vertices added.
    @discardableResult
    func collect(from anchors: [ARAnchor], tracking: TrackingStatus) -> Int {
        guard tracking == .normal else {
            isPaused = true
            return 0
        }
        isPaused = false
        var added = 0
        for case let mesh as ARMeshAnchor in anchors {
            added += collect(mesh)
        }
        return added
    }

    private func collect(_ anchor: ARMeshAnchor) -> Int {
        let geometry = anchor.geometry.vertices
        guard geometry.count > 0, geometry.format == .float3 else { return 0 }
        let transform = anchor.transform
        let base = geometry.buffer.contents()
        let c = cylinder
        let r2 = c.radiusM * c.radiusM
        var added = 0
        for i in 0..<geometry.count {
            let raw = base.advanced(by: geometry.offset + geometry.stride * i)
                .assumingMemoryBound(to: Float.self)
            let world = transform * SIMD4<Float>(raw[0], raw[1], raw[2], 1)
            let x = Double(world.x), y = Double(world.y), z = Double(world.z)
            let rel = y - c.bottomY
            guard rel >= 0, rel <= c.heightM else { continue }
            let dx = x - c.axisX, dz = z - c.axisZ
            guard dx * dx + dz * dz <= r2 else { continue }
            let cell = Cell(
                x: Int32((x / Self.gridM).rounded(.down)),
                y: Int32((y / Self.gridM).rounded(.down)),
                z: Int32((z / Self.gridM).rounded(.down)))
            if seen.insert(cell).inserted {
                points.append(Vec3(x, y, z))
                added += 1
            }
        }
        return added
    }
}
