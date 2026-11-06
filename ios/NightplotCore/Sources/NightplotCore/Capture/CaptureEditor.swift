import Foundation

/// The outcome of a successful edit: the new document and the string that is active afterwards.
public struct EditResult: Sendable {
  public var document: CaptureDocument
  public var activeStringId: String
  /// Set when the edit was applied but the operator needs to be told something.
  public var notice: EditRefusal?
  public init(document: CaptureDocument, activeStringId: String, notice: EditRefusal? = nil) {
    self.document = document
    self.activeStringId = activeStringId
    self.notice = notice
  }
}

public enum CaptureEditor {
  /// A Capture holds at most this many strings.
  public static let maxStrings = 16
  /// Close Loop and reuse radius, metres.
  public static let closeLoopRadiusM: Double = 0.03

  /// Applies one edit. A refusal returns no document, so the caller keeps the old one.
  public static func apply(
    _ edit: CaptureEdit,
    to document: CaptureDocument,
    activeStringId: String,
    newAnchorId: () -> String
  ) -> Result<EditResult, EditRefusal> {
    switch edit {
    case let .placePoint(hit, darkJump):
      return append(
        to: document, activeStringId: activeStringId, darkJump: darkJump,
        pointId: nil, hit: hit, newAnchorId: newAnchorId)
    case let .reusePoint(pointId, darkJump):
      return append(
        to: document, activeStringId: activeStringId, darkJump: darkJump,
        pointId: pointId, hit: nil, newAnchorId: newAnchorId)
    case let .closeLoop(darkJump):
      return closeLoop(document, activeStringId: activeStringId, darkJump: darkJump)
    case .addString:
      return addString(document)
    case let .removeString(stringId):
      return removeString(document, stringId: stringId, activeStringId: activeStringId)
    case let .movePoint(pointId, hit):
      return movePoint(document, pointId: pointId, hit: hit, activeStringId: activeStringId, newAnchorId: newAnchorId)
    case let .deletePoint(pointId):
      return deletePoint(document, pointId: pointId, activeStringId: activeStringId)
    case let .insertPoint(runId, hit):
      return insertPoint(document, runId: runId, hit: hit, activeStringId: activeStringId, newAnchorId: newAnchorId)
    case let .setRunKind(runId, kind):
      return mutateRun(document, runId: runId, activeStringId: activeStringId) { run in
        run.kind = kind
        run.hiddenCount = kind == .hidden ? 0 : nil
      }
    case let .setHiddenCount(runId, text):
      guard text.range(of: "^[0-9]+$", options: .regularExpression) != nil,
        let n = Int(text), n <= 10_000
      else { return .failure(.hiddenCountOutOfRange) }
      return mutateRun(document, runId: runId, activeStringId: activeStringId, requireHidden: true) {
        $0.hiddenCount = n
      }
    case let .setKind(kind):
      return setting(document, activeStringId) { $0.kind = kind }
    case let .setLabel(text):
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      return setting(document, activeStringId) { $0.label = trimmed }
    case let .setUnit(unit):
      return setting(document, activeStringId) { $0.unit = unit }
    case let .setTypedSpacing(text):
      guard let pitchM = parsePitchCm(text) else { return .failure(.spacingInvalid) }
      return setting(document, activeStringId) { $0.spacingM = pitchM }
    case let .attachProduct(product):
      var doc = document
      doc.capture.ledProductId = product.id
      if let pitchMm = product.pitchMm {
        doc.capture.spacingM = pitchMm / 1000
        return .success(EditResult(document: doc, activeStringId: activeStringId))
      }
      return .success(
        EditResult(document: doc, activeStringId: activeStringId, notice: .productHasNoSpacing))
    case .detachProduct:
      return setting(document, activeStringId) { $0.ledProductId = nil }
    }
  }

  private static func setting(
    _ document: CaptureDocument, _ activeStringId: String, _ change: (inout Capture) -> Void
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    change(&doc.capture)
    return .success(EditResult(document: doc, activeStringId: activeStringId))
  }

  /// Updates a point's position from an anchor update. Not an edit: no undo step.
  public static func anchorMoved(
    _ document: CaptureDocument, anchorId: String, position: Vec3
  ) -> CaptureDocument {
    var doc = document
    guard let i = doc.capture.points.firstIndex(where: { $0.anchorId == anchorId }) else {
      return document
    }
    doc.capture.points[i].position = position
    return doc
  }

  // MARK: - Structural edits

  private static func movePoint(
    _ document: CaptureDocument, pointId: String, hit: SurfaceHit, activeStringId: String,
    newAnchorId: () -> String
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard let i = doc.capture.points.firstIndex(where: { $0.id == pointId }) else {
      return .failure(.unknownTarget)
    }
    doc.capture.points[i].position = hit.position
    doc.capture.points[i].surface = hit.kind
    doc.capture.points[i].uncertaintyM = hit.uncertaintyM
    doc.capture.points[i].anchorId = newAnchorId()
    return .success(EditResult(document: doc, activeStringId: activeStringId))
  }

