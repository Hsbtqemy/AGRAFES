"""Sidecar API contract definitions.

Contains:
- versioned contract metadata
- standardized error codes
- response payload helpers
- OpenAPI spec generator
"""

from __future__ import annotations

from typing import Any


API_VERSION = "1.0.0"

# Error code catalog (stable machine-readable values).
ERR_BAD_REQUEST = "BAD_REQUEST"
ERR_NOT_FOUND = "NOT_FOUND"
ERR_VALIDATION = "VALIDATION_ERROR"
ERR_INTERNAL = "INTERNAL_ERROR"


def success_payload(data: dict[str, Any] | None = None, *, status: str = "ok") -> dict[str, Any]:
    """Build a successful sidecar response payload."""
    payload: dict[str, Any] = {
        "api_version": API_VERSION,
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
    payload: dict[str, Any] = {
        "api_version": API_VERSION,
        "status": "error",
        "error": message,
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
            "description": "Localhost HTTP API for corpus query/index/curation/validation/segmentation.",
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
        },
        "components": {
            "schemas": {
                "BaseResponse": {
                    "type": "object",
                    "required": ["api_version", "status"],
                    "properties": {
                        "api_version": {"type": "string"},
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
                                "error": {"type": "string"},
                                "error_code": {"type": "string"},
                                "error_details": {},
                            },
                        },
                    ]
                },
                "HealthResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
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
                        "all_occurrences": {"type": "boolean", "default": False},
                    },
                    "additionalProperties": False,
                },
                "QueryResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["count", "hits"],
                            "properties": {
                                "count": {"type": "integer"},
                                "hits": {"type": "array", "items": {"type": "object"}},
                            },
                        },
                    ]
                },
                "IndexResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["units_indexed"],
                            "properties": {"units_indexed": {"type": "integer"}},
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
                    },
                    "additionalProperties": False,
                },
                "SegmentResponse": {
                    "allOf": [
                        {"$ref": "#/components/schemas/BaseResponse"},
                        {
                            "type": "object",
                            "required": ["fts_stale", "doc_id", "units_input", "units_output", "warnings"],
                            "properties": {
                                "fts_stale": {"type": "boolean"},
                                "doc_id": {"type": "integer"},
                                "units_input": {"type": "integer"},
                                "units_output": {"type": "integer"},
                                "warnings": {"type": "array", "items": {"type": "string"}},
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
            }
        },
    }
