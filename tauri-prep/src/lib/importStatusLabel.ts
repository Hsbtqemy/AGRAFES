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
}

export function importStatusLabel(f: StatusLabelInput): string {
    if (f.status === "pending") return "En attente";
    if (f.status === "importing") return "Importation…";
    if (f.status === "done") return `✓ doc_id=${_escHtml(String(f.message ?? ""))}`;
    if (f.status === "error") return `✗ ${_escHtml(String(f.message ?? ""))}`;
    return "";
  }
