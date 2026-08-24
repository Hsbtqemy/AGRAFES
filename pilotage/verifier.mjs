#!/usr/bin/env node
// Contrôleur du dossier `pilotage/`.
//   node pilotage/verifier.mjs [--dir pilotage] [--strict] [--json]
// Aucune dépendance. Node 18+.
//
// Il vérifie ce qui est MÉCANIQUE. Le contrôle qui compte le plus — confronter
// chaque item de `Reste` au code — n'est pas automatisable : il demande de lire ce
// que la phrase affirme. Il est donc rapporté en fin de sortie comme un manque
// explicite, avec son compte. Un script vert qui laisserait croire qu'il couvre tout
// serait pire que pas de script du tout : sur le dépôt d'où vient cet outil, dix items
// confrontés à la main en ont livré un périmé — deux verbes donnés pour « absents »
// alors qu'ils existaient depuis six mois.
//
// Les règles de lecture viennent de `journal-contrat.mjs`, partagé avec le serveur :
// vérifier un contrat différent de celui qu'applique l'outil donnerait un vert sans
// valeur. `_TEMPLATE.md` DÉCRIT le contrat, `journal-contrat.mjs` le DÉFINIT ; quand
// les deux divergent, c'est le code qui fait foi.
//
// Sortie : ERREUR = l'outil lira mal, ou pas du tout. AVERTISSEMENT = le dossier
// dérive de son propre gabarit, mais l'écran reste juste. Code de retour non nul sur
// une ERREUR ; `--strict` le rend non nul sur un AVERTISSEMENT aussi.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { RX, frontmatter, walk, estPasse, STATUTS, constatsAudit } from "../journal-contrat.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const DIR    = opt("dir", "pilotage");
const STRICT = args.includes("--strict");
const JSON_  = args.includes("--json");
const ROOT   = process.cwd();

const erreurs = [], avertissements = [];
const err  = (ctl, file, msg) => erreurs.push({ ctl, file, msg });
const warn = (ctl, file, msg) => avertissements.push({ ctl, file, msg });

// ── lecture ──────────────────────────────────────────────────────────────────
const chantiers = [], passes = [];

for (const abs of await walk(join(ROOT, DIR))) {
  const rel  = relative(ROOT, abs).split(/[\\/]/).join("/");
  const text = await readFile(abs, "utf8");
  const fm   = frontmatter(text);
  const lines = text.split(/\r?\n/);

  // Sections et cases, dans l'ordre du fichier : c'est la position d'une case
  // relativement au dernier titre qui décide si l'outil la voit.
  let h2 = null, h3 = null;
  const cases = [];
  lines.forEach((l, i) => {
    const m2 = RX.h2.exec(l); if (m2) { h2 = m2[1].trim(); h3 = null; return; }
    const m3 = RX.h3.exec(l); if (m3) { h3 = m3[1].trim(); return; }
    const b = RX.box.exec(l);
    if (b) cases.push({ ligne: i + 1, h2, h3, indentee: /^\s+/.test(l), brut: l });
  });

  (estPasse(rel, fm) ? passes : chantiers).push({ rel, text, fm, cases, lines });
}

