import Foundation
import NightplotCore

/// One fixed Capture and the export path that turns it into a layout fixture.
struct FixtureCase {
  /// File name without `.json`.
  var name: String
  var document: CaptureDocument
  var path: ExportPath
}

/// Fixed Captures behind `ios/fixtures/prop-layouts/*.json` (Req 14.9).
///
/// Everything is built in code with exact numbers so a fixture only changes when the
/// exporter changes. Trace points lie on a vertical plane facing +z, with the device at
/// z = 3, so the plane fit has an exactly horizontal axis (no trig noise in the result).
enum FixtureCaptures {
  static let all: [FixtureCase] = [
    FixtureCase(name: "one-string-ft", document: oneStringFt, path: .trace),
    FixtureCase(name: "two-strings-shared-m", document: twoStringsSharedM, path: .trace),
    FixtureCase(name: "backtrack-wire-hidden-ft", document: backtrackWireHiddenFt, path: .trace),
    FixtureCase(name: "closed-loop-retired-m", document: closedLoopRetiredM, path: .trace),
    FixtureCase(name: "spiral-measured-wraps-m", document: spiralMeasuredWrapsM, path: .spiralMeasured),
    FixtureCase(name: "spiral-mean-gap-ft", document: spiralMeanGapFt, path: .spiralMeanGap),
  ]

  // MARK: Builders

  private static let draftId = UUID(uuidString: "00000000-0000-0000-0000-00000000F1C5")!

  private static func point(_ n: Int, _ x: Double, _ y: Double, _ z: Double = 0) -> CapturePoint {
    CapturePoint(
      id: "c\(n)",
      position: Vec3(x, y, z),
      anchorId: "anchor-c\(n)",
      surface: .plane,
      uncertaintyM: 0.01,
      devicePosition: Vec3(1, 1.5, 3),
      deviceHeading: Vec3(0, 0, -1))
  }

  private static func document(
    _ capture: Capture,
    ids: IdAllocator,
    spiral: SpiralState = SpiralState(),
    depthMode: DepthMode = .planes
  ) -> CaptureDocument {
    CaptureDocument(
      draftId: draftId,
      capture: capture,
      ids: ids,
      spiral: spiral,
      depthMode: depthMode,
      editedAtMs: 0)
  }

  // MARK: Trace fixtures

  /// One string, three lit runs, feet. `e3` hangs from `c3` to a point 0.3 m off the plane, so it
  /// carries `wrapLengthM`. `e1` and `e2` lie on the plane and carry none.
  static var oneStringFt: CaptureDocument {
    let capture = Capture(
      label: "Fixture one string",
      kind: .roofline,
      unit: .ft,
      spacingM: 0.1,
      points: [point(1, 0, 0), point(2, 1, 0), point(3, 2, 0), point(4, 1, 1, 0.3)],
      strings: [
        CaptureString(
          id: "s1", colorIndex: 0,
          pointIds: ["c1", "c2", "c3", "c4"],
          runs: [
            CaptureRun(id: "e1", kind: .lit),
            CaptureRun(id: "e2", kind: .lit),
            CaptureRun(id: "e3", kind: .lit),
          ])
      ])
    return document(capture, ids: IdAllocator(nextPoint: 5, nextRun: 4, nextString: 2))
  }

  /// Two strings. `s2` starts at `c2`, which `s1` also passes through. Metres.
  static var twoStringsSharedM: CaptureDocument {
    let capture = Capture(
      label: "Fixture two strings",
      kind: .custom,
      unit: .m,
      spacingM: 0.1,
      points: [point(1, 0, 0), point(2, 1, 0), point(3, 2, 0.5), point(4, 1, 1)],
      strings: [
        CaptureString(
          id: "s1", colorIndex: 0,
          pointIds: ["c1", "c2", "c3"],
          runs: [CaptureRun(id: "e1", kind: .lit), CaptureRun(id: "e2", kind: .lit)]),
        CaptureString(
          id: "s2", colorIndex: 1,
          pointIds: ["c2", "c4"],
          runs: [CaptureRun(id: "e3", kind: .lit)]),
      ])
    return document(capture, ids: IdAllocator(nextPoint: 5, nextRun: 4, nextString: 3))
  }

