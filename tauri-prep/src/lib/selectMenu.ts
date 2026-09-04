/**
 * selectMenu.ts — un menu déroulant qui s'ouvre toujours vers le bas.
 *
 * ## Le défaut
 *
 * La liste d'un `<select>` natif n'est pas du DOM : c'est une fenêtre du système. Aucune
 * feuille de style ne l'atteint, et Chromium la **bascule au-dessus du déclencheur** quand
 * il juge la place insuffisante en dessous. « Insuffisante » se mesure sur l'écran, pas sur
 * la fenêtre : le même menu s'ouvre donc vers le bas sur un écran et vers le haut sur un
 * autre. Mesuré le 4 septembre 2026 sur les deux écrans de la machine de développement —
 * 1920×1032 de zone de travail contre 1536×816 — avec les 20 familles du corpus, dont la
 * liste réclame ~500px : sur l'écran court, dès que la fenêtre n'est pas collée en haut,
 * il ne reste pas 500px sous le sélecteur et la liste se retourne.
 *
 * C'est exactement ce que `shared/anchorMenu.ts` refuse depuis l'audit du 21 août 2026 :
 * « le parti pris est de glisser, pas de basculer de l'autre côté du déclencheur ; un menu
 * qui saute au-dessus du bouton change de place d'une ouverture à l'autre, ce qui se paie
 * en repérage ». Un `<select>` natif ne sait pas suivre cette règle.
 *
 * ## Le parti pris : le `<select>` reste le modèle
 *
 * On ne remplace pas le contrôle, on l'habille. Le `<select>` d'origine reste dans le DOM,
 * masqué : il continue de porter `value`, d'émettre `change`, et de contenir ses `<option>`.
 * Tout le code appelant — et les tests, qui interrogent `sel.value` et
 * `option[value="…"]` — fonctionne sans changer d'une ligne. Le menu visible n'est qu'une
 * vue : il écrit dans le `<select>` puis laisse l'événement partir normalement.
 *
 * C'est aussi ce qui rend la conversion des dix autres sélecteurs de listes peu coûteuse.
 *
 * ## Ce qu'on observe plutôt que d'exiger
 *
 * Le `<select>` est manipulé de partout : on lui reconstruit ses options, on le désactive
 * pendant un run d'alignement (discipline F5 : geler les sélecteurs tant que le run vole).
 * Exiger un appel après chaque geste, c'est se garantir qu'un site sera oublié — et le
 * menu mentirait alors sur l'état réel. D'où un `MutationObserver` sur les options et sur
 * `disabled` : ces deux-là se corrigent seuls.
 *
 * `value`, en revanche, est une **propriété** : l'écrire ne produit aucune mutation, et
 * rien ne peut l'observer. Les rares sites qui la posent par programme doivent appeler
 * `sync()`. Ils sont deux dans la matrice, et le nom du défaut est explicite si on oublie :
 * le déclencheur affiche l'entrée précédente.
 *
 * ## La frappe au clavier : une lettre à la fois
 *
 * Un appui parcourt les entrées qui commencent par cette lettre, et boucle. Pas de mot
 * accumulé : c'est la troisième règle essayée, et les deux premières ont chacune produit
 * une surprise à l'usage — le détail est sur `versFrappe`, avec ce qui les a tuées.
 *
 * La comparaison retire un identifiant en tête de libellé (« #368 Houellebecq… »). Les
 * listes de prep n'en composent plus depuis le 4 septembre 2026 — il n'était affiché que
 * par la moitié d'entre elles et ne désambiguïsait rien — mais le filet reste, pour un
 * libellé qui en porterait un ailleurs : sans lui, « h » ne mène pas à Houellebecq, et il
 * faudrait taper « #368 », c'est-à-dire connaître déjà la réponse.
 */
import { clampAnchoredMenu } from "../../../shared/anchorMenu.ts";

export interface SelectMenuOptions {
  /** Nom accessible de la liste. À défaut, celui que porte déjà le `<select>`. */
  label?: string;
  /**
   * Classe posée sur l'enveloppe, pour lui donner une largeur.
   *
   * Elle est nécessaire, et la mesure le dit : un `<select>` natif se dimensionne sur son
   * option la **plus large**, le déclencheur qui le remplace sur l'entrée **choisie**. Une
   * liste de documents mesurait ainsi 138px sur « Modiano-Rue_ES » et 249px sur le plus long
   * titre du corpus, là où le contrôle natif ne bougeait pas. Le style de largeur que portait
   * le `<select>` reste sur lui, masqué : il ne se transporte pas tout seul.
   */
  className?: string;
}

