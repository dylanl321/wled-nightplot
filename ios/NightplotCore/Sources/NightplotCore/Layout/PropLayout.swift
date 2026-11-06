import Foundation

// Swift mirror of `packages/shared/src/prop/layout.ts`.
// Field names and optionality match the TypeScript type exactly.
// Optionals use Swift's synthesized `encodeIfPresent`, so absent fields are
// omitted from JSON, never written as `null`. Unknown keys are ignored on decode.

public enum LayoutSource: String, Codable, Sendable { case template, trace, net }
public enum LayoutUnits: String, Codable, Sendable { case ft, m }
public enum RunKind: String, Codable, Sendable { case lit, wire, hidden }

/// A tapered-run arc. Phase 1 draws the straight chord.
public struct LayoutArc: Equatable, Sendable, Codable {
    public var riseM: Double

    public init(riseM: Double) {
        self.riseM = riseM
    }
}

/// One light the operator placed on a run. Metres from that run's start.
public struct PlacedLight: Equatable, Sendable, Codable {
    public var id: String
    public var alongM: Double

    public init(id: String, alongM: Double) {
        self.id = id
        self.alongM = alongM
    }
}

public struct LayoutCorner: Equatable, Sendable, Codable {
    public var id: String
    public var x: Double
    public var y: Double
    public var physicalId: String?

    public init(id: String, x: Double, y: Double, physicalId: String? = nil) {
        self.id = id
        self.x = x
        self.y = y
        self.physicalId = physicalId
    }
}

public struct LayoutEdge: Equatable, Sendable, Codable {
    public var id: String
    public var from: String
    public var to: String
    public var kind: RunKind
    public var lockedLengthM: Double?
    public var lengthPinned: Bool?
    public var lockedLights: Int?
    public var manualLights: Bool?
    public var lights: [PlacedLight]?
    public var name: String?
    public var hiddenCount: Int?
    public var arc: LayoutArc?
    public var wrapLengthM: Double?

    public init(
        id: String,
        from: String,
        to: String,
        kind: RunKind,
        lockedLengthM: Double? = nil,
        lengthPinned: Bool? = nil,
        lockedLights: Int? = nil,
        manualLights: Bool? = nil,
        lights: [PlacedLight]? = nil,
        name: String? = nil,
        hiddenCount: Int? = nil,
        arc: LayoutArc? = nil,
        wrapLengthM: Double? = nil
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.kind = kind
        self.lockedLengthM = lockedLengthM
        self.lengthPinned = lengthPinned
        self.lockedLights = lockedLights
        self.manualLights = manualLights
        self.lights = lights
        self.name = name
        self.hiddenCount = hiddenCount
        self.arc = arc
        self.wrapLengthM = wrapLengthM
    }
}

/// One physical string. Indexes on this string start at 0, in `run` order.
public struct LayoutString: Equatable, Sendable, Codable {
    public var id: String
    public var startId: String
    public var run: [LayoutEdge]

    public init(id: String, startId: String, run: [LayoutEdge]) {
        self.id = id
        self.startId = startId
        self.run = run
    }
}

public struct LayoutFace: Equatable, Sendable, Codable {
    public var id: String
    public var name: String
    public var cornerIds: [String]

    public init(id: String, name: String, cornerIds: [String]) {
        self.id = id
        self.name = name
        self.cornerIds = cornerIds
    }
}

/// A tapered trunk or branch drawn behind the lights. Metres, y up.
public struct LayoutBody: Equatable, Sendable, Codable {
    public var id: String
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double
    public var r0: Double
    public var r1: Double

    public init(id: String, x0: Double, y0: Double, x1: Double, y1: Double, r0: Double, r1: Double) {
        self.id = id
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
        self.r0 = r0
        self.r1 = r1
    }
}

public struct LayoutTemplate: Equatable, Sendable, Codable {
    public var type: String
    public var params: [String: Double]

    public init(type: String, params: [String: Double]) {
        self.type = type
        self.params = params
    }
}

public struct LayoutNet: Equatable, Sendable, Codable {
    public var sides: Double
    public var widthM: Double
    public var heightM: Double

    public init(sides: Double, widthM: Double, heightM: Double) {
        self.sides = sides
        self.widthM = widthM
        self.heightM = heightM
    }
}

public struct PropLayout: Equatable, Sendable, Codable {
    public var source: LayoutSource
    public var template: LayoutTemplate?
    public var net: LayoutNet?
    public var units: LayoutUnits
    public var pitchM: Double
    public var startOffsetM: Double
    public var corners: [LayoutCorner]
    public var run: [LayoutEdge]
    public var strings: [LayoutString]?
    public var faces: [LayoutFace]?
    public var bodies: [LayoutBody]?
    public var stringLights: Int?
    public var retiredIds: [String]?

    public init(
        source: LayoutSource,
        template: LayoutTemplate? = nil,
        net: LayoutNet? = nil,
        units: LayoutUnits,
        pitchM: Double,
        startOffsetM: Double,
        corners: [LayoutCorner],
        run: [LayoutEdge],
        strings: [LayoutString]? = nil,
        faces: [LayoutFace]? = nil,
        bodies: [LayoutBody]? = nil,
        stringLights: Int? = nil,
        retiredIds: [String]? = nil
    ) {
        self.source = source
        self.template = template
        self.net = net
        self.units = units
        self.pitchM = pitchM
        self.startOffsetM = startOffsetM
        self.corners = corners
        self.run = run
        self.strings = strings
        self.faces = faces
        self.bodies = bodies
        self.stringLights = stringLights
        self.retiredIds = retiredIds
    }
}

/// Shared JSON coding for layouts. Keys are sorted so output is stable.
/// The default non-conforming float strategy (`.throw`) is kept on purpose:
/// a NaN or infinite number makes encoding throw instead of writing bad JSON.
public enum LayoutJSON {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func makeDecoder() -> JSONDecoder {
        JSONDecoder()
    }
}
