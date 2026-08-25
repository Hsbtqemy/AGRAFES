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
export interface RerunScope {
  /** Les langues que le run va réécrire — vide quand il porte sur toute la famille. */
  targets: string[];
  /** Les langues qu'il n'ira PAS toucher (colonnes masquées). */
  spared: string[];
  /** Liens posés à la main dans le périmètre : `preserve_accepted` ne les protège pas. */
  manual: number;
}

/**
 * La phrase qui manquait : ce que le recalcul détruit, et ce qu'il épargne.
 *
 * Sans périmètre (toutes les colonnes visibles) on retombe mot pour mot sur l'ancien
 * libellé — c'est le même geste qu'avant, il doit se lire pareil.
 */
function _scopeLine(scope?: RerunScope): string {
  if (!scope || scope.targets.length === 0) return "";
  const t = scope.targets.join(", ");
  const head = ` Le recalcul ne portera que sur <strong>${t}</strong>.`;
  const spared = scope.spared.length > 0
    ? ` <strong>${scope.spared.join(", ")}</strong> ${scope.spared.length > 1 ? "sont épargnées" : "est épargnée"}`
      + ` — masquée${scope.spared.length > 1 ? "s" : ""}, donc hors du run.`
    : "";
  // ALI-15 correctif 3 : un lien manuel a `status IS NULL`, donc `preserve_accepted` ne
  // le sauve pas. Le compter ici est la seule chose qui distingue « je refais un calcul »
  // de « je perds une heure de travail à la main ».
  const manual = scope.manual > 0
    ? ` <strong>${scope.manual}</strong> de ces liens ${scope.manual > 1 ? "ont été posés" : "a été posé"}`
      + ` à la main et ${scope.manual > 1 ? "seront supprimés" : "sera supprimé"}`
      + ` (« Conserver les liens validés » ne protège que les liens validés).`
    : "";
  return head + spared + manual;
}

export function buildAlignRerunConfirmHtml(linkCount: number, scope?: RerunScope): string {
  const scoped = scope && scope.targets.length > 0;
  const what = scoped ? "Cette sélection porte déjà" : "Cette famille porte déjà";
  const recalcLabel = scoped && scope.spared.length > 0
    ? `Recalculer ${scope.targets.join(", ")}`
    : "Recalcul global";
  return `<div class="prep-matrix-align-confirm" role="group" aria-label="Famille déjà alignée">`
    + `<span>${what} <strong>${linkCount}</strong> lien${linkCount > 1 ? "s" : ""}`
    + ` (liens rejetés compris).${_scopeLine(scope)}</span>`
    + `<button type="button" id="matrix-align-complete" class="btn btn-secondary btn-sm">`
    + `Compléter <small>(garde les liens existants — mais avec une AUTRE stratégie, ou après une`
  + ` modification de la segmentation, les nouveaux appariements s'AJOUTENT : l'unicité porte sur`
  + ` la paire d'unités, pas sur le segment. Un « Compléter » a déjà doublé une famille de 5 593`
  + ` liens.)</small></button>`
    + `<button type="button" id="matrix-align-recalc" class="btn btn-danger btn-sm">`
    + `${recalcLabel} <small>(supprime les liens puis réaligne)</small></button>`
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


// ─── ↺ Annuler ce run (ALI-17, contrat 1.6.66) ───────────────────────────────
//
// Un alignement de famille crée UN RUN PAR PAIRE (`_create_run` est dans la boucle
// `for target_doc_id in ready_child_ids`). Annuler « le » run, c'est donc N appels —
// et l'échec partiel est un cas normal, pas une anomalie : le moteur refuse en 409
// la paire qu'un run plus récent a déjà remplacée, tout en acceptant les autres.
// D'où le parti pris : on tente TOUTES les paires, on n'interrompt jamais à la
// première erreur (s'arrêter à mi-chemin laisserait la famille à moitié annulée,
// pire que les deux états francs), et on rend compte paire par paire.

/**
 * Les run_ids d'une réponse de run famille qui valent la peine d'être annulés.
 *
 * `status === "aligned"` ne suffit PAS : le moteur le pose inconditionnellement dès que
 * la paire a tourné sans lever (`sidecar.py:6768`), même quand elle n'a rien créé — le
 * cas normal d'un « Compléter » sur une famille déjà saturée, où l'index d'unicité
 * bloque chaque lien. Offrir d'annuler un run qui n'a rien fait, c'est promettre un
 * geste que le moteur refusera en `nothing_to_revert` : un bouton qui se propose puis
 * se dédit. Constaté en exécution réelle le 2026-08-19 (trois runs Modiano à 0 lien).
 */
export function undoableRunIds(res: FamilyAlignResponse): string[] {
  return res.results
    .filter((r) =>
      r.status === "aligned"
      && typeof r.run_id === "string" && r.run_id
      && ((r.links_created ?? 0) > 0 || (r.deleted_before ?? 0) > 0))
    .map((r) => r.run_id as string);
}

/** Résultat d'une tentative d'annulation, du point de vue de l'appelant. */
export interface RunUndoOutcome {
  ok: boolean;
  links_deleted?: number;
  links_kept?: number;
  links_restored?: number;
  links_not_restored?: number;
  error?: string;
}

/**
 * Une ligne honnête sur ce que l'annulation a fait — et sur ce qu'elle n'a PAS fait.
 *
 * Les trois quantités ne disent pas la même chose et les fondre serait mentir :
 * `kept` est une décision humaine qu'on a refusé d'écraser, `not_restored` une
 * restitution qui n'a pas pu avoir lieu (paire reprise ou unité disparue), et un
 * échec est une paire qu'on n'a pas touchée du tout.
 */
export function formatRunUndoOutcome(outcomes: RunUndoOutcome[]): string {
  const ok = outcomes.filter((o) => o.ok);
  const ko = outcomes.filter((o) => !o.ok);
  const sum = (k: keyof RunUndoOutcome) =>
    ok.reduce((n, o) => n + ((o[k] as number) ?? 0), 0);

  if (ok.length === 0) {
    const why = ko[0]?.error ?? "raison inconnue";
    return `✗ Annulation refusée : ${why}`;
  }

  const parts = [`${sum("links_deleted")} lien${sum("links_deleted") > 1 ? "s" : ""} retiré${sum("links_deleted") > 1 ? "s" : ""}`];
  const restored = sum("links_restored");
  if (restored > 0) parts.push(`${restored} rendu${restored > 1 ? "s" : ""}`);
  const kept = sum("links_kept");
  if (kept > 0) parts.push(`${kept} validé${kept > 1 ? "s" : ""} conservé${kept > 1 ? "s" : ""}`);
  const missed = sum("links_not_restored");
  if (missed > 0) parts.push(`${missed} non rendu${missed > 1 ? "s" : ""}`);

  const head = ko.length === 0
    ? `↺ Run annulé`
    : `↺ ${ok.length} paire${ok.length > 1 ? "s" : ""} annulée${ok.length > 1 ? "s" : ""}, ${ko.length} refusée${ko.length > 1 ? "s" : ""}`;
  const tail = ko.length > 0 ? ` — ${ko[0].error ?? "refus"}` : "";
  return `${head} : ${parts.join(", ")}${tail}`;
}

/**
 * La bande d'après-run : le résumé, et l'offre de revenir en arrière.
 *
 * L'offre est **transitoire** — elle vit dans la bande, que `_closeAlignStrip` vide à
 * tout changement de famille ou de corpus. On ne prétend donc pas garder une notion de
 * « dernier run » : ce qu'on propose d'annuler est le run qu'on vient de faire, sous
 * les yeux de celui qui l'a fait.
 */
export function buildRunUndoOfferHtml(summaryLine: string, pairCount: number): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const what = pairCount > 1
    ? `annule les <strong>${pairCount}</strong> paires de ce run`
    : `annule ce run`;
  return `<div class="prep-matrix-align-confirm" role="group" aria-label="Résultat du run">`
    + `<span>${esc(summaryLine)}</span>`
    + `<button type="button" id="matrix-run-undo" class="btn btn-ghost btn-sm"`
    + ` title="Retire les liens créés par ce run et remet ceux qu'il avait remplacés">`
    + `&#8634; Annuler ce run <small>(${what})</small></button>`
    + `</div>`;
}


