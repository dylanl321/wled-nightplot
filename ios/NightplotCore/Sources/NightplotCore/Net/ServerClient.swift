import Foundation

// The Nightplot server client (Req 11.5-11.7, 12.1-12.12, 14.6, 14.7).
// Every request URL is built by `ServerRoute`, so no other path can be requested.

public enum UnreachableReason: Equatable, Sendable {
  case cannotConnect
  case timedOut
  case status(Int)
  /// The server answered 200 but is not Nightplot. Carries the `service` it reported, if any.
  case wrongService(String?)
}

public enum HealthResult: Equatable, Sendable {
  case reachable
  case unreachable(UnreachableReason)
}

public enum ProductsResult: Equatable, Sendable {
  case products([LedProductSummary])
  case unavailable
}

public enum SaveOutcome: Equatable, Sendable {
  /// POST 2xx with a non-empty `prop.id`.
  case created(propId: String, message: String?)
  /// PATCH 2xx.
  case updated(message: String?)
  /// POST 2xx with no usable `prop.id` (Req 12.6).
  case createdWithoutId
  /// PATCH 404 (Req 12.4).
  case goneFromYard
  /// Any other non-2xx status (Req 12.8).
  case rejected(status: Int, message: String?)
  /// Network failure or timeout (Req 12.9).
  case didNotReach
}

/// The first part of a readback that differed (Req 12.6).
public enum ReadbackPart: Equatable, Sendable {
  case propMissing
  case label
  case stringIds
  case edgeIds
}

public enum ReadbackResult: Equatable, Sendable {
  case matches
  case mismatch(ReadbackPart)
  /// Network error, timeout, or non-2xx (Req 12.12).
  case failed
}

/// A Prop in `GET /api/props` whose layout could not be decoded (Req 14.7).
/// The client never builds a PATCH for it.
public struct RemotePropError: Error, Equatable, Sendable {
  public var id: String?
  public var label: String?
  public var description: String

  public init(id: String?, label: String?, description: String) {
    self.id = id
    self.label = label
    self.description = description
  }

  /// What to show for the Prop: its label, else its id, else a generic name.
  public var displayName: String {
    if let label, !label.isEmpty { return label }
    if let id, !id.isEmpty { return id }
    return "Unnamed Prop"
  }
}

public struct ServerClient: Sendable {
  public static let expectedService = "nightplot-configure"
  static let healthTimeout: Duration = .seconds(5)
  static let productsTimeout: Duration = .seconds(5)
  static let saveTimeout: Duration = .seconds(10)
  static let readbackTimeout: Duration = .seconds(10)

  private let address: ServerAddress
  private let transport: HTTPTransport

  public init(address: ServerAddress, transport: HTTPTransport) {
    self.address = address
    self.transport = transport
  }

  // MARK: - Health

  public func health() async -> HealthResult {
    guard let request = ServerRoute.health.request(on: address, timeout: Self.healthTimeout) else {
      return .unreachable(.cannotConnect)
    }
    let response: HTTPResponse
    do {
      response = try await transport.send(request)
    } catch {
      return .unreachable(Self.reason(for: error))
    }
    guard response.status == 200 else { return .unreachable(.status(response.status)) }
    let body = try? JSONDecoder().decode(HealthBody.self, from: response.body)
    guard body?.service == Self.expectedService else {
      return .unreachable(.wrongService(body?.service))
    }
    return .reachable
  }

  private static func reason(for error: TransportError) -> UnreachableReason {
    switch error {
    case .timedOut: return .timedOut
    case .cannotConnect, .other: return .cannotConnect
    }
  }

  // MARK: - LED products

  public func ledProducts() async -> ProductsResult {
    guard let request = ServerRoute.ledProducts.request(on: address, timeout: Self.productsTimeout),
      let response = try? await transport.send(request),
      (200..<300).contains(response.status),
      let body = try? JSONDecoder().decode(ProductsBody.self, from: response.body)
    else { return .unavailable }
    return .products(body.products.compactMap(\.value))
  }

  // MARK: - Save

