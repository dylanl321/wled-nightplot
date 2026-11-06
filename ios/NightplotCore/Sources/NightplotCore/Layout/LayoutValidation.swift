import Foundation

// Port of `isPropLayout` and its helpers from `packages/shared/src/prop/layout.ts`.
// `isPropLayout` runs on `JSONSerialization` output (`Any`) and checks types the
// way the TypeScript does. Like the TypeScript, it does not check `template`,
// `net`, `faces`, `lengthPinned`, or `arc`.

public enum LayoutValidation {
    /// Mirrors `isPropLayout(value)`.
    public static func isPropLayout(_ json: Any) -> Bool {
        guard let row = json as? [String: Any] else { return false }

        guard let source = row["source"] as? String, ["template", "trace", "net"].contains(source) else { return false }
        guard let units = row["units"] as? String, ["ft", "m"].contains(units) else { return false }
        guard let pitch = number(row["pitchM"]), pitch > 0 else { return false }
        guard let offset = number(row["startOffsetM"]), offset >= 0, offset.isFinite else { return false }
        guard let corners = row["corners"] as? [Any], let run = row["run"] as? [Any] else { return false }
        guard corners.allSatisfy(isCorner) else { return false }

        var ids = Set<String>()
        for corner in corners {
            if let id = (corner as? [String: Any])?["id"] as? String { ids.insert(id) }
        }
        guard ids.count == corners.count else { return false }
        guard run.allSatisfy({ isEdge($0, ids) }) else { return false }

        if let strings = row["strings"] {
            guard let list = strings as? [Any] else { return false }
            for entry in list {
                guard let item = entry as? [String: Any] else { return false }
                guard item["id"] is String, let startId = item["startId"] as? String, ids.contains(startId) else { return false }
                guard let stringRun = item["run"] as? [Any], stringRun.allSatisfy({ isEdge($0, ids) }) else { return false }
            }
        }

        if let stringLights = row["stringLights"] {
            guard let n = integer(stringLights), n >= 0 else { return false }
        }
        if let retired = row["retiredIds"] {
            guard let list = retired as? [Any], list.allSatisfy({ $0 is String }) else { return false }
        }
        if let bodies = row["bodies"] {
            guard let list = bodies as? [Any], list.allSatisfy(isBody) else { return false }
        }
        return true
    }

    /// Encodes the layout and runs the `Any` form through `isPropLayout`.
    /// A non-finite number makes encoding throw, which counts as invalid.
    public static func isValid(_ layout: PropLayout) -> Bool {
        guard allNumbersFinite(layout) else { return false }
        guard let data = try? LayoutJSON.makeEncoder().encode(layout),
              let json = try? JSONSerialization.jsonObject(with: data) else { return false }
        return isPropLayout(json)
    }

    /// True when every numeric field of the layout is finite.
    public static func allNumbersFinite(_ layout: PropLayout) -> Bool {
        var numbers: [Double] = [layout.pitchM, layout.startOffsetM]
        if let template = layout.template { numbers.append(contentsOf: template.params.values) }
        if let net = layout.net { numbers.append(contentsOf: [net.sides, net.widthM, net.heightM]) }
        for corner in layout.corners { numbers.append(contentsOf: [corner.x, corner.y]) }
        for edge in layout.run { appendNumbers(of: edge, to: &numbers) }
        for string in layout.strings ?? [] {
            for edge in string.run { appendNumbers(of: edge, to: &numbers) }
        }
        for body in layout.bodies ?? [] {
            numbers.append(contentsOf: [body.x0, body.y0, body.x1, body.y1, body.r0, body.r1])
        }
        return numbers.allSatisfy { $0.isFinite }
    }

    // MARK: - Helpers

    private static func appendNumbers(of edge: LayoutEdge, to numbers: inout [Double]) {
        if let v = edge.lockedLengthM { numbers.append(v) }
        if let v = edge.wrapLengthM { numbers.append(v) }
        if let v = edge.arc?.riseM { numbers.append(v) }
        for light in edge.lights ?? [] { numbers.append(light.alongM) }
    }

    private static func isBool(_ n: NSNumber) -> Bool {
        #if canImport(Darwin)
        return CFGetTypeID(n) == CFBooleanGetTypeID()
        #else
        return String(cString: n.objCType) == "c" && (n.intValue == 0 || n.intValue == 1)
        #endif
    }

    /// A JSON number (not a boolean), as a Double.
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, !isBool(n) else { return nil }
        return n.doubleValue
    }

    /// `Number.isInteger`: a finite number with no fractional part.
    private static func integer(_ value: Any?) -> Double? {
        guard let d = number(value), d.isFinite, d == d.rounded(.towardZero) else { return nil }
        return d
    }

    private static func isNonEmptyString(_ value: Any?) -> Bool {
        guard let s = value as? String else { return false }
        return !s.isEmpty
    }

    private static func isCorner(_ value: Any) -> Bool {
        guard let row = value as? [String: Any] else { return false }
        guard isNonEmptyString(row["id"]) else { return false }
        guard let x = number(row["x"]), x.isFinite, let y = number(row["y"]), y.isFinite else { return false }
        return true
    }

    private static func isBody(_ value: Any) -> Bool {
        guard let row = value as? [String: Any], isNonEmptyString(row["id"]) else { return false }
        var values: [Double] = []
        for key in ["x0", "y0", "x1", "y1", "r0", "r1"] {
            guard let n = number(row[key]), n.isFinite else { return false }
            values.append(n)
        }
        return values[4] > 0 && values[5] > 0
    }

    private static func isEdge(_ value: Any, _ ids: Set<String>) -> Bool {
        guard let row = value as? [String: Any] else { return false }
        guard let kind = row["kind"] as? String, ["lit", "wire", "hidden"].contains(kind) else { return false }
        guard row["id"] is String, let from = row["from"] as? String, let to = row["to"] as? String else { return false }
        guard ids.contains(from), ids.contains(to) else { return false }
        for key in ["lockedLengthM", "wrapLengthM"] {
            if let v = row[key] {
                guard let n = number(v), n > 0, n.isFinite else { return false }
            }
        }
        for key in ["hiddenCount", "lockedLights"] {
            if let v = row[key] {
                guard let n = integer(v), n >= 0 else { return false }
            }
        }
        if let v = row["manualLights"] {
            guard let n = v as? NSNumber, isBool(n) else { return false }
        }
        if let v = row["lights"], !isPlacedLights(v) { return false }
        if let v = row["name"] {
            guard let s = v as? String,
                  !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  s.utf16.count <= 40 else { return false }
        }
        return true
    }

    private static func isPlacedLights(_ value: Any) -> Bool {
        guard let list = value as? [Any] else { return false }
        var ids = Set<String>()
        for light in list {
            guard let row = light as? [String: Any] else { return false }
            guard let id = row["id"] as? String, !id.isEmpty, !ids.contains(id) else { return false }
            guard let along = number(row["alongM"]), along.isFinite, along >= 0 else { return false }
            ids.insert(id)
        }
        return true
    }
}

public func isPropLayout(_ json: Any) -> Bool {
    LayoutValidation.isPropLayout(json)
}

extension PropLayout {
    /// Encodes and validates this layout. See `LayoutValidation.isValid`.
    public var isValid: Bool { LayoutValidation.isValid(self) }
}

public func isValid(_ layout: PropLayout) -> Bool {
    LayoutValidation.isValid(layout)
}
