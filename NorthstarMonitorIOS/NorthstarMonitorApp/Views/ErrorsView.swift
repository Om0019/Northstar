import SwiftUI

struct ErrorsView: View {
    let errors: [LogItem]

    var body: some View {
        List(errors) { error in
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(error.level.uppercased())
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                    Spacer()
                    Text(TimestampFormatter.relativeString(from: error.timestamp))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(error.message)
                    .font(.body.monospaced())
                    .textSelection(.enabled)

                Text(error.path ?? "No request path")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
        .navigationTitle("Errors")
        .overlay {
            if errors.isEmpty {
                ContentUnavailableView("No Errors", systemImage: "checkmark.shield")
            }
        }
    }
}
