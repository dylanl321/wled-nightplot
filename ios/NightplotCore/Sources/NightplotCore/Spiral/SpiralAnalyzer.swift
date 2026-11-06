import Foundation

/// What the wrap marks say about the object. Recomputed on every mark add or delete.
public struct SpiralReport: Equatable, Sendable {
  /// Highest mark minus lowest mark, in metres.
  public var heightM: Double
  /// 2π r at the lowest mark height.
  public var bottomCircumferenceM: Double
  /// 2π r at the highest mark height.
  public var topCircumferenceM: Double
  /// Gaps between neighbouring marks, bottom up.
  public var gapsM: [Double]
  /// `heightM / Double(count − 1)`.
  public var meanGapM: Double
  /// Mark numbers (1 = lowest) around the largest gap, set when it exceeds 1.5 × the mean.
  public var uneven: (lower: Int, upper: Int)?

  public init(
    heightM: Double,
    bottomCircumferenceM: Double,
    topCircumferenceM: Double,
    gapsM: [Double],
    meanGapM: Double,
    uneven: (lower: Int, upper: Int)?
  ) {
    self.heightM = heightM
    self.bottomCircumferenceM = bottomCircumferenceM
    self.topCircumferenceM = topCircumferenceM
    self.gapsM = gapsM
    self.meanGapM = meanGapM
    self.uneven = uneven
  }

  public static func == (a: SpiralReport, b: SpiralReport) -> Bool {
    a.heightM == b.heightM
      && a.bottomCircumferenceM == b.bottomCircumferenceM
      && a.topCircumferenceM == b.topCircumferenceM
      && a.gapsM == b.gapsM
      && a.meanGapM == b.meanGapM
      && a.uneven?.lower == b.uneven?.lower
      && a.uneven?.upper == b.uneven?.upper
  }
}

public enum SpiralAnalyzer {
  /// A gap is uneven when it is larger than this many mean gaps.
  public static let unevenFactor = 1.5
  static let feetToMetres = 0.3048

  /// Nil below 2 marks, or when a mark height is outside the scan.
  public static func report(scan: ReferenceScan, marks: [WrapMark]) -> SpiralReport? {
    guard marks.count >= 2 else { return nil }
    let sorted = marks.sorted { $0.heightM < $1.heightM }
    guard let lowest = sorted.first, let highest = sorted.last,
      let rBottom = scan.radius(atHeight: lowest.heightM),
      let rTop = scan.radius(atHeight: highest.heightM)
    else { return nil }

    let height = highest.heightM - lowest.heightM
    var gaps: [Double] = []
    for i in 1..<sorted.count { gaps.append(sorted[i].heightM - sorted[i - 1].heightM) }
    let mean = height / Double(sorted.count - 1)

    var uneven: (lower: Int, upper: Int)?
    if let largest = gaps.max(), largest > unevenFactor * mean,
      let index = gaps.firstIndex(of: largest)
    {
      uneven = (lower: index + 1, upper: index + 2)
    }

    return SpiralReport(
      heightM: height,
      bottomCircumferenceM: 2 * Double.pi * rBottom,
      topCircumferenceM: 2 * Double.pi * rTop,
      gapsM: gaps,
      meanGapM: mean,
      uneven: uneven
    )
  }

  /// Spiral measurements in the Capture's unit (metres ÷ 0.3048 for `ft`).
  public static func meanGapMeasurements(_ r: SpiralReport, unit: LayoutUnits) -> Measurements {
    let k = unit == .ft ? feetToMetres : 1
    return .spiral(
      height: r.heightM / k,
      around: r.bottomCircumferenceM / k,
      aroundTop: r.topCircumferenceM / k,
      gap: r.meanGapM / k
    )
  }
}
