use tauri::{Emitter, Manager, Window};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnvironment {
    linux_instruction: Option<String>,
}

#[cfg(any(target_os = "linux", test))]
fn linux_instruction(flatpak: bool, os_release: &str, source_package: bool) -> String {
    if flatpak {
        return "flatpak update".into();
    }
    let arch = os_release.lines().any(|line| {
        line.split_once('=').is_some_and(|(key, value)| {
            matches!(key, "ID" | "ID_LIKE")
                && value
                    .trim_matches(['\"', '\''])
                    .split_whitespace()
                    .any(|id| id == "arch")
        })
    });
    if arch {
        return format!(
            "yay -Syu {}",
            if source_package {
                "simplebench"
            } else {
                "simplebench-bin"
            }
        );
    }
    "Download the latest package from GitHub Releases and reinstall it with your distribution’s package manager, or replace your AppImage.".into()
}

#[tauri::command]
pub fn update_environment(window: Window) -> Result<UpdateEnvironment, String> {
    crate::files::main_window(&window)?;
    #[cfg(target_os = "linux")]
    let instruction = {
        let flatpak = std::env::var_os("FLATPAK_ID").is_some()
            || std::path::Path::new("/.flatpak-info").exists();
        let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
        let source_package = !flatpak
            && std::process::Command::new("pacman")
                .args(["-Qq", "simplebench"])
                .output()
                .is_ok_and(|output| output.status.success());
        Some(linux_instruction(flatpak, &os_release, source_package))
    };
    #[cfg(not(target_os = "linux"))]
    let instruction = None;
    Ok(UpdateEnvironment {
        linux_instruction: instruction,
    })
}

#[tauri::command]
pub fn request_update_check(window: Window, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("Update checks can only be requested from settings.".into());
    }
    let main = app.get_window("main").ok_or("The workspace is not open.")?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    app.emit_to("main", "check-for-updates", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restart_after_update(window: Window, app: tauri::AppHandle) -> Result<(), String> {
    crate::files::main_window(&window)?;
    if cfg!(target_os = "linux") {
        return Err("Linux updates are managed outside the application.".into());
    }
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_updates_follow_the_installation_method() {
        assert_eq!(linux_instruction(true, "ID=arch", true), "flatpak update");
        assert_eq!(
            linux_instruction(false, "ID=arch", false),
            "yay -Syu simplebench-bin"
        );
        assert_eq!(
            linux_instruction(false, "ID=endeavouros\nID_LIKE=\"arch\"", true),
            "yay -Syu simplebench"
        );
        for os in ["", "ID=debian", "NAME=arch\nID=ubuntu", "ID=archipelago"] {
            assert!(linux_instruction(false, os, false).starts_with("Download the latest package"));
        }
    }
}
