import Foundation

/// A marked wrap on the object. `pointId` is a `c<n>` id.
public struct WrapMark: Equatable, Sendable, Codable {
  public var pointId: String
  public var heightM: Double
  public var position: Vec3

  public init(pointId: String, heightM: Double, position: Vec3) {
    self.pointId = pointId
    self.heightM = heightM
    self.position = position
  }
}

public enum WrapMarkRefusal: Error, Equatable, Sendable {
  /// The reticle missed the object or hit outside [0, heightM].
  case outsideObject
  /// Within 0.01 m of the numbered mark.
  case tooCloseTo(number: Int)
}

public enum WrapMarks {
  public static let minGapM = 0.01

  /// Marks sorted by height, with the new mark added. Marks are numbered from 1 at the lowest.
  public static func place(
    ray: Ray, scan: ReferenceScan, marks: [WrapMark], newId: String
  ) -> Result<[WrapMark], WrapMarkRefusal> {
    guard let hit = intersect(ray: ray, scan: scan) else { return .failure(.outsideObject) }
    let h = hit.y - scan.axisBottom.y
    guard h.isFinite, h >= 0, h <= scan.heightM else { return .failure(.outsideObject) }
    let sorted = marks.sorted { $0.heightM < $1.heightM }
    // Refuse when closer than 0.01 m; a 1e-9 slack keeps an exact 0.01 m gap from failing on rounding.
    if let i = sorted.firstIndex(where: { abs($0.heightM - h) < minGapM - 1e-9 }) {
      return .failure(.tooCloseTo(number: i + 1))
    }
    var out = sorted
    out.append(WrapMark(pointId: newId, heightM: h, position: hit))
    out.sort { $0.heightM < $1.heightM }
    return .success(out)
  }

  /// Removes the mark. The caller adds `pointId` to `spiral.retiredIds`.
  public static func delete(pointId: String, marks: [WrapMark]) -> [WrapMark] {
    marks.filter { $0.pointId != pointId }
  }

  /// Marks in height order with numbers from 1 (lowest).
  public static func numbered(_ marks: [WrapMark]) -> [(number: Int, mark: WrapMark)] {
    marks.sorted { $0.heightM < $1.heightM }.enumerated().map { (number: $0.offset + 1, mark: $0.element) }
  }
}
