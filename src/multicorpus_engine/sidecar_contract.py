"""Sidecar API contract definitions.

Contains:
- versioned contract metadata
- standardized error codes
- response payload helpers
- OpenAPI spec generator
"""

from __future__ import annotations

from typing import Any


API_VERSION = "1.1.0"
CONTRACT_VERSION = "1.1.0"  # semantic versioning for the sidecar API contract

# Error code catalog (stable machine-readable values).
ERR_BAD_REQUEST = "BAD_REQUEST"
ERR_NOT_FOUND = "NOT_FOUND"
ERR_VALIDATION = "VALIDATION_ERROR"
ERR_UNAUTHORIZED = "UNAUTHORIZED"
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
            "/doc_relations": {
                "get": {
                    "summary": "List doc_relations for a document",
                    "parameters": [{"name": "doc_id", "in": "query", "required": True, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "Relations"}, "400": {"description": "Bad request"}},
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
                            "enum": ["docx_numbered_lines", "txt_numbered_lines", "docx_paragraphs", "tei"],
                        },
                        "path": {"type": "string"},
                        "language": {"type": "string"},
                        "title": {"type": "string"},
                        "doc_role": {"type": "string"},
                        "resource_type": {"type": "string"},
                        "tei_unit": {"type": "string", "enum": ["p", "s"]},
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
                        "relation_type": {"type": "string", "default": "translation"},
                        "sim_threshold": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.8},
                        "debug_align": {"type": "boolean", "default": False},
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
                                "total_links_created": {"type": "integer"},
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
