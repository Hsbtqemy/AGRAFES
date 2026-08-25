/**
 * Lire une sélection de texte dans le DOM et la traduire en bornes du texte nu —
 * `docs/DESIGN_inline_restyling.md` §5a.
 *
 * Le geste de stylisation part d'une sélection à la souris sur la ligne **rendue**. Ce
 * module fait le seul travail délicat de la chaîne : passer des nœuds et offsets que
 * donne le navigateur à un couple d'entiers dans le texte affiché, que
 * `richTextModel.domOffsetToPlain` traduira ensuite en offsets du texte nu.
 *
 * Deux pièges traités :
 *
 * - la sélection peut être ancrée sur un **élément** (double-clic, sélection d'une ligne
 *   entière) et pas sur un nœud texte ;
 * - la ligne rendue contient des `<em>` / `<strong>`, donc plusieurs nœuds texte : les
 *   offsets sont relatifs au nœud, jamais à la ligne.
 */

export interface RichSelectionRange {
  /** Bornes dans le texte **affiché** (entités résolues), pas dans `text_raw`. */
  start: number;
  end: number;
}

/** Somme la longueur des nœuds texte de `container` situés avant (node, offset). */
function _domOffsetOf(container: HTMLElement, node: Node, offset: number): number | null {
  const doc = container.ownerDocument;
  if (!doc) return null;

  // Sélection ancrée sur un élément : `offset` compte des enfants, pas des caractères.
  let target: Node = node;
  let targetOffset = offset;
  if (node.nodeType !== 3 /* TEXT_NODE */) {
    const children = Array.from(node.childNodes);
    const before = children.slice(0, offset);
    const text = before.map((c) => c.textContent ?? "").join("");
    const first = children[offset];
    if (first) {
      target = first;
      targetOffset = 0;
      // Position du premier enfant non consommé, plus le texte qui le précède.
      const head = _domOffsetOf(container, target, targetOffset);
      return head === null ? null : head;
    }
    // `offset` pointe après le dernier enfant : tout le texte de ce nœud est consommé.
    const head = _domOffsetOf(container, node.firstChild ?? node, 0);
    return head === null ? null : head + text.length;
  }

  let total = 0;
  const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
  let current: Node | null = walker.nextNode();
  while (current !== null) {
    if (current === target) return total + targetOffset;
    total += (current.textContent ?? "").length;
    current = walker.nextNode();
  }
  return null;
}

/**
 * Bornes de la sélection courante, restreinte à `container`.
 *
 * Rend `null` quand il n'y a rien à styliser : pas de sélection, sélection vide, ou
 * sélection qui déborde de la ligne — on refuse plutôt que de deviner ce que
 * l'utilisateur voulait couvrir.
 */
export function selectionRangeIn(
  container: HTMLElement,
  selection: Selection | null,
): RichSelectionRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const a = _domOffsetOf(container, range.startContainer, range.startOffset);
  const b = _domOffsetOf(container, range.endContainer, range.endOffset);
  if (a === null || b === null || a === b) return null;
  // `getRangeAt` rend toujours la plage en ordre de document, y compris pour un glisser
  // à rebours : le tri ci-dessous est une ceinture, pas un cas courant.
  return a < b ? { start: a, end: b } : { start: b, end: a };
}
