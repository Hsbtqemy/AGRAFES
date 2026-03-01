import { initApp } from "./app";

const container = document.getElementById("app");
if (!container) throw new Error("#app element not found");

initApp(container).catch((err: unknown) => {
  console.error("initApp error:", err);
  container.innerHTML = `<div style="padding:32px;color:#e63946;font-family:system-ui">
    <h2>Erreur de démarrage</h2>
    <pre style="font-size:12px;white-space:pre-wrap">${String(err)}</pre>
  </div>`;
});
