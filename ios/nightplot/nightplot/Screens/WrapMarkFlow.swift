import ARKit
import NightplotCore
import Observation
import RealityKit
import SwiftUI
import simd

// Copy for marking wraps. None of these strings uses Attach, Apply, Preview, or
// Hardware Done (Req 15.2).
extension Wording {
    static let markTitle = "Mark wraps"
    static let markClose = "Done"
    static let markHint = "Aim at each wrap of lights on the object and tap Place mark. Work in any order."
    static let markPlace = "Place mark"
    static let markOutside = "That mark is outside the scanned object."
    static let markNeedTwo = "At least 2 wrap marks are needed."
    static let markListHeading = "Marks, lowest first"
    static let markNone = "No marks yet."
    static let markAccept = "Accept spiral"
    static let markKeepMeasured = "Keep Measured Wraps"
    static let markKeepMeasuredHint =
        "Uses the real spacing between your marks instead of one even spacing."

    static func markTooClose(_ number: Int) -> String {
        "Too close to mark \(number). Marks must be at least 1 cm apart."
    }

    static func markRowTitle(number: Int, height: String) -> String {
        "Mark \(number): \(height) above the bottom"
    }

    static func markGap(index: Int, length: String) -> String {
        "Gap from mark \(index) to mark \(index + 1): \(length)"
    }

    static func markUneven(lower: Int, upper: Int) -> String {
        "Uneven gaps: the largest is between mark \(lower) and mark \(upper)."
    }
}

/// Placing, deleting, and accepting wrap marks (Req 10.2 to 10.7, 10.10 to 10.12). It reads the
/// AR view and the model and writes only the document's spiral state and id counter.
@MainActor
@Observable
final class WrapMarkSession {
    private(set) var message: String?

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored private let controller: ARCaptureController
    @ObservationIgnored private var drawer: ScanOverlayDrawer?

    init(model: AppModel, controller: ARCaptureController) {
        self.model = model
        self.controller = controller
    }

    var unit: LayoutUnits { model.document?.capture.unit ?? .ft }
    var tracking: TrackingStatus { model.tracking }
    var trackingReason: String? { trackingMessage(model.tracking) }
    var scan: ReferenceScan? { model.document?.spiral.referenceScan }
    var marks: [WrapMark] { model.document?.spiral.wrapMarks ?? [] }
    var numbered: [(number: Int, mark: WrapMark)] { WrapMarks.numbered(marks) }

    var report: SpiralReport? {
        guard let scan else { return nil }
        return SpiralAnalyzer.report(scan: scan, marks: marks)
    }

    func stop() {
        drawer?.remove()
        drawer = nil
    }

    // MARK: Placing and deleting

    /// Snaps a mark to the fitted surface at the reticle's height (Req 10.2).
    func placeMark() {
        guard model.tracking == .normal else {
            message = trackingReason
            return
        }
        guard let document = model.document, let scan = document.spiral.referenceScan else { return }
        guard let ray = currentRay() else {
            message = Wording.markOutside
            return
        }
        // Take the id on a copy, so a refused mark uses no id.
        var ids = document.ids
        let id = ids.point(avoiding: Self.usedIds(document))
        switch WrapMarks.place(ray: ray, scan: scan, marks: document.spiral.wrapMarks, newId: id) {
        case .failure(.outsideObject):
            message = Wording.markOutside
        case .failure(.tooCloseTo(let number)):
            message = Wording.markTooClose(number)
        case .success(let next):
            model.updateWithoutHistory { doc in
                doc.ids = ids
                doc.spiral.wrapMarks = next
                // The numbers behind an accepted spiral changed, so it must be accepted again.
                doc.spiral.accepted = false
                doc.spiral.keepMeasuredWraps = false
            }
            message = nil
        }
        refreshOverlay()
    }

    /// Removes the mark and retires its id so it is never issued again (Req 10.12).
    func delete(_ pointId: String) {
        model.updateSpiral { spiral in
            spiral.wrapMarks = WrapMarks.delete(pointId: pointId, marks: spiral.wrapMarks)
            if !spiral.retiredIds.contains(pointId) { spiral.retiredIds.append(pointId) }
            spiral.accepted = false
            spiral.keepMeasuredWraps = false
        }
        message = nil
        refreshOverlay()
    }

    /// Accepts the spiral. Fewer than 2 marks changes nothing (Req 10.11). Keep Measured Wraps is
    /// only for gaps flagged as uneven (Req 10.7).
    @discardableResult
    func accept(keepMeasured: Bool) -> Bool {
        guard let report, marks.count >= 2 else {
            message = Wording.markNeedTwo
            return false
        }
        let keep = keepMeasured && report.uneven != nil
        model.updateSpiral { spiral in
            spiral.accepted = true
            spiral.keepMeasuredWraps = keep
        }
        message = nil
        return true
    }

    // MARK: Pieces

    /// A ray from the camera through the reticle, which sits at the middle of the view.
    private func currentRay() -> Ray? {
        let arView = controller.arView
        guard arView.bounds.width > 0 else { return nil }
        let centre = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        guard let ray = arView.ray(through: centre) else { return nil }
        let d = simd_normalize(ray.direction)
        guard d.x.isFinite, d.y.isFinite, d.z.isFinite else { return nil }
        return Ray(
            origin: Vec3(Double(ray.origin.x), Double(ray.origin.y), Double(ray.origin.z)),
            direction: Vec3(Double(d.x), Double(d.y), Double(d.z)))
    }

