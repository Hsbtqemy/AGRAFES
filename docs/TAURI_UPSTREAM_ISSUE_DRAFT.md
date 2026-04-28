# Draft: Tauri upstream issue — `window.confirm()` non-blocking semantics

**Note** : ce fichier est un brouillon d'issue à ouvrir sur https://github.com/tauri-apps/tauri/issues. Une fois posté, ajouter le numéro d'issue ici puis supprimer ce brouillon.

---

## Title

`window.confirm()` returns immediately without blocking on some Tauri 2.x WebView platforms

## Body

### Summary

In a Tauri 2.x application, `window.confirm()` displays the native confirmation dialog but its return value is not reliably blocking — JavaScript execution continues past the `confirm()` call before the user has clicked OK or Cancel. The user's response is sometimes ignored entirely, leading to actions being executed despite "Cancel" being clicked.

### Reproduction

Minimal reproduction:

```ts
// In any Tauri 2 frontend (React, Svelte, vanilla TS, etc.)
function deleteThing() {
  const ok = window.confirm("Are you sure?");
  if (!ok) {
    console.log("Cancelled");
    return;
  }
  console.log("Proceeding with delete");
  // ... destructive operation
}
```

Expected: `confirm()` blocks until user clicks ; `ok` is the user's choice.

Observed (sporadic, platform-dependent):
- Dialog appears
- `console.log("Proceeding with delete")` fires immediately, before user response
- Destructive operation runs regardless of user action
- User clicks Cancel — too late, action already executed

### Environment

- Tauri 2.0 (latest stable at time of report)
- Reproduced on: Windows 11 + WebView2, macOS Sonoma + WKWebView
- Not reliably reproduced on Linux + WebKitGTK
- Frontend: vanilla TypeScript + Vite

### Workaround used

Replaced all `window.confirm()` and `window.alert()` calls with custom modal dialogs implemented in DOM/JS, with explicit `await new Promise<boolean>(resolve => ...)` semantics and event listeners on confirm/cancel buttons. See [AGRAFES Shell `lib/modalConfirm.ts`](https://github.com/Hsbtqemy/AGRAFES/blob/development/tauri-prep/src/lib/modalConfirm.ts) for an example.

### Why this matters

Native `confirm()` is the simplest way to ask a destructive-action confirmation. If it cannot be relied on cross-platform in Tauri 2, the documentation should call this out explicitly, and the official `@tauri-apps/plugin-dialog` should be the recommended path.

### Asks

1. Confirm whether this is a known issue.
2. If known, add a note to the [Tauri 2 docs on JS dialogs](https://tauri.app/v2/api/...) recommending the plugin-dialog for any blocking confirmation.
3. If a fix is feasible upstream (intercepting `window.confirm` to route through the plugin), consider it.

---

## After posting

1. Replace the workaround comment in `tauri-prep/src/lib/modalConfirm.ts` header with a link to the upstream issue.
2. Remove this draft file.
3. Track resolution; once Tauri 2.x fixes it, evaluate if `modalConfirm.ts` can be retired in favor of native `window.confirm()`.
