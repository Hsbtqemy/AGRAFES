#!/usr/bin/env node
// Journal de bord — serveur local.
//   node journal.mjs [--port 4123] [--dir pilotage] [--days 60]
// Aucune dépendance. Node 18+.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
// Contrat de parsing partage avec pilotage/verifier.mjs -- voir journal-contrat.mjs.
import { RX, frontmatter, walk, estPasse, constatsAudit } from "./journal-contrat.mjs";

// Une case peut tenir sur plusieurs lignes : les suivantes sont indentees, et ne sont
// ni une autre case ni un titre. Le parseur, ligne a ligne, les jetait EN SILENCE --
// ce qui coupait l'item a sa moitie « attendu ». Mesure le 2026-08-21 sur le dossier :
// 21 cases tronquees, dont 15 DEJA COCHEES. L'une d'elles, cochee, se lisait « Croiser
// une portee vide — document X et langue fr — » sans plus rien dire de ce qui devait se
// passer : on coche ce qu'on voit.
//
// Le numero de ligne rendu reste celui de la CASE, donc l'ecriture des coches
// (`ecrireCase`) n'est pas concernee : elle vise toujours la bonne ligne.
const suiteDeCase = (lines, i) => {
  const bouts = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || !/^\s/.test(l) || RX.box.test(l)) break;
    bouts.push(l.trim());
  }
  return bouts.length ? " " + bouts.join(" ") : "";
};

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const PORT = Number(opt("port", 4123));
const DIR  = opt("dir", "pilotage");
const DAYS = Number(opt("days", 60));
const ROOT = process.cwd();
// Où vit l'OUTIL, par opposition à où vit le DÉPÔT. Lancé par `npx`, le serveur est
// dans node_modules et le dépôt est le cwd. Confondre les deux, c'est chercher la vue
// et le contrôleur dans le projet de l'utilisateur — qui ne les a pas. Sur un dépôt
// qui héberge l'outil lui-même, les deux coïncident et rien ne change.
const OUTIL = dirname(fileURLToPath(import.meta.url));
// Longueur de la traînée de commits affichée sur une fiche.
const TRAINEE = Number(opt("trainee", 5));

// ---------- ce que le journal sait de ce dépôt ----------
// Tout ce qui nomme des chemins, des fichiers ou des codes vit dans
// `pilotage/journal.config.mjs`, à côté du dossier qu'il décrit. Le fichier est
// facultatif : sans lui, on garde le dossier (fiches, passes, cases, contrôleur,
// front d'intégration) et on perd ce qui exige de connaître le dépôt — les masses
// par aire, la veille à seuil, les liens code → document.
const DEFAUT = {
  refs: ["origin/main"],
  codes: { chantier: RX.chantier, decision: RX.decision, adr: RX.adr },
  documentation: null,
  aires: [],
  veille: null
};
const CFG = await (async () => {
  const p = join(ROOT, DIR, "journal.config.mjs");
  if (!existsSync(p)) return DEFAUT;
  // `import()` d'un chemin Windows nu échoue : il faut une URL file://.
  const m = await import(pathToFileURL(p).href).catch(e => {
    console.error(`config illisible (${p}) : ${e.message} — on continue sans.`);
    return null;
  });
  return { ...DEFAUT, ...(m ? (m.default || m) : {}) };
})();

// Refs d'intégration, de l'amont vers l'aval. Un chantier vit sur la première qui
// contient son dernier commit ; à défaut sur la branche courante, donc pas intégré.
const REFS = opt("refs", CFG.refs.join(","))
  .split(",").map(s => s.trim()).filter(Boolean);

