import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @AppStorage("monitor.baseURL") private var baseURLString = ""
    @AppStorage("monitor.token") private var token = ""
    @State private var showingSettings = false

    var body: some View {
        TabView {
            NavigationStack {
                OverviewView(viewModel: viewModel, isConfigured: isConfigured, openSettings: {
                    showingSettings = true
                })
            }
            .tabItem {
                Label("Overview", systemImage: "rectangle.grid.2x2")
            }

            NavigationStack {
                ControlsView(viewModel: viewModel)
            }
            .tabItem {
                Label("Controls", systemImage: "switch.2")
            }

            NavigationStack {
                ActivityView(currentlyPlaying: viewModel.currentlyPlaying, recentlyPlayed: viewModel.recentlyPlayed)
            }
            .tabItem {
                Label("Playing", systemImage: "play.rectangle")
            }

            NavigationStack {
                ErrorsView(errors: viewModel.errors)
            }
            .tabItem {
                Label("Errors", systemImage: "exclamationmark.triangle")
            }

            NavigationStack {
                LogsView(logs: viewModel.logs)
            }
            .tabItem {
                Label("Logs", systemImage: "text.append")
            }
        }
        .task {
            await configureAndRefresh()
        }
        .onChange(of: baseURLString) { _, _ in
            Task {
                await configureAndRefresh()
            }
        }
        .onChange(of: token) { _, _ in
            Task {
                await configureAndRefresh()
            }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView(baseURLString: $baseURLString, token: $token)
                .presentationDetents([.medium])
        }
    }

    private var isConfigured: Bool {
        !baseURLString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func configureAndRefresh() async {
        viewModel.configure(baseURLString: baseURLString, token: token)
        await viewModel.refresh()
    }
}
