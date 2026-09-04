/**
 * Garde des trois réancrages de CHR-01 lot 3.
 *
 * La barre « Constituer » hébergeait trois choses qui n'y étaient que par accident
 * d'implantation. En la retirant, chacune pouvait se casser SANS UN MOT — ni erreur,
 * ni test rouge, ni différence visible tant qu'on ne provoque pas le cas :
 *
 *  1. Le bandeau « Impossible d'initialiser la DB ». **Point clos autrement** : DEG-01 a
 *     montré qu'il était un doublon inatteignable de `_showInitError` du shell, laquelle
 *     couvre les quatre modes. Il a donc été supprimé plutôt que réancré, et les deux
 *     cas qui le gardaient ici avec lui.
 *  2. `#app-pending-confirm`, hôte du garde « modifications non enregistrées », est
 *     positionné en absolu dans `app.css` — mais son ancêtre positionné, `.prep-shell`,
 *     est déclaré dans `prep-vnext.css`. Deux fichiers pour un seul mécanisme : qui
 *     retire ce `position: relative` en le prenant pour un reste déplace le bandeau
 *     hors de son coin, sans rien casser d'autre.
 *  3. `--prep-topbar-h` ne mesure plus une barre mais le chrome au-dessus du contenu.
 *     Sa valeur et les valeurs de repli de ses quatre consommateurs doivent rester
 *     d'accord : une dérive ne se voit qu'en cadrant mal un panneau de quelques pixels.
 *
 * D'où des assertions sur les fichiers eux-mêmes plutôt que sur un DOM : ce qui est en
 * jeu ne se rend pas, il se câble.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const APP_CSS = lire("../app.css");
const VNEXT_CSS = lire("../prep-vnext.css");
const TOKENS_CSS = lire("../tokens.css");
const APP_TS = lire("../../app.ts");

/**
 * `app.ts` sans ses commentaires. Les commentaires de CHR-01 citent les motifs qu'on
 * proscrit — c'est même leur rôle, expliquer ce qui ne doit pas revenir. Chercher dans
 * le fichier brut ferait donc échouer la garde sur sa propre documentation.
 * Suffisant ici : on retire les blocs, puis les lignes qui ne sont QUE du commentaire,
 * sans toucher aux `//` en milieu de ligne (une URL dans une chaîne, par exemple).
 */
