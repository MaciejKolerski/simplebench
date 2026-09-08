mod editor_preferences;
mod files;
mod git;
mod keybindings;
mod shell;
mod terminal;
mod terminal_preferences;
mod themes;

use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    directory: String,
    home: String,
    platform: String,
    profiles: Vec<shell::Profile>,
}

#[tauri::command]
fn app_info(window: WebviewWindow, shells: State<'_, terminal::Shells>) -> Result<AppInfo, String> {
    files::main_window(&window)?;
    let mut directory = std::env::current_dir().unwrap_or_else(|_| shell::home());
    if cfg!(debug_assertions)
        && directory
            .file_name()
            .is_some_and(|name| name == "src-tauri")
    {
        directory.pop();
    }
    Ok(AppInfo {
        directory: directory.to_string_lossy().into_owned(),
        home: shell::home().to_string_lossy().into_owned(),
        platform: std::env::consts::OS.into(),
        profiles: shells.profiles.clone(),
    })
}

#[tauri::command]
async fn open_settings(
    window: WebviewWindow,
    app: tauri::AppHandle,
    page: Option<String>,
) -> Result<(), String> {
    files::main_window(&window)?;
    if page
        .as_deref()
        .is_some_and(|page| !matches!(page, "keybinds" | "themes" | "editor" | "terminal"))
    {
        return Err("Unknown settings page.".into());
    }
    if let Some(window) = app.get_webview_window("settings") {
        if let Some(page) = page {
            window
                .emit("settings-page-changed", page)
                .map_err(|error| error.to_string())?;
        }
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App(
            format!(
                "index.html?window=settings&page={}",
                page.as_deref().unwrap_or("keybinds")
            )
            .into(),
        ),
    )
    .title("Settings — SimpleBench")
    .inner_size(920.0, 680.0)
    .min_inner_size(560.0, 420.0)
    .decorations(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(terminal::Terminals::default())
        .manage(files::SessionFile::default())
        .manage(files::editor::EditorFiles::default())
        .manage(keybindings::KeybindingsFile::default())
        .manage(editor_preferences::EditorPreferencesFile::default())
        .manage(terminal_preferences::TerminalPreferencesFile::default())
        .manage(themes::Themes::default())
        .register_asynchronous_uri_scheme_protocol("theme", themes::protocol)
        .setup(|app| {
            let integration = app.path().app_data_dir()?.join("shell-integration");
            shell::prepare(&integration).map_err(std::io::Error::other)?;
            app.manage(terminal::Shells {
                profiles: shell::discover(),
                integration,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            open_settings,
            files::list_directory,
            files::validate_directory,
            files::preview_file,
            files::editor::resolve_editor_file,
            files::editor::read_editor_file,
            files::editor::save_editor_file,
            files::editor::watch_editor_files,
            files::load_session,
            files::save_session,
            keybindings::load_keybindings,
            keybindings::save_keybindings,
            editor_preferences::load_editor_preferences,
            editor_preferences::save_editor_preferences,
            terminal_preferences::load_terminal_preferences,
            terminal_preferences::save_terminal_preferences,
            themes::load_theme_preferences,
            themes::load_theme,
            themes::list_themes,
            themes::save_theme_preferences,
            themes::refresh_themes,
            themes::open_themes_folder,
            themes::import_theme,
            themes::create_theme,
            themes::sync_theme_window,
            git::git_status,
            git::git_stage,
            git::git_diff,
            git::git_commit,
            git::history::git_history,
            git::history::git_commit_details,
            git::history::git_commit_diff,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::acknowledge_terminal,
            terminal::close_terminal,
            terminal::reset_terminals,
            terminal::quote_paths,
            terminal::terminal_directories
        ])
        .build(tauri::generate_context!())
        .expect("failed to build SimpleBench");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<terminal::Terminals>().stop_all();
        }
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = event
        {
            if label == "main" {
                app.state::<terminal::Terminals>().stop_all();
                app.exit(0);
            }
        }
    });
}
