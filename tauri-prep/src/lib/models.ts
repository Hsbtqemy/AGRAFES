/**
 * models.ts — pure helpers for spaCy model management, shared by the AnnotationView
 * in-context download band (Phase 4) and the future Paramètres screen (Phase 3).
 *
 * No tauri imports → unit-testable in the default node env.
 */

/**
 * Availability of a model, mirroring the engine's tri-state:
 *  - "downloaded" — present in the user models dir (removable; version known);
 *  - "bundled"    — embedded in a frozen sidecar, loadable by name (read-only);
 *  - "absent"     — neither, offered for download.
 */
export type ModelSource = "bundled" | "downloaded" | "absent";

export interface ModelInfo {
  name: string;
  language: string; // ISO base code, or "mul" for the multilingual model
  approx_size_mb: number;
  installed: boolean; // == downloaded to the user dir; prefer `source` for UI decisions
  source: ModelSource;
  version: string | null;
}

/** A model is usable for annotation as soon as it is bundled or downloaded. */
export function isModelAvailable(m: ModelInfo): boolean {
  return m.source !== "absent";
}

/**
 * Mirror of the engine's `_model_for_language`: pick the model whose language matches
 * the document's base language code (region tags like "fr-FR" / "en_US" reduce to
 * "fr" / "en"); fall back to the multilingual ("mul") model. Returns null if neither
 * a language match nor a multilingual model is present.
 */
export function modelForLanguage(
  language: string | null | undefined,
  models: ModelInfo[],
): ModelInfo | null {
  const base = (language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (base) {
    const exact = models.find((m) => m.language === base);
    if (exact) return exact;
  }
  return models.find((m) => m.language === "mul") ?? null;
}

export interface ModelRow {
  name: string;
  sizeLabel: string;
  statusLabel: string;
  source: ModelSource;
  installed: boolean;
}

/** Display fields for one model row (ModelManager / Paramètres). Pure → unit-tested. */
export function describeModel(m: ModelInfo): ModelRow {
  let statusLabel: string;
  if (m.source === "bundled") {
    statusLabel = "Intégré";
  } else if (m.source === "downloaded") {
    statusLabel = m.version ? `Installé · ${m.version}` : "Installé";
  } else {
    statusLabel = "Absent";
  }
  return {
    name: m.name,
    sizeLabel: `~${m.approx_size_mb} Mo`,
    statusLabel,
    source: m.source,
    installed: m.installed,
  };
}
