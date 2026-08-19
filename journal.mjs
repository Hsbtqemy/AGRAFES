#!/usr/bin/env node
// Journal de bord — serveur local.
//   node journal.mjs [--port 4123] [--dir pilotage] [--days 60]
// Aucune dépendance. Node 18+.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const PORT = Number(opt("port", 4123));
const DIR  = opt("dir", "pilotage");
const DAYS = Number(opt("days", 60));
const ROOT = process.cwd();
// Refs d'intégration, de l'amont vers l'aval. Un chantier vit sur la première qui
// contient son dernier commit ; à défaut sur la branche courante, donc pas intégré.
const REFS = opt("refs", "origin/main,dev").split(",").map(s => s.trim()).filter(Boolean);

const git = (...a) => {
  try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 }).trim(); }
  catch { return ""; }
};

const RX = {
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

const walk = async (dir) => {
  const out = [];
  let items = []; try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = join(dir, it.name);
    if (it.isDirectory()) out.push(...await walk(p));
    else if (extname(it.name) === ".md" && !it.name.startsWith("_")) out.push(p);
  }
  return out;
};

const frontmatter = (text) => {
  const m = RX.fm.exec(text); if (!m) return {};
  const o = {};
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([a-zA-Zé]+):\s*(.*)$/.exec(l);
    if (k) o[k[1]] = k[2].trim();
  }
  return o;
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

    if (fm.passe !== undefined || rel.includes("/qa/")) {
      // --- passe de QA : cases regroupées par H3 ---
      const zones = []; let cur = null;
      lines.forEach((l, i) => {
        const h3 = RX.h3.exec(l);
        if (h3) { cur = { nom: h3[1].trim(), items: [] }; zones.push(cur); return; }
        const b = RX.box.exec(l);
        if (b) {
          if (!cur) { cur = { nom: "Général", items: [] }; zones.push(cur); }
          cur.items.push({ texte: b[2].trim(), fait: b[1].toLowerCase() === "x", ligne: i + 1 });
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
      const reste = []; let section = null;
      lines.forEach((l, i) => {
        const h2 = RX.h2.exec(l); if (h2) { section = h2[1].trim().toLowerCase(); return; }
        const b = RX.box.exec(l);
        if (b && section === "reste")
          reste.push({ texte: b[2].trim(), fait: b[1].toLowerCase() === "x", ligne: i + 1 });
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

// Un commit citant 3 codes ou plus est un fourre-tout : il ne date aucun chantier.
const fourretout = (sujet) => new Set(sujet.match(RX.chantier) || []).size >= 3;

function dernierCommit(commits, code) {
  const rx = new RegExp(`(^|[^A-Za-z0-9-])${code.replace(/[.]/g, "\\.")}([^A-Za-z0-9-]|$)`);
  for (const c of commits) if (rx.test(c.sujet) && !fourretout(c.sujet)) return c;
  return null;
}

// Front d'intégration : jusqu'où le travail est remonté. Dérivé, jamais déclaré.
function fronts() {
  const set = (r) => new Set(git("rev-list", r).split("\n").filter(Boolean));
  const l = REFS.map(nom => ({ nom, integre: true, hashes: set(nom) })).filter(f => f.hashes.size);
  const tete = git("rev-parse", "--abbrev-ref", "HEAD");
  if (tete && tete !== "HEAD" && !REFS.includes(tete))
    l.push({ nom: tete, integre: false, hashes: set(tete) });
  return l;
}

// ---------- index de navigation ----------
async function index() {
  const map = {};
  const docs = join(ROOT, "docs");
  let noms = []; try { noms = (await readdir(docs)).filter(n => n.endsWith(".md")); } catch {}

  for (const n of noms) {
    const p = `docs/${n}`;
    const t = await readFile(join(docs, n), "utf8").catch(() => "");
    if (/^(AUDIT|REVIEW)_/.test(n))
      for (const c of new Set(t.match(RX.chantier) || [])) map[c] ||= p;
    if (/^DESIGN_/.test(n))
      for (const c of new Set(t.match(RX.decision) || [])) map[c] ||= p;
    if (n === "DECISIONS.md")
      for (const c of new Set(t.match(RX.adr) || [])) map[c] = p;
  }
  return map;
}

// ---------- assemblage ----------
async function build() {
  const { jours, commits } = historique();
  const { chantiers, passes } = await pilotage();
  const liens = await index();
  const fr = fronts();

  for (const ch of chantiers) {
    const last = dernierCommit(commits, ch.code);
    ch.dernier = last ? { hash: last.hash, date: last.date, sujet: last.sujet } : null;
    ch.silence = last ? joursActifs(jours, last.date) : null;
    const f = last ? fr.find(x => x.hashes.has(last.full)) : null;
    ch.front = f ? { ref: f.nom, integre: f.integre } : null;
    const rxc = new RegExp(`(^|[^A-Za-z0-9-])${ch.code.replace(/[.]/g, "\\.")}([^A-Za-z0-9-]|$)`);
    ch.commits = commits.filter(c => rxc.test(c.sujet) && !fourretout(c.sujet)).length;
    ch.passes = passes.filter(p => p.chantier === ch.code).map(p => p.file);
    liens[ch.code] = `#/c/${encodeURIComponent(ch.code)}`;
  }
  for (const p of passes) liens[p.nom] ||= `#/qa/${encodeURIComponent(p.file)}`;

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
    chantiers, passes, liens,
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
const HTML = join(ROOT, "journal.html");

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
