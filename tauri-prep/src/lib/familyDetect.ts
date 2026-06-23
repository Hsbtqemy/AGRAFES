/**
 * familyDetect.ts — détection PURE de familles documentaires à partir de noms de
 * fichiers (radical commun + token de langue distinct → original + traductions).
 *
 * Aucune dépendance DOM/IO : extrait de `screens/ImportScreen.ts` (Sprint 8) pour être
 * partagé entre l'import local et l'import ShareDocs (Phase 6) et testé en isolation.
 * **Source de vérité unique** — réutilise `LANG_RE` + `KNOWN_LANG_CODES` d'`importDetect`
 * (ne pas réinventer la grammaire de token de langue), cf. DESIGN §12.
 */

import { LANG_RE, KNOWN_LANG_CODES } from "./importDetect.ts";

/** Un membre d'une famille : la chaîne d'entrée (chemin local ou nom/href distant) + sa langue. */
export interface FamilyMember {
  /** Chaîne passée en entrée — chemin local côté Import, nom/href côté ShareDocs. */
  path: string;
  /** Code de langue (minuscule) extrait du nom. */
  lang: string;
}

/** Une famille détectée : un radical commun partagé par ≥2 fichiers de langues différentes. */
export interface FamilyGroup {
  /** Radical = nom sans le token de langue (ex. `roman.docx`). */
  stem: string;
  files: FamilyMember[];
}

/** Dernier segment d'un chemin / nom (slash et antislash). */
function baseName(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

/**
 * Regroupe les fichiers par **radical** (nom sans le token de langue) et retient les
 * groupes de **≥2** fichiers même radical / langues différentes.
 *
 * Le token de langue est validé contre {@link KNOWN_LANG_CODES} (comme
 * {@link detectLanguageToken}) : un suffixe 2-3 lettres hors whitelist (`_to`, `_by`, …)
 * **n'ouvre pas** de fausse famille. C'est le seul écart vs l'ancienne détection locale
 * (qui acceptait tout token `LANG_RE`) — affinage assumé, supprime les faux positifs
 * (DESIGN §12.1). L'ordre de première apparition des radicaux est préservé.
 */
export function detectFamilyGroups(names: string[]): FamilyGroup[] {
  const byStem = new Map<string, FamilyMember[]>();

  for (const p of names) {
    const fname = baseName(p);
    const m = LANG_RE.exec(fname);
    if (!m) continue;
    const lang = m[1].toLowerCase();
    if (!KNOWN_LANG_CODES.has(lang)) continue; // whitelist — aligné sur detectLanguageToken
    const ext = fname.split(".").pop()?.toLowerCase() ?? "";
    // Radical = tout ce qui précède le token de langue, + l'extension.
    const stem = fname.slice(0, fname.length - m[0].length) + "." + ext;
    const key = stem.toLowerCase();
    let members = byStem.get(key);
    if (!members) {
      members = [];
      byStem.set(key, members);
    }
    members.push({ path: p, lang });
  }

  const groups: FamilyGroup[] = [];
  for (const [stem, files] of byStem) {
    if (files.length >= 2) groups.push({ stem, files });
  }
  return groups;
}

/**
 * Heuristique de pivot (l'« original » d'une famille) : le membre dont la langue est
 * `defaultLang` s'il est présent, sinon le membre de 1ʳᵉ langue par ordre alphabétique.
 * Pré-sélection éditable dans la bannière (DESIGN §12.2.1). Suppose `group.files` non vide.
 */
export function pickDefaultPivot(group: FamilyGroup, defaultLang: string): FamilyMember {
  const wanted = defaultLang.trim().toLowerCase();
  const match = wanted ? group.files.find((f) => f.lang === wanted) : undefined;
  if (match) return match;
  return [...group.files].sort((a, b) => a.lang.localeCompare(b.lang))[0];
}