    /// Every id that must not be issued again: live, retired, and wrap mark ids.
    private static func usedIds(_ document: CaptureDocument) -> Set<String> {
        var used = Set(document.capture.retiredIds)
        used.formUnion(document.spiral.retiredIds)
        used.formUnion(document.spiral.wrapMarks.map(\.pointId))
        used.formUnion(document.capture.points.map(\.id))
        return used
    }

    func refreshOverlay() {
        let drawer = self.drawer ?? ScanOverlayDrawer(arView: controller.arView)
        self.drawer = drawer
        drawer.showCylinder(nil)
        drawer.showPoints([])
        drawer.showScan(scan)
        drawer.showMarks(marks)
    }
}

/// The wrap mark panel (Req 10.1 to 10.12). Host it over the AR view; `onClose` is called from
/// Done and after the spiral is accepted.
struct WrapMarkFlow: View {
    let model: AppModel
    let controller: ARCaptureController
    var onClose: () -> Void = {}

    @State private var session: WrapMarkSession
    @Environment(\.theme) private var theme

    init(model: AppModel, controller: ARCaptureController, onClose: @escaping () -> Void = {}) {
        self.model = model
        self.controller = controller
        self.onClose = onClose
        _session = State(initialValue: WrapMarkSession(model: model, controller: controller))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Wording.markTitle).font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button(Wording.markClose) {
                    session.stop()
                    onClose()
                }
                .buttonStyle(.bordered)
                .tint(theme.colors.primary)
                .frame(minWidth: 44, minHeight: 44)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(Wording.markHint).font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                    if let reason = session.trackingReason {
                        Text(reason).font(theme.font(.bodyEmphasis))
                    }
                    Button(Wording.markPlace) { session.placeMark() }
                        .buttonStyle(.borderedProminent)
                        .tint(theme.colors.primary)
                        .controlSize(.large)
                        .disabled(session.tracking != .normal)
                        .frame(maxWidth: .infinity, minHeight: 44)
                    if let message = session.message {
                        Text(message)
                            .font(theme.font(.bodyEmphasis))
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    markList
                    reportView
                    actions
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 360)
        }
        .font(theme.font(.body))
        .foregroundStyle(theme.colors.foreground)
        .tint(theme.colors.primary)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { theme.surface() }
        .onAppear { session.refreshOverlay() }
        .onDisappear { session.stop() }
        .onChange(of: model.document?.spiral) { _, _ in session.refreshOverlay() }
    }

    // MARK: Marks

    @ViewBuilder
    private var markList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Wording.markListHeading).font(theme.font(.bodyEmphasis))
            let rows = session.numbered
            if rows.isEmpty {
                Text(Wording.markNone).font(theme.font(.body)).foregroundStyle(theme.colors.mutedForeground)
            }
            ForEach(rows, id: \.mark.pointId) { row in
                HStack {
                    Text(Wording.markRowTitle(
                        number: row.number, height: formatLength(row.mark.heightM, session.unit)))
                        .font(theme.font(.mono))
                    Spacer(minLength: 8)
                    Button("Delete", role: .destructive) { session.delete(row.mark.pointId) }
                        .buttonStyle(.bordered)
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Delete mark \(row.number)")
                }
            }
        }
    }

    // MARK: Report

    @ViewBuilder
    private var reportView: some View {
        if let report = session.report {
            let unit = session.unit
            VStack(alignment: .leading, spacing: 4) {
                Text("Height: \(formatLength(report.heightM, unit))")
                Text("Around at the bottom: \(formatCircumference(report.bottomCircumferenceM, unit: unit))")
                Text("Around at the top: \(formatCircumference(report.topCircumferenceM, unit: unit))")
                ForEach(Array(report.gapsM.enumerated()), id: \.offset) { index, gap in
                    Text(Wording.markGap(index: index + 1, length: formatLength(gap, unit)))
                }
                Text("Mean gap: \(formatLength(report.meanGapM, unit))")
                    .font(theme.font(.monoEmphasis))
                if let uneven = report.uneven {
                    Label(
                        Wording.markUneven(lower: uneven.lower, upper: uneven.upper),
                        systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(theme.colors.primary)
                }
            }
            .font(theme.font(.mono))
            .foregroundStyle(theme.colors.foreground)
            .accessibilityElement(children: .combine)
        }
    }

    // MARK: Accepting

    @ViewBuilder
    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(Wording.markAccept) {
                if session.accept(keepMeasured: false) { finish() }
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.colors.primary)
            .frame(maxWidth: .infinity, minHeight: 44)
            if session.report?.uneven != nil {
                Button(Wording.markKeepMeasured) {
                    if session.accept(keepMeasured: true) { finish() }
                }
                .buttonStyle(.bordered)
                .tint(theme.colors.primary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityHint(Wording.markKeepMeasuredHint)
            }
        }
    }

    private func finish() {
        session.stop()
        onClose()
    }
}
