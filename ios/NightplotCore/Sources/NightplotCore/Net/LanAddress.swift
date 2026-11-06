import Foundation

/// Port of `isLanAllowed` from `packages/shared/src/net/address.ts`.
/// Allows only loopback, private, and link-local addresses, `localhost`,
/// single-label names, and the local suffixes below.
public enum LanAddress {
    private static let localSuffixes = [".local", ".lan", ".home.arpa", ".internal"]

    public static func isAllowed(_ host: String) -> Bool {
        let host = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if host.isEmpty { return false }

        if host == "localhost" { return true }

        if let octets = parseIPv4(host) { return isPrivateIPv4(octets) }

        if host.contains(":") { return isPrivateIPv6(host) }

        if host.contains(".") {
            return localSuffixes.contains { host.hasSuffix($0) }
        }

        return isLabel(host)
    }

    /// `^[a-z0-9-]+$`
    private static func isLabel(_ host: String) -> Bool {
        host.utf8.allSatisfy { b in
            (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x2D
        }
    }

    /// Four dot-separated decimal parts, each 0 to 255. An empty part reads
    /// as 0, matching JavaScript's `Number("")`.
    private static func parseIPv4(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var out: [Int] = []
        for part in parts {
            if part.isEmpty {
                out.append(0)
                continue
            }
            guard part.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
                  part.count <= 3,
                  let n = Int(part), n <= 255 else { return nil }
            out.append(n)
        }
        return out
    }

    private static func isPrivateIPv4(_ o: [Int]) -> Bool {
        let a = o[0], b = o[1]
        if a == 10 { return true }
        if a == 127 { return true }
        if a == 172 && b >= 16 && b <= 31 { return true }
        if a == 192 && b == 168 { return true }
        if a == 169 && b == 254 { return true }
        return false
    }

    private static func isPrivateIPv6(_ host: String) -> Bool {
        if host == "::1" { return true }
        if host.hasPrefix("fe80:") { return true }
        if host.hasPrefix("fc") || host.hasPrefix("fd") { return true }
        return false
    }
}
