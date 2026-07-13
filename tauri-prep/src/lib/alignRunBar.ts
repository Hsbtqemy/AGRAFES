/**
 * alignRunBar.ts — the « Aligner » bar of the matrix (R3.3 tranche 5,
 * docs/DESIGN_alignment_workspace §4 + §6-5). Pure HTML + pure summary text.
 *
 * The first pain of the QA that started this refonte: **the alignment mode was hidden
 * in the Settings and opaque** — you had to choose a strategy before you could do
 * anything, without knowing what the choice meant. Here the button runs on an
 * **assumed default** (lengths / DP — the 90 % case: a corpus with no `[N]` markers has
 * no `external_id` to align on), and the mode becomes a **fold-away « Avancé »**, not a
 * prerequisite.
 *
 * The other thing this bar exists to stop being silent about: **re-running the aligner on
 * an already-aligned family does nothing** (existing pairs are kept, new links are only
 * added where none exist). The engine reports it in `links_skipped` / `deleted_before`,
 * but nothing surfaced it — so the user saw « ✓ aligné » and no change. The bar therefore
 * asks, in so many words: *compléter* (leave what exists) or *recalculer* (remise à plat).
 */

import type { FamilyAlignOptions, FamilyAlignResponse } from "./sidecarClient.ts";

export type AlignStrategy = NonNullable<FamilyAlignOptions["strategy"]>;

/** The assumed default (§4): what runs when the user just presses « Aligner ». */
export const ALIGN_DEFAULTS: Readonly<FamilyAlignOptions> = Object.freeze({
  strategy: "length_bounded" as AlignStrategy,
  preserve_accepted: true,
  replace_existing: false,
  skip_unready: true,
});

export const STRATEGY_LABELS: ReadonlyArray<{ value: AlignStrategy; label: string; hint: string }> = [
  { value: "length_bounded", label: "longueurs ¶ (Gale–Church)", hint: "Défaut — aucun marqueur requis, s'appuie sur la longueur des segments." },
  { value: "external_id_then_position", label: "external_id → position", hint: "Le corpus porte des marqueurs [N] ; repli positionnel là où ils manquent." },
  { value: "external_id", label: "external_id", hint: "Le corpus porte des marqueurs [N] partout." },
  { value: "position", label: "position", hint: "Le n-ième segment de la source ↔ le n-ième de la traduction." },
  { value: "similarity", label: "similarité", hint: "Compare les textes ; utile entre langues proches." },
];

/** The « Avancé » disclosure — the mode is a fold-away, never a prerequisite. */
export function buildAlignAdvancedHtml(): string {
  const opts = STRATEGY_LABELS.map((s) =>
    `<option value="${s.value}"${s.value === ALIGN_DEFAULTS.strategy ? " selected" : ""}>${s.label}</option>`,
  ).join("");
  return `<div id="matrix-align-adv" class="prep-matrix-align-adv" hidden>`
    + `<label class="prep-matrix-align-field">Mode`
    + `<select id="matrix-align-strategy" class="prep-matrix-align-select">${opts}</select>`
    + `</label>`
    + `<p id="matrix-align-hint" class="prep-matrix-align-hint">${STRATEGY_LABELS[0].hint}</p>`
    + `<label class="prep-matrix-align-field" id="matrix-align-sim-field" hidden>Seuil`
    + `<input id="matrix-align-sim" type="number" min="0" max="1" step="0.05" value="0.8"`
    + ` class="prep-matrix-align-num">`
    + `</label>`
    + `<label class="prep-matrix-align-check">`
    + `<input id="matrix-align-preserve" type="checkbox" checked> Conserver les liens validés`
    + `</label>`
    + `</div>`;
}

/**
 * Inline confirm (never a native dialog) shown when the family ALREADY has links: the
 * choice the engine makes silently today.
 *
 * The wording is deliberately literal about what the engine does (revue tranche 5): with
 * `replace_existing:false` the aligner **re-runs the whole strategy** and only dedupes on
 * the exact `(pivot_unit_id, target_unit_id)` unique index — it protects nothing else. So
 * a re-run with a DIFFERENT strategy does not « only add what is missing »: it can pile
 * new links on top of the old ones (and create collisions). Saying « n'ajoute que les
 * liens manquants » was simply false.
 */
export function buildAlignRerunConfirmHtml(linkCount: number): string {
  return `<div class="prep-matrix-align-confirm" role="group" aria-label="Famille déjà alignée">`
    + `<span>Cette famille porte déjà <strong>${linkCount}</strong> lien${linkCount > 1 ? "s" : ""}`
    + ` (liens rejetés compris).</span>`
    + `<button type="button" id="matrix-align-complete" class="btn btn-secondary btn-sm">`
    + `Compléter <small>(garde les liens existants ; une autre stratégie peut en ajouter par-dessus)</small></button>`
    + `<button type="button" id="matrix-align-recalc" class="btn btn-danger btn-sm">`
    + `Recalcul global <small>(supprime les liens puis réaligne)</small></button>`
    + `<button type="button" id="matrix-align-cancel" class="btn btn-ghost btn-sm">Annuler</button>`
    + `</div>`;
}

/**
 * One honest line about what the run did — including what it did NOT do. A run that
 * created 0 links on an already-aligned family is the norm without `replace_existing`,
 * and used to read as a plain success.
 */
export function alignRunSummary(
  res: FamilyAlignResponse, opts: FamilyAlignOptions, existingLinks = 0,
): string {
  const s = res.summary;
  const created = s.total_links_created;
  const aside: string[] = [];
  if (s.skipped > 0) aside.push(`${s.skipped} paire${s.skipped > 1 ? "s" : ""} ignorée${s.skipped > 1 ? "s" : ""} (non segmentée)`);
  if (s.errors > 0) aside.push(`${s.errors} en erreur`);
  const tail = aside.length > 0 ? ` · ${aside.join(" · ")}` : "";

  // Why did a run add nothing? Three different stories — and telling the wrong one is
  // worse than the hollow « ✓ aligné » this bar replaced (revue tranche 5):
  //   (a) no pair could even run (children not segmented / errors);
  //   (b) the pairs ran, but the family was ALREADY linked → the footgun;
  //   (c) the pairs ran on a family with NO link, and the strategy matched nothing
  //       (external_id on a corpus without [N], similarity above the threshold…).
  // The engine cannot tell (b) from (c): it reports a pair as « aligned » as soon as it
  // ran without raising. Only the caller knows how many links the family had BEFORE.
  if (created === 0 && s.aligned === 0) {
    return `Aucune paire alignée${tail || " — rien à aligner dans cette famille"}`;
  }
  if (created === 0 && !opts.replace_existing && existingLinks > 0) {
    return "Aucun lien ajouté — les liens existants ne sont pas recréés"
      + " (utiliser « Recalcul global » pour repartir de zéro)" + tail;
  }
  if (created === 0) {
    const mode = STRATEGY_LABELS.find((x) => x.value === opts.strategy)?.label ?? opts.strategy;
    return `Aucun lien : le mode « ${mode} » n'a apparié aucun segment${tail}`;
  }
  const head = `${created} lien${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""}`
    + ` · ${s.aligned}/${s.total_pairs} paire${s.total_pairs > 1 ? "s" : ""}`;
  return `✓ ${head}${tail}`;
}
