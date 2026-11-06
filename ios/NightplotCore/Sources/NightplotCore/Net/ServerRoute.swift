import Foundation

/// The only routes the app may request (Req 12.10). Every request URL is built here.
public enum ServerRoute: Equatable, Sendable {
    case health
    case ledProducts
    case props
    case prop(id: String)

    /// The route's primary method: GET for reads, PATCH for `prop(id:)`.
    /// `props` also accepts POST (create).
    public var method: String {
        switch self {
        case .health, .ledProducts, .props: return "GET"
        case .prop: return "PATCH"
        }
    }

    /// Every method this route may be requested with.
    public var allowedMethods: [String] {
        switch self {
        case .health, .ledProducts: return ["GET"]
        case .props: return ["GET", "POST"]
        case .prop: return ["PATCH"]
        }
    }

    /// Path with the id percent-encoded as exactly one path segment.
    public var path: String {
        switch self {
        case .health: return "/health"
        case .ledProducts: return "/api/led-products"
        case .props: return "/api/props"
        case .prop(let id): return "/api/props/" + Self.encodeSegment(id)
        }
    }

    /// Only unreserved characters stay literal, so `/`, `?`, `#`, `%`, and spaces are encoded.
    /// `.` and `..` are encoded too so no dot segment can be formed.
    static func encodeSegment(_ id: String) -> String {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
        if encoded == "." { return "%2E" }
        if encoded == ".." { return "%2E%2E" }
        return encoded
    }

    private static let unreserved: CharacterSet = {
        var set = CharacterSet()
        set.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return set
    }()

    public func url(on address: ServerAddress) -> URL? {
        URL(string: "http://\(address.authority)\(path)")
    }

    /// Builds a request for this route. Returns nil when the method is not allowed
    /// for the route or the URL cannot be formed.
    public func request(
        on address: ServerAddress,
        method: String? = nil,
        body: Data? = nil,
        timeout: Duration
    ) -> HTTPRequest? {
        let m = method ?? self.method
        guard allowedMethods.contains(m), let url = url(on: address) else { return nil }
        return HTTPRequest(method: m, url: url, body: body, timeout: timeout)
    }
}
