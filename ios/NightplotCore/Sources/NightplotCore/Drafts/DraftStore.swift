import Foundation

public enum DraftListEntry: Equatable, Sendable {
  case readable(id: UUID, label: String, kind: String, stringCount: Int, editedAtMs: Int64)
  case unreadable(fileName: String)
}

public enum DraftSaveError: Error, Equatable, Sendable {
  /// The document could not be encoded (for example a non-finite number).
  case encodeFailed
  /// The file system refused the write. The last good file is still in place.
  case writeFailed
}

/// Drafts as `<draftId>.json` files. Unreadable files are listed but never rewritten
/// or deleted here. World maps (`<draftId>.worldmap`) live beside them and are not drafts.
public actor DraftStore {
  private let fs: DraftFileSystem

  public init(fs: DraftFileSystem) {
    self.fs = fs
  }

  static func jsonName(_ id: UUID) -> String { "\(id.uuidString).json" }
  static func worldMapName(_ id: UUID) -> String { "\(id.uuidString).worldmap" }

  /// Readable drafts newest first by `editedAtMs`, then every other file as unreadable.
  public func list() -> [DraftListEntry] {
    guard let names = try? fs.list() else { return [] }
    var readable: [(entry: DraftListEntry, editedAtMs: Int64, name: String)] = []
    var unreadable: [String] = []
    for name in names.sorted() {
      if name.hasSuffix(".worldmap") { continue }
      if let document = readDocument(named: name) {
        readable.append(
          (
            .readable(
              id: document.draftId, label: document.capture.label,
              kind: document.capture.kind.rawValue,
              stringCount: document.capture.strings.count, editedAtMs: document.editedAtMs),
            document.editedAtMs, name
          ))
      } else {
        unreadable.append(name)
      }
    }
    readable.sort { a, b in
      a.editedAtMs != b.editedAtMs ? a.editedAtMs > b.editedAtMs : a.name < b.name
    }
    return readable.map(\.entry) + unreadable.map { .unreadable(fileName: $0) }
  }

  public func load(_ id: UUID) -> Result<CaptureDocument, DraftDecodeError> {
    guard let data = try? fs.read(Self.jsonName(id)) else { return .failure(.malformed) }
    return DraftCodec.decode(data)
  }

  /// Writes `<draftId>.json` atomically. On failure the last good file stays.
  public func save(_ document: CaptureDocument) -> Result<Void, DraftSaveError> {
    let data: Data
    do { data = try DraftCodec.encode(document) } catch { return .failure(.encodeFailed) }
    do {
      try fs.writeAtomically(Self.jsonName(document.draftId), data)
      return .success(())
    } catch {
      return .failure(.writeFailed)
    }
  }

  /// Removes `<draftId>.json` and `<draftId>.worldmap`. A missing file is not an error.
  public func delete(_ id: UUID) throws {
    let existing = Set((try? fs.list()) ?? [])
    var firstError: Error?
    for name in [Self.jsonName(id), Self.worldMapName(id)] where existing.contains(name) {
      do { try fs.remove(name) } catch { firstError = firstError ?? error }
    }
    if let firstError { throw firstError }
  }

  /// A document only when the file decodes and its `draftId` matches the file name.
  private func readDocument(named name: String) -> CaptureDocument? {
    guard name.hasSuffix(".json"), let data = try? fs.read(name),
      case .success(let document) = DraftCodec.decode(data),
      name == Self.jsonName(document.draftId)
    else { return nil }
    return document
  }
}
