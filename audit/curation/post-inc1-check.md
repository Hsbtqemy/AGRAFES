# Post-Inc1 Check — Actions > Curation (tauri-prep)

## Scope
- Micro-audit post-Inc 1 uniquement.
- Aucun changement applicatif.
- Vérification ciblée à 1440x900, état `long-content` injecté pour comparer un état nominal rempli.

## Artefacts
- Runtime after Inc1: `audit/curation/runtime_after_inc1.png`
- Mockup correspondant: `audit/curation/mockup_after_inc1.png`
- Métriques ciblées: `audit/curation/post-inc1-metrics.json`

## Mesures ciblées (pré Inc1 -> post Inc1 -> mockup)

| Métrique | Pré Inc1 (runtime) | Post Inc1 (runtime) | Mockup | Lecture |
|---|---:|---:|---:|---|
| Largeur utile panel Curation (`workspace.w`) | 1172.81 | 1188.62 | 1294.00 | +15.81 px (amélioration), mais encore -105.38 px vs mockup |
| Largeur zone centrale (`col_center.w`) | 680.00 | 560.00 | 640.00 | régression de -120 px vs pré Inc1; post Inc1 reste -80 px vs mockup |
| Hauteur `.doc-scroll` (`doc_scroll.h`) | 400.00 | 558.00 | 560.00 | amélioration majeure, quasi parité |
| Minimap (`minimap.w x h`) | 26 x 430 | 22 x 592 | 22 x 593 | amélioration majeure, quasi parité |
| Font-size head title (`head_title`) | 16.8px | 17.6px | 18px | amélioration |
| Font-size head subtitle (`head_subtitle`) | 12.8px | 13.12px | 13px | amélioration (taille) |
| Font-size preview controls (`preview_controls`) | 14px | 12px | 16px | régression de densité (plus petit) |
| Font-size pane head (`pane_head`) | 12px | 12.5px | 12px | légèrement plus lisible |

## Ce qui s’est objectivement amélioré
- Preview centrale en hauteur: `.doc-scroll` est passée de 400px à 558px (cible mockup ~560px atteinte).
- Minimap: dimensions et proportions alignées (22x592 vs 22x593 mockup).
- Head Curation: typographie du titre et sous-titre remontée, plus proche du mockup.
- Largeur utile globale Curation: léger gain (+15.81px).

## Ce qui reste insuffisant
- Zone centrale trop étroite en largeur (560px vs 640px mockup).
- Densité des `preview_controls` trop petite (12px vs 16px mockup).
- Largeur utile globale encore significativement en dessous du mockup (~105px).

## Marge négative (acceptabilité)
- La marge négative améliore localement la largeur utile, mais reste un correctif de surface.
- Acceptable en patch transitoire.
- Recommandation: remplacer en Inc 2 par un réglage structurel explicite des colonnes/conteneur (sans hack de marge).

## Overflows et minimap
- `preview_card`: `overflow: hidden` comme mockup.
- `minimap`: `overflow: visible` et rendu correct observé, pas de clipping bloquant.
- `preview_grid`: `overflow: hidden` (différent du mockup `visible`), mais dans l’état observé cela n’empêche pas la minimap de se rendre correctement.

## Décision
- Recommandation: **Inc 2 structurel** (pas léger).
- Raisons:
  - la hauteur est corrigée (très bon),
  - mais la largeur centrale et la densité des contrôles restent non alignées,
  - la marge négative ne doit pas rester la solution principale.
