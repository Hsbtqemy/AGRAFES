#!/usr/bin/env node
// Journal de bord — serveur local.
//   node journal.mjs [--port 4123] [--dir pilotage] [--days 60]
// Aucune dépendance. Node 18+.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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

// stderr ignoré : sur un dépôt sans commit, git écrit huit `fatal:` sur la console
// avant que le journal ait rendu sa première page. L'appel échoue déjà proprement —
// c'est le `catch` qui décide, pas le bruit.
const git = (...a) => {
  try { return execFileSync("git", a,
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};

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

// Remontée des codes de constat vers leur chantier. Le travail réel cite `ALI-10`,
// jamais `R3` : sans ça, R3 n'est daté que par les notes qu'on écrit SUR lui.
// Trois gardes, parce que les audits se citent entre eux :
//   — le code doit venir du TABLEAU de constats, pas de la prose (AUDIT_ALIGNEMENT
//     mentionne T-05 en renvoi ; son tableau, non) ;
//   — l'audit doit n'être possédé que par une fiche (AUDIT_2026-06-12 est cité par
//     quatre : A-01, T-03, T-05, U-03 — ses orphelins iraient aux quatre) ;
//   — le code ne doit pas avoir de fiche à lui.
// Les constats clos comptent aussi : un commit citant ALI-10 est du R3 que le
// constat soit soldé ou non.
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
// Compter les codes bruts serait faux depuis la remontée — un commit citant
// ALI-01, ALI-10 et ALI-22 est du R3 pur, pas un fourre-tout.
const fourretout = (sujet, proprietaire) =>
  new Set((sujet.match(CFG.codes.chantier) || []).map(c => proprietaire[c] || c)).size >= 3;

// Les commits d'un chantier, du plus récent au plus ancien. `tenue` = ceux qui ne
// touchent que `pilotage/` : tenir le dossier n'est pas travailler sur le chantier
// dont on parle — sans cette garde, une note « recompter l'item de R3 » remettait le
// silence de R3 à zéro.
const commitsDuChantier = (commits, codes, proprietaire, tenue) => {
  const rx = rxCodes(codes);
  return commits.filter(c =>
    rx.test(c.sujet) && !fourretout(c.sujet, proprietaire) && !tenue.has(c.hash));
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

  const cum = {}, serie = {}, mois = [], jalons = [], tenue = [];
  for (const [n] of AIRES) { cum[n] = 0; serie[n] = []; }
  let m = null, c = null, net = 0, nf = 0, npil = 0;
  const clore = () => {
    if (!c) return;
    if (net <= -seuil) jalons.push({ ...c, delta: net });
    // Ne touche que `pilotage/` : de la tenue de dossier, pas du travail daté.
    if (nf > 0 && nf === npil) tenue.push(c.hash);
  };
  const graver = () => { mois.push(m); for (const [n] of AIRES) serie[n].push(cum[n]); };

  for (const l of raw.split("\n")) {
    if (l.startsWith("@")) {
      clore();
      const [hash, date, sujet] = l.slice(1).split("\x1f");
      const mm = date.slice(0, 7);
      if (m && m !== mm) graver();
      m = mm; c = { hash, date, sujet }; net = 0; nf = 0; npil = 0;
      continue;
    }
    const f = l.split("\t");
    if (f.length < 3 || !/^\d+$/.test(f[0])) continue;   // binaire (`-`) ou ligne vide
    const n = Number(f[0]) - Number(f[1]);
    net += n; nf++; if (f[2].startsWith(DIR + "/")) npil++;
    const a = aire(f[2]); if (a) cum[a] += n;
  }
  clore();
  if (m) graver();

  const aires = AIRES.map(([nom]) => {
    const v = serie[nom], tot = v[v.length - 1] || 0;
    return { nom, valeurs: v, total: tot, delta: tot - (v[Math.max(0, v.length - 1 - fenetre)] ?? 0) };
  }).filter(a => a.total > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { mois, fenetre, aires, tenue,
           jalons: jalons.sort((a, b) => a.delta - b.delta).slice(0, 8) };
}

// ---------- veille à seuil ----------
// Le seul chiffre du tableau de bord qui ait une limite réelle ; déclaré par dépôt
// (voir `pilotage/journal.config.mjs`). Absent = pas de bandeau de veille.
const VEILLE = CFG.veille;

// Mémo sur le hash de HEAD : ce qui ne dépend que de l'historique se recalcule au
// commit suivant, pas à chaque coche de case. (Le contrôleur, lui, lit les fichiers
// de `pilotage/` — il doit rester vivant, il n'est pas mémorisé.)
const memos = new Map();
const surTete = (cle, fn) => {
  const tete = git("rev-parse", "HEAD"), m = memos.get(cle);
  if (tete && m && m.tete === tete) return m.val;
  const val = fn();
  memos.set(cle, { tete, val });
  return val;
};

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
  const { jours, commits } = historique();
  const { chantiers, passes } = await pilotage();
  const liens = await index();
  const fr = fronts();
  const mss = masses();
  // La passe des masses suit HEAD, pas `--all` : un commit de tenue posé sur une
  // autre branche ne sera pas reconnu comme tel. Sans conséquence en pratique.
  const tenue = new Set(mss?.tenue || []);
  const rem = await remontee(chantiers);
  const proprietaire = {};
  for (const [ch, codes] of Object.entries(rem)) for (const c of codes) proprietaire[c] = ch;

  for (const ch of chantiers) {
    const codes = [ch.code, ...(rem[ch.code] || [])];
    ch.remontee = rem[ch.code] || null;
    const liste = commitsDuChantier(commits, codes, proprietaire, tenue);
    const last = liste[0] || null;
    ch.dernier = last ? { hash: last.hash, date: last.date, sujet: last.sujet } : null;
    ch.silence = last ? joursActifs(jours, last.date) : null;
    const f = last ? fr.find(x => x.hashes.has(last.full)) : null;
    ch.front = f ? { ref: f.nom, integre: f.integre } : null;
    ch.commits = liste.length;
    // La traînée : `Arrêté sur` est une pile de profondeur un, réécrite à chaque
    // reprise. Mesuré le 2026-08-22 : 4 fiches sur 14 la portaient périmée, et
    // c'étaient les trois plus actives — elle ne tient que là où on n'en a pas besoin.
    ch.trainee = liste.slice(0, TRAINEE).map(c => ({ hash: c.hash, date: c.date, sujet: c.sujet }));
    // Le point de reprise cite-t-il encore le dernier commit ? Mesuré le 22 août :
    // 4 fiches sur 14 non, et c'étaient les trois plus actives. La traînée le rendait
    // visible ; ceci le compte, ce qui est la différence entre voir et savoir.
    ch.arreteDecale = Boolean(c_arreteDecale(ch));
    ch.passes = passes.filter(p => p.chantier === ch.code).map(p => p.file);
    liens[ch.code] = `#/c/${encodeURIComponent(ch.code)}`;
  }
  // Une passe vieillit comme un chantier : en jours actifs. Sans ça, « armée mais pas
  // encore jouée » ne durait qu'une journée et sortait de l'écran le lendemain.
  for (const p of passes) {
    p.silence = p.derniere ? joursActifs(jours, p.derniere) : null;
    liens[p.nom] ||= `#/qa/${encodeURIComponent(p.file)}`;
  }

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
    chantiers, passes, liens, masses: mss,
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
