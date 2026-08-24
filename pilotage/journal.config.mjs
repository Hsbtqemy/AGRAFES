// Ce que le journal doit savoir de CE dépôt. Tout le reste — la lecture des fiches,
// des passes, des cases, le front d'intégration, les silences — est le même partout.
//
// Le fichier est FACULTATIF : sans lui, le journal lit `pilotage/` et rend les
// chantiers, les passes et le contrôleur. Ce qu'on perd est exactement ce qui
// demande de connaître le dépôt : les masses par aire, la veille à seuil, et les
// liens d'un code vers le document qui l'a écrit.

export default {
  // Refs d'intégration, de l'amont vers l'aval. Un chantier vit sur la première qui
  // contient son dernier commit ; à défaut sur la branche courante, donc pas intégré.
  refs: ["origin/main", "dev"],

  // Le vocabulaire des codes de CE dépôt. C'est la seule partie du contrat qui ne
  // peut pas être générique : elle décrit comment on nomme un chantier ici. Un
  // motif trop large ramasse du bruit — `UTF-8` passe pour un chantier avec le
  // motif d'AGRAFES, mesuré sur un autre dépôt le 2026-08-24.
  codes: {
    chantier: /\b(R[0-9](?:\.[0-9])?|[A-Z]{1,4}-[0-9]{1,3}[A-Za-z]?)\b/g,
    decision: /\bD-[PWC][0-9]{1,2}\b/g,
    adr:      /\bADR-[0-9]{3}\b/g
  },

  // D'où vient un code : le document qui l'a écrit, pour que l'écran y renvoie.
  // Première source qui cite un code l'emporte, sauf `ecrase` (les ADR font foi).
  documentation: {
    dossier: "docs",
    sources: [
      { fichiers: /^(AUDIT|REVIEW)_/, codes: "chantier" },
      { fichiers: /^DESIGN_/,         codes: "decision" },
      { fichiers: /^DECISIONS\.md$/,  codes: "adr", ecrase: true }
    ]
  },

  // Une aire = un préfixe de chemin ; le premier qui matche l'emporte, donc
  // sidecar.py et services/ sont détachés avant le reste du moteur.
  aires: [
    ["moteur/sidecar.py", "src/multicorpus_engine/sidecar.py"],
    ["moteur/services",   "src/multicorpus_engine/services/"],
    ["moteur/reste",      "src/multicorpus_engine/"],
    ["prep/lib",          "tauri-prep/src/lib/"],
    ["prep/screens",      "tauri-prep/src/screens/"],
    ["prep/components",   "tauri-prep/src/components/"],
    ["prep/ui",           "tauri-prep/src/ui/"],
    ["prep/reste",        "tauri-prep/src/"],
    ["app",               "tauri-app/src/"],
    ["shell",             "tauri-shell/src/"],
    ["tests",             "tests/"]
  ],

  // Le seul chiffre du tableau de bord qui ait une limite réelle. Mêmes paramètres
  // que .github/workflows/sidecar-growth-gate.yml — s'ils y changent, ils changent
  // ici. `chantier` = la fiche où se prend la décision quand le seuil approche ;
  // sans elle, le chiffre est un cul-de-sac : on voit qu'il monte, pas où agir.
  veille: { fichier: "src/multicorpus_engine/sidecar.py", seuil: 500, jours: 90,
            chantier: "A-01" }
};
