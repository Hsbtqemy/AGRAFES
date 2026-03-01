# Sidecar Benchmarks

Generated at: 2026-02-28T14:36:21Z

## Latest measurements per OS/arch/format

| OS | Arch | Format | Size MB | Time-to-ready ms (mean) | Query ms (mean) | Version | Source |
|----|------|--------|--------:|-------------------------:|----------------:|---------|--------|
| linux | x86_64 | onedir | 57.399 | 122.98 | 1.709 | 0.6.1 | `20260228_linux_x86_64_onedir.json` |
| linux | x86_64 | onefile | 25.145 | 422.38 | 1.983 | 0.6.1 | `20260228_linux_x86_64_onefile.json` |
| macos | aarch64 | onedir | 54.221 | 88.61 | 0.678 | 0.6.1 | `20260228_macos_aarch64_onedir.json` |
| macos | aarch64 | onefile | 14.290 | 247.53 | 0.729 | 0.6.1 | `20260228_macos_aarch64_onefile.json` |
| windows | x86_64 | onedir | 30.332 | 305.25 | 12.320 | 0.6.1 | `20260228_windows_x86_64_onedir.json` |
| windows | x86_64 | onefile | 14.641 | 1131.00 | 13.574 | 0.6.1 | `20260228_windows_x86_64_onefile.json` |

## Recommendation

- Status: **decided**
- Scope: `per_os`
- Per-OS choice:
  - `linux` -> `onedir` (startup_gain=70.9% query_regression=-13.8% size_growth=2.28x)
  - `macos` -> `onefile` (startup_gain=64.2% query_regression=-6.9% size_growth=3.79x)
  - `windows` -> `onedir` (startup_gain=73.0% query_regression=-9.2% size_growth=2.07x)

## Raw dataset

- Parsed records: 12
- Latest records used for recommendation: 6
