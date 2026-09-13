fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().plugin(
        "browser",
        tauri_build::InlinedPlugin::new().commands(&["signal"]),
    ))
    .expect("failed to build Tauri permissions");
}
