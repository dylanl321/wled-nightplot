import NightplotCore
import SwiftUI

/// Operator-facing text for the server status. Shared by the draft list chip and the settings screen.
enum ServerStatusCopy {
    /// Short chip text (Req 11.7, 11.9). "Not configured" is distinct from "unreachable".
    static func summary(_ status: ServerStatus, checking: Bool) -> String {
        if checking { return "Checking server…" }
        switch status {
        case .notConfigured: return "Server not configured"
        case .reachable: return "Server reachable"
        case .unreachable: return "Server unreachable"
        }
    }

    /// Names which of the four failure cases happened (Req 11.7).
    static func reason(_ reason: UnreachableReason) -> String {
        switch reason {
        case .cannotConnect: return "Could not connect."
        case .timedOut: return "No response within 5 seconds."
        case .status(let code): return "The server answered HTTP \(code), not 200."
        case .wrongService(let service):
            if let service, !service.isEmpty {
                return "That address answered as \"\(service)\", not Nightplot."
            }
            return "That address answered, but it did not say it is Nightplot."
        }
    }

    /// Full detail line for the last health result.
    static func detail(_ status: ServerStatus) -> String {
        switch status {
        case .notConfigured: return "No address saved. Nothing has been sent."
        case .reachable: return "Nightplot answered at the saved address."
        case .unreachable(let why): return reason(why)
        }
    }

    static let localNetworkHint =
        "If Nightplot cannot reach the server, check that Local Network access is on for this app in Settings, and that this phone is on the same network as the server."

    static func symbol(_ status: ServerStatus, checking: Bool) -> String {
        if checking { return "arrow.triangle.2.circlepath" }
        switch status {
        case .notConfigured: return "questionmark.circle"
        case .reachable: return "checkmark.circle"
        case .unreachable: return "exclamationmark.triangle"
        }
    }
}

/// Host and port for the Nightplot server (Req 11.1, 11.2, 11.3, 11.5, 11.7, 11.8, 11.9).
struct ServerSettingsScreen: View {
    @Bindable var model: AppModel
    @FocusState private var focus: Field?

    @Environment(\.theme) private var theme

    private enum Field: Hashable { case host, port }

    var body: some View {
        Form {
            Section {
                TextField("Host", text: $model.addressHost)
                    .font(theme.font(.mono))
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .host)
                    .submitLabel(.next)
                    .onSubmit { focus = .port }
                    .accessibilityLabel("Server host")
                    .accessibilityHint("An address on your home network, such as 192.168.1.20")
                if let message = hostError {
                    errorText(message)
                }

                TextField("Port", text: $model.addressPortText)
                    .font(theme.font(.mono))
                    .keyboardType(.numberPad)
                    .focused($focus, equals: .port)
                    .accessibilityLabel("Server port")
                    .accessibilityHint("A whole number from 1 to 65535")
                if let message = portError {
                    errorText(message)
                }
            } header: {
                Text("Nightplot server")
                    .font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
            } footer: {
                Text("Only addresses on the home network are allowed.")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.mutedForeground)
            }
            .listRowBackground(theme.colors.card)

