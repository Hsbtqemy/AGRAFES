// Design-system CSS (Prep) — imported EAGERLY at the shell entry so the entire
// shell (home, chrome, Explorer, Constituer) is styled from first paint. These
// previously lived only in constituerModule.ts, which is lazily imported, so the
// home screen rendered unstyled until the user first opened Constituer (0.3.1).
import "../../tauri-prep/src/ui/tokens.css";
import "../../tauri-prep/src/ui/base.css";
import "../../tauri-prep/src/ui/components.css";
import "../../tauri-prep/src/ui/prep-vnext.css";
import "../../tauri-prep/src/ui/app.css";
import "../../tauri-prep/src/ui/job-center.css";

import { initShell } from "./shell.ts";

initShell().catch(console.error);
