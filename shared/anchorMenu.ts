/**
 * anchorMenu.ts — ramener un menu ouvert à l'intérieur de son cadre.
 *
 * Premier module DOM de `shared/` (les autres y sont de la logique pure), placé
 * ici parce que deux fronts en ont besoin : `tauri-app` pour les dropdowns de la
 * barre du concordancier, `tauri-shell` pour les menus de token de la Recherche
 * grammaticale et ceux de son bandeau.
 *
 * Le problème qu'il résout (audit du 2026-08-21, passe `pilotage/qa/menus-flottants.md`) :
 * un menu ancré en CSS statique ne sait pas où il s'ouvre. `right: 0` sur un
 * bouton que `flex-wrap` a rejeté en début de rangée envoie le menu dans les x
 * négatifs ; `left: 0` sur un bouton proche du bord droit l'envoie hors cadre.
 * Comme les hôtes sont en `overflow: hidden`, ce qui sort est coupé, pas
 * défilable. Mesuré : Export −177 px à 800 de large, l'aide +86 px à la taille
 * par défaut de la fenêtre.
 *
 * Le parti pris est de **glisser**, pas de basculer de l'autre côté du
 * déclencheur : un menu qui saute au-dessus du bouton change de place d'une
 * ouverture à l'autre, ce qui se paie en repérage. Quand le menu est plus grand
 * que le cadre, glisser ne suffit plus — on borne et on laisse défiler, ce que
 * fait déjà `.prep-canvas-doc-menu`, seul menu du dépôt à avoir été écrit ainsi.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ClampResult {
  /** Décalage horizontal à appliquer, en px (négatif = vers la gauche). */
  dx: number;
  /** Décalage vertical à appliquer, en px (négatif = vers le haut). */
  dy: number;
  /** Largeur maximale à imposer quand le menu est plus large que le cadre. */
  maxWidth: number | null;
  /** Hauteur maximale à imposer quand le menu est plus haut que le cadre. */
  maxHeight: number | null;
}

/** Marge conservée entre le menu et le bord du cadre. */
export const DEFAULT_PAD = 8;

function clampAxis(
  start: number,
  end: number,
  boundStart: number,
  boundEnd: number,
  pad: number,
): { delta: number; max: number | null } {
  // Arrondi TOUJOURS dans le sens de la correction : un demi-pixel de moins et le
  // menu ressort du cadre. Un décalage fractionnaire, en plus, fait baver le texte
  // dans le webview — et ces menus ne contiennent que du texte.
  const franc = (d: number): number => (d < 0 ? Math.floor(d) : Math.ceil(d));

  const frame = boundEnd - boundStart;
  // Cadre plus étroit que ses propres marges : c'est la marge qui saute, pas le
  // contenu. Sans cela un cadre de 10 px imposerait une largeur maximale de zéro,
  // c'est-à-dire un menu invisible — le défaut qu'on est en train de corriger.
  const p = frame >= 2 * pad ? pad : 0;
  const available = frame - 2 * p;
  const size = end - start;

  // Plus grand que le cadre : glisser ne peut rien, on borne et on cale au début.
  if (size > available) return { delta: franc(boundStart + p - start), max: Math.floor(available) };

  // Déborde à la fin (droite / bas) : on remonte d'autant.
  if (end > boundEnd - p) return { delta: franc(boundEnd - p - end), max: null };
  // Déborde au début (gauche / haut) : on descend d'autant.
  if (start < boundStart + p) return { delta: franc(boundStart + p - start), max: null };
  return { delta: 0, max: null };
}

/** Rien à corriger — également ce qu'on renvoie quand la mesure n'a pas de sens. */
const IMMOBILE: ClampResult = { dx: 0, dy: 0, maxWidth: null, maxHeight: null };

/** Remet à zéro ce qu'une ouverture précédente avait imposé. */
function reinitialiser(menu: HTMLElement): void {
  menu.style.transform = "";
  menu.style.maxWidth = "";
  menu.style.maxHeight = "";
  menu.style.overflowY = "";
}

