import { describe, it, expect } from "vitest";

import { isCloudSyncedPath } from "../cloudSync.ts";

describe("isCloudSyncedPath", () => {
  it("detects OneDrive (the R-01 incident path)", () => {
    const r = isCloudSyncedPath("C:\\Users\\hugo\\OneDrive\\Documents\\TestJeanne.db");
    expect(r).toEqual({ synced: true, provider: "OneDrive" });
  });

  it("detects OneDrive business/personal variants", () => {
    expect(isCloudSyncedPath("C:\\Users\\h\\OneDrive - ACME\\corpus.db").synced).toBe(true);
    expect(isCloudSyncedPath("/Users/h/Library/CloudStorage/OneDrive-Personal/c.db").provider).toBe("OneDrive");
  });

  it("detects Dropbox, Google Drive, iCloud", () => {
    expect(isCloudSyncedPath("/Users/h/Dropbox/corpus.db").provider).toBe("Dropbox");
    expect(isCloudSyncedPath("C:\\Users\\h\\Google Drive\\c.db").provider).toBe("Google Drive");
    expect(isCloudSyncedPath("/Users/h/GoogleDrive/c.db").provider).toBe("Google Drive");
    expect(
      isCloudSyncedPath("/Users/h/Library/Mobile Documents/com~apple~CloudDocs/c.db").provider,
    ).toBe("iCloud Drive");
  });

  it("detects the generic macOS CloudStorage location", () => {
    expect(isCloudSyncedPath("/Users/h/Library/CloudStorage/Dropbox-Work/c.db").synced).toBe(true);
  });

  it("treats plain local paths as not synced", () => {
    expect(isCloudSyncedPath("C:\\Users\\hugo\\Desktop\\corpus.db")).toEqual({ synced: false, provider: null });
    expect(isCloudSyncedPath("/home/hugo/corpus/data.db").synced).toBe(false);
  });

  it("does not false-positive on look-alike folder names", () => {
    // "OneDrive" must be a whole path segment, not a substring of another folder name.
    expect(isCloudSyncedPath("C:\\Users\\h\\MyOneDriveBackup\\c.db").synced).toBe(false);
    expect(isCloudSyncedPath("/home/h/Dropboxes/c.db").synced).toBe(false);
  });

  it("handles empty / null / undefined", () => {
    expect(isCloudSyncedPath("").synced).toBe(false);
    expect(isCloudSyncedPath(null).synced).toBe(false);
    expect(isCloudSyncedPath(undefined).synced).toBe(false);
  });
});
