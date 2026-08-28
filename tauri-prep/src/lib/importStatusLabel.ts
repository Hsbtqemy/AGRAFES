/**
 * importStatusLabel.ts - pure status -> human label mapping for an import file
 * row, extracted verbatim from ImportScreen._statusLabel (U-02).
 *
 * NOTE (behavior preserved verbatim): for the `done`/`error` cases the message
 * is HTML-escaped HERE, and the single call site (ImportScreen file-row render)
 * ALSO wraps the whole result in escHtml -> messages are double-escaped. That is
 * a pre-existing latent quirk; it is intentionally NOT fixed here (would change
 * behavior). The `?? ""` guard is likewise kept though `message` is typed string.
 */
import { escHtml as _escHtml } from "./diff.ts";

export interface StatusLabelInput {
  status: "pending" | "importing" | "done" | "error";
  message: string;
  /**
   * Unites indexables (`units_line`) que l'import a ecrites, quand il a abouti.
   *
   * `0` doit se voir SUR LA LIGNE. Le journal le disait deja, mais il vit dans le
   * tiroir `.prep-journal-drawer`, ferme par defaut : a l'ecran, un document sans une
   * seule unite indexable etait rigoureusement indiscernable d'un document normal.
   * Mesure le 28 aout sur `testparagraphesAgrafes.docx`, dont les deux modes rendent
   * 17 unites — 17 `line` en Paragraphes, 17 `structure` en numerote.
   */
  importedLine?: number | null;
}

export function importStatusLabel(f: StatusLabelInput): string {
    if (f.status === "pending") return "En attente";
    if (f.status === "importing") return "Importation…";
    if (f.status === "done") {
      const vide = f.importedLine === 0;
      const id = _escHtml(String(f.message ?? ""));
      return vide
        ? `⚠ doc_id=${id} · rien d’indexable`
        : `✓ doc_id=${id}`;
    }
    if (f.status === "error") return `✗ ${_escHtml(String(f.message ?? ""))}`;
    return "";
  }
