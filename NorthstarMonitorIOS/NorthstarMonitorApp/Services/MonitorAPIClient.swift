import Foundation

struct MonitorAPIClient {
    let baseURL: URL
    let token: String

    func fetchSummary() async throws -> Summary {
        try await get(path: "monitor/summary", as: Summary.self)
    }

    func fetchDevices() async throws -> [Device] {
        try await get(path: "monitor/devices?limit=100", as: DevicesResponse.self).devices
    }

    func fetchActivity() async throws -> [ActivityItem] {
        try await get(path: "monitor/activity?limit=100", as: ActivityResponse.self).activity
    }

    func fetchCurrentlyPlaying() async throws -> [CurrentlyPlayingSession] {
        try await get(path: "monitor/currently-playing?limit=50", as: CurrentlyPlayingResponse.self).sessions
    }

    func fetchRecentlyPlayed() async throws -> [CurrentlyPlayingSession] {
        try await get(path: "monitor/recently-played?limit=50", as: CurrentlyPlayingResponse.self).sessions
    }

    func fetchErrors() async throws -> [LogItem] {
        try await get(path: "monitor/errors?limit=100", as: ErrorsResponse.self).errors
    }

    func fetchLogs() async throws -> [LogItem] {
        try await get(path: "monitor/logs?limit=100", as: LogsResponse.self).logs
    }

    func fetchControls() async throws -> ControlState {
        try await get(path: "monitor/controls", as: ControlState.self)
    }

    func setPaused(_ paused: Bool) async throws -> ControlState {
        try await post(path: "monitor/controls/pause", body: ["paused": paused], as: ControlState.self)
    }

    func setProviderEnabled(name: String, enabled: Bool) async throws -> ControlState {
        let encodedName = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        return try await post(path: "monitor/controls/providers/\(encodedName)", body: ["enabled": enabled], as: ControlState.self)
    }

    func setPlayerEnabled(name: String, enabled: Bool) async throws -> ControlState {
        let encodedName = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        return try await post(path: "monitor/controls/players/\(encodedName)", body: ["enabled": enabled], as: ControlState.self)
    }

    func sendTransportAction(_ action: String) async throws -> ControlState {
        try await postString(path: "monitor/controls/state", body: ["action": action], as: ControlState.self)
    }

    private func get<T: Decodable>(path: String, as type: T.Type) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw MonitorAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MonitorAPIError.badResponse
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            if httpResponse.statusCode == 401 {
                throw MonitorAPIError.unauthorized
            }
            throw MonitorAPIError.httpStatus(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw MonitorAPIError.decodingFailed(error)
        }
    }

    private func post<T: Decodable>(path: String, body: [String: Bool], as type: T.Type) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw MonitorAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MonitorAPIError.badResponse
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            if httpResponse.statusCode == 401 {
                throw MonitorAPIError.unauthorized
            }
            throw MonitorAPIError.httpStatus(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw MonitorAPIError.decodingFailed(error)
        }
    }

    private func postString<T: Decodable>(path: String, body: [String: String], as type: T.Type) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw MonitorAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MonitorAPIError.badResponse
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            if httpResponse.statusCode == 401 {
                throw MonitorAPIError.unauthorized
            }
            throw MonitorAPIError.httpStatus(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw MonitorAPIError.decodingFailed(error)
        }
    }
}

enum MonitorAPIError: LocalizedError {
    case invalidURL
    case badResponse
    case unauthorized
    case httpStatus(Int)
    case decodingFailed(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The monitor URL is invalid."
        case .badResponse:
            return "The server returned an invalid response."
        case .unauthorized:
            return "Monitor token rejected by the server."
        case .httpStatus(let statusCode):
            return "Server returned HTTP \(statusCode)."
        case .decodingFailed:
            return "The app could not decode the server response."
        }
    }
}
