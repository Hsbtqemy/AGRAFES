/**
 * ImportScreen — batch import documents + rebuild FTS index.
 *
 * Features:
 *  - File picker (multi-select) + glisser-déposer (chemins natifs Tauri)
 *  - Per-file: mode, language, title override
 *  - Batch import : jobs async côté sidecar (plusieurs imports peuvent tourner en parallèle)
 *  - "Reconstruire l'index" button
 *  - Log prep-pane
 *  - Sprint 8: post-import family dialog + filename language detection
 */

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { Conn } from "../lib/sidecarClient.ts";
import { importFile, enqueueJob, SidecarError, listDocuments, setDocRelation, updateDocument, previewImport } from "../lib/sidecarClient.ts";
import type { DocumentRecord } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { compareDocsByTitle } from "../../../shared/docSort.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import { importScreenTemplate } from "../lib/importScreenTemplate.ts";
import {
  extFromFileName,
  modeOptionsForExt,
  deriveModeFromExt,
  WP_DEFAULT_PARAGRAPHS,
  normalizeModeForExt,
  detectLanguageForMode,
  detectLanguageToken,
  isKnownImportExt,
  modeAcceptsColumn,
  uniformTableColumns,
  describeTablesLabel,
  comparableModesForExt,
  recommendedMode,
  detectNumbering,
  planImport,
  type TableShape,
  type ImportPlan,
} from "../lib/importDetect.ts";
import {
  buildModeComparisonHtml,
  type ModeComparisonRow,
} from "../lib/importModeComparisonTemplate.ts";
import {
  buildVerdictHtml,
  buildQueueWarningHtml,
  verdictForChoice,
  type FileVerdict,
} from "../lib/importVerdictTemplate.ts";
import { detectFamilyGroups, type FamilyGroup } from "../lib/familyDetect.ts";
import { buildFamilyDetectionBannerHtml } from "../lib/importFamilyDetectionTemplate.ts";
import { importStatusLabel } from "../lib/importStatusLabel.ts";
import { normalizeImportPath, parseConlluPreview } from "../lib/importConllu.ts";
import { stripHiTags } from "../lib/richTextModel.ts";


// Détection format/langue d'import (extension → mode, nom → langue) extraite dans
// lib/importDetect.ts (source de vérité unique, partagée avec ShareDocs — Phase 5).

interface FileItem {
  path: string;
  mode: string;
  language: string;
  title: string;
  status: "pending" | "importing" | "done" | "error";
  message: string;
  /**
   * IMP-11 : la langue a été prise par DÉFAUT (aucun code de langue dans le nom), pas
   * détectée — signalé dans la liste pour que l'utilisateur vérifie plutôt qu'un `fr`
   * silencieux. Effacé dès qu'il édite le champ langue. Faux pour TEI (le `xml:lang`
   * décide, champ vide).
   */
  langGuessed?: boolean;
  /**
   * Pour les deux modes DOCX (IMPO-01) — index 1-based de la colonne à extraire
   * from tables (DOCX bilingue 2-col). Undefined = legacy behavior (tables
   * ignored).
   */
  column_index?: number;
  /**
   * Ce que l'analyse a déduit du fichier (IMPO-01) — le mode posé et *pourquoi*.
   * `undefined` = pas encore analysé, `null` = analyse impossible (fichier illisible).
   */
  plan?: ImportPlan | null;
  /**
   * Unités trouvables que le mode déduit rendrait, quand le compte est exact ; `null`
   * sinon (cf. `FileVerdict.searchable`). Absent tant que l'analyse n'a pas tourné.
   */
  searchable?: number | null;
  /** L'utilisateur a choisi le mode lui-même : l'analyse ne le réécrit plus. */
  modeLocked?: boolean;
  /**
   * Unites indexables ecrites par l'import (`units_line`), une fois `status === "done"`.
   * `null` quand la reponse ne le disait pas. Cf. `StatusLabelInput.importedLine`.
   */
  importedLine?: number | null;
}

export class ImportScreen {
  private _conn: Conn | null = null;
  private _files: FileItem[] = [];
  private _root!: HTMLElement;
  private _listEl!: HTMLElement;
  private _queueWarnEl!: HTMLElement;
  private _logEl: HTMLElement = document.createElement("div");
  private _summaryEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _importBtn!: HTMLButtonElement;
  private _conlluRowsEl!: HTMLElement;
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;
  private _conlluPreviewPath: string | null = null;
  private _conlluPreviewReq = 0;

  // Panneau de détail du fichier SÉLECTIONNÉ (IMPO-01, maître-détail).
  private _detailTitleEl!: HTMLElement;
  private _detailEmptyEl!: HTMLElement;
  private _detailBodyEl!: HTMLElement;
  private _detailSummaryEl!: HTMLElement;
  private _detailModeSel!: HTMLSelectElement;
  private _detailColWrap!: HTMLElement;
  private _detailColInp!: HTMLInputElement;
  private _detailLangInp!: HTMLInputElement;
  private _detailTitleInp!: HTMLInputElement;
  private _textWrapEl!: HTMLElement;
  private _conlluWrapEl!: HTMLElement;
  private _textPreviewRowsEl!: HTMLElement;
  /**
   * Chemin du fichier sélectionné — **remplace les deux curseurs** `1/1` + « Suivant ».
   * Ils n'existaient que parce que l'aperçu était global et n'avait aucun moyen de
   * savoir de quel fichier on parlait ; la sélection le lui dit.
   */
  private _selectedPath: string | null = null;
  private _textPreviewPath: string | null = null;
  private _textPreviewReq = 0;
  private _textPreviewTables: TableShape[] | null = null;
  private _textTablesEl!: HTMLElement;
  private _textTablesMsgEl!: HTMLElement;
  private _textTablesSplitBtn!: HTMLButtonElement;
  private _textCmpEl!: HTMLElement;
  private _textCmpReq = 0;
  /** Une seule boucle d'analyse à la fois (IMPO-01) — cf. `_analyzePending`. */
  private _analyzing = false;

  // Sprint 8 — family dialog
  private _skipFamilyDialog = false;
  /** Signature des groupes actuellement affichés — cf. `_renderFamilyDetectionBanner`. */
  private _familyBannerKey: string | null = null;
  private _corpusDocs: DocumentRecord[] = [];
  private _familyDialogQueue: Array<{ docId: number; title: string; lang: string }> = [];
  private _familyDialogActive = false;

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen prep-import-screen prep-import-screen--layout";
    this._root = root;

    setHtml(root, raw(importScreenTemplate()));

    this._listEl = root.querySelector("#imp-list")!;
    this._queueWarnEl = root.querySelector("#imp-queue-warn")!;
    this._summaryEl = root.querySelector("#imp-summary")!;
    this._stateEl = root.querySelector("#imp-state-banner")!;
    this._importBtn = root.querySelector("#imp-import-btn")!;
    this._conlluRowsEl = root.querySelector("#imp-conllu-rows")!;
    this._textPreviewRowsEl = root.querySelector("#imp-text-rows")!;
    this._textTablesEl = root.querySelector("#imp-text-tables")!;
    this._textTablesMsgEl = root.querySelector("#imp-text-tables-msg")!;
    this._textTablesSplitBtn = root.querySelector("#imp-text-tables-split")!;
    this._textCmpEl = root.querySelector("#imp-text-cmp")!;
    this._detailTitleEl = root.querySelector("#imp-detail-title")!;
    this._detailEmptyEl = root.querySelector("#imp-detail-empty")!;
    this._detailBodyEl = root.querySelector("#imp-detail-body")!;
    this._detailSummaryEl = root.querySelector("#imp-detail-summary")!;
    this._detailModeSel = root.querySelector("#imp-detail-mode")!;
    this._detailColWrap = root.querySelector("#imp-detail-col-wrap")!;
    this._detailColInp = root.querySelector("#imp-detail-col")!;
    this._detailLangInp = root.querySelector("#imp-detail-lang")!;
    this._detailTitleInp = root.querySelector("#imp-detail-title-inp")!;
    this._textWrapEl = root.querySelector("#imp-text-wrap")!;
    this._conlluWrapEl = root.querySelector("#imp-conllu-wrap")!;

    root.querySelector("#imp-add-btn")!.addEventListener("click", () => this._addFiles());
    root.querySelector("#imp-refresh-btn")?.addEventListener("click", () => void this._refreshCorpus());
    root.querySelector("#imp-clear-btn")!.addEventListener("click", () => this._clearList());
    this._importBtn.addEventListener("click", () => this._runImport());
    root.querySelector("#imp-apply-defaults-btn")!.addEventListener("click", () => this._applyDefaultsToPending());
    this._textTablesSplitBtn.addEventListener("click", () => {
      this._splitPreviewedFileByColumn();
    });
    root.querySelector("#imp-detail-refresh")!.addEventListener("click", () => {
      this._textPreviewPath = null;
      this._conlluPreviewPath = null;
      void this._refreshDetail(true);
    });
    this._bindDetailControls();

