/**
 * Modèle de stylisation inline — `docs/DESIGN_inline_restyling.md`.
 *
 * La représentation canonique est **(texte nu, style par caractère)** (D-R2), le modèle
 * que l'encodeur d'import utilise déjà côté moteur (`importers/rich_text.py`). Les
 * chevauchements n'existent donc pas comme problème : deux styles sur un même caractère
 * produisent `rend="bold italic"`, tokens triés, exactement comme à l'import.
 *
 * Ce module est **pur** — aucun DOM, aucun appel réseau. Il expose de quoi lire, écrire
 * et modifier le balisage `<hi>` de `text_raw`, plus la correspondance d'offsets dont le
 * geste de sélection a besoin.
 *
 * Deux invariants tenus par construction :
 *
 * 1. **On n'ajoute et ne retire que des balises.** Les caractères du texte ne bougent
 *    jamais, donc `text_norm` reste valable tel quel et n'a pas à être recalculé — ce qui
 *    préserve l'invariant de la garde d'affichage (`sidecarClient.richTextToHtml`) et les
 *    offsets des coupes d'alignement.
 * 2. **Les styles qu'on ne sait pas éditer survivent.** D-R1 n'ouvre que l'italique et le
 *    gras à la main, mais un `underline` ou un `superscript` venu de l'import est
 *    transporté sans être compris (note §6).
 */

/** Styles éditables à la main (D-R1). L'import en produit six ; on n'en ouvre que deux. */
export const RICH_TOKENS = ["italic", "bold"] as const;
export type RichToken = (typeof RICH_TOKENS)[number];

const _TAG_RE = /<hi\b([^>]*)>|<\/hi>/g;
const _REND_RE = /\brend=["']([^"']*)["']/;

/**
 * Texte nu + style de chaque caractère.
 *
 * `plain` est le texte débarrassé des balises, **échappement XML conservé** : c'est la
 * chaîne dont les offsets indexent `text_norm` sur une ligne intacte depuis l'import.
 * `marks[i]` est la valeur `rend` du caractère `plain[i]` — tokens triés, séparés par une
 * espace, `""` pour un caractère sans style.
 */
export interface RichModel {
  plain: string;
  marks: string[];
}

function _tokens(rend: string): Set<string> {
  return new Set(rend.split(/\s+/).filter(Boolean));
}

function _rend(tokens: Set<string>): string {
  return [...tokens].sort().join(" ");
}

/** Lire `text_raw` : rend le texte nu et le style de chaque caractère. */
export function parseRich(raw: string): RichModel {
  const plain: string[] = [];
  const marks: string[] = [];
  const stack: string[] = [];
  let current = "";
  let last = 0;
  let m: RegExpExecArray | null;

  const push = (chunk: string): void => {
    // Indexation en unités UTF-16, comme les offsets du DOM et de `String.prototype`.
    for (let i = 0; i < chunk.length; i++) {
      plain.push(chunk[i]);
      marks.push(current);
    }
  };

  _TAG_RE.lastIndex = 0;
  while ((m = _TAG_RE.exec(raw)) !== null) {
    push(raw.slice(last, m.index));
    if (m[0].startsWith("</")) {
      stack.pop();
      current = stack.length > 0 ? stack[stack.length - 1] : "";
    } else {
      // Un <hi> imbriqué hérite du style courant — l'import n'en produit pas, mais un
      // fichier écrit à la main peut en contenir.
      const inherited = _tokens(current);
      for (const t of _tokens((_REND_RE.exec(m[1]) ?? [])[1] ?? "")) inherited.add(t);
      current = _rend(inherited);
      stack.push(current);
    }
    last = m.index + m[0].length;
  }
  push(raw.slice(last));

  return { plain: plain.join(""), marks };
}

/** Écrire `text_raw` : refusionne les caractères de même style en un seul `<hi>`. */
export function renderRich(model: RichModel): string {
  const { plain, marks } = model;
  const out: string[] = [];
  let i = 0;
  while (i < plain.length) {
    const rend = marks[i] ?? "";
    let j = i;
    while (j < plain.length && (marks[j] ?? "") === rend) j++;
    const chunk = plain.slice(i, j);
    out.push(rend ? `<hi rend="${rend}">${chunk}</hi>` : chunk);
    i = j;
  }
  return out.join("");
}

/**
 * Vrai si *tous* les caractères de la plage portent déjà `token`.
 *
 * C'est la sémantique de bascule d'un bouton : une sélection entièrement en italique se
 * dé-italicise, une sélection partiellement stylée s'uniformise en italique.
 */
export function hasMark(raw: string, start: number, end: number, token: RichToken): boolean {
  const { marks } = parseRich(raw);
  if (start >= end) return false;
  for (let i = start; i < end; i++) {
    if (!_tokens(marks[i] ?? "").has(token)) return false;
  }
  return true;
}

/**
 * Poser (`on = true`) ou retirer (`on = false`) un style sur `[start, end)`.
 *
 * Les offsets indexent le texte nu (`RichModel.plain`), pas `text_raw`. Une plage vide ou
 * hors bornes laisse le texte inchangé plutôt que de lever.
 */
export function applyMark(
  raw: string,
  start: number,
  end: number,
  token: RichToken,
  on: boolean,
): string {
  const model = parseRich(raw);
  const from = Math.max(0, Math.min(start, model.plain.length));
  const to = Math.max(0, Math.min(end, model.plain.length));
  if (from >= to) return raw;

  for (let i = from; i < to; i++) {
    const tokens = _tokens(model.marks[i] ?? "");
    if (on) tokens.add(token);
    else tokens.delete(token);
    model.marks[i] = _rend(tokens);
  }
  return renderRich(model);
}

/** Retirer tout le balisage d'une ligne (geste « tout retirer »). */
export function clearMarks(raw: string): string {
  return parseRich(raw).plain;
}

/**
 * Vrai si la ligne peut être stylée sans risque.
 *
 * Faux quand le texte porte un chevron nu hors balisage : `text_raw` serait alors
 * ambigu, et la garde de provenance de `richTextToHtml` refuserait de le rendre. Mesuré
 * sur le corpus de travail : **1 ligne sur 47 993**. Le cas se règlera avec la question
 * des entités XML dans `text_norm` (chantier RICH-01).
 */
export function canStyle(raw: string): boolean {
  return !/[<>]/.test(parseRich(raw).plain);
}

/**
 * Convertir un offset lu dans le DOM en offset du texte nu.
 *
 * `text_raw` est XML-échappé par l'importateur, et `text_norm` hérite de cet échappement
 * puisque `normalize()` tourne sur un `text_raw` déjà échappé — 24 unités de la base de
 * travail portent ainsi `&amp;` dans leur texte cherchable. Le navigateur, lui, affiche
 * un seul caractère. Une sélection lue à l'écran doit donc être retraduite avant d'être
 * appliquée (note §5a), sans quoi tout style posé après une esperluette serait décalé.
 */
export function domOffsetToPlain(plain: string, domOffset: number): number {
  let seen = 0;
  let i = 0;
  while (i < plain.length && seen < domOffset) {
    const entity = /^&(amp|lt|gt|quot|apos);/.exec(plain.slice(i));
    i += entity ? entity[0].length : 1;
    seen++;
  }
  return i;
}

/** Longueur du texte tel que le DOM l'affiche (entités résolues). */
export function domLength(plain: string): number {
  let seen = 0;
  let i = 0;
  while (i < plain.length) {
    const entity = /^&(amp|lt|gt|quot|apos);/.exec(plain.slice(i));
    i += entity ? entity[0].length : 1;
    seen++;
  }
  return seen;
}
