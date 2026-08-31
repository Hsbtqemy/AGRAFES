---
passe: Sonde — geste de retour
chantier: NAV-01
duree: 10 min
derniere: 2026-08-31
---

# Sonde — ce que le bouton latéral et le pad émettent vraiment

Cette passe n'est pas une vérification, c'est une **mesure**. Elle tranche le lot 0 de
NAV-01 : le retour en arrière peut-il se capter en JavaScript seul, ou faut-il rallumer le
geste natif en Rust ? Le webview laisse `back_forward_navigation_gestures` à `false` et
Tauri ne l'expose pas, mais ça ne dit rien du **bouton de souris**, qui emprunte un autre
chemin. Personne ne l'a mesuré ; il faut appuyer dessus pour savoir.

**Lancer.** Depuis la racine : `npm --prefix tauri-shell run tauri -- dev`. Le premier
démarrage est lent (le sidecar est un binaire *onefile*, il se déplie avant de répondre).
Puis clic droit dans la fenêtre → *Inspecter*, onglet *Console*. Le bouton de l'inspecteur
existe aussi dans le panneau Diagnostic.

**Installer la sonde.** Coller ce bloc dans la console, en une fois :

```js
(() => {
  const KEY = "agrafes.sonde.nav";
  if (window.__sondeNav) { console.log("[sonde] déjà installée — window.__sondeNav.stop() pour la retirer"); return; }
  const prev = sessionStorage.getItem(KEY);
  if (prev) console.log("[sonde] journal d'avant le rechargement de la page :\n" + prev);

  const t0 = performance.now();
  const lines = [];
  let vue0 = false;
  const rec = (kind, detail) => {
    const l = String(Math.round(performance.now() - t0)).padStart(6) + " ms  " + kind.padEnd(13) + " " + detail;
    lines.push(l);
    try { sessionStorage.setItem(KEY, lines.join("\n")); } catch (e) { /* */ }
    console.log("[sonde] " + l);
  };

  for (let i = 1; i <= 3; i++) history.pushState({ sonde: i }, "");
  rec("init", "3 entrées poussées · history.length=" + history.length + " · état=" + JSON.stringify(history.state));

  const api = {
    block: false,
    dump: () => console.log("[sonde] journal complet :\n" + lines.join("\n")),
    stop: null,
  };

  const onBtn = (e) => {
    if (e.button === 0) {
      if (vue0) return;
      vue0 = true;
      rec(e.type, "button=0 (clic gauche) — la sonde reçoit bien les événements souris");
      return;
    }
    rec(e.type, "button=" + e.button + " buttons=" + e.buttons +
        (e.pointerType ? " pointerType=" + e.pointerType : "") +
        " defaultPrevented=" + e.defaultPrevented);
    if (api.block && (e.button === 3 || e.button === 4)) {
      e.preventDefault();
      rec("-> bloqué", "preventDefault() appelé sur " + e.type);
    }
  };
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0.5) {
      rec("wheel", "deltaX=" + e.deltaX.toFixed(1) + " deltaY=" + e.deltaY.toFixed(1));
    }
  };
  const onPop = (e) => rec("popstate", "state=" + JSON.stringify(e.state) + " · history.length=" + history.length);
  const onUnload = () => rec("beforeunload", "LA PAGE PART — le webview a quitté le document");

  const types = ["pointerdown", "mousedown", "mouseup", "auxclick", "click"];
  types.forEach((t) => window.addEventListener(t, onBtn, true));
  window.addEventListener("wheel", onWheel, { capture: true, passive: true });
  window.addEventListener("popstate", onPop);
  window.addEventListener("beforeunload", onUnload);

  api.stop = () => {
    types.forEach((t) => window.removeEventListener(t, onBtn, true));
    window.removeEventListener("wheel", onWheel, true);
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("beforeunload", onUnload);
    delete window.__sondeNav;
    api.dump();
    try { sessionStorage.removeItem(KEY); } catch (e) { /* */ }
    console.log("[sonde] retirée.");
  };

  window.__sondeNav = api;
  console.log("[sonde] installée. Fais les gestes, puis window.__sondeNav.dump().");
})();
```

Elle pousse trois entrées d'historique avant de commencer, pour que les premiers appuis
aient de quoi remonter. Le geste est sans risque : rien dans l'application n'écoute
`popstate` aujourd'hui, et l'application est elle-même la première entrée de l'historique
— on ne peut donc pas la quitter par en dessous. Si la page se rechargeait malgré tout, le
journal est réécrit dans `sessionStorage` à chaque ligne et la sonde le réaffiche à la
réinstallation.

