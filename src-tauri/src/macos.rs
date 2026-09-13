use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Manager, RunEvent,
};

#[cfg(dev)]
fn use_development_bundle_icon() {
    if std::env::var_os("SIMPLEBENCH_DEV_BUNDLE").is_none() {
        return;
    }
    let main_thread =
        objc2::MainThreadMarker::new().expect("App lifecycle events run on the main thread");
    let application = objc2_app_kit::NSApplication::sharedApplication(main_thread);
    // AppKit accepts nil to restore the bundle icon. Tauri's development ICNS
    // override would otherwise hide the catalog's system appearance variants.
    unsafe { application.setApplicationIconImage(None) };
}

pub fn setup_menu(app: &App) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "SimpleBench",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    // Cmd+W belongs to the configurable active-panel action.
                    &MenuItem::with_id(app, "close-window", "Close Window", true, None::<&str>)?,
                ],
            )?,
        ],
    )?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "close-window" {
            if let Some(window) = app
                .webview_windows()
                .values()
                .find(|window| window.is_focused().unwrap_or(false))
            {
                let _ = window.close();
            }
        }
    });
    Ok(())
}

pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    match event {
        #[cfg(dev)]
        RunEvent::Ready => use_development_bundle_icon(),
        RunEvent::ExitRequested { api, .. } => {
            if let Some(window) = app.get_window("main") {
                // Quit from the menu or Dock must use the editor/session close guard.
                api.prevent_exit();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.close();
            }
        }
        RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    }
}
