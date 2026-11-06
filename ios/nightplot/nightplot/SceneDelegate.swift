//
//  SceneDelegate.swift
//  nightplot
//
//  Created by Dylan on 11/6/26.
//

import UIKit
import SwiftUI

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    /// Built once per scene from the live environment.
    @MainActor private var model: AppModel?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let model = MainActor.assumeIsolated { () -> AppModel in
            let made = AppModel(environment: .live())
            self.model = made
            return made
        }

        // RootView calls `model.launch()` from its `.task`. The camera gate re-checks on
        // `didBecomeActiveNotification` inside `CameraPermissionController`, and the AR
        // controller saves the world map when the app goes to the background.
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIHostingController(rootView: RootView(model: model))
        self.window = window
        window.makeKeyAndVisible()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Write the open draft now, so nothing waits on the save delay.
        Task { @MainActor in
            _ = await self.model?.flushSave()
        }
    }
}
