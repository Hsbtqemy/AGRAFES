/**
 * shareDocs.ts — pure helpers for the ShareDocs / WebDAV import screen (Phase 3).
 *
 * No DOM, no IO — UI-agnostic formatting + small policy helpers, so the screen's
 * logic is unit-testable in isolation (Vitest). The screen itself only does DOM
 * wiring + sidecar calls.
 */

import type {
  ImportRemoteReport,
  RemoteEntry,
  RemoteFileResult,
  RemoteFileStatus,
  WebdavAuth,
  WebdavAuthMode,
} from "./sidecarClient.ts";
import {
  deriveModeFromExt,
  detectLanguageForMode,
  detectNumbering,
  extFromFileName,
  isKnownImportExt,
  normalizeModeForExt,
  planImport,
  uniformTableColumns,
} from "./importDetect.ts";
import type { ImportPlan } from "./importDetect.ts";
import { modeOptionsForExt } from "./importDetect.ts";
import type { FileVerdict } from "./importVerdictTemplate.ts";
import { verdictNeedsAttention } from "./importVerdictTemplate.ts";
import type { RemoteProbeFile, RemoteProbeReport } from "./sidecarClient.ts";
import { stripHiTags } from "./richTextModel.ts";

/**
 * Le verdict d'un fichier **distant**, déduit de ce que la sonde en a lu (SD-01).
 *
 * Rejoue la même chaîne que l'import local — `detectNumbering` puis `planImport` — sur
 * la même forme de données, la sonde renvoyant la réponse de `/import/preview`. La règle
 * de déduction reste donc en **un seul exemplaire** : c'est ce qui justifiait de
 * télécharger deux fois plutôt que de la réécrire en Python.
 *
 * `null` quand il n'y a rien à dire : fichier non sondé (format auto-descriptif,
 * extension inconnue, trop gros) ou illisible.
 */
export function planForRemoteFile(f: RemoteProbeFile): ImportPlan | null {
  if (f.status !== "probed") return null;
  const numbering = detectNumbering((f.units ?? []).map((u) => stripHiTags(u.text_raw ?? "")));
  const plan = planImport({
    ext: f.ext,
    numbering: numbering.form,
    searchableInProbe: f.units_line ?? 0,
    uniformColumns: uniformTableColumns(f.tables),
    // Aucune colonne ne peut être indiquée à distance : ni /webdav/probe ni
    // /import-remote ne portent `column_index`. Toujours faux, donc — et c'est
    // précisément pourquoi le motif est réécrit juste en dessous.
    hasColumn: false,
  });
  if (plan.verdict === "column_needed") {
    // Le motif local dit « indiquez la colonne à extraire ». À distance, ce serait une
    // consigne que personne ne peut suivre : le champ n'existe pas, et l'import distant
    // ne saurait pas la transmettre. On dit ce qui est vrai plutôt que de renvoyer
    // l'utilisateur vers un geste absent.
    return {
      ...plan,
      reason: `le texte est dans un tableau de ${uniformTableColumns(f.tables)} colonnes `
        + "— l'extraction par colonne n'existe pas encore à distance ; importez ce fichier "
        + "localement",
    };
  }
  return plan;
}

/**
 * Build the auth object from raw form fields, keeping only the fields relevant to
 * *mode* (we never send a password in bearer mode, etc.). Returns the object that
 * goes in the request body; it is never persisted (memory-only, Phase 3 decision).
 */
export function buildWebdavAuth(
  mode: WebdavAuthMode,
  fields: { user?: string; password?: string; token?: string }
): WebdavAuth {
  if (mode === "basic") {
    return { mode, user: (fields.user ?? "").trim(), password: fields.password ?? "" };
  }
  if (mode === "bearer") {
    return { mode, token: (fields.token ?? "").trim() };
  }
  return { mode: "anonymous" };
}

/**
 * Ce que le bandeau replié dit de la connexion en cours : `hôte · qui`.
 *
 * L'hôte et non l'URL entière — le chemin, lui, vit dans le fil d'Ariane du dossier, et
 * c'est précisément la duplication qu'on supprime : tant que la carte restait dépliée,
 * son champ URL gardait l'adresse d'**entrée** pendant que le fil montrait où l'on est
 * vraiment. Deux URL à l'écran, celle du haut périmée dès le premier sous-dossier.
 *
 * Jamais de secret : en mode jeton on nomme le mode, pas le jeton.
 */
