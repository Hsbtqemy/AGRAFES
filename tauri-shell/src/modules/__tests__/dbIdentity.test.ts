/**
 * Garde de l'identité de la base affichée (CHR-01, dernier item).
 *
 * Le déclencheur du header porte deux informations qui n'ont pas le même statut :
 *
 *  - le **titre de corpus** est une étiquette. Il est éditable, il est facultatif — et
 *    surtout il est **recopié à l'identique quand on duplique le fichier de base**. Deux
 *    copies d'un même corpus portent donc le même titre.
 *  - le **nom de fichier** est l'identité. C'est la seule chose qui distingue une copie
 *    de son original, et la raison pour laquelle il ne cède jamais sa place au titre :
 *    il descend d'une ligne, il ne disparaît pas.
 *
 * Ce fichier garde cette asymétrie, plus les deux façons dont un titre peut mentir : en
 * survivant à un changement de base, et en s'affichant pendant qu'on en ouvre une autre.
 * Rien de tout cela ne se rend — aucune suite n'importe `shell.ts`, et un titre périmé
 * ressemble trait pour trait à un titre juste.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Chemin depuis la racine du paquet : les suites du shell tournent sous `happy-dom`, où
// `import.meta.url` ne résout pas vers le disque. Cf. `dbOpenGuard.test.ts`.
const SHELL_TS_BRUT = readFileSync(resolve(process.cwd(), "src/shell.ts"), "utf-8");

/** `shell.ts` sans ses commentaires : ceux-ci citent les motifs qu'on proscrit. */
function sansCommentaires(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const SHELL_TS = sansCommentaires(SHELL_TS_BRUT);

/** Le corps d'une fonction de premier niveau, jusqu'à son accolade en colonne 0. */
function corpsDeFonction(ts: string, entete: string): string | null {
  const at = ts.indexOf(entete);
  if (at === -1) return null;
  const fin = ts.indexOf("\n}", at);
  return fin === -1 ? null : ts.slice(at, fin);
}

describe("un titre de corpus ne peut pas survivre à sa base", () => {
  it("il est stocké avec le chemin pour lequel il a été lu, jamais seul", () => {
    // `_currentDbPath` est affecté depuis neuf endroits. Un titre qu'il faudrait penser à
    // effacer à chacun finirait par survivre à l'un d'eux — et afficherait le nom d'un
    // corpus au-dessus du fichier d'un autre. Le couple rend la faute impossible plutôt
    // que rattrapable.
    expect(SHELL_TS, "le titre doit être stocké avec son chemin")
      .toMatch(/let _titreCorpus: \{ chemin: string; titre: string \} \| null/);
  });

  it("`_titreCourant` refuse un titre qui n'est pas celui de la base ouverte", () => {
    const corps = corpsDeFonction(SHELL_TS, "function _titreCourant(");
    expect(corps, "fonction _titreCourant introuvable").not.toBeNull();
    expect(corps!, "sans cette comparaison, un titre périmé redevient affichable")
      .toMatch(/_titreCorpus\.chemin === _currentDbPath/);
  });

  it("le peintre passe par ce filtre, il ne lit pas le titre en direct", () => {
    const corps = corpsDeFonction(SHELL_TS, "function _updateDbBadge(");
    expect(corps, "fonction _updateDbBadge introuvable").not.toBeNull();
    expect(corps!).toMatch(/_titreCourant\(\)/);
    expect(corps!, "lire `_titreCorpus` directement contournerait le contrôle de chemin")
      .not.toMatch(/_titreCorpus\b/);
  });

  it("la lecture asynchrone revérifie le chemin APRÈS son aller-retour", () => {
    // Un changement de base peut se produire pendant que la requête est en vol : au retour,
    // `dbPath` n'est plus forcément la base courante.
    const corps = corpsDeFonction(SHELL_TS, "async function _chargerTitreCorpus(");
    expect(corps, "fonction _chargerTitreCorpus introuvable").not.toBeNull();
    const apresAttente = corps!.slice(corps!.indexOf("await conn.get"));
    expect(apresAttente, "le contrôle doit suivre l'attente, pas la précéder")
      .toMatch(/if \(_currentDbPath !== dbPath\) return;/);
  });
});

describe("le nom de fichier ne cède jamais sa place", () => {
  it("le déclencheur construit les deux lignes, le fichier n'étant pas conditionnel", () => {
    expect(SHELL_TS).toMatch(/triggerStack\.appendChild\(triggerTitle\)/);
    expect(SHELL_TS).toMatch(/triggerStack\.appendChild\(triggerName\)/);
    // Le nom se pose toujours ; seule la ligne de titre se cache.
    expect(SHELL_TS).toMatch(/triggerTitle\.hidden = true/);
  });

  it("un message passager masque le titre — celui de la base qu'on QUITTE", () => {
    // Pendant un changement de base, `_currentDbPath` porte déjà la nouvelle : afficher
    // l'ancien titre au-dessus du nouveau nom de fichier fabriquerait la confusion même
    // que cette pile est là pour empêcher. Un changement peut durer plusieurs secondes.
    const corps = corpsDeFonction(SHELL_TS, "function _setTriggerTransient(");
    expect(corps, "fonction _setTriggerTransient introuvable").not.toBeNull();
    expect(corps!).toMatch(/titleEl\.hidden = true/);
    expect(corps!).toMatch(/shell-db-trigger-stack--titre/);
  });

  it("les deux messages passagers y passent, aucun n'écrit dans la ligne en direct", () => {
    // Note mesurée à la passe adverse : celui de `_switchDb` (« Chargement… ») ne peint
    // en fait jamais — `_updateDbBadge()` le remplace quatre instructions plus loin, sans
    // `await` entre les deux. Il l'était déjà avant ce lot, sous forme d'écriture directe.
    // Ce qui est gardé ici est donc le ROUTAGE, pas une visibilité : si on lui rendait un
    // jour son effet, il ne devra pas ressusciter la ligne de titre avec lui.
    expect(SHELL_TS).toMatch(/_setTriggerTransient\("Chargement/);
    expect(SHELL_TS).toMatch(/_setTriggerTransient\("D\\u00e9marrage du moteur/);
    // Écrire dans `.shell-db-trigger-name` sans passer par le helper laisserait la ligne
    // de titre allumée au-dessus d'un message de chargement.
    const ecrituresDirectes = SHELL_TS.match(
      /querySelector<HTMLElement>\("\.shell-db-trigger-name"\)/g,
    );
    expect(
      ecrituresDirectes?.length ?? 0,
      "seuls le peintre et le helper touchent cette ligne",
    ).toBeLessThanOrEqual(2);
  });
});

describe("deux copies d'une même base restent distinguables", () => {
  it("la liste des récentes préfixe du dossier les entrées homonymes", () => {
    // Deux copies portent souvent le même nom de fichier dans deux dossiers différents.
    // Le chemin complet n'est que dans l'infobulle : invisible tant qu'on ne survole pas.
    const corps = corpsDeFonction(SHELL_TS, "function _buildMruSection(");
    expect(corps, "fonction _buildMruSection introuvable").not.toBeNull();
    expect(corps!).toMatch(/homonymes/);
    expect(corps!, "le dossier ne s'ajoute qu'en cas de collision")
      .toMatch(/homonymes\.get\(entry\.label\) \?\? 0\) > 1 \? _dossierParent\(entry\.path\)/);
  });

  it("le titre de fenêtre porte le nom de FICHIER, et pas le titre de corpus", () => {
    const corps = corpsDeFonction(SHELL_TS, "function _updateDocTitle(");
    expect(corps, "fonction _updateDocTitle introuvable").not.toBeNull();
    expect(corps!, "c'est ce qui distingue deux fenêtres dans la barre des tâches")
      .toMatch(/_pathLabel\(_currentDbPath\)/);
    // Le titre de corpus n'y départagerait rien : une copie le porte à l'identique.
    expect(corps!).not.toMatch(/_titreCourant|_titreCorpus/);
  });

  it("et il est posé sur la fenêtre NATIVE, `document.title` n'y remontant pas", () => {
    // Mesuré le 4 septembre 2026 : la fenêtre de l'application affichait « AGRAFES Shell »
    // — la valeur figée de `tauri.conf.json` — pendant que `document.title` valait
    // « AGRAFES — Constituer ». Écrire dans `document.title` seul ne montre donc RIEN dans
    // l'application ; le `_updateDocTitle` d'origine était sans effet visible depuis toujours.
    const corps = corpsDeFonction(SHELL_TS, "function _updateDocTitle(");
    expect(corps!, "le titre natif doit être posé, pas seulement `document.title`")
      .toMatch(/_poserTitreFenetre\(titre\)/);
    const pose = corpsDeFonction(SHELL_TS, "async function _poserTitreFenetre(");
    expect(pose, "fonction _poserTitreFenetre introuvable").not.toBeNull();
    expect(pose!).toMatch(/getCurrentWindow\(\)\.setTitle\(titre\)/);

    // Et la permission, dans un AUTRE fichier : `core:window:default` accorde `allow-title`
    // (lire) et pas l'écriture. Sans elle l'appel est refusé au runtime, silencieusement —
    // le `catch` de `_poserTitreFenetre` l'avale, et le titre reste figé sans un mot.
    const cap = readFileSync(
      resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf-8",
    );
    expect(cap, "permission `core:window:allow-set-title` absente des capacités")
      .toMatch(/"core:window:allow-set-title"/);
  });
});

describe("le titre suit la fiche corpus sans attendre un changement de base", () => {
  it("le shell écoute l'annonce de prep, et repeint", () => {
    const at = SHELL_TS.indexOf('"agrafes:prep-corpus-title"');
    expect(at, "écouteur de `agrafes:prep-corpus-title` introuvable").toBeGreaterThan(0);
    const bloc = SHELL_TS.slice(at, at + 600);
    expect(bloc).toMatch(/_titreCorpus = titre \? \{ chemin: _currentDbPath, titre \} : null/);
    expect(bloc).toMatch(/_updateDbBadge\(\)/);
  });
});
