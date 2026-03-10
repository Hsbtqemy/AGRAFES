#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


P0_PROPS = {
    "rect.w",
    "rect.h",
    "css.gridTemplateColumns",
    "css.gridTemplateRows",
    "css.overflow",
    "css.overflowY",
    "css.position",
    "css.minHeight",
    "css.maxHeight",
}
P1_PROPS = {
    "css.gap",
    "css.padding",
    "css.margin",
    "css.fontSize",
    "css.fontWeight",
    "css.lineHeight",
    "css.width",
    "css.height",
}
P2_PROPS = {
    "css.borderRadius",
    "css.boxShadow",
}

CSS_PROPS = [
    "display",
    "position",
    "overflow",
    "overflowY",
    "gridTemplateColumns",
    "gridTemplateRows",
    "gap",
    "padding",
    "margin",
    "width",
    "height",
    "minHeight",
    "maxHeight",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "borderRadius",
    "boxShadow",
]


@dataclass
class DiffRow:
    component: str
    key: str
    selector_mockup: str
    selector_runtime: str
    prop: str
    mockup_value: str
    runtime_value: str
    severity: str
    impact: str


def severity_for_prop(prop: str) -> tuple[str, str]:
    if prop in P0_PROPS:
        return ("P0", "layout/scroll")
    if prop in P1_PROPS:
        return ("P1", "densité/hiérarchie")
    if prop in P2_PROPS:
        return ("P2", "cosmétique")
    return ("P2", "cosmétique")


def fmt(v: Any) -> str:
    if v is None:
        return "∅"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v)


