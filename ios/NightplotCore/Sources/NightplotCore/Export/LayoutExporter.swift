import Foundation

/// Lets `ExportBlock` be the failure of a `Result`.
extension ExportBlock: Error {}

/// A layout and the request that saves it.
public struct ExportResult: Equatable, Sendable {
  public var layout: PropLayout
  public var request: PropSaveRequest

  public init(layout: PropLayout, request: PropSaveRequest) {
    self.layout = layout
    self.request = request
  }
}

/// The body of a Prop save. `ServerClient` picks the fields each verb sends.
/// `ledProductId` is encoded as JSON `null` when absent (Req 12.1). `PropLayout` never holds `null`.
public struct PropSaveRequest: Equatable, Sendable, Encodable {
  public var label: String
  /// `roofline` … `custom`, or `spiral`.
  public var kind: String
  public var unit: LayoutUnits
  /// POST only.
  public var pitchMm: Double
  /// POST only.
  public var ledProductId: String?
  public var layout: PropLayout
  public var measurements: Measurements

  public init(
    label: String,
    kind: String,
    unit: LayoutUnits,
    pitchMm: Double,
    ledProductId: String?,
    layout: PropLayout,
    measurements: Measurements
  ) {
    self.label = label
    self.kind = kind
    self.unit = unit
    self.pitchMm = pitchMm
    self.ledProductId = ledProductId
    self.layout = layout
    self.measurements = measurements
  }

  private enum CodingKeys: String, CodingKey {
    case label, kind, unit, pitchMm, ledProductId, layout, measurements
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(label, forKey: .label)
    try c.encode(kind, forKey: .kind)
    try c.encode(unit, forKey: .unit)
    try c.encode(pitchMm, forKey: .pitchMm)
    if let ledProductId {
      try c.encode(ledProductId, forKey: .ledProductId)
    } else {
      try c.encodeNil(forKey: .ledProductId)
    }
    try c.encode(layout, forKey: .layout)
    try c.encode(measurements, forKey: .measurements)
  }
}

public enum LayoutExporter {
  /// A lit edge gets `wrapLengthM` when its 3D and drawn lengths differ by more than this (Req 8.7).
  public static let wrapDifferenceM = 1e-9

