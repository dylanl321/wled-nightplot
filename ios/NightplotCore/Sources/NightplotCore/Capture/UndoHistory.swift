import Foundation

/// Whole-`Capture` snapshot history. Only `capture` is snapshotted; ids, lost anchors,
/// prop id, flat and spiral state live outside it, so Undo never re-issues an id.
public struct UndoHistory: Sendable {
  public static let limit = 100

  /// Oldest first, count <= limit.
  public private(set) var past: [Capture]
  public private(set) var future: [Capture]

  public init() {
    self.past = []
    self.future = []
  }

  /// Records the state before an edit. Drops the oldest entry past the limit and clears the future.
  public mutating func record(before: Capture) {
    past.append(before)
    if past.count > Self.limit {
      past.removeFirst(past.count - Self.limit)
    }
    future.removeAll()
  }

  /// Returns the previous snapshot, pushing `current` onto the future. Nil when nothing to undo.
  public mutating func undo(current: Capture) -> Capture? {
    guard let previous = past.popLast() else { return nil }
    future.append(current)
    return previous
  }

  /// Returns the next snapshot, pushing `current` onto the past. Nil when nothing to redo.
  public mutating func redo(current: Capture) -> Capture? {
    guard let next = future.popLast() else { return nil }
    past.append(current)
    if past.count > Self.limit {
      past.removeFirst(past.count - Self.limit)
    }
    return next
  }

  public var canUndo: Bool { !past.isEmpty }
  public var canRedo: Bool { !future.isEmpty }
}
