import SwiftUI

struct OverviewView: View {
    @ObservedObject var viewModel: DashboardViewModel
    let isConfigured: Bool
    let openSettings: () -> Void
    @State private var showProviders = false
    @State private var showPlayers = false

    var body: some View {
        List {
            if !isConfigured {
                Section {
                    ContentUnavailableView(
                        "Monitor Not Configured",
                        systemImage: "lock.icloud",
                        description: Text("Add your Northflank URL and monitor token to start loading telemetry.")
                    )
                    Button("Open Settings", action: openSettings)
                }
            } else {
                Section("Status") {
                    HStack {
                        statCard(title: "Active Devices", value: "\(viewModel.summary?.activeDevices ?? 0)", tint: .green)
                        statCard(title: "All Devices", value: "\(viewModel.summary?.totalDevices ?? 0)", tint: .blue)
                    }
                    HStack {
                        statCard(title: "Activity", value: "\(viewModel.summary?.recentActivityCount ?? 0)", tint: .orange)
                        statCard(title: "Errors", value: "\(viewModel.summary?.recentErrorCount ?? 0)", tint: .red)
                    }
                }

                if let summary = viewModel.summary {
                    if let controls = viewModel.controls {
                        Section {
                            DisclosureGroup("Enabled Providers", isExpanded: $showProviders) {
                                let enabledProviders = controls.providers.filter(\.enabled)
                                if enabledProviders.isEmpty {
                                    Text("No enabled providers")
                                        .foregroundStyle(.secondary)
                                } else {
                                    ForEach(enabledProviders) { provider in
                                        Text(provider.name)
                                    }
                                }
                            }

                            DisclosureGroup("Enabled Players", isExpanded: $showPlayers) {
                                let enabledPlayers = controls.players.filter(\.enabled)
                                if enabledPlayers.isEmpty {
                                    Text("No enabled players")
                                        .foregroundStyle(.secondary)
                                } else {
                                    ForEach(enabledPlayers) { player in
                                        Text(player.name)
                                    }
                                }
                            }
                        } header: {
                            Text("Playback")
                        }
                    }

                    Section("Server") {
                        LabeledContent("Started", value: TimestampFormatter.relativeString(from: summary.startedAt))
                        LabeledContent("Last Update", value: TimestampFormatter.relativeString(from: summary.lastUpdatedAt))
                        LabeledContent("Log Buffer", value: "\(summary.recentLogCount)")
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Section("Error") {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 10, height: 10)
                    Text("Northstar")
                        .font(.headline)
                }
            }
            ToolbarItem(placement: .topBarLeading) {
                Button("Settings", action: openSettings)
            }
            ToolbarItem(placement: .topBarTrailing) {
                if viewModel.isLoading {
                    ProgressView()
                } else {
                    Button("Refresh") {
                        Task {
                            await viewModel.refresh()
                        }
                    }
                }
            }
        }
    }

    private func statCard(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }

    private var statusColor: Color {
        if viewModel.controls?.stopped == true || viewModel.summary?.stopped == true {
            return .red
        }
        if viewModel.controls?.paused == true || viewModel.summary?.paused == true {
            return .orange
        }
        return .green
    }
}
