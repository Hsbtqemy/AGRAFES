"""Sidecar API contract definitions.

Contains:
- versioned contract metadata
- standardized error codes
- response payload helpers
- OpenAPI spec generator
"""

from __future__ import annotations

from typing import Any


API_VERSION = "1.6.23"
CONTRACT_VERSION = "1.6.27"  # semantic versioning for the sidecar API contract
# 1.4.0: added export_tei_package job kind (Sprint 4 — Publication ZIP)
# 1.4.1: ERR_CONFLICT (409) for duplicate run_id; token protection on /align, /curate, /segment
# 1.4.2: document workflow status fields on /documents and metadata update endpoints.
# 1.4.3: POST /db/backup endpoint (token-required DB backup to timestamped .db.bak).
# 1.4.4: add async job kind export_readable_text (TXT/DOCX readable exports).
# 1.4.5: /align supports replace_existing + preserve_accepted (global recalculation mode).
# 1.4.6: GET /documents/preview (mini excerpt endpoint for Prep Documents screen).
# 1.4.7: POST /documents/delete (cascade delete documents with all associated data).
# 1.4.8: GET/POST /corpus/info — corpus-level title, description, meta_json (metadata / qualification).
# 1.4.9: GET /corpus/audit — corpus health audit (missing fields, empty docs, duplicates by hash/filename/title).
# 1.5.0: DocumentRecord gains optional author_lastname, author_firstname, doc_date fields (migration 010).
# 1.5.1: GET /doc_relations/all — returns all relations in corpus for hierarchy view.
# 1.6.0: GET /families — list document families (parent+children) with completion stats.
# 1.6.1: POST /families/{id}/segment — segment whole family; POST /segment gains calibrate_to.
# 1.6.2: POST /families/{id}/align — align all parent↔child pairs in a family.
# 1.6.3: GET /corpus/audit gains `families` section
# 1.6.4: POST /export/tmx (paire ou famille entière), POST /export/bilingual (html|txt, preview_only). (orphans, unsegmented, unaligned, ratio warnings)
#         and optional query param ratio_threshold_pct (default 15).
# 1.6.5: POST /query gains optional family_id (expand to family doc_ids, force include_aligned)
#         and pivot_only (restrict to parent doc only). Response gains family_id, family_doc_ids, pivot_only.
# 1.6.6: Curation propagée — alignment_links gains source_changed_at (migration 011).
#         GET /families/{id}/curation_status — unités à revoir par enfant.
#         POST /align/link/acknowledge_source_change — acquitter le flag de changement.
#         AlignedUnit (in query hits) gains link_id + source_changed_at.
# 1.6.7: Import groupé — POST /import gains optional family_root_doc_id (integer).
#         When provided: creates translation_of relation after import and returns
#         relation_created (bool) + relation_id (int) in ImportResponse.
# 1.6.8: POST /segment/preview — in-memory segmentation (same engine, no DB writes).
# 1.6.9: POST /segment/detect_markers — detect [N] markers in units (read-only).
#         POST /segment/preview mode=markers — preview [N]-based segmentation.
#         POST /jobs/enqueue segment mode=markers — execute marker-based resegmentation.
# 1.6.10: POST /units/merge — merge two adjacent units into one.
#          POST /units/split — split one unit into two.
#         Takes { doc_id, lang?, pack?, limit?, calibrate_to? }, returns segments list + warnings.
# 1.6.11: POST /segment/preview accepts optional calibrate_to and returns
#         optional calibrate_ratio_pct, mirroring /segment ratio warnings.
# 1.6.12: POST /import supports mode=conllu (token rows persisted in `tokens` table).
# 1.6.13: POST /annotate async job endpoint + job kind `annotate`.
#         DocumentRecord gains token_count + annotation_status.
# 1.6.14: POST /token_query endpoint (minimal CQL token search, Sprint C backend).
# 1.6.15: /token_query supports advanced CQL clauses: [] wildcard, {m,n} quantifiers, `within s`.
# 1.6.16: POST /export/conllu endpoint (export token annotations as CoNLL-U).
# 1.6.17: POST /export/token_query_csv endpoint (export CQL hits to CSV/TSV).
# 1.6.18: POST /export/ske endpoint (Sketch Engine-style vertical export).
# 1.6.19: POST /index and async index jobs accept optional incremental mode;
#         incremental index responses include inserted/refreshed/deleted counters.
# 1.6.20: GET /tokens (list token rows for one document/unit);
#         POST /tokens/update (manual token-by-token annotation edits).
# 1.6.21: POST /query gains optional db_paths federation (multi-DB query in one request).
# 1.6.22: POST /token_stats — frequency distribution of a token attribute (lemma/upos/xpos/word/feats)
#         over all hits of a CQL query. No auth token required (read-only).
# 1.6.23: POST /token_query gains optional include_aligned (bool, default false).
#         When true, each hit gains an `aligned` list with partner units from alignment_links.
#         Query hits gain source_db_* provenance when federated; response gains federated metadata.
# 1.6.24: POST /token_collocates — collocation analysis for a CQL query.
#         Returns top-K collocates with PMI and log-likelihood (G²) scores, left/right freq split,
#         and corpus baseline frequency. No auth token required (read-only).
# 1.6.25: Convention/role system (migrations 013–015).
#         GET /conventions — list roles. POST /conventions — create. PUT /conventions/{name} — update.
#         POST /conventions/delete — delete (sets unit_role=NULL on assigned units).
#         POST /units/set_role — assign role to one unit. POST /units/bulk_set_role — batch assign.
#         POST /documents/set_text_start — set paratextual boundary (text_start_n).
# 1.6.26: GET /units?doc_id=N[&unit_type=] — list all units for a document with unit_role field.
# 1.6.27: POST /token_query gains optional include_context_segments (bool, default false).
#         When true, each hit gains prev_segment / next_segment with the adjacent units in the document.
#         Each hit also gains unit_n (position of the unit in the document).

# Error code catalog (stable machine-readable values).
ERR_BAD_REQUEST = "BAD_REQUEST"
ERR_NOT_FOUND = "NOT_FOUND"
ERR_VALIDATION = "VALIDATION_ERROR"
ERR_UNAUTHORIZED = "UNAUTHORIZED"
ERR_CONFLICT = "CONFLICT"
ERR_INTERNAL = "INTERNAL_ERROR"


def success_payload(data: dict[str, Any] | None = None, *, status: str = "ok") -> dict[str, Any]:
    """Build a successful sidecar response payload."""
    payload: dict[str, Any] = {
        "ok": True,
        "api_version": API_VERSION,
        "version": API_VERSION,
        "status": status,
    }
    if data:
        payload.update(data)
    return payload


def error_payload(
    message: str,
    *,
    code: str = ERR_INTERNAL,
    details: Any | None = None,
) -> dict[str, Any]:
    """Build a standardized sidecar error payload."""
    err_obj: dict[str, Any] = {
        "type": code,
        "message": message,
    }
    if details is not None:
        err_obj["details"] = details

    payload: dict[str, Any] = {
        "ok": False,
        "api_version": API_VERSION,
        "version": API_VERSION,
        "status": "error",
        "error": err_obj,
        "error_message": message,
        "error_code": code,
    }
    if details is not None:
        payload["error_details"] = details
    return payload


