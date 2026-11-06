import Foundation
import NightplotCore
import Testing

/// Golden layout fixtures (Req 14.9). The server test `ios-capture-fixtures.test.ts` reads the same files.
///
/// By default each export is compared byte for byte with the committed file. To rewrite the files:
///
///     TEST_RUNNER_NIGHTPLOT_UPDATE_FIXTURES=1 xcodebuild test … -only-testing:nightplotTests/LayoutFixtureTests
///
/// `xcodebuild` passes only `TEST_RUNNER_`-prefixed variables to the test process and strips the
/// prefix, so the test sees `NIGHTPLOT_UPDATE_FIXTURES`. Setting it without the prefix also works
/// when the tests are started some other way.
struct LayoutFixtureTests {
  /// What a fixture file holds.
  private struct FixtureFile: Encodable {
    var request: PropSaveRequest
    var layout: PropLayout
    var expectedLightTotal: Int
    /// Sum of the lengths of the lit edges, in metres, as Swift computes it.
    var litLengthM: Double
  }

  /// `ios/fixtures/prop-layouts`, found from this file's path: `ios/nightplot/nightplotTests/Fixtures/`.
  private static var fixtureDirectory: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // Fixtures
      .deletingLastPathComponent()  // nightplotTests
      .deletingLastPathComponent()  // nightplot
      .deletingLastPathComponent()  // ios
      .appendingPathComponent("fixtures", isDirectory: true)
      .appendingPathComponent("prop-layouts", isDirectory: true)
  }

  private static var updating: Bool {
    ProcessInfo.processInfo.environment["NIGHTPLOT_UPDATE_FIXTURES"] == "1"
  }

  private static func export(_ fixture: FixtureCase) throws -> ExportResult {
    switch LayoutExporter.export(fixture.document, path: fixture.path) {
    case .success(let result): return result
    case .failure(let block):
      throw FixtureError.exportBlocked(fixture.name, "\(block)")
    }
  }

  private static func render(_ result: ExportResult) throws -> Data {
    let counted = countLayout(result.layout)
    let file = FixtureFile(
      request: result.request,
      layout: result.layout,
      expectedLightTotal: counted.total,
      litLengthM: counted.edges.filter { $0.kind == .lit }.reduce(0) { $0 + $1.lengthM })
    let encoder = LayoutJSON.makeEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(file)
    data.append(0x0A)
    return data
  }

  private enum FixtureError: Error { case exportBlocked(String, String) }

  @Test func fixturesMatchCommittedFiles() throws {
    let directory = Self.fixtureDirectory
    if Self.updating {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    for fixture in FixtureCaptures.all {
      let data = try Self.render(try Self.export(fixture))
      let url = directory.appendingPathComponent("\(fixture.name).json")
      if Self.updating {
        try data.write(to: url, options: .atomic)
        continue
      }
      guard let committed = FileManager.default.contents(atPath: url.path) else {
        Issue.record("Missing fixture \(fixture.name).json. Run with NIGHTPLOT_UPDATE_FIXTURES=1 and commit it.")
        continue
      }
      #expect(
        committed == data,
        "\(fixture.name).json differs from the export. Review the change, then regenerate with NIGHTPLOT_UPDATE_FIXTURES=1.")
    }
  }

  @Test func noStaleFixtureFiles() throws {
    let names = Set(FixtureCaptures.all.map { "\($0.name).json" })
    let files = (try? FileManager.default.contentsOfDirectory(atPath: Self.fixtureDirectory.path)) ?? []
    let json = Set(files.filter { $0.hasSuffix(".json") })
    #expect(json == names)
  }

  /// Req 14.9: the fixtures together cover every listed item.
  @Test func fixturesCoverRequirement14_9() throws {
    var results: [(FixtureCase, ExportResult)] = []
    for fixture in FixtureCaptures.all { results.append((fixture, try Self.export(fixture))) }
    let layouts = results.map(\.1.layout)
    let stringLists = layouts.map(layoutStrings)
    let edges = stringLists.flatMap { $0.flatMap(\.run) }

    // One Capture_String.
    #expect(stringLists.contains { $0.count == 1 })

    // Two strings that share a point.
    #expect(
      results.contains { fixture, _ in
        let strings = fixture.document.capture.strings
        guard strings.count >= 2 else { return false }
        return strings[0].pointIds.contains { id in strings[1...].contains { $0.pointIds.contains(id) } }
      })

    // A backtrack on one string: a point id that the string visits twice.
    #expect(
      results.contains { fixture, _ in
        fixture.document.capture.strings.contains { Set($0.pointIds).count < $0.pointIds.count }
      })

    // Every run kind.
    #expect(Set(edges.map(\.kind)) == [.lit, .wire, .hidden])

    // A run with wrapLengthM, and a run whose 3D length was not measured.
    #expect(edges.contains { $0.wrapLengthM != nil })
    #expect(edges.contains { $0.kind != .lit && $0.wrapLengthM == nil })
    #expect(edges.contains { $0.kind == .lit && $0.wrapLengthM == nil })
    #expect(edges.allSatisfy { $0.wrapLengthM != 0 })

    // Both units.
    #expect(Set(layouts.map(\.units)) == [.m, .ft])
  }
}
