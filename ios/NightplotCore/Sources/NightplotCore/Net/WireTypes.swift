import Foundation

/// Decodes one array element and keeps either the value or the error,
/// so one bad element does not fail the whole array.
public struct LenientElement<T: Decodable & Sendable>: Decodable, Sendable {
  public let result: Result<T, LenientDecodeError>

  public var value: T? {
    if case .success(let v) = result { return v }
    return nil
  }

  public init(result: Result<T, LenientDecodeError>) { self.result = result }

  public init(from decoder: Decoder) throws {
    do {
      let single = try decoder.singleValueContainer()
      result = .success(try single.decode(T.self))
    } catch {
      result = .failure(LenientDecodeError(description: String(describing: error)))
    }
  }
}

/// A Sendable, Equatable stand-in for the decoding error of one element.
public struct LenientDecodeError: Error, Equatable, Sendable {
  public var description: String
  public init(description: String) { self.description = description }
}

public struct HealthBody: Decodable, Sendable {
  public var ok: Bool?
  public var service: String?
  public var slice: String?
}

public struct LedProductSummary: Equatable, Sendable, Codable {
  public var id: String
  public var label: String
  public var pitchMm: Double?
  public var sectionLengthMm: Double?

  public init(id: String, label: String, pitchMm: Double? = nil, sectionLengthMm: Double? = nil) {
    self.id = id
    self.label = label
    self.pitchMm = pitchMm
    self.sectionLengthMm = sectionLengthMm
  }
}

public struct ProductsBody: Decodable, Sendable {
  public var products: [LenientElement<LedProductSummary>]
}

public struct SaveBody: Decodable, Sendable {
  public var prop: RemotePropHeader?
  public var message: String?
  public var error: String?
}

public struct RemotePropHeader: Decodable, Sendable {
  public var id: String?
}

public struct RemoteProp: Equatable, Sendable, Decodable {
  public var id: String
  public var label: String
  public var kind: String?
  public var layout: PropLayout?

  public init(id: String, label: String, kind: String? = nil, layout: PropLayout? = nil) {
    self.id = id
    self.label = label
    self.kind = kind
    self.layout = layout
  }
}

public struct PropsBody: Decodable, Sendable {
  public var props: [LenientElement<RemoteProp>]
}

public enum Measurements: Equatable, Sendable, Encodable {
  case custom
  /// Values are in the prop's unit.
  case spiral(height: Double, around: Double, aroundTop: Double, gap: Double)

  private enum CodingKeys: String, CodingKey {
    case shape, height, around, aroundTop, gap
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .custom:
      try c.encode("custom", forKey: .shape)
    case .spiral(let height, let around, let aroundTop, let gap):
      try c.encode("spiral", forKey: .shape)
      try c.encode(height, forKey: .height)
      try c.encode(around, forKey: .around)
      try c.encode(aroundTop, forKey: .aroundTop)
      try c.encode(gap, forKey: .gap)
    }
  }
}
