import NightplotCore
import SwiftUI

/// Draws a `PropLayout` front-on (Req 8.13) in the Nightplot look: a Rail per
/// edge, then Beads from `BeadLayout.beads` in each string's palette colour
/// (Req 16.6, 16.10). Lit runs whose spacing or count is unknown draw as an
/// unlit dashed Rail labelled "unknown", never with invented Beads (Req 16.7).
/// Wire runs are a thin dark Rail (Req 16.8); hidden runs are dim grey Beads
/// with their count label (Req 16.9). Each string's wire-in is a ring with the
/// string id beside it, and the dash patterns and labels stay so colour is not
/// the only signal (Req 16.10). Unanchored points draw grey with the unanchored
/// mark, never a string colour (Req 16.11). A persistent "Drawing — not lit"
/// caption sits in a corner, since the Beads are a drawing of where lights go,
/// not lit hardware (Req 16.12, 16.21).
struct FrontViewCanvas: View {
    let layout: PropLayout
    let counts: CaptureCounts
    /// Palette index per string id, so Beads use the Capture_String's colour.
    let colorIndexByString: [String: Int]
    /// Point ids whose anchor was lost; drawn grey with the unanchored mark.
    let unanchoredPointIds: Set<String>

    @Environment(\.theme) private var theme

    @ScaledMetric(relativeTo: .body) private var ringRadius: CGFloat = 9
    @ScaledMetric(relativeTo: .body) private var lineWidth: CGFloat = 3
    @ScaledMetric(relativeTo: .body) private var padding: CGFloat = 28
    @ScaledMetric(relativeTo: .body) private var beadRadius: CGFloat = 4

    /// Primary initialiser. The caller passes the counts and colour map so the
    /// Beads match `CaptureCounter` exactly (Req 16.6).
    init(
        layout: PropLayout,
        counts: CaptureCounts,
        colorIndexByString: [String: Int],
        unanchoredPointIds: Set<String> = []
    ) {
        self.layout = layout
        self.counts = counts
        self.colorIndexByString = colorIndexByString
        self.unanchoredPointIds = unanchoredPointIds
    }

    /// Convenience initialiser from a document and its already-exported layout,
    /// so a caller that holds both does not re-run the exporter. Counts and the
    /// string colour map come from the document.
    init(layout: PropLayout, document: CaptureDocument) {
        self.init(
            layout: layout,
            counts: CaptureCounter.counts(document),
            colorIndexByString: Dictionary(
                document.capture.strings.map { ($0.id, $0.colorIndex) },
                uniquingKeysWith: { first, _ in first }),
            unanchoredPointIds: Set(document.unanchoredPointIds))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Canvas { context, size in
                draw(in: &context, size: size)
            }
            .frame(minHeight: 240, idealHeight: 300, maxHeight: 360)
            .background(theme.colors.card, in: RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .bottomLeading) { caption }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Wording.frontViewAccessibilityLabel(summary))