export interface SelectMenu {
  /**
   * Relit le `<select>` et repeint le déclencheur.
   *
   * Nécessaire uniquement après avoir posé `sel.value` par programme : les options et
   * `disabled` sont suivis tout seuls.
   */
  sync(): void;
  /** Rend le `<select>` à son état d'origine et débranche tout. */
  destroy(): void;
}

/**
 * Le texte sur lequel la frappe compare : sans le préfixe d'identifiant, sans accents,
 * en minuscules. « #368 Houellebecq-Plateforme_FR.docx (2 docs) » → « houellebecq-… ».
 */
function pourFrappe(texte: string): string {
  return texte
    .replace(/^#\d+\s*/, "")
    .normalize("NFD")
    // Les marques combinantes, en points de code : écrites en clair, ce sont des caractères
    // invisibles dans le fichier, que le premier éditeur venu peut avaler sans un mot.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Un `<select>` n'a qu'un habillage : la carte le garantit à travers les re-rendus. */
const _poignees = new WeakMap<HTMLSelectElement, SelectMenu>();

/**
 * Habille un `<select>` d'un menu qui s'ouvre vers le bas, se borne et défile.
 *
 * Idempotent : rappeler la fonction sur un `<select>` déjà habillé renvoie la même poignée
 * plutôt que d'empiler deux menus — un écran qui se re-rend ne doit pas en fabriquer deux.
 */
export function enhanceSelect(sel: HTMLSelectElement, opts: SelectMenuOptions = {}): SelectMenu {
  const dejaLa = _poignees.get(sel);
  if (dejaLa) return dejaLa;

  const doc = sel.ownerDocument;
  const enveloppe = doc.createElement("div");
  enveloppe.className = "prep-selmenu";
  if (opts.className) enveloppe.classList.add(...opts.className.split(/\s+/).filter(Boolean));

  const declencheur = doc.createElement("button");
  declencheur.type = "button";
  declencheur.className = "prep-selmenu-trigger";
  declencheur.setAttribute("aria-haspopup", "listbox");
  declencheur.setAttribute("aria-expanded", "false");
  const etiquette = opts.label ?? sel.getAttribute("aria-label");
  if (etiquette) declencheur.setAttribute("aria-label", etiquette);

  const texteEl = doc.createElement("span");
  texteEl.className = "prep-selmenu-text";
  const caret = doc.createElement("span");
  caret.className = "prep-selmenu-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  declencheur.appendChild(texteEl);
  declencheur.appendChild(caret);

  const liste = doc.createElement("div");
  liste.className = "prep-selmenu-list";
  liste.setAttribute("role", "listbox");
  if (etiquette) liste.setAttribute("aria-label", etiquette);
  liste.hidden = true;

  // Le `<select>` prend la place de son habillage, puis rentre dedans : l'ordre du DOM
  // autour de lui ne change pas, ce qui compte dans une barre en flex.
  sel.parentNode?.insertBefore(enveloppe, sel);
  enveloppe.appendChild(declencheur);
  enveloppe.appendChild(liste);
  enveloppe.appendChild(sel);
  sel.classList.add("prep-selmenu-native");
  sel.setAttribute("aria-hidden", "true");
  sel.tabIndex = -1;

  let ouvert = false;

  const optionsDu = (): HTMLOptionElement[] => Array.from(sel.options);
  const boutons = (): HTMLButtonElement[] =>
    Array.from(liste.querySelectorAll<HTMLButtonElement>(".prep-selmenu-opt"));

  function peindre(): void {
    const choisie = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    const texte = choisie?.textContent ?? "";
    texteEl.textContent = texte;
    // Une option vide (« — choisir — ») est une invite, pas une valeur : elle se lit en
    // atténué, comme le « (aucune) » du déclencheur de base du shell.
    texteEl.classList.toggle("prep-selmenu-text--vide", choisie?.value === "");
    declencheur.disabled = sel.disabled;
    declencheur.title = texte;
  }

  function reconstruire(): void {
    liste.textContent = "";
    for (const o of optionsDu()) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "prep-selmenu-opt";
      b.setAttribute("role", "option");
      b.dataset.value = o.value;
      b.textContent = o.textContent ?? "";
      const active = o.value === sel.value;
      b.setAttribute("aria-selected", String(active));
      if (active) b.classList.add("prep-selmenu-opt--active");
      if (o.value === "") b.classList.add("prep-selmenu-opt--vide");
      if (o.disabled) b.disabled = true;
      b.addEventListener("click", () => choisir(o.value));
      liste.appendChild(b);
    }
    peindre();
  }

  function choisir(valeur: string): void {
    fermer();
    if (sel.value === valeur) return;
    sel.value = valeur;
    peindre();
    // L'événement part du `<select>`, pas du menu : pour tout le reste de l'application,
    // rien ne distingue ce choix d'un choix natif.
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function ouvrir(): void {
    if (ouvert || sel.disabled) return;
    reconstruire();
    liste.hidden = false;
    ouvert = true;
    declencheur.setAttribute("aria-expanded", "true");
    // Après l'affichage, sinon la boîte se mesure à zéro. Glisse et borne — jamais bascule.
    clampAnchoredMenu(liste);
    const actif = liste.querySelector<HTMLButtonElement>(".prep-selmenu-opt--active")
      ?? boutons()[0];
    actif?.focus();
    doc.addEventListener("mousedown", surClicExterieur, true);
  }

  function fermer(): void {
    if (!ouvert) return;
    liste.hidden = true;
    ouvert = false;
    declencheur.setAttribute("aria-expanded", "false");
    doc.removeEventListener("mousedown", surClicExterieur, true);
  }

  const surClicExterieur = (e: Event): void => {
    if (!enveloppe.contains(e.target as Node)) fermer();
  };

  /**
   * Un appui = une lettre. On parcourt les entrées qui commencent par elle, et on boucle.
   *
   * Deux versions plus savantes ont été essayées le 4 septembre 2026, et toutes deux ont
   * produit une surprise à l'usage. La première accumulait les frappes : « h » puis « m »
   * cherchait « hm », ne trouvait rien, et ne faisait RIEN — l'appui semblait perdu. La
   * seconde recommençait à la dernière lettre quand le mot ne correspondait plus, mais le
   * repli par sous-chaîne la trahissait : « ll » n'ouvre aucun libellé, or il est contenu
   * dans « Houellebecq ». Taper « h », « l », « l » ramenait donc dans les H, et l'on
   * alternait entre deux entrées sans pouvoir avancer.
   *
   * Le mono-lettre supprime la classe entière de ces défauts, et avec elle tout l'état :
   * plus de tampon, plus de fenêtre de 700 ms, plus de repli par sous-chaîne. Le prix est
   * connu et mesuré : sur les 58 documents du corpus de travail, le plus gros groupe
   * d'initiales en compte neuf, qui demandent neuf appuis — les flèches y vont plus vite.
   * Les listes de familles, elles, plafonnent à trois.
   */
  function versFrappe(e: KeyboardEvent): boolean {
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return false;
    const cible = pourFrappe(e.key);
    const candidats = boutons()
      .filter((b) => pourFrappe(b.textContent ?? "").startsWith(cible));
    if (candidats.length === 0) return true;
    // `indexOf` rend -1 quand le focus n'est pas sur une entrée de ce groupe : le tour
    // suivant est alors la première, ce qui est exactement le premier appui.
    const rang = candidats.indexOf(doc.activeElement as HTMLButtonElement);
    candidats[(rang + 1) % candidats.length].focus();
    return true;
  }

  declencheur.addEventListener("click", () => (ouvert ? fermer() : ouvrir()));
  declencheur.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ouvrir();
    }
  });

  liste.addEventListener("keydown", (e) => {
    const bs = boutons();
    const i = bs.indexOf(doc.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      bs[Math.min(i + 1, bs.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      bs[Math.max(i - 1, 0)]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      bs[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      bs[bs.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      fermer();
      declencheur.focus();
    } else if (e.key === "Tab") {
      // Sortir du menu au clavier le referme : le laisser ouvert derrière le focus est la
      // façon la plus sûre de cliquer plus tard dans une liste qui ne décrit plus rien.
      fermer();
    } else if (versFrappe(e)) {
      e.preventDefault();
    }
  });

  // Options reconstruites, ou `disabled` posé ailleurs : le menu se corrige seul plutôt
  // que d'exiger un appel de chaque site (il y en a six rien que pour la matrice).
  const observateur = new MutationObserver(() => {
    if (ouvert) reconstruire();
    else peindre();
  });
  observateur.observe(sel, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["disabled"] });

  reconstruire();

  const poignee: SelectMenu = {
    sync: () => (ouvert ? reconstruire() : peindre()),
    destroy: () => {
      observateur.disconnect();
      doc.removeEventListener("mousedown", surClicExterieur, true);
      sel.classList.remove("prep-selmenu-native");
      sel.removeAttribute("aria-hidden");
      sel.tabIndex = 0;
      enveloppe.parentNode?.insertBefore(sel, enveloppe);
      enveloppe.remove();
      _poignees.delete(sel);
    },
  };
  _poignees.set(sel, poignee);
  return poignee;
}