    const dz = root.querySelector<HTMLElement>("#imp-dropzone");
    if (dz) {
      dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("dragover"); });
      dz.addEventListener("dragleave", ()  => dz.classList.remove("dragover"));
      dz.addEventListener("drop", e => {
        e.preventDefault();
        dz.classList.remove("dragover");
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const defaultLang = (this._root.querySelector<HTMLInputElement>("#imp-default-lang"))!.value.trim() || "fr";
        const ajoutes: string[] = [];
        let added = 0;
        let skippedDup = 0;
        let skippedUnknown = 0;
        for (const file of Array.from(files)) {
          // Tauri WebView exposes native path via non-standard File.path property
          const path = (file as File & { path?: string }).path;
          if (!path) continue;
          const name = file.name;
          // IMP-15 : filtrer les extensions non prises en charge (converge avec ShareDocs,
          // qui filtre déjà via isKnownImportExt) — sinon un .doc/.pdf/sans-ext entrerait
          // dans la liste avec un mode bidon qui n'échoue qu'au dispatch.
          if (!isKnownImportExt(extFromFileName(name))) { skippedUnknown++; continue; }
          const r = this._tryAddSingle(path, name, defaultLang);
          if (r === "added") { added++; ajoutes.push(path); }
          else skippedDup++;
        }
        this._selectIfSingleAdd(ajoutes);
        if (added > 0) {
          this._renderList();
          this._updateButtons();
        }
        if (skippedDup > 0) {
          this._showToast?.(
            `${skippedDup} fichier${skippedDup > 1 ? "s" : ""} ignoré${skippedDup > 1 ? "s" : ""} (déjà dans la liste).`,
          );
        }
        if (skippedUnknown > 0) {
          this._showToast?.(
            `${skippedUnknown} fichier${skippedUnknown > 1 ? "s" : ""} ignoré${skippedUnknown > 1 ? "s" : ""} — extension non prise en charge (DOCX, ODT, TXT, TEI/XML, CoNLL-U).`,
          );
        }
      });
    }

    initCardAccordions(root);
    this._refreshRuntimeState();
    void this._refreshDetail();

    return root;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._textPreviewPath = null;
    this._updateButtons();
    this._refreshRuntimeState();
    if (conn) {
      void this._refreshDetail(true);
      // Des fichiers ajoutés avant que le sidecar réponde restaient sur « analyse… »
      // indéfiniment : leur analyse n'avait jamais eu de connexion pour tourner.
      void this._analyzePending();
    }
  }

  /**
   * Bouton « ↻ Actualiser » — force un re-fetch du corpus côté DB pour
   * que la vérification de doublons par nom de fichier (cf. _runImport)
   * et les candidats famille pre-import voient les derniers ajouts faits
   * depuis d'autres panneaux. Ne touche pas à _files (le lot d'import en
   * cours est préservé).
   */
  private async _refreshCorpus(): Promise<void> {
    if (!this._conn) return;
    const btn = this._root?.querySelector<HTMLButtonElement>("#imp-refresh-btn");
    if (btn) btn.disabled = true;
    try {
      this._corpusDocs = await listDocuments(this._conn);
      this._renderList();
      this._showToast?.(`✓ Corpus rafraîchi (${this._corpusDocs.length} doc${this._corpusDocs.length > 1 ? "s" : ""})`);
    } catch (err) {
      this._showToast?.(`✗ Échec rafraîchissement : ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.dataset.source = "import";
    line.textContent = `[${ts}] [Import] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (this._lastErrorMsg && msg.startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
  }

  private _updateButtons(): void {
    const pendingCount = this._files.filter((f) => f.status === "pending").length;
    this._importBtn.disabled = !this._conn || pendingCount === 0;
    this._summaryEl.textContent = `${this._files.length} fichier${this._files.length > 1 ? "s" : ""}`;
    this._refreshRuntimeState();
  }

  /**
   * Sélectionne le fichier qu'on vient d'ajouter — **seulement s'il est seul**.
   *
   * Ajouter un fichier et en ajouter trente-trois ne sont pas le même geste : le
   * premier est une inspection (« qu'est-ce que l'application en fait ? »), le second
   * un chargement, où l'on lit les verdicts dans la liste et non dans le panneau.
   * La cadence réelle du corpus tranche dans le même sens — sur les 11 rafales
   * d'avril à août, **sept sont un fichier seul**, mais 47 documents sur 58 sont
   * arrivés dans les deux grosses.
   *
   * Sur un lot, la sélection ne bouge pas : sauter arbitrairement au dernier des
   * trente-trois ne servirait personne, et déplacerait le panneau sous les yeux de
   * quelqu'un qui regardait autre chose.
   */
  private _selectIfSingleAdd(ajoutes: string[]): void {
    if (ajoutes.length === 1) this._selectedPath = ajoutes[0];
  }

  /**
   * Ajoute un fichier à la file s'il n'y est pas déjà (même chemin normalisé).
   * @returns "added" | "dup_queue"
   */
  private _tryAddSingle(
    path: string,
    fileName: string,
    defaultLang: string,
  ): "added" | "dup_queue" {
    const norm = normalizeImportPath(path);
    if (this._files.some((f) => normalizeImportPath(f.path) === norm)) {
      return "dup_queue";
    }
    const ext = extFromFileName(fileName);
    // Mode d'attente, le temps que `_analyzeFile` lise le fichier et le remplace par
    // le mode déduit. **Paragraphes**, jamais numéroté : c'est celui qui lit *quelque
    // chose* de n'importe quel document, donc le moins mauvais si l'analyse échoue —
    // là où le défaut numéroté produisait un document 100 % `structure`, importé sans
    // un mot et introuvable à la recherche.
    const mode = normalizeModeForExt(deriveModeFromExt(ext, WP_DEFAULT_PARAGRAPHS), ext);
    this._files.push({
      path,
      mode,
      // TEI sans token de langue → champ vide = le xml:lang du document fait foi
      // (DESIGN §11.8, aligné sur ShareDocs). Les autres formats : détecté ou défaut.
      language: detectLanguageForMode(mode, fileName, defaultLang) ?? "",
      // IMP-11 : marquer un défaut non détecté (nom sans code de langue), hors TEI.
      langGuessed: mode !== "tei" && detectLanguageToken(fileName) === null,
      title: fileName,
      status: "pending",
      message: "",
    });
    return "added";
  }

  private async _addFiles(): Promise<void> {
    const selected = await open({
      title: "Sélectionner des fichiers",
      filters: [
        { name: "Corpus", extensions: ["docx", "odt", "txt", "conllu", "conll", "xml", "tei"] },
      ],
      multiple: true,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const defaultLang = (this._root.querySelector("#imp-default-lang") as HTMLInputElement).value.trim() || "fr";

    const ajoutes: string[] = [];
    let added = 0;
    let skippedDup = 0;
    for (const p of paths) {
      const name = p.split("/").pop()?.split("\\").pop() ?? p;
      const r = this._tryAddSingle(p, name, defaultLang);
      if (r === "added") { added++; ajoutes.push(p); }
      else skippedDup++;
    }
    this._selectIfSingleAdd(ajoutes);
    if (added > 0) {
      this._renderList();
      this._updateButtons();
    }
    if (skippedDup > 0) {
      this._showToast?.(
        `${skippedDup} fichier${skippedDup > 1 ? "s" : ""} ignoré${skippedDup > 1 ? "s" : ""} (déjà dans la liste).`,
      );
    }
  }

  private _clearList(): void {
    this._files = [];
    this._familyDialogQueue = [];
    this._renderList();
    this._updateButtons();
  }

  private _applyDefaultsToPending(): void {
    if (!this._root) return;
    if (this._files.length === 0) {
      this._showToast?.(
        "Aucun fichier dans la liste — ajoutez des sources ou glissez-déposez des fichiers.",
        false
      );
      return;
    }
    const defaultLang = (this._root.querySelector("#imp-default-lang") as HTMLInputElement).value.trim() || "fr";
    // On compte SEPAREMENT les fichiers vus et ceux dont la langue a reellement change.
    // Le defaut ne s'applique qu'aux noms sans code de langue, et cette proportion n'est
    // pas diffuse : mesuree le 28 aout 2026 sur 514 fichiers reels, elle vaut 1 % dans un
    // corpus (GRAFE-Lit, tout tokenise) et 99 % dans l'autre (CI, aucun). Un lot entier
    // peut donc ne rien changer — et l'ancien message affirmait quand meme un succes sur
    // tous les fichiers en attente, ce qui etait le seul retour visible du bouton.
    let vus = 0;
    let changes = 0;
    for (const file of this._files) {
      if (file.status !== "pending") continue;
      vus += 1;
      const avant = file.language;
      const base = file.path.split(/[/\\]/u).pop() ?? "";
      // Le MODE n'est plus réappliqué ici : il est déduit du fichier (`_analyzeFile`)
      // et le profil de lot ne le décide plus. Il décidait pour tous à la fois, et il
      // était faux — mesuré le 27 août 2026 sur 273 fichiers réels, son défaut
      // « Lignes numérotées [n] » se trompait sur 149 d'entre eux.
      // Ne pas imposer le défaut à un TEI sans token : laisser le xml:lang décider
      // (champ vide), cohérent avec _tryAddSingle (DESIGN §11.8).
      file.language = detectLanguageForMode(file.mode, base, defaultLang) ?? "";
      file.langGuessed = file.mode !== "tei" && detectLanguageToken(base) === null; // IMP-11
      if (file.language !== avant) changes += 1;
    }
    this._renderList();
    this._updateButtons();
    if (vus === 0) {
      // La liste n'est pas vide (cas traite plus haut) : tout y est deja importe ou en
      // erreur. Ne PAS conseiller de « reinitialiser une ligne en erreur » — ce geste
      // n'existe nulle part dans l'ecran.
      this._showToast?.(
        "Aucun fichier en attente — les lignes de la liste sont déjà importées ou en erreur.",
        false,
      );
    } else if (changes === 0) {
      this._log(
        `Langue par défaut « ${defaultLang} » sans effet : les ${vus} fichier(s) en attente `
        + "portent déjà un code de langue dans leur nom, qui prime sur le défaut."
      );
      this._showToast?.(
        `Aucune langue à changer — les ${vus} fichier(s) en attente portent leur code dans leur nom.`,
        false,
      );
    } else {
      const reste = vus - changes;
      const suffixe = reste > 0
        ? ` ; ${reste} inchangé(s), leur nom portant déjà un code de langue`
        : "";
      this._log(`✓ Langue « ${defaultLang} » appliquée à ${changes} fichier(s) en attente${suffixe}.`);
    }
  }

  /**
   * Couleur de la pastille de statut. Prend le FICHIER et non son seul statut : un
   * import abouti sans aucune unite indexable n'est pas un succes ordinaire, et la
   * pastille verte le faisait pourtant passer pour tel.
   */
  private _chipClass(f: FileItem): string {
    if (f.status === "done") return f.importedLine === 0 ? "warn" : "ok";
    if (f.status === "importing") return "warn";
    if (f.status === "error") return "error";
    return "";
  }

  private _renderList(): void {
    this._updateButtons();
    if (this._files.length === 0) {
      this._listEl.innerHTML = '<p class="empty-hint">Aucun fichier sélectionné.</p>';
      this._selectedPath = null;
      this._renderQueueWarning();
      this._updatePrecheck();
      this._detectAndShowFamilyBanner();
      void this._refreshDetail();
      return;
    }
    // Résolue AVANT de peindre : une sélection posée après coup laisserait la ligne
    // avec `aria-pressed="false"` et une classe ajoutée à la main, donc deux vérités.
    if (this._selectedPath === null
        || !this._files.some((f) => f.path === this._selectedPath)) {
      this._selectedPath = this._files[0].path;
    }
    this._listEl.innerHTML = "";
    this._files.forEach((f, i) => {
      const ext = extFromFileName(f.title);
      const normMode = normalizeModeForExt(f.mode, ext);
      if (normMode !== f.mode) f.mode = normMode;
      const row = document.createElement("div");
      const selected = f.path === this._selectedPath;
      row.className = `imp-file-item imp-file-item-${f.status}${selected ? " imp-file-item-sel" : ""}`;
      row.dataset.index = String(i);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", selected ? "true" : "false");
      const chipCls = this._chipClass(f);
      // La ligne ne porte QUE ce qui doit être vu sans avoir été cherché : le nom, le
      // statut, et le verdict de la déduction. Les commandes — mode, colonne, langue,
      // titre — vivent dans le panneau du fichier sélectionné, où elles tiennent
      // à l'aise et voisinent l'évidence qui les justifie.
      const verdict = f.status === "pending" ? buildVerdictHtml(this._verdictOf(f)) : "";
      setHtml(row, raw(`
        <div class="imp-file-main">
          <span class="imp-file-name" title="${_escHtml(f.path)}">${_escHtml(f.title)}</span>
          <span class="chip${chipCls ? " " + chipCls : ""}">${_escHtml(importStatusLabel(f))}</span>
          <button class="btn btn-sm imp-remove-btn" data-i="${i}" aria-label="Retirer ce fichier de la liste" title="Retirer ce fichier de la liste">✕</button>
        </div>
        ${verdict ? `<div class="imp-file-verdict">${verdict}</div>` : ""}
      `));
      this._listEl.appendChild(row);
    });

    this._listEl.querySelectorAll<HTMLElement>(".imp-file-item").forEach((el) => {
      const pick = (e: Event) => {
        // Le ✕ vit dans la ligne : sans ça, retirer un fichier le sélectionnerait
        // d'abord, et le panneau afficherait un fichier qui n'existe plus.
        if ((e.target as HTMLElement).closest(".imp-remove-btn")) return;
        const i = parseInt(el.dataset.index!, 10);
        this._selectFile(this._files[i]);
      };
      el.addEventListener("click", pick);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); }
      });
    });
    this._listEl.querySelectorAll(".imp-remove-btn").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = parseInt((e.target as HTMLElement).dataset.i!);
        const [ote] = this._files.splice(i, 1);
        if (ote && ote.path === this._selectedPath) this._selectedPath = null;
        this._renderList();
        this._updateButtons();
      });
    });

    this._renderQueueWarning();

    this._updatePrecheck();
    // Le bandeau des familles est une pure fonction des fichiers en attente : il se
    // recalcule ici, avec tout le reste, plutôt qu'aux seuls points d'ajout — sinon
    // vider la liste, retirer un fichier ou terminer un import le laissait décrire
    // des fichiers qui n'y sont plus.
    this._detectAndShowFamilyBanner();
    void this._refreshDetail();
    void this._analyzePending();
  }

  /**
   * Le panneau du fichier sélectionné — commandes, comparaison des modes, extrait.
   *
   * Un seul panneau pour deux rendus : des unités pour un fichier texte, des tokens
   * pour un CoNLL-U. C'est ce qui permet de retirer la carte « Aperçu CoNLL-U », qui
   * restait dépliée en permanence pour annoncer qu'aucun `.conllu` n'était sélectionné
   * — alors qu'il n'en existe aucun sur le disque de l'utilisateur ni dans son corpus.
   * La capacité reste entière : le mode est toujours dans le sélecteur.
   */
  private async _refreshDetail(force = false): Promise<void> {
    if (!this._detailBodyEl) return;
    const file = this._selectedFile();
    if (!file) {
      this._detailTitleEl.textContent = "Aucun fichier sélectionné";
      this._detailEmptyEl.hidden = false;
      this._detailBodyEl.hidden = true;
      this._textPreviewPath = null;
      this._conlluPreviewPath = null;
      return;
    }
    this._detailTitleEl.textContent = file.title;
    this._detailEmptyEl.hidden = true;
    this._detailBodyEl.hidden = false;
    this._syncDetailControls(file);

    const isConllu = file.mode === "conllu";
    this._textWrapEl.hidden = isConllu;
    this._conlluWrapEl.hidden = !isConllu;
    // La comparaison et la note de tableau ne concernent que les formats texte : un
    // CoNLL-U répond une charge d'une autre forme (`conllu_stats`, pas des unités).
    if (isConllu) {
      this._textCmpEl.hidden = true;
      this._textTablesEl.hidden = true;
      await this._refreshConlluPreview(file, force);
    } else {
      await this._refreshTextPreview(file, force);
    }
  }

  /** Recopie l'état du fichier sélectionné dans les commandes du panneau. */
  private _syncDetailControls(file: FileItem): void {
    const ext = extFromFileName(file.title);
    const opts = modeOptionsForExt(ext);
    // Construit par le DOM, pas par du HTML : les libellés sont internes, mais un
    // sink `innerHTML` de plus est un sink de plus à surveiller.
    this._detailModeSel.replaceChildren(...opts.map((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }));
    this._detailModeSel.value = file.mode;
    // Le champ « Colonne » reste VISIBLE mais désactivé sur un format qui ne la connaît
    // pas. Le masquer faisait glisser les champs voisins d'un fichier à l'autre ; et un
    // champ grisé dit que la capacité existe, là où un champ absent ne dit rien.
    const colonneOk = modeAcceptsColumn(file.mode);
    this._detailColWrap.classList.toggle("imp-detail-field-off", !colonneOk);
    this._detailColWrap.title = colonneOk
      ? "Colonne du tableau à extraire (1 = première). Laisser vide pour ignorer les tables."
      : "Ce format ne connaît pas les colonnes de tableau — seuls les modes DOCX les lisent.";
    this._detailColInp.value = file.column_index != null ? String(file.column_index) : "";
    this._detailLangInp.value = file.language;
    this._detailLangInp.placeholder = file.mode === "tei" ? "xml:lang" : "lang";
    // IMP-11 : une langue prise par DÉFAUT (aucun code dans le nom) reste signalée —
    // 42 % des fichiers d'un corpus réel sont dans ce cas.
    this._detailLangInp.classList.toggle("imp-lang-guessed", !!file.langGuessed);
    this._detailLangInp.title = file.mode === "tei"
      ? "TEI : laisser vide pour conserver le xml:lang du document ; renseigner pour forcer une langue."
      : file.langGuessed
        ? "⚠ Langue par défaut (aucun code détecté dans le nom de fichier) — vérifiez."
        : "Code de langue (ex. fr, en).";
    this._detailTitleInp.value = file.title;
    const fige = file.status !== "pending";
    for (const el of [this._detailModeSel, this._detailLangInp, this._detailTitleInp]) {
      el.disabled = fige;
    }
    this._detailColInp.disabled = fige || !colonneOk;
  }

  /** Branche les commandes du panneau sur le fichier sélectionné. */
  private _bindDetailControls(): void {
    this._detailModeSel.addEventListener("change", () => {
      const f = this._selectedFile();
      if (!f) return;
      f.mode = this._detailModeSel.value;
      // L'utilisateur a tranché : la déduction ne réécrira plus son choix. Elle
      // propose, elle n'impose pas — et c'est ce qui la rend contestable.
      f.modeLocked = true;
      // Le column_index n'a pas de sens hors des modes qui l'honorent. Passer d'un
      // mode DOCX à l'autre le CONSERVE : c'est le geste même de comparer ce que
      // chaque mode fait de la même colonne.
      if (!modeAcceptsColumn(f.mode)) f.column_index = undefined;
      this._textPreviewPath = null;
      this._conlluPreviewPath = null;
      this._renderList();
    });
    this._detailColInp.addEventListener("input", () => {
      const f = this._selectedFile();
      if (!f) return;
      const brut = this._detailColInp.value.trim();
      if (brut === "") {
        f.column_index = undefined;
      } else {
        const n = parseInt(brut, 10);
        f.column_index = Number.isFinite(n) && n >= 1 ? n : undefined;
      }
      // La colonne change ce que le fichier contient : le verdict est à refaire.
      // Sans ça, « indiquez la colonne à extraire » survivrait à sa propre réponse.
      f.plan = undefined;
      f.searchable = undefined;
      // L'aperçu est gardé par le CHEMIN, qui ne bouge pas d'une colonne à l'autre :
      // sans ce forçage, changer de colonne laissait l'aperçu sur la précédente.
      this._textPreviewPath = null;
      void this._refreshDetail(true);
      void this._analyzePending();
    });
    this._detailLangInp.addEventListener("input", () => {
      const f = this._selectedFile();
      if (!f) return;
      f.language = this._detailLangInp.value;
      // IMP-11 : l'utilisateur a revu la langue → ne plus la signaler comme devinée.
      if (f.langGuessed) {
        f.langGuessed = false;
        this._detailLangInp.classList.remove("imp-lang-guessed");
      }
    });
    this._detailTitleInp.addEventListener("input", () => {
      const f = this._selectedFile();
      if (!f) return;
      f.title = this._detailTitleInp.value;
      this._detailTitleEl.textContent = f.title;
      // La liste porte le titre : la garder muette la laisserait mentir.
      const sel = this._listEl.querySelector(".imp-file-item-sel .imp-file-name");
      if (sel) sel.textContent = f.title;
    });
  }

  /**
   * Ce que la file annonce **avant** qu'on appuie sur Importer.
   *
   * Rendu **hors de la liste**, qui défile (`max-height: 42vh`) : injecté dedans, le
   * bandeau disparaissait au premier défilement, alors qu'il compte précisément ce
   * qu'on est sur le point d'importer. Un avertissement qui sort de l'écran cesse
   * d'avertir.
   */
  private _renderQueueWarning(): void {
    if (!this._queueWarnEl) return;
    const warn = buildQueueWarningHtml(
      this._files.filter((f) => f.status === "pending").map((f) => this._verdictOf(f)),
    );
    this._queueWarnEl.hidden = warn === null;
    setHtml(this._queueWarnEl, raw(warn ?? ""));
  }

  /** Le fichier sélectionné, ou `null` s'il a quitté la liste. */
  private _selectedFile(): FileItem | null {
    return this._files.find((f) => f.path === this._selectedPath) ?? null;
  }

  /** Sélectionne un fichier : la liste marque, le panneau suit. */
  private _selectFile(file: FileItem | undefined): void {
    if (!file || file.path === this._selectedPath) return;
    this._selectedPath = file.path;
    this._renderList();
  }

  private _updatePrecheck(): void {
    const total   = this._files.length;
    const pending = this._files.filter(f => f.status === "pending").length;
    const done    = this._files.filter(f => f.status === "done").length;
    const errors  = this._files.filter(f => f.status === "error").length;
    const set = (id: string, v: number) => {
      const el = this._root?.querySelector(`#${id}`);
      if (el) el.textContent = String(v);
    };
    set("imp-diag-total", total);
    set("imp-diag-pending", pending);
    set("imp-diag-done", done);
    set("imp-diag-errors", errors);
    const badge = this._root?.querySelector("#imp-precheck-badge");
    if (!badge) return;
    if (errors > 0)       { badge.textContent = `${errors} erreur${errors > 1 ? "s" : ""}`; badge.className = "chip error"; }
    else if (pending > 0) { badge.textContent = `${pending} en attente`;                    badge.className = "chip warn"; }
    else if (done > 0)    { badge.textContent = "Tout importé";                             badge.className = "chip ok"; }
    else                  { badge.textContent = "—";                                        badge.className = "chip"; }
  }


  /** Aperçu CoNLL-U du fichier **sélectionné**, rendu dans le panneau de détail. */
  private async _refreshConlluPreview(file: FileItem, force = false): Promise<void> {
    if (!this._conlluRowsEl) return;
    if (!force && this._conlluPreviewPath === file.path) {
      return;
    }

    const reqId = ++this._conlluPreviewReq;
    this._conlluRowsEl.innerHTML = '<tr><td colspan="5" class="empty-hint">Chargement…</td></tr>';
    try {
      // Use sidecar when available (accurate Python parser); fall back to JS parser.
      let sentences: number, tokensTotal: number, skippedRanges: number,
        skippedEmptyNodes: number, malformedLines: number,
        rows: Array<{ sent: number; id: string; form: string; lemma: string; upos: string }>;
      let notUtf8 = false; // IMP-03 : l'import CoNLL-U est strict UTF-8

      if (this._conn) {
        const res = await previewImport(this._conn, { path: file.path, mode: "conllu", limit: 60 });
        if (reqId !== this._conlluPreviewReq) return;
        const s = res.conllu_stats!;
        sentences = s.sentences;
        tokensTotal = s.tokens;
        skippedRanges = s.skipped_ranges;
        skippedEmptyNodes = s.skipped_empty_nodes;
        malformedLines = s.malformed_lines;
        rows = s.sample_rows;
        notUtf8 = s.not_utf8 ?? false; // IMP-03
      } else {
        const content = await readTextFile(file.path);
        if (reqId !== this._conlluPreviewReq) return;
        const preview = parseConlluPreview(content, 60);
        sentences = preview.sentences;
        tokensTotal = preview.tokensTotal;
        skippedRanges = preview.skippedRanges;
        skippedEmptyNodes = preview.skippedEmptyNodes;
        malformedLines = preview.malformedLines;
        rows = preview.rows;
      }

      this._conlluPreviewPath = file.path;

      const metaParts = [
        `${sentences} phrase${sentences > 1 ? "s" : ""}`,
        `${tokensTotal} token${tokensTotal > 1 ? "s" : ""}`,
      ];
      if (skippedRanges > 0) metaParts.push(`${skippedRanges} plage(s) multi-mots ignorée(s)`);
      if (skippedEmptyNodes > 0) metaParts.push(`${skippedEmptyNodes} nœud(s) vide(s) ignoré(s)`);
      if (malformedLines > 0) metaParts.push(`${malformedLines} ligne(s) mal formée(s)`);
      // IMP-03 : l'aperçu tolère le non-UTF-8 mais l'import le rejette → prévenir ici.
      if (notUtf8) metaParts.push("⚠ non-UTF-8 — l'import rejettera ce fichier (ré-enregistrez en UTF-8)");
      this._detailSummaryEl.textContent = metaParts.join(" • ");

      this._conlluRowsEl.innerHTML = "";
      if (rows.length === 0) {
        this._conlluRowsEl.innerHTML = '<tr><td colspan="5" class="empty-hint">Aucun token exploitable trouvé.</td></tr>';
        return;
      }
      for (const row of rows) {
        const tr = document.createElement("tr");
        const tdSent = document.createElement("td");
        tdSent.textContent = String(row.sent);
        const tdId = document.createElement("td");
        tdId.textContent = row.id;
        const tdForm = document.createElement("td");
        tdForm.textContent = row.form;
        const tdLemma = document.createElement("td");
        tdLemma.textContent = row.lemma;
        const tdUpos = document.createElement("td");
        tdUpos.textContent = row.upos;
        tr.append(tdSent, tdId, tdForm, tdLemma, tdUpos);
        this._conlluRowsEl.appendChild(tr);
      }
    } catch (err) {
      if (reqId !== this._conlluPreviewReq) return;
      this._conlluPreviewPath = null;
      this._detailSummaryEl.textContent = "Lecture impossible du fichier CoNLL-U.";
      this._conlluRowsEl.innerHTML = '<tr><td colspan="5" class="empty-hint">Erreur de lecture du fichier.</td></tr>';
      this._log(
        `Aperçu CoNLL-U indisponible (${file.title}): ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }


  /**
   * IMPO-01 — dire ce que le fichier CONTIENT avant de lui demander une colonne.
   *
   * Le champ « colonne » n'avait de sens que pour qui connaissait déjà le document :
   * rien à l'écran n'annonçait combien de colonnes existent, ni même qu'il y avait un
   * tableau. La note décrit, elle ne conclut pas — porter un tableau ne fait pas d'un
   * document un bitexte (un fichier du corpus local en porte sept, de mise en page).
   */
  private _renderTablesNote(file: FileItem): void {
    const label = describeTablesLabel(this._textPreviewTables);
    if (!label) {
      this._textTablesEl.hidden = true;
      return;
    }
    this._textTablesEl.hidden = false;
    this._textTablesMsgEl.textContent = label;
    const columns = uniformTableColumns(this._textPreviewTables);
    // Rien à proposer : sur une table d'une seule colonne, sur des tables qui se
    // contredisent (mise en page, jamais un bitexte — cf. `uniformTableColumns`), sur
    // un fichier déjà éclaté (la liste porte alors plusieurs lignes pour ce chemin),
    // ni sur une ligne qui n'est plus en attente — la découper réécrirait le titre
    // d'un document DÉJÀ importé sans colonne, ce qui serait un mensonge.
    const queued = this._files.filter(
      (f) => normalizeImportPath(f.path) === normalizeImportPath(file.path),
    ).length;
    this._textTablesSplitBtn.hidden =
      columns < 2 || queued > 1 || file.status !== "pending";
  }

  /**
   * Ajoute le fichier prévisualisé une fois par colonne dans la liste d'import.
   *
   * C'est le geste qui manquait : un bitexte en tableau est **un** fichier qui doit
   * produire **deux** documents, et la liste refusait le même chemin deux fois. Les
   * titres sont suffixés pour qu'ils ne collident pas ; le moteur, lui, distingue les
   * colonnes par l'identité `(fichier, colonne)` et refuse toujours deux fois la même.
   */
  private _splitPreviewedFileByColumn(): void {
    const file = this._selectedFile();
    if (!file) return;
    // Le bouton peut rester affiché après un import : l'aperçu ne se rafraîchit pas de
    // lui-même. Refuser en silence laisserait croire à un clic manqué.
    if (file.status !== "pending") {
      this._log(
        `↳ "${file.title}" n'est plus en attente — vider la liste et le rajouter pour le découper par colonne.`,
        true,
      );
      return;
    }
    const columns = uniformTableColumns(this._textPreviewTables);
    if (columns < 2) return;
    const at = this._files.indexOf(file);
    if (at < 0) return;

    const base = file.title.replace(/ — col\. \d+$/u, "");
    file.column_index = 1;
    file.title = `${base} — col. 1`;
    // Le verdict portait sur le fichier ENTIER, où rien n'est lisible hors tableau :
    // le recopier tel quel ferait réclamer à chaque colonne celle qu'on vient de lui
    // donner. Chaque ligne se fait réanalyser avec la sienne.
    file.plan = undefined;
    file.searchable = undefined;
    const clones: FileItem[] = [];
    for (let c = 2; c <= columns; c += 1) {
      clones.push({
        ...file,
        column_index: c,
        title: `${base} — col. ${c}`,
        status: "pending",
        message: "",
        plan: undefined,
        searchable: undefined,
      });
    }
    this._files.splice(at + 1, 0, ...clones);
    this._log(`↳ "${base}" : un document par colonne (${columns} colonnes)`);
    this._textPreviewPath = null;
    this._renderList();
    void this._refreshDetail(true);
  }

  /**
   * L'aperçu comparatif (IMPO-01) : ce que **chaque** mode applicable ferait du fichier.
   *
   * Calculé **à la sélection**, jamais à l'ajout : un parse complet par mode coûte 32 à
   * 251 ms sur un DOCX du corpus (mesuré le 27 août), donc ajouter 25 fichiers en paierait
   * ~4 s pour rien — l'aperçu n'en montre de toute façon qu'un à la fois.
   *
   * Un mode qui échoue n'annule pas la comparaison : sa ligne est marquée illisible, les
   * autres restent lisibles. C'est justement quand un mode ne passe pas que voir les autres
   * a le plus de valeur.
   */
  /**
   * Analyse les fichiers en attente : un aperçu chacun, la numérotation lue dessus,
   * puis le mode déduit et posé (IMPO-01, lot « l'écran décide et le dit »).
   *
   * **Un seul appel par fichier, en mode paragraphes** — celui qui ne retire rien, donc
   * le seul où les marqueurs sont encore visibles. Il répond du même coup à la question
   * de sûreté (« quelque chose sera-t-il trouvable ? ») sans second aller-retour : si
   * des marqueurs `[n]` sont là, le mode numéroté rendra des unités, c'est certain ;
   * s'il n'y en a pas, `units_line` de cet appel *est* le compte du mode paragraphes.
   *
   * **En série, pas en parallèle.** Mesuré le 27 août : 32 à 251 ms par DOCX. Une
   * rafale de 33 fichiers — la plus grosse de l'historique réel — coûte donc quelques
   * secondes, pendant lesquelles chaque ligne se met à jour dès que la sienne tombe,
   * plutôt que d'ouvrir 33 requêtes d'un coup au sidecar.
   */
  private async _analyzePending(): Promise<void> {
    if (!this._conn || this._analyzing) return;
    this._analyzing = true;
    try {
      // Relu à chaque tour : la liste bouge pendant l'analyse (ajout, retrait,
      // éclatement par colonne). On travaille sur les fichiers, pas sur les index.
      //
      // La connexion est retestée à CHAQUE tour, pas seulement à l'entrée : si le
      // sidecar tombe en cours de route, `_analyzeFile` rend la main sans poser de
      // verdict, et le même fichier ressortirait indéfiniment. `setConn` relance la
      // boucle quand la connexion revient.
      while (this._conn) {
        const file = this._files.find((f) => f.status === "pending" && f.plan === undefined);
        if (!file) break;
        await this._analyzeFile(file);
      }
    } finally {
      this._analyzing = false;
    }
  }

  /** Analyse un fichier et pose son verdict. Ne jette jamais : un échec est un verdict. */
  private async _analyzeFile(file: FileItem): Promise<void> {
    const conn = this._conn;
    const ext = extFromFileName(file.path);
    if (!conn) return;
    // Le mode de lecture, pas le mode d'import : on veut voir le texte tel quel.
    const probe = ext === "docx" ? "docx_paragraphs"
      : ext === "odt" ? "odt_paragraphs"
      : ext === "txt" ? "txt_numbered_lines"
      : null;
    if (probe === null) {
      // TEI / CoNLL-U : rien à déduire, le format se décrit lui-même.
      file.plan = planImport({ ext, numbering: null, searchableInProbe: 0 });
      file.searchable = null;
      this._renderList();
      return;
    }
    try {
      const res = await previewImport(conn, {
        path: file.path,
        mode: probe,
        limit: 50,
        ...(modeAcceptsColumn(probe) && file.column_index ? { column_index: file.column_index } : {}),
      });
      const numbering = detectNumbering((res.units ?? []).map((u) => stripHiTags(u.text_raw ?? "")));
      const plan = planImport({
        ext,
        numbering: numbering.form,
        searchableInProbe: res.units_line ?? 0,
        uniformColumns: uniformTableColumns(res.tables),
        hasColumn: file.column_index !== undefined,
      });
      file.plan = plan;
      // Le compte n'est exact que si le mode déduit EST celui qu'on vient de lire.
      file.searchable = plan.mode === probe ? (res.units_line ?? 0) : null;
      // Le choix de l'utilisateur prime : on ne réécrit pas un mode qu'il a posé.
      if (!file.modeLocked) file.mode = plan.mode;
    } catch {
      // Illisible : on ne prétend rien. La ligne le dira, l'import échouera de son côté.
      file.plan = null;
      file.searchable = null;
    }
    this._renderList();
  }

  /** Le verdict d'un fichier tel que la ligne l'affiche, ou `null` si pas encore su. */
  private _verdictOf(f: FileItem): FileVerdict | null {
    if (!f.plan) return null;
    const opts = modeOptionsForExt(extFromFileName(f.path));
    const labelOf = (m: string) => opts.find((o) => o.value === m)?.label ?? m;
    return verdictForChoice(
      f.plan, f.mode, labelOf(f.mode), labelOf(f.plan.mode), f.searchable ?? null,
    );
  }

  private async _refreshModeComparison(file: FileItem): Promise<void> {
    if (!this._conn || !this._textCmpEl) return;
    const modes = comparableModesForExt(extFromFileName(file.path));
    if (modes.length === 0) {
      this._textCmpEl.hidden = true;
      return;
    }
    const reqId = ++this._textCmpReq;
    const conn = this._conn;
    const column = modeAcceptsColumn(file.mode) ? file.column_index : undefined;
    const labelOf = (m: string) =>
      modeOptionsForExt(extFromFileName(file.path)).find((o) => o.value === m)?.label ?? m;

    const rows: ModeComparisonRow[] = await Promise.all(
      modes.map(async (mode): Promise<ModeComparisonRow> => {
        try {
          const res = await previewImport(conn, {
            path: file.path,
            mode,
            limit: 1,
            ...(modeAcceptsColumn(mode) && column ? { column_index: column } : {}),
          });
          // Un seul appel, `limit: 1` : les comptes par type viennent du moteur
          // (contrat 1.6.80), qui les calcule sur TOUTES les unités. Les déduire de la
          // liste imposerait de rapatrier le document entier, par mode.
          if (res.units_line === undefined) {
            // Sidecar antérieur au contrat 1.6.80 : il ne compte pas les unités par type.
            // Retomber sur 0 ferait conclure « aucun mode ne lit ce document » sur TOUS
            // les fichiers — un faux verdict est pire que pas de tableau du tout.
            throw new Error("units_line absent (sidecar < 1.6.80)");
          }
          return {
            mode,
            label: labelOf(mode),
            units: res.units_total ?? 0,
            searchable: res.units_line,
            sample: stripHiTags(res.units?.[0]?.text_raw ?? ""),
          };
        } catch {
          return { mode, label: labelOf(mode), units: 0, searchable: 0, sample: "", failed: true };
        }
      }),
    );
    if (reqId !== this._textCmpReq) return;

    // Aucun mode lisible : soit le fichier est illisible partout, soit le sidecar
    // embarqué est antérieur au contrat 1.6.80. Se taire plutôt que de rendre un
    // tableau de zéros dont la conclusion serait fausse.
    if (rows.every((r) => r.failed)) {
      this._textCmpEl.hidden = true;
      return;
    }

    this._textCmpEl.hidden = false;
    setHtml(this._textCmpEl, raw(buildModeComparisonHtml({
      rows,
      currentMode: file.mode,
      // Le tableau recommande le mode que la **déduction** a posé sur la carte du
      // fichier, pas celui qui compte le plus d'unités : sans ça l'écran se
      // contredirait, la carte posant un mode et le tableau juste en dessous en
      // recommandant un autre. Le comptage garde la seule question où il ne peut
      // pas se tromper — quelque chose lit-il ce document ?
      bestMode: recommendedMode(rows.filter((r) => !r.failed), file.plan?.mode),
    })));
    this._textCmpEl.querySelectorAll(".imp-cmp-pick").forEach((el) => {
      el.addEventListener("click", () => {
        const mode = (el as HTMLElement).dataset.mode;
        if (!mode || mode === file.mode) return;
        file.mode = mode;
        // Même geste que le sélecteur de la ligne : c'est un choix, la déduction ne
        // le réécrira pas — y compris après un changement de colonne, qui relance
        // l'analyse.
        file.modeLocked = true;
        if (!modeAcceptsColumn(mode)) file.column_index = undefined;
        this._textPreviewPath = null;
        this._renderList();
        void this._refreshDetail(true);
      });
    });
  }

  /** Aperçu des unités du fichier **sélectionné**, rendu dans le panneau de détail. */
  private async _refreshTextPreview(file: FileItem, force = false): Promise<void> {
    if (!this._textPreviewRowsEl) return;
    if (!this._conn) {
      this._detailSummaryEl.textContent =
        "Sidecar non connecté — aperçu indisponible.";
      this._textPreviewRowsEl.innerHTML = '<tr><td colspan="3" class="empty-hint">Aperçu indisponible.</td></tr>';
      return;
    }
    if (!force && this._textPreviewPath === file.path) return;

    const reqId = ++this._textPreviewReq;
    this._textPreviewRowsEl.innerHTML = '<tr><td colspan="3" class="empty-hint">Chargement…</td></tr>';
    try {
      const res = await previewImport(this._conn, {
        path: file.path,
        mode: file.mode,
        limit: 50,
        ...(modeAcceptsColumn(file.mode) && file.column_index
          ? { column_index: file.column_index }
          : {}),
      });
      if (reqId !== this._textPreviewReq) return;
      this._textPreviewPath = file.path;

      this._textPreviewTables = res.tables ?? null;
      this._renderTablesNote(file);
      void this._refreshModeComparison(file);

      const units = res.units;
      const unitsTotal = res.units_total ?? 0;
      const truncated = res.truncated ?? false;

      if (!units || units.length === 0) {
        this._detailSummaryEl.textContent = "Aucune unité détectée.";
        this._textPreviewRowsEl.innerHTML = '<tr><td colspan="3" class="empty-hint">Aucune unité exploitable trouvée.</td></tr>';
        return;
      }

      const pl = unitsTotal > 1 ? "s" : "";
      const truncNote = truncated ? ` — ${units.length}/${unitsTotal} affichées` : "";
      this._detailSummaryEl.textContent = `${unitsTotal} unité${pl}${truncNote}`;

      this._textPreviewRowsEl.innerHTML = "";
      for (const unit of units) {
        const tr = document.createElement("tr");
        const tdId = document.createElement("td");
        tdId.textContent = unit.external_id != null ? String(unit.external_id) : "—";
        const tdType = document.createElement("td");
        tdType.textContent = unit.unit_type ?? "—";
        const tdText = document.createElement("td");
        tdText.className = "imp-text-preview-cell";
        // Le balisage `<hi>` était affiché en toutes lettres — la première unité d'un
        // bitexte en tableau sort en `<hi rend="bold">Texte 1</hi>`. L'aperçu répond
        // « ce qui sera importé et où ça coupe », pas « à quoi ça ressemble » :
        // dépouiller suffit, et la troncature à 120 cesse de compter les balises, qui
        // faisaient voir moins de texte sur les lignes stylées que sur les autres.
        const raw = stripHiTags(unit.text_raw ?? "");
        tdText.textContent = raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
        tdText.title = raw;
        tr.append(tdId, tdType, tdText);
        this._textPreviewRowsEl.appendChild(tr);
      }
    } catch (err) {
      if (reqId !== this._textPreviewReq) return;
      this._textPreviewPath = null;
      // Sans ça, la note gardait la forme du fichier PRÉCÉDENT et le bouton proposait
      // de découper celui-ci selon les colonnes d'un autre document.
      this._textPreviewTables = null;
      this._textTablesEl.hidden = true;
      this._textCmpEl.hidden = true;
      this._detailSummaryEl.textContent = "Lecture impossible du fichier.";
      this._textPreviewRowsEl.innerHTML = '<tr><td colspan="3" class="empty-hint">Erreur de lecture du fichier.</td></tr>';
      this._log(
        `Aperçu texte indisponible (${file.title}): ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }

  private async _runImport(): Promise<void> {
    if (!this._conn) return;
    this._importBtn.disabled = true;
    this._isBusy = true;
    this._refreshRuntimeState();

    const pending = this._files.filter(f => f.status === "pending");
    if (pending.length === 0) {
      this._importBtn.disabled = false;
      this._isBusy = false;
      this._refreshRuntimeState();
      return;
    }

    this._log(`Envoi de ${pending.length} import(s) en job asynchrone…`);

    let submitted = 0;
    let finished = 0;

    const onAllDone = () => {
      this._importBtn.disabled = false;
      this._isBusy = false;
      this._updateButtons();
    };

    const corpusByPath = new Map<string, number>();
    const corpusByFilename = new Map<string, number>(); // nom de fichier → doc_id
    try {
      const docs = await listDocuments(this._conn);
      for (const d of docs) {
        const sp = d.source_path;
        if (typeof sp === "string" && sp.length > 0) {
          corpusByPath.set(normalizeImportPath(sp), d.doc_id);
          const fname = sp.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
          if (fname) corpusByFilename.set(fname, d.doc_id);
        }
      }
    } catch (err) {
      this._log(
        `Liste documents indisponible pour pré-contrôle doublons : ${err instanceof Error ? err.message : String(err)}`,
        true
      );
      this._showToast?.(
        "Impossible de charger les documents existants — le serveur bloquera tout de même les doublons (hash / chemin).",
        true
      );
    }

    const checkFilename = (this._root?.querySelector<HTMLInputElement>("#imp-check-filename-footer"))?.checked
      ?? (this._root?.querySelector<HTMLInputElement>("#imp-check-filename"))?.checked
      ?? false;

    for (const f of pending) {
      const existingId = corpusByPath.get(normalizeImportPath(f.path));
      // IMPO-01 — le contrôle par CHEMIN cède quand une colonne est demandée : un
      // bitexte en tableau est un fichier qui doit produire plusieurs documents, et
      // ils partagent tous ce chemin. Le moteur reste le garde-fou — il refuse deux
      // fois la MÊME colonne, l'identité d'un document extrait étant (fichier, colonne).
      if (existingId !== undefined && !f.column_index) {
        f.status = "error";
        f.message = `Déjà dans le corpus (doc_id ${existingId})`;
        this._log(`⊘ "${f.title}": ${f.message}`, true);
        this._showToast?.(`⊘ ${f.title} — déjà importé (doc_id ${existingId})`, true);
        this._renderList();
        continue;
      }

      if (checkFilename) {
        const fname = f.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
        const existingByName = corpusByFilename.get(fname);
        if (existingByName !== undefined) {
          f.status = "error";
          const sameBatch = existingByName === -1;
          f.message = sameBatch
            ? "Même nom de fichier qu’un autre fichier de ce lot"
            : `Nom de fichier déjà présent (doc_id ${existingByName})`;
          this._log(
            sameBatch
              ? `⊘ "${f.title}": doublon par nom dans le lot en cours`
              : `⊘ "${f.title}": doublon par nom de fichier (doc_id ${existingByName})`,
            true
          );
          this._showToast?.(
            sameBatch
              ? `⊘ ${f.title} — nom déjà utilisé dans ce lot`
              : `⊘ ${f.title} — nom déjà importé (doc_id ${existingByName})`,
            true
          );
          this._renderList();
          continue;
        }
        // Enregistre aussi les fichiers en cours de batch pour bloquer les doublons intra-lot
        if (fname) corpusByFilename.set(fname, -1);
      }

      f.status = "importing";
      this._renderList();
      try {
        // TEI au champ vide → ne pas forcer "und" : l'importeur garde le xml:lang du
        // document (DESIGN §11.8). Les autres formats retombent sur "und" si vide.
        const fileLang = f.mode === "tei" ? f.language || undefined : f.language || "und";
        const job = await enqueueJob(this._conn!, "import", {
          mode: f.mode,
          path: f.path,
          language: fileLang,
          title: f.title,
          check_filename: checkFilename,
          ...(modeAcceptsColumn(f.mode) && f.column_index
            ? { column_index: f.column_index }
            : {}),
        });
        submitted++;
        this._log(`Job soumis pour "${f.title}" (${job.job_id.slice(0, 8)}…)`);
        const fileTitle = f.title;
        this._jobCenter?.trackJob(job.job_id, `Import: ${f.title}`, (done) => {
          finished++;
          if (done.status === "done") {
            const result = done.result as {
              doc_id?: number;
              units_line?: number;
              units_structure?: number;
              tables_processed?: number;
              rows_skipped_short?: number;
              nested_tables_skipped?: number;
              warnings?: string[];
            } | undefined;
            const docId = result?.doc_id;
            f.status = "done";
            f.message = String(docId ?? "?");
            // Ce que l'import vient d'écrire, dit à chaque fois (IMPO-01). Les deux
            // comptes sont dans la réponse depuis toujours, mais n'étaient journalisés
            // que pour une extraction par colonne : un import ordinaire pouvait donc
            // annoncer « ✓ » en n'écrivant que des unités hors index. Mesuré de bout en
            // bout le 27 août sur un DOCX de prose ordinaire — statut `ok`,
            // `warnings: []`, 17 unités écrites, 0 indexée, 0 résultat à la recherche.
            const nLine = result?.units_line;
            const nStruct = result?.units_structure;
            f.importedLine = nLine ?? null;
            const compte = nLine === undefined
              ? ""
              : nLine === 0
                ? " · ⚠ AUCUNE unité indexable"
                : ` · ${nLine} unité(s) indexable(s)`
                  + ((nStruct ?? 0) > 0 ? `, ${nStruct} hors index` : "");
            // `fts_units` est une table FTS5 SANS trigger, peuplée explicitement par
            // l'indexeur (migration 002 : « contrôle explicite de ce qui est indexé »).
            // Un document fraîchement importé n'est donc JAMAIS trouvable à la
            // recherche avant une réindexation — et rien ne le disait, alors que le
            // même avertissement existe déjà après une curation (`CurationPane`).
            this._log(
              `✓ "${fileTitle}" → doc_id ${docId ?? "?"}${compte} · réindexez pour la recherche.`,
              nLine === 0,
            );
            // Surface table extraction stats when column_index was used.
            if ((result?.tables_processed ?? 0) > 0) {
              const t = result!.tables_processed;
              const u = result!.units_line ?? 0;
              const skipped = result!.rows_skipped_short ?? 0;
              const nested = result!.nested_tables_skipped ?? 0;
              const skipNote = skipped > 0 ? `, ${skipped} ligne(s) ignorée(s)` : "";
              const nestedNote = nested > 0 ? `, ${nested} sous-table(s) ignorée(s)` : "";
              this._log(
                `  ↳ ${t} table(s) traitée(s), ${u} unité(s) extraite(s)${skipNote}${nestedNote}`
              );
            }
            // Surface importer warnings (esp. column-index hints).
            for (const w of result?.warnings ?? []) {
              this._log(`  ⚠ ${w}`, true);
            }
            // La bulle disait « ✓ Importé » a l'identique qu'un document soit indexable ou
            // vide, le seul avertissement partant dans un tiroir ferme. Elle porte
            // desormais le compte, et passe en erreur quand il est nul.
            this._showToast?.(
              nLine === 0
                ? `⚠ Importé sans unité indexable : ${fileTitle}`
                : `✓ Importé: ${fileTitle}`
                  + (nLine === undefined ? "" : ` — ${nLine} indexable(s)`),
              nLine === 0,
            );
            // Sprint 8: propose family link (queued — one dialog at a time)
            if (typeof docId === "number" && !this._skipFamilyDialog) {
              // fileLang peut être undefined (TEI sans token → langue résolue côté
              // importeur depuis xml:lang) ; le dialog familles n'a qu'un indice.
              this._enqueueFamilyDialog(docId, fileTitle, fileLang ?? "und");
            }
          } else {
            f.status = "error";
            f.message = done.error ?? done.status;
            this._log(`✗ "${fileTitle}": ${f.message}`, true);
            this._showToast?.(`✗ Erreur: ${fileTitle}`, true);
          }
          this._renderList();
          if (finished === submitted) onAllDone();
        });
      } catch (err) {
        f.status = "error";
        f.message = err instanceof SidecarError ? err.message : String(err);
        this._log(`✗ "${f.title}": ${f.message}`, true);
        this._renderList();
        submitted++;
        finished++;
        if (finished === submitted) onAllDone();
      }
    }

    if (submitted === 0) {
      onAllDone();
    }
  }

  // ---------------------------------------------------------------------------
  // Sprint 8 — family dialog
  // ---------------------------------------------------------------------------

  private _enqueueFamilyDialog(docId: number, title: string, lang: string): void {
    this._familyDialogQueue.push({ docId, title, lang });
    if (!this._familyDialogActive) void this._drainFamilyDialogQueue();
  }

  private async _drainFamilyDialogQueue(): Promise<void> {
    while (this._familyDialogQueue.length > 0 && !this._skipFamilyDialog) {
      const next = this._familyDialogQueue.shift()!;
      this._familyDialogActive = true;
      await this._showFamilyDialog(next.docId, next.title, next.lang);
      this._familyDialogActive = false;
    }
    this._familyDialogActive = false;
  }

  /** Show a modal dialog after a successful import to optionally attach the
   *  new document to an existing family (creates a translation_of relation). */
  private async _showFamilyDialog(newDocId: number, newDocTitle: string, newDocLang: string): Promise<void> {
    if (!this._conn) return;

    // Refresh corpus docs list (lazy, refreshed each time dialog opens)
    try {
      this._corpusDocs = await listDocuments(this._conn);
    } catch {
      // ignore — list will be empty, dialog still shows
    }

    // Filter out the newly imported doc itself and sort by title
    const candidates = this._corpusDocs
      .filter(d => d.doc_id !== newDocId)
      .sort(compareDocsByTitle);

    const hasCandidates = candidates.length > 0;
    const candidateOptions = candidates.map(d => {
      const label = [d.title ?? `#${d.doc_id}`, d.language ? `[${d.language}]` : ""].filter(Boolean).join(" ");
      return `<option value="${d.doc_id}">${_escHtml(label)}</option>`;
    }).join("");
    const candidateCheckboxes = candidates.map(d => {
      const label = [d.title ?? `#${d.doc_id}`, d.language ? `[${d.language}]` : ""].filter(Boolean).join(" ");
      return `<label class="family-dialog-child-row">
        <input type="checkbox" class="family-dialog-child-cb" value="${d.doc_id}" />
        <span class="family-dialog-child-label">${_escHtml(label)}</span>
      </label>`;
    }).join("");

    const overlay = document.createElement("div");
    overlay.className = "family-dialog-overlay";
    setHtml(overlay, raw(`
      <div class="family-dialog">
        <div class="family-dialog-header">
          <span class="family-dialog-icon">🔗</span>
          <div>
            <div class="family-dialog-title">Rattacher à une famille ?</div>
            <div class="family-dialog-subtitle">« ${_escHtml(newDocTitle)} » vient d'être importé (doc #${newDocId})</div>
          </div>
        </div>
        <fieldset class="family-dialog-mode">
          <label class="family-dialog-mode-row">
            <input type="radio" name="fam-dlg-mode" value="child" checked />
            <span><strong>Ce document est issu d'un autre</strong> — c'est une traduction ou un extrait d'un document existant.</span>
          </label>
          <label class="family-dialog-mode-row" ${hasCandidates ? "" : 'data-disabled="1"'}>
            <input type="radio" name="fam-dlg-mode" value="parent" ${hasCandidates ? "" : "disabled"} />
            <span><strong>Ce document est l'original</strong> — d'autres documents existants en sont des traductions ou des extraits.</span>
          </label>
        </fieldset>
        <div class="family-dialog-field" data-fam-block="child">
          <label for="fam-dlg-parent-sel">Document original (parent)</label>
          <select id="fam-dlg-parent-sel" class="family-dialog-select">
            <option value="">— Aucun —</option>
            ${candidateOptions}
          </select>
        </div>
        <div class="family-dialog-field" data-fam-block="parent" style="display:none">
          <label>Documents enfants (cochez ceux à rattacher)</label>
          <div class="family-dialog-children-list">
            ${hasCandidates ? candidateCheckboxes : '<p class="family-dialog-empty">Aucun autre document dans le corpus.</p>'}
          </div>
        </div>
        <div class="family-dialog-field">
          <label for="fam-dlg-relation-type">Type de relation</label>
          <select id="fam-dlg-relation-type" class="family-dialog-select">
            <option value="translation_of">Traduction de</option>
            <option value="excerpt_of">Extrait de</option>
          </select>
        </div>
        <div class="family-dialog-actions">
          <label class="family-dialog-skip-label">
            <input type="checkbox" id="fam-dlg-skip-session" />
            Ne plus demander dans cette session
          </label>
          <div class="family-dialog-btns">
            <button id="fam-dlg-cancel-btn" class="btn btn-secondary btn-sm">Non merci</button>
            <button id="fam-dlg-confirm-btn" class="btn btn-primary btn-sm" disabled>Créer la relation</button>
          </div>
        </div>
      </div>
    `));

    document.body.appendChild(overlay);

    const sel = overlay.querySelector<HTMLSelectElement>("#fam-dlg-parent-sel")!;
    const relSel = overlay.querySelector<HTMLSelectElement>("#fam-dlg-relation-type")!;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>("#fam-dlg-confirm-btn")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>("#fam-dlg-cancel-btn")!;
    const skipChk = overlay.querySelector<HTMLInputElement>("#fam-dlg-skip-session")!;
    const childBlock = overlay.querySelector<HTMLElement>('[data-fam-block="child"]')!;
    const parentBlock = overlay.querySelector<HTMLElement>('[data-fam-block="parent"]')!;
    const childCbs = overlay.querySelectorAll<HTMLInputElement>(".family-dialog-child-cb");

    const currentMode = (): "child" | "parent" => {
      const checked = overlay.querySelector<HTMLInputElement>('input[name="fam-dlg-mode"]:checked');
      return (checked?.value === "parent") ? "parent" : "child";
    };
    const checkedChildIds = (): number[] =>
      Array.from(childCbs).filter(cb => cb.checked).map(cb => parseInt(cb.value, 10));
    const updateTypeLabels = () => {
      // "X est une traduction de Y" en child mode → singulier+de
      // "Y est l'original, X1/X2/... en sont des traductions" en parent mode → pluriel
      if (currentMode() === "child") {
        relSel.options[0].text = "Traduction de";
        relSel.options[1].text = "Extrait de";
      } else {
        relSel.options[0].text = "Traductions";
        relSel.options[1].text = "Extraits";
      }
    };
    const refreshConfirmState = () => {
      if (currentMode() === "child") {
        confirmBtn.disabled = !sel.value;
        confirmBtn.textContent = "Créer la relation";
      } else {
        const n = checkedChildIds().length;
        confirmBtn.disabled = n === 0;
        confirmBtn.textContent = n <= 1 ? "Créer la relation" : `Créer les ${n} relations`;
      }
    };

    overlay.querySelectorAll<HTMLInputElement>('input[name="fam-dlg-mode"]').forEach(radio => {
      radio.addEventListener("change", () => {
        const mode = currentMode();
        childBlock.style.display = mode === "child" ? "" : "none";
        parentBlock.style.display = mode === "parent" ? "" : "none";
        updateTypeLabels();
        refreshConfirmState();
      });
    });
    sel.addEventListener("change", refreshConfirmState);
    childCbs.forEach(cb => cb.addEventListener("change", refreshConfirmState));
    updateTypeLabels();
    refreshConfirmState();

    await new Promise<void>((resolve) => {
      const close = () => {
        if (skipChk.checked) this._skipFamilyDialog = true;
        overlay.remove();
        resolve();
      };

      cancelBtn.addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

      confirmBtn.addEventListener("click", async () => {
        const relType = relSel.value as "translation_of" | "excerpt_of";
        const FIXED_ROLES = ["original", "translation", "excerpt"];
        if (!this._conn) { close(); return; }
        const conn = this._conn;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "En cours…";

        try {
          if (currentMode() === "child") {
            // Mode actuel : new doc devient enfant d'un parent existant.
            const parentId = parseInt(sel.value, 10);
            if (!parentId) { close(); return; }
            const res = await setDocRelation(conn, {
              doc_id: newDocId,
              relation_type: relType,
              target_doc_id: parentId,
            });
            const parentDoc   = candidates.find(d => d.doc_id === parentId);
            const parentTitle = parentDoc?.title ?? `#${parentId}`;
            const childRole  = relType === "translation_of" ? "translation" : "excerpt";
            const newDoc = this._corpusDocs.find(d => d.doc_id === newDocId);
            if (!FIXED_ROLES.includes(newDoc?.doc_role ?? "")) {
              await updateDocument(conn, { doc_id: newDocId, doc_role: childRole }).catch(() => {});
            }
            if (parentDoc && !FIXED_ROLES.includes(parentDoc.doc_role ?? "")) {
              await updateDocument(conn, { doc_id: parentId, doc_role: "original" }).catch(() => {});
            }
            this._log(`✓ Relation « ${relType} » créée : doc #${newDocId} → doc #${parentId} « ${parentTitle} » (id=${res.id})`);
            this._showToast?.(`✓ Rattaché à la famille de « ${parentTitle} »`);
          } else {
            // Mode reverse : new doc devient parent de N documents existants.
            const childIds = checkedChildIds();
            if (childIds.length === 0) { close(); return; }
            const childRole = relType === "translation_of" ? "translation" : "excerpt";
            let okCount = 0;
            const errors: string[] = [];
            for (const childId of childIds) {
              try {
                await setDocRelation(conn, {
                  doc_id: childId,
                  relation_type: relType,
                  target_doc_id: newDocId,
                });
                okCount += 1;
                const childDoc = this._corpusDocs.find(d => d.doc_id === childId);
                if (childDoc && !FIXED_ROLES.includes(childDoc.doc_role ?? "")) {
                  await updateDocument(conn, { doc_id: childId, doc_role: childRole }).catch(() => {});
                }
              } catch (err) {
                errors.push(`#${childId} : ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            // New doc devient parent → original (sauf rôle déjà fixé)
            const newDoc = this._corpusDocs.find(d => d.doc_id === newDocId);
            if (!FIXED_ROLES.includes(newDoc?.doc_role ?? "")) {
              await updateDocument(conn, { doc_id: newDocId, doc_role: "original" }).catch(() => {});
            }
            if (errors.length === 0) {
              this._log(`✓ ${okCount} document(s) rattaché(s) à doc #${newDocId} « ${newDocTitle} » (${relType})`);
              this._showToast?.(`✓ ${okCount} document(s) rattaché(s) à « ${newDocTitle} »`);
            } else {
              this._log(`⚠ ${okCount}/${childIds.length} relations créées — erreurs : ${errors.join("; ")}`, true);
              this._showToast?.(`⚠ ${okCount}/${childIds.length} relations créées`, true);
            }
          }
        } catch (err) {
          this._log(`✗ Erreur création relation: ${err instanceof Error ? err.message : String(err)}`, true);
          this._showToast?.("✗ Impossible de créer la relation", true);
        }
        close();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Sprint 8 — filename language detection
  // ---------------------------------------------------------------------------
  // La détection de familles (radical + token de langue) vit désormais dans le module
  // pur partagé `lib/familyDetect.ts` (réutilisé par ShareDocs — Phase 6). Cf. DESIGN §12.

  /**
   * Render the family-proposal banner inside the screen root when groups are detected.
   *
   * **Idempotent** : le DOM n'est retouché que si les groupes ont changé. Sans cette
   * garde, brancher le bandeau sur `_renderList` le recréerait à chaque passage — donc
   * une fois par fichier pendant l'analyse, soit 33 fois sur la plus grosse rafale
   * réelle, avec le scintillement que ça suppose.
   */
  private _renderFamilyDetectionBanner(groups: FamilyGroup[]): void {
    const existing = this._root?.querySelector("#imp-family-detect-banner");
    const cle = groups.length === 0 ? "" : JSON.stringify(groups);
    if (existing && cle === this._familyBannerKey) return;
    this._familyBannerKey = cle;
    if (existing) existing.remove();
    if (groups.length === 0) return;

    const banner = document.createElement("div");
    banner.id = "imp-family-detect-banner";
    banner.className = "card prep-imp-family-banner";
    setHtml(banner, raw(buildFamilyDetectionBannerHtml(groups)));

    const workspace = this._root?.querySelector(".imp-workspace");
    if (workspace) workspace.insertAdjacentElement("beforebegin", banner);
  }

  /** Run detection on current file list and update the banner. */
  private _detectAndShowFamilyBanner(): void {
    const paths = this._files
      .filter(f => f.status === "pending")
      .map(f => f.path);
    const groups = detectFamilyGroups(paths);
    this._renderFamilyDetectionBanner(groups);
  }

  private _setRuntimeState(kind: "ok" | "info" | "warn" | "error", text: string): void {
    if (!this._stateEl) return;
    this._stateEl.className = `prep-runtime-state prep-state-${kind}`;
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez ou créez un corpus.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Opération en cours…");
      return;
    }
    if (this._lastErrorMsg) {
      this._setRuntimeState("error", `Dernière erreur: ${this._lastErrorMsg}`);
      return;
    }
    const pendingCount = this._files.filter((f) => f.status === "pending").length;
    if (pendingCount > 0) {
      this._setRuntimeState("warn", `${pendingCount} fichier(s) en attente d'import.`);
      return;
    }
    if (this._files.length === 0) {
      this._setRuntimeState("info", "Aucun fichier sélectionné.");
      return;
    }
    this._setRuntimeState("ok", "Prêt: vous pouvez lancer un import ou reconstruire l'index.");
  }

  dispose(): void {
    this._conn = null;
    this._jobCenter = null;
    this._showToast = null;
    this._files = [];
    this._corpusDocs = [];
  }
}

// Re-export type for inline use
type ImportOptions = Parameters<typeof importFile>[1];