// Lecture synchrone tolérante : un document annoncé par une fiche peut avoir disparu.
const lireSync = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// Rend null quand la commande ÉCHOUE, "" quand elle réussit sans rien dire. `git()` écrase
// les deux, ce qui convient partout où une absence vaut zéro — mais pas là où un zéro
// serait lui-même une mesure. Payé une fois : un `--format=@` invalide (git y lit un NOM
// de format) faisait rendre "" pour chaque audit, donc « 0 commit depuis » sur les dix,
// un vert parfaitement faux.
//
// stderr ignoré : sur un dépôt sans commit, git écrit huit `fatal:` sur la console avant
// que le journal ait rendu sa première page. C'est le `catch` qui décide, pas le bruit.
const gitEssai = (...a) => {
  try { return execFileSync("git", a,
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};

const git = (...a) => gitEssai(...a) ?? "";

// ---------- lecture de pilotage/ ----------
async function pilotage() {
  const files = await walk(join(ROOT, DIR));
  const chantiers = [], passes = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs).split(/[\\/]/).join("/");
    const text = await readFile(abs, "utf8");
    const fm = frontmatter(text);
    const lines = text.split(/\r?\n/);
    const titre = (RX.h1.exec(text) || [, basename(rel, ".md")])[1];

    if (estPasse(rel, fm)) {
      // --- passe de QA : cases regroupées par H3 ---
      const zones = []; let cur = null;
      lines.forEach((l, i) => {
        const h3 = RX.h3.exec(l);
        if (h3) { cur = { nom: h3[1].trim(), items: [] }; zones.push(cur); return; }
        const b = RX.box.exec(l);
        if (b) {
          if (!cur) { cur = { nom: "Général", items: [] }; zones.push(cur); }
          cur.items.push({ texte: (b[2] + suiteDeCase(lines, i)).trim(), fait: b[1].toLowerCase() === "x", ligne: i + 1 });
        }
      });
      const tot = zones.reduce((n, z) => n + z.items.length, 0);
      passes.push({
        file: rel, nom: fm.passe || titre, titre,
        chantier: (fm.chantier && fm.chantier !== "—") ? fm.chantier : null,
        duree: fm.duree || null,
        derniere: (fm.derniere && fm.derniere !== "—") ? fm.derniere : null,
        intro: intro(text), zones, total: tot,
        faits: zones.reduce((n, z) => n + z.items.filter(i => i.fait).length, 0)
      });
    } else {
      // --- fiche de chantier ---
      // Le `Reste` accepte les mêmes zones `###` qu'une passe. Sans elles, une fiche
      // à seize items aplatit des groupes qui existent déjà — trois items T6 qui ont
      // un ordre, trois sur l'annulation, quatre arbitrages — et oblige à tout
      // re-trier de tête à chaque ouverture. Zone nulle = liste simple, comme avant.
      const reste = []; let section = null, zone = null;
      lines.forEach((l, i) => {
        const h2 = RX.h2.exec(l);
        if (h2) { section = h2[1].trim().toLowerCase(); zone = null; return; }
        const h3 = RX.h3.exec(l); if (h3) { zone = h3[1].trim(); return; }
        const b = RX.box.exec(l);
        if (b && section === "reste")
          reste.push({ texte: (b[2] + suiteDeCase(lines, i)).trim(),
                       fait: b[1].toLowerCase() === "x", ligne: i + 1, zone });
      });
      chantiers.push({
        file: rel, code: fm.chantier || basename(rel, ".md"), titre,
        statut: fm.statut || "interrompu",
        audit: fm.audit || null,
        arrete: (RX.arret.exec(text) || [, null])[1],
        reste, contexte: bloc(text, "Contexte")
      });
    }
  }
  return { chantiers, passes };
}

const intro = (text) => {
  const t = text.replace(RX.fm, "").replace(RX.h1, "");
  const cut = t.search(/^###\s+/m);
  return (cut > -1 ? t.slice(0, cut) : t).trim();
};

const bloc = (text, nom) => {
  const lines = text.split(/\r?\n/); let on = false; const out = [];
  for (const l of lines) {
    const h2 = RX.h2.exec(l);
    if (h2) { on = h2[1].trim().toLowerCase() === nom.toLowerCase(); continue; }
    if (on) out.push(l);
  }
  return out.join("\n").trim();
};

// ---------- git ----------
function historique() {
  const jours = [...new Set(git("log", "--all", "--format=%ad", "--date=short").split("\n").filter(Boolean))].sort();
  const raw = git("log", "--all", "--format=%h\x1f%H\x1f%ad\x1f%s\x1f%b\x1e", "--date=short");
  const commits = raw.split("\x1e").map(c => c.trim()).filter(Boolean).map(c => {
    const [hash, full, date, sujet, corps] = c.split("\x1f");
    const sc = /^([a-z]+)(?:\(([^)]+)\))?:/.exec(sujet || "");
    return { hash, full, date, sujet: sujet || "", corps: (corps || "").trim(),
             type: sc ? sc[1] : null, scope: sc ? (sc[2] || sc[1]) : "—" };
  });
  return { jours, commits };
}

const joursActifs = (jours, depuis) => jours.filter(j => j > depuis).length;

// Remontée des codes de constat vers leur chantier. Le travail réel cite le constat
// (`ALI-10`), jamais le chantier (`R3`) : sans ça, le chantier n'est daté que par les
// notes qu'on écrit SUR lui. Trois gardes, parce que les audits se citent entre eux :
//   — le code doit venir du TABLEAU de constats, pas de la prose : un audit en
//     mentionne un autre en renvoi, son tableau non ;
//   — l'audit doit n'être possédé que par UNE fiche — mesuré : un même audit cité par
//     quatre chantiers verrait ses orphelins remonter aux quatre ;
//   — le code ne doit pas avoir de fiche à lui.
// Les constats clos comptent aussi : un commit citant `ALI-10` est du travail sur son
// chantier, que le constat soit soldé ou non.
async function remontee(chantiers) {
  const fiches = new Set(chantiers.map(c => c.code));
  const proprio = {};
  for (const c of chantiers) if (c.audit) (proprio[c.audit] ||= []).push(c.code);
  const out = {};
  for (const c of chantiers) {
    if (!c.audit || proprio[c.audit].length !== 1) continue;
    const texte = await readFile(join(ROOT, c.audit), "utf8").catch(() => "");
    const { reconnu, constats } = constatsAudit(texte);
    if (!reconnu) continue;
    const codes = [...new Set(constats.map(x => x.code))].filter(x => !fiches.has(x));
    if (codes.length) out[c.code] = codes;
  }
  return out;
}

