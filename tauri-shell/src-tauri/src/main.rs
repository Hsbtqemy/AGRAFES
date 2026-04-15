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

/// Reads a text file from any path, bypassing Tauri FS scope (used to read sidecar portfiles
/// which live next to the user's DB file, potentially outside the app data directory).
#[tauri::command]
fn read_text_file_raw(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("read_text_file_raw: cannot read '{}': {}", path, e))
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
            if let tauri::WindowEvent::Destroyed = event {
                // Synchronous best-effort shutdown on window destroy.
                // We read the registry and fire a blocking reqwest call.
                let state = window.state::<SidecarRegistry>();
                let entry = {
                    let mut guard = state.0.lock().unwrap();
                    guard.take()
                };
                if let Some(e) = entry {
                    // Block the thread briefly for a clean shutdown.
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build();
                    if let Ok(rt) = rt {
                        rt.block_on(_do_shutdown(&e.base_url, e.token.as_deref()));
                    }
                }
            }
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            sidecar_fetch_loopback,
            read_text_file_raw,
            write_sidecar_log,
            register_sidecar,
            shutdown_sidecar_cmd,
            fetch_github_latest_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AGRAFES Shell application");
}
