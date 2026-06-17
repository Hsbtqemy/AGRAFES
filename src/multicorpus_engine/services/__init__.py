"""Service layer for the engine (audit P0-1).

Domain logic extracted out of the HTTP sidecar so it is testable without a
running server. Services take a ``sqlite3.Connection`` and typed params, return
plain data, and raise :class:`ServiceError` subclasses on failure. The sidecar
handlers are thin adapters: they own the write-lock + HTTP envelope and map
``ServiceError`` to the wire error codes.
"""

from .errors import NotFoundError, ServiceError, ValidationError

__all__ = ["ServiceError", "ValidationError", "NotFoundError"]
