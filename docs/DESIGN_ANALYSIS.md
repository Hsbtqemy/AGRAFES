# Analyse du design actuel — Shell AGRAFES

Document d’analyse du design actuel (padding, espacements, organisation des onglets, inventaire des zones d’affichage) pour identifier les points de friction et préparer le redesign.

---

## Inventaire général — ce qui s’affiche où

Vue d’ensemble de chaque partie de l’app et de ce qu’elle affiche (sans entrer dans le détail des écrans Constituer).

### A. Shell (commun à toute l’app)

| Zone | Emplacement | Contenu affiché |
|------|-------------|------------------|
| **Header** | Fixe en haut, 44px | Brand « AGRAFES » · onglets Explorer / Constituer · Presets · ⌨ · ⓘ · menu ? (Support) · badge « DB : &lt;fichier&gt; » · bouton « DB ▾ » (menu Ouvrir / Créer / MRU). |
| **Bandeau erreur init DB** | Sous le header, temporaire | Message « Impossible d’initialiser la DB », détail erreur, boutons Réessayer / Choisir un autre / Fermer. |
| **Toast** | Fixe bas, centré | Message court (ex. « DB active : xxx.db »), disparition auto. |
| **Bandeau crash recovery** | Fixe tout en haut (au-dessus du header) | « AGRAFES s’est fermé de façon inattendue » + date + Exporter logs… / Ignorer. |
| **Modals (shell)** | Overlay plein écran | **Diagnostic** (titre, corps texte pré, Copier / Exporter / Fermer) · **À propos** (titre, tagline, tableau versions, profils TEI, Exporter logs…) · **Raccourcis** (liste ⌘1/2/3/0, ⌘O, etc.) · **Presets globaux** (liste, Migrer / Exporter / Importer) · **Mises à jour** (lien Releases si ouverture navigateur échoue). |
| **Menu DB ▾** | Dropdown sous le bouton DB | Ouvrir… · Créer… · séparateur · « Récents » (liste MRU avec épingler / retirer). |
| **Menu Support ?** | Dropdown sous le bouton ? | Diagnostic système… · Exporter logs… · Vérifier les mises à jour… · séparateur · À propos… · Raccourcis…. |

---

### B. Mode Home (corps = `#app`)

| Zone | Contenu affiché |
|------|------------------|
| **Bloc principal** | Titre « AGRAFES », sous-titre « Choisissez un module ». |
| **Cartes** | 3 cartes cliquables : **Explorer** (icône, badge, titre, description) · **Constituer** (idem) · **Publier** (idem). |
| **Section démo** | Ligne « Ou essayez avec un corpus préinstallé » · carte « Corpus démo (Machiavel FR/EN…) » avec boutons **Installer…** / **Ouvrir Explorer**. |
| **Guide rapide** | Carte « Guide rapide — Étape X / 3 » avec étapes (Ouvrir Explorer et chercher « prince », Générer rapport QA, Exporter package), boutons « Lancer → », lien « Réinitialiser le guide ». |

---

### C. Mode Explorer (corps = `#app` = contenu Concordancier)

Tout le contenu ci‑dessous est rendu par le module tauri-app (Concordancier) à l’intérieur de `#app`.

