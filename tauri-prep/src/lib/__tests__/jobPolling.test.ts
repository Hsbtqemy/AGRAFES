import { describe, it, expect } from "vitest";
import { runJobWithPolling } from "../jobPolling.ts";
import type { Conn, JobRecord } from "../sidecarClient.ts";

function makeJob(status: string, over: Partial<JobRecord> = {}): JobRecord {
  return { job_id: "j1", kind: "annotate", status, progress_pct: 0, created_at: "", ...over } as JobRecord;
}

const conn = {} as Conn;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runJobWithPolling", () => {
  it("reports progress then fires onDone", async () => {
    const seq = [makeJob("running", { progress_message: "50%" }), makeJob("done")];
    let i = 0;
    const events: string[] = [];
    runJobWithPolling(conn, {
      enqueue: async () => "j1",
      onProgress: (m) => { events.push(`progress:${m}`); },
      onDone: () => { events.push("done"); },
      onError: (m) => { events.push(`error:${m}`); },
      intervalMs: 5,
      getJobFn: async () => seq[Math.min(i++, seq.length - 1)],
    });
    await wait(40);
    expect(events).toContain("progress:50%");
    expect(events).toContain("done");
    expect(events.some((e) => e.startsWith("error"))).toBe(false);
  });

  it("fires onError on a terminal error job", async () => {
    const events: string[] = [];
    runJobWithPolling(conn, {
      enqueue: async () => "j1",
      onDone: () => { events.push("done"); },
      onError: (m) => { events.push(`error:${m}`); },
      intervalMs: 5,
      getJobFn: async () => makeJob("error", { error: "boom" }),
    });
    await wait(30);
    expect(events).toEqual(["error:boom"]);
  });

  it("fires onError when enqueue throws", async () => {
    const events: string[] = [];
    runJobWithPolling(conn, {
      enqueue: async () => { throw new Error("nope"); },
      onDone: () => { events.push("done"); },
      onError: (m) => { events.push(`error:${m}`); },
      intervalMs: 5,
      getJobFn: async () => makeJob("done"),
    });
    await wait(30);
    expect(events).toEqual(["error:nope"]);
  });

  it("fires onError when enqueue yields no job id", async () => {
    const events: string[] = [];
    runJobWithPolling(conn, {
      enqueue: async () => "",
      onDone: () => { events.push("done"); },
      onError: (m) => { events.push(`error:${m}`); },
      intervalMs: 5,
      getJobFn: async () => makeJob("done"),
    });
    await wait(30);
    expect(events.length).toBe(1);
    expect(events[0]).toContain("job_id");
  });

  it("cancel() suppresses further callbacks", async () => {
    const events: string[] = [];
    const handle = runJobWithPolling(conn, {
      enqueue: async () => "j1",
      onDone: () => { events.push("done"); },
      onError: (m) => { events.push(`error:${m}`); },
      intervalMs: 5,
      getJobFn: async () => makeJob("done"),
    });
    handle.cancel(); // before enqueue resolves → no setInterval, no ticks
    await wait(30);
    expect(events).toEqual([]);
  });

  it("swallows a throwing onDone (no unhandled rejection)", async () => {
    let onErrorCalled = false;
    runJobWithPolling(conn, {
      enqueue: async () => "j1",
      onDone: () => { throw new Error("done handler boom"); },
      onError: () => { onErrorCalled = true; },
      intervalMs: 5,
      getJobFn: async () => makeJob("done"),
    });
    await wait(30);
    // The throw is swallowed (no unhandled rejection fails the test); a done job never
    // routes to onError.
    expect(onErrorCalled).toBe(false);
  });
});
