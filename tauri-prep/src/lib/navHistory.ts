/**
 * navHistory.ts — la pile de navigation partagée (chantier NAV-01, lot 1).
 *
 * Pourquoi une pile plutôt qu'une capture de geste : le webview navigue DÉJÀ tout seul
 * quand on appuie sur les boutons latéraux de la souris. Mesuré le 31 août 2026 —
 * `popstate` tombe 6 ms après l'`auxclick`, et le bouton « suivant » marche aussi (voir
 * `pilotage/qa/sonde-geste-retour.md`). Ce qui manquait n'était donc pas le geste mais son
 * contenu : il n'existait pas un seul `pushState` dans les trois fronts, l'historique du
 * webview n'avait qu'une entrée, et le geste ne trouvait rien à remonter.
 *
 * Le modèle. Une DESTINATION est un enregistrement plat, un champ par niveau de navigation.
 * Chaque niveau s'enregistre ici avec de quoi se lire et s'appliquer ; la pile ne connaît
 * ni les écrans ni leur contenu. Les quatre niveaux du dépôt (mode shell, onglet Prep,
 * sous-vue Actions, couche du canvas) ont chacun UN point d'accroche unique par où passent
 * leurs 56 sites d'appel — c'est ce qui rend le branchement petit.
 *
 * Ce que la destination ne porte PAS : le document focalisé. Le restaurer demanderait un
 * chargement asynchrone dans le chemin de retour, là où vivent les scintillements et les
 * échecs (document supprimé entre-temps). Décision prise avec le périmètre du lot ; le
 * champ peut s'ajouter plus tard sans refaire la pile.
 */

/** Une destination : `{ mode: "constituer", tab: "actions", subView: "texte", … }`. */
export type Destination = Record<string, string>;

/** Ce qu'un niveau de navigation doit fournir pour entrer dans la pile. */
export interface NavLevel {
  /** Valeur courante du niveau, ou `null` s'il n'est pas monté (le canvas absent, par ex.). */
  read: () => string | null;
  /** Amène le niveau à la valeur demandée. Peut être asynchrone (le mode shell remonte un module). */
  apply: (value: string) => void | Promise<void>;
  /**
   * Ordre d'application, du plus englobant au plus fin. Il compte : appliquer le mode shell
   * remonte le module Constituer, ce qui détruit puis recrée les niveaux en dessous. Un
   * onglet appliqué avant son mode serait écrasé par le remontage.
   */
  order: number;
}

/**
 * Le garde de sortie. Rendu non nul, il empêche le retour de partir : la pile annule le
 * geste AVANT la navigation (`preventDefault` sur le `pointerdown`, mesuré efficace le
 * 31 août) puis pose la question. C'est ce qui évite la gymnastique du refus après coup —
 * `popstate` ne s'annule pas, et un retour refusé obligerait à re-pousser l'état quitté.
 */
export type PendingGuard = () => { confirm: () => Promise<boolean> } | null;

const KEY = "agrafesNav";

const levels = new Map<string, NavLevel>();
let current: Destination = {};
let installed = false;
let applying = false;
let guard: PendingGuard | null = null;
/** Jeton de séquence : deux retours rapides ne doivent pas s'appliquer en désordre. */
let token = 0;

const sameDest = (a: Destination, b: Destination): boolean => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

/** Lit l'état courant de tous les niveaux montés. */
export function capture(): Destination {
  const d: Destination = {};
  for (const [name, lvl] of levels) {
    let v: string | null = null;
    try { v = lvl.read(); } catch { v = null; }
    if (v != null) d[name] = v;
  }
  return d;
}

/**
 * Enregistre (ou remplace) un niveau. Le remplacement n'est pas un cas limite : le shell
 * détruit et recrée l'application Prep à chaque changement de mode, donc le niveau
 * « onglet » se ré-enregistre à chaque montage.
 */
export function registerLevel(name: string, level: NavLevel): void {
  levels.set(name, level);
}

