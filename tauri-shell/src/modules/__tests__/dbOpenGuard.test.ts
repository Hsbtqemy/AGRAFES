/**
 * Garde de l'ouverture de base (DEG-01).
 *
 * Ouvrir et créer sont la MÊME opération côté moteur : `ensureRunning` sur un chemin
 * absent produit une base vide et migrée, sans un mot, et la rend active. Mesuré le
 * 2 septembre 2026 — 4096 octets et un WAL de 1,4 Mo apparus au clic sur une récente
 * dont le fichier n'existait plus.
 *
 * Ce qui sépare désormais l'utilisateur de ce cas est un contrôle d'existence en tête de
 * `_initDb`, et une exemption explicite pour la création. Deux choses peuvent le défaire
 * sans que rien ne s'en aperçoive : retirer le contrôle, ou ajouter un second
 * `{ creation: true }` quelque part. Les deux se voient ici, nulle part ailleurs — aucune
 * suite n'importe `shell.ts`, et un défaut d'ouverture ne se rend pas, il s'exécute.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Chemin depuis la racine du paquet : les suites du shell tournent sous `happy-dom`, où
// `import.meta.url` ne résout pas vers le disque. Cf. `constituerCommands.test.ts`.
const SHELL_TS_BRUT = readFileSync(resolve(process.cwd(), "src/shell.ts"), "utf-8");

/**
 * `shell.ts` sans ses commentaires. Ceux de DEG-01 citent `ensureRunning` pour expliquer
 * pourquoi le garde le précède — la première version de ce fichier trouvait donc
 * `ensureRunning` dans sa propre justification, et échouait sur elle. Même parade que
 * `prepChrome.test.ts`, dont ce helper est repris.
 */
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

describe("la primitive distingue « absent » de « je n'ai pas pu regarder »", () => {
  const MAIN_RS = readFileSync(resolve(process.cwd(), "src-tauri/src/main.rs"), "utf-8");

  it("`path_exists` s'appuie sur `try_exists`, jamais sur `exists`", () => {
    const at = MAIN_RS.indexOf("fn path_exists(");
    expect(at, "commande path_exists introuvable dans main.rs").toBeGreaterThan(-1);
    const corps = MAIN_RS.slice(at, MAIN_RS.indexOf("\n}", at));

    // `Path::exists()` rend `false` quand l'accès aux métadonnées échoue — permissions,
    // partage réseau injoignable. Il confond donc « absent » et « je ne sais pas », et
    // l'appelant refuserait d'ouvrir une base présente ; au démarrage il lâcherait son
    // chemin, perdant de vue une base pour un incident passager. Le raccourci est tentant
    // (`-> bool` plutôt que `-> Result<bool, String>`), et il est muet.
    expect(corps, "`exists()` confond absence et illisibilité").not.toMatch(/\.exists\(\)/);
    expect(corps).toMatch(/\.try_exists\(\)/);
  });
});

