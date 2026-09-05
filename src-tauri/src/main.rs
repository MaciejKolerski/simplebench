// Hide the extra Windows console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::path::Path::new("/sys/module/nvidia").exists()
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        // Avoid WebKitGTK's NVIDIA Wayland Error 71 before Tauri starts GUI threads.
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    simplebench_lib::run()
}
