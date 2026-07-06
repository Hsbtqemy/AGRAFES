/**
 * lib/metaTemplates.ts — R6.3 document-type metadata templates (pure, testable).
 *
 * `resource_type` drives an optional set of *suggested* bibliographic fields. It is a
 * datalist (suggestions + free typing preserved), not a closed enum. Field values are
 * stored server-side in `documents.meta_json.fields`; ad-hoc keys outside any template
 * are supported too (the "hybrid" model). This module holds no DOM logic.
 */

export interface TemplateField {
  /** meta_json.fields key — stable, ASCII, no spaces. */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Optional input placeholder / example. */
  placeholder?: string;
}

/** Suggested resource_type values (datalist). Free typing is still allowed. */
export const RESOURCE_TYPE_SUGGESTIONS: readonly string[] = [
  "roman",
  "nouvelle",
  "article de presse",
  "essai",
  "poésie",
  "théâtre",
  "discours",
  "correspondance",
  "autre",
];

/** Per-type suggested field templates. Keys are normalised (trim + lowercase). */
export const TYPE_TEMPLATES: Readonly<Record<string, readonly TemplateField[]>> = {
  "roman": [
    { key: "collection", label: "Collection", placeholder: "Folio" },
    { key: "year_first_pub", label: "Année 1ʳᵉ publication", placeholder: "1862" },
    { key: "isbn", label: "ISBN", placeholder: "978-2-…" },
  ],
  "nouvelle": [
    { key: "recueil", label: "Recueil", placeholder: "Titre du recueil" },
    { key: "collection", label: "Collection" },
  ],
  "article de presse": [
    { key: "press_title", label: "Titre de presse", placeholder: "Le Monde" },
    { key: "section", label: "Rubrique", placeholder: "Culture" },
    { key: "url", label: "URL", placeholder: "https://…" },
    { key: "accessed", label: "Consulté le", placeholder: "2024-03-15" },
  ],
  "essai": [
    { key: "field", label: "Domaine", placeholder: "philosophie" },
    { key: "collection", label: "Collection" },
  ],
  "poésie": [
    { key: "recueil", label: "Recueil", placeholder: "Les Fleurs du mal" },
    { key: "form", label: "Forme", placeholder: "sonnet, vers libre…" },
  ],
  "théâtre": [
    { key: "genre_dram", label: "Genre", placeholder: "tragédie, comédie…" },
    { key: "acts", label: "Nombre d'actes", placeholder: "5" },
  ],
  "discours": [
    { key: "occasion", label: "Occasion", placeholder: "discours d'investiture" },
    { key: "venue", label: "Lieu", placeholder: "Assemblée nationale" },
  ],
  "correspondance": [
    { key: "recipient", label: "Destinataire", placeholder: "à George Sand" },
    { key: "sent_from", label: "Lieu d'envoi", placeholder: "Guernesey" },
  ],
};

/** Normalise a typed resource_type to a template key (trim + lowercase). */
export function normalizeType(resourceType: string | null | undefined): string {
  return (resourceType ?? "").trim().toLowerCase();
}

/** Suggested fields for a resource_type. Empty when the type has no template. */
export function templateForType(resourceType: string | null | undefined): readonly TemplateField[] {
  return TYPE_TEMPLATES[normalizeType(resourceType)] ?? [];
}

/** Read `documents.meta_json` → its user `fields` sub-object as a flat string map. */
export function fieldsOf(metaJson: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!metaJson || typeof metaJson !== "object") return {};
  return toStringMap((metaJson as Record<string, unknown>)["fields"]);
}

export interface PartitionedFields {
  /** Template field → current value ("" when unset), in template order. */
  templateValues: Array<{ field: TemplateField; value: string }>;
  /** Ad-hoc key→value pairs not covered by the template (insertion order). */
  extras: Array<{ key: string; value: string }>;
}

/**
 * Split a stored `fields` map into template-known values (in template order) and ad-hoc
 * extras (any key not in the template), for the hybrid editor.
 */
export function partitionFields(
  fields: Record<string, string> | null | undefined,
  template: readonly TemplateField[],
): PartitionedFields {
  const flat = toStringMap(fields);
  const templateKeys = new Set(template.map((f) => f.key));
  const templateValues = template.map((field) => ({ field, value: flat[field.key] ?? "" }));
  const extras = Object.entries(flat)
    .filter(([k]) => !templateKeys.has(k))
    .map(([key, value]) => ({ key, value }));
  return { templateValues, extras };
}

/** Coerce an unknown value into a flat string→string map (scalars only; skips nested/nullish). */
function toStringMap(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue; // only scalar fields
    out[k] = String(v);
  }
  return out;
}