describe("une base absente ne doit pas être créée", () => {
  it("`_initDb` contrôle l'existence avant de démarrer le moteur", () => {
    const corps = corpsDeFonction(SHELL_TS, "async function _initDb(");
    expect(corps, "fonction _initDb introuvable dans shell.ts").not.toBeNull();

    const garde = corps!.indexOf("_fichierCertainementAbsent");
    const moteur = corps!.indexOf("ensureRunning");
    expect(garde, "le contrôle d'existence a disparu de `_initDb`").toBeGreaterThan(-1);
    expect(moteur, "`ensureRunning` introuvable dans `_initDb`").toBeGreaterThan(-1);
    // L'ordre est tout : contrôler après avoir démarré le moteur ne contrôle plus rien,
    // la base étant déjà créée.
    expect(garde, "le contrôle doit précéder `ensureRunning`").toBeLessThan(moteur);
  });

  it("le contrôle échoue OUVERT — une incertitude n'empêche pas d'ouvrir", () => {
    const corps = corpsDeFonction(SHELL_TS, "async function _fichierCertainementAbsent(");
    expect(corps, "fonction _fichierCertainementAbsent introuvable").not.toBeNull();
    // Rendre `true` sur une erreur refuserait d'ouvrir une base parfaitement saine.
    expect(corps!).toMatch(/catch[\s\S]*return false;/);
  });

  it("le contrôle interroge Rust, pas le plugin `fs` — dont la portée exclut les bases", () => {
    const corps = corpsDeFonction(SHELL_TS, "async function _fichierCertainementAbsent(");
    expect(corps!).toMatch(/invoke<boolean>\("path_exists"/);
    // C'est LA raison d'être de ce cas. L'`exists()` du plugin lève hors de `$APP` et
    // `$APPDATA` — « forbidden path … allow-exists » — donc sur toute base rangée dans les
    // documents de l'utilisateur. Le repli ouvert du garde devenait le cas normal : le
    // 3 septembre 2026, une base a été recréée sous ses yeux, garde en place. Y revenir ne
    // casserait rien de visible : le garde redeviendrait simplement décoratif.
    expect(corps!, "le plugin `fs` ne peut pas répondre pour ces chemins")
      .not.toMatch(/plugin-fs|await exists\(/);
  });

  it("`_switchDb` refuse AVANT d'adopter le chemin", () => {
    const corps = corpsDeFonction(SHELL_TS, "async function _switchDb(");
    expect(corps, "fonction _switchDb introuvable").not.toBeNull();

    const garde = corps!.indexOf("_fichierCertainementAbsent");
    const adoption = corps!.indexOf("_currentDbPath = path");
    const publication = corps!.indexOf("_dbListeners.forEach");
    expect(garde, "le contrôle a disparu de `_switchDb`").toBeGreaterThan(-1);
    expect(adoption, "`_currentDbPath = path` introuvable").toBeGreaterThan(-1);

    // Le garde de `_initDb` ne suffit PAS, et c'est mesuré : le 3 septembre 2026 il a refusé
    // deux fois, et la base a été créée onze secondes plus tard. `_switchDb` continuait —
    // chemin adopté, publié aux `_dbListeners` — et chaque module démarre son propre sidecar
    // sur ce qu'on lui donne. L'invariant est que `_currentDbPath` ne porte jamais un chemin
    // absent ; il ne tient que si le contrôle précède l'adoption ET la publication.
    expect(garde, "contrôler après avoir adopté le chemin ne contrôle rien").toBeLessThan(adoption);
    if (publication > -1) {
      expect(garde, "les modules ne doivent jamais recevoir un chemin absent")
        .toBeLessThan(publication);
    }

    // Et le verrou de réentrance se prend AVANT le contrôle, qui est asynchrone : placé
    // après, il laisse deux clics rapides franchir tous deux le test `if (_switchingDb)`
    // et lancer deux changements — deux sidecars concurrents, la panne que le verrou de
    // spawn existe pour éteindre. Défaut introduit avec le garde le 3 septembre 2026.
    const verrou = corps!.indexOf("_switchingDb = true");
    expect(verrou, "`_switchingDb = true` introuvable").toBeGreaterThan(-1);
    expect(verrou, "un `await` entre le test de réentrance et le verrou rouvre la course")
      .toBeLessThan(garde);
  });

  it("le démarrage n'adopte pas un chemin persisté disparu", () => {
    // Le seul cas qui ne demande aucun geste : une base déplacée entre deux sessions.
    // Sans ce contrôle, elle est recréée vide et l'application rouvre dessus sans un mot.
    const at = SHELL_TS.indexOf("_fichierCertainementAbsent(_currentDbPath)");
    expect(at, "le démarrage ne contrôle plus le chemin restauré").toBeGreaterThan(-1);
    const suite = SHELL_TS.slice(at, at + 400);
    expect(suite, "le chemin absent doit être lâché, pas publié").toMatch(/_currentDbPath = null/);
  });

  it("une seule ouverture s'exempte du contrôle, et c'est la création", () => {
    const exemptions = [...SHELL_TS.matchAll(/_initDb\([^)]*creation:\s*true/g)];
    expect(
      exemptions.length,
      "chaque `{ creation: true }` rouvre le trou : le fichier y est créé sans contrôle",
    ).toBe(1);
    // Et elle vit bien dans le flux de création, pas ailleurs.
    const corps = corpsDeFonction(SHELL_TS, "async function _onCreateDb(");
    expect(corps, "fonction _onCreateDb introuvable").not.toBeNull();
    expect(corps!).toMatch(/creation:\s*true/);
  });
});
