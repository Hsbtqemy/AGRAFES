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
    let src_binary = manifest_dir
        .join("binaries")
        .join(format!("multicorpus-{}", target_triple));

    // Copy sidecar to manifest root so tauri_build finds it for externalBin "multicorpus"
    if src_binary.exists() {
        let dest_root = manifest_dir.join(format!("multicorpus-{}", target_triple));
        if let Err(e) = std::fs::copy(&src_binary, &dest_root) {
            eprintln!("cargo:warning=Could not copy sidecar to {:?}: {}", dest_root, e);
        }
    }

    tauri_build::build();
}