/** Une boîte sans surface ne se recadre pas : elle n'est pas encore mise en page. */
function sansSurface(r: Rect): boolean {
  return r.right - r.left <= 0 || r.bottom - r.top <= 0;
}

/**
 * Géométrie pure : ce qu'il faut appliquer à `el` pour qu'il tienne dans `bounds`.
 *
 * Ne touche à aucun DOM — c'est la partie testable. Les deux fonctions
 * ci-dessous ne font que l'appliquer, chacune selon la façon dont son menu est
 * positionné.
 */
export function clampToBounds(el: Rect, bounds: Rect, pad: number = DEFAULT_PAD): ClampResult {
  const x = clampAxis(el.left, el.right, bounds.left, bounds.right, pad);
  const y = clampAxis(el.top, el.bottom, bounds.top, bounds.bottom, pad);
  return { dx: x.delta, dy: y.delta, maxWidth: x.max, maxHeight: y.max };
}

/** Le plus proche ancêtre qui coupe ce qui dépasse, ou `null` si aucun. */
export function clippingAncestor(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") return p;
    p = p.parentElement;
  }
  return null;
}

function viewportRect(): Rect {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * Menu ancré en CSS (`position: absolute` sous un parent `position: relative`).
 *
 * À appeler **après** l'avoir rendu visible, sinon il se mesure à zéro. La
 * correction passe par `transform`, pour ne pas écraser le `left`/`right` que la
 * feuille de style pose : l'ancrage reste la source de vérité, on ne fait que le
 * corriger. Le cadre est l'ancêtre qui coupe (typiquement le conteneur en
 * `overflow: hidden` de l'application), à défaut le viewport.
 */
export function clampAnchoredMenu(
  menu: HTMLElement,
  bounds?: Rect | null,
  pad: number = DEFAULT_PAD,
): ClampResult {
  // Repartir de zéro : un menu se rouvre, et la correction précédente fausserait
  // la mesure de celle-ci. Avant toute sortie anticipée : rouvrir un menu doit
  // toujours effacer la contrainte du tour d'avant, même si on ne recadre pas.
  reinitialiser(menu);

  const el = menu.getBoundingClientRect();
  const host = bounds ?? clippingAncestor(menu)?.getBoundingClientRect() ?? viewportRect();
  if (sansSurface(el) || sansSurface(host)) return IMMOBILE;
  const r = clampToBounds(el, host, pad);

  if (r.maxWidth !== null) menu.style.maxWidth = `${r.maxWidth}px`;
  if (r.maxHeight !== null) {
    menu.style.maxHeight = `${r.maxHeight}px`;
    menu.style.overflowY = "auto";
  }
  if (r.dx !== 0 || r.dy !== 0) menu.style.transform = `translate(${r.dx}px, ${r.dy}px)`;
  return r;
}

/**
 * Menu positionné en JS (`position: fixed`, coordonnées calculées à l'ouverture).
 *
 * Ici `left`/`top` *sont* la position : on les corrige directement plutôt que
 * d'empiler un `transform`. Le cadre est toujours le viewport — c'est ce à quoi
 * `fixed` se réfère.
 */
export function clampFixedMenu(menu: HTMLElement, pad: number = DEFAULT_PAD): ClampResult {
  reinitialiser(menu);

  const rect = menu.getBoundingClientRect();
  const cadre = viewportRect();
  if (sansSurface(rect) || sansSurface(cadre)) return IMMOBILE;
  const r = clampToBounds(rect, cadre, pad);

  if (r.maxWidth !== null) menu.style.maxWidth = `${r.maxWidth}px`;
  if (r.maxHeight !== null) {
    menu.style.maxHeight = `${r.maxHeight}px`;
    menu.style.overflowY = "auto";
  }
  if (r.dx !== 0) menu.style.left = `${rect.left + r.dx}px`;
  if (r.dy !== 0) menu.style.top = `${rect.top + r.dy}px`;
  return r;
}
