import Foundation

/// Why an export cannot proceed. All blockers are returned together.
public enum ExportBlock: Equatable, Sendable {
  case labelRequired, labelTooLong
  case noSpacing
  /// Trace path only.
  case noRuns
  case unanchored([UnanchoredEntry])
  /// Trace path, not Flat, and `PlaneFit.vertical` failed.
  case noFrontPlane
  /// Spiral paths with fewer than two wrap marks.
  case spiralNeedsTwoMarks
  case layoutInvalid
}

/// One string occurrence of an unanchored point. `index` is the 0-based position in the string.
public struct UnanchoredEntry: Equatable, Sendable {
  public var stringId: String
  public var index: Int
  public var pointId: String

  public init(stringId: String, index: Int, pointId: String) {
    self.stringId = stringId
    self.index = index
    self.pointId = pointId
  }
}

/// One string occurrence of a point with uncertainty above 0.05 m.
public struct LowConfidenceEntry: Equatable, Sendable {
  public var stringId: String
  public var index: Int
  public var uncertaintyM: Double

  public init(stringId: String, index: Int, uncertaintyM: Double) {
    self.stringId = stringId
    self.index = index
    self.uncertaintyM = uncertaintyM
  }
}

public enum ExportCheck: Equatable, Sendable {
  case blocked([ExportBlock])
  case warnNotFlat(offPlaneCount: Int)
  case ready
}

public enum ExportPath: Equatable, Sendable { case trace, spiralMeanGap, spiralMeasured }

public enum ExportGate {
  public static let maxLabelUTF16 = 64
  public static let lowConfidenceM = 0.05
  public static let notFlatLimitM = 0.5
  public static let minWrapMarks = 2

  public static func check(_ document: CaptureDocument, path: ExportPath) -> ExportCheck {
    let capture = document.capture
    let isTrace = path == .trace
    var blocks: [ExportBlock] = []

    let labelLength = capture.label.utf16.count
    if labelLength == 0 {
      blocks.append(.labelRequired)
    } else if labelLength > maxLabelUTF16 {
      blocks.append(.labelTooLong)
    }

    if capture.spacingM == nil { blocks.append(.noSpacing) }

    if isTrace && !capture.strings.contains(where: { !$0.runs.isEmpty }) {
      blocks.append(.noRuns)
    }

    let unanchored = unanchoredEntries(document)
    if !unanchored.isEmpty { blocks.append(.unanchored(unanchored)) }

    var frame: ProjectionFrame?
    if isTrace && !document.flat {
      switch verticalFrame(document) {
      case .success(let f): frame = f
      case .failure: blocks.append(.noFrontPlane)
      }
    }

    if !isTrace && document.spiral.wrapMarks.count < minWrapMarks {
      blocks.append(.spiralNeedsTwoMarks)
    }

    if !blocks.isEmpty { return .blocked(blocks) }

    if let frame {
      let n = PlaneFit.offPlaneCount(
        points: capture.points.map(\.position), frame: frame, limitM: notFlatLimitM)
      if n > 0 { return .warnNotFlat(offPlaneCount: n) }
    }
    return .ready
  }

  /// One entry per string occurrence of each point above 0.05 m. Never blocks.
  public static func lowConfidence(_ document: CaptureDocument) -> [LowConfidenceEntry] {
    let byId = Dictionary(
      document.capture.points.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var out: [LowConfidenceEntry] = []
    for s in document.capture.strings {
      for (i, pid) in s.pointIds.enumerated() {
        if let p = byId[pid], p.uncertaintyM > lowConfidenceM {
          out.append(LowConfidenceEntry(stringId: s.id, index: i, uncertaintyM: p.uncertaintyM))
        }
      }
    }
    return out
  }

  private static func unanchoredEntries(_ document: CaptureDocument) -> [UnanchoredEntry] {
    let lost = Set(document.unanchoredPointIds)
    guard !lost.isEmpty else { return [] }
    var out: [UnanchoredEntry] = []
    for s in document.capture.strings {
      for (i, pid) in s.pointIds.enumerated() where lost.contains(pid) {
        out.append(UnanchoredEntry(stringId: s.id, index: i, pointId: pid))
      }
    }
    return out
  }

  private static func verticalFrame(_ document: CaptureDocument) -> Result<ProjectionFrame, PlaneFitError> {
    let points = document.capture.points
    let byId = Dictionary(points.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let wireIn = document.capture.strings.lazy
      .compactMap { $0.pointIds.first }
      .compactMap { byId[$0] }
      .first
    guard let origin = wireIn?.position else { return .failure(.noPoints) }
    return PlaneFit.vertical(
      points: points.map(\.position),
      origin: origin,
      devicePositions: points.map(\.devicePosition),
      deviceHeadings: points.map(\.deviceHeading))
  }
}
