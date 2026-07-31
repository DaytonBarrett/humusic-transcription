// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Humusic",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "Humusic",
            path: "Sources/Humusic",
            resources: [
                .process("Resources")
            ]
        )
    ]
)