  private static func mutateRun(
    _ document: CaptureDocument, runId: String, activeStringId: String,
    requireHidden: Bool = false, _ change: (inout CaptureRun) -> Void
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    for si in doc.capture.strings.indices {
      if let ri = doc.capture.strings[si].runs.firstIndex(where: { $0.id == runId }) {
        if requireHidden && doc.capture.strings[si].runs[ri].kind != .hidden {
          return .failure(.unknownTarget)
        }
        change(&doc.capture.strings[si].runs[ri])
        return .success(EditResult(document: doc, activeStringId: activeStringId))
      }
    }
    return .failure(.unknownTarget)
  }

  private static func deletePoint(
    _ document: CaptureDocument, pointId: String, activeStringId: String
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard doc.capture.points.contains(where: { $0.id == pointId }) else {
      return .failure(.unknownTarget)
    }
    var retired = [pointId]
    for si in doc.capture.strings.indices {
      var s = doc.capture.strings[si]
      while let i = s.pointIds.firstIndex(of: pointId) {
        if s.runs.isEmpty {
          s.pointIds.remove(at: i)
        } else if i == 0 {
          s.pointIds.remove(at: 0)
          retired.append(s.runs.removeFirst().id)
        } else if i == s.pointIds.count - 1 {
          s.pointIds.remove(at: i)
          retired.append(s.runs.removeLast().id)
        } else {
          s.pointIds.remove(at: i)
          let after = s.runs.remove(at: i)
          retired.append(after.id)
          if s.runs[i - 1].kind == .hidden && after.kind == .hidden {
            s.runs[i - 1].hiddenCount = (s.runs[i - 1].hiddenCount ?? 0) + (after.hiddenCount ?? 0)
          }
        }
      }
      // A run must join two different points.
      var k = 0
      while k < s.runs.count {
        if s.pointIds[k] == s.pointIds[k + 1] {
          retired.append(s.runs.remove(at: k).id)
          s.pointIds.remove(at: k + 1)
        } else {
          k += 1
        }
      }
      doc.capture.strings[si] = s
    }
    doc.capture.points.removeAll { $0.id == pointId }
    doc.capture.retiredIds.append(contentsOf: retired)
    return .success(EditResult(document: doc, activeStringId: activeStringId))
  }

  private static func insertPoint(
    _ document: CaptureDocument, runId: String, hit: SurfaceHit, activeStringId: String,
    newAnchorId: () -> String
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    for si in doc.capture.strings.indices {
      guard let ri = doc.capture.strings[si].runs.firstIndex(where: { $0.id == runId }) else {
        continue
      }
      let original = doc.capture.strings[si].runs[ri]
      var used = usedIds(doc)
      let pointId = doc.ids.point(avoiding: used)
      used.insert(pointId)
      let firstId = doc.ids.run(avoiding: used)
      used.insert(firstId)
      let secondId = doc.ids.run(avoiding: used)
      doc.capture.points.append(
        CapturePoint(
          id: pointId, position: hit.position, anchorId: newAnchorId(), surface: hit.kind,
          uncertaintyM: hit.uncertaintyM, devicePosition: hit.devicePosition,
          deviceHeading: hit.deviceHeading))
      let hidden = original.kind == .hidden
      let first = CaptureRun(
        id: firstId, kind: original.kind, hiddenCount: hidden ? (original.hiddenCount ?? 0) : nil)
      let second = CaptureRun(
        id: secondId, kind: original.kind, hiddenCount: hidden ? 0 : nil)
      doc.capture.strings[si].runs.replaceSubrange(ri...ri, with: [first, second])
      doc.capture.strings[si].pointIds.insert(pointId, at: ri + 1)
      doc.capture.retiredIds.append(original.id)
      return .success(EditResult(document: doc, activeStringId: activeStringId))
    }
    return .failure(.unknownTarget)
  }

  /// Close Loop needs 3 or more points on the active string and a hit within 0.03 m of the first.
  public static func closeLoopEnabled(
    document: CaptureDocument, activeStringId: String, hit: SurfaceHit?
  ) -> Bool {
    guard let hit,
      let string = document.capture.strings.first(where: { $0.id == activeStringId }),
      string.pointIds.count >= 3,
      let firstId = string.pointIds.first,
      let first = document.capture.points.first(where: { $0.id == firstId })
    else { return false }
    return (hit.position - first.position).length <= closeLoopRadiusM
  }

  /// The Dark Jump control is enabled only when the active string has points.
  public static func darkJumpEnabled(document: CaptureDocument, activeStringId: String) -> Bool {
    guard let string = document.capture.strings.first(where: { $0.id == activeStringId })
    else { return false }
    return !string.pointIds.isEmpty
  }

