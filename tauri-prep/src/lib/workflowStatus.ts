/**
 * workflowStatus.ts - workflow-status vocabulary + pure helpers, extracted from
 * MetadataScreen (U-02). normalizeWorkflowStatus folds both the stored
 * doc.workflow_status and the edit-form value to a known status (the host's
 * _workflowStatus and _workflowStatusFromForm now share it). Labels moved
 * byte-identical (FR accents).
 */

export const WORKFLOW_STATUS = ["draft", "review", "validated"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];

/** Fold an arbitrary stored/form value to a known status (unknown/missing -> draft). */
export function normalizeWorkflowStatus(raw: string | null | undefined): WorkflowStatus {
  if (raw === "review" || raw === "validated") return raw;
  return "draft";
}

export function workflowLabel(status: WorkflowStatus): string {
    if (status === "review") return "À revoir";
    if (status === "validated") return "Validé";
    return "Brouillon";
}
