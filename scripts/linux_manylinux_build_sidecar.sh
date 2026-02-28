#!/usr/bin/env bash
set -euo pipefail

# Build sidecar inside manylinux2014_x86_64 container for broader glibc compatibility.
#
# Usage:
#   scripts/linux_manylinux_build_sidecar.sh --format onefile --out tauri/src-tauri/binaries

FORMAT="onefile"
OUT_DIR="tauri/src-tauri/binaries"
IMAGE_TAG="${MANYLINUX_IMAGE_TAG:-agrafes-manylinux-builder:latest}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      FORMAT="${2:-}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "${FORMAT}" != "onefile" && "${FORMAT}" != "onedir" ]]; then
  echo "--format must be onefile or onedir (got ${FORMAT})" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKERFILE="${REPO_ROOT}/docker/manylinux/Dockerfile"

echo "Building Docker image ${IMAGE_TAG}"
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${REPO_ROOT}"

echo "Building sidecar in manylinux container (format=${FORMAT}, out=${OUT_DIR})"
docker run --rm \
  -v "${REPO_ROOT}:/work" \
  -w /work \
  "${IMAGE_TAG}" \
  /bin/bash -lc "
    /opt/python/cp311-cp311/bin/python -m pip install --upgrade pip &&
    /opt/python/cp311-cp311/bin/pip install -e '.[packaging]' &&
    /opt/python/cp311-cp311/bin/python scripts/build_sidecar.py --out '${OUT_DIR}' --format '${FORMAT}'
  "

MANIFEST_PATH="${REPO_ROOT}/${OUT_DIR}/sidecar-manifest.json"
if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Manifest not found after manylinux build: ${MANIFEST_PATH}" >&2
  exit 1
fi

echo "Built manylinux sidecar manifest:"
cat "${MANIFEST_PATH}"
