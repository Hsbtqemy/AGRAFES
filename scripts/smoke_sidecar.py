"""Smoke-run the built sidecar binary (audit P0-1 / A-01 safety net).

CI *builds* the frozen PyInstaller sidecar but never *runs* it, so a service that
PyInstaller failed to bundle (or any startup regression) would only surface at
runtime in production. This script closes that gap: it starts the binary, waits
for /health, then hits one representative GET per extracted service layer, and
shuts it down. Add a new check below whenever a new service is extracted.

Usage:
    python scripts/smoke_sidecar.py <exe | out-dir | manifest.json>
    python scripts/smoke_sidecar.py --via-module x   # self-test the script via `python -m`
    python scripts/smoke_sidecar.py <exe> --dry-run  # print the serve command, don't run

Exit code 0 = the binary started and served every check; non-zero = failure
(with the binary's captured output for diagnosis).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# Les sondes ne passent JAMAIS par un proxy — et sans dépendre d'une variable
# d'environnement pour cela. Le proxy de l'université intercepte les requêtes loopback
# d'urllib (cause racine du 2026-07-09) ; l'ancien code posait bien `NO_PROXY`, mais dans
# l'environnement du SIDECAR, pas dans celui de ce processus-ci, où vivent les sondes.
# Il fallait donc exporter `NO_PROXY` à la main avant de lancer le script pour que son
# propre commentaire devienne vrai. Un opener dédié ferme la question.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# (path, expected key in the JSON body) — one public GET per extracted service.
CHECKS: list[tuple[str, str]] = [
    ("/conventions", "conventions"),       # conventions_service
    ("/doc_relations/all", "relations"),   # doc_relations_service
    ("/documents", "documents"),           # documents_service
    ("/curate/exceptions", "exceptions"),  # curate_service
    ("/units?doc_id=1", "units"),          # units_service
    ("/tokens?doc_id=1", "tokens"),        # tokens_service
    ("/models", "models"),                 # models_service (spaCy model catalog)
]


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def _get(url: str, timeout: float = 2.0) -> tuple[int, dict]:
    with _OPENER.open(url, timeout=timeout) as resp:  # noqa: S310 (loopback only)
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _terminate_tree(proc: subprocess.Popen) -> None:
    """Arrête le sidecar ET ses enfants.

    Un binaire PyInstaller **onefile** est DEUX processus : le bootloader, qui déballe le
    paquet, et l'interpréteur Python qu'il lance ensuite. ``proc.terminate()`` n'atteint
    que le bootloader — l'interpréteur survit, et il garde le port. Constaté le
    2026-08-24 : un sidecar de smoke encore à l'écoute une minute après que ce script eut
    imprimé PASSED, exactement la classe de fuite que décrit ``pilotage/T-05.md``.

    Windows n'a pas de groupe de processus utilisable ici : ``taskkill /T`` remonte l'arbre.
    Sous POSIX le sidecar est lancé dans sa propre session (``start_new_session``), ce qui
    donne un groupe à tuer d'un coup.
    """
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True, check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        # L'escalade doit rester à l'échelle de l'ARBRE : `proc.kill()` seul retomberait
        # dans le défaut que cette fonction corrige — le bootloader meurt, l'enfant reste.
        # (Sous Windows `taskkill /F` a déjà tué de force ; il n'y a rien à escalader.)
        if os.name != "nt":
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("WARN: le sidecar n'est pas mort — vérifier qu'aucun processus ne reste")


def _resolve_launch_prefix(launcher: str, via_module: bool) -> list[str]:
    """Return the argv prefix that launches the sidecar (before the `serve` verb).

    Accepts the out-dir, the manifest json, or the executable path. Handles both
    PyInstaller layouts: onefile (executable_path is the file) and onedir
    (executable_path is the bundle dir → use its inner exe, mirroring ci.yml).
    """
    if via_module:
        return [sys.executable, "-m", "multicorpus_engine.cli"]
    p = Path(launcher)
    if p.is_dir() and (p / "sidecar-manifest.json").exists():
        p = p / "sidecar-manifest.json"
    if p.suffix == ".json":
        exe = Path(json.loads(p.read_text(encoding="utf-8"))["executable_path"])
    else:
        exe = p
    if exe.is_dir():  # onedir bundle → inner executable
        inner = exe / exe.name
        if not inner.exists():
            inner = exe / "multicorpus"
        exe = inner
    return [str(exe)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Smoke-run the built sidecar binary.")
    ap.add_argument("launcher", help="sidecar executable, its out-dir, or sidecar-manifest.json")
    ap.add_argument("--via-module", action="store_true",
                    help="launch via `python -m multicorpus_engine.cli` (validates this script itself)")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds to wait for /health")
    ap.add_argument("--dry-run", action="store_true", help="print the serve command and exit")
    args = ap.parse_args()

    prefix = _resolve_launch_prefix(args.launcher, args.via_module)
    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="sidecar-smoke-")
    db = str(Path(tmp) / "smoke.db")
    cmd = prefix + ["serve", "--db", db, "--host", "127.0.0.1", "--port", str(port), "--token", "off"]

    if args.dry_run:
        print("DRY RUN:", " ".join(cmd))
        # `mkdtemp` a déjà eu lieu, plus haut, parce que la commande affichée porte le
        # chemin de la base. Sans cette ligne, un simple `--dry-run` laisse un dossier —
        # la quatrième manifestation de la même étourderie, et la seule qui échappe au
        # `finally` ci-dessous, puisqu'on sort avant d'y entrer.
        shutil.rmtree(tmp, ignore_errors=True)
        return 0

    base = f"http://127.0.0.1:{port}"
    # Pour le SIDECAR lui-même, si l'un de ses services sortait sur le réseau. Les sondes
    # de ce script, elles, ne dépendent plus de cette variable : cf. `_OPENER`.
    env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
    # POSIX : le sidecar prend sa propre session, donc son propre groupe de processus, pour
    # que `_terminate_tree` puisse tuer le groupe entier. Ignoré sous Windows, où c'est
    # `taskkill /T` qui remonte l'arbre.
    popen_kwargs: dict = {} if os.name == "nt" else {"start_new_session": True}
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True,
        **popen_kwargs,
    )
    try:
        deadline = time.monotonic() + args.timeout
        healthy = False
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read() if proc.stdout else ""
                print(f"FAIL: sidecar exited early (code {proc.returncode}):\n{out}")
                return 1
            try:
                code, body = _get(f"{base}/health", timeout=1.0)
                if code == 200 and body.get("ok") is True:
                    healthy = True
                    break
            except Exception:
                pass
            time.sleep(0.2)

        if not healthy:
            print(f"FAIL: /health not ready within {args.timeout}s")
            return 1
        print(f"OK: /health on {base}")

        for path, key in CHECKS:
            try:
                code, body = _get(f"{base}{path}")
            except Exception as exc:
                print(f"FAIL: GET {path} raised {exc!r}")
                return 1
            if code != 200 or key not in body:
                print(f"FAIL: GET {path} -> status={code}, body keys={list(body)}")
                return 1
            print(f"OK: GET {path}")

        print("Sidecar binary smoke PASSED")
        return 0
    finally:
        _terminate_tree(proc)
        # Le dossier temporaire aussi : 11 `sidecar-smoke-*` traînaient sous %TEMP% le
        # 2026-08-24, le plus ancien du 2 août. Un script de vérification qui laisse des
        # traces apprend à ne plus faire confiance à ce qu'on trouve sur la machine.
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
