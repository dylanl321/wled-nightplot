import Foundation
import Network
import NightplotCore

/// Concrete `ServerBrowsing` built on Network.framework's `NWBrowser`.
///
/// It browses for `_nightplot._tcp` adverts over the browse window, resolves each
/// result to the host and the port the advert carried, and maps the outcome to a
/// `BrowseOutcome`. Everything that decides what to show or save lives in
/// `NightplotCore.ServerDiscovery`; this type only turns Network.framework
/// callbacks into plain `AdvertisedServer` values.
///
/// Honesty (AGENTS.md, Req 11.15, 11.17): the port comes from the resolved
/// endpoint, never invented. The TXT `service` entry is not trusted here; the
/// `GET /health` probe in `AppModel` is the proof. A policy-denied Local Network
/// state becomes `.permissionDenied`, which is distinct from an empty result, so
/// the UI never says "no server exists" when the real cause is a denied
/// permission (Req 11.23).
final class NWServerBrowser: ServerBrowsing {
    /// Browses for the window, then stops. Returns `.permissionDenied` when the
    /// Local Network permission is denied (DNS policy-denied), `.results` with the
    /// resolved adverts otherwise. Any non-permission failure resolves to
    /// `.results([])` so the UI says "Find could not run" rather than inventing a
    /// server or claiming none exists.
    func browse(window: Duration) async -> BrowseOutcome {
        let collector = ResultCollector()

        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(
            type: ServerDiscovery.serviceType,
            domain: "local."
        )
        let browser = NWBrowser(for: descriptor, using: parameters)

        browser.stateUpdateHandler = { state in
            switch state {
            case .waiting(let error), .failed(let error):
                if Self.isPolicyDenied(error) {
                    collector.markPermissionDenied()
                }
            default:
                break
            }
        }

        browser.browseResultsChangedHandler = { results, _ in
            collector.setResults(Array(results))
        }

        browser.start(queue: .global(qos: .userInitiated))

        // Let the browse run for the window, then stop and decide.
        try? await Task.sleep(for: window)

        if collector.permissionDenied {
            browser.cancel()
            return .permissionDenied
        }

        let results = collector.results
        browser.cancel()

        // Resolve each result to host and advertised port. Resolution opens a
        // short-lived NWConnection to read the resolved endpoint; it sends no data.
        var advertised: [AdvertisedServer] = []
        for result in results {
            if let server = await Self.resolve(result, window: window) {
                advertised.append(server)
            }
        }
        return .results(advertised)
    }

    /// Resolves one browse result to an `AdvertisedServer`. A `.service` endpoint
    /// carries the advert's name; the host and port come from the resolved remote
    /// endpoint of a short NWConnection, so no port is ever invented.
    private static func resolve(
        _ result: NWBrowser.Result,
        window: Duration
    ) async -> AdvertisedServer? {
        let name: String
        switch result.endpoint {
        case .service(let serviceName, _, _, _):
            name = serviceName
        default:
            name = ""
        }

        return await withCheckedContinuation { (continuation: CheckedContinuation<AdvertisedServer?, Never>) in
            let resolved = ResolveOnce(continuation: continuation)
            let connection = NWConnection(to: result.endpoint, using: .tcp)

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let server = Self.advertised(name: name, from: connection.currentPath?.remoteEndpoint)
                    connection.cancel()
                    resolved.finish(server)
                case .failed, .cancelled:
                    resolved.finish(nil)
                default:
                    break
                }
            }

            connection.start(queue: .global(qos: .userInitiated))

            // Bound the resolve so a stuck endpoint cannot hold the browse open.
            Task {
                try? await Task.sleep(for: window)
                connection.cancel()
                resolved.finish(nil)
            }
        }
    }

    /// Turns a resolved remote endpoint into an `AdvertisedServer`. The host is the
    /// IP or hostname and the port is the one the endpoint resolved to.
    private static func advertised(name: String, from endpoint: NWEndpoint?) -> AdvertisedServer? {
        guard let endpoint else { return nil }
        switch endpoint {
        case .hostPort(let host, let port):
            let hostText: String
            switch host {
            case .ipv4(let address):
                hostText = "\(address)".components(separatedBy: "%").first ?? "\(address)"
            case .ipv6(let address):
                hostText = "\(address)".components(separatedBy: "%").first ?? "\(address)"
            case .name(let name, _):
                hostText = name
            @unknown default:
                return nil
            }
            return AdvertisedServer(name: name, host: hostText, port: Int(port.rawValue))
        default:
            return nil
        }
    }

    /// True when the error is the DNS policy-denied code that signals a denied
    /// Local Network permission.
    private static func isPolicyDenied(_ error: NWError) -> Bool {
        if case .dns(let code) = error {
            return code == kDNSServiceErr_PolicyDenied
        }
        return false
    }
}

/// Thread-safe accumulator for browse state, written from Network.framework's
/// queue callbacks and read once the window ends.
private final class ResultCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var _results: [NWBrowser.Result] = []
    private var _permissionDenied = false

    func setResults(_ results: [NWBrowser.Result]) {
        lock.lock(); defer { lock.unlock() }
        _results = results
    }

    func markPermissionDenied() {
        lock.lock(); defer { lock.unlock() }
        _permissionDenied = true
    }

    var results: [NWBrowser.Result] {
        lock.lock(); defer { lock.unlock() }
        return _results
    }

    var permissionDenied: Bool {
        lock.lock(); defer { lock.unlock() }
        return _permissionDenied
    }
}

/// Resumes a continuation exactly once, guarding against the several callback
/// paths (ready, failed, cancelled, timeout) that can all try to finish a resolve.
private final class ResolveOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    private let continuation: CheckedContinuation<AdvertisedServer?, Never>

    init(continuation: CheckedContinuation<AdvertisedServer?, Never>) {
        self.continuation = continuation
    }

    func finish(_ value: AdvertisedServer?) {
        lock.lock()
        if done {
            lock.unlock()
            return
        }
        done = true
        lock.unlock()
        continuation.resume(returning: value)
    }
}
