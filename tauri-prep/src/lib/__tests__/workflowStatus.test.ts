import { describe, it, expect } from "vitest";
import { WORKFLOW_STATUS, normalizeWorkflowStatus, workflowLabel } from "../workflowStatus.ts";

describe("normalizeWorkflowStatus", () => {
  it("keeps the two non-draft known statuses", () => {
    expect(normalizeWorkflowStatus("review")).toBe("review");
    expect(normalizeWorkflowStatus("validated")).toBe("validated");
  });

  it("returns draft for draft and for any unknown/missing value", () => {
    expect(normalizeWorkflowStatus("draft")).toBe("draft");
    expect(normalizeWorkflowStatus("")).toBe("draft");
    expect(normalizeWorkflowStatus("archived")).toBe("draft");
    expect(normalizeWorkflowStatus(null)).toBe("draft");
    expect(normalizeWorkflowStatus(undefined)).toBe("draft");
  });
});

describe("workflowLabel", () => {
  it("maps each status to its French label", () => {
    expect(workflowLabel("draft")).toBe("Brouillon");
    expect(workflowLabel("review")).toBe("À revoir");
    expect(workflowLabel("validated")).toBe("Validé");
  });
});

describe("WORKFLOW_STATUS", () => {
  it("lists the three statuses in UI order", () => {
    expect(WORKFLOW_STATUS).toEqual(["draft", "review", "validated"]);
  });

  it("has a non-empty label for every status", () => {
    for (const s of WORKFLOW_STATUS) expect(workflowLabel(s).length).toBeGreaterThan(0);
  });
});