  /// Builds the layout and save request for the trace and both spiral paths.
  public static func export(_ document: CaptureDocument, path: ExportPath) -> Result<ExportResult, ExportBlock> {
    guard path == .trace else { return exportSpiral(document, path: path) }

    let capture = document.capture
    guard let spacingM = capture.spacingM else { return .failure(.noSpacing) }

    let exported = capture.strings.filter { !$0.pointIds.isEmpty }
    guard exported.contains(where: { !$0.runs.isEmpty }) else { return .failure(.noRuns) }

    let byId = Dictionary(capture.points.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    guard let originPoint = exported.first.flatMap({ $0.pointIds.first }).flatMap({ byId[$0] }) else {
      return .failure(.layoutInvalid)
    }

    let devicePositions = capture.points.map(\.devicePosition)
    let deviceHeadings = capture.points.map(\.deviceHeading)
    let positions = capture.points.map(\.position)
    let frame: ProjectionFrame
    if document.flat {
      switch PlaneFit.flat(
        points: positions, origin: originPoint.position,
        devicePositions: devicePositions, deviceHeadings: deviceHeadings)
      {
      case .success(let f): frame = f
      case .failure: return .failure(.layoutInvalid)
      }
    } else {
      switch PlaneFit.vertical(
        points: positions, origin: originPoint.position,
        devicePositions: devicePositions, deviceHeadings: deviceHeadings)
      {
      case .success(let f): frame = f
      case .failure: return .failure(.noFrontPlane)
      }
    }

    // One corner per point, in creation order, unrounded.
    let corners = capture.points.map { p -> LayoutCorner in
      let xy = frame.project(p.position)
      return LayoutCorner(id: p.id, x: xy.x, y: xy.y)
    }

    var strings: [LayoutString] = []
    var len3D: [String: Double] = [:]
    for s in exported {
      var edges: [LayoutEdge] = []
      for (i, run) in s.runs.enumerated() {
        guard i + 1 < s.pointIds.count,
          let from = byId[s.pointIds[i]], let to = byId[s.pointIds[i + 1]]
        else { return .failure(.layoutInvalid) }
        len3D[run.id] = (to.position - from.position).length
        edges.append(
          LayoutEdge(
            id: run.id, from: from.id, to: to.id, kind: run.kind,
            hiddenCount: run.kind == .hidden ? run.hiddenCount : nil))
      }
      guard let startId = s.pointIds.first else { return .failure(.layoutInvalid) }
      strings.append(LayoutString(id: s.id, startId: startId, run: edges))
    }

    var layout = PropLayout(
      source: .trace,
      units: capture.unit,
      pitchM: spacingM,
      startOffsetM: 0,
      corners: corners,
      run: strings[0].run,
      strings: strings,
      retiredIds: capture.retiredIds.isEmpty ? nil : capture.retiredIds)

    // `wrapLengthM` on lit edges whose 3D length differs from the drawn length.
    // The drawn length is measured from the corners as written.
    for si in layout.strings!.indices {
      for ei in layout.strings![si].run.indices {
        let edge = layout.strings![si].run[ei]
        guard edge.kind == .lit, let measured = len3D[edge.id] else { continue }
        if abs(measured - drawnLengthM(layout, edge)) > wrapDifferenceM {
          layout.strings![si].run[ei].wrapLengthM = measured
        }
      }
    }
    layout.run = layout.strings![0].run

    guard LayoutValidation.allNumbersFinite(layout), LayoutValidation.isValid(layout) else {
      return .failure(.layoutInvalid)
    }

    let request = PropSaveRequest(
      label: capture.label,
      kind: capture.kind.rawValue,
      unit: capture.unit,
      pitchMm: spacingM * 1000,
      ledProductId: capture.ledProductId,
      layout: layout,
      measurements: .custom)
    return .success(ExportResult(layout: layout, request: request))
  }

  /// Mean-gap and Keep Measured Wraps. Both save kind `spiral` with the mean-gap measurements.
  private static func exportSpiral(_ document: CaptureDocument, path: ExportPath) -> Result<ExportResult, ExportBlock> {
    let capture = document.capture
    guard let spacingM = capture.spacingM else { return .failure(.noSpacing) }
    guard document.spiral.wrapMarks.count >= ExportGate.minWrapMarks else {
      return .failure(.spiralNeedsTwoMarks)
    }
    guard let scan = document.spiral.referenceScan,
      let report = SpiralAnalyzer.report(scan: scan, marks: document.spiral.wrapMarks)
    else { return .failure(.layoutInvalid) }

    let measurements = SpiralAnalyzer.meanGapMeasurements(report, unit: capture.unit)

    let built: PropLayout?
    if path == .spiralMeasured {
      built = MeasuredWraps.layout(
        scan: scan, marks: document.spiral.wrapMarks, units: capture.unit, pitchM: spacingM)
    } else {
      guard case .spiral(let height, let around, let aroundTop, let gap) = measurements else {
        return .failure(.layoutInvalid)
      }
      // Same path as the server: measurements in the prop's unit, converted to metres.
      let toM = capture.unit == .ft ? SpiralAnalyzer.feetToMetres : 1
      built = spiralLayout(
        SpiralInput(
          heightM: height * toM, aroundM: around * toM,
          aroundTopM: aroundTop * toM, gapM: gap * toM),
        units: capture.unit, pitchM: spacingM,
        params: ["height": height, "around": around, "aroundTop": aroundTop, "gap": gap])
    }

    guard let layout = built, LayoutValidation.allNumbersFinite(layout), LayoutValidation.isValid(layout) else {
      return .failure(.layoutInvalid)
    }

    let request = PropSaveRequest(
      label: capture.label,
      kind: "spiral",
      unit: capture.unit,
      pitchMm: spacingM * 1000,
      ledProductId: capture.ledProductId,
      layout: layout,
      measurements: measurements)
    return .success(ExportResult(layout: layout, request: request))
  }
}
