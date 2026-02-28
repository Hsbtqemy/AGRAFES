"""Stable entrypoint used by PyInstaller to package the CLI sidecar binary."""

from multicorpus_engine.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
