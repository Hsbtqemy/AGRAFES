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
  // « Point de départ » est le même artefact sous le mot juste pour un `à venir` :
  // on ne s'est arrêté sur rien. Un seul champ, deux libellés — l'écran affiche celui
  // que la fiche a écrit, et le contrat n'en gagne pas un second.
  arret:   /^\*\*(?:Arrêté sur|Point de départ)\*\*\s*[—–-]?\s*(.+)$/m,
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

/** Statuts admis pour un chantier. Absent ⇒ `interrompu` (journal.mjs).
 *  `à venir` : cadré, pas commencé — une fiche écrite AVANT le premier commit de code.
 *  Sans lui, un chantier neuf s'annonçait « interrompu », ce qui dit qu'on s'est arrêté
 *  en plein travail alors que rien n'a commencé. Le journal le dément mécaniquement dès
 *  qu'un commit de code cite le code (voir `commitsCode`). */
export const STATUTS = ["à venir", "interrompu", "clos", "livré"];

// Un constat est OUVERT si sa colonne sévérité porte une de ces pastilles ; ✅ ou
// barré valent clos. `reconnu` distingue « aucun constat ouvert » de « je ne sais pas
// lire ce document » — sans cette garde, un audit d'une autre forme afficherait « 0
// ouvert », un vert qui ne mesure rien.
export const SEVERITES_OUVERTES = ["🔴", "🟠", "🟡", "🟢"];

// Deux formes de constat coexistent dans la documentation d'un dépôt, et les lire
// toutes les deux coûte moins cher que de renuméroter les audits — un code d'audit
// finit cité partout, jusque dans les fichiers de CI.
//
//  · TABLEAU   `| A-01 | 🔴 | constat | preuve |`
//    Le préfixe va de UNE à cinq lettres : `A-01`, `Q-01`, `T-01` étaient muets sous
//    un ancien `{2,5}`. Un code barré (`| ~~A-05~~ |`) ne matche pas, donc n'est pas
//    compté : c'est voulu, il est retiré.
//  · TITRE     `### IMP-01 ✔ — 🔴 P0 — …`
//    Collecté SEULEMENT s'il porte une pastille, et clos s'il porte ✔ ou ✅ — la
//    pastille y est la SÉVÉRITÉ, pas l'état, si bien qu'un `✔ — 🔴` compterait
//    ouvert sans cette seconde lecture.
//
// La condition de pastille n'est pas une commodité. Un backlog mesuré portait des
// codes en titre (`### C-1 — …`) et AUCUNE sévérité : le collecter le faisait passer
// « reconnu, 0 ouvert » alors que six items y étaient ouverts — un vert qui ne mesure
// rien, précisément ce que `reconnu` existe pour empêcher. Il reste INCONNU, et c'est
// le document qu'il faut alors corriger, pas cette règle.
const CLOS_EN_TITRE = ["✔", "✅"];

export const constatsAudit = (texte) => {
  // Clé = le code, et le TABLEAU gagne. Un audit mesuré portait les DEUX formes — un
  // tableau de 24 lignes ET une section `### CODE-NN` par constat — et les additionner
  // faisait passer son compte de 16 à 38 ouverts. Le tableau est l'index
  // canonique : lui seul porte l'état (✅, code barré) ; la section ne porte que le
  // détail, et n'y répète pas la clôture.
  const parCode = new Map();
  for (const [, code, sev] of texte.matchAll(/^\|\s*([A-Z]{1,5}-\d+)\s*\|\s*([^|]*?)\s*\|/gm))
    if (!parCode.has(code))
      parCode.set(code, { code, sev, ouvert: SEVERITES_OUVERTES.some(s => sev.includes(s)) });
  for (const [, code, reste] of texte.matchAll(/^#{2,4}\s+([A-Z]{1,5}-\d+)\b(.*)$/gm)) {
    if (parCode.has(code)) continue;
    // `sev` vaut LA PASTILLE SEULE, comme en forme tableau : les appelants s'en servent
    // de clé de regroupement (`parSeverite[sev]`), et y verser tout le reste du titre
    // fabriquait un seau par constat au lieu d'un seau par sévérité.
    const pastille = SEVERITES_OUVERTES.find(s => reste.includes(s));
    if (!pastille) continue;
    parCode.set(code, { code, sev: pastille, ouvert: !CLOS_EN_TITRE.some(m => reste.includes(m)) });
  }
  const constats = [...parCode.values()];
  return { reconnu: constats.length > 0, constats };
};