def openapi_spec() -> dict[str, Any]:
    """Return the stable OpenAPI spec for the sidecar HTTP API."""
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "multicorpus_engine sidecar API",
            "version": API_VERSION,
            "x-contract-version": CONTRACT_VERSION,
            "description": "Localhost HTTP API for persistent corpus operations (query/index/import/etc.).",
        },
        "servers": [{"url": "http://127.0.0.1:8765"}],
        "paths": {
            "/health": {
                "get": {
                    "summary": "Health check",
                    "responses": {
                        "200": {
                            "description": "Server is healthy",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/HealthResponse"},
                                }
                            },
                        }
                    },
                }
            },
            "/openapi.json": {
                "get": {
                    "summary": "OpenAPI contract",
                    "responses": {
                        "200": {
                            "description": "OpenAPI specification document",
                            "content": {
                                "application/json": {
                                    "schema": {"type": "object"},
                                }
                            },
                        }
                    },
                }
            },
            "/query": {
                "post": {
                    "summary": "Run query",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/QueryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Query result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/QueryResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_query": {
                "post": {
                    "summary": "Run token-level CQL query",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenQueryRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Token query result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenQueryResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_collocates": {
                "post": {
                    "summary": "Collocation analysis for a CQL query (PMI + log-likelihood)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenCollocatesRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Ranked collocates with association scores",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenCollocatesResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request (invalid CQL or parameters)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/token_stats": {
                "post": {
                    "summary": "Token attribute frequency distribution over CQL hits",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenStatsRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Frequency distribution result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenStatsResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request (invalid CQL or group_by)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/index": {
                "post": {
                    "summary": "Rebuild FTS index",
                    "requestBody": {
                        "required": False,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/IndexRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Index rebuilt",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/IndexResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/import": {
                "post": {
                    "summary": "Import a document into corpus DB",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ImportRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Import result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ImportResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/import/preview": {
                "post": {
                    "summary": "Read-only parse preview of a file (no DB write)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["path", "mode"],
                                    "properties": {
                                        "path": {"type": "string"},
                                        "mode": {"type": "string"},
                                        "limit": {"type": "integer", "default": 100},
                                    },
                                }
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": {"type": "boolean"},
                                            "mode": {"type": "string"},
                                            "conllu_stats": {
                                                "nullable": True,
                                                "type": "object",
                                                "properties": {
                                                    "sentences": {"type": "integer"},
                                                    "tokens": {"type": "integer"},
                                                    "skipped_ranges": {"type": "integer"},
                                                    "skipped_empty_nodes": {"type": "integer"},
                                                    "malformed_lines": {"type": "integer"},
                                                    "sample_rows": {"type": "array", "items": {"type": "object"}},
                                                },
                                            },
                                        },
                                    }
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "File not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/curate": {
                "post": {
                    "summary": "Apply curation rules",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CurateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Curation applied",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CurateResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/validate-meta": {
                "post": {
                    "summary": "Validate metadata",
                    "requestBody": {
                        "required": False,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ValidateMetaRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Validation report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ValidateMetaResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/annotate": {
                "post": {
                    "summary": "Enqueue automatic annotation job(s) with spaCy",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AnnotateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "202": {
                            "description": "Annotation job accepted",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/segment/preview": {
                "post": {
                    "summary": "Preview segmentation in-memory (no DB writes)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentPreviewRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result with segments list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentPreviewResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/detect_markers": {
                "post": {
                    "summary": "Detect [N] markers in existing units (read-only)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentDetectMarkersRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Marker detection report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentDetectMarkersResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/structure_sections": {
                "post": {
                    "summary": "Return structure section lists for two documents",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Ref and target section lists"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/structure_diff": {
                "post": {
                    "summary": "Compare structure units between two documents",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Structure diff with matched/missing/extra sections"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/propagate_preview": {
                "post": {
                    "summary": "Section-aware segmentation preview (no DB writes)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "reference_doc_id": {"type": "integer"},
                            "lang": {"type": "string"},
                            "pack": {"type": "string"},
                            "section_mapping": {"type": "array", "items": {"type": "array", "items": {"type": "integer"}}},
                        }, "required": ["doc_id", "reference_doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Propagated segmentation preview with per-section results"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/zone_lines": {
                "post": {
                    "summary": "Return raw line units in a zone bounded by n values",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "from_n": {"type": "integer"},
                            "to_n": {"type": "integer"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "List of line units in the zone"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/insert_structure_unit": {
                "post": {
                    "summary": "Insert a structure unit before a given n (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "before_n": {"type": "integer"},
                            "text": {"type": "string"},
                            "role": {"type": "string"},
                        }, "required": ["doc_id", "before_n", "text"]}}},
                    },
                    "responses": {
                        "200": {"description": "Inserted unit info"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment/apply_propagated": {
                "post": {
                    "summary": "Write pre-computed propagated segmentation to DB (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "units": {"type": "array", "items": {"type": "object", "properties": {
                                "type": {"type": "string", "enum": ["line", "structure"]},
                                "text": {"type": "string"},
                                "role": {"type": "string"},
                            }, "required": ["type", "text"]}},
                        }, "required": ["doc_id", "units"]}}},
                    },
                    "responses": {
                        "200": {"description": "Units written count"},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/merge": {
                "post": {
                    "summary": "Merge two adjacent units into one",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsMergeRequest"}}},
                    },
                    "responses": {
                        "200": {"description": "Merged unit info", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsMergeResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/split": {
                "post": {
                    "summary": "Split one unit into two",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsSplitRequest"}}},
                    },
                    "responses": {
                        "200": {"description": "Split result", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnitsSplitResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/set_role": {
                "post": {
                    "summary": "Assign a convention role to a unit (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"}, "unit_n": {"type": "integer"},
                            "role": {"type": "string", "description": "Role name, or null to clear"},
                        }, "required": ["doc_id", "unit_n"]}}},
                    },
                    "responses": {
                        "200": {"description": "Role assigned", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit or role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/bulk_set_role": {
                "post": {
                    "summary": "Assign a convention role to multiple units at once (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "unit_ns": {"type": "array", "items": {"type": "integer"}},
                            "role": {"type": "string", "description": "Role name, or null to clear"},
                        }, "required": ["doc_id", "unit_ns"]}}},
                    },
                    "responses": {
                        "200": {"description": "Roles assigned", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/units/update_text": {
                "post": {
                    "summary": "Update text_raw and/or text_norm for one unit (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "unit_id": {"type": "integer"},
                            "text_raw": {"type": "string", "description": "New raw text (if omitted, unchanged)"},
                            "text_norm": {"type": "string", "description": "New normalised text (if omitted, mirrored from text_raw)"},
                        }, "required": ["unit_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "Unit updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Unit not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/conventions": {
                "get": {
                    "summary": "List all convention roles defined for this corpus",
                    "responses": {
                        "200": {"description": "List of roles", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                    },
                },
                "post": {
                    "summary": "Create a new convention role (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "name": {"type": "string"}, "label": {"type": "string"},
                            "color": {"type": "string"}, "icon": {"type": "string"},
                            "sort_order": {"type": "integer"},
                        }, "required": ["name", "label"]}}},
                    },
                    "responses": {
                        "201": {"description": "Role created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "409": {"description": "Name already exists", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                },
            },
            "/conventions/{name}": {
                "put": {
                    "summary": "Update a convention role (token required)",
                    "parameters": [{"in": "path", "name": "name", "required": True, "schema": {"type": "string"}}],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "label": {"type": "string"}, "color": {"type": "string"},
                            "icon": {"type": "string"}, "sort_order": {"type": "integer"},
                        }}}},
                    },
                    "responses": {
                        "200": {"description": "Role updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "No fields to update", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/conventions/delete": {
                "post": {
                    "summary": "Delete a convention role; assigned units become NULL (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "name": {"type": "string"},
                        }, "required": ["name"]}}},
                    },
                    "responses": {
                        "200": {"description": "Role deleted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Role not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/documents/set_text_start": {
                "post": {
                    "summary": "Set the paratextual boundary (text_start_n) for a document (token required)",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "doc_id": {"type": "integer"},
                            "text_start_n": {"type": "integer", "nullable": True,
                                            "description": "1-based unit n where real text begins; null to clear"},
                        }, "required": ["doc_id"]}}},
                    },
                    "responses": {
                        "200": {"description": "text_start_n updated", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Document not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/segment": {
                "post": {
                    "summary": "Resegment document",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/SegmentRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Segmentation report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/SegmentResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/curate/preview": {
                "post": {
                    "summary": "Preview curation rules without writing to DB (dry-run)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CuratePreviewRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Preview result with stats and examples",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CuratePreviewResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/audit": {
                "post": {
                    "summary": "Paginated read-only audit of alignment links for a pivot/target pair",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignAuditRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment link audit page",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignAuditResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/align/quality": {
                "post": {
                    "summary": "Read-only alignment quality metrics for a pivot/target pair",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignQualityRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment quality report",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignQualityResponse"},
                                }
                            },
                        },
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "500": {"description": "Internal error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/documents": {
                "get": {
                    "summary": "List all documents in corpus",
                    "responses": {
                        "200": {
                            "description": "Document list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/DocumentsResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/documents/preview": {
                "get": {
                    "summary": "Get mini content preview for one document",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 20, "default": 6},
                            "description": "Maximum number of preview lines",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Document preview",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/DocumentPreviewResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Document not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/units": {
                "get": {
                    "summary": "List units for a document with their role",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "unit_type",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Optional unit type filter (e.g. 'line')",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Unit list",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": {"type": "boolean"},
                                            "doc_id": {"type": "integer"},
                                            "units": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "unit_id": {"type": "integer"},
                                                        "n": {"type": "integer"},
                                                        "text_norm": {"type": "string", "nullable": True},
                                                        "unit_type": {"type": "string"},
                                                        "unit_role": {"type": "string", "nullable": True},
                                                    },
                                                },
                                            },
                                            "count": {"type": "integer"},
                                        },
                                    }
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/tokens": {
                "get": {
                    "summary": "List token rows for a document (optionally one unit)",
                    "parameters": [
                        {
                            "name": "doc_id",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "integer"},
                            "description": "Document identifier",
                        },
                        {
                            "name": "unit_id",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer"},
                            "description": "Optional unit identifier to restrict token list",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 200},
                        },
                        {
                            "name": "offset",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 0, "default": 0},
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Token list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokensResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/tokens/update": {
                "post": {
                    "summary": "Update a token row (manual annotation edit)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/TokenUpdateRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Token updated",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/TokenUpdateResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Token row not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/align": {
                "post": {
                    "summary": "Align documents by external_id, position, or similarity",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/AlignRequest"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Alignment reports",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AlignResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/shutdown": {
                "post": {
                    "summary": "Gracefully stop sidecar process",
                    "responses": {
                        "200": {
                            "description": "Shutdown accepted",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ShutdownResponse"},
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized (missing/invalid token)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                        "500": {
                            "description": "Internal error",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/jobs": {
                "get": {
                    "summary": "List async jobs",
                    "responses": {
                        "200": {
                            "description": "Job list",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobsListResponse"},
                                }
                            },
                        },
                    },
                },
                "post": {
                    "summary": "Submit async job",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/JobSubmitRequest"},
                            }
                        },
                    },
                    "responses": {
                        "202": {
                            "description": "Accepted job",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                },
            },
            "/runs": {
                "get": {
                    "summary": "List persisted runs (SQLite runs: import, align, index, …)",
                    "parameters": [
                        {
                            "name": "kind",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Filter by run kind (e.g. align, import)",
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                            "description": "Maximum rows, newest first",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "Run history",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/RunsListResponse"},
                                }
                            },
                        },
                    },
                }
            },
            "/jobs/{job_id}": {
                "get": {
                    "summary": "Get async job status",
                    "parameters": [
                        {
                            "name": "job_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Job status",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/JobAcceptedResponse"},
                                }
                            },
                        },
                        "404": {
                            "description": "Job not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                }
                            },
                        },
                    },
                }
            },
            # ── V0.5 — Job enqueue + cancel ───────────────────────────────
            "/jobs/enqueue": {
                "post": {
                    "summary": "Enqueue an async job (token required; supports all kinds including import/align/exports)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobEnqueueRequest"}}}},
                    "responses": {
                        "202": {"description": "Job accepted", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobAcceptedResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            "/jobs/{job_id}/cancel": {
                "post": {
                    "summary": "Cancel a queued or running job (best-effort; idempotent)",
                    "security": [{"token": []}],
                    "parameters": [{"name": "job_id", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "responses": {
                        "200": {"description": "Job canceled", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobCancelResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                        "404": {"description": "Job not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
                    },
                }
            },
            # ── V0.4A — Metadata panel ────────────────────────────────────
            "/documents/update": {
                "post": {
                    "summary": "Update document metadata",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocumentUpdateRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            "/documents/bulk_update": {
                "post": {
                    "summary": "Bulk update document metadata",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocumentBulkUpdateRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/documents/delete": {
                "post": {
                    "summary": "Delete documents and all associated data (units, alignment links, relations)",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "required": ["doc_ids"],
                            "properties": {
                                "doc_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
                            },
                        }}},
                    },
                    "responses": {
                        "200": {"description": "Deleted", "content": {"application/json": {"schema": {
                            "type": "object", "properties": {
                                "ok": {"type": "boolean"},
                                "deleted": {"type": "integer"},
                                "doc_ids": {"type": "array", "items": {"type": "integer"}},
                            },
                        }}}},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            "/doc_relations": {
                "get": {
                    "summary": "List doc_relations for a document",
                    "parameters": [{"name": "doc_id", "in": "query", "required": True, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "Relations"}, "400": {"description": "Bad request"}},
                }
            },
            "/doc_relations/all": {
                "get": {
                    "summary": "All doc_relations in the corpus (for hierarchy view)",
                    "responses": {"200": {"description": "All relations"}},
                }
            },
            "/families": {
                "get": {
                    "summary": "List document families (parent + children + completion stats)",
                    "responses": {"200": {"description": "Families with stats"}},
                }
            },
            "/families/{family_root_id}/segment": {
                "post": {
                    "summary": "Segment all documents in a family (parent first, then children)",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "requestBody": {"required": False, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/FamilySegmentRequest"}}}},
                    "responses": {
                        "200": {"description": "Per-doc segmentation results"},
                        "400": {"description": "Bad request"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/families/{family_root_id}/align": {
                "post": {
                    "summary": "Align all parent↔child pairs in a family",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "requestBody": {"required": False, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/FamilyAlignRequest"}}}},
                    "responses": {
                        "200": {"description": "Per-pair alignment results"},
                        "400": {"description": "Bad request (unready children, bad strategy…)"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/families/{family_root_id}/curation_status": {
                "get": {
                    "summary": "List alignment links with source_changed_at set for a family",
                    "parameters": [{"name": "family_root_id", "in": "path", "required": True,
                                    "schema": {"type": "integer"}}],
                    "responses": {
                        "200": {"description": "Per-child list of pending curation reviews"},
                        "404": {"description": "Family root not found"},
                    },
                }
            },
            "/align/link/acknowledge_source_change": {
                "post": {
                    "summary": "Clear source_changed_at flag on alignment links (mark as reviewed)",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/AcknowledgeSourceChangeRequest"}}}},
                    "responses": {
                        "200": {"description": "Number of links acknowledged"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            "/doc_relations/set": {
                "post": {
                    "summary": "Upsert a doc_relation",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DocRelationSetRequest"}}}},
                    "responses": {"200": {"description": "Created or updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/doc_relations/delete": {
                "post": {
                    "summary": "Delete a doc_relation by id",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}}}}}},
                    "responses": {"200": {"description": "Deleted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            # ── V0.4B — Exports ───────────────────────────────────────────
            "/export/tmx": {
                "post": {
                    "summary": "Export aligned pairs to TMX 1.4 format (single pair or whole family)",
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/ExportTmxRequest"}}}},
                    "responses": {
                        "200": {"description": "TMX file path and TU count"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/export/bilingual": {
                "post": {
                    "summary": "Export interleaved bilingual text (HTML or TXT) or return inline preview",
                    "requestBody": {"required": True, "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/ExportBilingualRequest"}}}},
                    "responses": {
                        "200": {"description": "File path + pair_count, or preview payload"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/export/tei": {
                "post": {
                    "summary": "Export documents as TEI XML",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportTeiRequest"}}}},
                    "responses": {"200": {"description": "Files created"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/conllu": {
                "post": {
                    "summary": "Export token annotations as CoNLL-U",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportConlluRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/token_query_csv": {
                "post": {
                    "summary": "Export token_query hits to CSV/TSV",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportTokenQueryCsvRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/ske": {
                "post": {
                    "summary": "Export token annotations as Sketch Engine-style vertical file",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportSkeRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/align_csv": {
                "post": {
                    "summary": "Export alignment links as CSV/TSV",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportAlignCsvRequest"}}}},
                    "responses": {"200": {"description": "File written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/export/run_report": {
                "post": {
                    "summary": "Export run history as JSONL or HTML",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportRunReportRequest"}}}},
                    "responses": {"200": {"description": "Report written"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/db/backup": {
                "post": {
                    "summary": "Create a SQLite backup file (timestamped .db.bak or named via out_path)",
                    "security": [{"token": []}],
                    "requestBody": {"required": False, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupRequest"}}}},
                    "responses": {
                        "200": {"description": "Backup created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupResponse"}}}},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                        "404": {"description": "DB file not found"},
                        "409": {"description": "out_path already exists"},
                    },
                }
            },
            "/corpus/audit": {
                "get": {
                    "summary": "Corpus health audit: missing fields, empty documents, duplicates (hash/filename/title)",
                    "responses": {
                        "200": {
                            "description": "Audit result",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusAuditResponse"}}},
                        },
                    },
                },
            },
            "/corpus/info": {
                "get": {
                    "summary": "Read corpus-level metadata (title, description, flexible meta object)",
                    "responses": {
                        "200": {
                            "description": "Corpus info",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoResponse"}}},
                        },
                    },
                },
                "post": {
                    "summary": "Update corpus metadata (partial JSON body; token required when enabled)",
                    "security": [{"token": []}],
                    "requestBody": {
                        "required": False,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoPatchRequest"}}},
                    },
                    "responses": {
                        "200": {
                            "description": "Updated corpus info",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CorpusInfoResponse"}}},
                        },
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                },
            },
            # ── V0.4C — Align link editing ────────────────────────────────
            "/align/link/create": {
                "post": {
                    "summary": "Manually create an alignment link between two units",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkCreateRequest"}}}},
                    "responses": {"200": {"description": "Created"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}, "409": {"description": "Conflict — link already exists"}},
                }
            },
            "/align/link/update_status": {
                "post": {
                    "summary": "Update status of an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkUpdateStatusRequest"}}}},
                    "responses": {"200": {"description": "Updated"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            "/align/link/delete": {
                "post": {
                    "summary": "Delete an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkDeleteRequest"}}}},
                    "responses": {"200": {"description": "Deleted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}},
                }
            },
            "/align/link/retarget": {
                "post": {
                    "summary": "Change target unit of an alignment link",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinkRetargetRequest"}}}},
                    "responses": {"200": {"description": "Retargeted"}, "400": {"description": "Bad request"}, "401": {"description": "Unauthorized"}, "404": {"description": "Not found"}},
                }
            },
            # ── V1.3 — Batch align link operations ───────────────────────────
            "/align/links/batch_update": {
                "post": {
                    "summary": "Apply a batch of set_status/delete operations on alignment links",
                    "security": [{"token": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignLinksBatchUpdateRequest"}}}},
                    "responses": {
                        "200": {"description": "Batch result"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            # ── V1.4 — Retarget candidates (read-only) ───────────────────────
            "/align/retarget_candidates": {
                "post": {
                    "summary": "Suggest candidate target units for retargeting an alignment link",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/RetargetCandidatesRequest"}}}},
                    "responses": {
                        "200": {"description": "Pivot info + candidates list"},
                        "400": {"description": "Bad request"},
                        "404": {"description": "Not found"},
                    },
                }
            },
            # ── V1.5 — Collision resolver ─────────────────────────────────────
            "/align/collisions": {
                "post": {
                    "summary": "List pivot units with multiple alignment links to the same target doc (collisions)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AlignCollisionsRequest"}}}},
                    "responses": {
                        "200": {"description": "Paginated collision groups"},
                        "400": {"description": "Bad request"},
                    },
                }
            },
            "/align/collisions/resolve": {
                "post": {
                    "summary": "Batch-resolve collision links (keep/delete/reject/unreviewed) — token required",
                    "security": [{"ApiKeyAuth": []}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CollisionResolveRequest"}}}},
                    "responses": {
                        "200": {"description": "Batch result"},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
        },
        "components": {
            "schemas": {
                "BaseResponse": {
                    "type": "object",
                    "required": ["ok", "api_version", "version", "status"],
                    "properties": {
                        "ok": {"type": "boolean"},
                        "api_version": {"type": "string"},
                        "version": {"type": "string"},
                        "status": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
                "ErrorResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["error", "error_code"],
                            "properties": {
                                "error": {
                                    "type": "object",
                                    "required": ["type", "message"],
                                    "properties": {
                                        "type": {"type": "string"},
                                        "message": {"type": "string"},
                                        "details": {},
                                    },
                                },
                                "error_message": {"type": "string"},
                                "error_code": {"type": "string"},
                                "error_details": {},
                            },
                        },
                    ]
                },
                "HealthResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["version", "pid", "started_at"],
                            "properties": {
                                "pid": {"type": "integer"},
                                "started_at": {"type": "string"},
                                "host": {"type": "string"},
                                "port": {"type": "integer"},
                                "portfile": {"type": "string"},
                            },
                        },
                    ]
                },
                "QueryRequest": {
                    "type": "object",
                    "required": ["q"],
                    "properties": {
                        "q": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "segment"},
                        "window": {"type": "integer", "default": 10},
                        "language": {"type": "string"},
                        "doc_id": {"type": "integer"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "resource_type": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "db_paths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "nullable": True,
                            "description": "Optional absolute/relative database paths for federated multi-DB query.",
                        },
                        "include_aligned": {"type": "boolean", "default": False},
                        "aligned_limit": {"type": "integer", "minimum": 1, "default": 20, "nullable": True},
                        "all_occurrences": {"type": "boolean", "default": False},
                        "case_sensitive": {"type": "boolean", "default": False},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "family_id": {
                            "type": "integer",
                            "nullable": True,
                            "description": "When set, expands the query to all docs in the family (parent + children) and forces include_aligned=true.",
                        },
                        "pivot_only": {
                            "type": "boolean",
                            "default": False,
                            "description": "When family_id is set, restrict the search to the pivot (parent) document only.",
                        },
                    },
                    "additionalProperties": False,
                },
                "QueryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "run_id",
                                "count",
                                "hits",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                                "total",
                            ],
                            "properties": {
                                "run_id": {"type": "string"},
                                "count": {"type": "integer"},
                                "hits": {"type": "array", "items": {"type": "object"}},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                                "total": {"type": "integer", "nullable": True},
                                "family_id": {"type": "integer", "nullable": True},
                                "family_doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                                "pivot_only": {"type": "boolean", "nullable": True},
                                "federated": {"type": "boolean", "nullable": True},
                                "db_paths": {"type": "array", "items": {"type": "string"}, "nullable": True},
                                "db_count": {"type": "integer", "nullable": True},
                            },
                        },
                    ]
                },
                "TokenQueryRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "kwic"},
                        "window": {"type": "integer", "minimum": 0, "default": 10},
                        "language": {"type": "string"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "include_aligned": {
                            "type": "boolean",
                            "default": False,
                            "description": "When true, each hit gains an `aligned` list with partner units from alignment_links.",
                        },
                        "include_context_segments": {
                            "type": "boolean",
                            "default": False,
                            "description": "When true, each hit gains `prev_segment` and `next_segment` fields with the adjacent units in the document (null if none).",
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignedUnit": {
                    "type": "object",
                    "required": ["unit_id", "doc_id", "title", "language", "text_norm"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "text_norm": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "description": "accepted | rejected | null"},
                    },
                },
                "TokenQueryToken": {
                    "type": "object",
                    "required": ["token_id", "position"],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "position": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                    },
                },
                "TokenQueryHit": {
                    "type": "object",
                    "required": [
                        "doc_id",
                        "unit_id",
                        "external_id",
                        "language",
                        "title",
                        "sent_id",
                        "start_position",
                        "end_position",
                        "tokens",
                        "context_tokens",
                    ],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "text": {"type": "string"},
                        "text_norm": {"type": "string"},
                        "left": {"type": "string"},
                        "match": {"type": "string"},
                        "right": {"type": "string"},
                        "sent_id": {"type": "integer"},
                        "start_position": {"type": "integer"},
                        "end_position": {"type": "integer"},
                        "tokens": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/TokenQueryToken"},
                        },
                        "context_tokens": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/TokenQueryToken"},
                        },
                        "unit_n": {"type": "integer", "description": "Position (n) of the unit in the document."},
                        "aligned": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/AlignedUnit"},
                            "description": "Partner units from alignment_links (only present when include_aligned=true).",
                        },
                        "prev_segment": {
                            "nullable": True,
                            "description": "Segment immediately before the hit unit (only present when include_context_segments=true).",
                            "properties": {
                                "unit_id": {"type": "integer"},
                                "external_id": {"type": "integer", "nullable": True},
                                "text_norm": {"type": "string"},
                            },
                        },
                        "next_segment": {
                            "nullable": True,
                            "description": "Segment immediately after the hit unit (only present when include_context_segments=true).",
                            "properties": {
                                "unit_id": {"type": "integer"},
                                "external_id": {"type": "integer", "nullable": True},
                                "text_norm": {"type": "string"},
                            },
                        },
                    },
                },
                "TokenQueryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "run_id",
                                "count",
                                "hits",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                                "total",
                            ],
                            "properties": {
                                "run_id": {"type": "string"},
                                "count": {"type": "integer"},
                                "hits": {"type": "array", "items": {"$ref": "#/components/schemas/TokenQueryHit"}},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                                "total": {"type": "integer"},
                            },
                        },
                    ]
                },
                "TokenStatsRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string", "description": "CQL query string"},
                        "group_by": {
                            "type": "string",
                            "enum": ["lemma", "upos", "xpos", "word", "feats"],
                            "default": "lemma",
                        },
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "nullable": True,
                        },
                        "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200},
                    },
                    "additionalProperties": False,
                },
                "TokenStatsRow": {
                    "type": "object",
                    "required": ["value", "count", "pct"],
                    "properties": {
                        "value": {"type": "string"},
                        "count": {"type": "integer"},
                        "pct": {"type": "number"},
                    },
                },
                "TokenStatsResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["total_hits", "total_pivot_tokens", "group_by", "rows"],
                            "properties": {
                                "total_hits": {"type": "integer"},
                                "total_pivot_tokens": {"type": "integer"},
                                "group_by": {"type": "string"},
                                "rows": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/TokenStatsRow"},
                                },
                            },
                        },
                    ]
                },
                "TokenCollocatesRequest": {
                    "type": "object",
                    "required": ["cql"],
                    "properties": {
                        "cql": {"type": "string", "description": "CQL query string"},
                        "window": {"type": "integer", "default": 5, "minimum": 1, "maximum": 20},
                        "by": {
                            "type": "string",
                            "enum": ["lemma", "word", "upos", "xpos"],
                            "default": "lemma",
                        },
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "nullable": True,
                        },
                        "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200},
                        "min_freq": {"type": "integer", "default": 2, "minimum": 1},
                        "sort_by": {
                            "type": "string",
                            "enum": ["pmi", "ll", "freq"],
                            "default": "pmi",
                        },
                    },
                    "additionalProperties": False,
                },
                "TokenCollocateRow": {
                    "type": "object",
                    "required": ["value", "freq", "left_freq", "right_freq", "corpus_freq", "pmi", "ll"],
                    "properties": {
                        "value": {"type": "string"},
                        "freq": {"type": "integer"},
                        "left_freq": {"type": "integer"},
                        "right_freq": {"type": "integer"},
                        "corpus_freq": {"type": "integer"},
                        "pmi": {"type": "number"},
                        "ll": {"type": "number"},
                    },
                },
                "TokenCollocatesResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "total_hits", "total_window_tokens",
                                "corpus_size", "window", "by", "rows",
                            ],
                            "properties": {
                                "total_hits": {"type": "integer"},
                                "total_window_tokens": {"type": "integer"},
                                "corpus_size": {"type": "integer"},
                                "window": {"type": "integer"},
                                "by": {"type": "string"},
                                "rows": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/TokenCollocateRow"},
                                },
                            },
                        },
                    ]
                },
                "IndexResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "units_indexed"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "units_indexed": {"type": "integer"},
                                "incremental": {"type": "boolean"},
                                "inserted": {"type": "integer"},
                                "refreshed": {"type": "integer"},
                                "deleted": {"type": "integer"},
                            },
                        },
                    ]
                },
                "IndexRequest": {
                    "type": "object",
                    "properties": {
                        "incremental": {
                            "type": "boolean",
                            "description": (
                                "If true, runs incremental FTS sync (insert/refresh/prune) "
                                "instead of full rebuild."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
                "ImportRequest": {
                    "type": "object",
                    "required": ["mode", "path"],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "docx_numbered_lines",
                                "txt_numbered_lines",
                                "docx_paragraphs",
                                "odt_paragraphs",
                                "odt_numbered_lines",
                                "tei",
                                "conllu",
                            ],
                        },
                        "path": {"type": "string"},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "tei_unit": {"type": "string", "enum": ["p", "s"]},
                        "check_filename": {"type": "boolean"},
                        "family_root_doc_id": {
                            "type": "integer",
                            "nullable": True,
                            "description": (
                                "If provided, a 'translation_of' relation is created from the "
                                "newly imported document to this parent document id."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
                "ImportResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "mode", "doc_id"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "mode": {"type": "string"},
                                "doc_id": {"type": "integer"},
                                "relation_created": {
                                    "type": "boolean",
                                    "description": "True when a translation_of relation was inserted.",
                                },
                                "relation_id": {
                                    "type": "integer",
                                    "nullable": True,
                                    "description": "Id of the doc_relations row (new or pre-existing).",
                                },
                            },
                        },
                    ]
                },
                "CurateRequest": {
                    "type": "object",
                    "required": ["rules"],
                    "properties": {
                        "rules": {"type": "array", "items": {"type": "object"}},
                        "doc_id": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
                "CurateResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["docs_curated", "units_modified", "fts_stale", "results"],
                            "properties": {
                                "docs_curated": {"type": "integer"},
                                "units_modified": {"type": "integer"},
                                "fts_stale": {"type": "boolean"},
                                "results": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "ValidateMetaRequest": {
                    "type": "object",
                    "properties": {"doc_id": {"type": "integer"}},
                    "additionalProperties": False,
                },
                "ValidateMetaResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["docs_validated", "results"],
                            "properties": {
                                "docs_validated": {"type": "integer"},
                                "results": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "SegmentPreviewRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "mode": {
                            "type": "string",
                            "default": "sentences",
                            "enum": ["sentences", "markers"],
                            "description": "'sentences' = rule-based split; 'markers' = split on [N] markers",
                        },
                        "lang": {"type": "string", "default": "und"},
                        "pack": {
                            "type": "string",
                            "default": "auto",
                            "enum": ["auto", "default", "fr_strict", "en_strict"],
                        },
                        "limit": {
                            "type": "integer",
                            "default": 5000,
                            "minimum": 1,
                            "maximum": 5000,
                            "description": "Maximum number of segments returned.",
                        },
                        "calibrate_to": {
                            "type": "integer",
                            "nullable": True,
                            "description": "doc_id of reference document; adds a ratio warning if segment counts differ by > 15 %",
                        },
                    },
                    "additionalProperties": False,
                },
                "UnitsMergeRequest": {
                    "type": "object",
                    "required": ["doc_id", "n1", "n2"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "n1": {"type": "integer", "description": "n of the first (kept) unit"},
                        "n2": {"type": "integer", "description": "n of the second (deleted) unit; must be n1+1"},
                    },
                    "additionalProperties": False,
                },
                "UnitsMergeResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "merged_n", "deleted_n", "text"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "merged_n": {"type": "integer"},
                                "deleted_n": {"type": "integer"},
                                "text": {"type": "string"},
                            },
                        },
                    ]
                },
                "UnitsSplitRequest": {
                    "type": "object",
                    "required": ["doc_id", "unit_n", "text_a", "text_b"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "unit_n": {"type": "integer"},
                        "text_a": {"type": "string", "description": "Text for the first (existing) unit"},
                        "text_b": {"type": "string", "description": "Text for the new unit inserted at unit_n+1"},
                    },
                    "additionalProperties": False,
                },
                "UnitsSplitResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "unit_n", "new_unit_n", "text_a", "text_b"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "unit_n": {"type": "integer"},
                                "new_unit_n": {"type": "integer"},
                                "text_a": {"type": "string"},
                                "text_b": {"type": "string"},
                            },
                        },
                    ]
                },
                "SegmentDetectMarkersRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
                "SegmentDetectMarkersResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "detected", "total_units", "marked_units", "marker_ratio"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "detected": {"type": "boolean"},
                                "total_units": {"type": "integer"},
                                "marked_units": {"type": "integer"},
                                "marker_ratio": {"type": "number"},
                                "sample": {"type": "array", "items": {"type": "object"}},
                                "first_markers": {"type": "array", "items": {"type": "integer"}},
                            },
                        },
                    ]
                },
                "SegmentPreviewSegment": {
                    "type": "object",
                    "required": ["n", "text", "source_unit_n"],
                    "properties": {
                        "n": {"type": "integer"},
                        "text": {"type": "string"},
                        "source_unit_n": {"type": "integer", "description": "n of the original unit this segment was produced from"},
                        "external_id": {"type": "integer", "nullable": True, "description": "Marker number if mode=markers"},
                    },
                },
                "SegmentPreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "mode", "units_input", "units_output", "segment_pack", "segments"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "mode": {"type": "string", "enum": ["sentences", "markers"]},
                                "units_input": {"type": "integer"},
                                "units_output": {"type": "integer"},
                                "segment_pack": {"type": "string"},
                                "segments": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/SegmentPreviewSegment"},
                                },
                                "warnings": {"type": "array", "items": {"type": "string"}},
                                "calibrate_to": {"type": "integer", "nullable": True},
                                "calibrate_ratio_pct": {"type": "integer", "nullable": True},
                            },
                        },
                    ]
                },
                "SegmentRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "lang": {"type": "string", "default": "und"},
                        "pack": {
                            "type": "string",
                            "default": "auto",
                            "enum": ["auto", "default", "fr_strict", "en_strict"],
                        },
                        "calibrate_to": {
                            "type": "integer",
                            "nullable": True,
                            "description": "doc_id of reference document; adds a ratio warning if segment counts differ by > 15 %",
                        },
                    },
                    "additionalProperties": False,
                },
                "FamilySegmentRequest": {
                    "type": "object",
                    "properties": {
                        "pack": {"type": "string", "default": "auto",
                                 "enum": ["auto", "default", "fr_strict", "en_strict"]},
                        "force": {"type": "boolean", "default": False,
                                  "description": "Re-segment even already-segmented documents"},
                        "lang_map": {"type": "object",
                                     "description": "Per-doc language override {doc_id: lang}",
                                     "additionalProperties": {"type": "string"}},
                    },
                    "additionalProperties": False,
                },
                "FamilySegmentDocResult": {
                    "type": "object",
                    "required": ["doc_id", "status", "units_input", "units_output", "warnings"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["segmented", "skipped", "error"]},
                        "units_input": {"type": "integer"},
                        "units_output": {"type": "integer"},
                        "segment_pack": {"type": "string", "nullable": True},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                        "calibrate_ratio_pct": {"type": "integer", "nullable": True},
                    },
                },
                "FamilyAlignRequest": {
                    "type": "object",
                    "properties": {
                        "strategy": {
                            "type": "string", "default": "position",
                            "enum": ["external_id", "position", "similarity", "external_id_then_position"],
                        },
                        "sim_threshold": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.8},
                        "replace_existing": {"type": "boolean", "default": False,
                                             "description": "Delete previous links before aligning"},
                        "preserve_accepted": {"type": "boolean", "default": True,
                                              "description": "Keep accepted links when replace_existing=true"},
                        "skip_unready": {"type": "boolean", "default": False,
                                         "description": "Skip pairs where child is not segmented (vs. error)"},
                    },
                    "additionalProperties": False,
                },
                "FamilyAlignPairResult": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id", "status", "links_created", "warnings"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "target_lang": {"type": "string"},
                        "relation_type": {"type": "string"},
                        "run_id": {"type": "string", "nullable": True},
                        "status": {"type": "string", "enum": ["aligned", "skipped", "conflict", "error"]},
                        "links_created": {"type": "integer"},
                        "deleted_before": {"type": "integer"},
                        "preserved_before": {"type": "integer"},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "ExportTmxRequest": {
                    "type": "object",
                    "properties": {
                        "pivot_doc_id":  {"type": "integer", "nullable": True,
                                          "description": "Required unless family_id is set"},
                        "target_doc_id": {"type": "integer", "nullable": True,
                                          "description": "Required for single-pair export"},
                        "family_id":     {"type": "integer", "nullable": True,
                                          "description": "Export all parent↔child pairs in one TMX"},
                        "out_path":      {"type": "string", "description": "Absolute path for the .tmx file"},
                        "out_dir":       {"type": "string", "description": "Directory; file named automatically"},
                    },
                    "additionalProperties": False,
                },
                "ExportBilingualRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id":   {"type": "integer"},
                        "target_doc_id":  {"type": "integer"},
                        "format":         {"type": "string", "enum": ["html", "txt"], "default": "html"},
                        "out_path":       {"type": "string", "description": "Required unless preview_only=true"},
                        "preview_only":   {"type": "boolean", "default": False,
                                           "description": "Return pairs as JSON without writing a file"},
                        "preview_limit":  {"type": "integer", "default": 20, "minimum": 1, "maximum": 200},
                    },
                    "additionalProperties": False,
                },
                "AcknowledgeSourceChangeRequest": {
                    "type": "object",
                    "properties": {
                        "link_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "description": "Explicit list of link_ids to acknowledge.",
                        },
                        "target_doc_id": {
                            "type": "integer",
                            "description": "Acknowledge all pending links for this target document (bulk).",
                        },
                    },
                    "additionalProperties": False,
                },
                "FamilyCurationStatusResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["family_root_id", "total_pending", "children"],
                            "properties": {
                                "family_root_id": {"type": "integer"},
                                "total_pending": {"type": "integer"},
                                "children": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "required": ["doc_id", "pending_count", "pending"],
                                        "properties": {
                                            "doc_id": {"type": "integer"},
                                            "title": {"type": "string", "nullable": True},
                                            "language": {"type": "string", "nullable": True},
                                            "pending_count": {"type": "integer"},
                                            "pending": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "link_id": {"type": "integer"},
                                                        "external_id": {"type": "integer"},
                                                        "pivot_unit_id": {"type": "integer"},
                                                        "pivot_text": {"type": "string"},
                                                        "target_unit_id": {"type": "integer"},
                                                        "target_text": {"type": "string"},
                                                        "source_changed_at": {"type": "string"},
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    ]
                },
                "SegmentResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["fts_stale", "doc_id", "units_input", "units_output", "segment_pack", "warnings"],
                            "properties": {
                                "fts_stale": {"type": "boolean"},
                                "doc_id": {"type": "integer"},
                                "units_input": {"type": "integer"},
                                "units_output": {"type": "integer"},
                                "segment_pack": {
                                    "type": "string",
                                    "enum": ["default", "fr_strict", "en_strict"],
                                },
                                "warnings": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    ]
                },
                "ShutdownResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["shutting_down"],
                            "properties": {
                                "shutting_down": {"type": "boolean"},
                                "message": {"type": "string"},
                            },
                        },
                    ]
                },
                "JobRecord": {
                    "type": "object",
                    "required": [
                        "job_id",
                        "kind",
                        "status",
                        "progress_pct",
                        "created_at",
                    ],
                    "properties": {
                        "job_id": {"type": "string"},
                        "kind": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["queued", "running", "done", "error"],
                        },
                        "progress_pct": {"type": "integer", "minimum": 0, "maximum": 100},
                        "progress_message": {"type": "string"},
                        "params": {"type": "object"},
                        "result": {"type": "object"},
                        "error": {"type": "string"},
                        "error_code": {"type": "string"},
                        "created_at": {"type": "string"},
                        "started_at": {"type": "string"},
                        "finished_at": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "JobSubmitRequest": {
                    "type": "object",
                    "required": ["kind"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["index", "curate", "validate-meta", "segment"],
                        },
                        "params": {"type": "object"},
                    },
                    "additionalProperties": False,
                },
                "JobAcceptedResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["job"],
                            "properties": {
                                "job": {"$ref": "#/components/schemas/JobRecord"},
                            },
                        },
                    ]
                },
                "JobsListResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["jobs"],
                            "properties": {
                                "jobs": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/JobRecord"},
                                },
                            },
                        },
                    ]
                },
                "RunRecord": {
                    "type": "object",
                    "required": ["run_id", "kind", "created_at"],
                    "properties": {
                        "run_id": {"type": "string"},
                        "kind": {"type": "string"},
                        "created_at": {"type": "string"},
                        "params": {"type": "object", "nullable": True},
                        "stats": {"type": "object", "nullable": True},
                    },
                },
                "RunsListResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["runs", "limit"],
                            "properties": {
                                "runs": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/RunRecord"},
                                },
                                "limit": {"type": "integer"},
                            },
                        },
                    ]
                },
                "AnnotateRequest": {
                    "type": "object",
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "all_docs": {"type": "boolean", "default": False},
                        "model": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "DocumentRecord": {
                    "type": "object",
                    "required": ["doc_id", "title", "language", "unit_count"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "doc_role": {"type": "string", "nullable": True},
                        "resource_type": {"type": "string", "nullable": True},
                        "workflow_status": {
                            "type": "string",
                            "enum": ["draft", "review", "validated"],
                            "default": "draft",
                        },
                        "validated_at": {"type": "string", "nullable": True},
                        "validated_run_id": {"type": "string", "nullable": True},
                        "source_path": {"type": "string", "nullable": True},
                        "source_hash": {"type": "string", "nullable": True},
                        "author_lastname": {"type": "string", "nullable": True},
                        "author_firstname": {"type": "string", "nullable": True},
                        "doc_date": {"type": "string", "nullable": True},
                        "unit_count": {"type": "integer"},
                        "token_count": {"type": "integer"},
                        "annotation_status": {
                            "type": "string",
                            "enum": ["missing", "annotated"],
                        },
                    },
                    "additionalProperties": False,
                },
                "DocumentsResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["documents", "count"],
                            "properties": {
                                "documents": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/DocumentRecord"},
                                },
                                "count": {"type": "integer"},
                            },
                        },
                    ]
                },
                "DocumentPreviewLine": {
                    "type": "object",
                    "required": ["unit_id", "n", "text"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "n": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "text": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "DocumentPreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc", "lines", "count", "total_lines", "limit"],
                            "properties": {
                                "doc": {"$ref": "#/components/schemas/DocumentRecord"},
                                "lines": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/DocumentPreviewLine"},
                                },
                                "count": {"type": "integer"},
                                "total_lines": {"type": "integer"},
                                "limit": {"type": "integer"},
                            },
                        },
                    ]
                },
                "TokenRecord": {
                    "type": "object",
                    "required": [
                        "token_id",
                        "doc_id",
                        "unit_id",
                        "unit_n",
                        "external_id",
                        "sent_id",
                        "position",
                    ],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "unit_id": {"type": "integer"},
                        "unit_n": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "sent_id": {"type": "integer"},
                        "position": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                        "misc": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "TokensResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "doc_id",
                                "tokens",
                                "count",
                                "total",
                                "limit",
                                "offset",
                                "next_offset",
                                "has_more",
                            ],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "unit_id": {"type": "integer", "nullable": True},
                                "tokens": {"type": "array", "items": {"$ref": "#/components/schemas/TokenRecord"}},
                                "count": {"type": "integer"},
                                "total": {"type": "integer"},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "has_more": {"type": "boolean"},
                            },
                        },
                    ]
                },
                "TokenUpdateRequest": {
                    "type": "object",
                    "required": ["token_id"],
                    "properties": {
                        "token_id": {"type": "integer"},
                        "word": {"type": "string", "nullable": True},
                        "lemma": {"type": "string", "nullable": True},
                        "upos": {"type": "string", "nullable": True},
                        "xpos": {"type": "string", "nullable": True},
                        "feats": {"type": "string", "nullable": True},
                        "misc": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "TokenUpdateResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["updated", "token"],
                            "properties": {
                                "updated": {"type": "integer"},
                                "token": {"$ref": "#/components/schemas/TokenRecord"},
                            },
                        },
                    ]
                },
                "AlignRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_ids"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 1,
                        },
                        "strategy": {
                            "type": "string",
                            "enum": ["external_id", "position", "similarity", "external_id_then_position"],
                            "default": "external_id",
                        },
                        "relation_type": {
                            "type": "string",
                            "default": "translation",
                            "description": (
                                "Stored in run params for traceability. "
                                "Not yet applied functionally to alignment_links — "
                                "tracked as known drift (ADR-009, v1.4.1)."
                            ),
                        },
                        "sim_threshold": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.8},
                        "debug_align": {"type": "boolean", "default": False},
                        "replace_existing": {
                            "type": "boolean",
                            "default": False,
                            "description": (
                                "If true, remove previous links for the pivot/target scope "
                                "before creating a new alignment run."
                            ),
                        },
                        "preserve_accepted": {
                            "type": "boolean",
                            "default": True,
                            "description": (
                                "When replace_existing=true, keep links with status='accepted' "
                                "and treat them as protected anchors."
                            ),
                        },
                        "run_id": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "AlignResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["run_id", "strategy", "pivot_doc_id", "reports"],
                            "properties": {
                                "run_id": {"type": "string"},
                                "strategy": {"type": "string"},
                                "pivot_doc_id": {"type": "integer"},
                                "debug_align": {"type": "boolean"},
                                "replace_existing": {"type": "boolean"},
                                "preserve_accepted": {"type": "boolean"},
                                "deleted_before": {"type": "integer"},
                                "preserved_before": {"type": "integer"},
                                "total_links_created": {"type": "integer"},
                                "total_effective_links": {"type": "integer"},
                                "reports": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "CuratePreviewRequest": {
                    "type": "object",
                    "required": ["doc_id", "rules"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "rules": {"type": "array", "items": {"type": "object"}},
                        "limit_examples": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 10},
                    },
                    "additionalProperties": False,
                },
                "CuratePreviewExample": {
                    "type": "object",
                    "required": ["unit_id", "before", "after"],
                    "properties": {
                        "unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "before": {"type": "string"},
                        "after": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "CuratePreviewResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["doc_id", "stats", "examples"],
                            "properties": {
                                "doc_id": {"type": "integer"},
                                "stats": {
                                    "type": "object",
                                    "required": ["units_total", "units_changed", "replacements_total"],
                                    "properties": {
                                        "units_total": {"type": "integer"},
                                        "units_changed": {"type": "integer"},
                                        "replacements_total": {"type": "integer"},
                                    },
                                },
                                "examples": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/CuratePreviewExample"},
                                },
                                "fts_stale": {"type": "boolean"},
                            },
                        },
                    ]
                },
                "AlignQualityRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "run_id": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "AlignQualityResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["pivot_doc_id", "target_doc_id", "stats"],
                            "properties": {
                                "pivot_doc_id": {"type": "integer"},
                                "target_doc_id": {"type": "integer"},
                                "run_id": {"type": "string", "nullable": True},
                                "stats": {
                                    "type": "object",
                                    "required": [
                                        "total_pivot_units", "total_target_units",
                                        "total_links", "covered_pivot_units", "covered_target_units",
                                        "coverage_pct", "orphan_pivot_count", "orphan_target_count",
                                        "collision_count", "status_counts",
                                    ],
                                    "properties": {
                                        "total_pivot_units": {"type": "integer"},
                                        "total_target_units": {"type": "integer"},
                                        "total_links": {"type": "integer"},
                                        "covered_pivot_units": {"type": "integer"},
                                        "covered_target_units": {"type": "integer"},
                                        "coverage_pct": {"type": "number"},
                                        "orphan_pivot_count": {"type": "integer"},
                                        "orphan_target_count": {"type": "integer"},
                                        "collision_count": {"type": "integer"},
                                        "status_counts": {
                                            "type": "object",
                                            "properties": {
                                                "unreviewed": {"type": "integer"},
                                                "accepted": {"type": "integer"},
                                                "rejected": {"type": "integer"},
                                            },
                                        },
                                    },
                                },
                                "sample_orphan_pivot": {"type": "array", "items": {"type": "object"}},
                                "sample_orphan_target": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "AlignAuditRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "external_id": {"type": "integer"},
                        "status": {
                            "type": "string",
                            "enum": ["accepted", "rejected", "unreviewed"],
                            "nullable": True,
                        },
                        "include_explain": {
                            "type": "boolean",
                            "default": False,
                            "description": "Attach explain object to each link (strategy + notes). Default false (no-op).",
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignLinkRecord": {
                    "type": "object",
                    "required": ["link_id", "pivot_unit_id", "target_unit_id", "pivot_text", "target_text"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "pivot_unit_id": {"type": "integer"},
                        "target_unit_id": {"type": "integer"},
                        "pivot_text": {"type": "string"},
                        "target_text": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "enum": ["accepted", "rejected"]},
                        "explain": {
                            "type": "object",
                            "nullable": True,
                            "description": "Present when include_explain=true.",
                            "properties": {
                                "strategy": {"type": "string"},
                                "notes": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                    "additionalProperties": False,
                },
                "AlignAuditResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": [
                                "pivot_doc_id", "target_doc_id",
                                "limit", "offset", "has_more", "next_offset", "stats", "links",
                            ],
                            "properties": {
                                "pivot_doc_id": {"type": "integer"},
                                "target_doc_id": {"type": "integer"},
                                "limit": {"type": "integer"},
                                "offset": {"type": "integer"},
                                "has_more": {"type": "boolean"},
                                "next_offset": {"type": "integer", "nullable": True},
                                "stats": {
                                    "type": "object",
                                    "properties": {
                                        "links_returned": {"type": "integer"},
                                    },
                                },
                                "links": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/AlignLinkRecord"},
                                },
                            },
                        },
                    ]
                },
                # ── V0.4A — Metadata ─────────────────────────────────────────
                "DocumentUpdateRequest": {
                    "type": "object",
                    "required": ["doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "title": {"type": "string"},
                        "language": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "workflow_status": {
                            "type": "string",
                            "enum": ["draft", "review", "validated"],
                        },
                        "validated_run_id": {"type": "string", "nullable": True},
                        "author_lastname": {"type": "string", "nullable": True},
                        "author_firstname": {"type": "string", "nullable": True},
                        "doc_date": {"type": "string", "nullable": True},
                    },
                },
                "DocumentBulkUpdateRequest": {
                    "type": "object",
                    "required": ["updates"],
                    "properties": {
                        "updates": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/DocumentUpdateRequest"},
                        },
                    },
                },
                "DocRelationRecord": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "doc_id": {"type": "integer"},
                        "relation_type": {"type": "string"},
                        "target_doc_id": {"type": "integer"},
                        "note": {"type": "string", "nullable": True},
                        "created_at": {"type": "string"},
                    },
                },
                "DocRelationSetRequest": {
                    "type": "object",
                    "required": ["doc_id", "relation_type", "target_doc_id"],
                    "properties": {
                        "doc_id": {"type": "integer"},
                        "relation_type": {"type": "string"},
                        "target_doc_id": {"type": "integer"},
                        "note": {"type": "string", "nullable": True},
                    },
                },
                # ── V0.4B — Exports ───────────────────────────────────────────
                "ExportTeiRequest": {
                    "type": "object",
                    "required": ["out_dir"],
                    "properties": {
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "out_dir": {"type": "string"},
                        "include_structure": {
                            "type": "boolean",
                            "default": False,
                            "description": "Emit <head> elements for structure units in addition to body units.",
                        },
                        "relation_type": {
                            "type": "string",
                            "enum": ["none", "translation_of", "excerpt_of", "all"],
                            "default": "none",
                            "description": "Relation filter for TEI listRelation (none disables relation export).",
                        },
                    },
                },
                "ExportConlluRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "out_path": {"type": "string"},
                    },
                },
                "ExportTokenQueryCsvRequest": {
                    "type": "object",
                    "required": ["out_path", "cql"],
                    "properties": {
                        "out_path": {"type": "string"},
                        "cql": {"type": "string"},
                        "mode": {"type": "string", "enum": ["segment", "kwic"], "default": "kwic"},
                        "window": {"type": "integer", "minimum": 0, "default": 10},
                        "language": {"type": "string", "nullable": True},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                        "delimiter": {"type": "string", "enum": [",", "\t"], "default": ","},
                        "max_hits": {"type": "integer", "minimum": 1, "maximum": 100000, "default": 10000},
                    },
                },
                "ExportSkeRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "out_path": {"type": "string"},
                        "doc_ids": {"type": "array", "items": {"type": "integer"}, "nullable": True},
                    },
                },
                "ExportAlignCsvRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer", "nullable": True},
                        "target_doc_id": {"type": "integer", "nullable": True},
                        "out_path": {"type": "string"},
                        "delimiter": {"type": "string", "default": ","},
                    },
                },
                "ExportRunReportRequest": {
                    "type": "object",
                    "required": ["out_path"],
                    "properties": {
                        "run_id": {"type": "string", "nullable": True},
                        "out_path": {"type": "string"},
                        "format": {"type": "string", "enum": ["jsonl", "html"], "default": "jsonl"},
                    },
                },
                "DbBackupRequest": {
                    "type": "object",
                    "properties": {
                        "out_dir": {"type": "string", "description": "Optional destination directory. Default: DB directory. Mutually exclusive with out_path."},
                        "out_path": {"type": "string", "description": "Exact destination file path (e.g. /path/to/corpus.db). Mutually exclusive with out_dir. Returns 409 if file exists."},
                    },
                    "additionalProperties": False,
                },
                "DbBackupResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["source_db_path", "backup_path", "file_size_bytes", "created_at"],
                            "properties": {
                                "source_db_path": {"type": "string"},
                                "backup_path": {"type": "string"},
                                "file_size_bytes": {"type": "integer"},
                                "created_at": {"type": "string"},
                            },
                        },
                    ],
                },
                "CorpusInfoRecord": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "nullable": True},
                        "description": {"type": "string", "nullable": True},
                        "meta": {"type": "object", "additionalProperties": True},
                        "updated_at": {"type": "string", "nullable": True},
                    },
                },
                "CorpusInfoPatchRequest": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "nullable": True},
                        "description": {"type": "string", "nullable": True},
                        "meta": {"type": "object", "nullable": True, "additionalProperties": True},
                    },
                    "additionalProperties": False,
                },
                "CorpusInfoResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["corpus"],
                            "properties": {
                                "corpus": {"$ref": "#/components/schemas/CorpusInfoRecord"},
                            },
                        },
                    ],
                },
                # ── V1.4.9 — Corpus audit ────────────────────────────────────
                "CorpusAuditResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["total_docs", "total_issues", "missing_fields",
                                         "empty_documents", "duplicate_hashes",
                                         "duplicate_filenames", "duplicate_titles", "families"],
                            "properties": {
                                "total_docs":   {"type": "integer"},
                                "total_issues": {"type": "integer"},
                                "missing_fields": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "doc_id":  {"type": "integer"},
                                            "title":   {"type": "string"},
                                            "missing": {"type": "array", "items": {"type": "string"}},
                                        },
                                    },
                                },
                                "empty_documents": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "doc_id": {"type": "integer"},
                                            "title":  {"type": "string"},
                                        },
                                    },
                                },
                                "duplicate_hashes": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "hash_prefix": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "duplicate_filenames": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "filename": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "duplicate_titles": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "title": {"type": "string"},
                                            "doc_ids": {"type": "array", "items": {"type": "integer"}},
                                        },
                                    },
                                },
                                "families": {
                                    "type": "object",
                                    "description": "Family-level audit checks (Sprint 4)",
                                    "properties": {
                                        "ratio_threshold_pct": {"type": "integer"},
                                        "total_family_issues": {"type": "integer"},
                                        "orphan_docs": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Children whose parent doc is absent from the corpus",
                                        },
                                        "unsegmented_children": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Children (or their parents) with 0 line units",
                                        },
                                        "unaligned_pairs": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Segmented pairs with no alignment links",
                                        },
                                        "ratio_warnings": {
                                            "type": "array",
                                            "items": {"type": "object"},
                                            "description": "Pairs where |child_segs - parent_segs| / parent_segs > threshold",
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
                # ── V0.4C — Align link editing ───────────────────────────────
                "AlignLinkUpdateStatusRequest": {
                    "type": "object",
                    "required": ["link_id", "status"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["accepted", "rejected"], "nullable": True},
                    },
                },
                "AlignLinkDeleteRequest": {
                    "type": "object",
                    "required": ["link_id"],
                    "properties": {
                        "link_id": {"type": "integer"},
                    },
                },
                "AlignLinkRetargetRequest": {
                    "type": "object",
                    "required": ["link_id", "new_target_unit_id"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "new_target_unit_id": {"type": "integer"},
                    },
                },
                # ── V1.3 — Batch align link operations ──────────────────────
                "AlignBatchAction": {
                    "type": "object",
                    "required": ["action", "link_id"],
                    "properties": {
                        "action": {"type": "string", "enum": ["set_status", "delete"]},
                        "link_id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["accepted", "rejected"], "nullable": True},
                    },
                },
                "AlignLinksBatchUpdateRequest": {
                    "type": "object",
                    "required": ["actions"],
                    "properties": {
                        "actions": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"$ref": "#/components/schemas/AlignBatchAction"},
                        },
                    },
                },
                # ── V1.4 — Retarget candidates ───────────────────────────────
                "RetargetCandidatesRequest": {
                    "type": "object",
                    "required": ["pivot_unit_id", "target_doc_id"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                        "window": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                    },
                },
                "RetargetCandidate": {
                    "type": "object",
                    "required": ["target_unit_id", "target_text", "score", "reason"],
                    "properties": {
                        "target_unit_id": {"type": "integer"},
                        "external_id": {"type": "integer", "nullable": True},
                        "target_text": {"type": "string"},
                        "score": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                },
                # ── V1.5 — Collision resolver ─────────────────────────────────
                "AlignCollisionsRequest": {
                    "type": "object",
                    "required": ["pivot_doc_id", "target_doc_id"],
                    "properties": {
                        "pivot_doc_id": {"type": "integer"},
                        "target_doc_id": {"type": "integer"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                    },
                },
                "CollisionLink": {
                    "type": "object",
                    "required": ["link_id", "target_unit_id", "target_text"],
                    "properties": {
                        "link_id": {"type": "integer"},
                        "target_unit_id": {"type": "integer"},
                        "target_external_id": {"type": "integer", "nullable": True},
                        "target_text": {"type": "string"},
                        "status": {"type": "string", "nullable": True, "enum": ["accepted", "rejected"]},
                    },
                },
                "CollisionGroup": {
                    "type": "object",
                    "required": ["pivot_unit_id", "pivot_text", "links"],
                    "properties": {
                        "pivot_unit_id": {"type": "integer"},
                        "pivot_external_id": {"type": "integer", "nullable": True},
                        "pivot_text": {"type": "string"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/CollisionLink"}},
                    },
                },
                "CollisionResolveAction": {
                    "type": "object",
                    "required": ["action", "link_id"],
                    "properties": {
                        "action": {"type": "string", "enum": ["keep", "delete", "reject", "unreviewed"]},
                        "link_id": {"type": "integer"},
                    },
                },
                "CollisionResolveRequest": {
                    "type": "object",
                    "required": ["actions"],
                    "properties": {
                        "actions": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/CollisionResolveAction"},
                            "minItems": 1,
                        },
                    },
                },
                # ── V0.5 — Job enqueue + cancel ──────────────────────────────
                "JobEnqueueRequest": {
                    "type": "object",
                    "required": ["kind"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": [
                                "index", "curate", "validate-meta", "segment",
                                "import", "align", "export_tei", "export_align_csv", "export_run_report",
                                "export_tei_package", "export_readable_text", "qa_report",
                                "annotate",
                            ],
                        },
                        "params": {"type": "object", "additionalProperties": True},
                    },
                },
                "JobCancelResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["job_id", "status"],
                            "properties": {
                                "job_id": {"type": "string"},
                                "status": {"type": "string"},
                            },
                        },
                    ]
                },
            }
        },
    }