export function connectionSummary(url: string, auth: WebdavAuth): string {
  let hote: string;
  try {
    hote = new URL(url).host;
  } catch {
    hote = (url ?? "").trim() || "—";
  }
  const qui =
    auth.mode === "basic" ? ((auth.user ?? "").trim() || "identifiant vide")
    : auth.mode === "bearer" ? "jeton d'accès"
    : "accès anonyme";
  return `${hote} · ${qui}`;
}

/** Client-side mirror of the server's auth requirement, for an early UX guard. */
export function authIsComplete(auth: WebdavAuth): boolean {
  if (auth.mode === "basic") return Boolean(auth.user && auth.password);
  if (auth.mode === "bearer") return Boolean(auth.token);
  return true; // anonymous needs nothing
}

/**
 * Stable OS-keychain account key for a remembered ShareDocs credential (Phase 4A).
 * Keyed by server origin + auth mode + username so distinct servers/accounts never
 * collide. Only the secret (password / token) is ever stored under this key — the
 * non-secret fields live in localStorage. Falls back to the trimmed raw URL when the
 * URL is unparsable, so the key stays deterministic. See DESIGN §9.2.
 */
export function keyringAccount(url: string, mode: WebdavAuthMode, user: string): string {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = (url ?? "").trim();
  }
  return `${origin}|${mode}|${(user ?? "").trim()}`;
}

/**
 * The secret to store in the keychain for this auth, or null when there is none
 * (anonymous, or an empty secret). Basic → password, bearer → token.
 */
export function authSecret(auth: WebdavAuth): string | null {
  if (auth.mode === "basic") return auth.password ? auth.password : null;
  if (auth.mode === "bearer") return auth.token ? auth.token : null;
  return null;
}

/** Human-readable file size; the server may report null (size unknown). */
export function formatRemoteSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Kio", "Mio", "Gio", "Tio"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Fichiers **importés** dont l'import n'a écrit aucune unité indexable.
 *
 * `units_line` voyage dans le rapport de lot depuis toujours (`remote/ingest.py`), mais
 * n'était affiché nulle part : ShareDocs pouvait importer un dossier entier en « tout
 * vert » alors qu'aucun document n'était trouvable à la recherche. C'est le même défaut
 * que l'import local a corrigé (IMPO-01) — avec, ici, un profil de lot unique qui rend le
 * cas *plus* probable, pas moins.
 *
 * Un fichier dont le compte est absent (`undefined`/`null`) n'est **pas** compté : on ne
 * signale que ce qu'on sait.
 */
export function filesWithoutIndexable(r: ImportRemoteReport): RemoteFileResult[] {
  return (r.files ?? []).filter((f) => f.status === "imported" && f.units_line === 0);
}

/** One-line summary of a batch report (e.g. "5 fichiers : 3 importés, 1 doublon, 1 erreur"). */
export function summarizeReport(r: ImportRemoteReport): string {
  const parts: string[] = [`${r.imported} importé${r.imported > 1 ? "s" : ""}`];
  if (r.skipped_duplicate) parts.push(`${r.skipped_duplicate} doublon${r.skipped_duplicate > 1 ? "s" : ""}`);
  if (r.skipped_filtered) parts.push(`${r.skipped_filtered} filtré${r.skipped_filtered > 1 ? "s" : ""}`);
  if (r.skipped_oversize) parts.push(`${r.skipped_oversize} trop volumineux`);
  if (r.errors) parts.push(`${r.errors} erreur${r.errors > 1 ? "s" : ""}`);
  const vides = filesWithoutIndexable(r).length;
  // En queue de résumé et non dans la liste des comptes : ce n'est pas un statut de plus
  // (ces fichiers SONT importés), c'est ce que l'import a produit.
  const rien = vides > 0
    ? ` — ⚠ ${vides} sans unité indexable`
    : "";
  return `${r.total} fichier${r.total > 1 ? "s" : ""} : ${parts.join(", ")}${rien}`;
}

