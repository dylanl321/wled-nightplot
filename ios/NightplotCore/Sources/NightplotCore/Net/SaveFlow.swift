import Foundation

// The save flow (Req 12.2, 12.4, 12.6-12.9, 12.11, 12.12).
// It saves a Prop as a design, then reads it back. It never sends anything to a controller.

public enum SaveState: Equatable, Sendable {
  case idle, sending, readingBack
  case confirmed(serverMessage: String?)
  /// `nil` part: the readback could not name a differing part (for example no id came back).
  case notConfirmed(ReadbackPart?)
  /// The readback could not complete. Offers retry readback.
  case readbackFailed
  /// PATCH 404. Offers save as new or cancel.
  case goneFromYard
  /// Server `message`, or `HTTP <status>` (Req 12.8).
  case rejected(text: String)
  case didNotReach
}

public actor SaveFlow {
  private let client: ServerClient
  private let persistPropId: @Sendable (String?) async -> Bool
  private var busy = false
  private var state: SaveState = .idle
  private var idNotSavedOnPhone = false

  /// `persistPropId` stores the id on the document and writes the draft. It returns false when
  /// the local write fails. Passing `nil` clears the id.
  public init(client: ServerClient, persistPropId: @escaping @Sendable (String?) async -> Bool) {
    self.client = client
    self.persistPropId = persistPropId
  }

  public var inFlight: Bool { busy }

  /// The state of the last or current save.
  public var currentState: SaveState { state }

  /// True when the last save created a Prop but this phone could not record its id (Req 12.2).
  /// The screen shows `Wording.propIdNotRecorded` next to the result.
  public var propIdNotRecorded: Bool { idNotSavedOnPhone }

  /// POST when `storedPropId` is nil, otherwise PATCH. A call while another is running returns
  /// the current state and sends nothing (Req 12.11).
  public func save(_ request: PropSaveRequest, storedPropId: String?) async -> SaveState {
    if busy { return state }
    begin()
    defer { busy = false }
    if let id = storedPropId, !id.isEmpty {
      return await finish(update: id, request)
    }
    return await finish(create: request)
  }

  /// Sends only `GET /api/props` (Req 12.12).
  public func retryReadback(propId: String, expected: PropSaveRequest) async -> SaveState {
    if busy { return state }
    begin()
    defer { busy = false }
    idNotSavedOnPhone = false
    return await readBack(propId: propId, expected: expected)
  }

  /// Clears the stored id, then POSTs (Req 12.4).
  public func saveAsNew(_ request: PropSaveRequest) async -> SaveState {
    if busy { return state }
    begin()
    defer { busy = false }
    _ = await persistPropId(nil)
    return await finish(create: request)
  }

  // MARK: - Steps

  private func begin() {
    busy = true
    idNotSavedOnPhone = false
    state = .sending
  }

  private func finish(update id: String, _ request: PropSaveRequest) async -> SaveState {
    switch await client.update(id: id, request) {
    case .updated(let message):
      return await readBack(propId: id, expected: request, message: message)
    case .goneFromYard:
      return set(.goneFromYard)
    case .rejected(let status, let message):
      return set(.rejected(text: Wording.rejected(message: message, status: status)))
    case .didNotReach:
      return set(.didNotReach)
    case .created, .createdWithoutId:
      return set(.notConfirmed(nil))
    }
  }

  private func finish(create request: PropSaveRequest) async -> SaveState {
    switch await client.create(request) {
    case .created(let id, let message):
      // The id is stored before the readback starts (Req 12.2).
      let stored = await persistPropId(id)
      idNotSavedOnPhone = !stored
      return await readBack(propId: id, expected: request, message: message)
    case .createdWithoutId:
      return set(.notConfirmed(nil))
    case .rejected(let status, let message):
      return set(.rejected(text: Wording.rejected(message: message, status: status)))
    case .didNotReach:
      return set(.didNotReach)
    case .updated, .goneFromYard:
      return set(.notConfirmed(nil))
    }
  }

  private func readBack(
    propId: String, expected: PropSaveRequest, message: String? = nil
  ) async -> SaveState {
    state = .readingBack
    switch await client.readback(id: propId, expected: expected) {
    case .matches:
      return set(.confirmed(serverMessage: message))
    case .mismatch(let part):
      return set(.notConfirmed(part))
    case .failed:
      return set(.readbackFailed)
    }
  }

  private func set(_ next: SaveState) -> SaveState {
    state = next
    return next
  }
}