// Un `Arrêté sur` est décalé s'il ne cite pas le dernier commit du chantier — y
// compris quand il ne cite aucun hash du tout. Sans `dernier`, on ne peut rien dire.
const c_arreteDecale = (ch) => {
  if (!ch.arrete || !ch.dernier) return false;
  const cites = ch.arrete.match(/\b[0-9a-f]{7,40}\b/g) || [];
  return !cites.some(h => ch.dernier.hash.startsWith(h) || h.startsWith(ch.dernier.hash));
};

const echappe = (c) => c.replace(/[.]/g, "\\.");
const rxCodes = (codes) =>
  new RegExp(`(^|[^A-Za-z0-9-])(${codes.map(echappe).join("|")})([^A-Za-z0-9-]|$)`);

// Un commit qui touche 3 CHANTIERS ou plus est un fourre-tout : il ne date rien.
// Compter les codes bruts serait faux depuis la remontée — un commit citant ALI-01,
// ALI-10 et ALI-22 est du R3 pur, pas un fourre-tout.
//
// Le compte se fait sur le vocabulaire DÉCLARÉ — les codes des fiches, plus ceux qu'elles
// remontent de leurs audits — et non sur un motif générique. Un motif ne sait pas ce qui
// est un chantier ICI : mesuré sur un dépôt réel, il prenait ADR-043 pour un chantier
// dans douze sujets, et comptait R3.3 comme distinct de R3 alors que c'en est une
// tranche. L'écart total est de huit verdicts sur mille cent quatre-vingt-deux, dont six
// sans conséquence — le sujet ne cite alors aucun chantier connu et ne date rien.
//
// La DÉCOUVERTE, elle, garde son motif : index() doit reconnaître des codes qu'aucune
// fiche ne déclare, pour renvoyer vers le document qui les a écrits. Attribuer demande un
// vocabulaire, découvrir demande un motif — ce ne sont pas le même besoin, et le second
// ne fausse que des liens, jamais un datage.
const fourretout = (sujet, rx, proprietaire) =>
  new Set([...sujet.matchAll(rx)].map(m => proprietaire[m[2]] || m[2])).size >= 3;

// Le motif qui EXTRAIT d'un sujet tous les codes connus du dossier. Trié du plus long au
// plus court : sans ça, R6 masquerait R6.5 dans l'alternance si les deux étaient déclarés.
const rxVocabulaire = (codes) => new RegExp(
  "(^|[^A-Za-z0-9-])(" + [...codes].sort((a, b) => b.length - a.length).map(echappe).join("|")
  + ")(?=[^A-Za-z0-9-]|$)", "g");

// Les commits d'un chantier, du plus récent au plus ancien. `tenue` = ceux qui ne
// touchent que `pilotage/` : tenir le dossier n'est pas travailler sur le chantier
// dont on parle — sans cette garde, une note « recompter l'item de R3 » remettait le
// silence de R3 à zéro.
const commitsDuChantier = (commits, codes, rxVoc, proprietaire, tenue) => {
  const rx = rxCodes(codes);
  return commits.filter(c =>
    rx.test(c.sujet) && !fourretout(c.sujet, rxVoc, proprietaire) && !tenue.has(c.hash));
};

// Front d'intégration : jusqu'où le travail est remonté. Dérivé, jamais déclaré.
function fronts() {
  const set = (r) => new Set(git("rev-list", r).split("\n").filter(Boolean));
  const l = REFS.map(nom => ({ nom, integre: true, hashes: set(nom) })).filter(f => f.hashes.size);
  const tete = git("rev-parse", "--abbrev-ref", "HEAD");
  if (tete && tete !== "HEAD" && !REFS.includes(tete))
    l.push({ nom: tete, integre: false, hashes: set(tete) });
  return l;
}

// ---------- masses de code ----------
// Les aires viennent de la config du dépôt (voir `pilotage/journal.config.mjs`) :
// un préfixe de chemin chacune, le premier qui matche l'emporte. Les tailles sont
// le cumul de `--numstat` : vérifié exact au fichier près sur 6 aires, à condition
// de désactiver la détection de renommage (sinon le chemin sort en
// `{ancien => nouveau}`). Sans aires déclarées, l'onglet reste vide — mais la passe
// tourne quand même : c'est elle qui repère les commits de tenue.
const AIRES = CFG.aires;
// Le dossier de documentation du dépôt, quand il est déclaré : sert à distinguer un
// commit de cadrage (note + fiche) d'un commit de code. Sans config, aucun démenti.
const DOCS = CFG.documentation?.dossier || null;

