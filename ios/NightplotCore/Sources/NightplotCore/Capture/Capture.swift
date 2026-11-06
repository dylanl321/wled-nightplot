import Foundation

/// Prop kind the operator picks for a Capture. Raw values match the web editor.
public enum PropKindChoice: String, Codable, Sendable, CaseIterable {
  case roofline, window, arch, tree, stakeRow = "stake-row", spiral, zigzag, custom
}

/// The undoable part of a Capture document.
/// Optionals are encoded with `encodeIfPresent`, so absent values are omitted, never `null`.
public struct Capture: Equatable, Sendable, Codable {
  public var label: String
  public var kind: PropKindChoice
  public var unit: LayoutUnits
  public var spacingM: Double?
  public var ledProductId: String?
  public var points: [CapturePoint]
  public var strings: [CaptureString]
  public var retiredIds: [String]

  public init(
    label: String = "",
    kind: PropKindChoice = .custom,
    unit: LayoutUnits = .ft,
    spacingM: Double? = nil,
    ledProductId: String? = nil,
    points: [CapturePoint] = [],
    strings: [CaptureString] = [],
    retiredIds: [String] = []
  ) {
    self.label = label
    self.kind = kind
    self.unit = unit
    self.spacingM = spacingM
    self.ledProductId = ledProductId
    self.points = points
    self.strings = strings
    self.retiredIds = retiredIds
  }

  private enum CodingKeys: String, CodingKey {
    case label, kind, unit, spacingM, ledProductId, points, strings, retiredIds
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    label = try c.decode(String.self, forKey: .label)
    kind = try c.decode(PropKindChoice.self, forKey: .kind)
    unit = try c.decode(LayoutUnits.self, forKey: .unit)
    spacingM = try c.decodeIfPresent(Double.self, forKey: .spacingM)
    ledProductId = try c.decodeIfPresent(String.self, forKey: .ledProductId)
    points = try c.decode([CapturePoint].self, forKey: .points)
    strings = try c.decode([CaptureString].self, forKey: .strings)
    retiredIds = try c.decode([String].self, forKey: .retiredIds)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(label, forKey: .label)
    try c.encode(kind, forKey: .kind)
    try c.encode(unit, forKey: .unit)
    try c.encodeIfPresent(spacingM, forKey: .spacingM)
    try c.encodeIfPresent(ledProductId, forKey: .ledProductId)
    try c.encode(points, forKey: .points)
    try c.encode(strings, forKey: .strings)
    try c.encode(retiredIds, forKey: .retiredIds)
  }
}

/// One placed point. `id` is `c<n>`; it becomes the layout corner id.
public struct CapturePoint: Equatable, Sendable, Codable {
  public var id: String
  public var position: Vec3
  /// ARAnchor name. New on every placement and Move.
  public var anchorId: String
  public var surface: SurfaceKind
  /// Low confidence when above 0.05 m.
  public var uncertaintyM: Double
  public var devicePosition: Vec3
  public var deviceHeading: Vec3

  public init(
    id: String,
    position: Vec3,
    anchorId: String,
    surface: SurfaceKind,
    uncertaintyM: Double,
    devicePosition: Vec3,
    deviceHeading: Vec3
  ) {
    self.id = id
    self.position = position
    self.anchorId = anchorId
    self.surface = surface
    self.uncertaintyM = uncertaintyM
    self.devicePosition = devicePosition
    self.deviceHeading = deviceHeading
  }
}

/// A physical light string. `id` is `s<n>`. `pointIds[0]` is the wire-in and ids may repeat.
public struct CaptureString: Equatable, Sendable, Codable {
  public var id: String
  /// 0..<16, distinct among live strings.
  public var colorIndex: Int
  public var pointIds: [String]
  /// `runs.count == max(0, pointIds.count - 1)`.
  public var runs: [CaptureRun]

  public init(id: String, colorIndex: Int, pointIds: [String] = [], runs: [CaptureRun] = []) {
    self.id = id
    self.colorIndex = colorIndex
    self.pointIds = pointIds
    self.runs = runs
  }
}

/// A run between two consecutive points of a string. `id` is `e<n>`; it becomes the layout edge id.
public struct CaptureRun: Equatable, Sendable, Codable {
  public var id: String
  public var kind: RunKind
  /// Present only when `kind == .hidden`, 0...10000.
  public var hiddenCount: Int?

  public init(id: String, kind: RunKind, hiddenCount: Int? = nil) {
    self.id = id
    self.kind = kind
    self.hiddenCount = hiddenCount
  }

  private enum CodingKeys: String, CodingKey { case id, kind, hiddenCount }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    kind = try c.decode(RunKind.self, forKey: .kind)
    hiddenCount = try c.decodeIfPresent(Int.self, forKey: .hiddenCount)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(kind, forKey: .kind)
    try c.encodeIfPresent(hiddenCount, forKey: .hiddenCount)
  }
}
