import ARKit
import Foundation
import NightplotCore

/// Keeps an `ARWorldMap` beside each draft as `<draftId>.worldmap`, in the drafts directory.
/// `DraftStore` lists and deletes these files with the draft; it never reads them.
struct WorldMapStore {
    private let fs: any DraftFileSystem

    init(fs: any DraftFileSystem) {
        self.fs = fs
    }

    /// `Application Support/Drafts/`, the same directory `AppEnvironment.live()` uses.
    static func live() -> WorldMapStore {
        let directory = URL.applicationSupportDirectory.appending(path: "Drafts", directoryHint: .isDirectory)
        return WorldMapStore(fs: FileManagerDraftFileSystem(directory: directory))
    }

    /// Shown when a Capture with points has no saved world map. New points could not be
    /// placed relative to the old ones without a shared world frame.
    static let missingMessage =
        "This capture has no saved AR map. You can view and export it, but not add points in AR."

    static func fileName(_ draftId: UUID) -> String { "\(draftId.uuidString).worldmap" }

    func exists(draftId: UUID) -> Bool {
        ((try? fs.list()) ?? []).contains(Self.fileName(draftId))
    }

    /// Replaces the stored map in one step. A failure leaves the previous map in place.
    func save(_ map: ARWorldMap, draftId: UUID) throws {
        let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
        try fs.writeAtomically(Self.fileName(draftId), data)
    }

    /// The stored map, or nil when there is none or it cannot be read.
    func load(draftId: UUID) -> ARWorldMap? {
        guard exists(draftId: draftId),
            let data = try? fs.read(Self.fileName(draftId))
        else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data)
    }
}
