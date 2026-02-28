"""HTML summary report exporter for query results.

Generates a self-contained, readable HTML file.
All dynamic content is escaped via html.escape() — no XSS risk.
"""

from __future__ import annotations

import html
import json
from pathlib import Path


_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Query Report: {query_escaped}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; color: #222; }}
    h1 {{ font-size: 1.4rem; border-bottom: 2px solid #ccc; padding-bottom: .4rem; }}
    .meta {{ font-size: .85rem; color: #666; margin-bottom: 1.5rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: .9rem; }}
    th {{ background: #f0f0f0; text-align: left; padding: .4rem .6rem; border-bottom: 2px solid #ccc; }}
    td {{ padding: .35rem .6rem; border-bottom: 1px solid #e8e8e8; vertical-align: top; }}
    tr:hover td {{ background: #fafafa; }}
    .match {{ background: #fff3b0; font-weight: bold; }}
    .ext-id {{ color: #888; font-size: .8rem; }}
    .lang {{ background: #e8f4e8; border-radius: 3px; padding: 1px 5px; font-size: .75rem; }}
    .kwic-left {{ text-align: right; color: #555; }}
    .kwic-right {{ color: #555; }}
    .no-hits {{ color: #888; font-style: italic; padding: 1rem 0; }}
  </style>
</head>
<body>
  <h1>Query report</h1>
  <div class="meta">
    <strong>Query:</strong> {query_escaped} &nbsp;|&nbsp;
    <strong>Mode:</strong> {mode} &nbsp;|&nbsp;
    <strong>Hits:</strong> {count} &nbsp;|&nbsp;
    <strong>Run:</strong> {run_id}
  </div>
  {body}
</body>
</html>
"""

_SEGMENT_HEADER = """
  <table>
    <tr>
      <th>#</th><th>Doc</th><th>Lang</th><th>Ext ID</th><th>Text</th>
    </tr>
"""

_KWIC_HEADER = """
  <table>
    <tr>
      <th>#</th><th>Doc</th><th>Lang</th><th>Ext ID</th>
      <th class="kwic-left">Left</th>
      <th>Match</th>
      <th class="kwic-right">Right</th>
    </tr>
"""


def _highlight_to_html(text: str) -> str:
    """Convert <<match>> markers to <span class='match'>match</span>.

    The text is already HTML-escaped by the caller; the markers are not escaped.
    """
    # Because we escape first and then sub, the markers won't be escaped
    result = ""
    i = 0
    while i < len(text):
        open_pos = text.find("&lt;&lt;", i)
        if open_pos == -1:
            result += text[i:]
            break
        close_pos = text.find("&gt;&gt;", open_pos)
        if close_pos == -1:
            result += text[i:]
            break
        result += text[i:open_pos]
        inner = text[open_pos + 8: close_pos]
        result += f"<span class='match'>{inner}</span>"
        i = close_pos + 8
    return result


def export_html(
    hits: list[dict],
    output_path: str | Path,
    query: str = "",
    mode: str = "segment",
    run_id: str = "",
) -> Path:
    """Write query hits to a self-contained HTML report.

    Args:
        hits: List of hit dicts from run_query().
        output_path: Destination file path (.html).
        query: Original query string (for report header).
        mode: 'segment' or 'kwic'.
        run_id: Run UUID (for traceability).

    Returns:
        The resolved output path.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    query_escaped = html.escape(query)

    if not hits:
        body = f"<p class='no-hits'>No results for query: <em>{query_escaped}</em></p>"
    elif mode == "kwic":
        rows = ""
        for i, hit in enumerate(hits, 1):
            title = html.escape(hit.get("title", ""))
            lang = html.escape(hit.get("language", ""))
            ext_id = hit.get("external_id", "")
            left = html.escape(hit.get("left", ""))
            match = html.escape(hit.get("match", ""))
            right = html.escape(hit.get("right", ""))
            rows += (
                f"<tr>"
                f"<td>{i}</td>"
                f"<td>{title}</td>"
                f"<td><span class='lang'>{lang}</span></td>"
                f"<td class='ext-id'>{ext_id}</td>"
                f"<td class='kwic-left'>{left}</td>"
                f"<td><span class='match'>{match}</span></td>"
                f"<td class='kwic-right'>{right}</td>"
                f"</tr>\n"
            )
        body = _KWIC_HEADER + rows + "  </table>"
    else:
        rows = ""
        for i, hit in enumerate(hits, 1):
            title = html.escape(hit.get("title", ""))
            lang = html.escape(hit.get("language", ""))
            ext_id = hit.get("external_id", "")
            # Escape the text then convert <<markers>> to <span>
            raw_text = html.escape(hit.get("text", ""))
            # The text field uses << >> which become &lt;&lt; &gt;&gt; after escape
            text_html = _highlight_to_html(raw_text)
            rows += (
                f"<tr>"
                f"<td>{i}</td>"
                f"<td>{title}</td>"
                f"<td><span class='lang'>{lang}</span></td>"
                f"<td class='ext-id'>{ext_id}</td>"
                f"<td>{text_html}</td>"
                f"</tr>\n"
            )
        body = _SEGMENT_HEADER + rows + "  </table>"

    content = _HTML_TEMPLATE.format(
        query_escaped=query_escaped,
        mode=html.escape(mode),
        count=len(hits),
        run_id=html.escape(run_id),
        body=body,
    )

    output_path.write_text(content, encoding="utf-8")
    return output_path
