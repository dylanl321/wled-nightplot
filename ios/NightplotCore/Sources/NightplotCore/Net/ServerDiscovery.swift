import Foundation

// Server discovery decisions (Req 11.15-11.17, 11.20, 11.21).
//
// NWBrowser is Network.framework, so the browser itself lives in the app target
// behind `ServerBrowsing`. Everything that decides what to show or save is a pure
// function here in NightplotCore, so it is testable with no UIKit.

/// A server resolved from a Bonjour advert: the advertised name, host, and the
/// port the advert carried. The app never supplies a port the advert did not
/// carry (Req 11.15).
public struct AdvertisedServer: Equatable, Hashable, Sendable {
    public var name: String
    public var host: String
    public var port: Int

    public init(name: String, host: String, port: Int) {
        self.name = name
        self.host = host
        self.port = port
    }

    /// `host:port`, used as the dedupe key.
    fileprivate var key: String { "\(host):\(port)" }
}

/// The outcome of a browse. A policy-denied Local Network state is distinct from
/// an empty result (Req 11.23, "Unknown is not empty").
public enum BrowseOutcome: Equatable, Sendable {
    case results([AdvertisedServer])
    case permissionDenied
}

/// Browses for `_nightplot._tcp` adverts. The app target supplies an `NWBrowser`
/// implementation; tests supply a fake.
public protocol ServerBrowsing: Sendable {
    func browse(window: Duration) async -> BrowseOutcome
}

/// A resolved advert paired with the result of probing it with `GET /health`.
public struct FoundServer: Equatable, Sendable {
    public var server: AdvertisedServer
    public var health: HealthResult

    public init(server: AdvertisedServer, health: HealthResult) {
        self.server = server
        self.health = health
    }
}

/// The find flow's state for the UI.
public enum FindState: Equatable, Sendable {
    case idle
    case browsing
    case done(found: [FoundServer], autoSaved: ServerAddress?)
    case localNetworkDenied
}

public enum ServerDiscovery {
    /// How long a single browse runs before results are decided (Req 11.17).
    public static let browseWindow: Duration = .seconds(5)

    /// The Bonjour service type advertised by the server (Req 11.14).
    public static let serviceType = "_nightplot._tcp"

    /// Filters raw adverts down to the ones the app will probe and show.
    ///
    /// Drops every row whose host is not a LAN address (Req 11.16) or whose port
    /// is outside 1 to 65535 (Req 11.15). Removes duplicates by `host:port` (the
    /// same server heard on several interfaces), keeping the first seen. Sorts by
    /// name then `host:port`. It never fills in a port the advert did not carry.
    public static func candidates(_ raw: [AdvertisedServer]) -> [AdvertisedServer] {
        var seen = Set<String>()
        var kept: [AdvertisedServer] = []
        for server in raw {
            guard LanAddress.isAllowed(server.host) else { continue }
            guard server.port >= 1, server.port <= 65535 else { continue }
            guard seen.insert(server.key).inserted else { continue }
            kept.append(server)
        }
        return kept.sorted { a, b in
            if a.name != b.name { return a.name < b.name }
            return a.key < b.key
        }
    }

    /// A row is usable exactly when its `GET /health` probe reached Nightplot.
    /// An advertised but unreachable server is never usable (Req 11.17), so a dead
    /// advert cannot be offered or auto-saved.
    public static func isUsable(_ found: FoundServer) -> Bool {
        found.health == .reachable
    }

    /// Returns the address of the one usable row when exactly one is usable, and
    /// `nil` for zero or two or more (Req 11.20, 11.21). The pick is validated
    /// through `ServerAddressInput.validate`, the same checks a typed address
    /// passes (Req 11.18); if validation fails, nothing is returned.
    public static func autoPick(_ found: [FoundServer]) -> ServerAddress? {
        let usable = found.filter(isUsable)
        guard usable.count == 1, let only = usable.first else { return nil }
        let result = ServerAddressInput.validate(
            host: only.server.host,
            portText: String(only.server.port)
        )
        switch result {
        case .success(let address): return address
        case .failure: return nil
        }
    }
}
