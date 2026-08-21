// journal-contrat.mjs — les règles de lecture partagées par les deux outils.
//
// Le gros du fichier est le contrat de `pilotage/`. S'y ajoute la lecture du tableau
// de constats d'un audit (`constatsAudit`), qui vit dans `docs/` et non dans
// `pilotage/` : le périmètre est élargi sciemment le 2026-08-21, parce que ce tableau
// est l'autre bout d'une relation que le contrat définit déjà — le `audit:` du
// front-matter d'une fiche. Le contrôleur en tire ses constats ouverts, le serveur
// en tire les codes à remonter vers le chantier. Deux copies de cette lecture
// produiraient des chiffres plausibles et contradictoires.
//
// Extrait de journal.mjs le 2026-08-20. Raison d'être unique : `journal.mjs` (le
// serveur) et `pilotage/verifier.mjs` (le contrôleur) doivent lire EXACTEMENT les
// mêmes règles. Un contrôleur qui vérifierait un contrat différent de celui que
// l'outil applique donnerait un vert sans valeur — ou un rouge sans cause.
//
// Toute évolution du contrat se fait ici. `pilotage/_TEMPLATE.md` le DÉCRIT ; ce
// fichier le DÉFINIT. Quand les deux divergent, c'est le code qui a raison — c'est
// déjà arrivé (le gabarit annonçait que `## QA` portait le rattachement des passes,
// alors qu'il n'est jamais lu ; corrigé le 2026-08-20).

import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";

export const RX = {
  fm:      /^---\r?\n([\s\S]*?)\r?\n---/,
  h1:      /^#\s+(.+)$/m,
  arret:   /^\*\*Arrêté sur\*\*\s*[—–-]?\s*(.+)$/m,
  box:     /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/,
  h2:      /^##\s+(.+)$/,
  h3:      /^###\s+(.+)$/,
  chantier:/\b(R[0-9](?:\.[0-9])?|[A-Z]{1,4}-[0-9]{1,3}[A-Za-z]?)\b/g,
  decision:/\bD-[PWC][0-9]{1,2}\b/g,
  adr:     /\bADR-[0-9]{3}\b/g,
  docpath: /\b(docs\/[A-Za-z0-9_.\-]+\.md)\b/g
};

export const frontmatter = (text) => {
  const m = RX.fm.exec(text); if (!m) return {};
  const o = {};
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([a-zA-Zé]+):\s*(.*)$/.exec(l);
    if (k) o[k[1]] = k[2].trim();
  }
  return o;
};

/** Les `.md` du dossier, récursivement. Les fichiers préfixés `_` sont écartés :
 *  c'est ainsi que `_TEMPLATE.md` n'apparaît pas comme un chantier. */
export const walk = async (dir) => {
  const out = [];
  let items = []; try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = join(dir, it.name);
    if (it.isDirectory()) out.push(...await walk(p));
    else if (extname(it.name) === ".md" && !it.name.startsWith("_")) out.push(p);
  }
  return out;
};

/** Passe de QA ou fiche de chantier ? La règle est double, et l'ordre compte :
 *  un `passe:` dans le frontmatter suffit, le dossier `qa/` aussi. */
export const estPasse = (rel, fm) => fm.passe !== undefined || rel.includes("/qa/");

/** Statuts admis pour un chantier. Absent ⇒ `interrompu` (journal.mjs). */
export const STATUTS = ["interrompu", "clos", "livré"];

// Un constat est OUVERT si sa colonne sévérité porte une de ces pastilles ; ✅ ou
// barré valent clos. `reconnu` distingue « aucun constat ouvert » de « je ne sais pas
// lire ce document » — sans cette garde, un audit d'une autre forme afficherait « 0
// ouvert », un vert qui ne mesure rien.
export const SEVERITES_OUVERTES = ["🔴", "🟠", "🟡", "🟢"];

export const constatsAudit = (texte) => {
  const constats = [];
  for (const [, code, sev] of texte.matchAll(/^\|\s*([A-Z]{2,5}-\d+)\s*\|\s*([^|]*?)\s*\|/gm))
    constats.push({ code, sev, ouvert: SEVERITES_OUVERTES.some(s => sev.includes(s)) });
  return { reconnu: constats.length > 0, constats };
};
