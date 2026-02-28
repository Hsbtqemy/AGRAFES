#!/usr/bin/env bash
set -euo pipefail

# Sign and notarize a sidecar executable on macOS.
#
# Usage:
#   scripts/macos_sign_and_notarize_sidecar.sh \
#     --binary tauri/src-tauri/binaries/multicorpus-aarch64-apple-darwin \
#     --identity "Developer ID Application: Example Corp (TEAMID)" \
#     [--allow-unsigned]
#
# Secrets (environment):
#   Preferred notarytool API key mode:
#     APPLE_API_KEY_ID
#     APPLE_API_ISSUER_ID
#     APPLE_API_KEY_P8_B64
#   Alternative Apple ID mode:
#     APPLE_ID
#     APPLE_APP_SPECIFIC_PASSWORD
#     APPLE_TEAM_ID

BINARY=""
IDENTITY="${MACOS_SIGN_IDENTITY:-}"
ALLOW_UNSIGNED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY="${2:-}"
      shift 2
      ;;
    --identity)
      IDENTITY="${2:-}"
      shift 2
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

if [[ -z "${BINARY}" ]]; then
  echo "Missing --binary" >&2
  exit 2
fi

if [[ ! -f "${BINARY}" ]]; then
  echo "Binary not found: ${BINARY}" >&2
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

echo "Signing sidecar: ${BINARY}"
codesign --force --options runtime --timestamp --sign "${IDENTITY}" "${BINARY}"
codesign --verify --verbose --strict "${BINARY}"
codesign --display --verbose=2 "${BINARY}" || true
spctl -a -t exec -vv "${BINARY}" || true

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

ZIP_PATH="${TMP_DIR}/sidecar.zip"
ditto -c -k --keepParent "${BINARY}" "${ZIP_PATH}"

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
  echo "Submitting sidecar for notarization (API key mode)"
  xcrun notarytool submit "${ZIP_PATH}" \
    --key "${KEY_PATH}" \
    --key-id "${APPLE_API_KEY_ID}" \
    --issuer "${APPLE_API_ISSUER_ID}" \
    --wait
  NOTARIZED=1
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "Submitting sidecar for notarization (Apple ID mode)"
  xcrun notarytool submit "${ZIP_PATH}" \
    --apple-id "${APPLE_ID}" \
    --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
    --team-id "${APPLE_TEAM_ID}" \
    --wait
  NOTARIZED=1
else
  echo "warning: notarization secrets missing, sidecar remains signed but not notarized"
fi

if [[ "${NOTARIZED}" -eq 1 ]]; then
  echo "Notarization accepted for sidecar archive."
  echo "note: stapler does not apply to plain executable files; distribute notarized zip or include in notarized app bundle."
fi

echo "Done: ${BINARY}"