            legend
        }
    }

    // MARK: - Caption (Req 16.12, 16.21)

    private var caption: some View {
        Text(Wording.frontViewCaption)
            .font(theme.font(.body))
            .foregroundStyle(theme.colors.mutedForeground)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(theme.colors.background.opacity(0.7), in: Capsule())
            .padding(8)
            .allowsHitTesting(false)
    }

    // MARK: - Summary and legend

    private var summary: FrontViewSummary {
        var summary = FrontViewSummary(strings: 0, lit: 0, wire: 0, hidden: 0)
        let strings = layoutStrings(layout)
        summary.strings = strings.count
        for edge in strings.flatMap(\.run) {
            switch edge.kind {
            case .lit: summary.lit += 1
            case .wire: summary.wire += 1
            case .hidden: summary.hidden += 1
            }
        }
        return summary
    }

    private var legend: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            LegendItem(kind: .lit, text: Wording.frontViewLegendLit, color: theme.colors.foreground)
            LegendItem(kind: .wire, text: Wording.frontViewLegendWire, color: theme.colors.rail)
            LegendItem(kind: .hidden, text: Wording.frontViewLegendHidden, color: theme.colors.mutedForeground)
            Spacer(minLength: 0)
        }
        .font(theme.font(.body))
        .foregroundStyle(theme.colors.foreground)
        .accessibilityHidden(true)
    }

    // MARK: - Drawing

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        guard !layout.corners.isEmpty else { return }
        let xs = layout.corners.map(\.x)
        let ys = layout.corners.map(\.y)
        let minX = xs.min() ?? 0, maxX = xs.max() ?? 0
        let minY = ys.min() ?? 0, maxY = ys.max() ?? 0
        let spanX = max(maxX - minX, 0.001)
        let spanY = max(maxY - minY, 0.001)
        let availableW = max(size.width - 2 * padding, 1)
        let availableH = max(size.height - 2 * padding, 1)
        let scale = min(availableW / spanX, availableH / spanY)
        let originX = (size.width - spanX * scale) / 2
        let originY = (size.height + spanY * scale) / 2  // bottom edge, y is up in the layout

        func point(_ corner: LayoutCorner) -> CGPoint {
            CGPoint(x: originX + (corner.x - minX) * scale, y: originY - (corner.y - minY) * scale)
        }
        // A bead centre is in metres on the drawing plane, same frame as corners.
        func beadPoint(_ centre: Point2) -> CGPoint {
            CGPoint(x: originX + (centre.x - minX) * scale, y: originY - (centre.y - minY) * scale)
        }
        let byId = Dictionary(
            layout.corners.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        let beadsByEdge = Dictionary(
            BeadLayout.beads(layout: layout, counts: counts).map { ($0.edgeId, $0) },
            uniquingKeysWith: { first, _ in first })

        // 1. A Rail per edge, drawn hidden then wire then lit so lit runs sit on
        //    top where they overlap. The rail reads the bead status so an unknown
        //    lit run shows as an unlit dashed rail, not a solid one (Req 16.7).
        for kind in [RunKind.hidden, .wire, .lit] {
            for edge in layoutStrings(layout).flatMap(\.run) where edge.kind == kind {
                guard let from = byId[edge.from], let to = byId[edge.to] else { continue }
                let status = beadsByEdge[edge.id]?.status
                let rail = railStyle(for: edge.kind, status: status)
                var path = Path()
                path.move(to: point(from))
                path.addLine(to: point(to))
                context.stroke(path, with: .color(rail.color), style: rail.stroke(width: lineWidth))
            }
        }

        // 2. Beads from `BeadLayout.beads`, in string then run order, in each
        //    string's palette colour. Hidden beads are dim grey (Req 16.9), lit
        //    unknown runs carry no beads and a "unknown" label (Req 16.7).
        let shadowRadius: CGFloat = theme.reduceMotion ? 0 : beadRadius * 1.1
        for string in layoutStrings(layout) {
            let color = beadColor(forStringId: string.id)
            for edge in string.run {
                guard let beads = beadsByEdge[edge.id] else { continue }
                let midpoint = edgeMidpoint(edge, byId: byId, point: point)

                switch beads.status {
                case .beads:
                    for centre in beads.centres {
                        drawBead(
                            at: beadPoint(centre), fill: color, shadow: color,
                            shadowRadius: shadowRadius, in: &context)
                    }
                    // A lit run that overflowed the canvas cap keeps no centres;
                    // its rail already drew, so nothing more is needed here.
                case .hidden(let count):
                    let dim = theme.colors.mutedForeground.opacity(0.5)
                    for centre in beads.centres {
                        drawBead(
                            at: beadPoint(centre), fill: dim, shadow: dim,
                            shadowRadius: 0, in: &context)
                    }
                    if let midpoint {
                        drawLabel(
                            Wording.frontViewHiddenLabel(count), at: midpoint,
                            color: theme.colors.mutedForeground, in: &context, size: size)
                    }
                case .unknown:
                    if let midpoint {
                        drawLabel(
                            Wording.frontViewUnknownRun, at: midpoint,
                            color: theme.colors.mutedForeground, in: &context, size: size)
                    }
                case .wire:
                    break
                }
            }
        }

        // 3. Every corner. Unanchored points are quiet grey with a hollow ring
        //    (the unanchored mark), never a string colour (Req 16.11).
        let dot = lineWidth * 0.9
        for corner in layout.corners {
            let p = point(corner)
            let rect = CGRect(x: p.x - dot, y: p.y - dot, width: dot * 2, height: dot * 2)
            if unanchoredPointIds.contains(corner.id) {
                context.stroke(
                    Path(ellipseIn: rect.insetBy(dx: -dot * 0.6, dy: -dot * 0.6)),
                    with: .color(theme.colors.quiet), style: StrokeStyle(lineWidth: lineWidth * 0.7, dash: [dot, dot]))
                context.fill(Path(ellipseIn: rect), with: .color(theme.colors.quiet))
            } else {
                context.fill(Path(ellipseIn: rect), with: .color(theme.colors.foreground))
            }
        }

        // 4. Wire-ins: a ring and the string id, in mono so ids read clearly.
        //    Strings that start at one corner stack their labels.
        var stacked: [String: Int] = [:]
        for string in layoutStrings(layout) {
            guard let corner = byId[string.startId] else { continue }
            let p = point(corner)
            let rect = CGRect(
                x: p.x - ringRadius, y: p.y - ringRadius, width: ringRadius * 2, height: ringRadius * 2)
            let ringColor = beadColor(forStringId: string.id)
            context.stroke(Path(ellipseIn: rect), with: .color(ringColor), lineWidth: lineWidth * 0.7)
            let slot = stacked[string.startId, default: 0]
            stacked[string.startId] = slot + 1
            let label = context.resolve(
                Text(string.id).font(theme.font(.mono)).foregroundColor(ringColor))
            let labelSize = label.measure(in: size)
            let at = CGPoint(
                x: p.x + ringRadius + 3 + labelSize.width / 2,
                y: p.y - ringRadius - labelSize.height / 2 - CGFloat(slot) * labelSize.height)
            context.draw(label, at: at, anchor: .center)
        }
    }

    // MARK: - Drawing helpers

    /// A string's palette colour, or the foreground when its index is unknown.
    private func beadColor(forStringId id: String) -> Color {
        if let index = colorIndexByString[id] { return theme.string(index) }
        return theme.colors.foreground
    }

    private func edgeMidpoint(
        _ edge: LayoutEdge, byId: [String: LayoutCorner], point: (LayoutCorner) -> CGPoint
    ) -> CGPoint? {
        guard let from = byId[edge.from], let to = byId[edge.to] else { return nil }
        let a = point(from), b = point(to)
        return CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    }

    private func drawBead(
        at p: CGPoint, fill: Color, shadow: Color, shadowRadius: CGFloat,
        in context: inout GraphicsContext
    ) {
        let rect = CGRect(x: p.x - beadRadius, y: p.y - beadRadius, width: beadRadius * 2, height: beadRadius * 2)
        let circle = Path(ellipseIn: rect)
        if shadowRadius > 0 {
            // A soft static glow of the bead's own colour. No animation, so it is
            // unchanged under Reduce Motion (Req 16.16).
            context.drawLayer { layer in
                layer.addFilter(.shadow(color: shadow.opacity(0.9), radius: shadowRadius))
                layer.fill(circle, with: .color(fill))
            }
        } else {
            context.fill(circle, with: .color(fill))
        }
    }

    private func drawLabel(
        _ text: String, at p: CGPoint, color: Color,
        in context: inout GraphicsContext, size: CGSize
    ) {
        let resolved = context.resolve(Text(text).font(theme.font(.mono)).foregroundColor(color))
        let labelSize = resolved.measure(in: size)
        let at = CGPoint(x: p.x, y: p.y - labelSize.height)
        context.draw(resolved, at: at, anchor: .center)
    }

    private struct Rail {
        var color: Color
        var dashed: Bool
        var widthFactor: CGFloat
        var lit: Bool

        func stroke(width: CGFloat) -> StrokeStyle {
            if !lit && dashed {
                return StrokeStyle(lineWidth: width * widthFactor, lineCap: .butt, dash: [width * 3, width * 2])
            }
            if dashed {
                return StrokeStyle(lineWidth: width * widthFactor, lineCap: .round, dash: [0.1, width * 2])
            }
            return StrokeStyle(lineWidth: width * widthFactor, lineCap: .round)
        }
    }

    /// The rail under one run. A lit run with a known bead count gets a quiet
    /// solid rail (the beads carry the colour); a lit unknown run gets an unlit
    /// dashed rail; wire is a thin dark rail; hidden is a dotted grey rail.
    private func railStyle(for kind: RunKind, status: BeadStatus?) -> Rail {
        switch kind {
        case .lit:
            if case .unknown = status {
                return Rail(color: theme.colors.mutedForeground, dashed: true, widthFactor: 0.7, lit: false)
            }
            return Rail(color: theme.colors.rail, dashed: false, widthFactor: 0.6, lit: true)
        case .wire:
            return Rail(color: theme.colors.rail, dashed: true, widthFactor: 0.7, lit: false)
        case .hidden:
            return Rail(color: theme.colors.mutedForeground, dashed: true, widthFactor: 0.7, lit: true)
        }
    }
}

struct FrontViewSummary: Equatable {
    var strings: Int
    var lit: Int
    var wire: Int
    var hidden: Int
}

private struct LegendItem: View {
    let kind: RunKind
    let text: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Canvas { context, size in
                var path = Path()
                path.move(to: CGPoint(x: 0, y: size.height / 2))
                path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                context.stroke(path, with: .color(color), style: strokeStyle(width: 3))
            }
            .frame(width: 28, height: 12)
            Text(text)
        }
    }

    private func strokeStyle(width: CGFloat) -> StrokeStyle {
        switch kind {
        case .lit:
            return StrokeStyle(lineWidth: width, lineCap: .round)
        case .wire:
            return StrokeStyle(lineWidth: width * 0.7, lineCap: .butt, dash: [width * 3, width * 2])
        case .hidden:
            return StrokeStyle(lineWidth: width * 0.7, lineCap: .round, dash: [0.1, width * 2])
        }
    }
}
