# AGRAFES - Windows rebuild after proxy/loopback sidecar fix

Date: 2026-03-12

## A) Commandes de rebuild utilisees

Commande principale executee (chaine Windows officielle):

```powershell
powershell -ExecutionPolicy Bypass -File c:\Dev\AGRAFES\scripts\build_tauri_shell_windows.ps1 -SkipPythonInstall -SkipNpmInstall
```

Etapes executees par ce script:

1. Build sidecar Windows onefile:

```powershell
python scripts/build_sidecar.py --preset shell --format onefile
```

2. Build Tauri Shell Windows NSIS:

```powershell
npm --prefix tauri-shell run tauri:build:windows
```

Resultat: build local Windows reussi, sidecar + shell + setup NSIS produits.

## B) Artefact Windows produit

- Artefact: `AGRAFESShell_0.1.0_x64-setup.exe`
- Chemin: `c:\Dev\AGRAFES\tauri-shell\src-tauri\target\release\bundle\nsis\AGRAFESShell_0.1.0_x64-setup.exe`
- Taille: `214261387` bytes
- SHA256: `F5A95A2EBFA984573D5D881B6F6BDEA780A1367DF3C91E91FC26F1F4DED6293D`

Confirmation d'inclusion du patch `tauri-app/src/lib/sidecarClient.ts`:

- Le build Vite du shell a genere le chunk `sidecarClient-BDe_XsIr.js`.
- Ce chunk contient les symboles/chaines du patch:
  - `normalizeLoopbackHost`
  - `makeBaseUrl`
  - `isLoopbackUrl`
  - `loopback fetch via globalThis.fetch failed ... fallback to tauri fetch`

## C) Smoke test Windows - run froid

Installation silencieuse du setup dans un dossier de test:

```powershell
Start-Process -FilePath <setup.exe> -ArgumentList @('/S',('/D=' + <install_dir>)) -Wait
```

Exemple d'installation test:

- `c:\Dev\AGRAFES\artifacts\smoke_install_proxyfix_20260312113757\agrafes-shell.exe`
- `c:\Dev\AGRAFES\artifacts\smoke_install_proxyfix_20260312113757\multicorpus.exe`

Run froid instrumente (kill process, launch app, probe sidecar health):

- `launched_shell_pid=8576`
- `health_ok_at_sec=2; url=http://127.0.0.1:57540/health`
- Reponse `/health`: `ok=true`, `status="ok"`
- Fenetre principale detectee: `MainWindowTitle=AGRAFES Shell`

Note contexte proxy:

- Le comportement proxy systeme reste observable en test direct:
  - `curl` normal vers loopback peut echouer via proxy
  - `curl --noproxy '*'` vers la meme URL loopback repond `ok=true`

## D) Statut final

Statut: **corrige (validation smoke technique locale OK)**.

Elements factuels:

1. Nouvel installeur Windows reel genere.
2. App installee et lancee a froid.
3. Sidecar healthy en 2s dans ce run froid.
4. Le patch loopback/proxy est bien present dans le build.

Limite d'automatisation:

- Le texte UI exact du bandeau d'erreur ("Sidecar did not become healthy within timeout") n'a pas ete capte automatiquement via ce script.
- En revanche, le chemin technique critique (launch app + sidecar healthy au demarrage) est valide localement.

## E) En cas d'echec futur (action minimale)

Si le timeout reapparait sur une autre machine/contexte:

1. Verifier en runtime si `globalThis.fetch("http://127.0.0.1:<port>/health")` reussit ou echoue.
2. Isoler la nature de l'erreur (`network`, `CORS`, autre).
3. Plan B minimal:
   - wrapper Rust/Tauri pour appels loopback sans proxy, ou
   - client HTTP natif configure explicitement avec no-proxy loopback.
