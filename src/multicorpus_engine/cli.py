"""CLI entrypoint — multicorpus.

Subcommands:
  init-project  Create a new SQLite DB with migrations applied.
  import        Import a document into the corpus.
  index         Rebuild/update the FTS5 index.
  query         Query the corpus (segment or KWIC mode, optional parallel view).
  align         Align documents by external_id, position, or similarity.
  export        Export a document (TEI) or query results (CSV/JSONL/HTML).
  validate-meta Validate document metadata.
  curate        Apply regex curation rules to text_norm.
  segment       Resegment a document's line units into sentence-level units.
  diagnostics   Collect DB diagnostics (integrity, FTS/runs/alignment health).
  db-optimize   Run SQLite maintenance operations (VACUUM / ANALYZE / PRAGMA optimize).
  runs-prune    Prune persisted run history rows (optional log directory cleanup).
  serve         Start the sidecar HTTP API server.
  status        Inspect sidecar state from DB-side portfile.
  shutdown      Stop a running sidecar discovered from DB portfile.

Each command outputs a JSON summary to stdout and writes a run log file.
Non-zero exit code on error, with {"error": "..."} JSON on stdout.
See docs/INTEGRATION_TAURI.md for the full JSON contract.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _configure_stdio_utf8() -> None:
    """Windows: stdout/stderr en UTF-8 pour éviter des octets CP1252 (Tauri shell décode en UTF-8 strict)."""
    if sys.platform != "win32":
        return
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError, AttributeError):
                pass


def _created_at() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ok(data: dict) -> None:
    payload = dict(data)
    payload.setdefault("status", "ok")
    # ensure_ascii=True : évite les octets CP1252 dans le pipe Tauri (UTF-8 strict côté Rust).
    print(json.dumps(payload, ensure_ascii=True, indent=2))
    sys.stdout.flush()


def _err(data: dict, code: int = 1) -> None:
    payload = dict(data)
    payload["status"] = "error"
    payload.setdefault("error", "Unknown error")
    payload.setdefault("created_at", _created_at())
    print(json.dumps(payload, ensure_ascii=True, indent=2))
    sys.stdout.flush()
    sys.exit(code)


class _JsonArgumentParser(argparse.ArgumentParser):
    """ArgumentParser that preserves CLI JSON contract on parse failures."""

    def error(self, message: str) -> None:  # type: ignore[override]
        _err({"error": f"Invalid arguments: {message}"}, code=1)


# ---------------------------------------------------------------------------
# init-project
# ---------------------------------------------------------------------------

def cmd_init_project(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso

    db_path = Path(args.db).resolve()
    if db_path.exists():
        _err({"error": f"DB already exists at {db_path}", "created_at": utcnow_iso()})

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection(db_path)
    n = apply_migrations(conn)

    run_id = create_run(conn, "init", {"db": str(db_path)})
    log, log_path = setup_run_logger(db_path, run_id)
    log.info("init-project completed: %d migrations applied", n)
    update_run_stats(conn, run_id, {"migrations_applied": n})

    _ok({
        "run_id": run_id,
        "status": "ok",
        "db": str(db_path),
        "migrations_applied": n,
        "log": str(log_path),
        "created_at": utcnow_iso(),
    })


# ---------------------------------------------------------------------------
# import
# ---------------------------------------------------------------------------

def cmd_import(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .importers.docx_numbered_lines import import_docx_numbered_lines

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    import_path = str(Path(args.path).resolve())
    params = {
        "mode": args.mode,
        "language": args.language,
        "path": import_path,
        "title": getattr(args, "title", None),
        "doc_role": getattr(args, "doc_role", "standalone"),
        "resource_type": getattr(args, "resource_type", None),
    }
    run_id = create_run(conn, "import", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        # Non-TEI modes require --language
        if args.mode != "tei" and not args.language:
            _err({
                "run_id": run_id,
                "error": "--language is required for this import mode",
                "created_at": utcnow_iso(),
            })

        if args.mode == "docx_numbered_lines":
            report = import_docx_numbered_lines(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "txt_numbered_lines":
            from .importers.txt import import_txt_numbered_lines
            report = import_txt_numbered_lines(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "docx_paragraphs":
            from .importers.docx_paragraphs import import_docx_paragraphs
            report = import_docx_paragraphs(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "odt_paragraphs":
            from .importers.odt_paragraphs import import_odt_paragraphs
            report = import_odt_paragraphs(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "odt_numbered_lines":
            from .importers.odt_numbered_lines import import_odt_numbered_lines
            report = import_odt_numbered_lines(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "tei":
            from .importers.tei_importer import import_tei
            report = import_tei(
                conn=conn,
                path=import_path,
                language=getattr(args, "language", None),
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                unit_element=getattr(args, "tei_unit", "p"),
                run_id=run_id,
                run_logger=log,
            )
        elif args.mode == "conllu":
            from .importers.conllu import import_conllu
            report = import_conllu(
                conn=conn,
                path=import_path,
                language=args.language,
                title=getattr(args, "title", None),
                doc_role=getattr(args, "doc_role", "standalone"),
                resource_type=getattr(args, "resource_type", None),
                run_id=run_id,
                run_logger=log,
            )
        else:
            _err({
                "run_id": run_id,
                "error": f"Unknown import mode: {args.mode!r}",
                "created_at": utcnow_iso(),
            })
            return

        stats = report.to_dict()
        update_run_stats(conn, run_id, stats)

        result: dict = {
            "run_id": run_id,
            "status": "ok",
            "mode": args.mode,
            "language": args.language,
            "log": str(log_path),
            "created_at": utcnow_iso(),
        }
        result.update(stats)
        _ok(result)

    except FileNotFoundError as exc:
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})
    except Exception as exc:
        log.error("Import failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# index
# ---------------------------------------------------------------------------

def cmd_index(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .indexer import build_index, update_index

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    incremental = bool(getattr(args, "incremental", False))
    run_id = create_run(conn, "index", {"db": str(db_path), "incremental": incremental})
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        if incremental:
            stats = update_index(conn, prune_deleted=True)
            count = int(stats["units_indexed"])
            update_run_stats(conn, run_id, stats)
            log.info("Incremental index complete: %s", stats)
        else:
            count = build_index(conn)
            stats = {"units_indexed": count}
            update_run_stats(conn, run_id, stats)
            log.info("Index complete: %d units indexed", count)

        payload = {
            "run_id": run_id,
            "status": "ok",
            "units_indexed": count,
            "incremental": incremental,
            "log": str(log_path),
            "created_at": utcnow_iso(),
        }
        if incremental:
            payload.update(
                {
                    "inserted": int(stats["inserted"]),
                    "refreshed": int(stats["refreshed"]),
                    "deleted": int(stats["deleted"]),
                }
            )
        _ok(payload)
    except Exception as exc:
        log.error("Index failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# query
# ---------------------------------------------------------------------------

def cmd_query(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .query import run_query

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    window = getattr(args, "window", 10)
    include_aligned = getattr(args, "include_aligned", False)
    all_occurrences = getattr(args, "all_occurrences", False)
    output_path = getattr(args, "output", None)
    output_fmt = getattr(args, "output_format", "jsonl")

    params = {
        "q": args.q,
        "mode": args.mode,
        "window": window,
        "language": getattr(args, "language", None),
        "doc_id": getattr(args, "doc_id", None),
        "resource_type": getattr(args, "resource_type", None),
        "doc_role": getattr(args, "doc_role", None),
        "include_aligned": include_aligned,
        "all_occurrences": all_occurrences,
    }
    run_id = create_run(conn, "query", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        hits = run_query(
            conn=conn,
            q=args.q,
            mode=args.mode,
            window=window,
            language=getattr(args, "language", None),
            doc_id=getattr(args, "doc_id", None),
            resource_type=getattr(args, "resource_type", None),
            doc_role=getattr(args, "doc_role", None),
            include_aligned=include_aligned,
            all_occurrences=all_occurrences,
        )
        update_run_stats(conn, run_id, {"count": len(hits)})
        log.info("Query %r returned %d hits", args.q, len(hits))

        result: dict = {
            "run_id": run_id,
            "status": "ok",
            "query": args.q,
            "mode": args.mode,
            "window": window if args.mode == "kwic" else None,
            "include_aligned": include_aligned,
            "all_occurrences": all_occurrences,
            "count": len(hits),
            "log": str(log_path),
            "created_at": utcnow_iso(),
        }

        if output_path:
            # Write results to file; omit hits array from JSON stdout
            out = Path(output_path)
            if output_fmt in ("csv", "tsv"):
                from .exporters.csv_export import export_csv
                written = export_csv(
                    hits=hits,
                    output_path=out,
                    mode=args.mode,
                    delimiter="\t" if output_fmt == "tsv" else ",",
                )
            elif output_fmt == "html":
                from .exporters.html_export import export_html
                written = export_html(
                    hits=hits,
                    output_path=out,
                    query=args.q,
                    mode=args.mode,
                    run_id=run_id,
                )
            else:  # jsonl (default)
                from .exporters.jsonl_export import export_jsonl
                written = export_jsonl(hits=hits, output_path=out)
            result["output"] = str(written)
            result["output_format"] = output_fmt
            log.info("Results written to %s (%s)", written, output_fmt)
        else:
            result["hits"] = hits

        _ok(result)
    except Exception as exc:
        log.error("Query failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# align
# ---------------------------------------------------------------------------

def cmd_align(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .aligner import (
        align_by_external_id,
        align_by_external_id_then_position,
        align_by_position,
        align_by_similarity,
        add_doc_relation,
    )

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    target_ids: list[int] = args.target_doc_id  # list, nargs="+"
    strategy = getattr(args, "strategy", "external_id")
    sim_threshold = getattr(args, "sim_threshold", 0.8)

    params = {
        "pivot_doc_id": args.pivot_doc_id,
        "target_doc_ids": target_ids,
        "relation_type": getattr(args, "relation_type", None),
        "strategy": strategy,
        "debug_align": bool(getattr(args, "debug_align", False)),
    }
    run_id = create_run(conn, "align", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        if strategy == "position":
            reports = align_by_position(
                conn=conn,
                pivot_doc_id=args.pivot_doc_id,
                target_doc_ids=target_ids,
                run_id=run_id,
                debug=bool(getattr(args, "debug_align", False)),
                run_logger=log,
            )
        elif strategy == "similarity":
            reports = align_by_similarity(
                conn=conn,
                pivot_doc_id=args.pivot_doc_id,
                target_doc_ids=target_ids,
                run_id=run_id,
                threshold=sim_threshold,
                debug=bool(getattr(args, "debug_align", False)),
                run_logger=log,
            )
        elif strategy == "external_id_then_position":
            reports = align_by_external_id_then_position(
                conn=conn,
                pivot_doc_id=args.pivot_doc_id,
                target_doc_ids=target_ids,
                run_id=run_id,
                debug=bool(getattr(args, "debug_align", False)),
                run_logger=log,
            )
        else:
            reports = align_by_external_id(
                conn=conn,
                pivot_doc_id=args.pivot_doc_id,
                target_doc_ids=target_ids,
                run_id=run_id,
                debug=bool(getattr(args, "debug_align", False)),
                run_logger=log,
            )

        # Optionally record doc_relations rows
        relation_type = getattr(args, "relation_type", None)
        if relation_type:
            for report in reports:
                add_doc_relation(
                    conn=conn,
                    doc_id=report.target_doc_id,
                    relation_type=relation_type,
                    target_doc_id=report.pivot_doc_id,
                )

        total_links = sum(r.links_created for r in reports)
        stats = {
            "total_links_created": total_links,
            "pairs": [r.to_dict() for r in reports],
        }
        update_run_stats(conn, run_id, stats)

        _ok({
            "run_id": run_id,
            "status": "ok",
            "strategy": strategy,
            "pivot_doc_id": args.pivot_doc_id,
            "target_doc_ids": target_ids,
            "total_links_created": total_links,
            "pairs": [r.to_dict() for r in reports],
            "log": str(log_path),
            "created_at": utcnow_iso(),
        })
    except Exception as exc:
        log.error("Align failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def cmd_export(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .exporters.tei import export_tei
    from .exporters.csv_export import export_csv
    from .exporters.jsonl_export import export_jsonl
    from .exporters.html_export import export_html

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    fmt = args.format
    output = Path(args.output).resolve()
    params = {"format": fmt, "output": str(output)}
    run_id = create_run(conn, "export", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        if fmt == "tei":
            if args.doc_id is None:
                _err({"run_id": run_id, "error": "--doc-id is required for TEI export", "created_at": utcnow_iso()})
            params["doc_id"] = args.doc_id
            result_path, tei_warnings = export_tei(
                conn=conn,
                doc_id=args.doc_id,
                output_path=output,
                include_structure=getattr(args, "include_structure", False),
            )
            log.info("TEI export: %s", result_path)
            if tei_warnings:
                for w in tei_warnings:
                    log.warning("TEI export warning: %s", w)
            update_run_stats(conn, run_id, {"doc_id": args.doc_id, "output": str(result_path), "warnings": tei_warnings})
            _ok({
                "run_id": run_id,
                "status": "ok",
                "format": fmt,
                "doc_id": args.doc_id,
                "output": str(result_path),
                "log": str(log_path),
                "created_at": utcnow_iso(),
            })

        elif fmt in ("csv", "tsv", "jsonl", "html"):
            # Query-based exports
            from .query import run_query
            q = getattr(args, "query", None)
            if not q:
                _err({"run_id": run_id, "error": "--query is required for result exports", "created_at": utcnow_iso()})

            mode = getattr(args, "mode", "segment")
            window = getattr(args, "window", 10)
            hits = run_query(
                conn=conn,
                q=q,
                mode=mode,
                window=window,
                language=getattr(args, "language", None),
                doc_id=getattr(args, "doc_id", None),
            )
            log.info("Query %r → %d hits for %s export", q, len(hits), fmt)

            if fmt in ("csv", "tsv"):
                result_path = export_csv(
                    hits=hits,
                    output_path=output,
                    mode=mode,
                    delimiter="\t" if fmt == "tsv" else ",",
                )
            elif fmt == "jsonl":
                result_path = export_jsonl(hits=hits, output_path=output)
            else:  # html
                result_path = export_html(
                    hits=hits,
                    output_path=output,
                    query=q,
                    mode=mode,
                    run_id=run_id,
                )

            update_run_stats(conn, run_id, {"count": len(hits), "output": str(result_path)})
            _ok({
                "run_id": run_id,
                "status": "ok",
                "format": fmt,
                "query": q,
                "count": len(hits),
                "output": str(result_path),
                "log": str(log_path),
                "created_at": utcnow_iso(),
            })
        else:
            _err({"run_id": run_id, "error": f"Unknown export format: {fmt!r}", "created_at": utcnow_iso()})

    except Exception as exc:
        log.error("Export failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# curate
# ---------------------------------------------------------------------------

def cmd_curate(args: argparse.Namespace) -> None:
    """Apply regex curation rules to text_norm of units in the DB.

    Rules are read from a JSON file (list of {pattern, replacement, flags?, description?}).
    After curation the FTS index is stale — caller should re-run 'index'.
    """
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .curation import rules_from_list, curate_document, curate_all_documents
    import json as _json

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    rules_path = Path(args.rules)
    if not rules_path.exists():
        _err({"error": f"Rules file not found: {rules_path}", "created_at": utcnow_iso()})

    try:
        raw_rules = _json.loads(rules_path.read_text(encoding="utf-8"))
    except Exception as exc:
        _err({"error": f"Failed to parse rules file: {exc}", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    params = {
        "rules": str(rules_path),
        "doc_id": getattr(args, "doc_id", None),
    }
    run_id = create_run(conn, "curate", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        rules = rules_from_list(raw_rules)
        log.info("Loaded %d curation rules from %s", len(rules), rules_path)

        if getattr(args, "doc_id", None) is not None:
            reports = [curate_document(conn, args.doc_id, rules, run_logger=log)]
        else:
            reports = curate_all_documents(conn, rules, run_logger=log)

        total_modified = sum(r.units_modified for r in reports)
        stats = {
            "docs_curated": len(reports),
            "units_modified": total_modified,
        }
        update_run_stats(conn, run_id, stats)

        _ok({
            "run_id": run_id,
            "status": "ok",
            "rules_loaded": len(rules),
            "docs_curated": len(reports),
            "units_modified": total_modified,
            "results": [r.to_dict() for r in reports],
            "fts_stale": total_modified > 0,
            "log": str(log_path),
            "created_at": utcnow_iso(),
        })
    except Exception as exc:
        log.error("Curate failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# validate-meta
# ---------------------------------------------------------------------------

def cmd_validate_meta(args: argparse.Namespace) -> None:
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .metadata import validate_document, validate_all_documents

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    run_id = create_run(conn, "validate-meta", {"doc_id": getattr(args, "doc_id", None)})
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        if getattr(args, "doc_id", None) is not None:
            results = [validate_document(conn, args.doc_id)]
        else:
            results = validate_all_documents(conn)

        has_errors = any(not r.is_valid for r in results)
        update_run_stats(conn, run_id, {
            "docs_validated": len(results),
            "docs_with_errors": sum(1 for r in results if not r.is_valid),
        })

        _ok({
            "run_id": run_id,
            "status": "ok" if not has_errors else "warnings",
            "docs_validated": len(results),
            "results": [r.to_dict() for r in results],
            "log": str(log_path),
            "created_at": utcnow_iso(),
        })
    except Exception as exc:
        log.error("Validate-meta failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# qa-report
# ---------------------------------------------------------------------------

def cmd_qa_report(args: argparse.Namespace) -> None:
    """Generate a corpus QA report."""
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .qa_report import write_qa_report
    from .runs import utcnow_iso

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    report = write_qa_report(
        conn=conn,
        output_path=Path(args.out),
        fmt=args.fmt,
        doc_ids=args.doc_ids,
        policy=getattr(args, "policy", "lenient"),
    )
    _ok({
        "status": "ok",
        "gate_status": report["gates"]["status"],
        "policy_used": report.get("policy_used", "lenient"),
        "blocking": report["gates"]["blocking"],
        "warnings": report["gates"]["warnings"],
        "summary": report["summary"],
        "out": args.out,
        "format": args.fmt,
        "created_at": utcnow_iso(),
    })


# ---------------------------------------------------------------------------
# validate-tei
# ---------------------------------------------------------------------------

def cmd_validate_tei(args: argparse.Namespace) -> None:
    """Validate a TEI XML file or publication package ZIP for xml:id referential integrity."""
    from .utils.tei_validate import validate_tei_ids, validate_tei_package, summarize_tei_validation
    from .runs import utcnow_iso
    import json as _json

    if getattr(args, "path", None):
        path = Path(args.path)
        if not path.exists():
            _err({"error": f"File not found: {path}", "created_at": utcnow_iso()})
        errors = validate_tei_ids(path)
        summary = summarize_tei_validation(errors)
        _ok({
            "status": "ok" if not errors else "errors",
            "path": str(path),
            "error_count": len(errors),
            "summary": summary,
            "errors": errors,
            "created_at": utcnow_iso(),
        })
    else:
        zip_path = Path(args.zip_path)
        if not zip_path.exists():
            _err({"error": f"ZIP not found: {zip_path}", "created_at": utcnow_iso()})
        results = validate_tei_package(zip_path)
        total_errors = sum(len(v) for v in results.values())
        by_file_summary = {name: summarize_tei_validation(errs) for name, errs in results.items()}
        combined = summarize_tei_validation([e for errs in results.values() for e in errs])
        _ok({
            "status": "ok" if total_errors == 0 else "errors",
            "zip_path": str(zip_path),
            "files_checked": len(results),
            "total_errors": total_errors,
            "summary": combined,
            "by_file_summary": by_file_summary,
            "results": results,
            "created_at": utcnow_iso(),
        })


# ---------------------------------------------------------------------------
# segment
# ---------------------------------------------------------------------------

def cmd_segment(args: argparse.Namespace) -> None:
    """Resegment a document's line units into sentence-level units.

    Replaces existing line units with sentence-segmented units.
    Stale alignment_links are deleted automatically.
    FTS index is stale after — re-run 'index'.
    """
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .segmenter import resegment_document

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}. Run init-project first.", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)

    params = {
        "doc_id": args.doc_id,
        "lang": getattr(args, "lang", "und"),
        "pack": getattr(args, "pack", "auto"),
    }
    run_id = create_run(conn, "segment", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        report = resegment_document(
            conn=conn,
            doc_id=args.doc_id,
            lang=getattr(args, "lang", "und"),
            pack=getattr(args, "pack", "auto"),
            run_logger=log,
        )
        stats = report.to_dict()
        update_run_stats(conn, run_id, stats)
        log.info(
            "Segment doc_id=%d: %d → %d units",
            args.doc_id, report.units_input, report.units_output,
        )
        _ok({
            "run_id": run_id,
            "status": "ok",
            "fts_stale": True,
            "log": str(log_path),
            "created_at": utcnow_iso(),
            **stats,
        })
    except Exception as exc:
        log.error("Segment failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# serve
# ---------------------------------------------------------------------------

def cmd_serve(args: argparse.Namespace) -> None:
    """Start the sidecar HTTP API server (or report already-running state)."""
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso
    from .sidecar import CorpusServer, inspect_sidecar_state, resolve_token_mode

    db_path = Path(args.db)
    host = getattr(args, "host", "127.0.0.1")
    _ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}
    if host not in _ALLOWED_HOSTS:
        raise SystemExit(
            f"Error: --host must be a loopback address (got {host!r}). "
            f"Allowed values: {', '.join(sorted(_ALLOWED_HOSTS))}"
        )
    port = getattr(args, "port", 8765)
    token_mode = getattr(args, "token", "auto")

    conn = get_connection(db_path)
    apply_migrations(conn)

    run_id = create_run(conn, "serve", {"host": host, "port": port, "token": token_mode})
    log, log_path = setup_run_logger(db_path, run_id)

    server = None
    try:
        state = inspect_sidecar_state(db_path)
        if state.get("state") == "running":
            update_run_stats(conn, run_id, {
                "status": "already_running",
                "host": state.get("host"),
                "port": state.get("port"),
                "pid": state.get("pid"),
                "started_at": state.get("started_at"),
                "portfile": state.get("portfile"),
                "token_required": bool(state.get("token_required", False)),
            })
            log.info(
                "Sidecar already running for db=%s at %s:%s",
                db_path,
                state.get("host"),
                state.get("port"),
            )
            _ok({
                "run_id": run_id,
                "status": "already_running",
                "host": state.get("host"),
                "port": state.get("port"),
                "pid": state.get("pid"),
                "started_at": state.get("started_at"),
                "portfile": state.get("portfile"),
                "token_required": bool(state.get("token_required", False)),
                "token": state.get("token"),
                "log": str(log_path),
                "created_at": utcnow_iso(),
            })
            return

        if state.get("state") == "stale":
            stale_portfile = Path(str(state.get("portfile")))
            if stale_portfile.exists():
                try:
                    stale_portfile.unlink()
                except FileNotFoundError:
                    # Race: another process removed the stale file between
                    # exists() and unlink(). This is harmless.
                    pass
            log.info(
                "Removed stale sidecar portfile: %s (reason=%s)",
                stale_portfile,
                state.get("reason"),
            )

        token = resolve_token_mode(token_mode)
        server = CorpusServer(db_path=db_path, host=host, port=port, token=token)
        server.start()
        update_run_stats(conn, run_id, {
            "status": "listening",
            "host": host,
            "port": server.actual_port,
            "pid": server.pid,
            "started_at": server.started_at,
            "portfile": str(server.portfile_path),
            "token_required": bool(server.token),
        })
        log.info("Sidecar listening on %s:%d", host, server.actual_port)
        _ok({
            "run_id": run_id,
            "status": "listening",
            "host": host,
            "port": server.actual_port,
            "pid": server.pid,
            "started_at": server.started_at,
            "portfile": str(server.portfile_path),
            "token_required": bool(server.token),
            "token": server.token,
            "log": str(log_path),
            "created_at": utcnow_iso(),
        })
        server.join()
    except KeyboardInterrupt:
        log.info("Sidecar shutdown requested")
        if server is not None:
            server.shutdown()
    except Exception as exc:
        log.error("Serve failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})
    finally:
        if server is not None:
            server.shutdown()
        conn.close()


def cmd_status(args: argparse.Namespace) -> None:
    """Inspect sidecar lifecycle state for a DB (running/stale/missing)."""
    from .runs import utcnow_iso
    from .sidecar import inspect_sidecar_state

    db_path = Path(args.db)
    state = inspect_sidecar_state(db_path)
    _ok({
        "status": "ok",
        "state": state.get("state"),
        "host": state.get("host"),
        "port": state.get("port"),
        "pid": state.get("pid"),
        "started_at": state.get("started_at"),
        "portfile": state.get("portfile"),
        "token_required": bool(state.get("token_required", False)),
        "reason": state.get("reason"),
        "pid_alive": state.get("pid_alive"),
        "health_ok": state.get("health_ok"),
        "created_at": utcnow_iso(),
    })


def cmd_shutdown(args: argparse.Namespace) -> None:
    """Shutdown a running sidecar process discovered via DB-side portfile."""
    import urllib.error
    import urllib.request

    from .sidecar import inspect_sidecar_state
    from .runs import utcnow_iso

    db_path = Path(args.db)
    state = inspect_sidecar_state(db_path)
    if state.get("state") == "missing":
        _err({
            "error": f"Sidecar portfile not found: {state.get('portfile')}",
            "state": "missing",
            "created_at": utcnow_iso(),
        })

    if state.get("state") == "stale":
        _err({
            "error": "Sidecar is not running (stale portfile detected)",
            "state": "stale",
            "portfile": state.get("portfile"),
            "reason": state.get("reason"),
            "created_at": utcnow_iso(),
        })

    host = state.get("host", "127.0.0.1")
    port = state.get("port")
    if not isinstance(port, int):
        _err({
            "error": f"Invalid sidecar port in state: {port!r}",
            "created_at": utcnow_iso(),
        })

    headers = {"Content-Type": "application/json; charset=utf-8"}
    token = state.get("token")
    if isinstance(token, str) and token:
        headers["X-Agrafes-Token"] = token

    url = f"http://{host}:{port}/shutdown"
    payload = b"{}"
    req = urllib.request.Request(
        url,
        method="POST",
        data=payload,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            body = resp.read().decode("utf-8")
            reply = json.loads(body)
            _ok({
                "status": "ok",
                "host": host,
                "port": port,
                "portfile": state.get("portfile"),
                "reply": reply,
                "created_at": utcnow_iso(),
            })
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        _err({
            "error": f"Shutdown HTTP error {exc.code}",
            "host": host,
            "port": port,
            "response": body,
            "created_at": utcnow_iso(),
        })
    except Exception as exc:
        _err({
            "error": str(exc),
            "host": host,
            "port": port,
            "created_at": utcnow_iso(),
        })


def _as_utc_iso(value: str) -> str:
    """Parse an ISO-ish date/datetime and return canonical UTC Z string."""
    text = (value or "").strip()
    if not text:
        raise ValueError("empty timestamp")
    if len(text) == 10 and text.count("-") == 2:
        text = f"{text}T00:00:00+00:00"
    elif text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def cmd_diagnostics(args: argparse.Namespace) -> None:
    """Collect operational diagnostics for a corpus DB."""
    from .db.connection import get_connection
    from .db.diagnostics import collect_diagnostics
    from .db.migrations import apply_migrations
    from .runs import utcnow_iso

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}", "created_at": utcnow_iso()})

    conn = get_connection(db_path)
    apply_migrations(conn)
    report = collect_diagnostics(conn)
    report["created_at"] = utcnow_iso()

    if getattr(args, "compact", False):
        print(json.dumps(report, ensure_ascii=True))
    else:
        print(json.dumps(report, ensure_ascii=True, indent=2))
    sys.stdout.flush()

    if bool(getattr(args, "strict", False)) and report.get("status") != "ok":
        sys.exit(1)


def cmd_db_optimize(args: argparse.Namespace) -> None:
    """Run SQLite maintenance operations on a corpus DB."""
    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}", "created_at": utcnow_iso()})

    run_vacuum = bool(getattr(args, "vacuum", False))
    run_analyze = bool(getattr(args, "analyze", False))
    run_optimize = bool(getattr(args, "optimize", False))
    if not any((run_vacuum, run_analyze, run_optimize)):
        run_vacuum = True
        run_analyze = True
        run_optimize = True

    conn = get_connection(db_path)
    apply_migrations(conn)
    params = {
        "vacuum": run_vacuum,
        "analyze": run_analyze,
        "optimize": run_optimize,
    }
    run_id = create_run(conn, "maintenance", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        before_size = db_path.stat().st_size if db_path.exists() else None
        operations: list[str] = []
        optimize_result: list[str] = []

        if run_vacuum:
            log.info("Running VACUUM")
            conn.execute("VACUUM")
            operations.append("vacuum")

        if run_analyze:
            log.info("Running ANALYZE")
            conn.execute("ANALYZE")
            operations.append("analyze")

        if run_optimize:
            log.info("Running PRAGMA optimize")
            rows = conn.execute("PRAGMA optimize").fetchall()
            optimize_result = [str(row[0]) for row in rows] if rows else []
            operations.append("optimize")

        conn.commit()
        after_size = db_path.stat().st_size if db_path.exists() else None

        stats = {
            "operations": operations,
            "size_before_bytes": before_size,
            "size_after_bytes": after_size,
            "optimize_result": optimize_result,
        }
        update_run_stats(conn, run_id, stats)
        _ok(
            {
                "run_id": run_id,
                "status": "ok",
                "operations": operations,
                "size_before_bytes": before_size,
                "size_after_bytes": after_size,
                "optimize_result": optimize_result,
                "log": str(log_path),
                "created_at": utcnow_iso(),
            }
        )
    except Exception as exc:
        log.error("db-optimize failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


def cmd_runs_prune(args: argparse.Namespace) -> None:
    """Prune old rows from runs table, optionally removing run log directories."""
    import shutil

    from .db.connection import get_connection
    from .db.migrations import apply_migrations
    from .runs import create_run, setup_run_logger, update_run_stats, utcnow_iso

    db_path = Path(args.db)
    if not db_path.exists():
        _err({"error": f"DB not found: {db_path}", "created_at": utcnow_iso()})

    before_raw = getattr(args, "before", None)
    older_days = getattr(args, "older_than_days", None)
    if before_raw:
        try:
            cutoff_iso = _as_utc_iso(before_raw)
        except Exception:
            _err(
                {"error": f"Invalid --before timestamp: {before_raw!r}", "created_at": utcnow_iso()}
            )
            return
    elif older_days is not None:
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=int(older_days))
        cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        _err(
            {
                "error": "Provide --before <ISO> or --older-than-days <N>.",
                "created_at": utcnow_iso(),
            }
        )
        return

    kinds = list(getattr(args, "kind", []) or [])
    dry_run = bool(getattr(args, "dry_run", False))
    delete_logs = bool(getattr(args, "delete_logs", False))

    conn = get_connection(db_path)
    apply_migrations(conn)
    params = {
        "cutoff_iso": cutoff_iso,
        "kinds": kinds,
        "dry_run": dry_run,
        "delete_logs": delete_logs,
    }
    run_id = create_run(conn, "maintenance", params)
    log, log_path = setup_run_logger(db_path, run_id)

    try:
        where = ["created_at < ?"]
        sql_params: list[object] = [cutoff_iso]
        if kinds:
            where.append(f"kind IN ({','.join('?' for _ in kinds)})")
            sql_params.extend(kinds)
        where.append("run_id != ?")
        sql_params.append(run_id)

        rows = conn.execute(
            f"SELECT run_id, kind, created_at FROM runs WHERE {' AND '.join(where)} ORDER BY created_at ASC",
            tuple(sql_params),
        ).fetchall()
        candidate_ids = [str(row["run_id"]) for row in rows]
        candidate_log_dirs = [str((db_path.parent / "runs" / rid).resolve()) for rid in candidate_ids]

        deleted_runs = 0
        deleted_logs = 0
        if not dry_run and candidate_ids:
            conn.executemany("DELETE FROM runs WHERE run_id = ?", [(rid,) for rid in candidate_ids])
            conn.commit()
            deleted_runs = len(candidate_ids)
            if delete_logs:
                for rid in candidate_ids:
                    run_dir = db_path.parent / "runs" / rid
                    if run_dir.exists():
                        shutil.rmtree(run_dir, ignore_errors=True)
                        deleted_logs += 1

        stats = {
            "cutoff_iso": cutoff_iso,
            "kinds": kinds,
            "dry_run": dry_run,
            "candidates": len(candidate_ids),
            "deleted_runs": deleted_runs,
            "deleted_log_dirs": deleted_logs,
        }
        update_run_stats(conn, run_id, stats)

        _ok(
            {
                "run_id": run_id,
                "status": "ok",
                "cutoff_iso": cutoff_iso,
                "kinds": kinds,
                "dry_run": dry_run,
                "candidates": len(candidate_ids),
                "deleted_runs": deleted_runs,
                "deleted_log_dirs": deleted_logs,
                "candidate_run_ids": candidate_ids,
                "candidate_log_dirs": candidate_log_dirs,
                "log": str(log_path),
                "created_at": utcnow_iso(),
            }
        )
    except Exception as exc:
        log.error("runs-prune failed: %s\n%s", exc, traceback.format_exc())
        _err({"run_id": run_id, "error": str(exc), "created_at": utcnow_iso()})


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = _JsonArgumentParser(
        prog="multicorpus",
        description="multicorpus_engine — multilingual corpus explorer (Tauri-ready CLI)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # init-project
    p_init = sub.add_parser("init-project", help="Create a new corpus DB")
    p_init.add_argument("--db", required=True, help="Path to SQLite DB file")
    p_init.set_defaults(func=cmd_init_project)

    # import
    p_import = sub.add_parser("import", help="Import a document into the corpus")
    p_import.add_argument("--db", required=True)
    p_import.add_argument(
        "--mode",
        required=True,
        choices=[
            "docx_numbered_lines",
            "txt_numbered_lines",
            "docx_paragraphs",
            "odt_paragraphs",
            "odt_numbered_lines",
            "tei",
            "conllu",
        ],
        help="Import mode",
    )
    p_import.add_argument("--language", default=None, help="ISO language code (fr, en, ...). TEI: inferred from xml:lang if omitted.")
    p_import.add_argument("--path", required=True, help="Path to source file")
    p_import.add_argument("--title", help="Document title (defaults to filename or teiHeader title)")
    p_import.add_argument(
        "--doc-role",
        dest="doc_role",
        default="standalone",
        choices=["original", "translation", "excerpt", "standalone", "unknown"],
    )
    p_import.add_argument("--resource-type", dest="resource_type", default=None)
    p_import.add_argument(
        "--tei-unit",
        dest="tei_unit",
        default="p",
        choices=["p", "s"],
        help="TEI unit element: 'p' (paragraphs, default) or 's' (sentences)",
    )
    p_import.set_defaults(func=cmd_import)

    # index
    p_index = sub.add_parser("index", help="Rebuild/update the FTS5 index")
    p_index.add_argument("--db", required=True)
    p_index.add_argument(
        "--incremental",
        action="store_true",
        help="Run incremental FTS synchronization instead of full rebuild.",
    )
    p_index.set_defaults(func=cmd_index)

    # query
    p_query = sub.add_parser("query", help="Query the corpus")
    p_query.add_argument("--db", required=True)
    p_query.add_argument("--q", required=True, help="Query string (FTS5 syntax)")
    p_query.add_argument(
        "--mode",
        default="segment",
        choices=["segment", "kwic"],
        help="Output mode (default: segment)",
    )
    p_query.add_argument("--window", type=int, default=10, help="KWIC context window (default: 10)")
    p_query.add_argument("--language", default=None)
    p_query.add_argument("--doc-id", dest="doc_id", type=int, default=None)
    p_query.add_argument("--resource-type", dest="resource_type", default=None)
    p_query.add_argument("--doc-role", dest="doc_role", default=None)
    p_query.add_argument(
        "--include-aligned",
        dest="include_aligned",
        action="store_true",
        default=False,
        help="Attach aligned units from other docs to each hit (requires prior align run)",
    )
    p_query.add_argument(
        "--all-occurrences",
        dest="all_occurrences",
        action="store_true",
        default=False,
        help="KWIC: return one hit per match occurrence instead of one per unit",
    )
    p_query.add_argument(
        "--output",
        dest="output",
        default=None,
        help="Write results to this file path (suppresses hits array in JSON stdout)",
    )
    p_query.add_argument(
        "--output-format",
        dest="output_format",
        default="jsonl",
        choices=["jsonl", "csv", "tsv", "html"],
        help="Output file format (default: jsonl). Used only when --output is given.",
    )
    p_query.set_defaults(func=cmd_query)

    # align
    p_align = sub.add_parser("align", help="Align documents by shared external_id")
    p_align.add_argument("--db", required=True)
    p_align.add_argument(
        "--pivot-doc-id",
        dest="pivot_doc_id",
        type=int,
        required=True,
        help="doc_id of the pivot (source) document",
    )
    p_align.add_argument(
        "--target-doc-id",
        dest="target_doc_id",
        type=int,
        nargs="+",
        required=True,
        help="doc_id(s) of target document(s) to align against",
    )
    p_align.add_argument(
        "--relation-type",
        dest="relation_type",
        choices=["translation_of", "excerpt_of"],
        default=None,
        help="If set, also create a doc_relations row of this type",
    )
    p_align.add_argument(
        "--strategy",
        dest="strategy",
        choices=["external_id", "position", "similarity", "external_id_then_position"],
        default="external_id",
        help=(
            "Alignment strategy: 'external_id' (default), 'position' (monotone),"
            " 'similarity' (edit-distance greedy), or"
            " 'external_id_then_position' (hybrid fallback)"
        ),
    )
    p_align.add_argument(
        "--sim-threshold",
        dest="sim_threshold",
        type=float,
        default=0.8,
        help="Minimum similarity score [0..1] for 'similarity' strategy (default: 0.8)",
    )
    p_align.add_argument(
        "--debug-align",
        dest="debug_align",
        action="store_true",
        default=False,
        help="Include optional per-strategy explainability payload in alignment reports",
    )
    p_align.set_defaults(func=cmd_align)

    # export
    p_export = sub.add_parser("export", help="Export a document (TEI) or query results (CSV/JSONL/HTML)")
    p_export.add_argument("--db", required=True)
    p_export.add_argument(
        "--format", required=True,
        choices=["tei", "csv", "tsv", "jsonl", "html"],
        help="Export format",
    )
    p_export.add_argument("--output", required=True, help="Output file path")
    p_export.add_argument("--doc-id", dest="doc_id", type=int, default=None,
                          help="Document to export (required for TEI)")
    p_export.add_argument("--query", default=None,
                          help="Query string for result exports (CSV/JSONL/HTML)")
    p_export.add_argument("--mode", default="segment", choices=["segment", "kwic"])
    p_export.add_argument("--window", type=int, default=10)
    p_export.add_argument("--language", default=None)
    p_export.add_argument(
        "--include-structure",
        dest="include_structure",
        action="store_true",
        default=False,
        help="Include structure units as <head> elements in TEI export",
    )
    p_export.set_defaults(func=cmd_export)

    # validate-meta
    p_val = sub.add_parser("validate-meta", help="Validate document metadata")
    p_val.add_argument("--db", required=True)
    p_val.add_argument("--doc-id", dest="doc_id", type=int, default=None,
                       help="Validate a single document (default: all)")
    p_val.set_defaults(func=cmd_validate_meta)

    # validate-tei
    p_vtei = sub.add_parser("validate-tei", help="Validate TEI XML file or publication package ZIP for xml:id integrity")
    p_vtei_group = p_vtei.add_mutually_exclusive_group(required=True)
    p_vtei_group.add_argument("--path", help="Path to a TEI .xml file")
    p_vtei_group.add_argument("--zip", dest="zip_path", help="Path to a publication package .zip")
    p_vtei.set_defaults(func=cmd_validate_tei)

    # qa-report
    p_qa = sub.add_parser("qa-report", help="Generate a corpus QA report (import integrity, alignment, metadata)")
    p_qa.add_argument("--db", required=True, help="Path to the corpus SQLite database")
    p_qa.add_argument("--out", required=True, dest="out", help="Output file path (.json or .html)")
    p_qa.add_argument("--format", dest="fmt", choices=["json", "html"], default="json",
                      help="Output format: json (default) or html")
    p_qa.add_argument("--doc-id", dest="doc_ids", type=int, nargs="*", default=None,
                      help="Restrict to specific doc_ids (default: all)")
    p_qa.add_argument("--policy", dest="policy", choices=["lenient", "strict"], default="lenient",
                      help="Gate policy: lenient (default) or strict")
    p_qa.set_defaults(func=cmd_qa_report)

    # curate
    p_curate = sub.add_parser(
        "curate",
        help="Apply regex curation rules to text_norm (re-run 'index' afterwards)",
    )
    p_curate.add_argument("--db", required=True)
    p_curate.add_argument(
        "--rules", required=True,
        help="Path to JSON file with curation rules [{pattern, replacement, flags?, description?}]",
    )
    p_curate.add_argument(
        "--doc-id", dest="doc_id", type=int, default=None,
        help="Curate a single document (default: all documents)",
    )
    p_curate.set_defaults(func=cmd_curate)

    # segment
    p_segment = sub.add_parser(
        "segment",
        help="Resegment a document's line units into sentence-level units",
    )
    p_segment.add_argument("--db", required=True)
    p_segment.add_argument(
        "--doc-id", dest="doc_id", type=int, required=True,
        help="Document to resegment",
    )
    p_segment.add_argument(
        "--lang", default="und",
        help="ISO language code for segmentation rules (default: und)",
    )
    p_segment.add_argument(
        "--pack",
        default="auto",
        help="Segmentation quality pack: auto|default|fr_strict|en_strict (default: auto)",
    )
    p_segment.set_defaults(func=cmd_segment)

    # diagnostics
    p_diag = sub.add_parser(
        "diagnostics",
        help="Collect DB diagnostics (integrity, FTS consistency, runs/alignment health)",
    )
    p_diag.add_argument("--db", required=True)
    p_diag.add_argument(
        "--strict",
        action="store_true",
        default=False,
        help="Exit with code 1 when diagnostics status is not 'ok'.",
    )
    p_diag.add_argument(
        "--compact",
        action="store_true",
        default=False,
        help="Output compact JSON instead of pretty JSON.",
    )
    p_diag.set_defaults(func=cmd_diagnostics)

    # db-optimize
    p_opt = sub.add_parser(
        "db-optimize",
        help="Run SQLite maintenance operations (VACUUM/ANALYZE/PRAGMA optimize)",
    )
    p_opt.add_argument("--db", required=True)
    p_opt.add_argument("--vacuum", action="store_true", default=False)
    p_opt.add_argument("--analyze", action="store_true", default=False)
    p_opt.add_argument("--optimize", action="store_true", default=False)
    p_opt.set_defaults(func=cmd_db_optimize)

    # runs-prune
    p_prune = sub.add_parser(
        "runs-prune",
        help="Prune run history rows older than a cutoff (optional log cleanup)",
    )
    p_prune.add_argument("--db", required=True)
    cutoff = p_prune.add_mutually_exclusive_group(required=True)
    cutoff.add_argument(
        "--before",
        default=None,
        help="Delete runs with created_at older than this ISO timestamp/date (UTC assumed if no TZ).",
    )
    cutoff.add_argument(
        "--older-than-days",
        dest="older_than_days",
        type=int,
        default=None,
        help="Delete runs older than N days.",
    )
    p_prune.add_argument(
        "--kind",
        action="append",
        default=[],
        help="Restrict prune to one or more run kinds (repeatable).",
    )
    p_prune.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="List candidates without deleting anything.",
    )
    p_prune.add_argument(
        "--delete-logs",
        action="store_true",
        default=False,
        help="Also remove DB-side run log directories for deleted run_ids.",
    )
    p_prune.set_defaults(func=cmd_runs_prune)

    # serve
    p_serve = sub.add_parser(
        "serve",
        help="Start the sidecar HTTP API server (blocks until Ctrl-C)",
    )
    p_serve.add_argument("--db", required=True)
    p_serve.add_argument(
        "--host", default="127.0.0.1",
        help="Bind address (default: 127.0.0.1)",
    )
    p_serve.add_argument(
        "--port", type=int, default=8765,
        help="Port to listen on (default: 8765; use 0 for OS-assigned)",
    )
    p_serve.add_argument(
        "--token",
        default="auto",
        help="Local auth token mode: auto|off|<token> (default: auto)",
    )
    p_serve.set_defaults(func=cmd_serve)

    # status
    p_status = sub.add_parser(
        "status",
        help="Inspect running sidecar state via DB-side portfile",
    )
    p_status.add_argument("--db", required=True)
    p_status.set_defaults(func=cmd_status)

    # shutdown
    p_shutdown = sub.add_parser(
        "shutdown",
        help="Shutdown running sidecar discovered via DB-side portfile",
    )
    p_shutdown.add_argument("--db", required=True)
    p_shutdown.set_defaults(func=cmd_shutdown)

    return parser


def main() -> None:
    _configure_stdio_utf8()
    parser = build_parser()
    try:
        args = parser.parse_args()
        args.func(args)
    except SystemExit:
        raise
    except Exception as exc:
        _err({"error": str(exc)}, code=1)


if __name__ == "__main__":
    main()