// `fenetre` en mois : sur 6 le delta égale presque la masse et le classement retombe
// sur la taille ; sur 3 les reculs ressortent (screens, ui) et le tri dit qui bouge.
// La passe --numstat coûte ~2,5 s sur 1 000 commits : mémorisée sur le hash de HEAD,
// sinon chaque coche de case repayerait le parcours complet de l'historique.
const masses = (seuil = 1000, fenetre = 3) => surTete("masses", () => calculMasses(seuil, fenetre));

function calculMasses(seuil, fenetre) {
  const aire = (p) => { for (const [n, pre] of AIRES) if (p === pre || p.startsWith(pre)) return n; return null; };
  const raw = git("log", "--reverse", "--no-renames", "--numstat",
                  "--format=@%h\x1f%ad\x1f%s", "--date=short");
  if (!raw) return null;

  const cum = {}, serie = {}, mois = [], jalons = [], tenue = [], redaction = [];
  for (const [n] of AIRES) { cum[n] = 0; serie[n] = []; }
  let m = null, c = null, net = 0, nf = 0, npil = 0, ndoc = 0;
  const clore = () => {
    if (!c) return;
    if (net <= -seuil) jalons.push({ ...c, delta: net });
    // Ne touche que `pilotage/` : de la tenue de dossier, pas du travail daté.
    if (nf > 0 && nf === npil) tenue.push(c.hash);
    // Ne touche que `pilotage/` et la doc : du cadrage écrit, pas du code. Sert au
    // seul démenti du statut `à venir` — surtout PAS au silence, où écrire une note
    // de conception est un vrai travail sur le chantier.
    if (nf > 0 && nf === npil + ndoc) redaction.push(c.hash);
  };
  const graver = () => { mois.push(m); for (const [n] of AIRES) serie[n].push(cum[n]); };

  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) {
      clore();
      const [hash, date, sujet] = l.slice(1).split("\x1f");
      const mm = date.slice(0, 7);
      if (m && m !== mm) graver();
      m = mm; c = { hash, date, sujet }; net = 0; nf = 0; npil = 0; ndoc = 0;
      continue;
    }
    const f = l.split("\t");
    if (f.length < 3 || !/^\d+$/.test(f[0])) continue;   // binaire (`-`) ou ligne vide
    const n = Number(f[0]) - Number(f[1]);
    net += n; nf++;
    if (f[2].startsWith(DIR + "/")) npil++;
    else if (DOCS && f[2].startsWith(DOCS + "/")) ndoc++;
    const a = aire(f[2]); if (a) cum[a] += n;
  }
  clore();
  if (m) graver();

  const aires = AIRES.map(([nom]) => {
    const v = serie[nom], tot = v[v.length - 1] || 0;
    return { nom, valeurs: v, total: tot, delta: tot - (v[Math.max(0, v.length - 1 - fenetre)] ?? 0) };
  }).filter(a => a.total > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { mois, fenetre, aires, tenue, redaction,
           jalons: jalons.sort((a, b) => a.delta - b.delta).slice(0, 8) };
}

// ---------- veille à seuil ----------
// Le seul chiffre du tableau de bord qui ait une limite réelle ; déclaré par dépôt
// (voir `pilotage/journal.config.mjs`). Absent = pas de bandeau de veille.
const VEILLE = CFG.veille;

// Mémo sur le hash de HEAD : ce qui ne dépend que de l'historique se recalcule au commit
// suivant, pas à chaque coche de case. (Le contrôleur, lui, lit les fichiers de
// `pilotage/` — il doit rester vivant, il n'est pas mémorisé.)
//
// La tête est lue UNE fois par requête, pas à chaque consultation de clé. Mesuré : avec
// une quarantaine de clés, `rev-parse HEAD` était appelé 47 fois et coûtait 1,16 s — le
// mémo dépensait plus qu'il n'économisait. `build()` remet le cache à zéro en entrant.
const memos = new Map();
let TETE = null;
const tete = () => TETE ?? (TETE = git("rev-parse", "HEAD"));
const surTete = (cle, fn) => {
  const t = tete(), m = memos.get(cle);
  if (t && m && m.tete === t) return m.val;
  const val = fn();
  memos.set(cle, { tete: t, val });
  return val;
};

