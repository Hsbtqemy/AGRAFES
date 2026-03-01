# Release Checklist — multicorpus_engine / AGRAFES

**Audience:** maintainers preparing a tagged release.

All checks in sections 1–3 require no secrets and can run locally or in CI.
Section 4 (signing) requires production certificates.

---

## 1. Pre-release checks (no secrets required)

```bash
# All Python tests green
pytest -q

# Contract freeze — regenerate spec and verify snapshot consistency
python scripts/export_openapi.py

# TypeScript builds green
npm --prefix tauri-prep run build
npm --prefix tauri-app run build

# JS unit tests green
node tauri-app/scripts/test_buildFtsQuery.mjs
```

Manual checklist:
- [ ] `CHANGELOG.md` entry added for this version
- [ ] `API_VERSION` / `CONTRACT_VERSION` bumped in `sidecar_contract.py` if API changed
- [ ] `__version__` bumped in `src/multicorpus_engine/__init__.py`
- [ ] `tests/snapshots/openapi_paths.json` up to date (`python scripts/export_openapi.py`)
- [ ] `docs/openapi.json` committed and matches generated spec
- [ ] `docs/SIDECAR_API_CONTRACT.md` documents all new endpoints

---

## 2. Sidecar binary validation (no secrets required)

Build locally for the current platform and verify it boots:

```bash
# macOS / Linux
python scripts/build_sidecar.py --out /tmp/sidecar-release
ls /tmp/sidecar-release/
/tmp/sidecar-release/multicorpus-<target> --help

# Windows (PowerShell)
python scripts/build_sidecar.py --out $env:TEMP\sidecar-release
$env:TEMP\sidecar-release\multicorpus-<target>.exe --help
```

Cross-platform builds are handled by CI:
- macOS + Windows: `.github/workflows/build-sidecar.yml` (triggered on tags `v*`)
- Linux manylinux: `.github/workflows/linux-manylinux-sidecar.yml`
- E2E fixture smoke: `.github/workflows/tauri-e2e-fixture.yml`

---

## 3. Release gate (CI)

The `.github/workflows/ci.yml` workflow runs on every push to `main` and all PRs.
It verifies (without any secrets):

| Job | What it checks |
|-----|----------------|
| `test` | pytest green; openapi.json matches spec; snapshot consistent |
| `build-ts` | tauri-prep + tauri-app build; JS unit tests pass |
| `build-sidecar-check` | Linux binary builds; --help responds; manifest JSON valid |

**Before tagging a release**, ensure CI is green on `main`.

---

## 4. Signing (requires certificates)

### macOS — codesign + notarization

Requires: `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID` secrets in GitHub.

```bash
# Manual (with Apple Developer cert installed locally)
./scripts/macos_sign_and_notarize_sidecar.sh

# CI (triggered via workflow_dispatch or tag)
# .github/workflows/macos-sign-notarize.yml
```

Without certs, the binary is **unsigned** (`--allow-unsigned` mode). It will run
on developer machines with `xattr -d com.apple.quarantine <binary>` but cannot
be distributed to end users without Gatekeeper bypass.

### Windows — Authenticode

Requires: `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` secrets.

```bash
# CI (workflow_dispatch or tag)
# .github/workflows/windows-sign.yml
```

### Linux — no signing

Linux binaries are not signed. Distribute via manylinux container build (RHEL 8 /
Ubuntu 20.04 compatible). See `docs/DISTRIBUTION.md` for glibc floor policy.

---

## 5. Tagging and publishing

```bash
git tag -s v<version> -m "Release v<version>"
git push origin v<version>
```

The `.github/workflows/release.yml` workflow:
1. Builds signed sidecar binaries (macOS + Windows + Linux manylinux)
2. Creates a GitHub Release with `CHANGELOG.md` as release body
3. Uploads binary artifacts

**Force-push to `main` is forbidden.** Tag from a clean, CI-green commit.

---

## TODO: Secrets setup (one-time)

To enable production signing, add these secrets to the GitHub repository:

| Secret name | Source |
|-------------|--------|
| `MACOS_CERT_P12_BASE64` | Export Developer ID cert from Keychain as .p12, base64-encode |
| `MACOS_CERT_PASSWORD` | .p12 export password |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_APP_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char team ID from Apple Developer portal |
| `WINDOWS_CERT_PFX_BASE64` | Authenticode PFX cert, base64-encoded |
| `WINDOWS_CERT_PASSWORD` | PFX password |

Without these secrets, signing steps are skipped gracefully (--allow-unsigned /
-SkipIfMissing flags), allowing CI to complete for non-production builds.
