use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=binaries/");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let target_triple = env::var("TARGET").unwrap_or_else(|_| {
        String::from_utf8_lossy(
            &std::process::Command::new("rustc")
                .args(["--print", "host-tuple"])
                .output()
                .map(|o| o.stdout)
                .unwrap_or_default(),
        )
        .trim()
        .to_string()
    });
    let binaries_dir = manifest_dir.join("binaries");
    let stem = format!("multicorpus-{}", target_triple);
    let is_windows = target_triple.contains("windows");
    let ext = if is_windows { ".exe" } else { "" };

    let direct = binaries_dir.join(format!("{}{}", stem, ext));
    let onedir_dir = binaries_dir.join(format!("{}-onedir", stem));
    let onedir_renamed = onedir_dir.join(format!("{}{}", stem, ext));
    let onedir_inner = onedir_dir.join(format!("multicorpus{}", ext));

    let src_binary = if direct.exists() {
        Some(direct)
    } else if onedir_renamed.exists() {
        Some(onedir_renamed)
    } else if onedir_inner.exists() {
        Some(onedir_inner)
    } else {
        None
    };

    // Copy sidecar to manifest root so tauri_build finds it for externalBin "multicorpus"
    if let Some(src_binary) = src_binary {
        let dest_root = manifest_dir.join(format!("{}{}", stem, ext));
        if let Err(e) = std::fs::copy(&src_binary, &dest_root) {
            eprintln!(
                "cargo:warning=Could not copy sidecar from {:?} to {:?}: {}",
                src_binary, dest_root, e
            );
        }
    } else {
        eprintln!(
            "cargo:warning=No sidecar candidate found in {:?} for target {}",
            binaries_dir, target_triple
        );
    }

    tauri_build::build();
}
