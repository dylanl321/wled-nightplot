import NightplotCore
import SwiftUI

// Copy for the capture screen and its details sheet. It extends `Wording` so every
// operator-facing string has one home. None of these uses Attach, Apply, Preview, or
// Hardware Done (Req 15.2).
extension Wording {
    nonisolated static let detailsTitle = "Details"
    nonisolated static let detailsLabel = "Label"
    nonisolated static let detailsKind = "Kind"
    nonisolated static let detailsUnit = "Unit"
    nonisolated static let detailsFlat = "Flat"
    nonisolated static let detailsFlatHint = "Turn on for a shape that lies in one plane, like a window or a wall."
    nonisolated static let detailsSpacing = "Spacing (cm)"
    nonisolated static let detailsProduct = "LED product"
    nonisolated static let detailsNoProduct = "None"
    nonisolated static let detailsProductsUnavailable = "LED products are unavailable"
    nonisolated static let detailsNoSpacing = "This product gives no spacing."
    nonisolated static let detailsSpacingInvalid = "Enter spacing in cm, more than 0 and up to 200."
    nonisolated static let detailsCounts = "Lengths and lights"
    nonisolated static let detailsTotal = "Total lights"
    nonisolated static let detailsUnknown = "unknown"
    nonisolated static let detailsDone = "Done"
    nonisolated static let detailsNoRuns = "No runs yet."

    nonisolated static func kindName(_ kind: PropKindChoice) -> String {
        switch kind {
        case .roofline: return "Roofline"
        case .window: return "Window"
        case .arch: return "Arch"
        case .tree: return "Tree"
        case .stakeRow: return "Stake row"
        case .spiral: return "Spiral"
        case .zigzag: return "Zigzag"
        case .custom: return "Custom"
        }
    }

    nonisolated static func unitName(_ unit: LayoutUnits) -> String {
        unit == .ft ? "Feet" : "Metres"
    }

    /// One line for an edit that was refused.
    nonisolated static func refusalMessage(_ refusal: EditRefusal) -> String {
        switch refusal {
        case .stringLimitReached: return "You have 16 strings, the most a Capture can hold."
        case .sameAsLastPoint: return "A run needs two different points."
        case .hiddenCountOutOfRange: return "Enter a whole number from 0 to 10,000."
        case .spacingInvalid: return detailsSpacingInvalid
        case .productHasNoSpacing: return detailsNoSpacing
        case .labelTooLong: return "The label is too long. Use 64 characters or fewer."
        case .labelEmpty: return "Enter a label."
        case .unknownTarget: return "That point or run is no longer there."
        case .closeLoopUnavailable:
            return "Close Loop needs 3 points on this string and the reticle on the first one."
        }
    }

    /// A length in the Capture's unit, or "unknown".
    nonisolated static func lengthText(_ length: Measured<Double>?, unit: LayoutUnits) -> String {
        guard case .known(let metres)? = length else { return detailsUnknown }
        let text = formatLength(metres, unit)
        return unit == .m ? text + " m" : text
    }

    /// A light count, or "unknown".
    nonisolated static func lightsText(_ lights: Measured<Int>?) -> String {
        guard case .known(let n)? = lights else { return detailsUnknown }
        return n == 1 ? "1 light" : "\(n) lights"
    }
}

