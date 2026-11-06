import Foundation

/// Uncertainty for the reticle: metres to 0.01 m (`0.03 m`), feet units as inches to 0.5 in (`1.5 in`).
public func formatUncertainty(_ uncertaintyM: Double, unit: LayoutUnits) -> String {
  guard uncertaintyM.isFinite else { return "" }
  switch unit {
  case .m:
    return String(format: "%.2f m", jsRound(uncertaintyM * 100) / 100)
  case .ft:
    let inches = jsRound(uncertaintyM / metresPerInch * 2) / 2
    return String(format: "%.1f in", inches)
  }
}

/// Circumference rounded to 0.01 of the unit (`1.26 m`, `4.13 ft`).
public func formatCircumference(_ circumferenceM: Double, unit: LayoutUnits) -> String {
  guard circumferenceM.isFinite else { return "" }
  switch unit {
  case .m:
    return String(format: "%.2f m", jsRound(circumferenceM * 100) / 100)
  case .ft:
    return String(format: "%.2f ft", jsRound(circumferenceM / metresPerFoot * 100) / 100)
  }
}
