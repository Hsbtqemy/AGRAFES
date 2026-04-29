// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;

use std::collections::HashMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex};
use tauri::Manager;

// ─── Sidecar loopback fetch (bypasses Tauri HTTP plugin scope) ───────────────

#[derive(serde::Serialize)]
struct SidecarFetchResult {
    status: u16,
    ok: bool,
    body: String,
}

/// Makes an HTTP request directly via reqwest (no Tauri HTTP plugin scope check).
/// Restricted to loopback addresses (127.0.0.1, localhost, ::1) for safety.
#[tauri::command]
async fn sidecar_fetch_loopback(
    url: String,
    method: Option<String>,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<SidecarFetchResult, String> {
    // Safety: only allow loopback URLs
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("sidecar_fetch_loopback: invalid URL '{}': {}", url, e))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]" {
        return Err(format!(
            "sidecar_fetch_loopback: only loopback allowed, got host '{}'",
            host
        ));
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("sidecar_fetch_loopback: failed to build client: {}", e))?;

    let method_str = method.as_deref().unwrap_or("GET").to_uppercase();
    let mut req_builder = match method_str.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        "HEAD" => client.head(&url),
        m => return Err(format!("sidecar_fetch_loopback: unsupported method '{}'", m)),
    };

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req_builder = req_builder.header(k, v);
        }
    }

    if let Some(b) = body {
        req_builder = req_builder.body(b);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("sidecar_fetch_loopback: request to '{}' failed: {}", url, e))?;

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("sidecar_fetch_loopback: failed to read body: {}", e))?;

    Ok(SidecarFetchResult {
        status,
        ok,
        body: body_text,
    })
}

/// Reads a sidecar portfile (`.agrafes_sidecar.json`) from any path, bypassing Tauri FS scope.
/// Strictly restricted to the portfile filename only — refuses to read any other file.
/// Renamed from the misleading `read_text_file_raw` (which suggested a generic file read).
#[tauri::command]
fn read_sidecar_portfile(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    match p.file_name().and_then(|n| n.to_str()) {
        Some(".agrafes_sidecar.json") => {}
        _ => return Err("read_sidecar_portfile: only .agrafes_sidecar.json files may be read".to_string()),
    }
    std::fs::read_to_string(p)
        .map_err(|e| format!("read_sidecar_portfile: cannot read portfile: {}", e))
}

/// Reads the local telemetry NDJSON file (`.agrafes_telemetry.ndjson`).
/// Companion of `read_sidecar_portfile` — same pattern, different whitelist.
/// The NDJSON lives next to the DB. Bounded read (max 5 MiB) to avoid
/// loading huge files into the webview if the file grows unexpectedly.
#[tauri::command]
fn read_telemetry_ndjson(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    match p.file_name().and_then(|n| n.to_str()) {
        Some(".agrafes_telemetry.ndjson") => {}
        _ => return Err("read_telemetry_ndjson: only .agrafes_telemetry.ndjson files may be read".to_string()),
    }
    // Bounded read: 5 MiB. Telemetry NDJSON is expected to stay small (~100 bytes/event).
    const MAX_BYTES: u64 = 5 * 1024 * 1024;
    let metadata = std::fs::metadata(p)
        .map_err(|e| format!("read_telemetry_ndjson: cannot stat: {}", e))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "read_telemetry_ndjson: file too large ({} bytes, max {})",
            metadata.len(),
            MAX_BYTES
        ));
    }
    std::fs::read_to_string(p)
        .map_err(|e| format!("read_telemetry_ndjson: cannot read: {}", e))
}

/// Appends a diagnostic message under the OS user data dir, e.g.
/// `%APPDATA%\com.agrafes.shell\` (Windows) or `~/Library/Application Support/com.agrafes.shell/` (macOS).
/// Avoids a cwd-relative path (previous fallback created `src-tauri/sidecar-debug.log` and caused `cargo watch` rebuild loops in dev).
fn sidecar_log_path() -> Result<std::path::PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| {
        "write_sidecar_log: could not resolve user data directory".to_string()
    })?;
    let dir = base.join("com.agrafes.shell");
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "write_sidecar_log: cannot create directory '{}': {}",
            dir.display(),
            e
        )
    })?;
    Ok(dir.join("sidecar-debug.log"))
}

