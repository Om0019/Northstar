# iOS Monitor App

This repo now exposes a simple monitoring API that an iPhone app can poll from Northflank.

## Recommended Scope

Build the first version as a read-only dashboard with three tabs:

1. `Overview`
2. `Activity`
3. `Errors`

That keeps the app small and useful.

## API Base

Use your Northflank service URL, for example:

```text
https://your-service.your-project.on.northflank.app
```

If you set `MONITOR_TOKEN`, send:

```text
Authorization: Bearer <MONITOR_TOKEN>
```

## Endpoints To Poll

```text
GET /monitor/summary
GET /monitor/devices?limit=100
GET /monitor/activity?limit=100
GET /monitor/errors?limit=100
GET /monitor/logs?limit=100
```

Polling every 15 to 30 seconds is enough for this use case.

## SwiftUI Structure

```text
NorthstarMonitorApp/
  NorthstarMonitorApp.swift
  Models/
    Summary.swift
    Device.swift
    ActivityItem.swift
    LogItem.swift
  Services/
    MonitorAPIClient.swift
  ViewModels/
    DashboardViewModel.swift
  Views/
    DashboardView.swift
    DevicesView.swift
    ActivityView.swift
    ErrorsView.swift
    LogsView.swift
```

## Models

```swift
struct Summary: Decodable {
    let startedAt: String
    let lastUpdatedAt: String
    let totalDevices: Int
    let activeDevices: Int
    let recentActivityCount: Int
    let recentErrorCount: Int
    let recentLogCount: Int
    let providers: [String]
}

struct Device: Decodable, Identifiable {
    let id: String
    let firstSeenAt: String
    let lastSeenAt: String
    let requestCount: Int
    let ip: String
    let app: String
    let deviceType: String
    let platform: String
    let userAgent: String
    let host: String?
    let lastPath: String?
}

struct ActivityItem: Decodable, Identifiable {
    let id: String
    let timestamp: String
    let deviceId: String?
    let clientIp: String?
    let app: String?
    let platform: String?
    let eventType: String
    let type: String?
    let mediaType: String?
    let imdbId: String?
    let tmdbId: Int?
    let season: String?
    let episode: String?
    let title: String?
    let streamCount: Int?
    let requestPath: String?
    let reason: String?
}

struct LogItem: Decodable, Identifiable {
    let id: String
    let timestamp: String
    let level: String
    let message: String
    let path: String?
    let method: String?
    let deviceId: String?
    let clientIp: String?
}

struct DevicesResponse: Decodable {
    let devices: [Device]
}

struct ActivityResponse: Decodable {
    let activity: [ActivityItem]
}

struct LogsResponse: Decodable {
    let logs: [LogItem]
}

struct ErrorsResponse: Decodable {
    let errors: [LogItem]
}
```

## API Client

```swift
import Foundation

final class MonitorAPIClient {
    let baseURL: URL
    let token: String

    init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    func fetchSummary() async throws -> Summary {
        try await get(path: "monitor/summary", as: Summary.self)
    }

    func fetchDevices() async throws -> [Device] {
        try await get(path: "monitor/devices?limit=100", as: DevicesResponse.self).devices
    }

    func fetchActivity() async throws -> [ActivityItem] {
        try await get(path: "monitor/activity?limit=100", as: ActivityResponse.self).activity
    }

    func fetchErrors() async throws -> [LogItem] {
        try await get(path: "monitor/errors?limit=100", as: ErrorsResponse.self).errors
    }

    func fetchLogs() async throws -> [LogItem] {
        try await get(path: "monitor/logs?limit=100", as: LogsResponse.self).logs
    }

    private func get<T: Decodable>(path: String, as type: T.Type) async throws -> T {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}
```

## View Model

```swift
import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var summary: Summary?
    @Published var devices: [Device] = []
    @Published var activity: [ActivityItem] = []
    @Published var errors: [LogItem] = []
    @Published var logs: [LogItem] = []
    @Published var errorMessage: String?

    private let client: MonitorAPIClient

    init(client: MonitorAPIClient) {
        self.client = client
    }

    func refresh() async {
        do {
            async let summary = client.fetchSummary()
            async let devices = client.fetchDevices()
            async let activity = client.fetchActivity()
            async let errors = client.fetchErrors()
            async let logs = client.fetchLogs()

            self.summary = try await summary
            self.devices = try await devices
            self.activity = try await activity
            self.errors = try await errors
            self.logs = try await logs
            self.errorMessage = nil
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }
}
```

## UI Notes

- `Overview`: show active devices, total devices, recent errors, and provider list.
- `Activity`: show title, device/app, stream count, and timestamp.
- `Errors`: show the latest runtime failures first.
- `Logs`: keep this secondary because logs get noisy fast.
- `Devices`: show platform, app, IP, request count, and last seen time.

## Important Limits

- Current telemetry is in-memory only. A deploy or restart clears it.
- Device detection is inferred from headers and IP, so it is approximate.
- "What is being watched" means stream lookup requests hitting this addon. It does not confirm playback completion.

## Best Next Step

If you want the app itself scaffolded in this repo, the next step is to generate a small SwiftUI project that reads these endpoints and renders the four dashboard screens.
