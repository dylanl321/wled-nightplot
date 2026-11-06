import Foundation

/// JavaScript `Math.round`: halves round toward +infinity (`jsRound(-2.5) == -2`).
/// Swift's `rounded()` rounds halves away from zero, so every ported rounding uses this.
public func jsRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}
