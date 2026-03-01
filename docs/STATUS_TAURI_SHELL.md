# Status: AGRAFES Shell (tauri-shell/)

**Current version:** V0.2 (2026-03-01)

## What it is

`tauri-shell/` is the unified Tauri 2.0 app that replaces the two standalone apps
(`tauri-app/` and `tauri-prep/`). It hosts both modules in a single process with
a home screen, a permanent header with mode tabs, DB state management, and proper
lifecycle management via module wrappers.

## Architecture

- **Router**: state-based (`Mode = "home" | "explorer" | "constituer"`), no library
- **Header**: fixed 44px bar with brand (AGRAFES) + two tabs (Explorer, Constituer) + DB zone
- **Accent system**: `body[data-mode]` + CSS custom properties (`--accent`, `--accent-header-bg`)
  - `home` → dark neutral header (#1a1a2e)
  - `explorer` → blue (#1e4a80 header / #2c5f9e accent)
  - `constituer` → teal-green (#145a38 header / #1a7f4e accent)
- **DB state (V0.2)**:
  - Single source of truth: `_currentDbPath` in `shell.ts`
  - Header badge: "DB: \<basename\>" or "DB: (aucune)"
  - "Changer…" button → Tauri file dialog (filters: .db/.sqlite/.sqlite3)
  - On change: updates badge, notifies `_dbListeners`, re-mounts active module, shows toast
- **Persistence (V0.2)**:
  - `localStorage["agrafes.lastMode"]` + `localStorage["agrafes.lastDbPath"]`
  - Restored at boot; persisted on every mode/DB change
  - "Retour accueil" (brand click) resets view only — DB persists
- **Deep-link boot (V0.2)**:
  - `location.hash` (`#explorer`, `#constituer`, `#home`) or `?mode=` query param
  - Overrides `lastMode` if present at boot
- **Module wrappers (V0.2)**:
  - `src/modules/explorerModule.ts` and `constituerModule.ts`
  - Each exposes `mount(container, ctx)` and `dispose()`
  - `ShellContext` (defined in `src/context.ts`) provides `getDbPath()` and `onDbChange()`
  - DB path injected via `setCurrentDbPath()` before module init
- **Lifecycle**:
  - `dispose()` called before every navigation (stops timers, disconnects observers)
  - Container DOM swap (`#app` replaced with fresh element) breaks lingering listeners
  - Modules loaded via dynamic `import()` — lazy, split into separate chunks
- **Sidecar sharing**: both modules share the same `sidecarClient.ts` module instance
  → single sidecar connection per session
- **Option A**: imports existing `tauri-prep/src/` and `tauri-app/src/` directly — no duplication

## Files

```
tauri-shell/
├── index.html                        Fixed header + #app layout
├── package.json                      Port 1422
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts                       Entry: initShell()
│   ├── shell.ts                      Router + header + DB zone + toast + lifecycle
│   ├── context.ts                    ShellContext interface
│   └── modules/
│       ├── explorerModule.ts         mount/dispose wrapper → tauri-app
│       └── constituerModule.ts       mount/dispose wrapper → tauri-prep
└── src-tauri/
    ├── src/main.rs                   Tauri v2 app with 4 plugins
    ├── build.rs                      Sidecar copy (mirrors tauri-prep)
    ├── Cargo.toml
    ├── tauri.conf.json               id: com.agrafes.shell, 1200×760, port 1422
    └── capabilities/
        └── default.json              shell+fs+dialog+http (same as tauri-prep)
```

## Navigation flow (V0.2)

```
Header: [AGRAFES] [🔍 Explorer ⌘1] [📝 Constituer ⌘2] ... [DB: corpus.db] [Changer…]

Boot:
  1. Restore localStorage (lastMode + lastDbPath)
  2. Check location.hash or ?mode= (overrides lastMode)
  3. Navigate to resolved mode

Home screen (default on launch if no saved mode)
  ├── [🔍 Explorer AGRAFES]       → setMode("explorer")
  └── [📝 Constituer son corpus]  → setMode("constituer")

Header tabs: always visible — click to switch at any time
Keyboard shortcuts: Cmd/Ctrl+1 (explorer), +2 (constituer), +0 (home)

DB zone (right side of header):
  [DB: corpus.db] [Changer…]
  → file picker → updates badge + re-mounts active module + shows toast
```

## Lifecycle detail

```
setMode(newMode):
  1. Call _currentDispose?.()           [stop timers, disconnect observers]
  2. document.body.dataset.mode = mode  [update accent tokens]
  3. _freshContainer()                  [replace #app with clean div#app]
  4. Show loading spinner
  5. dynamic import() the module wrapper
  6. _freshContainer() again            [swap out spinner]
  7. wrapper.mount(container, ctx)
     └── setCurrentDbPath(ctx.getDbPath())  [inject shell DB into module]
     └── initApp() / new App().init()
  8. _currentDispose = () => wrapper.dispose()

DB change (_onChangeDb):
  1. Tauri dialog.open() → pick .db file
  2. _currentDbPath = newPath
  3. _persist() → localStorage
  4. _updateDbBadge()
  5. Notify _dbListeners
  6. _showToast("DB active: <basename>")
  7. If module active: setMode(_currentMode)  [re-mount with new DB]
```

## Child module changes

| File | Addition |
|------|----------|
| `tauri-app/src/app.ts` | `export function disposeApp(): void` — disconnects `_scrollObserver` (V0.1) |
| `tauri-prep/src/app.ts` | `App.dispose(): void` — calls `this._jobCenter.setConn(null)` (V0.1) |
| `tauri-prep/src/lib/db.ts` | `getOrCreateDefaultDbPath()` now checks `_currentDbPath` first (V0.2) |

## Deep-link usage

```
# Open directly on Explorer tab
http://localhost:1422/#explorer
http://localhost:1422/?mode=explorer

# Open directly on Constituer tab
http://localhost:1422/#constituer
http://localhost:1422/?mode=constituer
```

Hash takes precedence over `?mode=`. Both override `localStorage.lastMode`.

## V0.1 limitations (carried forward)

1. **CSS accumulation**: both child apps inject `<style>` tags on each `init()`.
   Re-navigating adds duplicate tags (harmless, no visual conflict).

## V0.2 limitations

1. **Create new DB**: "Changer…" opens an existing DB only (save dialog for new DB in backlog).
2. **In-module DB re-init**: on DB switch while a module is mounted, the module is fully
   disposed + re-mounted (sidecar restarted). No hot-swap without sidecar changes.
3. **Deep-link hash persistence**: the hash is consumed at boot but not cleared from the URL,
   so hard-refreshing the page will re-apply the deep-link override.

## Dev

```bash
cd tauri-shell
npm install
npm run dev        # Vite dev server on http://localhost:1422
npm run build      # TypeScript + Vite production build
npm run tauri dev  # Full Tauri dev (requires Rust toolchain + sidecar binary)
```

## CI

`build-shell` job in `.github/workflows/ci.yml` — installs tauri-prep, tauri-app,
and tauri-shell deps, then runs `npm run build` (TS + Vite, no Rust/secrets needed).

## Deprecation status

| App | Status |
|-----|--------|
| `tauri-app/` (Concordancier) | Superseded by tauri-shell; kept for standalone use |
| `tauri-prep/` (Prep) | Superseded by tauri-shell; kept for standalone use |
| `tauri-shell/` | **Active — primary app** |

## Roadmap (post-V0.2)

- V0.3: CSS style deduplication (style-id guards to avoid `<style>` accumulation)
- V0.4: Create new DB via save dialog ("Changer…" → New / Open)
- V0.5: Optional multi-window via Tauri `create_window`
- V1.0: Full migration — deprecate standalone tauri-app/ and tauri-prep/
