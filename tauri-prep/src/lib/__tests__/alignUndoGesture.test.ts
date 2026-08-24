import { describe, expect, it } from "vitest";

import {
  armFromBatch,
  describeUndoFailure,
  describeUndoOutcome,
  shouldDisarmAfterFailure,
} from "../alignUndoGesture.ts";
import type { AlignBatchUndoResponse } from "../sidecarClient.ts";

const rapport = (o: Partial<AlignBatchUndoResponse>): AlignBatchUndoResponse => ({
  ok: true, op_id: 1, description: "coupe — 2 liens",
  updated: 0, reinserted: 0, deleted: 0, skipped: 0, ...o,
});

describe("armFromBatch — on ne s'arme que sur une poignée réelle", () => {
  it("s'arme quand le moteur rend un op_id", () => {
    const g = armFromBatch({ op_id: 42 }, "⭙ Détacher", 7);
    expect(g).toEqual({ opId: 42, label: "⭙ Détacher", familyId: 7 });
  });

  it("ne s'arme pas sur un sidecar antérieur à 1.6.70", () => {
    // Le champ est absent, pas null : un vieux sidecar ne connaît pas D-3. Le bandeau
    // doit simplement ne pas apparaître, sans erreur ni message.
    expect(armFromBatch({}, "⭙ Détacher", 7)).toBeNull();
  });

  it("ne s'arme pas quand le moteur dit qu'il n'y a rien à annuler", () => {
    expect(armFromBatch({ op_id: null }, "⭙ Détacher", 7)).toBeNull();
  });

  it("ne s'arme pas sur un lot rollbacké", () => {
    // atomic + erreur : rien n'a été appliqué. Un « Annuler » serait un mensonge.
    expect(armFromBatch({ op_id: 42, rolled_back: true }, "✂ Couper", 7)).toBeNull();
  });
});

describe("describeUndoOutcome — les trois compteurs ne sont pas interchangeables", () => {
  it("dit qu'un lien détruit est rétabli", () => {
    expect(describeUndoOutcome(rapport({ description: "suppression — 1 lien", reinserted: 1 })))
      .toBe("↶ suppression — 1 lien annulé : 1 lien rétabli");
  });

  it("dit qu'un lien créé est retiré", () => {
    // La moitié « création » d'un geste multi-requêtes : la défaire, c'est supprimer.
    expect(describeUndoOutcome(rapport({ description: "＝ Rattacher", deleted: 1 })))
      .toBe("↶ ＝ Rattacher annulé : 1 lien retiré");
  });

  it("compose les deux moitiés d'un geste multi-requêtes", () => {
    const txt = describeUndoOutcome(rapport({ description: "＝ Rattacher", reinserted: 1, deleted: 1 }));
    expect(txt).toContain("1 lien rétabli");
    expect(txt).toContain("1 lien retiré");
  });

  it("dit une annulation partielle plutôt que de la taire", () => {
    // Le cas où se taire ferait croire à un retour complet.
    const txt = describeUndoOutcome(rapport({ reinserted: 1, skipped: 2 }));
    expect(txt).toContain("2 liens n'ont pas pu revenir");
    expect(txt).toContain("paire reprise par un lien plus jeune");
  });

  it("ne prétend rien quand rien n'est revenu", () => {
    expect(describeUndoOutcome(rapport({ skipped: 1 }))).toContain("rien à rétablir");
  });

  it("accorde le pluriel", () => {
    expect(describeUndoOutcome(rapport({ reinserted: 3 }))).toContain("3 liens rétablis");
    expect(describeUndoOutcome(rapport({ updated: 1 }))).toContain("1 lien restauré");
  });
});

describe("describeUndoFailure — on garde le mot du moteur", () => {
  it("reprend le message tel quel", () => {
    const m = "2 gestes plus récents portent sur ces mêmes liens : les annuler d'abord";
    expect(describeUndoFailure(m, 409)).toContain(m);
  });

  it("n'annonce le retrait du bandeau que quand il a lieu", () => {
    // Sur 404 le bandeau part ; le dire évite de chercher un bouton qui ne revient pas.
    expect(describeUndoFailure("déjà annulée", 404)).toContain("Le bandeau se retire");
    expect(describeUndoFailure("réseau", 500)).not.toContain("Le bandeau se retire");
  });
});

describe("shouldDisarmAfterFailure", () => {
  it("désarme sur 404 et 409, garde la main sur le reste", () => {
    // 409 : la poignée est devenue inatteignable, la garder afficherait un bouton qui
    // échouera à chaque clic. 500 / réseau : le geste est toujours là, on réessaie.
    expect(shouldDisarmAfterFailure(404)).toBe(true);
    expect(shouldDisarmAfterFailure(409)).toBe(true);
    expect(shouldDisarmAfterFailure(500)).toBe(false);
    expect(shouldDisarmAfterFailure(undefined)).toBe(false);
  });
});