| Zone | Contenu affiché |
|------|------------------|
| **Topbar** | Titre « Concordancier » · badge DB (nom fichier) · pastille de statut sidecar (point vert / orange / rouge). |
| **Toolbar** | Champ recherche + bouton Chercher · boutons Segment / KWIC · Alignés on/off · Parallèle on/off (si alignés) · réglage fenêtre KWIC (slider) · Filtres · Requête (builder) · ? (aide FTS5) · Importer… · Ouvrir DB… · Réinitialiser · Historique · Export (menu). |
| **FTS preview bar** | Affichée si requête saisie : label « FTS : » + code de la requête transformée. |
| **Filter drawer** | (Si ouvert) Langue, Rôle, Type ressource, Doc ID (selects/input) · lien « Effacer tout ». |
| **Chips bar** | (Si filtres actifs) Chips « Langue : x », « Rôle : y », etc. avec ✕. |
| **Builder panel** | (Si ouvert) Mode (Simple / Expression exacte / ET / OU / NEAR), réglage N pour NEAR, message d’avertissement éventuel. |
| **Results area** | **État vide** : « ⏳ Démarrage… / Connexion au sidecar en cours » ou « Sidecar prêt » ou « Aucun résultat » · **Avec résultats** : ligne « X résultat(s) chargé(s) / total » · liste de cartes (hit : métadonnées, segment ou KWIC, option alignés/parallèle) · « Charger plus » si pagination. |
| **Statusbar** | Gauche : « DB : &lt;path&gt; · sidecar ready » · droite : statut court (idle, ready, etc.). |
| **Modals / panneaux** | **Import** : formulaire (fichier, mode, langue, titre) · **Panneau métadonnées** (slide depuis la droite) : champs du document du hit sélectionné. |

---

### D. Mode Constituer (corps = `#app` = contenu Prep)

Tout le contenu ci‑dessous est rendu par le module tauri-prep dans `#app`.

| Zone | Contenu affiché |
|------|------------------|
| **Topbar** | « Constituer » · chemin DB (ou « Aucun corpus ») · **Ouvrir…** · **Créer…** · **Presets** (ouvre modal presets de projet). |
| **Tabbar** | 4 onglets : **Importer** · **Documents** · **Actions** · **Exporter**. Un seul écran visible à la fois. La gestion de la DB (ouvrir/créer/MRU) est dans le shell (header) et la topbar du module — pas un onglet séparé. |
| **JobCenter** | Bandeau (visible seulement s’il y a des jobs) : titre « En cours » / « Récents », liste de jobs (label, type, %, barre de progression, annuler). Toasts Prep en bas à droite (succès / erreur). |
| **Contenu (écran actif)** | **Importer** : sélection de fichiers (batch), options (langue, mode), liste des fichiers en file, bouton lancer import + index. **Documents** : liste des documents du corpus (titre, langue, rôle) + panneau latéral d'édition des métadonnées (champs : titre, langue, doc_role, resource_type, relations inter-docs) + édition en masse + validation. **Actions** : sous-sections transversales accessibles à tout moment (Curation — reciblage, fusion, suppression ; Segmentation ; Alignement ; Qualité / QA ; Audit ; Collisions ; Retarget), formulaires, tables, modals associés. **Exporter** : options (rapport QA, package TEI), sélecteurs de documents, boutons de lancement, log. |
| **Bandeau erreur init** | (Si échec init DB) Message + Réessayer / Choisir un autre / Fermer. |
| **Modals** | **Presets de projet** : liste des presets (nom, chips langues/stratégie), Appliquer / Dupliquer / Supprimer, Nouveau / Importer / Exporter · **Édition preset** : formulaire (nom, langues, pivot, stratégie, etc.). |

> **Note de cadrage** : « Curation » est transversale — accessible depuis l'onglet Actions à n'importe quelle étape, pas un onglet dédié. Les métadonnées de chaque document s’éditent depuis l'onglet Documents (panneau latéral activable).
---

### E. Mode Publier (corps = `#app`)

Rendu directement par le shell (pas un module séparé).

| Zone | Contenu affiché |
|------|------------------|
| **Assistant** | Titre « Assistant de publication » · **barre de progression** (5 segments : DB, Documents, Options, Exporter, Résumé) · **corps d’étape** (contenu variable selon l’étape : confirmation DB, sélection documents, options TEI/QA, choix fichier + lancement job, résumé + chemin ZIP). Boutons Retour / Suivant ou Choisir fichier et lancer, etc. |

---

### F. État de chargement (navigation shell)

Lors d’un changement de mode (ex. clic sur Explorer ou Constituer), le shell remplace temporairement le contenu de `#app` par :

