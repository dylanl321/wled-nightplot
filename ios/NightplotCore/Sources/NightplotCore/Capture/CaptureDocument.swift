import Foundation

/// Spiral state that sits beside the undoable `Capture`. Not rolled back by Undo.
public struct SpiralState: Equatable, Sendable, Codable {
  public var referenceScan: ReferenceScan?
  /// Last operator-placed cylinder (lidar).
  public var cylinder: ScanCylinder?
  /// Sorted by `heightM`.
  public var wrapMarks: [WrapMark]
  /// Deleted wrap mark ids.
  public var retiredIds: [String]
  public var keepMeasuredWraps: Bool
  /// The operator accepted the spiral; selects a spiral export path.
  public var accepted: Bool

  public init(
    referenceScan: ReferenceScan? = nil,
    cylinder: ScanCylinder? = nil,
    wrapMarks: [WrapMark] = [],
    retiredIds: [String] = [],
    keepMeasuredWraps: Bool = false,
    accepted: Bool = false
  ) {
    self.referenceScan = referenceScan
    self.cylinder = cylinder
    self.wrapMarks = wrapMarks
    self.retiredIds = retiredIds
    self.keepMeasuredWraps = keepMeasuredWraps
    self.accepted = accepted
  }

  private enum CodingKeys: String, CodingKey {
    case referenceScan, cylinder, wrapMarks, retiredIds, keepMeasuredWraps, accepted
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    referenceScan = try c.decodeIfPresent(ReferenceScan.self, forKey: .referenceScan)
    cylinder = try c.decodeIfPresent(ScanCylinder.self, forKey: .cylinder)
    wrapMarks = try c.decode([WrapMark].self, forKey: .wrapMarks)
    retiredIds = try c.decode([String].self, forKey: .retiredIds)
    keepMeasuredWraps = try c.decode(Bool.self, forKey: .keepMeasuredWraps)
    accepted = try c.decode(Bool.self, forKey: .accepted)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeIfPresent(referenceScan, forKey: .referenceScan)
    try c.encodeIfPresent(cylinder, forKey: .cylinder)
    try c.encode(wrapMarks, forKey: .wrapMarks)
    try c.encode(retiredIds, forKey: .retiredIds)
    try c.encode(keepMeasuredWraps, forKey: .keepMeasuredWraps)
    try c.encode(accepted, forKey: .accepted)
  }
}

/// A draft file: the undoable `Capture` plus state that Undo must not touch.
public struct CaptureDocument: Equatable, Sendable, Codable {
  /// Draft format version written by `new`. DraftCodec owns migration later.
  public static let currentVersion = 1

  public var version: Int
  public var draftId: UUID
  /// Undoable part.
  public var capture: Capture
  /// Not undoable.
  public var ids: IdAllocator
  /// Not undoable. Encoded as a sorted array.
  public var lostAnchorIds: Set<String>
  /// Absent until a POST succeeds.
  public var propId: String?
  public var flat: Bool
  public var spiral: SpiralState
  /// Mode the points were captured in; absent before AR.
  public var depthMode: DepthMode?
  public var editedAtMs: Int64

  public init(
    version: Int = CaptureDocument.currentVersion,
    draftId: UUID,
    capture: Capture,
    ids: IdAllocator,
    lostAnchorIds: Set<String> = [],
    propId: String? = nil,
    flat: Bool = false,
    spiral: SpiralState = SpiralState(),
    depthMode: DepthMode? = nil,
    editedAtMs: Int64
  ) {
    self.version = version
    self.draftId = draftId
    self.capture = capture
    self.ids = ids
    self.lostAnchorIds = lostAnchorIds
    self.propId = propId
    self.flat = flat
    self.spiral = spiral
    self.depthMode = depthMode
    self.editedAtMs = editedAtMs
  }

  /// A new draft: one empty active string `s1`, kind custom, unit ft, no spacing, empty label.
  public static func new(draftId: UUID, now: Date) -> CaptureDocument {
    var ids = IdAllocator()
    let firstString = CaptureString(id: ids.string(), colorIndex: 0)
    let capture = Capture(
      label: "", kind: .custom, unit: .ft, spacingM: nil, ledProductId: nil,
      points: [], strings: [firstString], retiredIds: [])
    return CaptureDocument(
      draftId: draftId,
      capture: capture,
      ids: ids,
      editedAtMs: Int64((now.timeIntervalSince1970 * 1000).rounded(.down)))
  }

  /// Live points whose current `anchorId` is in `lostAnchorIds`, in creation order.
  public var unanchoredPointIds: [String] {
    capture.points.filter { lostAnchorIds.contains($0.anchorId) }.map(\.id)
  }

  /// Adds ids to `lostAnchorIds`. Changes nothing else.
  public func markAnchorsLost(_ anchorIds: some Sequence<String>) -> CaptureDocument {
    var copy = self
    copy.lostAnchorIds.formUnion(anchorIds)
    return copy
  }

  private enum CodingKeys: String, CodingKey {
    case version, draftId, capture, ids, lostAnchorIds, propId, flat, spiral, depthMode, editedAtMs
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    version = try c.decode(Int.self, forKey: .version)
    draftId = try c.decode(UUID.self, forKey: .draftId)
    capture = try c.decode(Capture.self, forKey: .capture)
    ids = try c.decode(IdAllocator.self, forKey: .ids)
    lostAnchorIds = Set(try c.decode([String].self, forKey: .lostAnchorIds))
    propId = try c.decodeIfPresent(String.self, forKey: .propId)
    flat = try c.decode(Bool.self, forKey: .flat)
    spiral = try c.decode(SpiralState.self, forKey: .spiral)
    depthMode = try c.decodeIfPresent(DepthMode.self, forKey: .depthMode)
    editedAtMs = try c.decode(Int64.self, forKey: .editedAtMs)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(version, forKey: .version)
    try c.encode(draftId, forKey: .draftId)
    try c.encode(capture, forKey: .capture)
    try c.encode(ids, forKey: .ids)
    try c.encode(lostAnchorIds.sorted(), forKey: .lostAnchorIds)
    try c.encodeIfPresent(propId, forKey: .propId)
    try c.encode(flat, forKey: .flat)
    try c.encode(spiral, forKey: .spiral)
    try c.encodeIfPresent(depthMode, forKey: .depthMode)
    try c.encode(editedAtMs, forKey: .editedAtMs)
  }
}
