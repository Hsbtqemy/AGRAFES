/**
 * La recherche grammaticale : ce que les boîtes rapides envoient au moteur.
 *
 * Trouvé en QA le 2026-08-21. Les prédicats CQL sont des expressions régulières côté
 * moteur, et les boîtes « mot » / « lemme » y injectaient la saisie telle quelle :
 *
 *   saisie « trois) »  →  [word="trois)" %c]
 *                      →  Invalid regex in predicate 'word="trois)" %c':
 *                         unbalanced parenthesis at position 7
 *
 * Un CQL que l'utilisateur n'a jamais écrit, et une position dans une chaîne qu'il n'a
 * jamais vue. Mesuré sur des saisies plausibles, cinq tombaient — `trois)`, `(`, `?`,
 * `[`, `*` — tandis que `chat|chien` faisait une alternance que personne n'avait
 * annoncée.
 *
 * L'écran ne promet qu'une chose : « Tapez un mot ou un préfixe (wildcard `.*`) ». La
 * saisie est donc rendue littérale, ce seul construit excepté. Le mode CQL reste la
 * surface des expressions régulières complètes — et c'est pour lui que le message
 * d'erreur devient lisible plutôt que rattrapé : l'utilisateur y a VOULU écrire une
 * regex.
 */
import { describe, expect, it } from "vitest";

import { _litteralSaufWildcard, _messageLisible, _porteeAnnotee } from "../rechercheModule";

/** Ce que le moteur compilera après le passage par la chaîne CQL. */
function commeLeMoteur(saisie: string): RegExp {
  return new RegExp(_litteralSaufWildcard(saisie));
}

describe("boîtes rapides — la saisie est littérale", () => {
  it.each(["trois)", "(", "?", "[", "*", "((", ")("])(
    "« %s » ne fait plus tomber la compilation",
    (saisie) => {
      expect(() => commeLeMoteur(saisie)).not.toThrow();
    },
  );

  it("cherche bien le caractère, et non son sens de métacaractère", () => {
    expect(commeLeMoteur("trois)").test("trois)")).toBe(true);
    expect(commeLeMoteur("(").test("(")).toBe(true);
  });

  it("le wildcard documenté est le seul à survivre", () => {
    // C'est la promesse de l'écran : « un mot ou un préfixe (wildcard .*) ».
    expect(_litteralSaufWildcard("liber.*")).toBe("liber.*");
    expect(commeLeMoteur("liber.*").test("liberté")).toBe(true);
  });

  it("l'alternance, jamais annoncée, devient littérale", () => {
    // Personne n'avait promis `chat|chien` ; le mode CQL reste là pour ça.
    expect(commeLeMoteur("chat|chien").test("chat")).toBe(false);
    expect(commeLeMoteur("chat|chien").test("chat|chien")).toBe(true);
  });

  it.each(["l'homme", "peut-être", "18,5", "18:30", "R&D", "et/ou", "liberté"])(
    "« %s » passait déjà et passe toujours",
    (saisie) => {
      expect(commeLeMoteur(saisie).test(saisie)).toBe(true);
    },
  );

  it("une saisie sans caractère spécial n'est pas touchée", () => {
    expect(_litteralSaufWildcard("liberté")).toBe("liberté");
  });
});

describe("le message d'erreur parle de la requête", () => {
  it("traduit l'erreur de regex du moteur", () => {
    const brut = `Invalid regex in predicate 'word="trois)" %c': unbalanced parenthesis at position 7`;
    const lisible = _messageLisible(brut);

    expect(lisible).toContain("Expression régulière invalide");
    expect(lisible).toContain("unbalanced parenthesis");
    expect(lisible).toContain("caractère n° 8");   // position 7, comptée depuis 1
    expect(lisible).not.toContain("Invalid regex in predicate");
  });

  it("nomme les attributs acceptés quand l'attribut est inconnu", () => {
    expect(_messageLisible("Unsupported CQL attribute: 'mot'")).toContain("word, lemma, pos");
  });

  it("laisse passer tout le reste sans le déguiser", () => {
    // Une panne réseau ne doit pas être maquillée en erreur de requête.
    expect(_messageLisible("Connection refused")).toBe("Erreur : Connection refused");
  });
});

/**
 * La portée réelle de la recherche grammaticale.
 *
 * Mesuré le 2026-08-21 : 6 documents annotés sur 54, soit 11 % du corpus. Le filtre
 * les listait tous et le filtre de langue proposait des langues sans un seul token —
 * si bien qu'un résultat vide ne disait pas « ce mot est absent » mais peut-être « ce
 * document n'est pas annoté », sans moyen de faire la différence. `/documents` renvoie
 * `token_count` depuis toujours ; il suffisait de le lire.
 */
describe("portée annotée — distinguer « absent » de « non annoté »", () => {
  // Le corpus de travail en modèle réduit : deux annotés, un pas.
  const tokens = new Map([[411, 24902], [387, 20636]]);
  const langues = new Map([[411, "fr"], [387, "es"], [403, "fr"]]);

  it("compte tout quand aucune portée n'est imposée", () => {
    expect(_porteeAnnotee(tokens, [], null, langues)).toBe(45538);
  });

  it("rend zéro sur un document non annoté — le cas qui rendait l'écran muet", () => {
    expect(_porteeAnnotee(tokens, [403], null, langues)).toBe(0);
  });

  it("rend zéro sur une langue sans aucun token", () => {
    expect(_porteeAnnotee(tokens, [], "ro", langues)).toBe(0);
  });

  it("croise document et langue", () => {
    expect(_porteeAnnotee(tokens, [411, 387], "es", langues)).toBe(20636);
    // Un document annoté, mais dans une autre langue que celle demandée.
    expect(_porteeAnnotee(tokens, [411], "es", langues)).toBe(0);
  });

  it("un document annoté seul est bien atteignable", () => {
    expect(_porteeAnnotee(tokens, [411], null, langues)).toBe(24902);
  });
});
