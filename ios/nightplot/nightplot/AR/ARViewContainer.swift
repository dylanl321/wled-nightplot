import RealityKit
import SwiftUI

/// Hosts the controller's `ARView` in SwiftUI.
struct ARViewContainer: UIViewRepresentable {
    let controller: ARCaptureController

    func makeUIView(context: Context) -> ARView {
        controller.arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}
}
