use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Read, path::Path, sync::Mutex};
use tauri::{Emitter, Manager, State, Window};

const LIMIT: u64 = 64 * 1024;

#[derive(Default)]
pub struct KeybindingsFile(pub Mutex<()>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keybindings {
    version: u32,
    bindings: BTreeMap<String, Option<String>>,
    #[serde(default)]
    focus_follows_pointer: bool,
}

fn read(path: &Path) -> Result<Option<serde_json::Value>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("The keybindings file exceeds 64 KiB and has been left intact.".into());
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|error| {
        format!(
            "Cannot load keybindings ({error}). The file has been left intact at {}.",
            path.display()
        )
    })
}

fn save(path: &Path, data: &Keybindings) -> Result<(), String> {
    if data.version != 1
        || data.bindings.len() > 64
        || data.bindings.iter().any(|(id, value)| {
            id.len() > 80 || value.as_ref().is_some_and(|value| value.len() > 80)
        })
    {
        return Err("Invalid keybindings settings.".into());
    }
    crate::files::write_json(path, data, LIMIT as usize)
}

#[tauri::command]
pub fn load_keybindings(
    window: Window,
    app: tauri::AppHandle,
    state: State<'_, KeybindingsFile>,
) -> Result<Option<serde_json::Value>, String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Keybindings are only available in the main and settings windows.".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    read(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("keybindings.json"),
    )
}

#[tauri::command]
pub fn save_keybindings(
    window: Window,
    app: tauri::AppHandle,
    state: State<'_, KeybindingsFile>,
    data: Keybindings,
) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("Keybindings can only be changed in the settings window.".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    save(&directory.join("keybindings.json"), &data)?;
    app.emit("keybindings-changed", ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_overrides_and_disabled_bindings_and_preserves_invalid_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("keybindings.json");
        assert!(read(&path).unwrap().is_none());
        let data = Keybindings {
            version: 1,
            focus_follows_pointer: true,
            bindings: BTreeMap::from([
                ("newTerminal".into(), Some("Ctrl+KeyK".into())),
                ("closeTerminal".into(), None),
            ]),
        };
        save(&path, &data).unwrap();
        let saved = read(&path).unwrap().unwrap();
        assert_eq!(saved["bindings"]["newTerminal"], "Ctrl+KeyK");
        assert!(saved["bindings"]["closeTerminal"].is_null());
        assert_eq!(saved["focusFollowsPointer"], true);
        fs::write(&path, "broken json").unwrap();
        assert!(read(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken json");
        assert!(save(
            &path,
            &Keybindings {
                version: 2,
                focus_follows_pointer: false,
                bindings: BTreeMap::new()
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken json");
    }

    #[test]
    fn pointer_focus_defaults_to_click_and_round_trips_both_modes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("keybindings.json");
        let mut data: Keybindings = serde_json::from_str(r#"{"version":1,"bindings":{}}"#).unwrap();
        assert!(!data.focus_follows_pointer);
        for enabled in [true, false] {
            data.focus_follows_pointer = enabled;
            save(&path, &data).unwrap();
            assert_eq!(
                read(&path).unwrap().unwrap()["focusFollowsPointer"],
                enabled
            );
        }
        for invalid in ["null", "1", "\"false\""] {
            let json =
                format!(r#"{{"version":1,"bindings":{{}},"focusFollowsPointer":{invalid}}}"#);
            assert!(serde_json::from_str::<Keybindings>(&json).is_err());
        }
    }
}