/**
 * Badge kind (CSS suffix) pour une ligne du rapport.
 *
 * Prend le FICHIER et non son seul statut : un import abouti sans une seule unité
 * indexable n'est pas un succès ordinaire, et le badge vert le donnait pour tel.
 */
export function statusBadgeKind(
  f: { status: RemoteFileStatus; units_line?: number | null },
): "ok" | "warn" | "error" | "muted" {
  switch (f.status) {
    case "imported":
      return f.units_line === 0 ? "warn" : "ok";
    case "error":
      return "error";
    case "skipped-duplicate":
      return "muted";
    default:
      return "warn"; // skipped-filtered / skipped-oversize
  }
}

/** Human label (FR) for a per-file status. */
export function statusLabel(status: RemoteFileStatus): string {
  switch (status) {
    case "imported":
      return "Importé";
    case "skipped-duplicate":
      return "Doublon";
    case "skipped-filtered":
      return "Filtré";
    case "skipped-oversize":
      return "Trop volumineux";
    case "error":
      return "Erreur";
    default:
      return status;
  }
}

/**
 * Build the Nextcloud / ShareDocs personal WebDAV root for *hostOrUrl* + *user*
 * (P4B preset). *hostOrUrl* may be a bare host ("dav.huma-num.fr"), a full URL, or
 * a deep URL — only its origin is kept (scheme defaults to https). Returns
 * `<origin>/remote.php/dav/files/<user>/`, or "" when either input is empty or the
 * host is unparseable (the caller then keeps the field untouched). The result is a
 * plain saisie aid — the connector stays generic WebDAV (no Nextcloud coupling).
 */
export function buildNextcloudRoot(hostOrUrl: string, user: string): string {
  const h = (hostOrUrl ?? "").trim();
  const u = (user ?? "").trim();
  if (!h || !u) return "";
  let origin: string;
  try {
    const withScheme = /^https?:\/\//i.test(h) ? h : `https://${h}`;
    origin = new URL(withScheme).origin;
  } catch {
    return "";
  }
  if (!origin || origin === "null") return "";
  return `${origin}/remote.php/dav/files/${encodeURIComponent(u)}/`;
}

/**
 * True when *value* already carries a non-root path (e.g. a deep folder URL),
 * as opposed to a bare host / root. Used by the P4B preset to confirm before it
 * would overwrite a path the user already typed. Tolerant: a bare host or an
 * unparseable value is "no path" (false).
 */
export function urlHasPath(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  try {
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    return new URL(withScheme).pathname.length > 1; // "/" → none; "/foo" → deep
  } catch {
    return false;
  }
}

/** Normalize a folder URL so it ends with exactly one trailing slash (collection). */
export function normalizeFolderUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Last path segment of a folder URL, decoded, for a compact label. */
export function folderLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").pop() ?? "";
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** One item in the ShareDocs selection cart (P4C). */
export interface SelectedRemoteItem {
  href: string;
  name: string;
  parentUrl: string;
  is_dir: boolean;
}

/**
 * A remote file resolved for import with its per-file detected params (Phase 5).
 * `mode`/`language` come from importDetect (extension → mode, name → langue).
 * `language` is **undefined** for a TEI file whose name carries no language token —
 * the document's own `xml:lang` is then authoritative (DESIGN §11.8).
 */
export interface DetectedImportFile {
  href: string;
  name: string;
  parentUrl: string;
  mode: string;
  language: string | undefined;
}

/**
 * A single /import-remote submission grouped by (parentUrl, mode, language) — each
 * group carries its own detected mode + language, so a bilingual / mixed-format
 * folder fans out into several submissions (DESIGN §11.3). `language` undefined →
 * omitted from the request (TEI keeps its `xml:lang`).
 */
export interface DetectedImportGroup {
  url: string;
  hrefs: string[];
  mode: string;
  language: string | undefined;
  label: string;
}