// Quand chaque document est entré dans le dépôt. Le nom de fichier porte souvent la date,
// mais pas toujours, et il peut mentir : `--diff-filter=A` la donne pour n'importe quel
// fichier, sans convention de nommage.
//
// UNE passe pour tout l'arbre, pas une par chemin. Mesuré : trente et un relevés séparés
// coûtaient 4,7 s au démarrage, chacun parcourant l'historique entier pour un seul
// fichier. Le journal sort du plus récent au plus ancien, donc la DERNIÈRE occurrence
// d'un chemin est son entrée.
const entrees = () => surTete("entrees", () => {
  const raw = git("log", "--all", "--diff-filter=A", "--name-only",
                  "--format=@%ad", "--date=short");
  const par = new Map();
  let d = null;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { d = l.slice(1); continue; }
    if (l.trim() && d) par.set(l, d);
  }
  return par;
});

const entree = (chemin) => entrees().get(chemin) || null;

const gardeFou = () => surTete("veille", calculGardeFou);

function calculGardeFou() {
  if (!VEILLE) return null;
  const raw = git("log", `--since=${VEILLE.jours} days ago`, "--numstat", "--format=", "--", VEILLE.fichier);
  if (!raw) return null;
  let a = 0, d = 0;
  for (const l of raw.split("\n")) {
    const f = l.split("\t");
    if (/^\d+$/.test(f[0])) { a += Number(f[0]); d += Number(f[1]); }
  }
  return { ...VEILLE, net: a - d };
}

// ---------- branches en vol ----------
// Une branche n'existe à l'écran que si un chantier la porte, et un chantier n'est porté
// que si un commit cite son code. Le travail qui échappe aux deux est invisible : mesuré
// sur un dépôt réel, cinq commits de fonctionnalité sur quatorze en vol — de l'italique à
// l'import, une borne sur un run d'alignement — qu'aucune fiche ne pouvait montrer.
//
// Ce n'est pas un défaut de l'outil mais de la discipline qu'il mesure : les sujets ne
// citaient pas de code. C'est précisément ce qu'il doit rendre visible.
//
// Le test de « porté » réutilise ce qui existe : le motif des codes déclarés, et la table
// fichiers-par-commit, dont un ensemble VIDE signale un commit qui n'a touché que le
// dossier ou la documentation — de la tenue ou du cadrage, pas du travail à rattacher.
function branchesEnVol(codes, parCommit) {
  const brut = git("for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes");
  const court = (r) => r.replace(/^[^/]+\//, "");
  const estRef = (r) => REFS.includes(r) || REFS.includes(court(r));
  const rx = codes.length ? rxCodes(codes) : null;
  const par = new Map();

  for (const ref of brut.split("\n").map(x => x.trim()).filter(Boolean)) {
    if (!ref || ref.endsWith("/HEAD") || estRef(ref)) continue;
    const liste = git("rev-list", "--format=%h\x1f%s", "--no-commit-header",
                      ref, ...REFS.map(r => "^" + r))
      .split("\n").filter(Boolean).map(l => { const [hash, sujet] = l.split("\x1f"); return { hash, sujet }; });
    if (!liste.length) continue;   // fusionnée : rien à signaler

    const orphelins = liste.filter(c =>
      (parCommit.get(c.hash)?.size || 0) > 0 && !(rx && rx.test(c.sujet)));
    const tete = git("log", "-1", "--format=%h\x1f%ad\x1f%s", "--date=short", ref).split("\x1f");
    const e = { nom: ref, avance: liste.length, orphelins: orphelins.length,
                exemples: orphelins.slice(0, 3).map(c => ({ hash: c.hash, sujet: c.sujet })),
                dernier: { hash: tete[0], date: tete[1], sujet: tete[2] } };
    // Locale et distante de même nom sont la même branche à deux tips. On garde la plus
    // avancée plutôt que d'afficher deux lignes pour un seul travail.
    const cle = court(ref);
    const a = par.get(cle);
    if (!a || e.avance > a.avance) par.set(cle, e);
  }
  return [...par.values()].sort((a, b) => b.orphelins - a.orphelins || b.avance - a.avance);
}

// ---------- collisions entre chantiers ----------
// Deux chantiers qui ont touché les mêmes fichiers se marcheront dessus à la reprise.
// La relation existe déjà dans les fiches, écrite à la main — et mesurée le 2026-08-25,
// les trois chiffres inscrits étaient tous faux, tous sous-évalués (14→21, 12→25,
// 25→31), et la deuxième collision du dépôt n'était écrite nulle part. Une déclaration
// manuelle enregistre ce à quoi on a pensé, jamais ce qu'on a manqué.
//
// `docs/` et le dossier de pilotage sont écartés : deux chantiers qui citent le même
// audit ne se marchent pas dessus, ils se réfèrent au même document.
const fichiersParCommit = () => surTete("fichiers", () => {
  const raw = git("log", "--all", "--no-renames", "--name-only", "--format=@%h");
  const par = new Map();
  const exclus = [DIR + "/", CFG.documentation?.dossier && CFG.documentation.dossier + "/"]
    .filter(Boolean);
  let cur = null;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { cur = new Set(); par.set(l.slice(1), cur); continue; }
    if (!l.trim() || !cur) continue;
    if (exclus.some(e => l.startsWith(e))) continue;
    cur.add(l);
  }
  return par;
});