            Section {
                Button {
                    focus = nil
                    Task { await model.saveAddress() }
                } label: {
                    Text("Save")
                        .font(theme.font(.bodyEmphasis))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .tint(theme.colors.primary)
                .disabled(model.isCheckingServer)
            }
            .listRowBackground(theme.colors.card)

            Section {
                Button {
                    focus = nil
                    Task { await model.findServers(auto: false) }
                } label: {
                    HStack(spacing: 12) {
                        if model.isFinding {
                            ProgressView()
                            Text("Searching…")
                                .font(theme.font(.bodyEmphasis))
                        } else {
                            Text("Find servers")
                                .font(theme.font(.bodyEmphasis))
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .tint(theme.colors.primary)
                .disabled(model.isFinding)
                .accessibilityLabel(model.isFinding ? "Searching for servers" : "Find servers")

                if let note = model.serverNote {
                    Text(note)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                        .accessibilityLabel(note)
                }

                ForEach(model.foundServers, id: \.server) { row in
                    foundRow(row)
                }

                if let message = findSummary {
                    Text(message)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                        .accessibilityLabel(message)
                }
            } header: {
                Text("Find")
                    .font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
            } footer: {
                Text("Search the home network for Nightplot servers.")
                    .font(theme.font(.body))
                    .foregroundStyle(theme.colors.mutedForeground)
            }
            .listRowBackground(theme.colors.card)

            Section {
                if model.isCheckingServer {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Checking server…")
                            .font(theme.font(.body))
                            .foregroundStyle(theme.colors.foreground)
                    }
                    .accessibilityElement(children: .combine)
                } else {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ServerStatusCopy.summary(model.serverStatus, checking: false))
                                .font(theme.font(.bodyEmphasis))
                                .foregroundStyle(theme.colors.foreground)
                            Text(ServerStatusCopy.detail(model.serverStatus))
                                .font(theme.font(.body))
                                .foregroundStyle(theme.colors.mutedForeground)
                        }
                    } icon: {
                        Image(systemName: ServerStatusCopy.symbol(model.serverStatus, checking: false))
                            .foregroundStyle(statusColor)
                    }
                    .accessibilityElement(children: .combine)
                }
                if showsLocalNetworkHint {
                    Text(ServerStatusCopy.localNetworkHint)
                        .font(theme.font(.body))
                        .foregroundStyle(theme.colors.mutedForeground)
                }
            } header: {
                Text("Last check")
                    .font(theme.font(.sectionTitle))
                    .foregroundStyle(theme.colors.foreground)
            }
            .listRowBackground(theme.colors.card)
        }
        .scrollContentBackground(.hidden)
        .background(theme.colors.background)
        .navigationTitle("Server")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The last-check icon colour, matching the drafts chip map (Req 16.19).
    private var statusColor: Color {
        switch model.serverStatus {
        case .reachable: return theme.colors.online
        case .notConfigured: return theme.colors.quiet
        case .unreachable: return theme.colors.destructive
        }
    }

    /// One resolved row. A reachable row shows the online colour and a Use button;
    /// an advertised-but-unreachable row shows the reason in the destructive colour
    /// and has no Use button, so it is never offered as reachable (Req 11.17).
    @ViewBuilder
    private func foundRow(_ row: FoundServer) -> some View {
        let reachable = ServerDiscovery.isUsable(row)
        let address = "\(row.server.host):\(row.server.port)"
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: reachable ? "checkmark.circle" : "exclamationmark.triangle")
                .foregroundStyle(reachable ? theme.colors.online : theme.colors.destructive)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(row.server.name)
                    .font(theme.font(.bodyEmphasis))
                    .foregroundStyle(theme.colors.foreground)
                Text(address)
                    .font(theme.font(.mono))
                    .foregroundStyle(theme.colors.mutedForeground)
                Text(healthCopy(row.health))
                    .font(theme.font(.body))
                    .foregroundStyle(reachable ? theme.colors.online : theme.colors.destructive)
            }
            Spacer(minLength: 0)
            if reachable {
                Button {
                    focus = nil
                    Task { await model.useFoundServer(row.server) }
                } label: {
                    Text("Use")
                        .font(theme.font(.bodyEmphasis))
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderless)
                .tint(theme.colors.primary)
                .accessibilityLabel("Use \(row.server.name) at \(address)")
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.server.name), \(address), \(healthCopy(row.health))")
    }

    /// Plain-language health for a found row, reusing the four-case reason copy (Req 11.7, 11.17).
    private func healthCopy(_ health: HealthResult) -> String {
        switch health {
        case .reachable: return "Reachable"
        case .unreachable(let why): return "Unreachable. \(ServerStatusCopy.reason(why))"
        }
    }

    /// A line shown below the rows: the Local Network hint when denied, or a plain
    /// "No servers found" after a browse that resolved zero rows. Both are distinct
    /// from not-configured and from each other (Req 11.21, 11.23).
    private var findSummary: String? {
        if model.localNetworkDenied { return ServerStatusCopy.localNetworkHint }
        if case .done(let found, _) = model.findState, found.isEmpty {
            return "No servers found."
        }
        return nil
    }

    private func errorText(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(theme.font(.body))
            .foregroundStyle(theme.colors.destructive)
            .accessibilityLabel("Error: \(message)")
    }

    private var hostError: String? {
        switch model.addressError {
        case .hostEmpty: return "Enter a host."
        case .hostTooLong: return "The host must be 253 characters or fewer."
        case .notLan: return "Only addresses on the home network are allowed."
        case .portInvalid, .none: return nil
        }
    }

    private var portError: String? {
        model.addressError == .portInvalid ? "The port must be a whole number from 1 to 65535." : nil
    }

    private var showsLocalNetworkHint: Bool {
        if case .unreachable(.cannotConnect) = model.serverStatus { return true }
        return false
    }
}