/**
 * Per-file import params (mode + langue) dérivés d'un nom de fichier distant — réutilise
 * la détection de l'import local (importDetect, source unique). Retourne `null` quand
 * l'extension n'est pas un format importable : le fichier est alors ignoré (ni importé,
 * ni en erreur), cf. DESIGN §11.3. La langue suit `detectLanguageForMode` : `undefined`
 * pour un TEI sans token (le `xml:lang` du document fait foi).
 */
export function detectImportFile(
  name: string,
  href: string,
  parentUrl: string,
  profile: string,
  defaultLanguage: string,
  deducedMode?: string | null,
): DetectedImportFile | null {
  const ext = extFromFileName(name);
  if (!isKnownImportExt(ext)) return null;
  // Le mode **déduit du contenu** prime sur celui dérivé de l'extension et du profil de
  // lot (SD-01) : c'est ce que la sonde a lu du fichier, là où le profil ne pouvait que
  // supposer. `normalizeModeForExt` reste le garde-fou — un mode déduit incompatible
  // avec l'extension retombe sur la dérivation, plutôt que de partir tel quel.
  const mode = normalizeModeForExt(deducedMode || deriveModeFromExt(ext, profile), ext);
  const language = detectLanguageForMode(mode, name, defaultLanguage);
  return { href, name, parentUrl, mode, language };
}

/**
 * Route les entrées d'un dossier WebDAV (Depth:1) en fichiers importables détectés.
 * **Non-récursif** : les sous-dossiers sont comptés (`subfolders`) puis ignorés. Les
 * extensions inconnues sont comptées (`ignored`) sans erreur. Source unique du routage,
 * partagée par l'import « ce dossier » et l'expansion des dossiers cochés (Phase 5).
 */
export function routeEntriesToImport(
  entries: RemoteEntry[],
  parentUrl: string,
  profile: string,
  defaultLanguage: string,
  deducedModes?: ReadonlyMap<string, string>,
): { files: DetectedImportFile[]; ignored: number; subfolders: number } {
  const files: DetectedImportFile[] = [];
  let ignored = 0;
  let subfolders = 0;
  for (const e of entries) {
    if (e.is_dir) {
      subfolders += 1;
      continue;
    }
    const det = detectImportFile(
      e.name, e.href, parentUrl, profile, defaultLanguage, deducedModes?.get(e.href),
    );
    if (det) files.push(det);
    else ignored += 1;
  }
  return { files, ignored, subfolders };
}

/**
 * Group per-file-detected files into import submissions keyed by
 * (parentUrl, mode, language) — one `import-remote` call per group, each sending
 * the group's `hrefs`. Insertion order of first occurrence is preserved. Files must
 * already be filtered (unknown extensions dropped upstream).
 */
export function groupDetectedFiles(files: DetectedImportFile[]): DetectedImportGroup[] {
  const byKey = new Map<string, DetectedImportGroup>();
  for (const f of files) {
    // Delimiter-safe key: language is a free-text default that could contain any
    // char, so join via JSON rather than a literal separator (no collision).
    const key = JSON.stringify([f.parentUrl, f.mode, f.language]);
    let g = byKey.get(key);
    if (!g) {
      g = { url: f.parentUrl, hrefs: [], mode: f.mode, language: f.language, label: "" };
      byKey.set(key, g);
    }
    g.hrefs.push(f.href);
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    const n = g.hrefs.length;
    g.label = `${folderLabel(g.url)} · ${g.mode} · ${g.language ?? "xml:lang"} (${n} fichier${n > 1 ? "s" : ""})`;
  }
  return groups;
}

/**
 * Dedup detected files by `href`, preserving first occurrence (Phase 5 — expansion
 * des dossiers cochés). A file can surface twice : coché directement **et** découvert
 * via l'expansion PROPFIND de son dossier parent lui aussi coché. Sans dédup, son
 * `href` apparaîtrait deux fois dans le même groupe → double import. Le premier vu
 * gagne (le fichier explicitement coché est traité avant l'expansion).
 */
export function dedupeDetectedFiles(files: DetectedImportFile[]): DetectedImportFile[] {
  const seen = new Set<string>();
  const out: DetectedImportFile[] = [];
  for (const f of files) {
    if (seen.has(f.href)) continue;
    seen.add(f.href);
    out.push(f);
  }
  return out;
}

