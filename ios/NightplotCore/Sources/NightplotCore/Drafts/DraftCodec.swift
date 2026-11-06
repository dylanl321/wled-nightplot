import Foundation

public enum DraftDecodeError: Error, Equatable, Sendable {
  /// Not JSON, not an object, or the fields do not decode.
  case malformed
  /// The file was written by a newer app version.
  case versionTooNew(Int)
  /// No integer `version` key.
  case missingVersion
}

/// Reads and writes draft files. Keys are sorted, and a non-finite number makes
/// `encode` throw instead of writing bad JSON.
public enum DraftCodec {
  public static let currentVersion = 1

  public static func encode(_ document: CaptureDocument) throws -> Data {
    // LayoutJSON keeps the default `.throw` strategy for NaN and infinity.
    try LayoutJSON.makeEncoder().encode(document)
  }

  public static func decode(_ data: Data) -> Result<CaptureDocument, DraftDecodeError> {
    guard let object = try? JSONSerialization.jsonObject(with: data),
      let dict = object as? [String: Any]
    else { return .failure(.malformed) }

    guard let number = dict["version"] as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID(),
      let version = Self.integer(number)
    else { return .failure(.missingVersion) }

    if version > currentVersion { return .failure(.versionTooNew(version)) }
    if version < 1 { return .failure(.malformed) }

    do {
      return .success(try LayoutJSON.makeDecoder().decode(CaptureDocument.self, from: data))
    } catch {
      return .failure(.malformed)
    }
  }

  /// The number as an `Int` only when it is a whole number in range.
  private static func integer(_ number: NSNumber) -> Int? {
    let d = number.doubleValue
    guard d.isFinite, d == d.rounded(), abs(d) < 9.0e15 else { return nil }
    return Int(d)
  }
}