const fichiersDe = (liste, par) => {
  const s = new Set();
  for (const c of liste) for (const f of par.get(c.hash) || []) s.add(f);
  return s;
};

// Le nombre seul ne suffit pas : une collision avec un chantier clos est un empiètement
// HISTORIQUE — le terrain est stabilisé — tandis qu'avec un chantier vivant c'est un
// risque présent. Même nombre, situation opposée. L'état de l'autre voyage donc avec.
const collisions = (moi, sets, chantiers) => {
  const a = sets.get(moi.code);
  if (!a || !a.size) return null;
  const out = [];
  for (const o of chantiers) {
    if (o.code === moi.code) continue;
    const b = sets.get(o.code);
    if (!b || !b.size) continue;
    let n = 0;
    for (const f of a) if (b.has(f)) n++;
    if (n) out.push({ code: o.code, n, statut: o.statut, silence: o.silence });
  }
  return out.length ? out.sort((x, y) => y.n - x.n) : null;
};

// ---------- portée d'un audit ----------
// Un audit observe le code à la date où il est écrit. Le code bouge ensuite, souvent par
// d'autres chantiers. Ce qui est mesuré ici n'est PAS qu'un constat est réglé — aucune
// mesure ne peut le dire — mais que le sol a bougé sous lui, donc qu'il faut le relire
// avant de planifier dessus.
//
// Les chemins sont trouvés par leur forme, puis filtrés par leur EXISTENCE dans l'arbre.
// Une liste de dossiers ou d'extensions admis serait exactement le réglage propre à un
// dépôt qu'on refuse d'introduire ; ce qui n'existe pas n'est pas un chemin.
//
// Le dossier de pilotage et celui de la documentation sont écartés : un audit qui en
// cite un autre parle de lui-même, pas du code qu'il décrit.
const RX_CHEMIN = /\b[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}\b/g;
// Au-delà, la ligne de commande git dépasse la limite du système. Le compte devient
// partiel et le DIT (`tronque`), plutôt que de mentir par un chiffre trop bas.
const MAX_CHEMINS = 80;

function calculPortee(fichier, depuis) {
  const texte = lireSync(join(ROOT, fichier));
  if (texte === null || !depuis) return null;
  const exclus = [DIR + "/", CFG.documentation?.dossier && CFG.documentation.dossier + "/"]
    .filter(Boolean);
  const vus = new Set();
  for (const m of texte.match(RX_CHEMIN) || []) {
    const c = m.replace(/^\.\//, "");
    if (exclus.some(e => c.startsWith(e))) continue;
    if (!vus.has(c) && existsSync(join(ROOT, c))) vus.add(c);
  }
  const chemins = [...vus];
  const vises = chemins.slice(0, MAX_CHEMINS);
  // Zéro chemin n'est pas zéro mouvement : c'est « je n'ai pas su regarder ». Les deux
  // doivent se distinguer à l'écran, sinon un audit qui parle de comportements plutôt
  // que de fichiers passerait pour un audit dont le code n'a pas bougé.
  if (!vises.length) return { chemins: 0, tronque: false, commits: null, plus: 0, moins: 0, depuis };

  // `--format=@` seul est refusé par git, qui y lit un NOM de format ; il faut au moins un
  // placeholder. Et l échec doit remonter en « inconnu », pas en zéro.
  const raw = gitEssai("log", "--all", "--no-renames", "--numstat", "--format=@%h",
                       "--since=" + depuis, "--", ...vises);
  if (raw === null) return { chemins: chemins.length, tronque: false, commits: null,
                             plus: 0, moins: 0, depuis, echec: true };
  let commits = 0, plus = 0, moins = 0;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) { commits++; continue; }
    const f = l.split("\t");
    if (/^\d+$/.test(f[0])) { plus += Number(f[0]); moins += Number(f[1]); }
  }
  return { chemins: chemins.length, tronque: chemins.length > MAX_CHEMINS,
           commits, plus, moins, depuis };
}

const portee = (fichier, depuis) =>
  surTete(`portee:${fichier}:${depuis}`, () => calculPortee(fichier, depuis));

