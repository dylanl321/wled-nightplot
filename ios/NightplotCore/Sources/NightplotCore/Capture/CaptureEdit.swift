import Foundation

/// Every operator edit of a Capture. Applied by `CaptureEditor.apply`.
public enum CaptureEdit: Equatable, Sendable {
  /// Req 4.2-4.5
  case placePoint(SurfaceHit, darkJump: Bool)
  /// Req 5.4
  case reusePoint(pointId: String, darkJump: Bool)
  /// Req 4.10
  case closeLoop(darkJump: Bool)
  /// Req 6.5
  case movePoint(pointId: String, to: SurfaceHit)
  /// Req 6.6
  case deletePoint(pointId: String)
  /// Req 6.7
  case insertPoint(runId: String, at: SurfaceHit)
  /// Req 6.8
  case setRunKind(runId: String, kind: RunKind)
  /// Req 6.9
  case setHiddenCount(runId: String, text: String)
  /// Req 5.1, 5.2
  case addString
  case removeString(stringId: String)
  case setKind(PropKindChoice)
  case setLabel(String)
  case setUnit(LayoutUnits)
  /// Req 7.10, 7.11
  case setTypedSpacing(text: String)
  /// Req 7.6-7.9
  case attachProduct(LedProductSummary)
  case detachProduct
}

/// Why an edit was not applied. A refusal leaves the document unchanged and records no undo step.
public enum EditRefusal: Error, Equatable, Sendable {
  /// "You have 16 strings, the most a Capture can hold."
  case stringLimitReached
  /// "A run needs two different points."
  case sameAsLastPoint
  /// "Enter a whole number from 0 to 10,000."
  case hiddenCountOutOfRange
  /// The spacing field is marked invalid.
  case spacingInvalid
  /// "This product gives no spacing."
  case productHasNoSpacing
  case labelTooLong
  case labelEmpty
  /// A stale id from a UI selection, or an edit not handled yet.
  case unknownTarget
  case closeLoopUnavailable
}
