# Distribution Guide — AGRAFES Sidecar + Tauri Fixture

Last updated: 2026-02-28 (ADR-025 decided)

## Goals

- Build sidecar artifacts for macOS, Windows, Linux.
- Support signing/notarization where credentials exist.
- Keep CI safe when secrets are missing (unsigned build fallback).
- Provide manylinux-based Linux artifacts for wider glibc compatibility.

## Artifact layout

- Canonical app sidecar output:
  - `tauri/src-tauri/binaries/`
- Fixture output:
  - `tauri-fixture/src-tauri/binaries/`

Naming:
- onefile executable:
  - `multicorpus-<target_triple>[.exe]`
- onedir bundle:
  - directory `multicorpus-<target_triple>-onedir/`
  - executable inside:
    - `multicorpus-<target_triple>`
    - `multicorpus-<target_triple>.exe` on Windows

Manifest:
- `<out>/sidecar-manifest.json`
- includes `format`, `artifact_path`, `executable_path`, size and sha256 fields.

## Local commands

### Build sidecar (onefile / onedir)

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri
python scripts/build_sidecar.py --preset tauri --format onefile
python scripts/build_sidecar.py --preset tauri --format onedir
python scripts/build_sidecar.py --preset fixture
```

Default format mapping (when `--format` is omitted):
- macOS (`darwin`): `onefile`
- Linux (`linux`): `onedir`
- Windows (`windows`): `onedir`

### Benchmark sidecar formats

```bash
python scripts/bench_sidecar_startup.py \
  --bin-dir build/dist-bench/onefile \
  --bin-dir build/dist-bench/onedir \
  --mode persistent \
  --runs 3 \
  --query-runs 10
python scripts/aggregate_bench_results.py --input bench/results --output docs/BENCHMARKS.md
```

Auto output path:
- combined: `bench/results/<date>_<format-or-compare>_<os>.json`
- per-format: `bench/results/<date>_<os>_<arch>_<format>.json`

### macOS sidecar sign + notarize

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: <Company> (<TEAMID>)"
export APPLE_API_KEY_ID="<KEY_ID>"
export APPLE_API_ISSUER_ID="<ISSUER_ID>"
export APPLE_API_KEY_P8_B64="<BASE64_P8>"
bash scripts/macos_sign_and_notarize_sidecar.sh \
  --binary tauri/src-tauri/binaries/multicorpus-aarch64-apple-darwin
```

### macOS fixture app sign + notarize

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: <Company> (<TEAMID>)"
export APPLE_API_KEY_ID="<KEY_ID>"
export APPLE_API_ISSUER_ID="<ISSUER_ID>"
export APPLE_API_KEY_P8_B64="<BASE64_P8>"
bash scripts/macos_sign_and_notarize_tauri_fixture.sh --app /path/to/Fixture.app
```

### Windows sidecar signing

```powershell
$env:WIN_SIGN_CERT_PFX_BASE64 = "<BASE64_PFX>"
$env:WIN_SIGN_CERT_PASSWORD = "<PFX_PASSWORD>"
./scripts/windows_sign_sidecar.ps1 -FilePath ".\tauri\src-tauri\binaries\multicorpus-x86_64-pc-windows-msvc.exe"
```

### Linux manylinux build

```bash
bash scripts/linux_manylinux_build_sidecar.sh --format onedir --out tauri/src-tauri/binaries
```

## CI workflows

- `.github/workflows/build-sidecar.yml`
  - cross-platform sidecar build (explicit per-OS format)
  - macOS=`onefile`, Linux=`onedir`, Windows=`onedir`
- `.github/workflows/tauri-e2e-fixture.yml`
  - headless persistent sidecar smoke per OS
- `.github/workflows/bench-sidecar.yml`
  - matrix benchmark (macOS/Linux/Windows) for `onefile` and `onedir`
  - artifact upload of JSON metrics
  - aggregation to `docs/BENCHMARKS.md` artifact
- `.github/workflows/macos-sign-notarize.yml`
  - sidecar sign/notarize on macOS
  - optional `tauri-fixture` `.app` sign/notarize on workflow_dispatch
    (`build_fixture_app=true`)
- `.github/workflows/windows-sign.yml`
  - sidecar signing on windows (conditional by secrets)
- `.github/workflows/linux-manylinux-sidecar.yml`
  - manylinux2014 sidecar build (`onedir`) + `--help` verification
- `.github/workflows/release.yml`
  - multi-OS build (+ conditional signing/notarization)
  - upload artifacts
  - publish GitHub release on `v*` tags

## Secrets (GitHub Actions)

### macOS signing/notarization

- `MACOS_CERT_P12_BASE64` (optional; needed for signing in CI)
- `MACOS_CERT_P12_PASSWORD` (optional)
- `MACOS_SIGN_IDENTITY` (optional but required for actual signing)
- Notarization (API key mode, preferred):
  - `APPLE_API_KEY_ID`
  - `APPLE_API_ISSUER_ID`
  - `APPLE_API_KEY_P8_B64`
- Alternative notarization mode:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`

### Windows signing

- `WIN_SIGN_CERT_PFX_BASE64`
- `WIN_SIGN_CERT_PASSWORD`

## Behavior when secrets are missing

- Build jobs still run and upload unsigned artifacts.
- Signing/notarization steps print warnings and exit successfully.
- No secret values are printed or committed.

## manylinux notes

- Base image: `quay.io/pypa/manylinux2014_x86_64`.
- Output triple remains `x86_64-unknown-linux-gnu`.
- Verification in CI runs:
  - executable `--help`
- Additional compatibility checks (`ldd`, distro matrix) remain backlog.

## Format default status

- ADR-025 is decided with `per_os` mapping:
  - macOS -> `onefile`
  - Linux -> `onedir`
  - Windows -> `onedir`
- Decision details and benchmark basis:
  - `docs/DECISIONS.md` (ADR-025)
  - `docs/BENCHMARKS.md`