// ---------- contrôleur du dossier ----------
// `pilotage/verifier.mjs` s'exécute au chargement et sort par process.exit : on le
// lance en processus fils plutôt que de l'importer. Code de retour non nul = il a
// trouvé des erreurs, pas qu'il a planté — la sortie JSON reste bonne.
function controleur() {
  // Celui de l'outil d'abord : un exemplaire copié dans un projet et laissé en arrière
  // vérifierait un contrat que le serveur n'applique plus.
  const p = [join(OUTIL, "pilotage", "verifier.mjs"), join(ROOT, DIR, "verifier.mjs")]
    .find(existsSync);
  if (!p) return null;
  const lire = (s) => { try { return JSON.parse(s || ""); } catch { return null; } };
  try {
    return lire(execFileSync(process.execPath, [p, "--json", "--dir", DIR],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 16e6, stdio: ["ignore", "pipe", "ignore"] }));
  } catch (e) { return lire(e.stdout); }
}

// ---------- index de navigation ----------
// D'où vient un code : le document qui l'a écrit, pour que l'écran y renvoie. Les
// règles — quels fichiers, quel vocabulaire — sont propres au dépôt et déclarées
// dans la config. Première source qui cite un code l'emporte, sauf `ecrase` : les
// ADR font foi contre une note de conception qui les mentionne.
async function index() {
  const map = {};
  const cfg = CFG.documentation;
  if (!cfg) return map;

  const dossier = join(ROOT, cfg.dossier);
  let noms = []; try { noms = (await readdir(dossier)).filter(n => n.endsWith(".md")); } catch {}

  for (const n of noms) {
    const p = `${cfg.dossier}/${n}`;
    const t = await readFile(join(dossier, n), "utf8").catch(() => "");
    for (const s of cfg.sources) {
      if (!s.fichiers.test(n)) continue;
      for (const c of new Set(t.match(CFG.codes[s.codes]) || []))
        if (s.ecrase) map[c] = p; else map[c] ||= p;
    }
  }
  return map;
}

// ---------- assemblage ----------
async function build() {
  TETE = null;   // une lecture de HEAD par requête, pas une par clé de mémo

  const { jours, commits } = historique();
  const { chantiers, passes } = await pilotage();
  const liens = await index();
  const fr = fronts();
  const mss = masses();
  // La passe des masses suit HEAD, pas `--all` : un commit de tenue posé sur une
  // autre branche ne sera pas reconnu comme tel. Sans conséquence en pratique.
  const tenue = new Set(mss?.tenue || []);
  const redaction = new Set(mss?.redaction || []);
  const rem = await remontee(chantiers);
  const proprietaire = {};
  for (const [ch, codes] of Object.entries(rem)) for (const c of codes) proprietaire[c] = ch;
  // Le vocabulaire du dépôt, dérivé de son dossier : ce que les fiches déclarent, plus ce
  // qu'elles remontent de leurs audits. Rien à régler, rien à tenir à jour.
  const rxVoc = rxVocabulaire(new Set([...chantiers.map(c => c.code), ...Object.keys(proprietaire)]));

  const parCommit = fichiersParCommit(), sets = new Map();
  for (const ch of chantiers) {
    const codes = [ch.code, ...(rem[ch.code] || [])];
    ch.remontee = rem[ch.code] || null;
    const liste = commitsDuChantier(commits, codes, rxVoc, proprietaire, tenue);
    const last = liste[0] || null;
    ch.dernier = last ? { hash: last.hash, date: last.date, sujet: last.sujet } : null;
    // L'autre borne. `dernier` seul ne distingue pas un sprint de trois jours d'une
    // tresse de deux mois : mesuré, deux chantiers affichaient une carte identique pour
    // 7 commits en 3 jours d'un côté, 9 commits sur 64 jours de l'autre.
    const first = liste[liste.length - 1] || null;
    ch.premier = first ? { hash: first.hash, date: first.date } : null;
    ch.auditDate = ch.audit ? entree(ch.audit) : null;
    // Quand la fiche elle-même est entrée. Sans elle, un chantier `à venir` n'a aucune
    // marque sur l'axe du temps : pas de commit, donc pas de barre, donc invisible là où
    // il est justement le plus utile de le voir — récent et pas commencé.
    ch.ficheDate = entree(ch.file);
    ch.portee = ch.audit ? portee(ch.audit, ch.auditDate) : null;
    ch.silence = last ? joursActifs(jours, last.date) : null;
    const f = last ? fr.find(x => x.hashes.has(last.full)) : null;
    ch.front = f ? { ref: f.nom, integre: f.integre } : null;
    ch.commits = liste.length;
    // Les commits qui touchent autre chose que la doc et le dossier de pilotage. Un
    // `à venir` qui en porte n'est plus à venir : c'est le seul démenti mécanique du
    // statut déclaré, et il ne coûte aucune passe git de plus.
    ch.commitsCode = liste.filter(c => !redaction.has(c.hash)).length;
    // La traînée : `Arrêté sur` est une pile de profondeur un, réécrite à chaque
    // reprise. Mesuré le 2026-08-22 : 4 fiches sur 14 la portaient périmée, et
    // c'étaient les trois plus actives — elle ne tient que là où on n'en a pas besoin.
    ch.trainee = liste.slice(0, TRAINEE).map(c => ({ hash: c.hash, date: c.date, sujet: c.sujet }));
    // Le point de reprise cite-t-il encore le dernier commit ? Mesuré le 22 août :
    // 4 fiches sur 14 non, et c'étaient les trois plus actives. La traînée le rendait
    // visible ; ceci le compte, ce qui est la différence entre voir et savoir.
    // Un `à venir` n'a pas de point de reprise à périmer : sa ligne est un point de
    // départ, elle ne cite aucun commit et n'a pas à en citer un.
    ch.arreteDecale = ch.statut !== "à venir" && Boolean(c_arreteDecale(ch));
    sets.set(ch.code, fichiersDe(liste, parCommit));
    ch.passes = passes.filter(p => p.chantier === ch.code).map(p => p.file);
    liens[ch.code] = `#/c/${encodeURIComponent(ch.code)}`;
  }
  // Une seconde passe : croiser deux chantiers suppose les deux ensembles construits.
  for (const ch of chantiers) ch.collisions = collisions(ch, sets, chantiers);

  // Une passe vieillit comme un chantier : en jours actifs. Sans ça, « armée mais pas
  // encore jouée » ne durait qu'une journée et sortait de l'écran le lendemain.
  for (const p of passes) {
    p.silence = p.derniere ? joursActifs(jours, p.derniere) : null;
    // Quand la passe est entrée dans le dépôt. Avec `derniere`, ça donne la durée
    // pendant laquelle elle a été en jeu — une passe écrite il y a deux mois et rejouée
    // hier ne raconte pas la même chose qu'une passe écrite et jouée le même jour.
    p.entree = entree(p.file);
    liens[p.nom] ||= `#/qa/${encodeURIComponent(p.file)}`;
  }

  const enVol = branchesEnVol(chantiers.map(c => c.code), parCommit);

  const depuis = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  return {
    repo: (git("rev-parse", "--show-toplevel") || ROOT).split(/[\\/]/).pop(),
    branche: git("rev-parse", "--abbrev-ref", "HEAD") || "—",
    refs: REFS,
    racine: ROOT,
    genere: new Date().toISOString(),
    dernierJour: jours[jours.length - 1] || null,
    silenceCourant: jours.length
      ? Math.round((Date.now() - Date.parse(jours[jours.length - 1])) / 864e5) : null,
    chantiers, passes, liens, masses: mss, branches: enVol,
    veille: gardeFou(), controle: controleur(),
    commits: commits.filter(c => c.date >= depuis)
  };
}

