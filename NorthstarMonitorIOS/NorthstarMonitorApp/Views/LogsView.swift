import SwiftUI

struct LogsView: View {
    let logs: [LogItem]

    var body: some View {
        List(logs) { log in
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(log.level.uppercased())
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color(for: log.level))
                    Spacer()
                    Text(TimestampFormatter.relativeString(from: log.timestamp))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(log.message)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)

                if let path = log.path, !path.isEmpty {
                    Text(path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
        .navigationTitle("Logs")
        .overlay {
            if logs.isEmpty {
                ContentUnavailableView("No Logs Yet", systemImage: "doc.text.magnifyingglass")
            }
        }
    }

    private func color(for level: String) -> Color {
        switch level {
        case "error":
            return .red
        case "warn":
            return .orange
        default:
            return .blue
        }
    }
}