/// Appends a diagnostic message to the per-app sidecar debug log (see `sidecar_log_path`).
#[tauri::command]
fn write_sidecar_log(message: String) -> Result<(), String> {
    let log_path = sidecar_log_path()?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("write_sidecar_log: cannot open '{}': {}", log_path.display(), e))?;

    writeln!(file, "[{}] {}", ts, message)
        .map_err(|e| format!("write_sidecar_log: write error: {}", e))?;

    Ok(())
}

// ─── GitHub releases fetch (update check) ────────────────────────────────────

/// Fetches the latest GitHub release JSON for a given owner/repo.
/// Restricted to api.github.com. Returns the raw JSON body as a string.
#[tauri::command]
async fn fetch_github_latest_release(owner: String, repo: String) -> Result<String, String> {
    // Validate owner/repo to prevent injection (alphanumeric, hyphen, underscore, dot only)
    let valid = |s: &str| s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !valid(&owner) || !valid(&repo) {
        return Err("fetch_github_latest_release: invalid owner or repo name".to_string());
    }
    let url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
    let client = reqwest::Client::builder()
        .user_agent("AGRAFESShell/updater")
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("fetch_github_latest_release: build client: {}", e))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("fetch_github_latest_release: request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("fetch_github_latest_release: HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("fetch_github_latest_release: read body: {}", e))
}

// ─── Sidecar shutdown registry ────────────────────────────────────────────────

/// Shared state: active sidecar connection info registered by the JS layer.
#[derive(Clone, Default)]
struct SidecarRegistry(Arc<Mutex<Option<SidecarEntry>>>);

#[derive(Clone, serde::Deserialize)]
struct SidecarEntry {
    base_url: String,
    token: Option<String>,
}

/// Called by JS whenever a sidecar connection is established or changes.
/// Stores base_url + token so Rust can POST /shutdown on close.
#[tauri::command]
fn register_sidecar(
    base_url: String,
    token: Option<String>,
    state: tauri::State<SidecarRegistry>,
) {
    let mut guard = state.0.lock().unwrap();
    *guard = Some(SidecarEntry { base_url, token });
}

/// Called by JS on beforeunload — best-effort synchronous shutdown.
/// Also invoked automatically on WindowEvent::CloseRequested.
#[tauri::command]
async fn shutdown_sidecar_cmd(state: tauri::State<'_, SidecarRegistry>) -> Result<(), String> {
    let entry = {
        let mut guard = state.0.lock().unwrap();
        guard.take()
    };
    if let Some(e) = entry {
        _do_shutdown(&e.base_url, e.token.as_deref()).await;
    }
    Ok(())
}

async fn _do_shutdown(base_url: &str, token: Option<&str>) {
    let url = format!("{}/shutdown", base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut req = client.post(&url).header("Content-Type", "application/json").body("{}");
    if let Some(tok) = token {
        req = req.header("X-Sidecar-Token", tok);
    }
    let _ = req.send().await; // best-effort
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let registry = SidecarRegistry::default();

    tauri::Builder::default()
        .manage(registry)
        .setup(|_app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Take the registry entry — if already None, a previous close is in
                // flight (or no sidecar): allow the window to close immediately.
                let state = window.state::<SidecarRegistry>();
                let entry = {
                    let mut guard = state.0.lock().unwrap();
                    guard.take()
                };
                let Some(e) = entry else { return; };
                // Block default close, shut down the sidecar, then close the window.
                // The second CloseRequested triggered by window.close() will find the
                // registry empty and pass through without prevent_default.
                api.prevent_close();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    _do_shutdown(&e.base_url, e.token.as_deref()).await;
                    let _ = window.close();
                });
            }
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            sidecar_fetch_loopback,
            read_sidecar_portfile,
            read_telemetry_ndjson,
            write_sidecar_log,
            register_sidecar,
            shutdown_sidecar_cmd,
            fetch_github_latest_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AGRAFES Shell application");
}
