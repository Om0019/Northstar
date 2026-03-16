import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published private(set) var summary: Summary?
    @Published private(set) var currentlyPlaying: [CurrentlyPlayingSession] = []
    @Published private(set) var recentlyPlayed: [CurrentlyPlayingSession] = []
    @Published private(set) var errors: [LogItem] = []
    @Published private(set) var logs: [LogItem] = []
    @Published private(set) var controls: ControlState?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private var client: MonitorAPIClient?
    private var pollingTask: Task<Void, Never>?

    func configure(baseURLString: String, token: String) {
        let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURL.isEmpty else {
            client = nil
            stopPolling()
            summary = nil
            currentlyPlaying = []
            recentlyPlayed = []
            errors = []
            logs = []
            controls = nil
            errorMessage = nil
            return
        }

        guard let url = URL(string: trimmedURL.hasSuffix("/") ? trimmedURL : "\(trimmedURL)/") else {
            client = nil
            stopPolling()
            errorMessage = "Base URL is invalid."
            return
        }

        client = MonitorAPIClient(baseURL: url, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
        errorMessage = nil
        startPolling()
    }

    func refresh() async {
        guard let client else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            async let summaryResult = client.fetchSummary()
            async let currentlyPlayingResult = client.fetchCurrentlyPlaying()
            async let recentlyPlayedResult = client.fetchRecentlyPlayed()
            async let errorsResult = client.fetchErrors()
            async let logsResult = client.fetchLogs()
            async let controlsResult = client.fetchControls()

            summary = try await summaryResult
            currentlyPlaying = try await currentlyPlayingResult
            recentlyPlayed = try await recentlyPlayedResult
            errors = try await errorsResult
            logs = try await logsResult
            controls = try await controlsResult
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setPaused(_ paused: Bool) async {
        guard let client else { return }
        do {
            controls = try await client.setPaused(paused)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendTransportAction(_ action: String) async {
        guard let client else { return }
        do {
            controls = try await client.sendTransportAction(action)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setProviderEnabled(name: String, enabled: Bool) async {
        guard let client else { return }
        do {
            controls = try await client.setProviderEnabled(name: name, enabled: enabled)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setPlayerEnabled(name: String, enabled: Bool) async {
        guard let client else { return }
        do {
            controls = try await client.setPlayerEnabled(name: name, enabled: enabled)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func startPolling() {
        stopPolling()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            await self.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled {
                    return
                }
                await self.refresh()
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    deinit {
        pollingTask?.cancel()
    }
}
