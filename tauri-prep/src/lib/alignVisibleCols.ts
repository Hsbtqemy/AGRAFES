/**
 * alignVisibleCols.ts — l'ensemble des colonnes de traduction affichées par la matrice
 * (DESIGN_alignment_workspace §2.1 / D-W7, ALI-15 + ALI-18). HTML pur + persistance pure,
 * aucun DOM, aucune IO.
 *
 * **Pourquoi.** On n'aligne pas quatre langues d'un coup : on travaille une traduction
 * contre la VO, puis la suivante. Tant que la grille projetait toute la famille, ce geste
 * normal coûtait trois fois : un affichage plus lourd (chaque colonne de traduction pèse
 * ≈ 0,63 Mo de charge utile sur la famille de référence, et le rendu est linéaire en
 * cellules), une VO séparée de sa traduction par deux colonnes qu'on ne regarde pas, et
 * surtout un « Recalcul global » qui purgeait les paires qu'on ne travaillait pas — y
 * compris leurs liens manuels, que `preserve_accepted` ne protège pas (ALI-15).
 *
 * D'où l'invariant que ce module sert : **ce qui est chargé est ce qui est affiché, et on
 * ne réécrit jamais une colonne masquée.** L'ensemble visible est donc à la fois le
 * paramètre `target_doc_ids` de la projection et le périmètre des gestes destructifs.
 *
 * Le défaut est **toutes les colonnes** : masquer est un geste, pas un état initial.
 */

export interface MatrixColumn {
  docId: number;
  lang: string;
}

const _ESC: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
/** La langue vient de la base (import), donc de l'extérieur : elle s'échappe. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => _ESC[c]);
}

/**
 * Les colonnes réellement visibles, dans l'ordre de la famille.
 *
 * `visible` est un ensemble de doc_ids ; tout id qui n'est plus une colonne (document
 * détaché de la famille, corpus changé) est **ignoré silencieusement** ici — c'est une
 * préférence d'affichage périmée, pas une erreur à faire remonter. Le moteur, lui, refuse
 * un tel id en 400 : d'où le filtrage ici, avant de composer la requête.
 */
export function resolveVisible(all: MatrixColumn[], visible: ReadonlySet<number>): MatrixColumn[] {
  return all.filter((c) => visible.has(c.docId));
}

/** `true` quand toutes les colonnes sont affichées — l'état par défaut. */
export function isAllVisible(all: MatrixColumn[], visible: ReadonlySet<number>): boolean {
  return all.length > 0 && all.every((c) => visible.has(c.docId));
}

/**
 * Le paramètre `target_doc_ids` à poster, ou `undefined` quand tout est visible.
 *
 * Omettre le paramètre plutôt que d'envoyer la liste complète n'est pas cosmétique : c'est
 * le chemin historique de la route, celui qu'exerce l'export CSV et tous les appels
 * antérieurs. Un sidecar plus ancien que 1.6.77 ignorerait le paramètre et renverrait
 * toutes les colonnes — inoffensif tant qu'on ne s'en sert pas pour BORNER un geste
 * destructif ; d'où `alignScopeOf` ci-dessous, qui refuse de scoper à l'aveugle.
 */
export function targetDocIdsParam(
  all: MatrixColumn[], visible: ReadonlySet<number>,
): number[] | undefined {
  // `all` vide = les colonnes ne sont pas connues (la liste des familles n'est pas revenue,
  // ou l'appelant n'a rien à dire) : retomber sur le chemin historique. Sans ce garde on
  // posterait `[]`, c'est-à-dire « le moyeu seul » — on a déjà pris ce défaut une fois côté
  // run, attrapé par un test existant. Ne pas laisser deux états très différents (« je ne
  // sais pas » et « l'utilisateur a tout masqué ») produire la même requête.
  if (all.length === 0 || isAllVisible(all, visible)) return undefined;
  return all.filter((c) => visible.has(c.docId)).map((c) => c.docId);
}

/**
 * Ce sur quoi un run doit porter, et comment le dire.
 *
 * `scoped: false` = toutes les colonnes sont visibles, donc le run porte sur la famille
 * entière et on ne poste rien de plus (comportement d'avant). `scoped: true` = le run est
 * borné aux colonnes affichées, et `spared` nomme celles qu'il n'ira PAS toucher : c'est
 * la phrase qui manquait à la confirmation destructive.
 */
export interface AlignScope {
  scoped: boolean;
  targets: MatrixColumn[];
  spared: MatrixColumn[];
}

export function alignScopeOf(all: MatrixColumn[], visible: ReadonlySet<number>): AlignScope {
  const targets = resolveVisible(all, visible);
  return {
    // `all` vide = colonnes inconnues, PAS « un périmètre réduit à rien ». La nuance a
    // piégé trois fois dans ce chantier (options de run, paramètre de projection, garde de
    // capacité) parce que `isAllVisible([])` est faux : chaque appelant retombait sur
    // « scopé » et bornait un geste à zéro colonne. `scoped` veut dire « on a délibérément
    // rétréci », ce qui suppose d'abord de savoir sur quoi.
    scoped: all.length > 0 && !isAllVisible(all, visible),
    targets,
    spared: all.filter((c) => !visible.has(c.docId)),
  };
}

