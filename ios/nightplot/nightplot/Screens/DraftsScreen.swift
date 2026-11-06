import NightplotCore
import SwiftUI

/// The draft list (Req 1.3, 11.7, 11.9, 13.2, 13.6, 13.7).
struct DraftsScreen: View {
    let model: AppModel
    /// False when the device does not support ARKit world tracking (Req 1.3).
    let arAvailable: Bool
    /// Called after a capture is open (new or from a draft) so the root can show it.
    var onOpened: () -> Void = {}
    var onOpenServerSettings: () -> Void = {}

    @State private var pendingDelete: PendingDelete?
    @State private var openError: String?

    @Environment(\.theme) private var theme

    private struct PendingDelete: Identifiable {
        let id: UUID
        let label: String
    }

    var body: some View {
        List {
            Section {
                serverChip
                if !arAvailable {
                    Label("AR capture is not available on this device.", systemImage: "arkit")
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                        .accessibilityElement(children: .combine)
                }
            }
            .listRowBackground(theme.colors.card)

            Section {
                if model.drafts.isEmpty {
                    Text("No drafts yet.")
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                }
                ForEach(Array(model.drafts.enumerated()), id: \.offset) { _, entry in
                    row(entry)
                }
            } header: {
                Text("Drafts")
                    .font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
            }
            .listRowBackground(theme.colors.card)
        }
        .scrollContentBackground(.hidden)
        .background(theme.colors.background)
        .navigationTitle("Captures")
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button {
                    model.newCapture()
                    onOpened()
                } label: {
                    Label("New Capture", systemImage: "plus")
                        .font(theme.font(.body))
                        .frame(minHeight: 44)
                }
                .tint(theme.colors.primary)
                .disabled(!arAvailable)
            }
        }
        .task { await model.refreshDrafts() }
        .refreshable { await model.refreshDrafts() }
        .confirmationDialog(
            pendingDelete.map { "Delete \(displayLabel($0.label))?" } ?? "Delete draft?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { item in
            Button("Delete", role: .destructive) {
                Task { await model.deleteDraft(item.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This removes the draft from this phone. A Prop already saved in Nightplot stays as it is.")
        }
        .alert(
            "This draft could not be opened",
            isPresented: Binding(
                get: { openError != nil },
                set: { if !$0 { openError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(openError ?? "")
        }
    }

    // MARK: - Server chip

    private var serverChip: some View {
        Button(action: onOpenServerSettings) {
            HStack(spacing: 10) {
                // A filled dot in the status colour, with the status text beside
                // it so colour is not the only signal (Req 16.19).
                Circle()
                    .fill(chipColor)
                    .frame(width: 12, height: 12)
                    .accessibilityHidden(true)
                Image(
                    systemName: ServerStatusCopy.symbol(
                        model.serverStatus, checking: model.isCheckingServer))
                    .foregroundStyle(chipColor)
                    .accessibilityHidden(true)
                Text(ServerStatusCopy.summary(model.serverStatus, checking: model.isCheckingServer))
                    .font(theme.font(.bodyEmphasis))
                    .foregroundStyle(theme.colors.foreground)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(theme.colors.mutedForeground)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
        }
        .accessibilityLabel(
            ServerStatusCopy.summary(model.serverStatus, checking: model.isCheckingServer))
        .accessibilityValue(chipDetail)
        .accessibilityHint("Opens server settings")
    }

    private var chipDetail: String {
        model.isCheckingServer ? "" : ServerStatusCopy.detail(model.serverStatus)
    }

    /// The status chip colour: the online token when reachable, the quiet token
    /// when not configured, and the destructive token when unreachable
    /// (Req 16.19). While a check is in flight it stays quiet.
    private var chipColor: Color {
        if model.isCheckingServer { return theme.colors.quiet }
        switch model.serverStatus {
        case .reachable: return theme.colors.online
        case .notConfigured: return theme.colors.quiet
        case .unreachable: return theme.colors.destructive
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func row(_ entry: DraftListEntry) -> some View {
        switch entry {
        case .readable(let id, let label, let kind, let stringCount, let editedAtMs):
            let shown = displayLabel(label)
            let edited = Date(timeIntervalSince1970: Double(editedAtMs) / 1000)
            Button {
                Task {
                    if let error = await model.openDraft(id) {
                        openError = Self.message(for: error)
                    } else {
                        onOpened()
                    }
                }
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(shown)
                        .font(theme.font(.sectionTitle))
                        .foregroundStyle(theme.colors.foreground)
                    HStack(spacing: 4) {
                        Text(kind)
                            .font(theme.font(.body))
                            .foregroundStyle(theme.colors.mutedForeground)
                        Text("\(stringCount) \(stringCount == 1 ? "string" : "strings")")
                            .font(theme.font(.mono))
                            .foregroundStyle(theme.colors.mutedForeground)
                    }
                    Text("Edited \(edited.formatted(date: .abbreviated, time: .shortened))")
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(shown)
            .accessibilityValue(
                "\(kind), \(stringCount) \(stringCount == 1 ? "string" : "strings"), edited \(edited.formatted(date: .abbreviated, time: .shortened))"
            )
            .accessibilityHint("Opens this draft")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: "Delete") {
                pendingDelete = PendingDelete(id: id, label: label)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive) {
                    pendingDelete = PendingDelete(id: id, label: label)
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        case .unreadable(let fileName):
            // Listed by file name, never opened or edited, and the file stays on disk (Req 13.6).
            VStack(alignment: .leading, spacing: 4) {
                Text(fileName)
                    .font(theme.font(.mono))
                    .foregroundStyle(theme.colors.foreground)
                Text("Unreadable. This file cannot be opened.")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.mutedForeground)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(fileName), unreadable")
            .accessibilityHint("This file cannot be opened")
        }
    }

    private func displayLabel(_ label: String) -> String {
        label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled" : label
    }

    private static func message(for error: DraftDecodeError) -> String {
        switch error {
        case .versionTooNew:
            return "It was saved by a newer version of the app."
        case .malformed, .missingVersion:
            return "The file could not be read."
        }
    }
}
