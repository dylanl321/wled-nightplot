import Foundation

// Swift port of the spiral parts of `packages/shared/src/prop/wraps.ts`.
// Operation order matches the TypeScript so results agree to the last bit where
// the platform maths allows.

/// Most turns a spiral can have. 8 ft at 1 in apart is 96.
public let spiralMaxTurns: Double = 200

public struct SpiralInput: Equatable, Sendable {
    /// Metres from the bottom wrap to the top wrap.
    public var heightM: Double
    /// Metres around at the bottom.
    public var aroundM: Double
    /// Metres around at the top. 0 is a point.
    public var aroundTopM: Double
    /// Metres up from one wrap to the next, measured on the same side.
    public var gapM: Double

    public init(heightM: Double, aroundM: Double, aroundTopM: Double, gapM: Double) {
        self.heightM = heightM
        self.aroundM = aroundM
        self.aroundTopM = aroundTopM
        self.gapM = gapM
    }
}

/// Turns on a spiral: height / gap. Nil when the sizes are not usable.
public func spiralTurns(heightM: Double, gapM: Double) -> Double? {
    guard heightM > 0, gapM > 0 else { return nil }
    let turns = heightM / gapM
    guard turns.isFinite, turns >= 0.5, turns <= spiralMaxTurns else { return nil }
    return turns
}

public func spiralTurns(_ input: SpiralInput) -> Double? {
    spiralTurns(heightM: input.heightM, gapM: input.gapM)
}

private struct HelixPoint {
    var x: Double
    var y: Double
    var z: Double
}

private func radiusAt(_ input: SpiralInput, _ t: Double) -> Double {
    let bottom = input.aroundM / (2 * Double.pi)
    let top = max(0, input.aroundTopM) / (2 * Double.pi)
    return bottom + (top - bottom) * t
}

private func helixPoint(_ input: SpiralInput, _ turns: Double, _ t: Double) -> HelixPoint {
    let radius = radiusAt(input, t)
    let angle = 2 * Double.pi * turns * t
    return HelixPoint(x: -radius * cos(angle), y: input.heightM * t, z: radius * sin(angle))
}

private func round6(_ value: Double) -> Double {
    jsRound(value * 1e6) / 1e6
}

/// Real length along a spiral (a helix on a cylinder or cone), summed over short straight steps.
public func spiralLengthM(_ input: SpiralInput, _ fromT: Double = 0, _ toT: Double = 1) -> Double {
    guard let turns = spiralTurns(input) else { return 0 }
    let steps = max(8, Int((turns * 96 * abs(toT - fromT)).rounded(.up)))
    var total = 0.0
    var previous = helixPoint(input, turns, fromT)
    for step in 1...steps {
        let point = helixPoint(input, turns, fromT + ((toT - fromT) * Double(step)) / Double(steps))
        let dx = point.x - previous.x
        let dy = point.y - previous.y
        let dz = point.z - previous.z
        total += (dx * dx + dy * dy + dz * dz).squareRoot()
        previous = point
    }
    return total
}

/// A spiral seen from the front. Each run is half a turn; each keeps its real
/// length in `wrapLengthM`. Returns nil when the sizes are not usable.
public func spiralLayout(
    _ input: SpiralInput,
    units: LayoutUnits,
    pitchM: Double,
    params: [String: Double]
) -> PropLayout? {
    guard let turns = spiralTurns(input), input.aroundM > 0, input.aroundTopM >= 0, pitchM > 0 else {
        return nil
    }
    let halves = turns * 2
    var stops: [Double] = []
    let whole = Int((halves + 1e-9).rounded(.down))
    for k in 0...whole { stops.append(Double(k) / halves) }
    if 1 - stops[stops.count - 1] > 1e-6 { stops.append(1) }
    let widest = max(radiusAt(input, 0), radiusAt(input, 1))
    let corners: [LayoutCorner] = stops.enumerated().map { index, t in
        let point = helixPoint(input, turns, t)
        return LayoutCorner(id: "c\(index + 1)", x: round6(widest + point.x), y: round6(point.y))
    }
    var run: [LayoutEdge] = []
    if stops.count > 1 {
        for index in 0..<(stops.count - 1) {
            let wrap = index / 2 + 1
            run.append(LayoutEdge(
                id: "e\(index + 1)",
                from: corners[index].id,
                to: corners[index + 1].id,
                kind: .lit,
                name: "Wrap \(wrap) \(index % 2 == 0 ? "front" : "back")",
                wrapLengthM: max(1e-6, spiralLengthM(input, stops[index], stops[index + 1]))
            ))
        }
    }
    return PropLayout(
        source: .template,
        template: LayoutTemplate(type: "spiral", params: params),
        units: units,
        pitchM: pitchM,
        startOffsetM: 0,
        corners: corners,
        run: run
    )
}
