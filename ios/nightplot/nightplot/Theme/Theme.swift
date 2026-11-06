import NightplotCore
import SwiftUI
import UIKit

/// The Capture app Theme: it turns the Foundation-only `ThemeTokens` from
/// NightplotCore into `Color`, `UIColor`, and `Font`, follows the system
/// appearance, and carries the fonts and accessibility choices the screens read
/// through the SwiftUI environment (Req 16.1–16.5, 16.16, 16.17, 16.20).
///
/// The colour values themselves live in the core as `#rrggbb` strings so the
/// contrast test can run with no UIKit (task 24.1). This file does the
/// platform mapping only, and owns one app-side role token: the light-mode
/// string colour, nudged darker so the string palette clears 3:1 on the light
/// rail and background without changing the web tokens (see `stringColor`).
enum Theme {
    /// A resolved set of SwiftUI colours for one appearance.
    struct Colors: Equatable {
        var background: Color
        var foreground: Color
        var card: Color
        var primary: Color
        var secondary: Color
        var muted: Color
        var mutedForeground: Color
        var destructive: Color
        var border: Color
        var input: Color
        var quiet: Color
        var rail: Color
        var online: Color
    }

    /// The font roles the design names: body text, numbers and ids, and titles.
    enum FontRole {
        /// IBM Plex Sans, scaled relative to `.body`.
        case body
        /// IBM Plex Sans SemiBold, scaled relative to `.headline`.
        case bodyEmphasis
        /// IBM Plex Mono for lengths, counts, ids, and `host:port`, relative to `.body`.
        case mono
        /// IBM Plex Mono Medium, relative to `.callout`, for emphasised numbers.
        case monoEmphasis
        /// Fraunces for screen titles, relative to `.largeTitle`.
        case title
        /// Fraunces for section titles, relative to `.title2`.
        case sectionTitle
    }

    // MARK: Colour mapping

    /// Resolved SwiftUI colours for a given appearance (Req 16.1, 16.2).
    static func colors(for scheme: ColorScheme) -> Colors {
        let t = tokens(for: scheme)
        return Colors(
            background: color(t.background),
            foreground: color(t.foreground),
            card: color(t.card),
            primary: color(t.primary),
            secondary: color(t.secondary),
            muted: color(t.muted),
            mutedForeground: color(t.mutedForeground),
            destructive: color(t.destructive),
            border: color(t.border),
            input: color(t.input),
            quiet: color(t.quiet),
            rail: color(t.rail),
            online: color(t.online))
    }

    /// The core tokens for a given appearance. The dark set is the primary look.
    static func tokens(for scheme: ColorScheme) -> ThemeTokens {
        scheme == .light ? .light : .dark
    }

    /// A dynamic `UIColor` that resolves dark or light at display time, so UIKit
    /// appearance proxies follow the system appearance without a relaunch (Req 16.2).
    static func dynamicUIColor(_ keyPath: KeyPath<ThemeTokens, String>) -> UIColor {
        UIColor { traits in
            let hex = (traits.userInterfaceStyle == .light ? ThemeTokens.light : ThemeTokens.dark)[keyPath: keyPath]
            return uiColor(hex)
        }
    }

    // MARK: Fonts (Req 16.3, 16.4, 16.5)

    /// The PostScript names of the bundled faces. `UIFont(name:)` takes the
    /// PostScript name, not the family name, so these are read straight from the
    /// `.otf` files that ship in `Resources/Fonts/`.
    private enum Face {
        static let sans = "IBMPlexSans"
        static let sansSemiBold = "IBMPlexSans-SmBld"
        static let mono = "IBMPlexMono"
        static let monoMedium = "IBMPlexMono-Medm"
        static let frauncesRegular = "Fraunces72pt-Regular"
        static let frauncesSemiBold = "Fraunces72pt-SemiBold"
    }

    /// A Theme font for a role, scaled with the operator's Dynamic Type setting
    /// through `UIFontMetrics(relativeTo:)` (Req 16.4). If the bundled face did
    /// not load, this falls back to the matching system font (Req 16.5).
    static func font(_ role: FontRole) -> Font {
        Font(uiFont(role))
    }

    /// The scaled `UIFont` for a role, used both by `font(_:)` and by UIKit
    /// appearance proxies.
    static func uiFont(_ role: FontRole) -> UIFont {
        switch role {
        case .body:
            return scaled(Face.sans, size: 17, textStyle: .body) { UIFont.systemFont(ofSize: $0) }
        case .bodyEmphasis:
            return scaled(Face.sansSemiBold, size: 17, textStyle: .headline) { UIFont.systemFont(ofSize: $0, weight: .semibold) }
        case .mono:
            return scaled(Face.mono, size: 16, textStyle: .body) { UIFont.monospacedSystemFont(ofSize: $0, weight: .regular) }
        case .monoEmphasis:
            return scaled(Face.monoMedium, size: 16, textStyle: .callout) { UIFont.monospacedSystemFont(ofSize: $0, weight: .medium) }
        case .title:
            return scaled(Face.frauncesSemiBold, size: 34, textStyle: .largeTitle, systemFallback: serifSystemFont)
        case .sectionTitle:
            return scaled(Face.frauncesRegular, size: 22, textStyle: .title2, systemFallback: serifSystemFont)
        }
    }

    /// Builds `UIFont(name:size:)` scaled for the text style, or the system
    /// fallback when the named face is not registered (Req 16.5).
    private static func scaled(
        _ name: String,
        size: CGFloat,
        textStyle: UIFont.TextStyle,
        systemFallback: (CGFloat) -> UIFont
    ) -> UIFont {
        let metrics = UIFontMetrics(forTextStyle: textStyle)
        if let base = UIFont(name: name, size: size) {
            return metrics.scaledFont(for: base)
        }
        return metrics.scaledFont(for: systemFallback(size))
    }

