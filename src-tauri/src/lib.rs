mod files;
mod git;
mod shell;
mod terminal;

use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
async fn open_settings(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    files::main_window(&window)?;
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Settings — SimpleBench")
    .inner_size(680.0, 460.0)
    .min_inner_size(400.0, 300.0)
    .decorations(false)
    .theme(Some(tauri::Theme::Dark))
    .background_color(tauri::window::Color(16, 16, 16, 255))
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
            files::load_session,
            files::save_session,
            git::git_status,
            git::git_stage,
            git::git_diff,
            git::git_commit,
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
