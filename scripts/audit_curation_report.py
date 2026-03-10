#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
AUDIT_ROOT = ROOT / "artifacts" / "ui-audit"
JSON_DIR = AUDIT_ROOT / "json"
SCREEN_DIR = AUDIT_ROOT / "screenshots"
REPORT = AUDIT_ROOT / "audit-curation.md"

WIDTHS = [1280, 1366, 1440, 1536, 1600, 1728, 1920]
STATES = ["nominal", "one-collapsed", "multi-collapsed", "long-content"]

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


@dataclass
class Diff:
    mode: str
    state: str
    width: int
    key: str
    zone: str
    prop: str
    mockup: str
    runtime: str
    selector: str
    dom_path: str
    severity: str
    symptom: str
    cause: str
    file_target: str
    impact: str
    fix_minimal: str


def sev_for(prop: str) -> tuple[str, str]:
    if prop == "presence":
        return ("P0", "structure absente ou supplémentaire")
    if prop in P0_PROPS:
        return ("P0", "layout/scroll")
    if prop in P1_PROPS:
        return ("P1", "densité/hiérarchie")
    return ("P2", "cosmétique")


def fmt(v: Any) -> str:
    if v is None:
        return "∅"
    if isinstance(v, float):
        if math.isfinite(v):
            return f"{v:.2f}"
        return str(v)
    return str(v)


def cause_for(key: str, prop: str, state: str) -> tuple[str, str, str]:
    # cause, file target, fix minimal
    if key in {"content", "shell", "nav"}:
        return (
            "Wrapper shell/content différent du prototype (max-width, marge, topbar/nav réelles).",
            "tauri-prep/src/ui/app.css (tauri-prep/src/app.ts si état nav global)",
            "Aligner le wrapper content sur la géométrie du mockup pour l’état audité.",
        )
    if key in {"workspace", "col_left", "col_center", "col_right"}:
        return (
            "Ratios de colonnes et hauteur de workspace différents.",
            "tauri-prep/src/ui/app.css",
            "Rétablir 310 / minmax(640,1fr) / 320 et gap mockup au breakpoint concerné.",
        )
    if key in {"preview_card", "preview_grid", "pane_raw", "pane_cured", "pane_head", "doc_scroll", "minimap", "minimap_mark", "preview_controls", "preview_head"}:
        return (
            "Overrides curation preview non alignés (hauteurs, overflow, grille, sticky).",
            "tauri-prep/src/ui/app.css",
            "Recaler les règles preview/panes/minimap sur les valeurs mockup et préserver sticky.",
        )
    if key in {"actions_row", "btn_apply", "btn_preview", "btn_reset", "rule_chip", "rules_row", "ctx_row", "ctx_cell", "params_card", "params_head"}:
        return (
            "Densité/typographie colonne gauche divergente (chips, boutons, box 2x2).",
            "tauri-prep/src/ui/app.css + tauri-prep/src/screens/ActionsScreen.ts",
            "Uniformiser padding/font-size/gap et hiérarchie des boutons selon mockup.",
        )
    if key in {"head_card", "head_title", "head_subtitle", "head_tools", "head_pill", "head_cta_longtext"}:
        return (
            "Head-card runtime (acts-*) différent du composant head-card mockup.",
            "tauri-prep/src/ui/app.css + tauri-prep/src/screens/ActionsScreen.ts",
            "Harmoniser la barre de tête curation (espacements, densité, outils visibles).",
        )
    if key in {"diag_card", "diag_list", "diag_item", "review_card", "review_log", "review_item", "quick_actions_card"}:
        return (
            f"Écart d’état: runtime {state} moins rempli que la maquette illustrative.",
            "tauri-prep/src/screens/ActionsScreen.ts",
            "Prévoir un mode d’état de démonstration ou comparer à contenu équivalent.",
        )
    if key in {"advanced_panel", "doc_select"}:
        return (
            "Structure runtime enrichie absente du mockup strict.",
            "tauri-prep/src/screens/ActionsScreen.ts",
            "Décider si cet élément doit être conservé (sinon l’aligner visuellement sans supprimer la logique).",
        )
    return (
        "Écart de style/layout non aligné avec la référence.",
        "tauri-prep/src/ui/app.css",
        "Corriger localement la propriété divergente au niveau du bloc concerné.",
    )


