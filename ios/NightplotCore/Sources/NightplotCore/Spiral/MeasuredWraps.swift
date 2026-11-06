import Foundation

/// Keep Measured Wraps: one lit edge per half turn, sized from the marks the operator placed
/// instead of from an even gap (Req 10.7, 10.8).
public enum MeasuredWraps {
  /// Nil below 2 marks, or when a radius lookup falls outside the scan, or a gap is not positive.
  /// Corners are in metres, front view, with the lowest mark at y = 0.
  public static func layout(
    scan: ReferenceScan,
    marks: [WrapMark],
    units: LayoutUnits,
    pitchM: Double
  ) -> PropLayout? {
    let sorted = marks.sorted { $0.heightM < $1.heightM }
    guard sorted.count >= 2, pitchM > 0 else { return nil }

    var radii: [Double] = []
    for m in sorted {
      guard let r = scan.radius(atHeight: m.heightM) else { return nil }
      radii.append(r)
    }
    guard let widest = radii.max() else { return nil }
    let h1 = sorted[0].heightM

    var corners: [LayoutCorner] = [
      LayoutCorner(id: "c1", x: widest - radii[0], y: 0)
    ]
    var run: [LayoutEdge] = []

    for k in 0..<(sorted.count - 1) {
      let lowH = sorted[k].heightM
      let highH = sorted[k + 1].heightM
      let gap = highH - lowH
      guard gap > 0 else { return nil }
      let mid = (lowH + highH) / 2
      guard let rMid = scan.radius(atHeight: mid) else { return nil }

      let input = SpiralInput(
        heightM: gap, aroundM: 2 * Double.pi * radii[k],
        aroundTopM: 2 * Double.pi * radii[k + 1], gapM: gap)

      let leftId = corners[corners.count - 1].id
      let midId = "c\(corners.count + 1)"
      let nextId = "c\(corners.count + 2)"
      corners.append(LayoutCorner(id: midId, x: widest + rMid, y: mid - h1))
      corners.append(LayoutCorner(id: nextId, x: widest - radii[k + 1], y: highH - h1))

      run.append(
        LayoutEdge(
          id: "e\(run.count + 1)", from: leftId, to: midId, kind: .lit,
          name: "Wrap \(k + 1) front",
          wrapLengthM: max(1e-6, spiralLengthM(input, 0, 0.5))))
      run.append(
        LayoutEdge(
          id: "e\(run.count + 1)", from: midId, to: nextId, kind: .lit,
          name: "Wrap \(k + 1) back",
          wrapLengthM: max(1e-6, spiralLengthM(input, 0.5, 1))))
    }

    return PropLayout(
      source: .trace,
      units: units,
      pitchM: pitchM,
      startOffsetM: 0,
      corners: corners,
      run: run,
      strings: [LayoutString(id: "s1", startId: "c1", run: run)])
  }
}
