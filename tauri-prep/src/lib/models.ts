/**
 * models.ts — pure helpers for spaCy model management, shared by the AnnotationView
 * in-context download band (Phase 4) and the future Paramètres screen (Phase 3).
 *
 * No tauri imports → unit-testable in the default node env.
 */

export interface ModelInfo {
  name: string;
  language: string; // ISO base code, or "mul" for the multilingual model
  approx_size_mb: number;
  installed: boolean;
  version: string | null;
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