  // MARK: - Append edits

  /// Place (`pointId == nil`, `hit` set) or reuse (`pointId` set) one point on the active string.
  private static func append(
    to document: CaptureDocument,
    activeStringId: String,
    darkJump: Bool,
    pointId: String?,
    hit: SurfaceHit?,
    newAnchorId: () -> String
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard let si = doc.capture.strings.firstIndex(where: { $0.id == activeStringId }) else {
      return .failure(.unknownTarget)
    }
    let targetId: String
    if let pointId {
      guard doc.capture.points.contains(where: { $0.id == pointId }) else {
        return .failure(.unknownTarget)
      }
      if doc.capture.strings[si].pointIds.last == pointId {
        return .failure(.sameAsLastPoint)
      }
      targetId = pointId
    } else if let hit {
      targetId = doc.ids.point(avoiding: usedIds(doc))
      doc.capture.points.append(
        CapturePoint(
          id: targetId, position: hit.position, anchorId: newAnchorId(), surface: hit.kind,
          uncertaintyM: hit.uncertaintyM, devicePosition: hit.devicePosition,
          deviceHeading: hit.deviceHeading))
    } else {
      return .failure(.unknownTarget)
    }
    appendPointId(&doc, stringIndex: si, pointId: targetId, darkJump: darkJump)
    return .success(EditResult(document: doc, activeStringId: activeStringId))
  }

  private static func closeLoop(
    _ document: CaptureDocument, activeStringId: String, darkJump: Bool
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard let si = doc.capture.strings.firstIndex(where: { $0.id == activeStringId }) else {
      return .failure(.unknownTarget)
    }
    let ids = doc.capture.strings[si].pointIds
    guard ids.count >= 3, let first = ids.first else { return .failure(.closeLoopUnavailable) }
    appendPointId(&doc, stringIndex: si, pointId: first, darkJump: darkJump)
    return .success(EditResult(document: doc, activeStringId: activeStringId))
  }

  /// First point is the wire-in with no run. Later points add one run: `wire` with Dark Jump, else `lit`.
  private static func appendPointId(
    _ doc: inout CaptureDocument, stringIndex si: Int, pointId: String, darkJump: Bool
  ) {
    if !doc.capture.strings[si].pointIds.isEmpty {
      let runId = doc.ids.run(avoiding: usedIds(doc))
      doc.capture.strings[si].runs.append(CaptureRun(id: runId, kind: darkJump ? .wire : .lit))
    }
    doc.capture.strings[si].pointIds.append(pointId)
  }

  // MARK: - Strings

  private static func addString(_ document: CaptureDocument) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard doc.capture.strings.count < maxStrings else { return .failure(.stringLimitReached) }
    let id = doc.ids.string()
    let used = Set(doc.capture.strings.map(\.colorIndex))
    let color = (0..<maxStrings).first { !used.contains($0) } ?? 0
    doc.capture.strings.append(CaptureString(id: id, colorIndex: color))
    return .success(EditResult(document: doc, activeStringId: id))
  }

  private static func removeString(
    _ document: CaptureDocument, stringId: String, activeStringId: String
  ) -> Result<EditResult, EditRefusal> {
    var doc = document
    guard let si = doc.capture.strings.firstIndex(where: { $0.id == stringId }) else {
      return .failure(.unknownTarget)
    }
    let removed = doc.capture.strings.remove(at: si)
    var retired = [removed.id]
    retired.append(contentsOf: removed.runs.map(\.id))
    let stillUsed = Set(doc.capture.strings.flatMap(\.pointIds))
    var seen = Set<String>()
    for pid in removed.pointIds where !stillUsed.contains(pid) && seen.insert(pid).inserted {
      retired.append(pid)
    }
    doc.capture.points.removeAll { seen.contains($0.id) }
    doc.capture.retiredIds.append(contentsOf: retired)

    var active = activeStringId
    if doc.capture.strings.isEmpty {
      // A Capture always has an active string.
      let id = doc.ids.string()
      doc.capture.strings.append(CaptureString(id: id, colorIndex: 0))
      active = id
    } else if !doc.capture.strings.contains(where: { $0.id == active }) {
      active = doc.capture.strings[min(si, doc.capture.strings.count - 1)].id
    }
    return .success(EditResult(document: doc, activeStringId: active))
  }

  // MARK: - Ids

  /// Every id that must not be issued again: live, retired, and wrap mark ids.
  private static func usedIds(_ doc: CaptureDocument) -> Set<String> {
    var used = Set(doc.capture.retiredIds)
    used.formUnion(doc.spiral.retiredIds)
    used.formUnion(doc.spiral.wrapMarks.map(\.pointId))
    used.formUnion(doc.capture.points.map(\.id))
    for s in doc.capture.strings {
      used.insert(s.id)
      used.formUnion(s.runs.map(\.id))
    }
    return used
  }
}
