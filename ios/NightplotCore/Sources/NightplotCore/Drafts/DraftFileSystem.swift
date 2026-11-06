import Foundation

/// File access for the drafts directory. Names are plain file names, never paths.
public protocol DraftFileSystem: Sendable {
  /// File names in the drafts directory.
  func list() throws -> [String]
  func read(_ name: String) throws -> Data
  /// Replaces the file in one step. A failure leaves the previous file in place.
  func writeAtomically(_ name: String, _ data: Data) throws
  func remove(_ name: String) throws
}

/// `FileManager` implementation over one directory, normally `Application Support/Drafts/`.
public struct FileManagerDraftFileSystem: DraftFileSystem {
  public let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  /// `Application Support/Drafts/` for the current user.
  public static func applicationSupport() throws -> FileManagerDraftFileSystem {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return FileManagerDraftFileSystem(directory: base.appendingPathComponent("Drafts", isDirectory: true))
  }

  private func ensureDirectory() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  private func url(_ name: String) throws -> URL {
    // One path segment only, so a name can never leave the drafts directory.
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    return directory.appendingPathComponent(name, isDirectory: false)
  }

  public func list() throws -> [String] {
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDir), isDir.boolValue
    else { return [] }
    return try FileManager.default.contentsOfDirectory(atPath: directory.path)
  }

  public func read(_ name: String) throws -> Data {
    try Data(contentsOf: url(name))
  }

  public func writeAtomically(_ name: String, _ data: Data) throws {
    try ensureDirectory()
    try data.write(to: url(name), options: .atomic)
  }

  public func remove(_ name: String) throws {
    try FileManager.default.removeItem(at: url(name))
  }
}
