import Foundation

public enum ScanFailure: Error, Equatable, Sendable {
  /// Fewer than 100 vertices (Req 9.6).
  case tooFewVertices(Int)
  /// A 0.05 m band had no vertices (Req 9.6).
  case emptyBand(index: Int)
  /// Left and right points closer than 0.02 m (Req 9.8).
  case edgesTooClose(height: ScanHeight)
  /// Front point within 0.01 m of the left-right line (Req 9.8).
  case pointsInLine(height: ScanHeight)
  /// Cylinder radius outside 0.05 to 3 m or height outside 0.2 to 10 m, or planes with no height.
  case cylinderOutOfRange
}

public enum TypedCircumferenceError: Error, Equatable, Sendable {
  /// "Enter a length from {minText} to {maxText}", in the Capture's unit (Req 9.5).
  case outOfRange(minText: String, maxText: String)
}

public enum ReferenceScanFit {
  public static let minVertices = 100
  public static let rmsLowConfidenceM = 0.05
  public static let minEdgeM = 0.02
  public static let minLineOffsetM = 0.01
  public static let minCircumferenceM = 0.1
  public static let maxCircumferenceM = 30.0

  static func cylinderValid(_ c: ScanCylinder) -> Bool {
    c.axisX.isFinite && c.axisZ.isFinite && c.bottomY.isFinite
      && c.radiusM.isFinite && c.heightM.isFinite
      && c.radiusM >= 0.05 && c.radiusM <= 3
      && c.heightM >= 0.2 && c.heightM <= 10
  }

  // MARK: LiDAR

  public static func lidar(vertices: [Vec3], cylinder: ScanCylinder) -> Result<ReferenceScan, ScanFailure> {
    guard cylinderValid(cylinder) else { return .failure(.cylinderOutOfRange) }
    let pts = vertices.filter { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }
    guard pts.count >= minVertices else { return .failure(.tooFewVertices(pts.count)) }

    let (cx, cz) = kasaCentre(pts) ?? (cylinder.axisX, cylinder.axisZ)

    let bandCount = Int((cylinder.heightM / ReferenceScan.bandHeightM - 1e-9).rounded(.up))
    var sums = [Double](repeating: 0, count: bandCount)
    var counts = [Int](repeating: 0, count: bandCount)
    var members: [[Double]] = Array(repeating: [], count: bandCount)
    for p in pts {
      let rel = p.y - cylinder.bottomY
      guard rel >= 0, rel <= cylinder.heightM else { continue }
      let i = min(bandCount - 1, Int(rel / ReferenceScan.bandHeightM))
      let d = hypot(p.x - cx, p.z - cz)
      sums[i] += d
      counts[i] += 1
      members[i].append(d)
    }
    var bands: [RadiusBand] = []
    var sq = 0.0
    var n = 0
    for i in 0..<bandCount {
      guard counts[i] > 0 else { return .failure(.emptyBand(index: i)) }
      let r = sums[i] / Double(counts[i])
      bands.append(RadiusBand(y0: Double(i) * ReferenceScan.bandHeightM, radiusM: r))
      for d in members[i] { sq += (d - r) * (d - r) }
      n += counts[i]
    }
    let rms = (sq / Double(n)).squareRoot()
    let twoPi = 2 * Double.pi
    return .success(ReferenceScan(
      source: .lidar,
      axisBottom: Vec3(cx, cylinder.bottomY, cz),
      axisTop: Vec3(cx, cylinder.bottomY + cylinder.heightM, cz),
      bands: bands,
      bottom: CircumferenceValue(metres: twoPi * bands[0].radiusM, typed: false),
      top: CircumferenceValue(metres: twoPi * bands[bandCount - 1].radiusM, typed: false),
      rmsM: rms,
      lowConfidence: rms > rmsLowConfidenceM
    ))
  }

  /// Algebraic (Kåsa) least-squares circle centre on (x, z). Nil when the system is singular.
  static func kasaCentre(_ pts: [Vec3]) -> (Double, Double)? {
    let n = Double(pts.count)
    // Centre the data for numerical stability.
    let mx = pts.reduce(0) { $0 + $1.x } / n
    let mz = pts.reduce(0) { $0 + $1.z } / n
    var suu = 0.0, svv = 0.0, suv = 0.0, suuu = 0.0, svvv = 0.0, suvv = 0.0, svuu = 0.0
    for p in pts {
      let u = p.x - mx
      let v = p.z - mz
      suu += u * u
      svv += v * v
      suv += u * v
      suuu += u * u * u
      svvv += v * v * v
      suvv += u * v * v
      svuu += v * u * u
    }
    let det = suu * svv - suv * suv
    guard det.isFinite, abs(det) > 1e-12 else { return nil }
    let b1 = 0.5 * (suuu + suvv)
    let b2 = 0.5 * (svvv + svuu)
    let uc = (b1 * svv - b2 * suv) / det
    let vc = (suu * b2 - suv * b1) / det
    guard uc.isFinite, vc.isFinite else { return nil }
    return (mx + uc, mz + vc)
  }

