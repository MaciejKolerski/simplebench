use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path, sync::Mutex};
use tauri::{Emitter, Manager, State, Window};

const LIMIT: u64 = 4 * 1024;

#[derive(Default)]
pub struct EditorPreferencesFile(pub Mutex<()>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorPreferences {
    version: u32,
    tab_size: u8,
    insert_spaces: bool,
}

impl EditorPreferences {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 || !(1..=16).contains(&self.tab_size) {
            return Err("Invalid or unsupported editor settings.".into());
        }
        Ok(())
    }
}

fn read(path: &Path) -> Result<Option<EditorPreferences>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let result = if bytes.len() as u64 > LIMIT {
        Err("The editor settings file exceeds 4 KiB.".into())
    } else {
        serde_json::from_slice::<EditorPreferences>(&bytes)
            .map_err(|error| error.to_string())
            .and_then(|data| data.validate().map(|()| data))
    };
    result.map(Some).map_err(|error: String| {
        format!(
            "Cannot load editor settings ({error}). The file has been left intact at {}. Retry loading or reset defaults to replace it.",
            path.display()
        )
    })
}

fn save(path: &Path, data: &EditorPreferences) -> Result<(), String> {
    data.validate()?;
    crate::files::write_json(path, data, LIMIT as usize)
}

#[tauri::command]
pub fn load_editor_preferences(
    window: Window,
    app: tauri::AppHandle,
    state: State<'_, EditorPreferencesFile>,
) -> Result<Option<EditorPreferences>, String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Editor settings are only available in the main and settings windows.".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    read(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("editor-preferences.json"),
    )
}

#[tauri::command]
pub fn save_editor_preferences(
    window: Window,
    app: tauri::AppHandle,
    state: State<'_, EditorPreferencesFile>,
    data: EditorPreferences,
) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("Editor preferences can only be changed in the settings window.".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    save(&directory.join("editor-preferences.json"), &data)?;
    app.emit("editor-preferences-changed", ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_spaces_and_tabs_and_rejects_invalid_writes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("editor-preferences.json");
        assert!(read(&path).unwrap().is_none());
        for insert_spaces in [true, false] {
            for tab_size in [1, 2, 4, 8, 16] {
                save(
                    &path,
                    &EditorPreferences {
                        version: 1,
                        tab_size,
                        insert_spaces,
                    },
                )
                .unwrap();
                let loaded = read(&path).unwrap().unwrap();
                assert_eq!(loaded.tab_size, tab_size);
                assert_eq!(loaded.insert_spaces, insert_spaces);
            }
        }
        let original = fs::read(&path).unwrap();
        for (version, tab_size) in [(1, 0), (1, 17), (2, 4)] {
            assert!(save(
                &path,
                &EditorPreferences {
                    version,
                    tab_size,
                    insert_spaces: true
                }
            )
            .is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn preserves_malformed_unsupported_and_oversized_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("editor-preferences.json");
        for content in [
            "broken json".to_string(),
            r#"{"version":2,"tabSize":4,"insertSpaces":true}"#.into(),
            r#"{"version":1,"tabSize":0,"insertSpaces":true}"#.into(),
            " ".repeat(LIMIT as usize + 1),
        ] {
            fs::write(&path, &content).unwrap();
            assert!(read(&path).err().unwrap().contains("left intact"));
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
    }
}
