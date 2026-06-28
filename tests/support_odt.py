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


def make_styled_odt_bytes() -> bytes:
    """Minimal ODT carrying one italic ``text:span`` (rich-text import regression).

    The single paragraph is ``before <em>em</em> after``; a correct import must
    preserve the styling as ``before <hi rend="italic">em</hi> after`` in
    ``text_raw`` (regression for audit ENG-01 — the ODT style map was dropped at
    the call site).
    """
    office_ns = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    style_ns = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    text_ns = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    fo_ns = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
    content_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="{office_ns}" xmlns:style="{style_ns}" xmlns:text="{text_ns}" xmlns:fo="{fo_ns}" office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="T1" style:family="text">
      <style:text-properties fo:font-style="italic"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      <text:p>before <text:span text:style-name="T1">em</text:span> after</text:p>
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
