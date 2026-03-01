// NOTE: This standalone app is being superseded by tauri-shell/ which embeds
// both Concordancier and Prep in a single unified shell. See docs/STATUS_TAURI_SHELL.md
import { App } from "./app.ts";

const app = new App();
app.init().catch(console.error);