def load_capture(mode: str, state: str, width: int) -> dict[str, Any]:
    p = JSON_DIR / f"{mode}__{state}__w{width}.json"
    return json.loads(p.read_text(encoding="utf-8"))


def primary_diff_for_pair(mock: dict[str, Any], run: dict[str, Any], state: str, width: int) -> list[Diff]:
    out: list[Diff] = []
    m = mock["elements"]
    r = run["elements"]
    selector_map = {item["key"]: item for item in run.get("selector_map", [])}
    all_keys = sorted(set(m.keys()) | set(r.keys()))

    for key in all_keys:
        me = m.get(key, {"missing": True})
        re = r.get(key, {"missing": True})
        zone = (re.get("component") or me.get("component") or "unknown")
        selector = selector_map.get(key, {}).get("selector") or re.get("selector") or ""
        dom_path = re.get("domPath", "")

        candidates: list[tuple[str, str, str]] = []  # prop,mv,rv
        if me.get("missing") != re.get("missing"):
            candidates.append(("presence", "missing" if me.get("missing") else "present", "missing" if re.get("missing") else "present"))
        elif not me.get("missing"):
            mr = me.get("rect", {})
            rr = re.get("rect", {})
            for p in ("w", "h"):
                mv = mr.get(p)
                rv = rr.get(p)
                if mv is None or rv is None:
                    continue
                if abs(float(mv) - float(rv)) >= 2.0:
                    candidates.append((f"rect.{p}", fmt(mv), fmt(rv)))
            mc = me.get("css", {})
            rc = re.get("css", {})
            for p in CSS_PROPS:
                mv = fmt(mc.get(p))
                rv = fmt(rc.get(p))
                if mv != rv:
                    candidates.append((f"css.{p}", mv, rv))

        if not candidates:
            continue

        # choose most severe diff for exhaustive line (per key/state/width)
        rank = {"P0": 0, "P1": 1, "P2": 2}
        best = None
        for prop, mv, rv in candidates:
            sev, impact = sev_for(prop)
            if best is None:
                best = (sev, impact, prop, mv, rv)
                continue
            if rank[sev] < rank[best[0]]:
                best = (sev, impact, prop, mv, rv)
        assert best is not None
        sev, impact, prop, mv, rv = best
        cause, file_target, fix_min = cause_for(key, prop, state)
        symptom = f"{prop} runtime={rv}"
        out.append(
            Diff(
                mode="runtime-vs-mockup",
                state=state,
                width=width,
                key=key,
                zone=zone,
                prop=prop,
                mockup=mv,
                runtime=rv,
                selector=selector,
                dom_path=dom_path,
                severity=sev,
                symptom=symptom,
                cause=cause,
                file_target=file_target,
                impact=impact,
                fix_minimal=fix_min,
            )
        )
    return out


