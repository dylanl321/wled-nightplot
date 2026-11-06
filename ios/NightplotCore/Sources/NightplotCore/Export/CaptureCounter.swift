import Foundation

/// A value that is either measured or not known yet. Unknown is never zero.
public enum Measured<T: Sendable & Equatable>: Equatable, Sendable {
  case known(T)
  case unknown
}

/// Lengths and light counts for the Capture screen.
public struct CaptureCounts: Equatable, Sendable {
  /// 3D straight-line length, per run.
  public var runLengthM: [String: Measured<Double>]
  /// Lit runs only.
  public var runLights: [String: Measured<Int>]
  public var stringLengthM: [String: Measured<Double>]
  public var stringLights: [String: Measured<Int>]
  public var totalLights: Measured<Int>

  public init(
    runLengthM: [String: Measured<Double>] = [:],
    runLights: [String: Measured<Int>] = [:],
    stringLengthM: [String: Measured<Double>] = [:],
    stringLights: [String: Measured<Int>] = [:],
    totalLights: Measured<Int> = .unknown
  ) {
    self.runLengthM = runLengthM
    self.runLights = runLights
    self.stringLengthM = stringLengthM
    self.stringLights = stringLights
    self.totalLights = totalLights
  }
}

public enum CaptureCounter {
  public static func counts(_ document: CaptureDocument) -> CaptureCounts {
    let capture = document.capture
    let byId = Dictionary(capture.points.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let lostIds = Set(document.unanchoredPointIds)

    // 3D length per run. Absent means unknown (an unanchored or missing end).
    var len3D: [String: Double] = [:]
    var runLengthM: [String: Measured<Double>] = [:]
    for s in capture.strings {
      for (i, run) in s.runs.enumerated() {
        var length: Double?
        if i + 1 < s.pointIds.count,
          let from = byId[s.pointIds[i]], let to = byId[s.pointIds[i + 1]],
          !lostIds.contains(from.id), !lostIds.contains(to.id)
        {
          length = (to.position - from.position).length
        }
        if let length {
          len3D[run.id] = length
          runLengthM[run.id] = .known(length)
        } else {
          runLengthM[run.id] = .unknown
        }
      }
    }

    var stringLengthM: [String: Measured<Double>] = [:]
    for s in capture.strings {
      var sum = 0.0
      var known = true
      for run in s.runs {
        if let l = len3D[run.id] { sum += l } else { known = false }
      }
      stringLengthM[s.id] = known ? .known(sum) : .unknown
    }

    var runLights: [String: Measured<Int>] = [:]
    var stringLights: [String: Measured<Int>] = [:]
    var totalLights: Measured<Int> = .unknown

    guard let spacingM = capture.spacingM, spacingM > 0 else {
      for s in capture.strings {
        for run in s.runs where run.kind == .lit { runLights[run.id] = .unknown }
        stringLights[s.id] = .unknown
      }
      return CaptureCounts(
        runLengthM: runLengthM, runLights: runLights,
        stringLengthM: stringLengthM, stringLights: stringLights, totalLights: .unknown)
    }

    let layout = exportedLayout(document) ?? provisionalLayout(capture, len3D: len3D, spacingM: spacingM)
    let counted = Dictionary(
      countLayout(layout).edges.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var wrapped: Set<String> = []
    for ls in layoutStrings(layout) {
      for e in ls.run where e.kind == .lit && (e.wrapLengthM ?? 0) > 0 { wrapped.insert(e.id) }
    }

    var allKnown = true
    var total = 0
    for s in capture.strings {
      var sum = 0
      var known = true
      // An unknown lit run makes the chain's later runs unknown: their counts depend on how far along it they start.
      var poisoned = false
      for run in s.runs {
        switch run.kind {
        case .wire, .hidden:
          poisoned = false
        case .lit:
          if len3D[run.id] == nil {
            poisoned = true
            runLights[run.id] = .unknown
            known = false
          } else if poisoned && wrapped.contains(run.id) {
            runLights[run.id] = .unknown
            known = false
          } else {
            poisoned = false
            let n = counted[run.id]?.lights ?? 0
            runLights[run.id] = .known(n)
            sum += n
          }
        }
      }
      if known {
        stringLights[s.id] = .known(sum)
        total += sum
      } else {
        stringLights[s.id] = .unknown
        allKnown = false
      }
    }
    if allKnown { totalLights = .known(total) }

    return CaptureCounts(
      runLengthM: runLengthM, runLights: runLights,
      stringLengthM: stringLengthM, stringLights: stringLights, totalLights: totalLights)
  }

  /// The layout the exporter would save, when it can build one.
  private static func exportedLayout(_ document: CaptureDocument) -> PropLayout? {
    if case .success(let result) = LayoutExporter.export(document, path: .trace) {
      return result.layout
    }
    return nil
  }

  /// Used before a front plane exists: placeholder corners, and every lit run
  /// counts as wrapped with its 3D length.
  static func provisionalLayout(_ capture: Capture, len3D: [String: Double], spacingM: Double) -> PropLayout {
    let corners = capture.points.map { LayoutCorner(id: $0.id, x: 0, y: 0) }
    var strings: [LayoutString] = []
    for s in capture.strings where !s.pointIds.isEmpty {
      var edges: [LayoutEdge] = []
      for (i, run) in s.runs.enumerated() where i + 1 < s.pointIds.count {
        var edge = LayoutEdge(
          id: run.id, from: s.pointIds[i], to: s.pointIds[i + 1], kind: run.kind,
          hiddenCount: run.kind == .hidden ? run.hiddenCount : nil)
        if run.kind == .lit, let l = len3D[run.id], l > 0 { edge.wrapLengthM = l }
        edges.append(edge)
      }
      strings.append(LayoutString(id: s.id, startId: s.pointIds[0], run: edges))
    }
    return PropLayout(
      source: .trace,
      units: capture.unit,
      pitchM: spacingM,
      startOffsetM: 0,
      corners: corners,
      run: strings.first?.run ?? [],
      strings: strings,
      retiredIds: nil)
  }
}