    /// A serif system font, the closest system match for Fraunces titles.
    private static func serifSystemFont(_ size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .semibold)
        let descriptor = base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor
        return UIFont(descriptor: descriptor, size: size)
    }

    // MARK: String palette (app-side role token, Req 16.10, 16.15)

    /// The colour for one string, by its `colorIndex`, resolved for the given
    /// appearance.
    ///
    /// The core `stringPalette` is tuned for the dark night rail, where every
    /// hue clears 3:1 on both `rail` and `background`. On the light rail those
    /// same bright hues fall far below 3:1 (many under 2:1), which the task
    /// flagged. The web tokens stay as they are; instead the app owns this role
    /// token and darkens each hue for the light appearance so it reads as a
    /// glyph on the light rail and background. The measured worst case after the
    /// nudge is about 4:1 (see task 24.3's contrast example). The dark
    /// appearance uses the core palette unchanged.
    static func stringColor(index: Int, scheme: ColorScheme) -> Color {
        let palette = ThemeTokens.stringPalette
        guard !palette.isEmpty else { return .primary }
        let hex = palette[((index % palette.count) + palette.count) % palette.count]
        let base = uiColor(hex)
        if scheme == .light {
            return Color(darkenedForLightRail(base))
        }
        return Color(base)
    }

    /// Multiplier applied to brightness in the light appearance so a bright
    /// night hue reads on a light surface. 0.5 clears 3:1 with margin for every
    /// palette entry on both the light rail and the light background.
    private static let lightStringBrightnessFactor: CGFloat = 0.5

    private static func darkenedForLightRail(_ color: UIColor) -> UIColor {
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard color.getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return color }
        return UIColor(hue: h, saturation: s, brightness: b * lightStringBrightnessFactor, alpha: a)
    }

    // MARK: Hex to colour

    static func color(_ hex: String) -> Color { Color(uiColor(hex)) }

    static func uiColor(_ hex: String) -> UIColor {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return .clear }
        let r = CGFloat((value >> 16) & 0xff) / 255
        let g = CGFloat((value >> 8) & 0xff) / 255
        let b = CGFloat(value & 0xff) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    }
}

// MARK: - Environment

/// The resolved Theme for the current appearance, plus the two accessibility
/// switches the surfaces honour. Injected at the root so every screen reads one
/// consistent Theme (Req 16.1, 16.17).
struct ThemePalette {
    var scheme: ColorScheme
    var colors: Theme.Colors
    /// True when the operator asked for solid surfaces instead of materials (Req 16.17).
    var reduceTransparency: Bool
    /// True when the operator asked for no animated glow or pulse (Req 16.16).
    var reduceMotion: Bool

    func font(_ role: Theme.FontRole) -> Font { Theme.font(role) }
    func string(_ index: Int) -> Color { Theme.stringColor(index: index, scheme: scheme) }

    /// The fill a panel or sheet should use: a solid Theme surface under Reduce
    /// Transparency, otherwise a translucent material (Req 16.17).
    @ViewBuilder
    func surface() -> some View {
        if reduceTransparency {
            colors.card
        } else {
            Rectangle().fill(.ultraThinMaterial)
        }
    }
}

private struct ThemePaletteKey: EnvironmentKey {
    static let defaultValue = ThemePalette(
        scheme: .dark,
        colors: Theme.colors(for: .dark),
        reduceTransparency: false,
        reduceMotion: false)
}

extension EnvironmentValues {
    var theme: ThemePalette {
        get { self[ThemePaletteKey.self] }
        set { self[ThemePaletteKey.self] = newValue }
    }
}

// MARK: - Root application

/// Applies the Theme to the whole app: injects the resolved palette into the
/// environment, sets `.tint` to `primary`, and configures the navigation and
/// tab bar appearances with `background`, `foreground`, and `border`
/// (Req 16.1, 16.2, 16.20). Attach this once at the root.
private struct NightplotThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let palette = ThemePalette(
            scheme: scheme,
            colors: Theme.colors(for: scheme),
            reduceTransparency: reduceTransparency,
            reduceMotion: reduceMotion)
        content
            .environment(\.theme, palette)
            .tint(palette.colors.primary)
            .onAppear { Theme.configureBarAppearances() }
    }
}

extension View {
    /// Applies the Nightplot Theme and global appearance at the root.
    func nightplotTheme() -> some View { modifier(NightplotThemeModifier()) }
}

extension Theme {
    /// Configures the shared `UINavigationBar` and `UITabBar` appearance proxies
    /// with dynamic Theme colours, so bars follow the system appearance without a
    /// relaunch (Req 16.2, 16.20). Idempotent; safe to call on every appear.
    @MainActor static func configureBarAppearances() {
        let background = dynamicUIColor(\.background)
        let foreground = dynamicUIColor(\.foreground)
        let border = dynamicUIColor(\.border)
        let primary = dynamicUIColor(\.primary)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = background
        nav.shadowColor = border
        nav.titleTextAttributes = [
            .foregroundColor: foreground,
            .font: uiFont(.sectionTitle),
        ]
        nav.largeTitleTextAttributes = [
            .foregroundColor: foreground,
            .font: uiFont(.title),
        ]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = primary

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = background
        tab.shadowColor = border
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
        UITabBar.appearance().tintColor = primary
    }
}