**Les gestes à faire**, dans cet ordre : un clic gauche (il prouve que la sonde entend),
puis trois appuis sur le bouton latéral « précédent » de la souris, puis un glissé deux
doigts horizontal sur le pad. `window.__sondeNav.dump()` réaffiche tout,
`window.__sondeNav.stop()` retire la sonde.

**Mesurer le blocage.** La zone du même nom demande un verdict binaire : `preventDefault()`
supprime-t-il la navigation native ? Le lire à l'œil dans le journal est ambigu — il faut
repérer une absence. Ce second bloc l'affiche en toutes lettres. Le coller, puis cliquer
dans la fenêtre de l'application et appuyer **une seule fois** sur le bouton latéral ; il se
désarme tout seul.

Il guette `pointerdown` et non `mousedown`, et ce n'est pas indifférent : dès que la sonde
annule le `pointerdown`, les événements souris de compatibilité (`mousedown`, `mouseup`)
cessent d'être émis — c'est le comportement spécifié des Pointer Events, mesuré ici le
31 août. Un bloc qui guetterait `mousedown` ne se déclencherait donc jamais, et laisserait le
blocage armé derrière lui.

```js
(() => {
  const s = window.__sondeNav;
  if (!s) { console.log("[test] sonde absente — recoller le premier bloc"); return; }
  s.block = true;
  let pop = false;
  const onPop = () => { pop = true; };
  const once = (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    window.removeEventListener("pointerdown", once, true);
    setTimeout(() => {
      window.removeEventListener("popstate", onPop);
      s.block = false;
      console.log(pop
        ? "[test] VERDICT — preventDefault() NE bloque PAS : la navigation a eu lieu malgré lui"
        : "[test] VERDICT — preventDefault() BLOQUE : aucun popstate après l'appui");
    }, 400);
  };
  window.addEventListener("popstate", onPop);
  window.addEventListener("pointerdown", once, true);
  console.log("[test] blocage armé — clique dans la fenêtre, puis UN appui sur le bouton latéral");
})();
```

**Comment lire le résultat.** Les cases cochées se combinent en une décision :

| Ce qui apparaît | Ce que ça décide |
|---|---|
| Un événement DOM `button=3` **et** un `popstate` derrière | Le webview navigue déjà seul : la pile du lot 1 suffit, rien à capter — **0 j** *(c'est le cas mesuré le 31 août)* |
| Un événement DOM mais aucun `popstate` | Le bouton n'est pas câblé à l'historique : capture JS — **0,5 j** |
| Ni l'un ni l'autre | Le bouton est avalé par WebView2 : échappatoire Rust — **1 à 1,5 j** |
| `wheel` seul au glissé | Le geste du pad est bien éteint côté natif, comme les sources l'annonçaient — le rallumer coûte un appel COM, **0,5 j** *(cas mesuré)* |

Le résultat de cette passe se commite : c'est lui qui fige le chiffrage de NAV-01. Passée le
31 août, elle l'a fait tomber de 2,5-3,5 j à **2-3 j** pour la souris, en supprimant un lot
entier — et elle a déplacé le geste du pad d'un détecteur JS vers un appel COM.

Les cases ci-dessous n'enregistrent que **ce qui a été observé**. Les résultats contraires
— le bouton muet, le pad qui navigue — vivent dans la table ci-dessus et non en cases
vides : pour l'outil, une case vide est une chose à faire, et une case jamais cochable
laisserait la passe « en vol » indéfiniment.

### Bouton latéral « précédent » de la souris

- [x] La sonde entend la souris : une ligne `button=0 (clic gauche)` apparaît au premier clic
- [x] Le bouton latéral émet un événement DOM : au moins une ligne `button=3` ou `button=4` apparaît
- [x] Le bouton latéral remonte l'historique : une ligne `popstate` apparaît, avec un `sonde` qui décroît

### Pad — glissé deux doigts horizontal

- [x] Le glissé n'émet que des lignes `wheel` avec un `deltaX` non nul, sans aucun `popstate`

### Blocage — à ne faire que si le bouton a émis un événement DOM

- [x] Après `window.__sondeNav.block = true`, un appui affiche la ligne `-> bloqué`
- [x] Ce même appui n'est suivi d'aucun `popstate` : `preventDefault()` a bien supprimé la navigation native

### Après la sonde

- [x] `window.__sondeNav.stop()` a répondu et affiché le journal complet
- [x] L'application réagit normalement après le retrait : changer de mode, ouvrir un document
