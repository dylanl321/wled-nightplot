import ARKit
import NightplotCore
import SwiftUI

/// Navigation between Drafts, Capture, Export, and Server Settings.
///
/// The reference scan and wrap mark flows are panels hosted over the Capture screen's AR view.
struct RootView: View {
    let model: AppModel

    private enum Route: Hashable {
        case capture
        case export
        case serverSettings
    }

    private enum Flow {
        case referenceScan
        case markWraps
    }

    @State private var path: [Route] = []
    @State private var controller: ARCaptureController?
    @State private var flow: Flow?
    @State private var unreadableProps: [RemotePropError] = []

    var body: some View {
        NavigationStack(path: $path) {
            DraftsScreen(
                model: model,
                arAvailable: ARWorldTrackingConfiguration.isSupported,
                onOpened: { path.append(.capture) },
                onOpenServerSettings: { path.append(.serverSettings) }
            )
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .capture: captureDestination
                case .export: exportDestination
                case .serverSettings: ServerSettingsScreen(model: model)
                }
            }
        }
        .nightplotTheme()
        .task { await model.launch() }
        .onChange(of: path) { _, newPath in
            // Leaving the Capture saves the draft and returns to the list.
            if newPath.isEmpty, model.document != nil {
                flow = nil
                Task { await model.closeCapture() }
            }
        }
    }

    private var captureDestination: some View {
        ZStack(alignment: .bottom) {
            CaptureScreen(
                model: model,
                onExport: {
                    flow = nil
                    path.append(.export)
                },
                onReferenceScan: { flow = .referenceScan },
                onMarkWraps: { flow = .markWraps },
                onController: { made in
                    controller = made
                    if made == nil { flow = nil }
                })
            if let controller, let flow {
                flowPanel(flow, controller: controller)
            }
        }
    }

    @ViewBuilder
    private func flowPanel(_ flow: Flow, controller: ARCaptureController) -> some View {
        FlowPanelBackdrop {
            switch flow {
            case .referenceScan:
                ReferenceScanFlow(model: model, controller: controller, onClose: { self.flow = nil })
            case .markWraps:
                WrapMarkFlow(model: model, controller: controller, onClose: { self.flow = nil })
            }
        }
    }

    private var exportDestination: some View {
        ExportScreen(model: model, unreadableProps: unreadableProps, creationLedProduct: .unknown)
            .task { unreadableProps = await model.unreadableRemoteProps() }
    }
}

/// The dimmed backdrop a scan or wrap flow sits on, above the camera. It reads
/// the Theme so Reduce Transparency gives a solid surface instead of a
/// translucent material (Req 16.17).
private struct FlowPanelBackdrop<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    var body: some View {
        content
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background {
                if theme.reduceTransparency {
                    theme.colors.background
                } else {
                    Rectangle().fill(.regularMaterial)
                }
            }
    }
}
