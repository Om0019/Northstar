import SwiftUI

struct SettingsView: View {
    @Binding var baseURLString: String
    @Binding var token: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Northflank Server") {
                    TextField("https://your-service.on.northflank.app", text: $baseURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()

                    SecureField("MONITOR_TOKEN", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Notes") {
                    Text("Use the same MONITOR_TOKEN configured on the server.")
                    Text("The app polls every 20 seconds.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}
