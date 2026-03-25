"""Sidecar API contract definitions.

Contains:
- versioned contract metadata
- standardized error codes
- response payload helpers
- OpenAPI spec generator
"""

from __future__ import annotations

from typing import Any


API_VERSION = "1.6.4"
CONTRACT_VERSION = "1.6.4"  # semantic versioning for the sidecar API contract
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
            "/index": {
                "post": {
                    "summary": "Rebuild FTS index",
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
                    "summary": "Create a timestamped SQLite backup file (.db.bak)",
                    "security": [{"token": []}],
                    "requestBody": {"required": False, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupRequest"}}}},
                    "responses": {
                        "200": {"description": "Backup created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DbBackupResponse"}}}},
                        "400": {"description": "Bad request"},
                        "401": {"description": "Unauthorized"},
                        "404": {"description": "DB file not found"},
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
                        "resource_type": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "include_aligned": {"type": "boolean", "default": False},
                        "aligned_limit": {"type": "integer", "minimum": 1, "default": 20, "nullable": True},
                        "all_occurrences": {"type": "boolean", "default": False},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
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
                            },
                        },
                    ]
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
                            ],
                        },
                        "path": {"type": "string"},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "tei_unit": {"type": "string", "enum": ["p", "s"]},
                        "check_filename": {"type": "boolean"},
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
                        "author_lastname": {"type": "string", "nullable": True},
                        "author_firstname": {"type": "string", "nullable": True},
                        "doc_date": {"type": "string", "nullable": True},
                        "unit_count": {"type": "integer"},
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
                        "limit_examples": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
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
                        "out_dir": {"type": "string", "description": "Optional destination directory. Default: DB directory."},
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
