import Foundation

// Bead layout is pure drawing math. It turns a `PropLayout` and the
// `CaptureCounter` result into the Beads the front view draws, and turns a
// list of lit runs into the bead chains the AR overlay draws. It lights
// nothing: a Bead is a drawing of where a light goes, never a lit LED.
//
// The core never invents Beads. A run the app could not measure yields the
// `unknown` status with no centres, never a guessed count. "Unknown is not
// empty" (AGENTS.md).

/// A point on the Prop drawing plane, in metres. x along, y up, front-on.
public struct Point2: Equatable, Sendable, Codable {
  public var x: Double
  public var y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

/// What a run draws on the front view.
/// - `beads`: a lit run with a known count; `centres` holds that many points.
/// - `unknown`: a lit run with no measurable count; `centres` is empty.
/// - `wire`: a dark jump; no Beads.
/// - `hidden`: lights consumed but not shown; `count` is the whole run total,
///   while `centres` is capped at `hiddenBeadDrawCap`.
public enum BeadStatus: Equatable, Sendable { case beads, unknown, wire, hidden(count: Int) }

/// The Beads one run draws, with its status and the bead centres on the
/// drawn edge. A run beyond the canvas cap keeps its status but drops its
/// centres, so the canvas draws it as a Rail with the count label.
public struct EdgeBeads: Equatable, Sendable {
  public var stringId: String
  public var edgeId: String
  public var status: BeadStatus
  public var centres: [Point2]  // metres on the Prop drawing plane

  public init(stringId: String, edgeId: String, status: BeadStatus, centres: [Point2]) {
    self.stringId = stringId
    self.edgeId = edgeId
    self.status = status
    self.centres = centres
  }
}

/// One lit run handed to `sceneBeads`: its 3D endpoints and the spacing when
/// known. `anchored` is false when either end is an unanchored point, so the
/// run draws as a tube rather than a guessed chain.
public struct RunBeadInput: Equatable, Sendable {
  public var stringId: String
  public var edgeId: String
  public var startM: Vec3
  public var endM: Vec3
  public var spacingM: Double?
  public var anchored: Bool

  public init(
    stringId: String,
    edgeId: String,
    startM: Vec3,
    endM: Vec3,
    spacingM: Double?,
    anchored: Bool = true
  ) {
    self.stringId = stringId
    self.edgeId = edgeId
    self.startM = startM
    self.endM = endM
    self.spacingM = spacingM
    self.anchored = anchored
  }
}

/// How the AR overlay draws one run: a chain of emissive spheres at the known
/// spacing, or a tube for everything else.
public enum RunBeadPlan: Equatable, Sendable {
  /// Draw a sphere at each centre, in world metres.
  case chain(stringId: String, edgeId: String, centres: [Vec3])
  /// Draw a tube from `startM` to `endM`.
  case tube(stringId: String, edgeId: String, startM: Vec3, endM: Vec3)
}

public enum BeadLayout {
  /// The most Beads the front view will place before falling back to Rails.
  public static let canvasBeadCap = 5_000
  /// The most Beads a single hidden run draws; its label still shows the whole count.
  public static let hiddenBeadDrawCap = 12
  /// The most spheres the AR scene plans in total before falling back to tubes.
  public static let sceneBeadCap = 400

  /// Beads for the front view, one `EdgeBeads` per run, in string then run
  /// order. Lit known runs get their `CaptureCounter` count as centres on the
  /// drawn edge; lit unknown runs get `.unknown` and no centres; wire runs get
  /// no centres; hidden runs get `min(count, hiddenBeadDrawCap)` centres.
  /// Runs whose centres would push the running total past `canvasBeadCap` keep
  /// their status but drop their centres, so the canvas draws them as Rails.
  public static func beads(layout: PropLayout, counts: CaptureCounts) -> [EdgeBeads] {
    let cornerById = Dictionary(
      layout.corners.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var result: [EdgeBeads] = []
    var placed = 0

    for string in layoutStrings(layout) {
      for edge in string.run {
        let status: BeadStatus
        var wanted: [Point2] = []

        switch edge.kind {
        case .wire:
          status = .wire
        case .hidden:
          let count = max(0, edge.hiddenCount ?? 0)
          status = .hidden(count: count)
          let drawn = min(count, hiddenBeadDrawCap)
          wanted = evenCentres(edge: edge, cornerById: cornerById, count: drawn)
        case .lit:
          switch counts.runLights[edge.id] ?? .unknown {
          case .known(let n) where n > 0:
            status = .beads
            wanted = evenCentres(edge: edge, cornerById: cornerById, count: n)
          case .known:
            // A lit run measured at zero lights draws as a bare Rail.
            status = .beads
          case .unknown:
            status = .unknown
          }
        }

        // Canvas cap: once the running total would overflow, the run keeps its
        // status but becomes a Rail with no centres, in run order.
        let centres: [Point2]
        if placed + wanted.count > canvasBeadCap {
          centres = []
        } else {
          centres = wanted
          placed += wanted.count
        }

        result.append(
          EdgeBeads(stringId: string.id, edgeId: edge.id, status: status, centres: centres))
      }
    }

    return result
  }

  /// Bead chains for the AR scene, planned in the given run order. A run with a
  /// known spacing and anchored ends draws as a chain of `round(length / spacing)`
  /// spheres, counted the same way as the `countLayout` port. A run with unknown
  /// spacing, an unanchored end, or whose spheres would push the running total
  /// past `cap` draws as a tube instead. Once the cap is reached, every later
  /// run is a tube.
  public static func sceneBeads(runs: [RunBeadInput], cap: Int = sceneBeadCap) -> [RunBeadPlan] {
    var plans: [RunBeadPlan] = []
    var placed = 0

    for run in runs {
      let fallback = RunBeadPlan.tube(
        stringId: run.stringId, edgeId: run.edgeId, startM: run.startM, endM: run.endM)

      guard run.anchored, let spacing = run.spacingM, spacing > 0 else {
        plans.append(fallback)
        continue
      }

      let length = (run.endM - run.startM).length
      let n = lightsOnLength(length, spacing)

      // Only draw the chain when every one of its spheres fits under the cap.
      guard n > 0, placed + n <= cap else {
        plans.append(fallback)
        continue
      }

      var centres: [Vec3] = []
      centres.reserveCapacity(n)
      for i in 0..<n {
        let t = (Double(i) + 0.5) / Double(n)
        centres.append(run.startM + (run.endM - run.startM) * t)
      }
      placed += n
      plans.append(RunBeadPlan.chain(stringId: run.stringId, edgeId: run.edgeId, centres: centres))
    }

    return plans
  }

  /// Evenly spaced centres along a run's drawn edge, at `(i + 0.5) / count`
  /// for `i` in `0..<count`. Returns none when the count is zero or either
  /// corner is missing.
  private static func evenCentres(
    edge: LayoutEdge, cornerById: [String: LayoutCorner], count: Int
  ) -> [Point2] {
    guard count > 0, let from = cornerById[edge.from], let to = cornerById[edge.to] else {
      return []
    }
    var centres: [Point2] = []
    centres.reserveCapacity(count)
    let dx = to.x - from.x
    let dy = to.y - from.y
    for i in 0..<count {
      let t = (Double(i) + 0.5) / Double(count)
      centres.append(Point2(x: from.x + dx * t, y: from.y + dy * t))
    }
    return centres
  }
}