/**
 * Choix de liaison d'une famille décidé dans la bannière (Phase 6) : l'original (pivot)
 * et ses traductions, identifiés par leur **clé** = `source_url`/href (unique, évite les
 * collisions de noms entre dossiers). Seuls les groupes que l'utilisateur a laissés
 * cochés produisent un choix ; `childKeys` exclut déjà le pivot.
 */
export interface FamilyLinkChoice {
  pivotKey: string;
  childKeys: string[];
}

/** Plan de relations résolu contre le rapport d'import : paires liables + comptes d'écarts. */
export interface FamilyRelationPlan {
  /** Relations `translation_of` à créer (enfant → pivot), doc_ids résolus. */
  relations: Array<{ childDocId: number; pivotDocId: number; childKey: string }>;
  /** Membres écartés faute de `doc_id` (import échoué). */
  unlinkedMembers: number;
  /** Groupes non liables car le pivot n'a pas de `doc_id`. */
  unlinkableGroups: number;
}

/**
 * Résout les choix de familles contre le rapport d'import agrégé (Phase 6, §12.3) :
 * mappe chaque clé (`source_url`) → `doc_id` (renseigné pour `imported` **et**
 * `skipped-duplicate`), puis produit les relations `translation_of` enfant→pivot
 * liables. Pivot sans doc_id → groupe ignoré (`unlinkableGroups`) ; membre sans doc_id
 * → écarté (`unlinkedMembers`). Pur : la création réelle (`setDocRelation`) est faite
 * par l'appelant.
 */
export function resolveFamilyRelations(
  choices: FamilyLinkChoice[],
  report: ImportRemoteReport,
): FamilyRelationPlan {
  const docIdByKey = new Map<string, number>();
  for (const f of report.files) {
    if (typeof f.doc_id === "number") docIdByKey.set(f.source_url, f.doc_id);
  }
  const relations: FamilyRelationPlan["relations"] = [];
  let unlinkedMembers = 0;
  let unlinkableGroups = 0;
  for (const c of choices) {
    const pivotDocId = docIdByKey.get(c.pivotKey);
    if (pivotDocId === undefined) {
      unlinkableGroups += 1;
      continue;
    }
    for (const childKey of c.childKeys) {
      const childDocId = docIdByKey.get(childKey);
      if (childDocId === undefined) {
        unlinkedMembers += 1;
        continue;
      }
      if (childDocId === pivotDocId) continue; // garde-fou (clé pivot dans childKeys)
      relations.push({ childDocId, pivotDocId, childKey });
    }
  }
  return { relations, unlinkedMembers, unlinkableGroups };
}

/** Merge two batch reports (P4C aggregates the reports of several submissions). */
export function mergeReports(
  a: ImportRemoteReport | null,
  b: ImportRemoteReport,
): ImportRemoteReport {
  if (!a) return b;
  return {
    url: a.url,
    mode: a.mode,
    total: a.total + b.total,
    imported: a.imported + b.imported,
    skipped_duplicate: a.skipped_duplicate + b.skipped_duplicate,
    skipped_filtered: a.skipped_filtered + b.skipped_filtered,
    skipped_oversize: a.skipped_oversize + b.skipped_oversize,
    errors: a.errors + b.errors,
    files: [...a.files, ...b.files],
  };
}

/**
 * Ce qu'une ligne du rapport doit dire d'un fichier **en erreur**.
 *
 * Le moteur ne connaît aucune interface : son message est en anglais et générique
 * — « the import mode/parameters do not match its content (e.g. a wrong column index,
 * a TEI unit element with no match, or a blank document) ». Or pour un fichier que la
 * sonde avait diagnostiqué, l'écran dispose déjà de mieux : le motif du verdict, en
 * français, qui nomme la cause **et** le remède (« le texte est dans un tableau de 2
 * colonnes … importez ce fichier localement »). Sans ce rappel, un échec **prévu** se
 * présente comme une panne inexpliquée, et l'écran contredit ce qu'il annonçait une
 * colonne plus tôt.
 *
 * La substitution n'a lieu que si la sonde avait vu un problème : une erreur imprévue
 * — réseau, fichier corrompu — garde le message du moteur, seul à la connaître.
 */