// ---------- écritures ----------
const sur = (rel) => {
  const r = String(rel).split(/[\\/]/).join("/");
  if (r.includes("..") || !r.startsWith(DIR + "/")) throw new Error("chemin refusé");
  return join(ROOT, r);
};

async function cocher({ file, ligne, fait }) {
  const abs = sur(file);
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
  const i = ligne - 1;
  if (!RX.box.test(lines[i] ?? "")) throw new Error("ligne inattendue — recharge la page");
  lines[i] = lines[i].replace(/\[[ xX]\]/, fait ? "[x]" : "[ ]");
  await writeFile(abs, lines.join("\n"), "utf8");
}

async function reinitialiser({ file }) {
  const abs = sur(file);
  const today = new Date().toISOString().slice(0, 10);
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/).map(l =>
    RX.box.test(l) ? l.replace(/\[[xX]\]/, "[ ]") : l.replace(/^derniere:\s*.*$/, `derniere: ${today}`));
  await writeFile(abs, lines.join("\n"), "utf8");
}

// ---------- serveur ----------
const HTML = join(OUTIL, "journal.html");

createServer(async (req, res) => {
  const send = (code, type, body) =>
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);

  if (req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    try {
      const data = JSON.parse(raw || "{}");
      if (req.url === "/cocher") await cocher(data);
      else if (req.url === "/reinitialiser") await reinitialiser(data);
      else return send(404, "application/json", `{"error":"inconnu"}`);
      return send(200, "application/json", `{"ok":true}`);
    } catch (e) { return send(400, "application/json", JSON.stringify({ error: e.message })); }
  }

  if (req.url.startsWith("/journal.json")) {
    try { return send(200, "application/json", JSON.stringify(await build())); }
    catch (e) { return send(500, "application/json", JSON.stringify({ error: e.message })); }
  }

  if (!existsSync(HTML)) return send(404, "text/plain; charset=utf-8", "journal.html introuvable");
  send(200, "text/html; charset=utf-8", await readFile(HTML));
}).listen(PORT, () => {
  console.log(`Journal de bord  →  http://localhost:${PORT}`);
  console.log(`${ROOT}  ·  ${DIR}/  ·  ${DAYS} jours de commits`);
});
