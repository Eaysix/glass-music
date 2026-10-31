#!/usr/bin/env bash
set -euo pipefail
# One shell owns the synthetic hub, port and emulator connection. The emulator
# action executes each script line separately, so these cannot be inline variables.
TASK_ROOT="$(pwd)"
FIXTURE="$(mktemp -d)"
crates/glass-sync/target/debug/examples/test_hub "$FIXTURE/Hub.json" > "$FIXTURE/hub.log" 2>&1 &
HUB_PID=$!
trap 'kill "$HUB_PID" 2>/dev/null || true; rm -rf "$FIXTURE"' EXIT
for attempt in $(seq 1 30); do
    if test -f "$FIXTURE/Hub.json"; then break; fi
    if ! kill -0 "$HUB_PID" 2>/dev/null; then cat "$FIXTURE/hub.log"; exit 1; fi
    sleep 1
done
test -s "$FIXTURE/Hub.json"
HUB_PORT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["port"])' "$FIXTURE/Hub.json")
adb reverse "tcp:$HUB_PORT" "tcp:$HUB_PORT"
HUB_PAYLOAD=$(base64 -w0 "$FIXTURE/Hub.json")
gradle -p android --no-daemon :app:connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.hub=$HUB_PAYLOAD"
adb pull /sdcard/Pictures/GlassMusic "$TASK_ROOT/android-screenshots" || true
adb install -r "$TASK_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
adb shell am start -W -n com.eaysix.glassmusic.android/.MainActivity
sleep 1
adb exec-out screencap -p > "$TASK_ROOT/android-screen.png"
