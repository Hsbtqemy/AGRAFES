#!/usr/bin/env python3
"""Benchmark sidecar startup/latency/size across onefile/onedir artifacts.

Outputs machine-readable JSON under ``bench/results``:
- combined run payload:
  ``<date>_<format-or-compare>_<os>.json``
- per-target payload (when enabled):
  ``<date>_<os>_<arch>_<format>.json``
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import re
import statistics
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BIN_DIR = REPO_ROOT / "tauri" / "src-tauri" / "binaries"
DEFAULT_RESULTS_DIR = REPO_ROOT / "bench" / "results"
OS_LABEL_MAP = {
    "darwin": "macos",
    "linux": "linux",
    "windows": "windows",
}
ALLOWED_STDERR_WARNING_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"Encoding detection fell back to cp1252 for fixture\.txt"),
)


def _path_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total


def _runtime_os_label() -> str:
    raw = platform.system().lower()
    return OS_LABEL_MAP.get(raw, raw)


def _runtime_arch_label() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64", "x64"}:
        return "x86_64"
    if machine in {"arm64", "aarch64"}:
        return "aarch64"
    return machine


def _target_os_arch(target_triple: str | None) -> tuple[str, str]:
    if not target_triple:
        return _runtime_os_label(), _runtime_arch_label()
    parts = target_triple.split("-")
    arch = parts[0] if parts else _runtime_arch_label()
    os_part = target_triple
    if "apple-darwin" in os_part:
        return "macos", arch
    if "windows" in os_part:
        return "windows", arch
    if "linux" in os_part:
        return "linux", arch
    return _runtime_os_label(), arch


def _parse_single_json(text: str, label: str) -> dict:
    payload_raw = text.strip()
    if not payload_raw.startswith("{") or not payload_raw.endswith("}"):
        raise RuntimeError(f"{label}: stdout is not a single JSON object: {payload_raw!r}")
    payload = json.loads(payload_raw)
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label}: parsed payload is not JSON object")
    return payload


def _filter_disallowed_stderr(stderr_text: str) -> list[str]:
    disallowed: list[str] = []
    for raw_line in stderr_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if any(pattern.search(line) for pattern in ALLOWED_STDERR_WARNING_PATTERNS):
            continue
        disallowed.append(line)
    return disallowed


def _is_executable_candidate(path: Path) -> bool:
    if not path.is_file():
        return False
    name = path.name
    if name.startswith("multicorpus-"):
        return True
    if name in {"multicorpus", "multicorpus.exe"}:
        return True
    return False


def _resolve_executable_from_artifact(
    artifact_path: Path,
    target_triple: str | None = None,
) -> Path:
    if artifact_path.is_file():
        return artifact_path

    if not artifact_path.is_dir():
        raise FileNotFoundError(f"Artifact path not found: {artifact_path}")

    expected_names: list[str] = []
    if target_triple:
        expected_names.extend(
            [
                f"multicorpus-{target_triple}",
                f"multicorpus-{target_triple}.exe",
            ]
        )
    expected_names.extend(["multicorpus", "multicorpus.exe"])
    for name in expected_names:
        candidate = artifact_path / name
        if candidate.exists() and candidate.is_file():
            return candidate

    candidates = sorted(p for p in artifact_path.iterdir() if _is_executable_candidate(p))
    if candidates:
        return candidates[0]

    raise FileNotFoundError(f"No executable candidate found in onedir artifact: {artifact_path}")


def _load_manifest(bin_dir: Path) -> dict[str, Any] | None:
    manifest_path = bin_dir / "sidecar-manifest.json"
    if not manifest_path.exists():
        return None
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        return payload
    return None


def _resolve_target(explicit: str | None, bin_dir: Path) -> dict[str, Any]:
    if explicit:
        p = Path(explicit)
        if not p.is_absolute():
            p = REPO_ROOT / p
        if not p.exists():
            raise FileNotFoundError(f"Sidecar binary/artifact not found: {p}")
        executable = _resolve_executable_from_artifact(p)
        fmt = "onedir" if p.is_dir() else "onefile"
        return {
            "bin_dir": str(bin_dir),
            "format": fmt,
            "target_triple": None,
            "version": None,
            "artifact_path": str(p),
            "artifact_size_bytes": _path_size(p),
            "executable_path": str(executable),
            "executable_size_bytes": _path_size(executable),
        }

    manifest = _load_manifest(bin_dir)
    if manifest is not None:
        fmt = str(manifest.get("format", "onefile"))
        target_triple = manifest.get("target_triple")
        version = manifest.get("version")
        artifact_path_raw = manifest.get("artifact_path")
        executable_path_raw = manifest.get("executable_path")

        if isinstance(artifact_path_raw, str) and artifact_path_raw:
            artifact_path = Path(artifact_path_raw)
        else:
            artifact_path = bin_dir / (
                f"multicorpus-{target_triple}" if isinstance(target_triple, str) else "multicorpus"
            )
        if not artifact_path.is_absolute():
            artifact_path = REPO_ROOT / artifact_path

        if isinstance(executable_path_raw, str) and executable_path_raw:
            executable = Path(executable_path_raw)
            if not executable.is_absolute():
                executable = REPO_ROOT / executable
        else:
            executable = _resolve_executable_from_artifact(
                artifact_path,
                target_triple if isinstance(target_triple, str) else None,
            )

        if not executable.exists():
            raise FileNotFoundError(f"Executable from manifest not found: {executable}")

        return {
            "bin_dir": str(bin_dir),
            "format": fmt,
            "target_triple": target_triple,
            "version": version,
            "artifact_path": str(artifact_path),
            "artifact_size_bytes": _path_size(artifact_path),
            "executable_path": str(executable),
            "executable_size_bytes": _path_size(executable),
        }

    candidates = sorted(p for p in bin_dir.glob("multicorpus-*"))
    if not candidates:
        raise FileNotFoundError(
            f"No sidecar artifacts found in {bin_dir}. Build with scripts/build_sidecar.py first."
        )

    artifact = candidates[0]
    executable = _resolve_executable_from_artifact(artifact)
    fmt = "onedir" if artifact.is_dir() else "onefile"
    return {
        "bin_dir": str(bin_dir),
        "format": fmt,
        "target_triple": None,
        "version": None,
        "artifact_path": str(artifact),
        "artifact_size_bytes": _path_size(artifact),
        "executable_path": str(executable),
        "executable_size_bytes": _path_size(executable),
    }


def _run_and_time(cmd: list[str]) -> tuple[float, subprocess.CompletedProcess[str]]:
    start = time.perf_counter()
    proc = subprocess.run(cmd, text=True, capture_output=True)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return elapsed_ms, proc


def _validate_contract(proc: subprocess.CompletedProcess[str], expected_rc: int, label: str) -> dict:
    if proc.returncode != expected_rc:
        raise RuntimeError(
            f"{label}: expected rc={expected_rc}, got rc={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
    if proc.stderr.strip():
        raise RuntimeError(f"{label}: stderr must be empty, got: {proc.stderr!r}")
    return _parse_single_json(proc.stdout, label)


def bench_help(binary: Path, runs: int) -> list[float]:
    samples: list[float] = []
    for i in range(runs):
        elapsed_ms, proc = _run_and_time([str(binary), "--help"])
        if proc.returncode != 0:
            raise RuntimeError(f"help run {i + 1} failed: rc={proc.returncode}\nstderr={proc.stderr}")
        samples.append(elapsed_ms)
    return samples


def bench_init_project(binary: Path, runs: int) -> list[float]:
    samples: list[float] = []
    for i in range(runs):
        with tempfile.TemporaryDirectory(prefix="agrafes-sidecar-bench-") as td:
            db = Path(td) / "bench.db"
            elapsed_ms, proc = _run_and_time([str(binary), "init-project", "--db", str(db)])
            _validate_contract(proc, expected_rc=0, label=f"init-project run {i + 1}")
            samples.append(elapsed_ms)
    return samples


def _read_first_json_from_stream(stream, timeout_s: float = 20.0) -> dict:
    start = time.time()
    buf: list[str] = []
    depth = 0
    started = False

    while time.time() - start < timeout_s:
        line = stream.readline()
        if not line:
            time.sleep(0.01)
            continue
        buf.append(line)
        for ch in line:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
                if started and depth == 0:
                    text = "".join(buf)
                    return _parse_single_json(text, "persistent-startup")
    raise TimeoutError("Timed out waiting for initial sidecar serve JSON payload")


def _http_json(
    method: str,
    url: str,
    payload: dict | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict]:
    data = None
    merged_headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        merged_headers["Content-Type"] = "application/json; charset=utf-8"
    if headers:
        merged_headers.update(headers)
    req = urllib.request.Request(url, method=method, data=data, headers=merged_headers)
    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _read_token_from_portfile(portfile_path: str | None) -> str | None:
    if not isinstance(portfile_path, str) or not portfile_path:
        return None
    path = Path(portfile_path)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    token = payload.get("token")
    if isinstance(token, str) and token:
        return token
    return None


def bench_persistent(binary: Path, runs: int, query_runs: int) -> dict:
    ttr_samples: list[float] = []
    query_samples: list[float] = []

    for i in range(runs):
        with tempfile.TemporaryDirectory(prefix="agrafes-sidecar-persistent-bench-") as td:
            tmp = Path(td)
            db = tmp / "bench.db"
            txt = tmp / "fixture.txt"
            txt.write_text(
                "[1] Bonjour needle.\n[2] Encore needle.\n",
                encoding="utf-8",
                newline="\n",
            )

            proc = subprocess.Popen(
                [str(binary), "serve", "--db", str(db), "--host", "127.0.0.1", "--port", "0"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                startup_t0 = time.perf_counter()
                initial = _read_first_json_from_stream(proc.stdout)  # type: ignore[arg-type]
                port = initial.get("port")
                if not isinstance(port, int):
                    raise RuntimeError(f"persistent run {i + 1}: invalid startup payload: {initial}")
                token = _read_token_from_portfile(initial.get("portfile"))
                write_headers = {"X-Agrafes-Token": token} if token else {}
                base = f"http://127.0.0.1:{port}"

                while True:
                    code, payload = _http_json("GET", f"{base}/health")
                    if code == 200 and payload.get("ok") is True:
                        break
                    if time.perf_counter() - startup_t0 > 20.0:
                        raise TimeoutError(f"persistent run {i + 1}: health timeout")
                    time.sleep(0.05)
                ttr_samples.append((time.perf_counter() - startup_t0) * 1000.0)

                code_i, payload_i = _http_json(
                    "POST",
                    f"{base}/import",
                    {
                        "mode": "txt_numbered_lines",
                        "path": str(txt),
                        "language": "fr",
                        "title": "Bench",
                    },
                    headers=write_headers,
                )
                if code_i != 200 or payload_i.get("ok") is not True:
                    raise RuntimeError(f"persistent run {i + 1}: import failed: {payload_i}")

                code_x, payload_x = _http_json("POST", f"{base}/index", {}, headers=write_headers)
                if code_x != 200 or payload_x.get("ok") is not True:
                    raise RuntimeError(f"persistent run {i + 1}: index failed: {payload_x}")

                for q_i in range(query_runs):
                    q_t0 = time.perf_counter()
                    code_q, payload_q = _http_json(
                        "POST",
                        f"{base}/query",
                        {"q": "needle", "mode": "segment"},
                    )
                    elapsed_ms = (time.perf_counter() - q_t0) * 1000.0
                    if code_q != 200 or payload_q.get("ok") is not True:
                        raise RuntimeError(
                            f"persistent run {i + 1} query {q_i + 1}: query failed: {payload_q}"
                        )
                    query_samples.append(elapsed_ms)

                _http_json("POST", f"{base}/shutdown", {}, headers=write_headers)
                proc.wait(timeout=10.0)
                stderr_text = proc.stderr.read() if proc.stderr else ""
                disallowed = _filter_disallowed_stderr(stderr_text)
                if disallowed:
                    raise RuntimeError(
                        f"persistent run {i + 1}: disallowed stderr lines: {disallowed!r}\n"
                        f"raw_stderr={stderr_text!r}"
                    )
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5.0)

    return {
        "time_to_ready_ms": _stats(ttr_samples),
        "query_latency_ms": _stats(query_samples),
        "query_runs_total": len(query_samples),
    }


def _stats(samples_ms: list[float]) -> dict[str, float]:
    return {
        "runs": float(len(samples_ms)),
        "min_ms": min(samples_ms),
        "max_ms": max(samples_ms),
        "mean_ms": statistics.mean(samples_ms),
        "median_ms": statistics.median(samples_ms),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark AGRAFES sidecar startup and latency.")
    parser.add_argument(
        "--binary",
        default=None,
        help="Explicit sidecar executable/artifact path. If set, --bin-dir entries are ignored.",
    )
    parser.add_argument(
        "--bin-dir",
        action="append",
        default=[],
        help="Directory used to discover sidecar-manifest.json (repeatable).",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=5,
        help="Number of launches per benchmark mode (default: 5).",
    )
    parser.add_argument(
        "--query-runs",
        type=int,
        default=10,
        help="Number of repeated /query calls per persistent run (default: 10).",
    )
    parser.add_argument(
        "--mode",
        choices=["help", "init-project", "persistent", "both"],
        default="both",
        help="Benchmark mode (default: both).",
    )
    parser.add_argument(
        "--results-dir",
        default=str(DEFAULT_RESULTS_DIR),
        help="Directory for auto-named JSON output (default: bench/results).",
    )
    parser.add_argument(
        "--out-json",
        default=None,
        help="Explicit output JSON file path (overrides auto naming).",
    )
    parser.add_argument(
        "--emit-target-json",
        action="store_true",
        default=True,
        help="Also write one JSON file per benchmark target (default: enabled).",
    )
    parser.add_argument(
        "--no-emit-target-json",
        dest="emit_target_json",
        action="store_false",
        help="Disable per-target JSON outputs.",
    )
    return parser.parse_args()


def _default_output_path(results_dir: Path, format_label: str) -> Path:
    date = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    os_label = _runtime_os_label()
    return results_dir / f"{date}_{format_label}_{os_label}.json"


def _target_output_path(results_dir: Path, record: dict[str, Any]) -> Path:
    date = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    os_label = str(record.get("os", _runtime_os_label()))
    arch = str(record.get("arch", _runtime_arch_label()))
    fmt = str(record.get("format", "unknown"))
    return results_dir / f"{date}_{os_label}_{arch}_{fmt}.json"


def _to_target_record(
    *,
    created_at: str,
    runs: int,
    query_runs: int,
    result: dict[str, Any],
) -> dict[str, Any]:
    target = result.get("target", {})
    if not isinstance(target, dict):
        target = {}
    target_triple = target.get("target_triple")
    target_triple_s = str(target_triple) if isinstance(target_triple, str) else None
    os_label, arch = _target_os_arch(target_triple_s)
    artifact_size_bytes = int(target.get("artifact_size_bytes", 0))
    persistent = result.get("persistent", {})
    if not isinstance(persistent, dict):
        persistent = {}
    ttr = persistent.get("time_to_ready_ms", {})
    qlat = persistent.get("query_latency_ms", {})
    ttr_mean = float(ttr.get("mean_ms")) if isinstance(ttr, dict) and "mean_ms" in ttr else None
    qlat_mean = float(qlat.get("mean_ms")) if isinstance(qlat, dict) and "mean_ms" in qlat else None

    return {
        "created_at": created_at,
        "runs": runs,
        "query_runs": query_runs,
        "mode": result.get("mode"),
        "os": os_label,
        "arch": arch,
        "target_triple": target_triple_s,
        "format": target.get("format"),
        "version": target.get("version"),
        "artifact_path": target.get("artifact_path"),
        "executable_path": target.get("executable_path"),
        "size_bytes": artifact_size_bytes,
        "size_mb": round(artifact_size_bytes / (1024 * 1024), 3),
        "time_to_ready_ms_mean": ttr_mean,
        "query_ms_mean": qlat_mean,
        "persistent": persistent if persistent else None,
    }


def main() -> int:
    args = parse_args()

    targets: list[dict[str, Any]] = []
    if args.binary:
        targets.append(_resolve_target(args.binary, DEFAULT_BIN_DIR))
    else:
        raw_dirs = args.bin_dir or [str(DEFAULT_BIN_DIR)]
        for raw in raw_dirs:
            d = Path(raw)
            if not d.is_absolute():
                d = REPO_ROOT / d
            targets.append(_resolve_target(None, d))

    results: list[dict[str, Any]] = []
    for target in targets:
        executable = Path(target["executable_path"])
        result: dict[str, Any] = {
            "target": target,
            "mode": args.mode,
        }
        if args.mode in ("help", "both"):
            result["help"] = _stats(bench_help(executable, args.runs))
        if args.mode in ("init-project", "both"):
            result["init_project"] = _stats(bench_init_project(executable, args.runs))
        if args.mode in ("persistent", "both"):
            result["persistent"] = bench_persistent(executable, args.runs, args.query_runs)
        results.append(result)

    created_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload: dict[str, Any] = {
        "created_at": created_at,
        "runs": args.runs,
        "query_runs": args.query_runs,
        "results": results,
    }

    if len(results) == 1:
        format_label = str(results[0]["target"].get("format", "unknown"))
    else:
        format_label = "compare"

    output = json.dumps(payload, ensure_ascii=False, indent=2)
    print(output)

    if args.out_json:
        out = Path(args.out_json)
        if not out.is_absolute():
            out = REPO_ROOT / out
    else:
        results_dir = Path(args.results_dir)
        if not results_dir.is_absolute():
            results_dir = REPO_ROOT / results_dir
        out = _default_output_path(results_dir, format_label)
    results_dir = out.parent

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(output + "\n", encoding="utf-8")

    if args.emit_target_json:
        for result in results:
            record = _to_target_record(
                created_at=created_at,
                runs=args.runs,
                query_runs=args.query_runs,
                result=result,
            )
            target_out = _target_output_path(results_dir, record)
            target_out.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
