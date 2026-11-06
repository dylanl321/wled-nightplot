import Foundation

/// Operator-placed cylinder, in world metres.
public struct ScanCylinder: Equatable, Sendable, Codable {
  public var axisX: Double
  public var axisZ: Double
  public var bottomY: Double
  /// 0.2 ... 10
  public var heightM: Double
  /// 0.05 ... 3
  public var radiusM: Double

  public init(axisX: Double, axisZ: Double, bottomY: Double, heightM: Double, radiusM: Double) {
    self.axisX = axisX
    self.axisZ = axisZ
    self.bottomY = bottomY
    self.heightM = heightM
    self.radiusM = radiusM
  }
}

/// A 0.05 m band from the bottom of the cylinder.
public struct RadiusBand: Equatable, Sendable, Codable {
  public var y0: Double
  public var radiusM: Double

  public init(y0: Double, radiusM: Double) {
    self.y0 = y0
    self.radiusM = radiusM
  }
}

public enum ScanSource: String, Codable, Sendable { case lidar, planes, typedOnly }

public enum ScanHeight: Sendable { case bottom, top }

public struct CircumferenceValue: Equatable, Sendable, Codable {
  public var metres: Double
  public var typed: Bool

  public init(metres: Double, typed: Bool) {
    self.metres = metres
    self.typed = typed
  }
}

/// Data only. Fitting and radius lookup come with the Spiral analyzer.
public struct ReferenceScan: Equatable, Sendable, Codable {
  public var source: ScanSource
  public var axisBottom: Vec3
  public var axisTop: Vec3
  /// Lidar only.
  public var bands: [RadiusBand]
  public var bottom: CircumferenceValue
  public var top: CircumferenceValue
  /// Lidar only.
  public var rmsM: Double?
  /// True when rms is above 0.05 m.
  public var lowConfidence: Bool

  public var heightM: Double { axisTop.y - axisBottom.y }

  /// Radius in metres at `h` metres above the axis bottom, or nil outside [0, heightM].
  ///
  /// Lidar: linear between band centres (clamped at the ends), then scaled by a factor that is
  /// linear in height so the ends match the stored circumferences exactly. Planes and typed-only:
  /// linear between the bottom and top radii.
  public func radius(atHeight h: Double) -> Double? {
    let height = heightM
    guard h.isFinite, height.isFinite, height > 0, h >= 0, h <= height else { return nil }
    let rBottom = bottom.metres / (2 * Double.pi)
    let rTop = top.metres / (2 * Double.pi)
    let t = h / height
    guard source == .lidar, !bands.isEmpty else {
      return rBottom + (rTop - rBottom) * t
    }
    let scannedBottom = scannedRadius(at: 0)
    let scannedTop = scannedRadius(at: height)
    let kBottom = scannedBottom > 0 ? rBottom / scannedBottom : 1
    let kTop = scannedTop > 0 ? rTop / scannedTop : 1
    return scannedRadius(at: h) * (kBottom + (kTop - kBottom) * t)
  }

  /// Band profile as scanned, interpolated between band centres and clamped past the first and last.
  func scannedRadius(at h: Double) -> Double {
    let centre = { (b: RadiusBand) in b.y0 + ReferenceScan.bandHeightM / 2 }
    guard let first = bands.first, let last = bands.last else { return 0 }
    if h <= centre(first) { return first.radiusM }
    if h >= centre(last) { return last.radiusM }
    for i in 1..<bands.count {
      let c1 = centre(bands[i])
      if h <= c1 {
        let c0 = centre(bands[i - 1])
        let span = c1 - c0
        if span <= 0 { return bands[i].radiusM }
        let u = (h - c0) / span
        return bands[i - 1].radiusM + (bands[i].radiusM - bands[i - 1].radiusM) * u
      }
    }
    return last.radiusM
  }

  public static let bandHeightM = 0.05

  public init(
    source: ScanSource,
    axisBottom: Vec3,
    axisTop: Vec3,
    bands: [RadiusBand] = [],
    bottom: CircumferenceValue,
    top: CircumferenceValue,
    rmsM: Double? = nil,
    lowConfidence: Bool = false
  ) {
    self.source = source
    self.axisBottom = axisBottom
    self.axisTop = axisTop
    self.bands = bands
    self.bottom = bottom
    self.top = top
    self.rmsM = rmsM
    self.lowConfidence = lowConfidence
  }

  private enum CodingKeys: String, CodingKey {
    case source, axisBottom, axisTop, bands, bottom, top, rmsM, lowConfidence
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    source = try c.decode(ScanSource.self, forKey: .source)
    axisBottom = try c.decode(Vec3.self, forKey: .axisBottom)
    axisTop = try c.decode(Vec3.self, forKey: .axisTop)
    bands = try c.decode([RadiusBand].self, forKey: .bands)
    bottom = try c.decode(CircumferenceValue.self, forKey: .bottom)
    top = try c.decode(CircumferenceValue.self, forKey: .top)
    rmsM = try c.decodeIfPresent(Double.self, forKey: .rmsM)
    lowConfidence = try c.decode(Bool.self, forKey: .lowConfidence)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(source, forKey: .source)
    try c.encode(axisBottom, forKey: .axisBottom)
    try c.encode(axisTop, forKey: .axisTop)
    try c.encode(bands, forKey: .bands)
    try c.encode(bottom, forKey: .bottom)
    try c.encode(top, forKey: .top)
    try c.encodeIfPresent(rmsM, forKey: .rmsM)
    try c.encode(lowConfidence, forKey: .lowConfidence)
  }
}
