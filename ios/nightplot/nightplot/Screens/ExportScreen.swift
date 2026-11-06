import NightplotCore
import SwiftUI

// Copy for the export screen. It extends `Wording` so every operator-facing string has one home.
// None of these strings uses Attach, Apply, Preview, or Hardware Done (Req 15.2).
extension Wording {
    static let exportNoCapture = "Open a Capture to check and save it."
    static let exportBlockedHeading = "Cannot save yet"
    static let exportBlockLabelRequired = "Missing: a name. Enter a label of 1 to 64 characters."
    static let exportBlockLabelTooLong = "The label is too long. Use 64 characters or fewer."
    static let exportBlockNoSpacing = "Missing: LED spacing. Choose an LED product or type a spacing."
    static let exportBlockNoRuns = "Missing: a string with at least one run. Place two points on a string."
    static let exportBlockNoFrontPlane =
        "The points do not define a front-on plane. Turn on Flat, or add more points."
    static let exportBlockSpiralNeedsTwoMarks = "Missing: at least 2 wrap marks are needed."
    static let exportBlockLayoutInvalid = "The drawing could not be built."

    static func exportBlockMessage(_ block: ExportBlock) -> String? {
        switch block {
        case .labelRequired: return exportBlockLabelRequired
        case .labelTooLong: return exportBlockLabelTooLong
        case .noSpacing: return exportBlockNoSpacing
        case .noRuns: return exportBlockNoRuns
        case .noFrontPlane: return exportBlockNoFrontPlane
        case .spiralNeedsTwoMarks: return exportBlockSpiralNeedsTwoMarks
        case .layoutInvalid: return exportBlockLayoutInvalid
        case .unanchored: return nil  // listed on its own
        }
    }

    static func exportNotFlatTitle(count: Int) -> String {
        "This shape is not flat"
    }
    static func exportNotFlatBody(count: Int) -> String {
        let points = count == 1 ? "1 point is" : "\(count) points are"
        return "\(points) more than 0.5 m off the front plane. Runs off the plane will use their 3D length."
    }

    static let exportCheckIntro = "Check the drawing before you save. Nothing is saved until you choose Save to Nightplot."
    static let exportUnanchoredHeading = "Points that lost their place"
    static let exportUnanchoredBody =
        "Saving is off until these points are moved or deleted. Their lengths are unknown."
    static func exportPointLine(stringId: String, index: Int) -> String {
        index == 0 ? "String \(stringId), point 0 (wire-in)" : "String \(stringId), point \(index)"
    }
    static let exportLowConfidenceHeading = "Low-confidence points"
    static let exportLowConfidenceBody = "These points were placed with an uncertainty above 0.05 m. You can still save."
    static func exportLowConfidenceLine(stringId: String, index: Int, uncertainty: String) -> String {
        "\(exportPointLine(stringId: stringId, index: index)), about \(uncertainty)"
    }
    static let exportUnreadableHeading = "Props Nightplot could not read"
    static func exportUnreadableLine(name: String) -> String {
        "\(name) could not be read. This app will not change it."
    }
    static let exportUnnamedProp = "A Prop with no name"
    static let exportLedProductDiffers =
        "The LED product on this Capture is not the one sent when the Prop was created. Saving again keeps the Prop's original LED product."

    static func frontViewAccessibilityLabel(_ summary: FrontViewSummary) -> String {
        "Front view of the drawing. \(summary.strings) strings. \(summary.lit) lit runs, \(summary.wire) wire runs, \(summary.hidden) hidden runs."
    }
    static let frontViewLegendLit = "Lit"
    static let frontViewLegendWire = "Wire"
    static let frontViewLegendHidden = "Hidden"

    /// The persistent corner caption on every front view. The beads are a
    /// drawing of where lights go, never lit hardware (Req 16.12, 16.21).
    static let frontViewCaption = "Drawing — not lit"
    /// The label on a lit run whose spacing or count could not be measured
    /// (Req 16.7). The run draws as a bare dashed rail with this text.
    static let frontViewUnknownRun = "unknown"
    /// Suffix for a hidden run's bead label: "<count> hidden" (Req 16.9).
    static func frontViewHiddenLabel(_ count: Int) -> String { "\(count) hidden" }

    static let exportResultHeading = "Result"
    static let exportGoneFromYardChoices = "Save it as a new Prop, or cancel and keep this draft as it is."

    static func exportReadbackPartName(_ part: ReadbackPart) -> String {
        switch part {
        case .propMissing: return partPropMissing
        case .label: return partLabel
        case .stringIds: return partStringIds
        case .edgeIds: return partEdgeIds
        }
    }
}