| Zone | Contenu affiché |
|------|------------------|
| **Spinner** | Trois points animés (pulse), centrés verticalement dans la zone sous le header, avec la couleur d’accent du mode. |

---

### Synthèse des doublons / chevauchements

- **DB** : affichée dans le **header shell** (badge + menu) et, selon le mode, dans la **topbar du module** (Explorer : badge + statut sidecar ; Constituer : chemin DB + Ouvrir/Créer). Donc redondance quand on est dans Explorer ou Constituer.
- **Sidecar** : statut dans la **topbar Explorer** (pastille) et dans la **statusbar Explorer** (texte « sidecar ready »). Phase « Connexion au sidecar » affichée comme **box centrée** dans la zone de résultats (voir section 5 du doc).
- **Ouvrir / Créer DB** : proposés dans le **menu DB du shell** et, dans Constituer, dans la **topbar Prep** (Ouvrir…, Créer…). Cohérent pour Constituer (workflow centré DB), redondant si on considère que le shell est la seule entrée pour la DB.

---

## 1. Organisation du header (onglets et zones)

### Structure actuelle

L’en-tête est un seul `flex` horizontal, dans l’ordre suivant :

| Ordre | Élément | Rôle |
|-------|---------|------|
| 1 | **AGRAFES** (brand) | Retour accueil |
| 2 | **Explorer** (⌘1) | Navigation principale |
| 3 | **Constituer** (⌘2) | Navigation principale |
| 4 | **⚙ Presets** | Réglages |
| 5 | **⌨** (raccourcis) | Aide |
| 6 | **ⓘ** (à propos) | Aide |
| 7 | **?** (menu Support) | Aide / technique |
| 8 | **DB : …** + **DB ▾** | Contexte / actions DB |

**Publier** n’est pas dans le header : accessible depuis l’accueil (carte) ou ⌘3.

### Problèmes identifiés

1. **Navigation et utilitaires mélangés**  
   Explorer et Constituer sont de la navigation principale ; Presets, ⌨, ⓘ, ? sont des réglages / aide. Tout est au même niveau visuel (même taille, même style de bouton). On ne distingue pas « où je vais » et « où je règle / j’aide ».

2. **Pas de séparation visuelle**  
   Aucun séparateur, aucun espace plus grand entre « onglets métier » et « outils ». La zone DB à droite est bien isolée par `margin-left: auto` et une bordure, mais la zone centrale reste une liste plate.

3. **Trop d’entrées dans une seule barre**  
   Brand + 2 onglets + 4 contrôles (Presets, ⌨, ⓘ, ?) + zone DB = beaucoup d’éléments. Sur petite fenêtre ou avec une DB au nom long, ça se serre et la hiérarchie en pâtit.

4. **Raccourcis peu visibles**  
   Les badges « ⌘1 », « ⌘2 » sont en petit (0.7rem) et en opacity 0.5. Utiles pour qui connaît, peu lisibles pour qui découvre.

---

## 2. Padding et espacements — constat

Aucune échelle commune. Les valeurs sont en **px** et **rem** mélangés, sans règle du type « 4, 8, 12, 16, 24 ».

### Header

| Élément | Padding / margin / gap | Unité |
|--------|------------------------|-------|
| `#shell-header` | padding 0, gap 0 | — |
| `.shell-brand` | padding 0 **1rem** ; margin-right **0.25rem** | rem |
| `.shell-tab` | padding 0 **1.15rem** | rem |
| `.shell-db-zone` | padding 0 **0.75rem**, gap **0.4rem** | rem |
| `.shell-db-btn` | padding **3px 9px** | px |

On a donc **1rem**, **0.25rem**, **1.15rem**, **0.75rem**, **0.4rem**, **3px**, **9px** : sept valeurs différentes pour une seule barre, sans lien entre elles.

### Cartes d’accueil (Home)