  // MARK: Planes

  public static func planesHeight(
    left: Vec3, right: Vec3, front: Vec3
  ) -> Result<(center: Vec3, radiusM: Double), ScanFailure> {
    planesHeight(left: left, right: right, front: front, height: .bottom)
  }

  static func planesHeight(
    left: Vec3, right: Vec3, front: Vec3, height: ScanHeight
  ) -> Result<(center: Vec3, radiusM: Double), ScanFailure> {
    let chord = left.horizontalDistance(to: right)
    guard chord >= minEdgeM else { return .failure(.edgesTooClose(height: height)) }
    // Distance of front from the left-right line in (x, z).
    let cross = (right.x - left.x) * (front.z - left.z) - (right.z - left.z) * (front.x - left.x)
    guard abs(cross) / chord >= minLineOffsetM else { return .failure(.pointsInLine(height: height)) }

    let ax = left.x, az = left.z
    let bx = right.x - ax, bz = right.z - az
    let cx = front.x - ax, cz = front.z - az
    let d = 2 * (bx * cz - bz * cx)
    guard d != 0 else { return .failure(.pointsInLine(height: height)) }
    let b2 = bx * bx + bz * bz
    let c2 = cx * cx + cz * cz
    let ux = (cz * b2 - bz * c2) / d
    let uz = (bx * c2 - cx * b2) / d
    let centre = Vec3(ax + ux, (left.y + right.y + front.y) / 3, az + uz)
    return .success((centre, hypot(ux, uz)))
  }

  public static func planes(
    bottom: (Vec3, Vec3, Vec3), top: (Vec3, Vec3, Vec3)
  ) -> Result<ReferenceScan, ScanFailure> {
    let b: (center: Vec3, radiusM: Double)
    switch planesHeight(left: bottom.0, right: bottom.1, front: bottom.2, height: .bottom) {
    case .success(let v): b = v
    case .failure(let e): return .failure(e)
    }
    let t: (center: Vec3, radiusM: Double)
    switch planesHeight(left: top.0, right: top.1, front: top.2, height: .top) {
    case .success(let v): t = v
    case .failure(let e): return .failure(e)
    }
    guard t.center.y - b.center.y > 0 else { return .failure(.cylinderOutOfRange) }
    let twoPi = 2 * Double.pi
    return .success(ReferenceScan(
      source: .planes,
      axisBottom: b.center,
      axisTop: t.center,
      bottom: CircumferenceValue(metres: twoPi * b.radiusM, typed: false),
      top: CircumferenceValue(metres: twoPi * t.radiusM, typed: false)
    ))
  }

  // MARK: Typed

  public static func typed(
    cylinder: ScanCylinder, bottomCircumferenceM: Double, topCircumferenceM: Double
  ) -> ReferenceScan {
    ReferenceScan(
      source: .typedOnly,
      axisBottom: Vec3(cylinder.axisX, cylinder.bottomY, cylinder.axisZ),
      axisTop: Vec3(cylinder.axisX, cylinder.bottomY + cylinder.heightM, cylinder.axisZ),
      bottom: CircumferenceValue(metres: bottomCircumferenceM, typed: true),
      top: CircumferenceValue(metres: topCircumferenceM, typed: true)
    )
  }

  public static func applyTyped(
    _ scan: ReferenceScan, height: ScanHeight, text: String, unit: LayoutUnits
  ) -> Result<ReferenceScan, TypedCircumferenceError> {
    guard let m = parseLength(text, unit), m.isFinite,
      m >= minCircumferenceM, m <= maxCircumferenceM
    else {
      return .failure(.outOfRange(
        minText: formatLength(minCircumferenceM, unit),
        maxText: formatLength(maxCircumferenceM, unit)))
    }
    var next = scan
    let value = CircumferenceValue(metres: m, typed: true)
    switch height {
    case .bottom: next.bottom = value
    case .top: next.top = value
    }
    return .success(next)
  }
}