def collect_selector_map(payload: dict[str, Any]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for item in payload.get("selector_map", []):
        key = item.get("key")
        if not key:
            continue
        out[key] = {
            "component": item.get("component", "unknown"),
            "selector": item.get("selector") or "",
        }
    return out


def build_diffs(mockup: dict[str, Any], runtime: dict[str, Any]) -> list[DiffRow]:
    out: list[DiffRow] = []
    m_elems = mockup.get("elements", {})
    r_elems = runtime.get("elements", {})
    m_map = collect_selector_map(mockup)
    r_map = collect_selector_map(runtime)
    all_keys = sorted(set(m_elems.keys()) | set(r_elems.keys()))

    for key in all_keys:
        m = m_elems.get(key, {"missing": True})
        r = r_elems.get(key, {"missing": True})
        component = (
            m.get("component")
            or r.get("component")
            or m_map.get(key, {}).get("component")
            or r_map.get(key, {}).get("component")
            or "unknown"
        )
        sel_m = m_map.get(key, {}).get("selector", "")
        sel_r = r_map.get(key, {}).get("selector", "")

        if m.get("missing") and r.get("missing"):
            continue
        if m.get("missing") != r.get("missing"):
            sev, impact = severity_for_prop("rect.w")
            out.append(
                DiffRow(
                    component=component,
                    key=key,
                    selector_mockup=sel_m,
                    selector_runtime=sel_r,
                    prop="presence",
                    mockup_value="missing" if m.get("missing") else "present",
                    runtime_value="missing" if r.get("missing") else "present",
                    severity=sev,
                    impact=impact,
                )
            )
            continue

        m_rect = m.get("rect", {})
        r_rect = r.get("rect", {})
        for prop in ("w", "h"):
            mv = m_rect.get(prop)
            rv = r_rect.get(prop)
            if mv is None or rv is None:
                continue
            if abs(float(mv) - float(rv)) >= 2.0:
                name = f"rect.{prop}"
                sev, impact = severity_for_prop(name)
                out.append(
                    DiffRow(
                        component=component,
                        key=key,
                        selector_mockup=sel_m,
                        selector_runtime=sel_r,
                        prop=name,
                        mockup_value=fmt(mv),
                        runtime_value=fmt(rv),
                        severity=sev,
                        impact=impact,
                    )
                )

        m_css = m.get("css", {})
        r_css = r.get("css", {})
        for prop in CSS_PROPS:
            mv = m_css.get(prop)
            rv = r_css.get(prop)
            if mv is None and rv is None:
                continue
            if fmt(mv).strip() != fmt(rv).strip():
                name = f"css.{prop}"
                sev, impact = severity_for_prop(name)
                out.append(
                    DiffRow(
                        component=component,
                        key=key,
                        selector_mockup=sel_m,
                        selector_runtime=sel_r,
                        prop=name,
                        mockup_value=fmt(mv),
                        runtime_value=fmt(rv),
                        severity=sev,
                        impact=impact,
                    )
                )

    sev_rank = {"P0": 0, "P1": 1, "P2": 2}
    out.sort(key=lambda r: (sev_rank.get(r.severity, 9), r.component, r.key, r.prop))
    return out


def write_markdown(rows: list[DiffRow], out_md: Path) -> None:
    lines: list[str] = []
    lines.append("# Curation parity diff (mockup vs runtime)")
    lines.append("")
    lines.append(f"- Total diffs: **{len(rows)}**")
    lines.append(
        f"- P0: **{sum(1 for r in rows if r.severity == 'P0')}**, "
        f"P1: **{sum(1 for r in rows if r.severity == 'P1')}**, "
        f"P2: **{sum(1 for r in rows if r.severity == 'P2')}**"
    )
    lines.append("")

    lines.append("## Top 10 P0")
    lines.append("")
    lines.append("| Component | Key | Property | Mockup | Runtime |")
    lines.append("|---|---|---|---|---|")
    top_p0 = [r for r in rows if r.severity == "P0"][:10]
    for r in top_p0:
        lines.append(
            f"| {r.component} | `{r.key}` | `{r.prop}` | `{r.mockup_value}` | `{r.runtime_value}` |"
        )
    if not top_p0:
        lines.append("| - | - | - | - | - |")
    lines.append("")

    lines.append("## Exhaustive table")
    lines.append("")
    lines.append("| Severity | Component | Key | Property | Mockup | Runtime | Impact | Selector mockup | Selector runtime |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        lines.append(
            f"| {r.severity} | {r.component} | `{r.key}` | `{r.prop}` | `{r.mockup_value}` | `{r.runtime_value}` | {r.impact} | `{r.selector_mockup}` | `{r.selector_runtime}` |"
        )
    lines.append("")
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_diff_notes(mockup: dict[str, Any], runtime: dict[str, Any], out_md: Path) -> None:
    m_elems = mockup.get("elements", {})
    r_elems = runtime.get("elements", {})
    notes: list[str] = []
    notes.append("# Visual diff notes (annotated by coordinates)")
    notes.append("")
    notes.append("- Viewport used: 1440x900")
    notes.append("- Coordinates are from `getBoundingClientRect()` top-left reference.")
    notes.append("")

    for key in sorted(set(m_elems) & set(r_elems)):
        m = m_elems[key]
        r = r_elems[key]
        if m.get("missing") or r.get("missing"):
            continue
        mr = m.get("rect", {})
        rr = r.get("rect", {})
        dw = abs(float(mr.get("w", 0.0)) - float(rr.get("w", 0.0)))
        dh = abs(float(mr.get("h", 0.0)) - float(rr.get("h", 0.0)))
        dx = abs(float(mr.get("x", 0.0)) - float(rr.get("x", 0.0)))
        dy = abs(float(mr.get("y", 0.0)) - float(rr.get("y", 0.0)))
        if max(dw, dh, dx, dy) < 8.0:
            continue
        notes.append(
            f"- `{key}`: mockup (x={mr.get('x', 0):.1f}, y={mr.get('y', 0):.1f}, w={mr.get('w', 0):.1f}, h={mr.get('h', 0):.1f}) "
            f"vs runtime (x={rr.get('x', 0):.1f}, y={rr.get('y', 0):.1f}, w={rr.get('w', 0):.1f}, h={rr.get('h', 0):.1f})"
        )
    if len(notes) == 4:
        notes.append("- No coordinate delta >= 8px on compared selectors.")
    notes.append("")
    out_md.write_text("\n".join(notes), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mockup", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out-md", required=True, type=Path)
    parser.add_argument("--out-notes", required=True, type=Path)
    parser.add_argument("--out-json", required=False, type=Path)
    args = parser.parse_args()

    mockup = json.loads(args.mockup.read_text(encoding="utf-8"))
    runtime = json.loads(args.runtime.read_text(encoding="utf-8"))
    rows = build_diffs(mockup, runtime)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    write_markdown(rows, args.out_md)
    write_diff_notes(mockup, runtime, args.out_notes)
    if args.out_json:
        args.out_json.write_text(
            json.dumps([r.__dict__ for r in rows], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
