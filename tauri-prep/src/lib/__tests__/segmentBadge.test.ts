/**
 * Le badge `[§N]` nomme le segment comme la matrice le nomme (ALI-24, contrat 1.6.76).
 *
 * Il affichait `alignment_links.external_id`, qui n'est pas un numéro de segment mais la
 * clé qui a apparié — le marqueur `[N]` du pivot ou sa position `n` selon la stratégie,
 * et un même run mélange les deux. Le moteur calcule désormais le vrai rang et le rend
 * dans `pivot_segment` ; ce module est le seul endroit du front qui choisit.
 *
 * Ce qui se joue ici est la règle de repli, et elle a **trois** cas, pas deux : le champ
 * ABSENT (sidecar antérieur — on n'a que l'ancien champ, et un numéro parfois faux vaut
 * mieux qu'une liste sans numéros) n'est pas le champ à `null` (le moteur dit « ce pivot
 * n'a pas de rang » — retomber sur l'ancien champ afficherait un numéro qu'on SAIT faux).
 * Un `??` les confondrait ; c'est la raison d'être de ce fichier.
 */
import { describe, it, expect } from "vitest";
import { segmentOf, segmentBadge } from "../segmentBadge.ts";

describe("segmentOf — quel numéro le Contrôle affiche", () => {
  it("préfère le rang calculé par le moteur à la clé d'appariement", () => {
    // Le cas mesuré : un document à unités de structure décale `n` du rang, et le
    // Contrôle affichait 4 là où la matrice affiche 3.
    expect(segmentOf({ pivot_segment: 3, external_id: 4 })).toBe(3);
  });

  it("préfère le rang même quand la clé vaut le marqueur du pivot", () => {
    // Cas d'un lien créé au geste avant 1.6.76 : il portait le marqueur, pas la position.
    expect(segmentOf({ pivot_segment: 2, external_id: 5 })).toBe(2);
  });

  it("retombe sur la clé quand le sidecar est trop ancien pour envoyer le rang", () => {
    // Champ ABSENT : le sidecar ne connaît pas 1.6.76. On affiche ce qu'on a.
    expect(segmentOf({ external_id: 7 })).toBe(7);
  });

  it("n'affiche RIEN quand le moteur dit que le pivot n'a pas de rang", () => {
    // Champ présent à `null` : le pivot n'est pas une ligne. Retomber sur `external_id`
    // afficherait un numéro que le moteur vient précisément de refuser de donner.
    expect(segmentOf({ pivot_segment: null, external_id: 7 })).toBeNull();
  });

  it("n'invente pas de numéro quand il n'y en a aucun", () => {
    expect(segmentOf({})).toBeNull();
    expect(segmentOf({ external_id: null })).toBeNull();
  });

  it("garde le rang 0 (fausse valeur, vrai numéro) — un `||` l'aurait perdu", () => {
    expect(segmentOf({ pivot_segment: 0, external_id: 9 })).toBe(0);
  });
});

describe("segmentBadge — le fragment rendu", () => {
  it("rend le badge quand il y a un numéro", () => {
    expect(segmentBadge({ pivot_segment: 12 })).toBe("[§12]");
  });

  it("rend une cellule VIDE plutôt qu'un `[§null]`", () => {
    // La liste de curation composait `[§${String(p.external_id)}]` sans repli : sur un
    // corpus sans marqueurs elle affichait littéralement « [§null] ».
    expect(segmentBadge({ pivot_segment: null })).toBe("");
    expect(segmentBadge({})).toBe("");
  });

  it("ne laisse pas passer de chaîne dans le HTML", () => {
    // Le numéro vient du serveur ; `Number` garantit qu'aucun texte ne s'y glisse, et
    // l'appelant insère ce fragment sans échappement.
    const injecte = { pivot_segment: "3<script>" as unknown as number };
    expect(segmentBadge(injecte)).toBe("[§NaN]");
    expect(segmentBadge(injecte)).not.toContain("<");
  });
});
