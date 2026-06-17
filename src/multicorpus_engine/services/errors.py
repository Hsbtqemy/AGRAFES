"""Service-layer error types (audit P0-1, A-03).

Services raise these instead of touching HTTP. The sidecar adapter maps each to
the frozen wire error code + status, so responses stay byte-identical:
    ValidationError -> ERR_VALIDATION (400)
    NotFoundError   -> ERR_NOT_FOUND  (404)
Keeping the contract codes in the adapter (not here) avoids coupling the service
layer to the HTTP contract module.
"""

from __future__ import annotations

from typing import Any, Optional


class ServiceError(Exception):
    """Base class for expected, caller-facing service failures."""

    http_status: int = 400

    def __init__(self, message: str, *, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.details = details


class ValidationError(ServiceError):
    """Invalid / missing input. Maps to ERR_VALIDATION / 400."""

    http_status = 400


class NotFoundError(ServiceError):
    """A referenced entity does not exist. Maps to ERR_NOT_FOUND / 404."""

    http_status = 404