| Élément | Valeur | Remarque |
|--------|--------|----------|
| `.shell-home-wrap` | padding **2rem** | OK cohérent |
| `.shell-card` | padding **2rem 2.5rem** | Vertical ≠ horizontal (32px vs 40px) |
| `.shell-cards` | gap **1.5rem** | — |
| `.shell-card-badge` | padding **2px 8px** | px |

Les cartes ne suivent pas une règle du type « même padding sur les 4 côtés » ou « padding = multiple de X ».

### Menus déroulants et listes

| Élément | Padding |
|--------|--------|
| `.shell-db-menu-item` | **9px 16px** |
| `.shell-support-menu-item` | **0.42rem 1rem** |
| `.shell-mru-heading` | **0.3rem 0.85rem 0.1rem** (top / h / bottom) |
| `.shell-mru-name` | **0.4rem 0.85rem** |

Items de menu : 9px/16px d’un côté, 0.42rem/1rem de l’autre. MRU : encore d’autres valeurs. Donc **incohérence entre menus** (DB vs Support vs MRU) et **mélange px/rem**.

### Modals / panneaux

| Élément | Padding |
|--------|--------|
| `.shell-diag-header` | **1rem 1.25rem 0.75rem** |
| `.shell-diag-body` | **1rem 1.25rem** |
| `.shell-diag-footer` | **0.75rem 1.25rem** |
| `.shell-guide-card` | **1.25rem 1.5rem** |

On voit 1rem, 1.25rem, 0.75rem, 1.5rem : pas d’échelle claire (ex. 8 / 12 / 16 / 24 px).

### Synthèse

- **Pas d’échelle d’espacement** : impossible de résumer en « on utilise 4, 8, 12, 16, 24 ».
- **Mélange px / rem** dans les mêmes zones (header, menus).
- **Valeurs « au feeling »** : 1.15rem, 0.42rem, 0.85rem, 0.75rem donnent une impression de tuning case par case plutôt qu’un système.
- **Asymétries non assumées** : cartes 2rem / 2.5rem, headers de modals 1rem / 1.25rem / 0.75rem — si c’est voulu (ex. plus d’air en horizontal), ce n’est pas documenté ; sinon ça renforce l’impression d’incohérence.

---

## 3. Ce qui peut expliquer un sentiment d’insatisfaction

- **Header** : trop d’éléments au même niveau, navigation et réglages confondus, pas de respiration ni de regroupement.
- **Espacements** : valeurs disparates → impression de bricolage, pas de « grille » claire.
- **Cartes d’accueil** : padding asymétrique, pas de lien évident avec le reste de l’app.
- **Menus** : styles d’items différents d’un menu à l’autre.

Tout ça peut donner l’impression que le design n’est pas pensé comme un système, même si visuellement les couleurs et le style général restent cohérents.

---

## 4. Pistes pour le redesign (alignées avec la discussion)

1. **Échelle d’espacement**  
   Introduire des tokens (ex. `--sp-1` à `--sp-6` en 4px, 8px, 12px, 16px, 24px, 32px) et remplacer progressivement les valeurs en dur dans le shell (header, home, menus, modals).

2. **Header : hiérarchie et regroupement**  
   - Zone 1 : Brand.  
   - Zone 2 : Navigation (Explorer, Constituer) — visuellement marquée (ex. fond léger, ou séparateur).  
   - Zone 3 : Utilitaires groupés (Presets, ⌨, ⓘ, ?) — éventuellement dans un menu « Outils » ou « Aide » pour alléger, ou avec un espace / trait plus marqué.  
   - Zone 4 : DB (inchangée, déjà à droite).  

   Objectif : « Navigation » vs « Réglages / Aide » clairement distincts.

3. **Padding uniforme sur les cartes**  
   Choisir une seule valeur (ex. 1.5rem ou 2rem sur les 4 côtés) ou une règle explicite (ex. vertical = --sp-4, horizontal = --sp-6) et l’appliquer à toutes les cartes d’accueil.

4. **Menus déroulants**  
   Un seul style d’item de menu (padding, taille de police) pour DB, Support, MRU, etc., basé sur les mêmes tokens.

