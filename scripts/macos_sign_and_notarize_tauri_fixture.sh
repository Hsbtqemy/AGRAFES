#!/usr/bin/env bash
set -euo pipefail

# Sign and notarize a Tauri fixture .app bundle on macOS.
#
# Usage:
#   scripts/macos_sign_and_notarize_tauri_fixture.sh \
#     --app /path/to/Fixture.app \
#     --identity "Developer ID Application: Example Corp (TEAMID)" \
#     [--allow-missing-app] [--allow-unsigned]
#
# If --app is omitted, the script searches:
#   tauri-fixture/src-tauri/target/release/bundle/macos/*.app

APP_PATH=""
IDENTITY="${MACOS_SIGN_IDENTITY:-}"
ALLOW_MISSING_APP=0
ALLOW_UNSIGNED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --identity)
      IDENTITY="${2:-}"
      shift 2
      ;;
    --allow-missing-app)
      ALLOW_MISSING_APP=1
      shift
      ;;
    --allow-unsigned)
      ALLOW_UNSIGNED=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${APP_PATH}" ]]; then
  CANDIDATE="$(ls -1 tauri-fixture/src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -n 1 || true)"
  APP_PATH="${CANDIDATE}"
fi

if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  if [[ "${ALLOW_MISSING_APP}" -eq 1 ]]; then
    echo "warning: no .app bundle found, skipping Tauri fixture signing/notarization"
    exit 0
  fi
  echo "Fixture .app not found; provide --app or build fixture first." >&2
  exit 2
fi

if [[ -z "${IDENTITY}" ]]; then
  if [[ "${ALLOW_UNSIGNED}" -eq 1 ]]; then
    echo "warning: MACOS_SIGN_IDENTITY/--identity missing, skipping sign+notarize"
    exit 0
  fi
  echo "Signing identity is required (MACOS_SIGN_IDENTITY or --identity)" >&2
  exit 2
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "codesign command not found" >&2
  exit 2
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun command not found" >&2
  exit 2
fi

echo "Signing Tauri fixture app: ${APP_PATH}"
codesign --force --deep --options runtime --timestamp --sign "${IDENTITY}" "${APP_PATH}"
codesign --verify --deep --verbose --strict "${APP_PATH}"
codesign --display --verbose=2 "${APP_PATH}" || true

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

APP_ZIP="${TMP_DIR}/fixture-app.zip"
ditto -c -k --keepParent "${APP_PATH}" "${APP_ZIP}"

NOTARIZED=0
if [[ -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER_ID:-}" && -n "${APPLE_API_KEY_P8_B64:-}" ]]; then
  KEY_PATH="${TMP_DIR}/AuthKey_${APPLE_API_KEY_ID}.p8"
  APPLE_API_KEY_P8_B64_VALUE="${APPLE_API_KEY_P8_B64}" \
    python - <<'PY' "${KEY_PATH}"
import base64
import os
import pathlib
import sys

raw = os.environ["APPLE_API_KEY_P8_B64_VALUE"]
path = pathlib.Path(sys.argv[1])
path.write_bytes(base64.b64decode(raw))
PY
  echo "Submitting fixture app for notarization (API key mode)"
  xcrun notarytool submit "${APP_ZIP}" \
    --key "${KEY_PATH}" \
    --key-id "${APPLE_API_KEY_ID}" \
    --issuer "${APPLE_API_ISSUER_ID}" \
    --wait
  NOTARIZED=1
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "Submitting fixture app for notarization (Apple ID mode)"
  xcrun notarytool submit "${APP_ZIP}" \
    --apple-id "${APPLE_ID}" \
    --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
    --team-id "${APPLE_TEAM_ID}" \
    --wait
  NOTARIZED=1
else
  echo "warning: notarization secrets missing, fixture app remains signed but not notarized"
fi

if [[ "${NOTARIZED}" -eq 1 ]]; then
  echo "Stapling notarization ticket to app"
  xcrun stapler staple "${APP_PATH}"
fi

spctl -a -t exec -vv "${APP_PATH}" || true
echo "Done: ${APP_PATH}"