export function errorDetailForFile(
  f: RemoteFileResult,
  probes: ReadonlyMap<string, RemoteProbeFile>,
): string {
  const sonde = probes.get(f.source_url);
  const plan = sonde ? planForRemoteFile(sonde) : null;
  if (plan && verdictNeedsAttention(plan.verdict)) return plan.reason;
  return f.error ?? "";
}

/** Folders first, then files, each alphabetical (locale-aware, case-insensitive). */
export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/**
 * decodeURIComponent that never throws — a server-supplied href may contain a
 * lone '%' (legal in some WebDAV hrefs) which would otherwise raise URIError and
 * abort rendering of an otherwise-valid listing. Falls back to the raw string.
 */
export function safeDecodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Structural guard for an async job's `result` before treating it as a batch
 * report — the job result is typed `Record<string, unknown>`, so a shape drift
 * (older sidecar, partial result) must not surface as "undefined fichier".
 */
/**
 * Le verdict d'un fichier distant, prêt pour {@link buildVerdictHtml}.
 *
 * `null` quand la sonde n'a rien lu — la ligne reste alors muette plutôt que d'afficher
 * un verdict inventé.
 *
 * Le **compte** n'est donné que si le mode déduit est celui dans lequel la sonde a lu :
 * sur un document numéroté `[n]`, elle sait *qu'il* sera indexable — les marqueurs sont
 * là — sans connaître le compte du mode numéroté. Même règle qu'en local.
 */
export function verdictForRemoteFile(f: RemoteProbeFile): FileVerdict | null {
  const plan = planForRemoteFile(f);
  if (!plan) return null;
  const opts = modeOptionsForExt(f.ext);
  const label = opts.find((o) => o.value === plan.mode)?.label ?? plan.mode;
  return {
    plan,
    modeLabel: label,
    searchable: plan.mode === f.mode ? (f.units_line ?? 0) : null,
  };
}

/**
 * Les résultats de sonde à **garder** quand on quitte un dossier (SD-01).
 *
 * Le panier traverse les dossiers — c'est sa raison d'être — donc tout jeter ferait
 * retomber sur le repli un fichier coché ailleurs, dont l'utilisateur venait pourtant de
 * lire le verdict. On garde donc :
 *
 * - les fichiers **cochés** eux-mêmes ;
 * - les fichiers **contenus dans un dossier coché** (leur href a le sien pour préfixe) :
 *   c'est cette sonde-là qui leur donnera leur mode quand le dossier sera développé au
 *   lancement de l'import.
 *
 * Tout le reste part : garder sans élaguer ferait grossir le cache à chaque dossier
 * visité, sans borne.
 */
export function probeKeysToKeep(
  probeHrefs: Iterable<string>,
  selected: Iterable<{ href: string; is_dir: boolean }>,
): Set<string> {
  const items = [...selected];
  const coches = new Set(items.map((it) => it.href));
  const dossiers = items.filter((it) => it.is_dir).map((it) => it.href);
  const garde = new Set<string>();
  for (const href of probeHrefs) {
    if (coches.has(href) || dossiers.some((d) => href.startsWith(d))) garde.add(href);
  }
  return garde;
}

export function isRemoteProbeReport(x: unknown): x is RemoteProbeReport {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.total === "number" &&
    typeof r.probed === "number" &&
    Array.isArray(r.files)
  );
}

/**
 * Modes déduits par la sonde, indexés par href — prêts pour `routeEntriesToImport`.
 *
 * Ne retient que les fichiers dont la sonde a **effectivement** tiré un plan : un
 * document non sondé (format auto-descriptif, extension inconnue, illisible) n'a pas de
 * mode déduit et retombe donc sur la dérivation par extension, comme avant.
 */
export function deducedModesFrom(
  probes: Iterable<RemoteProbeFile>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of probes) {
    const plan = planForRemoteFile(f);
    if (plan) out.set(f.source_url, plan.mode);
  }
  return out;
}

export function isImportRemoteReport(x: unknown): x is ImportRemoteReport {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.total === "number" &&
    typeof r.imported === "number" &&
    Array.isArray(r.files)
  );
}