5. **Document de design**  
   Rédiger `docs/DESIGN.md` (principes, palette, **échelle d’espacement**, composants listés) pour figer les choix et éviter de réintroduire des valeurs ad hoc.

---

## 5. Corps de l’app : état du sidecar comme “box” / partie du process

### Ce qui s’affiche aujourd’hui

Quand tu es dans le **shell** et que tu ouvres **Explorer**, le **contenu de `#app`** (le “corps”) est entièrement fourni par le module Concordancier (tauri-app). Il construit, dans l’ordre :

1. **Topbar** (barre complète 48px, fond brand, ombre)  
   Contenu : **« Concordancier »** + **badge DB** + **pastille de statut sidecar** (point vert / orange / rouge).  
   → Même hauteur et même poids visuel qu’une barre d’outils : on a l’impression d’une “première section” ou d’une “étape”.

2. **Toolbar** (recherche, Segment/KWIC, filtres, etc.)

3. **Zone de résultats**  
   - Au démarrage : une **empty-state centrée** du type :  
     **« ⏳ Démarrage… / Connexion au sidecar en cours. »**  
     → C’est une “box” (bloc mis en avant) dans le flux principal, comme si “connexion au sidecar” était une étape du process à part entière.
   - Ensuite : la liste des hits (ou “Sidecar prêt”, etc.).

4. **Statusbar** (en bas)  
   Texte du type : **« DB : … · sidecar ready »** + statut court.

En plus de ça, le **shell** affiche déjà en haut : **DB : &lt;fichier&gt;** et le bouton **DB ▾**.

### Pourquoi ça donne l’impression que le sidecar est “une box” / “fait partie du process”

- **Topbar** : Le statut sidecar (le point) est dans une **barre pleine** (titre + DB + point). Visuellement, c’est une “section” au même niveau que la toolbar et la zone de résultats, pas un petit indicateur discret. Donc le sidecar est traité comme un élément de premier plan.
- **Empty-state au chargement** : Le message “Connexion au sidecar en cours” est rendu comme **contenu principal** (une box centrée dans la zone de résultats), au même endroit où apparaîtront plus tard les hits. Ça ressemble à une “étape 1 : connexion” puis “étape 2 : résultats”, alors que la connexion sidecar est de l’**infrastructure** (un prérequis), pas une étape métier.
- **Redondance** : Le shell montre déjà la DB ; l’Explorer remet une topbar avec badge DB + statut sidecar, puis la statusbar répète “DB + sidecar”. L’état du sidecar est donc affiché à **plusieurs endroits** et prend de la place, ce qui renforce l’idée que “c’est une partie du process”.

En résumé : l’Explorer a été conçu comme **app autonome** (avec sa propre topbar et sa propre statusbar). Une fois intégré dans le shell, cette “chrome” se superpose à celle du shell et donne au sidecar un rôle **visible et central** (barre dédiée + box de chargement), alors que conceptuellement c’est un détail d’infrastructure.

### Pistes pour clarifier

- **Traiter le sidecar comme infrastructure** : un petit indicateur (point ou libellé court) dans un coin ou dans la statusbar, sans barre dédiée.
- **Quand l’app tourne dans le shell** : ne pas dupliquer la topbar (titre “Concordancier” + DB + point), ou la réduire à une ligne minimale ; laisser le shell gérer DB et, si besoin, un seul indicateur sidecar discret.
- **Phase “Connexion au sidecar”** : au lieu d’une box centrée dans la zone de résultats, afficher par exemple un **spinner ou un message discret** en haut de la zone (ou dans la statusbar), et garder la zone de résultats “vide” ou avec un message neutre (“Chargement…”), pour ne pas donner l’impression d’une “étape” métier.

---

## 6. Scroll et disposition — voir le bas de l’app sans multiplier les scrollbars

### Constat

