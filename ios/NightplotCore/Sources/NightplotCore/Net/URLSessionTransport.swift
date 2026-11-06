import Foundation

/// `HTTPTransport` over an ephemeral `URLSession`: no cookies, no cache, no stored credentials.
/// The request is raced against `Task.sleep(for: timeout)` so a server that trickles bytes
/// still times out on the stated budget.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCredentialStorage = nil
        self.session = URLSession(configuration: config)
    }

    public func send(_ request: HTTPRequest) async throws(TransportError) -> HTTPResponse {
        let urlRequest = Self.makeURLRequest(request)
        let session = self.session
        let timeout = request.timeout
        let result: Result<HTTPResponse, TransportError> = await withTaskGroup(
            of: Result<HTTPResponse, TransportError>.self
        ) { group in
            group.addTask {
                do {
                    let (data, response) = try await session.data(for: urlRequest)
                    guard let http = response as? HTTPURLResponse else {
                        return .failure(.other("Not an HTTP response"))
                    }
                    return .success(HTTPResponse(status: http.statusCode, body: data))
                } catch {
                    return .failure(Self.map(error))
                }
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    return .failure(.timedOut)
                } catch {
                    return .failure(.other("Cancelled"))
                }
            }
            let first = await group.next() ?? .failure(.other("No result"))
            group.cancelAll()
            return first
        }
        switch result {
        case .success(let response): return response
        case .failure(let error): throw error
        }
    }

    static func makeURLRequest(_ request: HTTPRequest) -> URLRequest {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body
        urlRequest.timeoutInterval = seconds(request.timeout)
        urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
        if request.body != nil {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        return urlRequest
    }

    static func seconds(_ duration: Duration) -> TimeInterval {
        let parts = duration.components
        return TimeInterval(parts.seconds) + TimeInterval(parts.attoseconds) / 1e18
    }

    static func map(_ error: Error) -> TransportError {
        if error is CancellationError { return .other("Cancelled") }
        guard let urlError = error as? URLError else {
            return .other(String(describing: error))
        }
        switch urlError.code {
        case .timedOut:
            return .timedOut
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet,
             .networkConnectionLost, .dnsLookupFailed, .appTransportSecurityRequiresSecureConnection,
             .dataNotAllowed, .internationalRoamingOff, .secureConnectionFailed:
            return .cannotConnect
        case .cancelled:
            return .other("Cancelled")
        default:
            return .other(urlError.localizedDescription)
        }
    }
}
