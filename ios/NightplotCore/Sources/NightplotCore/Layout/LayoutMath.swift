import Foundation

// Port of the layout math in `packages/shared/src/prop/layout.ts`.
// Every `Math.round` is `jsRound`, and the TypeScript operation order is kept.

public let metresPerFoot: Double = 0.3048
/// One inch, in metres. Twelve of these are one foot.
public let metresPerInch: Double = metresPerFoot / 12

public struct CountedEdge: Equatable, Sendable {
    public var id: String
    public var kind: RunKind
    public var lengthM: Double
    /// Lights drawn on this edge. Hidden edges report 0 here.
    public var lights: Int
    /// Hidden lights consumed and not drawn.
    public var hidden: Int

    public init(id: String, kind: RunKind, lengthM: Double, lights: Int, hidden: Int) {
        self.id = id
        self.kind = kind
        self.lengthM = lengthM
        self.lights = lights
        self.hidden = hidden
    }
}

public struct LayoutCount: Equatable, Sendable {
    public var total: Int
    public var edges: [CountedEdge]

    public init(total: Int, edges: [CountedEdge]) {
        self.total = total
        self.edges = edges
    }
}

// MARK: - Strings

public func layoutStrings(_ layout: PropLayout) -> [LayoutString] {
    if let strings = layout.strings, !strings.isEmpty { return strings }
    let startId = layout.run.first?.from ?? layout.corners.first?.id ?? "c1"
    return [LayoutString(id: "s1", startId: startId, run: layout.run)]
}

// MARK: - Lengths

private func cornerById(_ layout: PropLayout, _ id: String) -> LayoutCorner? {
    layout.corners.first { $0.id == id }
}

private func hasWrap(_ edge: LayoutEdge) -> Bool {
    if let wrap = edge.wrapLengthM, wrap > 0 { return true }
    return false
}

public func edgeLengthM(_ layout: PropLayout, _ edge: LayoutEdge) -> Double {
    if edge.kind == .hidden { return Double(max(0, edge.hiddenCount ?? 0)) * layout.pitchM }
    if hasWrap(edge), let wrap = edge.wrapLengthM { return wrap }
    return drawnLengthM(layout, edge)
}

/// The straight line between the run's corners on the drawing.
public func drawnLengthM(_ layout: PropLayout, _ edge: LayoutEdge) -> Double {
    guard let from = cornerById(layout, edge.from), let to = cornerById(layout, edge.to) else { return 0 }
    return hypot(to.x - from.x, to.y - from.y)
}

/// Round length ÷ pitch. Zero when either measurement is missing.
public func lightsOnLength(_ lengthM: Double, _ pitchM: Double) -> Int {
    if !(lengthM > 0) || !(pitchM > 0) { return 0 }
    return Int(max(0, jsRound(lengthM / pitchM)))
}

// MARK: - Counts

/// Lights on each wrapped run, counted along the whole chain of consecutive
/// wrapped lit edges: round(end ÷ pitch) − round(start ÷ pitch). A wire,
/// hidden, unwrapped, typed-count, or hand-placed edge restarts the chain.
private func wrapCounts(_ layout: PropLayout) -> [String: Int] {
    var counts: [String: Int] = [:]
    for string in layoutStrings(layout) {
        var along = 0.0
        for edge in string.run {
            let wrapped = edge.kind == .lit && hasWrap(edge) &&
                edge.manualLights != true && edge.lockedLights == nil
            guard wrapped, let wrap = edge.wrapLengthM else {
                along = 0
                continue
            }
            let end = along + wrap
            counts[edge.id] = max(0, lightsOnLength(end, layout.pitchM) - lightsOnLength(along, layout.pitchM))
            along = end
        }
    }
    return counts
}

public func edgeLightCount(_ layout: PropLayout, _ edge: LayoutEdge) -> Int {
    edgeLightCount(layout, edge, wrap: nil)
}

private func edgeLightCount(_ layout: PropLayout, _ edge: LayoutEdge, wrap: [String: Int]?) -> Int {
    if edge.kind == .wire { return 0 }
    if edge.kind == .lit && edge.manualLights == true { return edge.lights?.count ?? 0 }
    if edge.kind == .lit, let locked = edge.lockedLights { return locked }
    if edge.kind == .lit && hasWrap(edge) {
        let counts = wrap ?? wrapCounts(layout)
        if let counted = counts[edge.id] { return counted }
    }
    return lightsOnLength(edgeLengthM(layout, edge), layout.pitchM)
}