Tu indiques qu’il n’y a pas (ou pas assez) de scrollbar, donc le bas de l’app et certaines box sont invisibles. L’objectif est de **réduire le besoin de scroll** et, quand il faut scroller, d’avoir **une zone de scroll claire** plutôt que plusieurs barres imbriquées ou une page qui ne défile pas comme prévu.

### Comportement actuel par zone

| Contexte | Rôle de `#app` / contenu | Où scrolle-t-on ? |
|----------|---------------------------|--------------------|
| **Shell (index)** | `#app` : `padding-top: 44px`, `min-height: 100vh`, pas de `overflow`. | En théorie : **fenêtre (body)** si le contenu dépasse. |
| **Explorer (module)** | Le Concordancier injecte `#app { height: 100vh; overflow: hidden; }` + flex (topbar, toolbar, results-area `flex: 1; overflow-y: auto`, statusbar). | **Une seule** zone de scroll : **.results-area** (liste des hits). Le reste (topbar, toolbar, statusbar) est en `flex-shrink: 0`. |
| **Home** | Contenu (titre, cartes, démo, guide) dans `.shell-home-wrap` avec `min-height: calc(100vh - 44px)` et `padding: 2rem`. | Scroll **fenêtre** si le contenu dépasse. Aucun `overflow` explicite sur `#app` en mode Home. |
| **Constituer (Prep)** | Topbar + tabbar + JobCenter + zone `.content` (écrans). Pas de `height` fixe sur `#app`. | Scroll **fenêtre** : la page s’allonge, le body défile. |
| **Publier** | Assistant dans un wrapper avec `max-width: 700px`, pas de contrainte de hauteur. | Scroll **fenêtre** si l’assistant est long. |

### Pourquoi le bas peut être coupé ou peu visible

1. **Scroll fenêtre peu visible**  
   En Home / Constituer / Publier, c’est le **document (body)** qui défile. Sur certains OS ou thèmes, la scrollbar est fine, en overlay, ou masquée. On peut ne pas réaliser qu’il faut scroller la fenêtre.

2. **Explorer : hauteur et flex**  
   `#app` est en `height: 100vh` alors qu’il est **sous** le header fixe 44px. La zone utile sous le header fait en réalité **100vh - 44px**. Si le calcul n’est pas explicite (ex. `#app` en `height: calc(100vh - 44px)` ou équivalent), ou si un élément flex n’a pas `min-height: 0`, la zone scrollable peut ne pas recevoir la bonne hauteur et le bas (ex. statusbar) peut être poussé hors écran.

3. **Trop de contenu empilé**  
   Home (cartes + démo + guide) ou Constituer (écrans très longs, ex. Actions) génèrent beaucoup de hauteur. Une seule grande zone qui scroll peut donner l’impression qu’il “n’y a pas de scrollbar” si elle est peu visible, ou qu’il faut beaucoup scroller.

4. **Plusieurs zones scrollables**  
   Si à l’avenir on ajoute des panneaux ou modals avec leur propre `overflow-y: auto`, on se retrouve avec plusieurs scrollbars (fenêtre + zone centrale + panneau). Ça complique la lecture et l’usage.

### Principes pour de meilleures dispositions

- **Quand il y a scroll : une zone claire et prévisible**  
  Pas besoin d’une “zone de scroll principale” en permanence — seulement **quand le contenu dépasse la vue**. Dans ce cas : soit la **fenêtre** scroll (tout le contenu dans le flux), soit **une zone dédiée** (ex. liste de résultats) a `overflow-y: auto` et une hauteur contrainte, le reste (header, barres) restant fixe. L’idée est d’éviter plusieurs scrollbars imbriquées ou une scrollbar “invisible”, pas d’imposer un scroll partout.

- **Chrome toujours visible**  
  Header shell (44px) + barres de module (topbar, toolbar, tabbar, statusbar) ne doivent pas sortir de la vue : soit en fixe, soit en haut/bas d’un conteneur dont seule la zone centrale scroll **si besoin**.

