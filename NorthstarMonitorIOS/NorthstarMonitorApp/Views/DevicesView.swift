import SwiftUI

struct DevicesView: View {
    let devices: [Device]

    var body: some View {
        List(devices) { device in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(device.clientName ?? device.app)
                        .font(.headline)
                    Spacer()
                    Text(TimestampFormatter.relativeString(from: device.lastSeenAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text("\(device.platform) • \(device.deviceType) • \(device.deviceName ?? "Unknown Device")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text("IP \(device.ip)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let lastPath = device.lastPath, !lastPath.isEmpty {
                    Text(lastPath)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Text(device.userAgent)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Text("Requests \(device.requestCount)")
                    .font(.caption)
            }
            .padding(.vertical, 4)
        }
        .navigationTitle("Devices")
        .overlay {
            if devices.isEmpty {
                ContentUnavailableView("No Devices Yet", systemImage: "iphone.slash")
            }
        }
    }
}
