import Foundation
import NightplotCore

/// The saved server address, in `UserDefaults` under `nightplot.server.host` and
/// `nightplot.server.port` (Req 11.5, 11.8).
final class ServerAddressStore {
    static let hostKey = "nightplot.server.host"
    static let portKey = "nightplot.server.port"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The saved address, or nil when none is saved or the stored values are not usable.
    func load() -> ServerAddress? {
        guard let host = defaults.string(forKey: Self.hostKey), !host.isEmpty else { return nil }
        let port = defaults.integer(forKey: Self.portKey)
        guard (1...65535).contains(port) else { return nil }
        return ServerAddress(host: host, port: port)
    }

    func save(_ address: ServerAddress) {
        defaults.set(address.host, forKey: Self.hostKey)
        defaults.set(address.port, forKey: Self.portKey)
    }
}

/// Everything `AppModel` needs from the outside world, so tests can swap each piece.
struct AppEnvironment {
    var draftStore: DraftStore
    var transport: any HTTPTransport
    var addressStore: ServerAddressStore
    /// Browses the LAN for `_nightplot._tcp` adverts (Req 11.14-11.16, 11.23).
    var browser: any ServerBrowsing
    /// Wall-clock time, used for `editedAtMs`.
    var now: @Sendable () -> Date
    /// Drives the draft save coalescing delay.
    var clock: any Clock<Duration>
    var newDraftId: @Sendable () -> UUID
    var newAnchorId: @Sendable () -> String

    /// Draft saves within this window of the first change are written together (Req 13.1).
    static let saveCoalescing: Duration = .milliseconds(200)

    init(
        draftStore: DraftStore,
        transport: any HTTPTransport,
        addressStore: ServerAddressStore,
        browser: any ServerBrowsing = NWServerBrowser(),
        now: @escaping @Sendable () -> Date = { Date() },
        clock: any Clock<Duration> = ContinuousClock(),
        newDraftId: @escaping @Sendable () -> UUID = { UUID() },
        newAnchorId: @escaping @Sendable () -> String = { UUID().uuidString }
    ) {
        self.draftStore = draftStore
        self.transport = transport
        self.addressStore = addressStore
        self.browser = browser
        self.now = now
        self.clock = clock
        self.newDraftId = newDraftId
        self.newAnchorId = newAnchorId
    }

    /// The real app: drafts in `Application Support/Drafts/`, `URLSession` for the server,
    /// and `NWBrowser` for Bonjour discovery.
    static func live() -> AppEnvironment {
        let directory = URL.applicationSupportDirectory.appending(path: "Drafts", directoryHint: .isDirectory)
        return AppEnvironment(
            draftStore: DraftStore(fs: FileManagerDraftFileSystem(directory: directory)),
            transport: URLSessionTransport(),
            addressStore: ServerAddressStore(),
            browser: NWServerBrowser())
    }

    func client(for address: ServerAddress) -> ServerClient {
        ServerClient(address: address, transport: transport)
    }
}
