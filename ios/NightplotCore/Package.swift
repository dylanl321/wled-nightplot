// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NightplotCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "NightplotCore", targets: ["NightplotCore"]),
    ],
    targets: [
        // Foundation-only core. Swift 6 language mode, no default actor isolation.
        .target(
            name: "NightplotCore",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
