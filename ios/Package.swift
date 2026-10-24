// swift-tools-version: 5.9
import PackageDescription

// 核心规则与 SwiftData 状态可在 macOS 上测试；App 仍由 Xcode 工程构建。
let package = Package(
    name: "PassArchiveCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PassArchiveCore", targets: ["PassArchiveCore"])],
    targets: [
        .target(
            name: "PassArchiveCore", path: "PassArchive",
            exclude: ["PassArchiveApp.swift", "ContentView.swift", "RecordViews.swift", "AccountViews.swift"],
            sources: ["Models.swift", "LocalArchive.swift", "ArchiveRules.swift", "ArchiveMerge.swift", "AccountAPI.swift", "ArchiveStore.swift"],
            resources: [.process("catalog.json")]
        ),
        .testTarget(name: "PassArchiveCoreTests", dependencies: ["PassArchiveCore"], path: "Tests")
    ]
)
