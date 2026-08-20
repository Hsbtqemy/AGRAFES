# Findings — passe QA campagne alignement (2026-08-20)

Exécution de `pilotage/qa/alignement-2026-08.md`. Shell dev, sidecar reconstruit,
contrat live **1.6.69**, base `corpus_agrafes.WORKCOPY.db`.

Ce fichier recueille les findings de **cette** exécution. La passe elle-même reste
rejouable et n'est pas modifiée ici.

---

## QAA-01 🟠 — « Tauri runtime : no » alors que l'application tourne sous Tauri

Le panneau Diagnostic affirme `Tauri runtime : no` pendant que l'application invoque des
commandes Tauri avec succès — le rapport lui-même est produit par un `invoke`.

**Cause.** La sonde est `"__TAURI__" in window` (`diagnostics.ts:225`). Ce global n'existe
que si `app.withGlobalTauri: true` dans `tauri.conf.json` ; l'option est **absente**, et le
shell passe par les imports ES (`@tauri-apps/api/core`). La ligne répond donc « no »
invariablement, en dev comme en release, depuis toujours.

**Pourquoi ça compte.** C'est le frère jumeau de QA-13, corrigé ce matin : une sonde qui
teste la mauvaise chose et imprime son échec comme un fait. Quelqu'un qui déboguerait un
problème d'intégration conclurait que le pont Tauri est rompu — et chercherait au mauvais
endroit. Le panneau de diagnostic est le dernier endroit où l'on peut se permettre
d'affirmer faux.

**Correctif.** Sonder ce qu'on utilise réellement : la disponibilité d'`invoke` (import ES
résolu), ou `window.isTauri` que Tauri v2 pose sans `withGlobalTauri`. Ne pas activer
`withGlobalTauri` pour faire passer la sonde — ce serait élargir la surface exposée au
webview pour satisfaire un test.

## QAA-02 🟡 — « Size : N/A » : la taille de la base n'est jamais lisible

Le rapport annonce `Size : N/A` sur une base qui existe et fait plusieurs dizaines de Mo.

**Cause.** `_getDbSize` appelle `stat` de `@tauri-apps/plugin-fs`, et les capacités du shell
n'autorisent que `fs:scope-app-recursive` et `fs:scope-appdata-recursive`. La base vit dans
`Documents/IGE/`, **hors des deux portées** : l'appel est refusé, et le `catch` renvoie
`null` sans un mot.

**Pourquoi ça compte.** La taille de la base est une information de diagnostic de premier
ordre (croissance, corruption, purge). Et l'échec est **silencieux** : rien ne distingue
« base introuvable » de « permission refusée ».

**Correctif.** Le sidecar connaît le chemin et n'a pas de restriction de portée — demander
la taille au moteur plutôt qu'au webview. À défaut, distinguer les deux causes dans
l'affichage.

## Non-finding — la bannière de crash est légitime

`Crash detected from previous session: 2026-08-20T13:27:54Z` correspond au dernier
démarrage de la session précédente, terminée sans sortie propre (processus arrêtés à la
main pendant la reconstruction du sidecar). Le marqueur est posé au boot et effacé sur
`beforeunload` : il a fonctionné comme prévu. **Pas un faux positif**, malgré la
coïncidence d'horaire avec un rechargement HMR.
