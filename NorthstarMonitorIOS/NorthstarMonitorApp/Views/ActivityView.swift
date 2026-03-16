import SwiftUI

struct ActivityView: View {
    let currentlyPlaying: [CurrentlyPlayingSession]
    let recentlyPlayed: [CurrentlyPlayingSession]

    var body: some View {
        List {
            Section("Currently Playing") {
                if currentlyPlaying.isEmpty {
                    ContentUnavailableView("Nothing Playing", systemImage: "play.slash")
                } else {
                    ForEach(currentlyPlaying) { item in
                        sessionRow(item)
                    }
                }
            }

            Section("Recently Played") {
                let recentOnly = recentlyPlayed.filter { recent in
                    !currentlyPlaying.contains(where: { $0.id == recent.id })
                }
                if recentOnly.isEmpty {
                    Text("No recent sessions")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(recentOnly) { item in
                        sessionRow(item)
                    }
                }
            }
        }
        .navigationTitle("Currently Playing")
    }

    @ViewBuilder
    private func sessionRow(_ item: CurrentlyPlayingSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(item.title)
                    .font(.headline)
                Spacer()
                Text(TimestampFormatter.relativeString(from: item.lastActivityAt ?? item.startedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(sessionMeta(for: item))
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(deviceLabel(for: item))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func sessionMeta(for item: CurrentlyPlayingSession) -> String {
        var parts: [String] = []
        if let type = item.type, !type.isEmpty {
            parts.append(type)
        }
        if let season = item.season, let episode = item.episode, !season.isEmpty, !episode.isEmpty {
            parts.append("S\(season)E\(episode)")
        }
        if let provider = item.provider, !provider.isEmpty {
            parts.append(provider)
        }
        if let player = item.player, !player.isEmpty {
            parts.append(player)
        }
        parts.append("Active \(item.activeForSeconds)s")
        return parts.joined(separator: " • ")
    }

    private func deviceLabel(for item: CurrentlyPlayingSession) -> String {
        var parts: [String] = []
        if let clientName = item.clientName, !clientName.isEmpty {
            parts.append(clientName)
        } else if let app = item.app, !app.isEmpty {
            parts.append(app)
        }
        if let platform = item.platform, !platform.isEmpty {
            parts.append(platform)
        }
        if let ip = item.clientIp, !ip.isEmpty {
            parts.append(ip)
        }
        return parts.joined(separator: " • ")
    }
}
