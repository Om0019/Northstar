import SwiftUI

struct ControlsView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        List {
            if let controls = viewModel.controls {
                Section("Server") {
                    HStack(spacing: 20) {
                        Button {
                            Task {
                                if controls.paused || controls.stopped {
                                    await viewModel.sendTransportAction("play")
                                } else {
                                    await viewModel.sendTransportAction("pause")
                                }
                            }
                        } label: {
                            Image(systemName: controls.paused || controls.stopped ? "play.fill" : "pause.fill")
                                .font(.title2)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(controls.paused || controls.stopped ? .green : .orange)

                        Button {
                            Task {
                                await viewModel.sendTransportAction("stop")
                            }
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.title2)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(.red)
                    }

                    Text(controls.mode.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Providers") {
                    ForEach(controls.providers) { provider in
                        Toggle(provider.name, isOn: Binding(
                            get: { provider.enabled },
                            set: { enabled in
                                Task {
                                    await viewModel.setProviderEnabled(name: provider.name, enabled: enabled)
                                }
                            }
                        ))
                        .disabled(!provider.available)
                    }
                }

                Section("Players") {
                    ForEach(controls.players) { player in
                        VStack(alignment: .leading, spacing: 6) {
                            Toggle(player.name, isOn: Binding(
                                get: { player.enabled },
                                set: { enabled in
                                    Task {
                                        await viewModel.setPlayerEnabled(name: player.name, enabled: enabled)
                                    }
                                }
                            ))
                            HStack {
                                Text("Seen \(player.seenCount)")
                                Spacer()
                                if let lastSeenAt = player.lastSeenAt {
                                    Text(TimestampFormatter.relativeString(from: lastSeenAt))
                                }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                Section {
                    ContentUnavailableView("No Controls Loaded", systemImage: "switch.2")
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Section("Error") {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Controls")
    }
}