// ── contrôle 1 — contrat de parsing ──────────────────────────────────────────
const C1 = "contrat de parsing";
for (const c of chantiers) {
  // `chantier:` absent n'est PAS fatal : journal.mjs retombe sur le nom de fichier
  // (`fm.chantier || basename(rel)`). Le gabarit annonce « fichier ignoré » — c'est
  // faux, et c'est un avertissement, pas une erreur.
  if (!c.fm.chantier) warn(C1, c.rel, "pas de `chantier:` — l'outil retombe sur le nom de fichier");
  if (c.fm.statut && !STATUTS.includes(c.fm.statut))
    err(C1, c.rel, `statut « ${c.fm.statut} » hors de {${STATUTS.join(", ")}}`);
  if (c.fm.audit && !existsSync(join(ROOT, c.fm.audit)))
    err(C1, c.rel, `\`audit:\` pointe vers ${c.fm.audit}, absent du dépôt`);
  if (!RX.h1.exec(c.text)) warn(C1, c.rel, "pas de H1 — le code servira de titre");

  for (const b of c.cases) {
    // Seules les cases sous `## Reste` sont lues (comparaison en minuscules, comme
    // journal.mjs). Ailleurs, elles ne sont ni comptées ni cochables : invisibles.
    if ((b.h2 || "").toLowerCase() !== "reste")
      err(C1, c.rel, `ligne ${b.ligne} : case sous « ${b.h2 ?? "aucune section"} », invisible pour l'outil`);
    // L'outil TOLÈRE l'indentation (`RX.box` accepte l'espace initial) ; le gabarit
    // l'interdit (règle 3). Écart de style, pas de lecture.
    if (b.indentee) warn(C1, c.rel, `ligne ${b.ligne} : case indentée (règle 3 du gabarit)`);
  }
}
for (const p of passes) {
  if (!p.fm.passe) warn(C1, p.rel, "pas de `passe:` — le nom de fichier servira de nom");
  for (const b of p.cases) {
    if (!b.h3)
      warn(C1, p.rel, `ligne ${b.ligne} : case hors d'un H3 — regroupée sous « Général »`);
    if (b.indentee) warn(C1, p.rel, `ligne ${b.ligne} : case indentée (règle 3 du gabarit)`);
  }
}

// ── contrôle 2 — passes orphelines ───────────────────────────────────────────
// journal.mjs rattache par `passes.filter(p => p.chantier === ch.code)`. Un code qui
// ne correspond à aucune fiche n'est ni rattaché ni transversal : la passe disparaît
// de l'écran. C'est ce qui était arrivé à `smoke-u02.md` (chantier U-02 sans fiche).
const C2 = "passes orphelines";
const codes = new Set(chantiers.map(c => c.fm.chantier || c.rel.split("/").pop().replace(/\.md$/, "")));
for (const p of passes) {
  const ch = p.fm.chantier;
  if (ch && ch !== "—" && !codes.has(ch))
    err(C2, p.rel, `déclare \`chantier: ${ch}\`, qu'aucune fiche ne porte — ni rattachée, ni transversale`);
}

// ── contrôle 3 — `audit:` manquant sur un chantier ouvert ────────────────────
const C3 = "audit: manquant";
for (const c of chantiers) {
  const statut = c.fm.statut || "interrompu";
  const ouverts = c.cases.filter(b => (b.h2 || "").toLowerCase() === "reste" && !/\[[xX]\]/.test(b.brut)).length;
  if (statut !== "clos" && ouverts > 0 && !c.fm.audit)
    warn(C3, c.rel, `${ouverts} item(s) ouvert(s) sans \`audit:\` — la source des constats n'est pas atteignable depuis l'écran`);
}