public func countLayout(_ layout: PropLayout) -> LayoutCount {
    var edges: [CountedEdge] = []
    var total = 0
    let wrap = wrapCounts(layout)
    for string in layoutStrings(layout) {
        for edge in string.run {
            let lengthM = edgeLengthM(layout, edge)
            let lights = edgeLightCount(layout, edge, wrap: wrap)
            edges.append(CountedEdge(
                id: edge.id,
                kind: edge.kind,
                lengthM: lengthM,
                lights: edge.kind == .lit ? lights : 0,
                hidden: edge.kind == .hidden ? lights : 0
            ))
            if edge.kind == .lit { total += lights }
        }
    }
    return LayoutCount(total: total, edges: edges)
}

// MARK: - Length text

/// `Number.prototype.toFixed(2)` of `Math.round(x * 100) / 100`.
private func fixed2Rounded(_ x: Double) -> String {
    String(format: "%.2f", jsRound(x * 100) / 100)
}

/// Feet and inches (`3' 11"`), or metres to two decimals (`1.20`).
public func formatLength(_ lengthM: Double, _ units: LayoutUnits) -> String {
    if !lengthM.isFinite { return "" }
    if units == .m { return fixed2Rounded(lengthM) }
    let total = jsRound(lengthM / metresPerInch)
    let sign = total < 0 ? "-" : ""
    let abs = Swift.abs(total)
    let feet = (abs / 12).rounded(.down)
    let inches = abs.truncatingRemainder(dividingBy: 12)
    if feet == 0 { return "\(sign)\(Int64(inches))\"" }
    if inches == 0 { return "\(sign)\(Int64(feet))'" }
    return "\(sign)\(Int64(feet))' \(Int64(inches))\""
}

private func regexGroups(_ pattern: String, _ text: String) -> [String?]? {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = regex.firstMatch(in: text, range: range), match.range == range else { return nil }
    var groups: [String?] = []
    for index in 0..<match.numberOfRanges {
        let r = match.range(at: index)
        if r.location == NSNotFound {
            groups.append(nil)
        } else if let swiftRange = Range(r, in: text) {
            groups.append(String(text[swiftRange]))
        } else {
            groups.append(nil)
        }
    }
    return groups
}

private let plainNumber = "[0-9]+(?:\\.[0-9]+)?"

/// Read a length field back to metres. Anything unrecognised is nil.
public func parseLength(_ text: String, _ units: LayoutUnits) -> Double? {
    var raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
    for ch in ["\u{2032}", "\u{2019}"] { raw = raw.replacingOccurrences(of: ch, with: "'") }
    for ch in ["\u{2033}", "\u{201C}", "\u{201D}"] { raw = raw.replacingOccurrences(of: ch, with: "\"") }
    if raw.isEmpty { return nil }
    if units == .m {
        guard regexGroups("^\(plainNumber)$", raw) != nil, let metres = Double(raw) else { return nil }
        return metres > 0 ? metres : nil
    }
    if regexGroups("^\(plainNumber)$", raw) != nil {
        guard let feet = Double(raw) else { return nil }
        return feet > 0 ? feet * metresPerFoot : nil
    }
    if let groups = regexGroups("^(\(plainNumber))\\s*\"$", raw), let text = groups[1], let inches = Double(text) {
        return inches > 0 ? inches * metresPerInch : nil
    }
    guard let groups = regexGroups("^([0-9]+)\\s*'\\s*(\(plainNumber))?\\s*\"?$", raw),
          let feetText = groups[1], let feet = Double(feetText) else { return nil }
    let inches: Double
    if let inchText = groups[2], !inchText.isEmpty {
        guard let parsed = Double(inchText) else { return nil }
        inches = parsed
    } else {
        inches = 0
    }
    if !inches.isFinite || inches < 0 || inches >= 12 { return nil }
    if feet == 0 && inches == 0 { return nil }
    return feet * metresPerFoot + inches * metresPerInch
}

// MARK: - Pitch text

/// Spacing as centimetres for the field. Whole centimetres stay whole (`10`).
public func formatPitchCm(_ pitchM: Double) -> String {
    let cm = jsRound(pitchM * 10000) / 100
    if !cm.isFinite { return "" }
    if cm == cm.rounded(.towardZero) && Swift.abs(cm) < 1e15 { return String(Int64(cm)) }
    var text = String(format: "%.2f", cm)
    if text.hasSuffix("0") { text.removeLast() }
    if text.hasSuffix(".0") { text.removeLast(2) }
    return text
}

/// Centimetres from the spacing field, as metres. Blank, zero, and letters are nil.
public func parsePitchCm(_ text: String) -> Double? {
    let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard regexGroups("^\(plainNumber)$", raw) != nil, let cm = Double(raw) else { return nil }
    if !(cm > 0) || cm > 200 { return nil }
    return cm / 100
}