/// "Check the drawing", then "Save to Nightplot". Saving sends a design to the server and nothing
/// to a controller (Req 15.3).
struct ExportScreen: View {
    /// What the server was told about the LED product when the Prop was created.
    enum CreationLedProduct: Equatable {
        /// Not recorded on this phone.
        case unknown
        case sent(String?)
    }

    let model: AppModel
    /// Props from the last `GET /api/props` that could not be decoded, shown by name (Req 14.7).
    var unreadableProps: [RemotePropError] = []
    var creationLedProduct: CreationLedProduct = .unknown

    @State private var continuedPastWarning = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let document = model.document {
                    content(for: document)
                } else {
                    Text(Wording.exportNoCapture)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.foreground)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(theme.font(.body))
        .foregroundStyle(theme.colors.foreground)
        .background(theme.colors.background)
        .navigationTitle(Wording.checkScreenTitle)
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { model.cancelExport() }
    }

    // MARK: - Content

    @ViewBuilder
    private func content(for document: CaptureDocument) -> some View {
        let path = model.exportPath
        let check = ExportGate.check(document, path: path)
        let exported = LayoutExporter.export(document, path: path)
        let blocks = blockers(in: check)
        let warning = notFlatCount(in: check)

        if let count = warning, !continuedPastWarning {
            notFlatWarning(count: count)
        } else {
            Text(Wording.exportCheckIntro)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)

            if !blocks.isEmpty { blockedSection(blocks) }

            if case .success(let result) = exported {
                FrontViewCanvas(layout: result.layout, document: document)
            } else if blocks.isEmpty {
                // The gate passed but the drawing failed its own checks (Req 8.16).
                Label(Wording.exportBlockLayoutInvalid, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(theme.colors.destructive)
            }

            let unanchored = unanchoredEntries(in: blocks)
            if !unanchored.isEmpty { unanchoredSection(unanchored) }

            let low = ExportGate.lowConfidence(document)
            if !low.isEmpty { lowConfidenceSection(low, unit: document.capture.unit) }

            if !unreadableProps.isEmpty { unreadableSection }

            if showsLedProductNote(document) {
                Label(Wording.exportLedProductDiffers, systemImage: "info.circle")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.mutedForeground)
            }

            let canSave = blocks.isEmpty && isSuccess(exported)
            saveSection(canSave: canSave)
            resultSection
        }
    }

    // MARK: - Gate results

    private func blockers(in check: ExportCheck) -> [ExportBlock] {
        if case .blocked(let blocks) = check { return blocks }
        return []
    }

    private func notFlatCount(in check: ExportCheck) -> Int? {
        if case .warnNotFlat(let count) = check { return count }
        return nil
    }

    private func unanchoredEntries(in blocks: [ExportBlock]) -> [UnanchoredEntry] {
        blocks.flatMap { block -> [UnanchoredEntry] in
            if case .unanchored(let entries) = block { return entries }
            return []
        }
    }

    private func isSuccess(_ result: Result<ExportResult, ExportBlock>) -> Bool {
        if case .success = result { return true }
        return false
    }

    private func showsLedProductNote(_ document: CaptureDocument) -> Bool {
        guard document.propId != nil, case .sent(let sent) = creationLedProduct else { return false }
        return sent != document.capture.ledProductId
    }

    // MARK: - Sections

    private func notFlatWarning(count: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(Wording.exportNotFlatTitle(count: count), systemImage: "exclamationmark.triangle.fill")
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.primary)
                .accessibilityAddTraits(.isHeader)
            Text(Wording.exportNotFlatBody(count: count))
            HStack {
                Button(Wording.continueControl) { continuedPastWarning = true }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.colors.primary)
                Button(Wording.cancelControl, role: .cancel) {
                    model.cancelExport()
                    dismiss()
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
        }
    }

    private func blockedSection(_ blocks: [ExportBlock]) -> some View {
        let messages = blocks.compactMap { Wording.exportBlockMessage($0) }
        return Group {
            if !messages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(Wording.exportBlockedHeading, systemImage: "xmark.octagon.fill")
                        .font(theme.font(.sectionTitle))
                        .foregroundStyle(theme.colors.destructive)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                        Text(message)
                    }
                }
            }
        }
    }

    private func unanchoredSection(_ entries: [UnanchoredEntry]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(Wording.exportUnanchoredHeading, systemImage: "link.badge.plus")
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.foreground)
                .accessibilityAddTraits(.isHeader)
            Text(Wording.exportUnanchoredBody)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)
            ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                Text(Wording.exportPointLine(stringId: entry.stringId, index: entry.index))
                    .font(theme.font(.mono))
            }
        }
    }

    private func lowConfidenceSection(_ entries: [LowConfidenceEntry], unit: LayoutUnits) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(Wording.exportLowConfidenceHeading, systemImage: "exclamationmark.circle")
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.foreground)
                .accessibilityAddTraits(.isHeader)
            Text(Wording.exportLowConfidenceBody)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)
            ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                Text(
                    Wording.exportLowConfidenceLine(
                        stringId: entry.stringId, index: entry.index,
                        uncertainty: formatUncertainty(entry.uncertaintyM, unit: unit)))
                    .font(theme.font(.mono))
            }
        }
    }

    private var unreadableSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(Wording.exportUnreadableHeading, systemImage: "questionmark.folder")
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.foreground)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(unreadableProps.enumerated()), id: \.offset) { _, prop in
                Text(Wording.exportUnreadableLine(name: displayName(prop)))
            }
        }
    }

    private func displayName(_ prop: RemotePropError) -> String {
        if let label = prop.label, !label.isEmpty { return label }
        if let id = prop.id, !id.isEmpty { return id }
        return Wording.exportUnnamedProp
    }

    // MARK: - Save

    private var isSaving: Bool {
        if case .saving = model.exportFlow { return true }
        return false
    }

    private func saveSection(canSave: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Wording.honestyStatement)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)
            Button {
                Task { await save() }
            } label: {
                Text(Wording.saveControl)
                    .font(theme.font(.bodyEmphasis))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.colors.primary)
            .controlSize(.large)
            .disabled(!canSave || isSaving)
        }
    }

    private func save() async {
        await model.beginExport()
        // The warning was already continued on this screen.
        if continuedPastWarning, case .warnNotFlat = model.exportFlow {
            await model.continueExport()
        }
    }

    // MARK: - Results

    @ViewBuilder
    private var resultSection: some View {
        switch model.exportFlow {
        case .idle, .blocked, .warnNotFlat:
            EmptyView()
        case .layoutNotPrepared:
            resultBox {
                Label(Wording.layoutNotPrepared, systemImage: "xmark.octagon.fill")
                    .foregroundStyle(theme.colors.destructive)
            }
        case .saving:
            resultBox {
                HStack(spacing: 12) {
                    ProgressView()
                    Text(Wording.sending)
                }
                .accessibilityElement(children: .combine)
            }
        case .finished(let state):
            resultBox { finishedView(state) }
        }
    }

    private func resultBox<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Wording.exportResultHeading)
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.foreground)
                .accessibilityAddTraits(.isHeader)
            content()
            if model.propIdNotRecorded {
                Label(Wording.propIdNotRecorded, systemImage: "exclamationmark.triangle")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.primary)
            }
        }
    }

    @ViewBuilder
    private func finishedView(_ state: SaveState) -> some View {
        switch state {
        case .idle, .sending, .readingBack:
            HStack(spacing: 12) {
                ProgressView()
                Text(state == .readingBack ? Wording.readingBack : Wording.sending)
            }
            .accessibilityElement(children: .combine)
        case .confirmed(let message):
            Label(Wording.confirmed(serverMessage: message), systemImage: "checkmark.circle.fill")
                .foregroundStyle(theme.colors.online)
        case .notConfirmed(let part):
            Label(
                part.map { Wording.notConfirmedMismatch(part: Wording.exportReadbackPartName($0)) }
                    ?? Wording.createdWithoutId,
                systemImage: "questionmark.circle")
        case .readbackFailed:
            Label(Wording.readbackFailed, systemImage: "questionmark.circle")
            Button(Wording.retryCheckControl) {
                Task { await model.retryReadback() }
            }
            .buttonStyle(.bordered)
            .tint(theme.colors.primary)
            .controlSize(.large)
        case .goneFromYard:
            Label(Wording.goneFromYard, systemImage: "exclamationmark.triangle")
                .foregroundStyle(theme.colors.primary)
            Text(Wording.exportGoneFromYardChoices)
                .font(theme.font(.body))
                .foregroundStyle(theme.colors.mutedForeground)
            HStack {
                Button(Wording.saveAsNewPropControl) {
                    Task { await model.saveAsNewProp() }
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.colors.primary)
                Button(Wording.cancelControl, role: .cancel) { model.cancelExport() }
                    .buttonStyle(.bordered)
            }
            .controlSize(.large)
        case .rejected(let text):
            Label(text, systemImage: "xmark.octagon.fill").foregroundStyle(theme.colors.destructive)
        case .didNotReach:
            Label(Wording.didNotReach, systemImage: "wifi.slash")
        }
    }
}
