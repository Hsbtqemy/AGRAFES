"""Minimal ODT builders for tests (no extra dependencies)."""

from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape


def make_odt_bytes(paragraphs: list[str]) -> bytes:
    """Minimal valid ODT (ZIP + content.xml)."""
    text_ns = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    office_ns = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    inner = "".join(f"<text:p>{escape(p)}</text:p>" for p in paragraphs)
    content_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="{office_ns}" xmlns:text="{text_ns}" office:version="1.3">
  <office:body>
    <office:text>
      {inner}
    </office:text>
  </office:body>
</office:document-content>
"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "mimetype",
            "application/vnd.oasis.opendocument.text",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr("content.xml", content_xml.encode("utf-8"))
    return buf.getvalue()
