/**
 * documentProvenance.ts — d'où vient un document, dit en clair.
 *
 * `documents.source_path` porte la provenance depuis toujours et n'était rendu **nulle
 * part** : son seul usage côté front était le pré-contrôle des doublons de l'écran
 * d'import. Tant que tout arrivait du disque, l'information n'apprenait rien. Dès qu'un
 * corpus mélange des fichiers locaux et des fichiers ShareDocs, rien à l'écran ne
 * permet plus de dire lequel est lequel — or c'est la distinction dont dépend le geste
 * que l'écran d'import conseille lui-même (« importez ce fichier localement » suppose
 * qu'on sache d'où vient ce qu'on regarde).
 */

/** Provenance prête à être posée en pied du panneau de métadonnées. */
export interface Provenance {
  /** D'où vient le document — le chemin brut ne le dit pas au premier coup d'œil. */
  origine: string;
  /** Chemin ou URL, décodé pour être lisible. */
  texte: string;
  /** La valeur telle qu'elle est en base, pour l'infobulle : ce qui se copie doit être exact. */
  brut: string;
}

/**
 * `null` quand le document ne porte aucune provenance — l'écran n'affiche alors rien
 * plutôt qu'une ligne « inconnue », qui n'apprendrait rien et occuperait la place.
 *
 * Une URL WebDAV est **percent-encodée** en base (`%C3%A9`, `%20` partout), donc
 * illisible telle quelle ; on la décode pour l'affichage seulement. Un décodage peut
 * échouer sur une séquence malformée — `decodeURIComponent` lève alors `URIError` — et
 * dans ce cas la valeur brute reste préférable à un écran vide.
 */
export function documentProvenance(sourcePath: string | null | undefined): Provenance | null {
  const brut = (sourcePath ?? "").trim();
  if (!brut) return null;
  const distant = /^https?:\/\//i.test(brut);
  let texte = brut;
  if (distant) {
    try {
      texte = decodeURIComponent(brut);
    } catch {
      // séquence d'échappement invalide : le brut vaut mieux que rien
    }
  }
  return { origine: distant ? "ShareDocs (WebDAV)" : "Fichier local", texte, brut };
}