  /// One string that goes A, B, A, C, D: a lit run, a wire run back, a hidden run, then lit.
  /// Wire and hidden runs have no measured lit length, so none carries `wrapLengthM`.
  static var backtrackWireHiddenFt: CaptureDocument {
    let capture = Capture(
      label: "Fixture backtrack",
      kind: .window,
      unit: .ft,
      spacingM: 0.1,
      points: [point(1, 0, 0), point(2, 1, 0), point(3, 0, 1), point(4, 2, 1)],
      strings: [
        CaptureString(
          id: "s1", colorIndex: 0,
          pointIds: ["c1", "c2", "c1", "c3", "c4"],
          runs: [
            CaptureRun(id: "e1", kind: .lit),
            CaptureRun(id: "e2", kind: .wire),
            CaptureRun(id: "e3", kind: .hidden, hiddenCount: 5),
            CaptureRun(id: "e4", kind: .lit),
          ])
      ])
    return document(capture, ids: IdAllocator(nextPoint: 5, nextRun: 5, nextString: 2))
  }

  /// A closed square (the string returns to `c1`) after point `c5` was deleted. Metres.
  static var closedLoopRetiredM: CaptureDocument {
    let capture = Capture(
      label: "Fixture closed loop",
      kind: .arch,
      unit: .m,
      spacingM: 0.1,
      points: [point(1, 0, 0), point(2, 1, 0), point(3, 1, 1), point(4, 0, 1)],
      strings: [
        CaptureString(
          id: "s1", colorIndex: 0,
          pointIds: ["c1", "c2", "c3", "c4", "c1"],
          runs: [
            CaptureRun(id: "e1", kind: .lit),
            CaptureRun(id: "e2", kind: .lit),
            CaptureRun(id: "e3", kind: .lit),
            CaptureRun(id: "e4", kind: .lit),
          ])
      ],
      retiredIds: ["c5"])
    return document(capture, ids: IdAllocator(nextPoint: 6, nextRun: 5, nextString: 2))
  }

  // MARK: Spiral fixtures

  private static func marks(_ heights: [Double], scan: ReferenceScan) -> [WrapMark] {
    heights.enumerated().map { i, h in
      WrapMark(
        pointId: "c\(i + 1)", heightM: h,
        position: Vec3(scan.radius(atHeight: h) ?? 0, h, 0))
    }
  }

  private static func spiralDocument(
    label: String, unit: LayoutUnits, bottomM: Double, topM: Double, heightM: Double,
    markHeights: [Double]
  ) -> CaptureDocument {
    let scan = ReferenceScan(
      source: .planes,
      axisBottom: Vec3(0, 0, 0),
      axisTop: Vec3(0, heightM, 0),
      bottom: CircumferenceValue(metres: bottomM, typed: false),
      top: CircumferenceValue(metres: topM, typed: false))
    let wrapMarks = marks(markHeights, scan: scan)
    let capture = Capture(
      label: label,
      kind: .spiral,
      unit: unit,
      spacingM: 0.1,
      strings: [CaptureString(id: "s1", colorIndex: 0)])
    return document(
      capture,
      ids: IdAllocator(nextPoint: wrapMarks.count + 1, nextRun: 1, nextString: 2),
      spiral: SpiralState(
        referenceScan: scan, wrapMarks: wrapMarks,
        keepMeasuredWraps: true, accepted: true))
  }

  /// Five evenly spaced marks on a tapering object. Every edge carries `wrapLengthM`.
  static var spiralMeasuredWrapsM: CaptureDocument {
    spiralDocument(
      label: "Fixture measured wraps", unit: .m,
      bottomM: 1.2, topM: 0.8, heightM: 1.8,
      markHeights: [0.1, 0.5, 0.9, 1.3, 1.7])
  }

  /// The same kind of object, exported as a mean-gap spiral in feet.
  static var spiralMeanGapFt: CaptureDocument {
    spiralDocument(
      label: "Fixture mean gap", unit: .ft,
      bottomM: 1.0, topM: 0.5, heightM: 1.5,
      markHeights: [0.1, 0.4, 0.7, 1.0, 1.3])
  }
}
