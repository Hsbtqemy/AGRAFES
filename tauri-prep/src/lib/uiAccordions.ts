/**
 * uiAccordions.ts
 *
 * Shared collapsible card behavior used across Prep screens.
 */

let _accordionSeq = 0;

export function initCardAccordions(root: HTMLElement): void {
  const sections = Array.from(
    root.querySelectorAll<HTMLElement>("section.card[data-collapsible='true']"),
  );

  for (const section of sections) {
    const heading = section.querySelector<HTMLElement>(":scope > h3");
    if (!heading) continue;
    if (heading.querySelector(".acc-toggle")) continue;

    const body = document.createElement("div");
    body.className = "acc-body";
    const bodyId = `acc-body-${++_accordionSeq}`;
    body.id = bodyId;
    let node = heading.nextSibling;
    while (node) {
      const next = node.nextSibling;
      body.appendChild(node);
      node = next;
    }
    section.appendChild(body);

    heading.classList.add("acc-head");
    heading.tabIndex = 0;
    heading.setAttribute("role", "button");
    heading.setAttribute("aria-controls", bodyId);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "acc-toggle";
    toggle.setAttribute("aria-label", "Ouvrir ou fermer");
    toggle.innerHTML = `<span class="acc-caret">▾</span>`;
    heading.appendChild(toggle);

    const applyState = (collapsed: boolean) => {
      section.classList.toggle("is-collapsed", collapsed);
      heading.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-expanded", String(!collapsed));
      body.setAttribute("aria-hidden", String(collapsed));
    };

    const initialCollapsed = section.dataset.collapsedDefault === "true";
    applyState(initialCollapsed);

    const toggleCollapsed = (): void => applyState(!section.classList.contains("is-collapsed"));

    heading.addEventListener("click", (evt) => {
      if ((evt.target as HTMLElement).closest(".acc-toggle")) return;
      toggleCollapsed();
    });
    heading.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      toggleCollapsed();
    });
    toggle.addEventListener("click", (evt) => {
      evt.stopPropagation();
      toggleCollapsed();
    });
  }
}