function sansCommentaires(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const APP_TS_CODE = sansCommentaires(APP_TS);

/** Le corps de la règle `<sélecteur> { … }`, ou `null` si elle n'existe pas. */
function corpsDeRegle(css: string, selecteur: string): string | null {
  const at = css.indexOf(`${selecteur} {`);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/**
 * Le corps d'une méthode `private nom(…)`, jusqu'à sa fermeture — l'accolade seule
 * indentée de deux espaces. Les blocs internes de `app.ts` ferment à quatre au moins,
 * donc la première rencontre est bien la fin de la méthode.
 */
function corpsDeMethode(ts: string, nom: string): string | null {
  const at = ts.indexOf(`private ${nom}(`);
  if (at === -1) return null;
  const fin = ts.indexOf("\n  }", at);
  return fin === -1 ? null : ts.slice(at, fin);
}

describe("le bandeau d'erreur de prep ne doit pas revenir", () => {
  it("ni son code, ni son CSS — le shell porte la seule bannière (DEG-01)", () => {
    // Prep en tenait un doublon, inatteignable depuis que « Créer… » a quitté la barre :
    // son seul appelant était le `catch` de `_onCreateDb`, lui-même appelé par son propre
    // bouton « Réessayer ». `_showInitError` du shell couvre les quatre modes, y compris
    // ceux qui ne montent aucun module. Le rétablir ici recréerait deux messages pour un
    // seul échec — et, avec les dialogues qui l'accompagnaient, la désynchronisation du
    // chemin de base entre prep et le shell.
    expect(APP_TS_CODE).not.toMatch(/_showPrepInitError|_onOpenDb|_onCreateDb/);
    expect(APP_CSS).not.toMatch(/\.prep-init-error/);
  });
});

describe("garde de sortie d'onglet", () => {
  it("son hôte est posé dans `.prep-shell`, pas dans une barre", () => {
    expect(APP_TS_CODE).toMatch(/shell\.appendChild\(pendingConfirmBar\)/);
  });

  it("l'ancêtre positionné qu'il suppose existe — et il vit dans un AUTRE fichier", () => {
    const shell = corpsDeRegle(VNEXT_CSS, ".prep-shell");
    expect(shell, "règle .prep-shell introuvable dans prep-vnext.css").not.toBeNull();
    expect(shell!, "`.prep-shell` doit rester positionné : `#app-pending-confirm` s'y ancre")
      .toMatch(/position:\s*relative/);

    const bandeau = corpsDeRegle(APP_CSS, "#app-pending-confirm");
    expect(bandeau, "règle #app-pending-confirm introuvable dans app.css").not.toBeNull();
    expect(bandeau!).toMatch(/position:\s*absolute/);
  });
});

describe("--prep-topbar-h", () => {
  it("sa valeur et les replis de ses consommateurs restent d'accord", () => {
    const decl = TOKENS_CSS.match(/--prep-topbar-h:\s*(\d+)px/);
    expect(decl, "déclaration de --prep-topbar-h introuvable dans tokens.css").not.toBeNull();
    const valeur = decl![1];

    // Un repli qui diverge de la déclaration ne se voit que le jour où la variable
    // n'est pas résolue — c'est-à-dire jamais en test, et une fois en production.
    for (const css of [APP_CSS, VNEXT_CSS]) {
      for (const m of css.matchAll(/--prep-topbar-h,\s*(\d+)px/g)) {
        expect(m[1], `repli ${m[1]}px ≠ déclaration ${valeur}px`).toBe(valeur);
      }
    }
  });
});

/**
 * Quatrième garde, ajoutée le 2 septembre 2026 par ce que la passe de QA a trouvé.
 *
 * Le tiroir du Journal a DEUX fermetures : l'icône du header shell, et sa propre ✕, qui
 * est à l'intérieur de prep. Le shell ne voit que la première. Tant qu'il peignait son
 * icône depuis le retour de `toggleJournal()`, la seconde laissait l'icône allumée sur un
 * tiroir fermé — et le clic suivant rouvrait ce qu'elle semblait proposer de fermer.
 *
 * D'où l'annonce : prep émet son état, le shell l'écoute. Le retirer ne casse ni le build
 * ni le rendu ; ça ne se voit qu'en fermant par la ✕, puis en regardant l'icône.
 */
/**
 * Le raccourci « Fiche corpus » de l'en-tête de Documents (CHR-01, dernier item).
 *
 * Trois maillons, et aucun ne casse bruyamment : le bouton du gabarit, son câblage dans
 * `MetadataScreen`, et l'orientation par `App` vers la commande qui ouvre la modale. Qu'un
 * seul saute — un id renommé, un setter jamais appelé — et le bouton reste à l'écran sans
 * rien faire. Ni le build, ni le rendu, ni aucun test de DOM ne le verrait : prep tourne
 * sous `node`, sans DOM du tout.
 */
describe("raccourci « Fiche corpus » dans Documents", () => {
  const GABARIT = lire("../../lib/metadataScreenTemplate.ts");
  const ECRAN = lire("../../screens/MetadataScreen.ts");

  it("le bouton est dans le gabarit, avec l'id que l'écran écoute", () => {
    expect(GABARIT).toMatch(/id="meta-corpus-info-btn"/);
    expect(GABARIT, "le raccourci reste plus léger que ses voisins — il n'est pas une action")
      .toMatch(/id="meta-corpus-info-btn"[\s\S]{0,120}btn-ghost/);
    expect(ECRAN, "`MetadataScreen` doit écouter exactement cet id")
      .toMatch(/"#meta-corpus-info-btn"\)\?\.addEventListener/);
  });

  it("l'écran passe par un callback, il ne connaît pas la modale", () => {
    // Les écrans ne se référencent pas entre eux et n'atteignent pas `App` : ils annoncent
    // un geste, `App` l'oriente. Même forme que `setOnOpenAlignment` et `setOnOpenExporter`.
    expect(ECRAN).toMatch(/setOnOpenCorpusInfo\(cb: \(\(\) => void\) \| null\)/);
    expect(ECRAN).toMatch(/this\._onOpenCorpusInfo\?\.\(\)/);
  });

  it("la fiche ne s'ouvre pas deux fois", () => {
    // Deux entrées y mènent — le menu de la base du shell et ce raccourci — et le raccourci
    // est un bouton ordinaire, donc double-cliquable. Sans garde, deux modales s'empilent et
    // en fermer une laisse l'autre. Défaut préexistant que le raccourci rendait atteignable.
    const corps = APP_TS_CODE.slice(APP_TS_CODE.indexOf("private async _showCorpusInfoModal("));
    expect(corps.slice(0, 400)).toMatch(/querySelector\("\.prep-dialog-overlay"\)\)\s*return;/);
  });

  it("`App` oriente vers sa propre commande, celle que le shell appelle aussi", () => {
    // Une seule modale, deux entrées : le menu de la base du shell et ce raccourci. Les
    // faire diverger recréerait deux chemins à maintenir pour un même écran.
    expect(APP_TS_CODE).toMatch(/setOnOpenCorpusInfo\(\(\) => this\.openCorpusInfo\(\)\)/);
  });
});