  /// POST with all seven fields.
  public func create(_ request: PropSaveRequest) async -> SaveOutcome {
    guard let body = try? JSONEncoder().encode(request),
      let http = ServerRoute.props.request(
        on: address, method: "POST", body: body, timeout: Self.saveTimeout)
    else { return .didNotReach }
    let response: HTTPResponse
    do {
      response = try await transport.send(http)
    } catch {
      return .didNotReach
    }
    let parsed = try? JSONDecoder().decode(SaveBody.self, from: response.body)
    guard (200..<300).contains(response.status) else {
      return .rejected(status: response.status, message: Self.nonEmpty(parsed?.message))
    }
    guard let id = parsed?.prop?.id, !id.isEmpty else { return .createdWithoutId }
    return .created(propId: id, message: Self.nonEmpty(parsed?.message))
  }

  /// PATCH with `label`, `kind`, `layout`, and `measurements` only.
  public func update(id: String, _ request: PropSaveRequest) async -> SaveOutcome {
    let patch = PatchBody(
      label: request.label, kind: request.kind, layout: request.layout,
      measurements: request.measurements)
    guard let body = try? JSONEncoder().encode(patch),
      let http = ServerRoute.prop(id: id).request(
        on: address, method: "PATCH", body: body, timeout: Self.saveTimeout)
    else { return .didNotReach }
    let response: HTTPResponse
    do {
      response = try await transport.send(http)
    } catch {
      return .didNotReach
    }
    let parsed = try? JSONDecoder().decode(SaveBody.self, from: response.body)
    if response.status == 404 { return .goneFromYard }
    guard (200..<300).contains(response.status) else {
      return .rejected(status: response.status, message: Self.nonEmpty(parsed?.message))
    }
    return .updated(message: Self.nonEmpty(parsed?.message))
  }

  private struct PatchBody: Encodable {
    var label: String
    var kind: String
    var layout: PropLayout
    var measurements: Measurements
  }

  private static func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
  }

  // MARK: - Readback

  public func readback(id: String, expected: PropSaveRequest) async -> ReadbackResult {
    guard let request = ServerRoute.props.request(
      on: address, method: "GET", timeout: Self.readbackTimeout)
    else { return .failed }
    let response: HTTPResponse
    do {
      response = try await transport.send(request)
    } catch {
      return .failed
    }
    guard (200..<300).contains(response.status),
      let body = try? JSONDecoder().decode(PropsBody.self, from: response.body),
      let identities = try? JSONDecoder().decode(IdentityBody.self, from: response.body),
      body.props.count == identities.props.count
    else { return .failed }

    guard let index = identities.props.firstIndex(where: { $0.value?.id == id }) else {
      return .mismatch(.propMissing)
    }
    let label = identities.props[index].value?.label
    if label != expected.label { return .mismatch(.label) }
    guard let layout = body.props[index].value?.layout else { return .mismatch(.stringIds) }

    let want = layoutStrings(expected.layout)
    let have = layoutStrings(layout)
    if Set(want.map(\.id)) != Set(have.map(\.id)) { return .mismatch(.stringIds) }
    let wantEdges = Set(want.flatMap { $0.run.map(\.id) })
    let haveEdges = Set(have.flatMap { $0.run.map(\.id) })
    if wantEdges != haveEdges { return .mismatch(.edgeIds) }
    return .matches
  }

  private struct PropIdentity: Decodable, Sendable {
    var id: String?
    var label: String?
  }

  private struct IdentityBody: Decodable, Sendable {
    var props: [LenientElement<PropIdentity>]
  }

  // MARK: - Props

  /// Decodes each Prop on its own, so one bad layout does not stop the rest (Req 14.6, 14.7).
  /// Returns an empty list when the request fails.
  public func props() async -> [Result<RemoteProp, RemotePropError>] {
    guard let request = ServerRoute.props.request(
      on: address, method: "GET", timeout: Self.readbackTimeout),
      let response = try? await transport.send(request),
      (200..<300).contains(response.status),
      let body = try? JSONDecoder().decode(PropsBody.self, from: response.body)
    else { return [] }
    let identities = try? JSONDecoder().decode(IdentityBody.self, from: response.body)
    return body.props.enumerated().map { index, element in
      switch element.result {
      case .success(let prop):
        return .success(prop)
      case .failure(let error):
        let identity = identities.flatMap { $0.props.indices.contains(index) ? $0.props[index].value : nil }
        return .failure(
          RemotePropError(id: identity?.id, label: identity?.label, description: error.description))
      }
    }
  }
}
