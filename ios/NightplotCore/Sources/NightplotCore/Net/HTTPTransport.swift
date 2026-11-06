import Foundation

/// One request to the Nightplot server. Build the URL with `ServerRoute` only.
public struct HTTPRequest: Equatable, Sendable {
    public var method: String
    public var url: URL
    public var body: Data?
    public var timeout: Duration

    public init(method: String, url: URL, body: Data? = nil, timeout: Duration) {
        self.method = method
        self.url = url
        self.body = body
        self.timeout = timeout
    }
}

public struct HTTPResponse: Equatable, Sendable {
    public var status: Int
    public var body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

public enum TransportError: Error, Equatable, Sendable {
    case cannotConnect
    case timedOut
    case other(String)
}

public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws(TransportError) -> HTTPResponse
}