- **Hauteur explicite sous le header (quand layout fixe)**  
  Pour les vues en “layout fixe” (ex. Explorer avec zone de résultats scrollable), le conteneur principal devrait avoir une hauteur explicite (ex. `calc(100vh - 44px)`) pour que la zone scrollable reçoive la bonne part. La zone qui scroll doit avoir `min-height: 0` pour que le flex affiche correctement la scrollbar. Inutile d’appliquer ça partout si la vue scroll en entier (ex. Home court).

- **Réduire la hauteur à scroller quand c’est possible**  
  - **Home** : cartes plus compactes, guide repliable ou en accordéon, pour limiter la longueur de la page.  
  - **Constituer** : écrans très longs découpés en sections repliables ou sous-onglets.  
  - **Publier** : étapes déjà en wizard ; garder chaque étape courte.

- **Rendre le scroll visible quand il existe**  
  Si une zone ou la fenêtre doit scroller, s’assurer que le conteneur concerné a `overflow-y: auto` (et si besoin une hauteur max) pour que la scrollbar soit bien attachée au contenu et visible, au lieu de dépendre du seul scroll du body (souvent peu visible).

### Contrainte importante

**Aucune modification concrète du code (layout, scroll, disposition) sans présentation visuelle préalable.** Les pistes ci‑dessous restent des options à valider via mockup, wireframe ou maquette avant toute implémentation.

### Pistes concrètes (à prioriser après validation visuelle)

1. **Shell**  
   - En mode Home / Constituer / Publier : donner à `#app` une **hauteur max** = `calc(100vh - 44px)` et `overflow-y: auto`, pour que la scrollbar soit sur `#app` (sous le header fixe) et que le bas du contenu soit atteignable sans ambiguïté.  
   - Ne pas appliquer cette règle en mode Explorer si le module gère lui-même son layout (pour éviter deux scrollbars).

2. **Explorer**  
   - S’assurer que le conteneur principal (celui qui a la flex column) a une hauteur **calc(100vh - 44px)** plutôt que 100vh, pour que tout tienne sous le header.  
   - Donner à la zone qui a `flex: 1` et `overflow-y: auto` un **min-height: 0** pour que le flex la réduise correctement et affiche la scrollbar.

3. **Home**  
   - Disposition plus compacte : cartes en ligne plus serrée ou en grille sur une seule “ligne” visible, démo + guide en dessous avec possibilité de replier le guide.  
   - Ou garder le scroll mais avec la règle ci‑dessus (scroll sur `#app`) pour que la barre soit visible.

4. **Constituer**  
   - Écrans longs (ex. Actions) : regrouper en **sections repliables** (accordéons) ou en **sous-onglets** pour limiter la hauteur visible et éviter une seule énorme page.  
   - Même idée : scroll explicite sur la zone de contenu (`.content`) avec une hauteur max si besoin, pour une scrollbar claire.

5. **Modals / panneaux**  
   - Garder une seule zone scrollable par modal (ex. le corps du modal avec `overflow-y: auto` et `max-height`), pas de scroll sur le body en même temps si possible (focus dans le modal).

En résumé : **une zone de scroll claire par vue**, **chrome (header, barres) toujours visible**, **hauteurs explicites sous le header**, et **moins de contenu empilé** (repliable, onglets, wizard) pour limiter le besoin de scroll et rendre le bas de l’app et des box toujours accessibles.

---

## 7. Prochaine étape suggérée

- Valider (ou ajuster) cette analyse avec toi.  
- **Layout / scroll / disposition** : aucune modification de code sans **présentation visuelle** (mockup, wireframe ou maquette) validée avant.  
- Ensuite, au choix :  
  - rédiger **DESIGN.md** (principes, tokens, règles header),  
  - ou produire une **présentation visuelle** pour les dispositions (scroll, Home, Explorer, Constituer), puis seulement implémenter.

Tu peux dire sur quoi tu veux qu’on enchaîne en premier : document DESIGN.md, visuels pour les dispositions, ou tokens seuls.
