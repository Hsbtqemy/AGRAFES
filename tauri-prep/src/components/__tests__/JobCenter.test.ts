// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/sidecarClient.ts", () => ({
  getJob: vi.fn(),
  cancelJob: vi.fn(),
}));

import { getJob } from "../../lib/sidecarClient.ts";
import type { Conn, JobRecord } from "../../lib/sidecarClient.ts";
import { JobCenter } from "../JobCenter.ts";

const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  job_id: "j1",
  kind: "webdav-probe",
  status: "done",
  progress_pct: 100,
  progress_message: "Probe completed",
  created_at: "2026-08-28T00:00:00Z",
  ...over,
});

/** `trackJob` enchaîne sur une promesse résolue : un tour de boucle suffit. */
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.mocked(getJob).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobCenter — le bandeau doit être réellement visible", () => {
  it("montre le bandeau avec une valeur de display explicite, pas une chaîne vide", async () => {
    vi.mocked(getJob).mockResolvedValue(job());
    const jc = new JobCenter();
    const el = jc.render();
    expect(el.style.display).toBe("none"); // rien à montrer au départ

    jc.setConn({} as Conn);
    jc.trackJob("j1", "Sonde — corpus", () => {});
    await tick();

    expect(el.textContent).toContain("Terminés");
    expect(el.textContent).toContain("webdav-probe");
    // Le cœur du test. `style.display = ""` supprimerait la déclaration inline et
    // rendrait la main à `.job-center { display: none }` (job-center.css:1) : le
    // bandeau serait peint — le texte ci-dessus passerait — mais resterait invisible.
    // C'est le défaut qui l'a caché depuis son origine ; n'assertons donc pas seulement
    // son contenu.
    expect(el.style.display).toBe("block");
  });

  it("reste caché tant qu'aucun job n'a été suivi", () => {
    const el = new JobCenter().render();
    expect(el.style.display).toBe("none");
    expect(el.textContent).toBe("");
  });

  it("rend la main au job terminé sans jamais le perdre du bandeau", async () => {
    vi.mocked(getJob).mockResolvedValue(job({ status: "error", progress_message: "boom" }));
    const jc = new JobCenter();
    const el = jc.render();
    jc.setConn({} as Conn);
    const vus: JobRecord[] = [];
    jc.trackJob("j1", "Sonde — corpus", (j) => vus.push(j));
    await tick();

    expect(vus.map((j) => j.status)).toEqual(["error"]);
    expect(el.style.display).toBe("block");
    expect(el.textContent).toContain("boom");
  });
});

describe("JobCenter — les jobs terminés ne squattent pas l'écran", () => {
  it("nomme chaque job terminé, au lieu de répéter son type", async () => {
    vi.mocked(getJob).mockResolvedValue(job());
    const jc = new JobCenter();
    const el = jc.render();
    jc.setConn({} as Conn);
    jc.trackJob("j1", "Sonde — Bitextes anglais-espagnol", () => {});
    await tick();

    // Sans le libellé, deux sondes de dossiers différents rendaient deux lignes
    // strictement identiques : « webdav-probe · Probe completed ».
    expect(el.textContent).toContain("Sonde — Bitextes anglais-espagnol");
  });

  it("n'en garde que trois, et dit le compte réel plutôt qu'un 5 écrit en dur", async () => {
    vi.mocked(getJob).mockResolvedValue(job());
    const jc = new JobCenter();
    const el = jc.render();
    jc.setConn({} as Conn);
    for (const nom of ["A", "B", "C", "D"]) {
      jc.trackJob("j1", `Sonde — ${nom}`, () => {});
      await tick();
    }

    expect(el.textContent).toContain("Terminés (3)");
    expect(el.textContent).toContain("Sonde — D");
    expect(el.textContent).not.toContain("Sonde — A"); // le plus ancien est tombé
  });

  it("se retire tout seul quand plus rien ne tourne", async () => {
    vi.useFakeTimers();
    vi.mocked(getJob).mockResolvedValue(job());
    const jc = new JobCenter();
    const el = jc.render();
    jc.setConn({} as Conn);
    jc.trackJob("j1", "Sonde — corpus", () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(el.style.display).toBe("block");

    await vi.advanceTimersByTimeAsync(8000);
    // Le bandeau annonce ce qui tourne : une fois le dernier job fini, ses lignes ne
    // doivent pas rester au sommet de tous les écrans pour le reste de la session.
    expect(el.style.display).toBe("none");
  });

  it("oublie tout à la déconnexion", async () => {
    vi.mocked(getJob).mockResolvedValue(job());
    const jc = new JobCenter();
    const el = jc.render();
    jc.setConn({} as Conn);
    jc.trackJob("j1", "Sonde — corpus", () => {});
    await tick();
    expect(el.style.display).toBe("block");

    jc.setConn(null);
    // Les jobs d'une base ne doivent rien dire de la suivante.
    expect(el.style.display).toBe("none");
  });
});

describe("JobCenter — un job terminé ne doit être rendu qu'une fois", () => {
  it("ne rappelle pas onDone quand deux passes de sondage se chevauchent", async () => {
    vi.useFakeTimers();
    // 1er appel (trackJob) : le job tourne encore → il entre dans _active.
    vi.mocked(getJob).mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r(job({ status: "running" })), 0)),
    );
    // Sondages suivants : LENTS (800 ms) et terminaux. Le tick de 500 ms relance donc
    // _poll pendant que la passe précédente attend encore sa réponse.
    vi.mocked(getJob).mockImplementation(
      () => new Promise((r) => setTimeout(() => r(job()), 800)),
    );

    const jc = new JobCenter();
    jc.render();
    jc.setConn({} as Conn);
    let rendus = 0;
    jc.trackJob("j1", "Sonde — corpus", () => { rendus += 1; });

    await vi.advanceTimersByTimeAsync(3000);
    expect(rendus).toBe(1);
  });
});