// ─── Survie de l'offre ↺ à un rechargement ───────────────────────────────────
//
// L'offre vivait dans le DOM de la bande, donc un rechargement de page la perdait —
// et le 2026-08-19 c'est arrivé sur un run qui venait de DOUBLER un alignement de
// 5 593 liens (« Compléter » avec une autre stratégie, ALI-17 en direct). Le cas où
// l'on veut le plus revenir en arrière est précisément celui où l'offre disparaissait.
//
// `sessionStorage` et non `localStorage` : l'offre doit survivre à un rechargement,
// pas à un redémarrage de l'application. Un « annuler ce run » proposé trois jours
// plus tard n'aurait plus de sens — et le moteur le refuserait de toute façon si un
// run plus récent est passé depuis.

export const RUN_UNDO_KEY = "agrafes.align.lastRun";

export interface StoredRunOffer {
  /**
   * Chemin de la base — l'identité du CORPUS. Surtout pas `conn.baseUrl` : il contient le
   * port, et le sidecar en change à chaque redémarrage, donc à chaque rechargement de
   * page. Une offre enregistrée sous `http://127.0.0.1:52523` était introuvable après
   * relance sur 51533 : la persistance ne survivait à rien (constaté 2026-08-19).
   */
  dbPath: string;
  familyId: number;
  runIds: string[];
  summary: string;
  at: string;
}

type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveRunOffer(store: StoreLike, offer: StoredRunOffer): void {
  try {
    store.setItem(RUN_UNDO_KEY, JSON.stringify(offer));
  } catch { /* quota / mode privé : l'offre reste simplement transitoire */ }
}

/**
 * L'offre stockée si elle concerne CE corpus et CETTE famille, sinon null.
 *
 * `dbPath` vide ou inconnu ⇒ pas d'offre : mieux vaut ne rien proposer que proposer
 * d'annuler un run dans une base qu'on n'a pas su identifier.
 */
export function loadRunOffer(
  store: StoreLike, dbPath: string | null, familyId: number,
): StoredRunOffer | null {
  if (!dbPath) return null;
  try {
    const raw = store.getItem(RUN_UNDO_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as StoredRunOffer;
    if (o.dbPath !== dbPath || o.familyId !== familyId) return null;
    if (!Array.isArray(o.runIds) || o.runIds.length === 0) return null;
    return o;
  } catch {
    return null;
  }
}

export function clearRunOffer(store: StoreLike): void {
  try { store.removeItem(RUN_UNDO_KEY); } catch { /* idem */ }
}
