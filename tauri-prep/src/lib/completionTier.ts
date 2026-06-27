/**
 * completionTier.ts — map a completion percentage to a tier class, deduped from
 * familyView / MetadataScreen (U-02). Pure.
 */

export function completionTier(pct: number): string {
  if (pct === 0)   return "none";
  if (pct < 40)    return "low";
  if (pct < 80)    return "mid";
  if (pct < 100)   return "high";
  return "done";
}
