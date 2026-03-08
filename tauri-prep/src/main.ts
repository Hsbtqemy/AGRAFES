// NOTE: This standalone app is being superseded by tauri-shell/ which embeds
// both Concordancier and Prep in a single unified shell. See docs/STATUS_TAURI_SHELL.md

// vNext CSS architecture — loaded here for the standalone build.
// The sidebar + curation workspace CSS is also added to the JS CSS constant in
// app.ts so it remains available when embedded in tauri-shell via constituerModule.
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/components.css";
import "./ui/prep-vnext.css";

import { App } from "./app.ts";

const app = new App();
app.init().catch(console.error);