def render_report(rows: list[Diff]) -> str:
    sev_rank = {"P0": 0, "P1": 1, "P2": 2}
    rows_sorted = sorted(rows, key=lambda r: (sev_rank[r.severity], STATES.index(r.state), WIDTHS.index(r.width), r.zone, r.key))
    counts = Counter(r.severity for r in rows_sorted)
    by_zone = Counter(r.zone for r in rows_sorted)
    by_state = Counter(r.state for r in rows_sorted)
    by_width = Counter(r.width for r in rows_sorted)
    by_cause = Counter(r.cause for r in rows_sorted)

    lines: list[str] = []
    lines.append("# UI Audit — Actions > Curation (mockup vnext vs runtime)")
    lines.append("")
    lines.append("## A. Résumé exécutif")
    lines.append(f"- Breakpoints audités: `{', '.join(str(w) for w in WIDTHS)}` (hauteur fixe 900).")
    lines.append(f"- États audités: `{', '.join(STATES)}`.")
    lines.append(f"- Comparaisons effectuées: **{len(WIDTHS) * len(STATES)}** paires mockup/runtime.")
    lines.append(f"- Divergences mesurées (1 ligne synthèse par bloc/état/breakpoint): **{len(rows_sorted)}**.")
    lines.append(f"- Répartition sévérité: P0={counts.get('P0',0)}, P1={counts.get('P1',0)}, P2={counts.get('P2',0)}.")
    lines.append(f"- Zones les plus impactées: {', '.join(f'{k}={v}' for k,v in by_zone.most_common())}.")
    lines.append("- Les écarts P0 dominants concernent la preview centrale (hauteur utile, overflow, minimap, sticky) et la structure shell/content.")
    lines.append("")

    lines.append("## B. Tableau exhaustif des divergences")
    lines.append("")
    lines.append("| ID | breakpoint | état | zone | symptôme runtime | écart vs mockup | cause probable | fichier | sélecteur/bloc | impact | fix minimal |")
    lines.append("|---|---:|---|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows_sorted, 1):
        ecart = f"{r.prop}: `{r.mockup}` -> `{r.runtime}`"
        sel = f"`{r.selector}`"
        lines.append(
            f"| D{i:04d} | {r.width} | {r.state} | {r.zone} | {r.symptom} | {ecart} | {r.cause} | {r.file_target} | {sel} | {r.severity} ({r.impact}) | {r.fix_minimal} |"
        )
    lines.append("")

    lines.append("## C. Hiérarchie des causes racines")
    lines.append("")
    for idx, (cause, n) in enumerate(by_cause.most_common(5), 1):
        lines.append(f"{idx}. **{cause}** ({n} occurrences)")
    lines.append("")
    lines.append("- Répartition par état: " + ", ".join(f"{k}={v}" for k, v in by_state.items()))
    lines.append("- Répartition par breakpoint: " + ", ".join(f"{k}={v}" for k, v in sorted(by_width.items())))
    lines.append("")

    lines.append("## D. Plan de fixes incrémental")
    lines.append("")
    lines.append("### Inc 1 — largeur utile / déplafonnement")
    lines.append("- Cibler le wrapper shell/content (`#prep-shell-main`, `.prep-main > .content`) pour caler largeur utile sur la référence à chaque breakpoint.")
    lines.append("- Vérifier marges auto/left align en mode nav repliée.")
    lines.append("")
    lines.append("### Inc 2 — ratios de colonnes")
    lines.append("- Réaligner `#act-curate-card .curate-workspace` sur `310 / minmax(640,1fr) / 320` puis adapter les media queries 1400/1050.")
    lines.append("- Vérifier que la colonne droite ne s’écrase pas prématurément.")
    lines.append("")
    lines.append("### Inc 3 — typo / densité")
    lines.append("- Harmoniser `font-size`, `line-height`, `padding`, `gap` de head-card, chips et boutons curation.")
    lines.append("- Uniformiser la hiérarchie visuelle `btn/alt/pri`.")
    lines.append("")
    lines.append("### Inc 4 — sections repliées")
    lines.append("- Définir un comportement stable des états repliés (arbre nav, bloc avancé, panneau sections) entre mockup/runtime.")
    lines.append("- Garantir l’absence de sauts de layout quand plusieurs groupes sont repliés.")
    lines.append("")
    lines.append("### Inc 5 — sticky preview / longtext parity")
    lines.append("- Recaler `preview-card`, `preview-grid`, `.pane`, `.doc-scroll`, minimap (`overflow`, `min/max-height`, `sticky`) pour long content.")
    lines.append("- Valider la parité en état `long-content` sur tous les breakpoints.")
    lines.append("")

    lines.append("## Annexes")
    lines.append("- Screenshots: `artifacts/ui-audit/screenshots/`")
    lines.append("- JSON dumps: `artifacts/ui-audit/json/`")
    lines.append("- Matrix index: `artifacts/ui-audit/matrix-index.json`")
    lines.append("- Outils: `scripts/audit_curation_capture.mjs`, `scripts/audit_curation_matrix.mjs`, `scripts/audit_curation_report.py`")
    return "\n".join(lines) + "\n"


def main() -> None:
    rows: list[Diff] = []
    for width in WIDTHS:
        for state in STATES:
            mock = load_capture("mockup", state, width)
            run = load_capture("runtime", state, width)
            rows.extend(primary_diff_for_pair(mock, run, state, width))

    AUDIT_ROOT.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(render_report(rows), encoding="utf-8")

    # machine-export of rows for traceability
    rows_json = [r.__dict__ for r in rows]
    (AUDIT_ROOT / "divergences.json").write_text(json.dumps(rows_json, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
