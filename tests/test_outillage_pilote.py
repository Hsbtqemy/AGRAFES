"""Le gel de l'outillage Node tient-il ?  (`pilote`, le journal de bord.)

Ce cliquet est porté depuis BD_ditor, où il existe parce que le gel y a sauté TROIS fois
— dont deux après avoir été « corrigé ». La cause a fini par être reproduite plutôt que
supposée : **`npm install <url>` réécrit `git+https://github.com/O/R.git#<sha>` en
`github:O/R` et JETTE la référence.** Le verrou résout alors le HEAD amont, et la révision
installée change sans que personne ne l'ait demandée — ni le contrat lu par
`npm run verifier`, ni `pilotage/_TEMPLATE.md`, n'ayant été vérifiés pour celle-là.

La forme qui SURVIT, mesurée sur deux `npm install` de suite, est la forme courte de npm
avec sa référence : `github:O/R#<sha>`. C'est celle qu'exige le premier test.

Ce dépôt-ci n'avait pas le cliquet, et l'a payé le 2026-09-04 : un `npm install` s'est
déclaré « up to date » sans suivre le manifeste. Le verrou est resté une révision en
arrière et l'outil installé ne portait pas le correctif attendu, sans que rien ne le
signale. L'écart n'a été vu que parce qu'il a été cherché à la main. Remède ce jour-là :
`rm -rf node_modules/pilote` puis `npm install`.

Ces deux tests ne lisent que des fichiers versionnés — pas `node_modules/`, qui n'est pas
dans le dépôt et qu'une CI réinstalle de toute façon.
"""

import json
import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SHA = re.compile(r"#([0-9a-f]{40})$")


def _manifeste() -> dict:
    return json.loads((RACINE / "package.json").read_text(encoding="utf-8"))


def _verrou() -> dict:
    return json.loads((RACINE / "package-lock.json").read_text(encoding="utf-8"))


def test_pilote_est_epingle_sur_un_commit():
    """Sans référence dans `package.json`, npm re-résout sur le HEAD amont à chaque
    installation — et le dépôt se met à dépendre d'une révision que personne n'a lue."""
    spec = _manifeste()["devDependencies"]["pilote"]
    assert SHA.search(spec), (
        f"`pilote` n'est pas épinglé sur un commit : {spec!r}.\n"
        "Forme attendue : `github:Hsbtqemy/pilote#<40 caractères hex>`. La forme longue "
        "`git+https://…#<sha>` NE TIENT PAS — `npm install` la normalise en `github:O/R` "
        "et jette la référence (mesuré). Changer de révision est un ACTE : on vérifie "
        "d'abord que `pilotage/_TEMPLATE.md` est identique à celui du paquet et que les "
        "statuts de `journal-contrat.mjs` sont ceux de CLAUDE.md.")


def test_le_verrou_et_le_manifeste_designent_le_meme_commit():
    """Deux fichiers qui se contredisent, c'est une installation dont le résultat dépend
    de la commande employée — et donc de la machine. C'est précisément ce qui est arrivé
    ici le 2026-09-04, npm ayant ignoré un manifeste qu'il jugeait déjà satisfait."""
    spec = _manifeste()["devDependencies"]["pilote"]
    m = SHA.search(spec)
    # Sans ce garde-fou, l'absence de référence ferait planter le test en `AttributeError`
    # au lieu de nommer ce qu'il a trouvé — un cliquet qui s'écroule au lieu de parler
    # coûte plus qu'il ne rapporte.
    assert m, f"pas de commit épinglé dans le manifeste : {spec!r} (cf. le test ci-dessus)"
    attendu = m.group(1)
    verrou = _verrou()
    resolu = verrou["packages"]["node_modules/pilote"]["resolved"]
    assert attendu in resolu, (
        f"le manifeste épingle {attendu[:12]} mais le verrou résout {resolu[-45:]} — "
        "`npm install` peut se déclarer « up to date » sans rien faire : supprimez "
        "`node_modules/pilote` puis réinstallez.")
    racine = verrou["packages"][""]["devDependencies"]["pilote"]
    assert attendu in racine, (
        f"le verrou enregistre une autre exigence que le manifeste : {racine!r}")