describe("le tiroir du Journal annonce son état", () => {
  it("`_toggleJournal` émet `agrafes:prep-journal` à chaque bascule", () => {
    const corps = corpsDeMethode(APP_TS_CODE, "_toggleJournal");
    expect(corps, "méthode _toggleJournal introuvable dans app.ts").not.toBeNull();
    expect(corps!, "sans cette annonce, la ✕ du tiroir ferme sans dépeindre l'icône du shell")
      .toMatch(/dispatchEvent\(\s*new CustomEvent\(\s*"agrafes:prep-journal"/);
    expect(corps!, "l'événement doit porter l'état, pas seulement signaler un changement")
      .toMatch(/open:\s*this\._journalOpen/);
  });

  it("la ✕ du tiroir passe par cette même méthode, et non par un raccourci", () => {
    // Si elle refermait le tiroir en propre, l'annonce lui échapperait — le défaut
    // reviendrait par un autre chemin, avec la garde ci-dessus toujours au vert.
    // Assertion portée par la ligne plutôt que par sa forme exacte : ce qui compte est
    // qu'elle appelle `_toggleJournal`, pas la façon dont elle est écrite.
    const ligne = APP_TS_CODE.split("\n").find(
      (l) => l.includes("#prep-journal-close") && l.includes("addEventListener"),
    );
    expect(ligne, "câblage du bouton ✕ introuvable dans app.ts").toBeDefined();
    expect(ligne!).toMatch(/_toggleJournal\(/);
  });
});

/**
 * L'identité de la base dans la fiche corpus (CHR-01, dernier item).
 *
 * Le titre de corpus est une ÉTIQUETTE : dupliquer un fichier de base le recopie tel
 * quel, donc deux copies portent le même. La fiche est pourtant l'endroit où on le
 * saisit — et elle ne disait pas dans quel fichier elle écrit. Sur des bases de travail
 * qui se copient, c'est le moment le plus exposé de l'application : on peut nommer un
 * corpus dans la copie en croyant nommer l'original, et rien à l'écran ne le dément.
 */
describe("la fiche corpus dit dans quelle base elle écrit", () => {
  it("son en-tête porte le nom de fichier, chemin complet en infobulle", () => {
    const corps = APP_TS_CODE.slice(APP_TS_CODE.indexOf("private async _showCorpusInfoModal("));
    expect(corps.indexOf("private async"), "modale introuvable").toBe(0);
    expect(corps.slice(0, 3000)).toMatch(/getCurrentDbPath\(\)/);
    expect(corps.slice(0, 3000)).toMatch(/prep-dialog-subject/);
    expect(corps.slice(0, 3000), "le chemin complet reste accessible sans encombrer l'en-tête")
      .toMatch(/fichierEl\.title = `Chemin complet/);
  });

  it("la classe existe dans la feuille — sinon le repère s'affiche sans style", () => {
    expect(APP_CSS).toMatch(/\.prep-dialog-subject \{/);
  });

  it("le champ Titre ne renvoie plus à une barre qui n'existe plus", () => {
    // Le texte d'aide disait « affiché dans la barre » ; CHR-01 lot 3 a retiré cette barre.
    expect(APP_TS).not.toMatch(/affich\\u00e9 dans la barre/);
  });

  it("l'enregistrement annonce le nouveau titre au shell, et seulement s'il a réussi", () => {
    // Le shell peint ce titre au-dessus du nom de fichier. Sans annonce, il ne le relit
    // qu'à l'ouverture d'une base : un titre qu'on vient de changer resterait invisible,
    // et l'enregistrement aurait l'air raté. Même patron que `agrafes:prep-journal`.
    const at = APP_TS_CODE.indexOf("await updateCorpusInfo(");
    expect(at, "appel à updateCorpusInfo introuvable").toBeGreaterThan(0);
    const jusquAuCatch = APP_TS_CODE.slice(at, APP_TS_CODE.indexOf("} catch", at));
    expect(jusquAuCatch, "l'annonce doit suivre l'écriture, dans le chemin de succès")
      .toMatch(/dispatchEvent\(\s*new CustomEvent\(\s*"agrafes:prep-corpus-title"/);
    expect(jusquAuCatch, "l'événement doit porter le titre, pas seulement signaler")
      .toMatch(/detail: \{ title \}/);
  });
});