export function unregisterLevel(name: string): void {
  levels.delete(name);
}

export function setPendingGuard(g: PendingGuard | null): void {
  guard = g;
}

/**
 * À appeler par un point d'accroche APRÈS qu'il a changé d'état. Pousse une entrée si la
 * destination a bougé. Muet pendant l'application d'un retour : sans ça, restaurer un état
 * le re-pousserait aussitôt et le geste ne remonterait jamais plus d'un cran.
 */
export function sync(): void {
  if (!installed || applying) return;
  const next = capture();
  if (sameDest(next, current)) return;
  current = next;
  try { history.pushState({ [KEY]: next }, ""); } catch { /* historique saturé : on continue sans */ }
}

/** Applique une destination, niveau par niveau, du plus englobant au plus fin. */
async function applyDestination(dest: Destination, mine: number): Promise<void> {
  applying = true;
  try {
    const ordered = [...levels.entries()].sort((a, b) => a[1].order - b[1].order);
    for (const [name, lvl] of ordered) {
      if (token !== mine) return;            // un retour plus récent a pris la main
      const want = dest[name];
      if (want == null) continue;            // niveau absent de la destination : on n'y touche pas
      let now: string | null = null;
      try { now = lvl.read(); } catch { now = null; }
      if (now === want) continue;            // déjà en place — ne pas rejouer un remontage pour rien
      try { await lvl.apply(want); } catch { /* un niveau qui échoue n'empêche pas les suivants */ }
    }
  } finally {
    applying = false;
    // Ce que les niveaux ont RÉELLEMENT atteint fait foi : un niveau qui refuse ou qui n'est
    // pas monté laisserait sinon la pile croire à un état qui n'existe pas.
    if (token === mine) current = capture();
  }
}

function onPopState(e: PopStateEvent): void {
  const dest = (e.state as Record<string, Destination> | null)?.[KEY];
  if (!dest) return;   // entrée étrangère à la pile (aucune aujourd'hui, mais rien ne l'interdit)
  void applyDestination(dest, ++token);
}

/**
 * Le geste, côté refus. Les boutons latéraux valent 3 (précédent) et 4 (suivant) ; on ne
 * les intercepte QUE s'il y a des modifications en attente, sinon on laisse le webview
 * naviguer seul — c'est gratuit et c'est le chemin nominal.
 *
 * Attention en relisant : annuler le `pointerdown` supprime aussi les événements souris de
 * compatibilité (`mousedown`, `mouseup` cessent d'être émis, seul l'`auxclick` survit).
 * C'est le comportement spécifié des Pointer Events, sans conséquence ici — l'application
 * n'écoute pas le bouton 3 — mais c'est le détail qui fait rater un test.
 */
function onPointerDown(e: PointerEvent): void {
  if (e.button !== 3 && e.button !== 4) return;
  const pending = guard?.();
  if (!pending) return;
  e.preventDefault();
  const back = e.button === 3;
  void pending.confirm().then((ok) => {
    if (!ok) return;
    if (back) history.back();
    else history.forward();
  });
}

/**
 * Démarre la pile. `replaceState` sur l'entrée courante plutôt qu'un `pushState` : la
 * première entrée de l'historique est l'application elle-même, et on veut qu'elle porte sa
 * destination sans créer un cran vide que le premier retour consommerait pour rien.
 */
export function install(): void {
  if (installed) return;
  installed = true;
  current = capture();
  try { history.replaceState({ [KEY]: current }, ""); } catch { /* */ }
  window.addEventListener("popstate", onPopState);
  window.addEventListener("pointerdown", onPointerDown, true);
}

export function uninstall(): void {
  if (!installed) return;
  installed = false;
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("pointerdown", onPointerDown, true);
  levels.clear();
  guard = null;
  current = {};
}

/** Réservé aux tests : remet le module à neuf sans toucher à `history`. */
export function _resetForTests(): void {
  levels.clear();
  current = {};
  installed = false;
  applying = false;
  guard = null;
  token = 0;
}
