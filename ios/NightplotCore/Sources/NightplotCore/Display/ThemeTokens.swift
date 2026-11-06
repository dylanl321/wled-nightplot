import Foundation

/// Theme colour tokens for the Capture app, held in the core as plain `#rrggbb`
/// hex strings so the contrast test runs in `nightplotTests` with no UIKit.
///
/// The dark set is the primary look; the light set is used when the system
/// appearance is light. Both sets come from `apps/web/src/app/globals.css`, so
/// the phone and the web stay one product (Req 16.1). The app target turns these
/// strings into `UIColor` and `Color`.
public struct ThemeTokens: Equatable, Sendable {
  public var background: String
  public var foreground: String
  public var card: String
  public var primary: String
  public var secondary: String
  public var muted: String
  public var mutedForeground: String
  public var destructive: String
  public var border: String
  public var input: String
  public var quiet: String
  public var rail: String
  public var online: String

  public init(
    background: String,
    foreground: String,
    card: String,
    primary: String,
    secondary: String,
    muted: String,
    mutedForeground: String,
    destructive: String,
    border: String,
    input: String,
    quiet: String,
    rail: String,
    online: String
  ) {
    self.background = background
    self.foreground = foreground
    self.card = card
    self.primary = primary
    self.secondary = secondary
    self.muted = muted
    self.mutedForeground = mutedForeground
    self.destructive = destructive
    self.border = border
    self.input = input
    self.quiet = quiet
    self.rail = rail
    self.online = online
  }

  /// Dark set, the primary look. Values copied from `globals.css`.
  public static let dark = ThemeTokens(
    background: "#0c0d10",
    foreground: "#ece7dc",
    card: "#07080a",
    primary: "#d4a574",
    secondary: "#151820",
    muted: "#12141a",
    mutedForeground: "#9a9488",
    destructive: "#e07070",
    border: "#1d2129",
    input: "#262c37",
    quiet: "#7d7870",
    rail: "#0a0b0e",
    online: "#7ee0d0"
  )

  /// Light set, used when the system appearance is light. Values copied from `globals.css`.
  public static let light = ThemeTokens(
    background: "#f6f4ef",
    foreground: "#252931",
    card: "#ffffff",
    primary: "#85552c",
    secondary: "#e8e9eb",
    muted: "#e9e8e4",
    mutedForeground: "#525963",
    destructive: "#af3333",
    border: "#cbd0d4",
    input: "#adb5bc",
    quiet: "#606872",
    rail: "#f0eee9",
    online: "#087e71"
  )

  /// 16 distinct string hues, one per `colorIndex` (0..<16).
  ///
  /// These are the exact hues `SceneOverlay.color(forIndex:)` and the front
  /// view render, generated from the same HSB walk around the wheel so the
  /// drawing and this palette cannot drift. The step of 7/16 of the wheel keeps
  /// neighbouring indexes far apart; alternating saturation separates them
  /// further (Req 16.10).
  public static let stringPalette: [String] = (0..<16).map { i in
    let hue = Double((i * 7) % 16) / 16.0
    let saturation = i % 2 == 0 ? 0.85 : 0.6
    return hsbHex(hue: hue, saturation: saturation, brightness: 0.95)
  }

  /// HSB to a `#rrggbb` string, matching `UIColor(hue:saturation:brightness:alpha:)`.
  private static func hsbHex(hue: Double, saturation: Double, brightness: Double) -> String {
    let sector = Int((hue * 6.0).rounded(.down))
    let f = hue * 6.0 - Double(sector)
    let p = brightness * (1.0 - saturation)
    let q = brightness * (1.0 - saturation * f)
    let t = brightness * (1.0 - saturation * (1.0 - f))
    let (r, g, b): (Double, Double, Double)
    switch ((sector % 6) + 6) % 6 {
    case 0: (r, g, b) = (brightness, t, p)
    case 1: (r, g, b) = (q, brightness, p)
    case 2: (r, g, b) = (p, brightness, t)
    case 3: (r, g, b) = (p, q, brightness)
    case 4: (r, g, b) = (t, p, brightness)
    default: (r, g, b) = (brightness, p, q)
    }
    func channel(_ x: Double) -> Int { Int((x * 255.0).rounded()) }
    return String(format: "#%02x%02x%02x", channel(r), channel(g), channel(b))
  }
}

/// WCAG 2.1 contrast, computed from `#rrggbb` strings with no UIKit.
public enum Contrast {
  /// Contrast ratio of two colours, from 1 (identical) to 21 (black on white).
  ///
  /// `(L1 + 0.05) / (L2 + 0.05)` where `L1 >= L2` are the relative luminances.
  /// An unparseable colour yields 1.
  public static func ratio(_ a: String, _ b: String) -> Double {
    guard let la = relativeLuminance(a), let lb = relativeLuminance(b) else { return 1 }
    let lighter = max(la, lb)
    let darker = min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)
  }

  /// Does the pair meet AA? 4.5:1 for body text, 3:1 for large text and glyphs.
  public static func meetsAA(_ a: String, _ b: String, large: Bool) -> Bool {
    ratio(a, b) >= (large ? 3.0 : 4.5)
  }

  /// WCAG 2.1 relative luminance of a `#rrggbb` string, or nil if it cannot be parsed.
  static func relativeLuminance(_ hex: String) -> Double? {
    guard let (r, g, b) = rgb(hex) else { return nil }
    func linear(_ c: Double) -> Double {
      c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }

  /// Parses `#rrggbb` (case-insensitive, leading `#` optional) into 0...1 channels.
  static func rgb(_ hex: String) -> (Double, Double, Double)? {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
    let r = Double((value >> 16) & 0xff) / 255.0
    let g = Double((value >> 8) & 0xff) / 255.0
    let b = Double(value & 0xff) / 255.0
    return (r, g, b)
  }
}

/// The foreground/background token pairs the screens actually use, with the
/// `large` flag set where the text is large or the pair is an interface glyph.
/// The contrast test asserts each pair meets AA in both the dark and light sets
/// (Req 16.15).
public enum ThemeUse {
  // Computed rather than stored because `KeyPath` is not `Sendable`, so a stored
  // static under Swift 6 strict concurrency would not be concurrency-safe.
  public static var textPairs: [(fg: KeyPath<ThemeTokens, String>, bg: KeyPath<ThemeTokens, String>, large: Bool)] { [
    (\.foreground, \.background, false),
    (\.foreground, \.card, false),
    (\.foreground, \.secondary, false),
    (\.mutedForeground, \.background, false),
    (\.mutedForeground, \.card, false),
    (\.primary, \.background, true),
    (\.quiet, \.background, true),
    (\.destructive, \.background, true),
    (\.online, \.background, true),
  ] }
}