/// Label, kind, unit, Flat, spacing, LED product, and counts (Req 7.1, 7.3, 7.4, 7.6 to 7.9,
/// 7.11 to 7.13, 8.2, 13.8).
struct CaptureDetailsSheet: View {
    let model: AppModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @State private var labelText = ""
    @State private var spacingText = ""
    @State private var spacingInvalid = false
    @State private var message: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                if let capture = model.document?.capture {
                    basics(capture)
                    spacingSection(capture)
                    countsSection(capture)
                }
                if let saveMessage = model.draftSaveMessage {
                    Section { Text(saveMessage).foregroundStyle(theme.colors.destructive) }
                        .listRowBackground(theme.colors.card)
                }
            }
            .font(theme.font(.body))
            .scrollContentBackground(.hidden)
            .background(theme.colors.background)
            .navigationTitle(Wording.detailsTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Wording.detailsDone) {
                        commitLabel()
                        dismiss()
                    }
                    .font(theme.font(.bodyEmphasis))
                    .tint(theme.colors.primary)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }
            .onAppear {
                guard !loaded, let capture = model.document?.capture else { return }
                loaded = true
                labelText = capture.label
                spacingText = capture.spacingM.map(formatPitchCm) ?? ""
            }
            .onChange(of: model.document?.capture.spacingM) { _, new in
                // A product can change the spacing. Typed text that failed stays as typed.
                if !spacingInvalid { spacingText = new.map(formatPitchCm) ?? "" }
            }
            .onDisappear { commitLabel() }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func basics(_ capture: Capture) -> some View {
        Section {
            TextField(Wording.detailsLabel, text: $labelText)
                .frame(minHeight: 44)
                .submitLabel(.done)
                .onSubmit { commitLabel() }
                .accessibilityLabel(Wording.detailsLabel)

            Picker(
                Wording.detailsKind,
                selection: Binding(
                    get: { capture.kind },
                    set: { apply(.setKind($0)) })
            ) {
                ForEach(PropKindChoice.allCases, id: \.self) { kind in
                    Text(Wording.kindName(kind)).tag(kind)
                }
            }
            .frame(minHeight: 44)

            Picker(
                Wording.detailsUnit,
                selection: Binding(
                    get: { capture.unit },
                    set: { apply(.setUnit($0)) })
            ) {
                Text(Wording.unitName(.ft)).tag(LayoutUnits.ft)
                Text(Wording.unitName(.m)).tag(LayoutUnits.m)
            }
            .pickerStyle(.segmented)
            .frame(minHeight: 44)

            Toggle(
                Wording.detailsFlat,
                isOn: Binding(
                    get: { model.document?.flat ?? false },
                    set: { model.setFlat($0) })
            )
            .frame(minHeight: 44)
            .accessibilityHint(Wording.detailsFlatHint)
        }
        .listRowBackground(theme.colors.card)
    }

    @ViewBuilder
    private func spacingSection(_ capture: Capture) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField(Wording.detailsSpacing, text: $spacingText)
                    .font(theme.font(.mono))
                    .keyboardType(.decimalPad)
                    .frame(minHeight: 44)
                    .overlay(alignment: .bottom) {
                        if spacingInvalid { Rectangle().fill(theme.colors.destructive).frame(height: 2) }
                    }
                    .onChange(of: spacingText) { _, _ in
                        if spacingInvalid { spacingInvalid = false }
                    }
                    .onSubmit { commitSpacing() }
                    .accessibilityLabel(Wording.detailsSpacing)
                    .accessibilityValue(spacingInvalid ? Wording.detailsSpacingInvalid : "")
                if spacingInvalid {
                    Text(Wording.detailsSpacingInvalid)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.destructive)
                }
                Button("Use this spacing") { commitSpacing() }
                    .tint(theme.colors.primary)
                    .frame(minHeight: 44)
            }

            productPicker(capture)

            if let message {
                Text(message)
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.mutedForeground)
            }
        }
        .listRowBackground(theme.colors.card)
    }

    @ViewBuilder
    private func productPicker(_ capture: Capture) -> some View {
        if let products = model.ledProducts {
            Picker(
                Wording.detailsProduct,
                selection: Binding(
                    get: { capture.ledProductId ?? "" },
                    set: { choose($0, in: products) })
            ) {
                Text(Wording.detailsNoProduct).tag("")
                ForEach(products, id: \.id) { product in
                    Text(product.label).tag(product.id)
                }
            }
            .frame(minHeight: 44)
        } else {
            Text(Wording.detailsProductsUnavailable)
                .foregroundStyle(theme.colors.mutedForeground)
                .frame(minHeight: 44, alignment: .leading)
        }
    }

    @ViewBuilder
    private func countsSection(_ capture: Capture) -> some View {
        let counts = model.counts
        Section {
            if capture.strings.allSatisfy({ $0.runs.isEmpty }) {
                Text(Wording.detailsNoRuns).foregroundStyle(theme.colors.mutedForeground)
            }
            ForEach(capture.strings, id: \.id) { string in
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        "String \(string.id): \(Wording.lengthText(counts.stringLengthM[string.id], unit: capture.unit)), \(Wording.lightsText(counts.stringLights[string.id]))"
                    )
                    .font(theme.font(.monoEmphasis))
                    .foregroundStyle(theme.colors.foreground)
                    ForEach(string.runs, id: \.id) { run in
                        Text(runLine(run, counts: counts, unit: capture.unit))
                            .font(theme.font(.mono))
                            .foregroundStyle(theme.colors.mutedForeground)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            HStack {
                Text(Wording.detailsTotal)
                    .font(theme.font(.body))
                Spacer()
                Text(Wording.lightsText(counts.totalLights))
                    .font(theme.font(.monoEmphasis))
            }
            .foregroundStyle(theme.colors.foreground)
            .accessibilityElement(children: .combine)
        } header: {
            Text(Wording.detailsCounts)
                .font(theme.font(.sectionTitle))
                .foregroundStyle(theme.colors.foreground)
        }
        .listRowBackground(theme.colors.card)
    }

    private func runLine(_ run: CaptureRun, counts: CaptureCounts, unit: LayoutUnits) -> String {
        let length = Wording.lengthText(counts.runLengthM[run.id], unit: unit)
        switch run.kind {
        case .lit:
            return "Run \(run.id), lit: \(length), \(Wording.lightsText(counts.runLights[run.id]))"
        case .wire:
            return "Run \(run.id), wire: \(length)"
        case .hidden:
            return "Run \(run.id), hidden: \(length), \(run.hiddenCount ?? 0) hidden"
        }
    }

    // MARK: - Edits

    private func apply(_ edit: CaptureEdit) {
        switch model.perform(edit) {
        case .refused(let refusal): message = Wording.refusalMessage(refusal)
        case .applied(let notice): message = notice.map(Wording.refusalMessage)
        case .ignored: break
        }
    }

    private func commitLabel() {
        guard let current = model.document?.capture.label, current != labelText else { return }
        apply(.setLabel(labelText))
    }

    private func commitSpacing() {
        let outcome = model.perform(.setTypedSpacing(text: spacingText))
        switch outcome {
        case .refused(let refusal):
            spacingInvalid = refusal == .spacingInvalid
            message = Wording.refusalMessage(refusal)
        default:
            spacingInvalid = false
            message = nil
            spacingText = model.document?.capture.spacingM.map(formatPitchCm) ?? spacingText
        }
    }

    private func choose(_ id: String, in products: [LedProductSummary]) {
        spacingInvalid = false
        if let product = products.first(where: { $0.id == id }) {
            apply(.attachProduct(product))
        } else {
            apply(.detachProduct)
        }
    }
}
