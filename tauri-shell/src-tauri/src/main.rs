// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;

use std::collections::HashMap;
use std::io::Write as _;

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
        .timeout(std::time::Duration::from_secs(10))
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

/// Appends a diagnostic message to %APPDATA%\com.agrafes.shell\sidecar-debug.log.
#[tauri::command]
fn write_sidecar_log(message: String) -> Result<(), String> {
    let log_path = std::env::var("APPDATA")
        .map(|d| format!("{}\\com.agrafes.shell\\sidecar-debug.log", d))
        .unwrap_or_else(|_| "sidecar-debug.log".to_string());

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("write_sidecar_log: cannot open '{}': {}", log_path, e))?;

    writeln!(file, "[{}] {}", ts, message)
        .map_err(|e| format!("write_sidecar_log: write error: {}", e))?;

    Ok(())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            sidecar_fetch_loopback,
            write_sidecar_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AGRAFES Shell application");
}
