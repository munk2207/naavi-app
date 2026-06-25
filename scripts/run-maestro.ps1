# run-maestro.ps1 — Wrapper for Maestro on Windows
#
# Maestro 2.x on Windows loses the adb port forward (tcp:7001) after each
# test run because the gRPC server on the device shuts down and the forward
# goes stale. This script re-forwards before every run so you don't need to
# manually re-run adb forward each time.
#
# Usage:
#   .\scripts\run-maestro.ps1                        # run all flows
#   .\scripts\run-maestro.ps1 e2e/07-collapse-expand-toggle.yaml  # one flow

param(
    [string]$Flow = "e2e/",
    [string]$AppId = "ca.naavi.app"
)

$device = "emulator-5554"

# Kill any zombie Maestro instrumentation from the previous run.
# Without this, the next launch times out waiting for the gRPC server that
# already exited — the new am-instrument process can't bind the same pid.
Write-Host "Stopping Maestro driver (clears zombie gRPC session)..." -ForegroundColor Cyan
adb -s $device shell am force-stop dev.mobile.maestro | Out-Null
adb -s $device shell am force-stop dev.mobile.maestro.test | Out-Null
Start-Sleep -Milliseconds 800   # let the OS release the port

Write-Host "Re-forwarding adb port 7001..." -ForegroundColor Cyan
adb -s $device forward tcp:7001 tcp:7001 | Out-Null

Write-Host "Running Maestro: $Flow (appId=$AppId)" -ForegroundColor Cyan
maestro test -e APP_ID=$AppId $Flow