// ── contrôle 4 — constats d'audit sans item correspondant ────────────────────
// Un constat ouvert qui n'est cité dans aucun `Reste` n'existe pas pour qui planifie
// depuis le journal : il ne vit que dans `docs/`. Mesuré une fois : douze constats
// dans ce cas sur un même audit, dont cinq sérieux.
const C4 = "constats sans item";
const audits = {};   // exploitable par l'écran : compte par audit et par sévérité
for (const c of chantiers) {
  if (!c.fm.audit) continue;
  const abs = join(ROOT, c.fm.audit);
  if (!existsSync(abs)) continue;                     // déjà signalé en contrôle 1
  const texte = await readFile(abs, "utf8");
  const reste = c.cases.filter(b => (b.h2 || "").toLowerCase() === "reste")
                       .map(b => b.brut).join("\n");

  // La lecture du tableau vient de `journal-contrat.mjs` : le serveur remonte les
  // mêmes codes vers le chantier, et deux copies de cette règle donneraient des
  // chiffres plausibles et contradictoires. `reconnu` distingue « aucun constat
  // ouvert » de « je ne sais pas lire ce document » — un vert qui ne mesure rien,
  // et le premier défaut que ce script a trouvé chez lui-même le 2026-08-20
  // (AUDIT_2026-06-12 et trois autres).
  const { reconnu, constats } = constatsAudit(texte);
  const parSeverite = {}, sansItem = [];
  let total = 0;
  for (const { code, sev, ouvert } of constats) {
    if (!ouvert) continue;                            // ✅ ou barré : clos
    total++;
    parSeverite[sev] = (parSeverite[sev] || 0) + 1;
    if (!reste.includes(code)) sansItem.push({ code, sev });
  }
  audits[c.fm.audit] = { chantier: c.fm.chantier, reconnu, total, parSeverite, sansItem: sansItem.length, sansItemCodes: sansItem.map(f => f.code) };
  if (!reconnu) {
    warn(C4, c.rel,
      `${c.fm.audit} : aucun tableau de constats reconnu (forme attendue : « | CODE-00 | sévérité | … »)`
      + " — le compte affiché n'est pas 0, il est INCONNU");
  }
  if (sansItem.length) {
    const oranges = sansItem.filter(f => f.sev.includes("🔴") || f.sev.includes("🟠")).map(f => f.code);
    warn(C4, c.rel,
      `${sansItem.length} constat(s) ouvert(s) de ${c.fm.audit} sans item dans le Reste`
      + (oranges.length ? ` — dont ${oranges.length} 🔴/🟠 : ${oranges.join(", ")}` : ""));
  }
}

// ── le contrôle qui manque ───────────────────────────────────────────────────
const itemsOuverts = chantiers.reduce(
  (n, c) => n + c.cases.filter(b => (b.h2 || "").toLowerCase() === "reste" && !/\[[xX]\]/.test(b.brut)).length, 0);

// ── sortie ───────────────────────────────────────────────────────────────────
if (JSON_) {
  console.log(JSON.stringify({
    chantiers: chantiers.length, passes: passes.length,
    erreurs, avertissements, audits,
    nonCouvert: { controle: "confrontation des items au code", items: itemsOuverts }
  }, null, 2));
} else {
  const ligne = (x) => `   ${x.file}  ${x.msg}`;
  const bloc = (titre, xs) => {
    if (!xs.length) return;
    console.log(`\n${titre}`);
    for (const ctl of [...new Set(xs.map(x => x.ctl))]) {
      console.log(`  ── ${ctl}`);
      xs.filter(x => x.ctl === ctl).forEach(x => console.log(ligne(x)));
    }
  };
  console.log(`pilotage/ — ${chantiers.length} chantiers, ${passes.length} passes`);
  bloc("ERREURS — l'outil lira mal, ou pas du tout", erreurs);
  bloc("AVERTISSEMENTS — le dossier dérive de son gabarit, l'écran reste juste", avertissements);
  if (!erreurs.length && !avertissements.length) console.log("\nLes quatre contrôles mécaniques passent.");

  if (Object.keys(audits).length) {
    console.log("\nCONSTATS OUVERTS PAR AUDIT");
    for (const [f, a] of Object.entries(audits)) {
      if (!a.reconnu) { console.log(`   ${f}  (${a.chantier})  format non reconnu — compte INCONNU`); continue; }
      const detail = Object.entries(a.parSeverite).map(([s, n]) => `${s}${n}`).join(" ");
      console.log(`   ${f}  (${a.chantier})  ${a.total} ouvert(s)  ${detail}  · sans item : ${a.sansItem}`);
    }
  }

  // Le manque, en dernier et en toutes lettres.
  console.log(`\nNON COUVERT — confrontation des ${itemsOuverts} items au code : à faire à la main.`);
  console.log("   Aucun contrôle mécanique ne peut dire si « X est absent » est encore vrai :");
  console.log("   il faut ouvrir le fichier que la phrase désigne.");
}

const echec = erreurs.length > 0 || (STRICT && avertissements.length > 0);
process.exit(echec ? 1 : 0);
