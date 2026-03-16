# Northstar Monitor iOS

SwiftUI iPhone app for the monitoring endpoints exposed by the Northstar server.

## What It Does

- Connects to your Northflank deployment over HTTPS
- Authenticates with `MONITOR_TOKEN`
- Shows overview stats, devices, activity, errors, and logs
- Polls the backend automatically every 20 seconds

## Open In Xcode

Open:

```text
NorthstarMonitorApp.xcodeproj
```

## Configure

On first launch, enter:

- Base URL: `https://your-service.on.northflank.app`
- Monitor token: the same value you set for `MONITOR_TOKEN`

The app stores both values locally with `@AppStorage`.

## Notes

- The app expects the monitoring endpoints added in the server changes.
- The backend telemetry is in-memory, so server restarts clear history.
