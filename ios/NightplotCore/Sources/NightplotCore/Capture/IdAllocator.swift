import Foundation

/// Allocates `c<n>`, `e<n>`, and `s<n>` ids. Counters only go up, so a number is never re-issued,
/// even after the id is retired or the edit is undone. Not part of the undo snapshot.
public struct IdAllocator: Equatable, Sendable, Codable {
  public var nextPoint: Int
  public var nextRun: Int
  public var nextString: Int

  public init(nextPoint: Int = 1, nextRun: Int = 1, nextString: Int = 1) {
    self.nextPoint = nextPoint
    self.nextRun = nextRun
    self.nextString = nextString
  }

  /// Next point id, skipping any id in `avoiding`.
  public mutating func point(avoiding: Set<String> = []) -> String {
    Self.issue(prefix: "c", counter: &nextPoint, avoiding: avoiding)
  }

  /// Next run id, skipping any id in `avoiding`.
  public mutating func run(avoiding: Set<String> = []) -> String {
    Self.issue(prefix: "e", counter: &nextRun, avoiding: avoiding)
  }

  /// Next string id. `nextString` is the highest string number ever used + 1.
  public mutating func string() -> String {
    let id = "s\(nextString)"
    nextString += 1
    return id
  }

  private static func issue(prefix: String, counter: inout Int, avoiding: Set<String>) -> String {
    var id = "\(prefix)\(counter)"
    counter += 1
    while avoiding.contains(id) {
      id = "\(prefix)\(counter)"
      counter += 1
    }
    return id
  }
}