/** « en et es », « en, es et ro » — pour une phrase, pas pour une liste à puces. */
export function langList(cols: MatrixColumn[]): string {
  const names = cols.map((c) => c.lang || "?");
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/**
 * La barre de chips. Chaque langue est un interrupteur (`aria-pressed`), pas une case à
 * cocher déguisée : le bouton porte l'état qu'il a, et le clic le renverse.
 *
 * `counts` (facultatif, `link_counts` du payload) affiche l'effectif de liens de la
 * colonne — le versant lisible d'ALI-16 : c'est le chiffre qui dit si une colonne a été
 * alignée, et de combien un recalcul la priverait.
 */
export function buildVisibleColsHtml(
  all: MatrixColumn[],
  visible: ReadonlySet<number>,
  counts?: ReadonlyMap<number, number>,
): string {
  if (all.length === 0) return "";
  const chips = all.map((c) => {
    const on = visible.has(c.docId);
    const n = counts?.get(c.docId);
    const badge = n === undefined ? "" : ` <small class="prep-matrix-col-chip-n">${n}</small>`;
    const title = on
      ? `Masquer la colonne ${esc(c.lang)} — elle ne sera plus ni chargée, ni affichée, ni touchée par « Aligner »`
      : `Afficher la colonne ${esc(c.lang)}`;
    return `<button type="button" class="prep-matrix-col-chip${on ? " is-on" : ""}"`
      + ` data-col-doc="${c.docId}" aria-pressed="${on ? "true" : "false"}"`
      + ` title="${title}">${esc(c.lang || "?")}${badge}</button>`;
  }).join("");
  const hidden = all.filter((c) => !visible.has(c.docId));
  // Le bouton de retour n'apparaît que s'il y a quelque chose à rétablir : une action
  // affichée en permanence sans effet apprend à ignorer la barre.
  const reset = hidden.length > 0
    ? `<button type="button" id="matrix-cols-all" class="btn btn-ghost btn-sm"`
      + ` title="Réafficher toutes les langues de la famille">Toutes (${all.length})</button>`
    : "";
  // Dire ce qui est caché, à l'endroit où on l'a caché : sans cette phrase, une colonne
  // masquée hier se lit demain comme une traduction absente de la famille.
  const note = hidden.length > 0
    ? `<span class="prep-matrix-cols-note">${hidden.length} masquée${hidden.length > 1 ? "s" : ""}`
      + ` : ${esc(langList(hidden))}</span>`
    : "";
  return `<div class="prep-matrix-cols" role="group" aria-label="Langues affichées">`
    + `<span class="prep-matrix-cols-label">Langues</span>${chips}${reset}${note}</div>`;
}


// ─── Persistance ─────────────────────────────────────────────────────────────
//
// Même raisonnement que l'offre ↺ d'après-run : `sessionStorage`, clé portant le CHEMIN
// de la base (l'identité du corpus) et non l'URL du sidecar, dont le port change à chaque
// redémarrage. Un choix d'affichage doit survivre à un rechargement de page et à un
// aller-retour vers un autre écran ; il n'a pas à survivre à un redémarrage, où repartir
// de « toutes les langues » est le comportement le moins surprenant.

export const VISIBLE_COLS_KEY = "agrafes.matrix.visibleCols";

interface StoredCols {
  dbPath: string;
  /** doc_ids visibles, PAR famille. Une entrée unique `{familyId, docIds}` ne gardait que
   *  la dernière famille ouverte : revenir sur la précédente réaffichait tout, en
   *  contradiction avec ce que la barre laisse croire. */
  byFamily: Record<string, number[]>;
}

type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function _read(store: StoreLike, dbPath: string): StoredCols {
  try {
    const raw = store.getItem(VISIBLE_COLS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as StoredCols;
      // Changer de corpus repart de zéro : un doc_id d'une autre base ne désigne pas le
      // même document, et le réutiliser masquerait une colonne au hasard.
      if (o && o.dbPath === dbPath && o.byFamily && typeof o.byFamily === "object") return o;
    }
  } catch { /* illisible : on repart d'un enregistrement neuf */ }
  return { dbPath, byFamily: {} };
}

export function saveVisibleCols(
  store: StoreLike, dbPath: string | null, familyId: number, docIds: number[],
): void {
  if (!dbPath) return;
  try {
    const cur = _read(store, dbPath);
    cur.byFamily[String(familyId)] = docIds;
    store.setItem(VISIBLE_COLS_KEY, JSON.stringify(cur));
  } catch { /* quota / mode privé : le choix reste alors valable pour la session en cours */ }
}

/**
 * L'ensemble visible mémorisé pour CE corpus et CETTE famille, ou toutes les colonnes.
 *
 * Le repli est toujours « tout visible », jamais « rien » : une préférence illisible,
 * d'un autre corpus ou d'une autre famille ne doit pas faire disparaître des colonnes
 * sans que personne ne l'ait demandé. Et l'intersection avec `all` est faite ici — un
 * doc_id stocké qui n'est plus dans la famille ferait un 400 côté moteur.
 */
export function loadVisibleCols(
  store: StoreLike, dbPath: string | null, familyId: number, all: MatrixColumn[],
): Set<number> {
  const every = new Set(all.map((c) => c.docId));
  if (!dbPath) return every;
  try {
    const stored = _read(store, dbPath).byFamily[String(familyId)];
    if (!Array.isArray(stored)) return every;
    const kept = stored.filter((d) => every.has(d));
    // Une préférence qui ne recoupe plus rien (famille recomposée) repart de zéro plutôt
    // que d'afficher une grille sans aucune traduction, qu'on lirait comme une panne.
    return kept.length > 0 ? new Set(kept) : every;
  } catch {
    return every;
  }
}

export function clearVisibleCols(store: StoreLike): void {
  try { store.removeItem(VISIBLE_COLS_KEY); } catch { /* idem */ }
}
