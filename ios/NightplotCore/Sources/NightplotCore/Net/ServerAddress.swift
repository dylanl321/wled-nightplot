import Foundation

/// A validated Nightplot server address. Build one with `ServerAddressInput.validate`.
public struct ServerAddress: Equatable, Sendable, Codable {
    public var host: String
    public var port: Int

    public init(host: String, port: Int) {
        self.host = host
        self.port = port
    }

    /// `host:port` for a URL authority. IPv6 literals are bracketed.
    public var authority: String {
        let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        return "\(h):\(port)"
    }
}

public enum AddressError: Error, Equatable, Sendable {
    case hostEmpty
    case hostTooLong
    case portInvalid
    case notLan
}

public enum ServerAddressInput {
    public static let defaultPort = 43181

    public static func validate(host: String, portText: String) -> Result<ServerAddress, AddressError> {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .failure(.hostEmpty) }
        if trimmed.count > 253 { return .failure(.hostTooLong) }

        // `^\d+$`, ASCII digits only, then 1 to 65535.
        guard !portText.isEmpty,
              portText.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              let port = Int(portText), port >= 1, port <= 65535
        else { return .failure(.portInvalid) }

        guard LanAddress.isAllowed(trimmed) else { return .failure(.notLan) }
        return .success(ServerAddress(host: trimmed, port: port))
    }
}
