import Foundation

struct Summary: Decodable {
    let startedAt: String
    let lastUpdatedAt: String
    let totalDevices: Int
    let activeDevices: Int
    let recentActivityCount: Int
    let recentErrorCount: Int
    let recentLogCount: Int
    let providers: [String]
    let paused: Bool
    let stopped: Bool
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
    let deviceName: String?
    let clientName: String?
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

struct CurrentlyPlayingResponse: Decodable {
    let sessions: [CurrentlyPlayingSession]
}

struct CurrentlyPlayingSession: Decodable, Identifiable {
    let id: String
    let startedAt: String
    let lastActivityAt: String?
    let active: Bool
    let proxyHits: Int
    let title: String
    let type: String?
    let mediaType: String?
    let imdbId: String?
    let tmdbId: Int?
    let season: String?
    let episode: String?
    let deviceId: String?
    let clientIp: String?
    let app: String?
    let platform: String?
    let deviceName: String?
    let clientName: String?
    let provider: String?
    let player: String?
    let activeForSeconds: Int
}

struct LogsResponse: Decodable {
    let logs: [LogItem]
}

struct ErrorsResponse: Decodable {
    let errors: [LogItem]
}

struct ControlState: Decodable {
    let paused: Bool
    let stopped: Bool
    let mode: String
    let providers: [ProviderControl]
    let players: [PlayerControl]
}

struct ProviderControl: Decodable, Identifiable {
    let name: String
    let enabled: Bool
    let available: Bool

    var id: String { name }
}

struct PlayerControl: Decodable, Identifiable {
    let name: String
    let enabled: Bool
    let seenCount: Int
    let lastSeenAt: String?

    var id: String { name }
}

enum TimestampFormatter {
    static let apiInput: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let apiFallback: ISO8601DateFormatter = {
        ISO8601DateFormatter()
    }()

    static let output: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    static func relativeString(from value: String) -> String {
        let date = apiInput.date(from: value) ?? apiFallback.date(from: value)
        guard let date else {
            return value
        }
        return output.localizedString(for: date, relativeTo: Date())
    }
}
