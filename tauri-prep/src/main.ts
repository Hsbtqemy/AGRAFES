// NOTE: This standalone app is being superseded by tauri-shell/ which embeds
// both Concordancier and Prep in a single unified shell. See docs/STATUS_TAURI_SHELL.md

// CSS architecture — all styles are proper Vite-managed CSS files (P6).
// The sidebar + curation workspace CSS was previously duplicated in the JS
// CSS constant in app.ts (now removed).
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/components.css";
import "./ui/prep-vnext.css";
import "./ui/app.css";
import "./ui/job-center.css";

import { App } from "./app.ts";

const app = new App();
app.init().catch(console.error);
