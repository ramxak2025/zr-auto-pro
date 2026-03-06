#!/bin/bash
# Build Android APK locally
# Usage: ./scripts/build-apk.sh [debug|release]

set -e

BUILD_TYPE="${1:-debug}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$PROJECT_DIR/mobile"
ANDROID_DIR="$MOBILE_DIR/android"

export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk

# Fix proxy for Gradle: remove google.com from nonProxyHosts so it goes through proxy
if echo "$JAVA_TOOL_OPTIONS" | grep -q "google.com"; then
  export JAVA_TOOL_OPTIONS=$(echo "$JAVA_TOOL_OPTIONS" | sed 's/|[*]\.googleapis\.com|[*]\.google\.com//g')
fi

echo "=== Building Autexa APK ($BUILD_TYPE) ==="

# Ensure android/local.properties exists
if [ ! -f "$ANDROID_DIR/local.properties" ]; then
  echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
fi

# Run prebuild if needed
if [ ! -f "$ANDROID_DIR/build.gradle" ] && [ ! -f "$ANDROID_DIR/build.gradle.kts" ]; then
  echo "Running expo prebuild..."
  cd "$MOBILE_DIR"
  npx expo prebuild --platform android --clean
  echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
fi

cd "$ANDROID_DIR"

if [ "$BUILD_TYPE" = "release" ]; then
  ./gradlew assembleRelease
  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew assembleDebug
  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
fi

if [ -f "$APK_PATH" ]; then
  VERSION=$(grep '"version"' "$MOBILE_DIR/app.json" | head -1 | grep -oP '\d+\.\d+\.\d+')
  DEST="$PROJECT_DIR/Autexa-v${VERSION}-${BUILD_TYPE}.apk"
  cp "$APK_PATH" "$DEST"
  SIZE=$(du -h "$DEST" | cut -f1)
  echo ""
  echo "=== BUILD SUCCESSFUL ==="
  echo "APK: $DEST ($SIZE)"
else
  echo "BUILD FAILED: APK not found"
  exit 1
fi
