use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const JSON_LIMIT: u64 = 256 * 1024;
const ASSET_LIMIT: u64 = 20 * 1024 * 1024;
const PACKAGE_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Default)]
pub struct Themes(pub Mutex<()>);

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

impl Appearance {
    fn native(self) -> Option<tauri::Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(tauri::Theme::Light),
            Self::Dark => Some(tauri::Theme::Dark),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    version: u32,
    active: Option<String>,
    // Accept old settings without allowing them to disable manifest resources.
    #[serde(default, rename = "customCss", skip_serializing)]
    _legacy_custom_css: bool,
    #[serde(default)]
    appearance: Appearance,
}

impl Preferences {
    fn builtin() -> Self {
        Self {
            version: 1,
            active: None,
            _legacy_custom_css: false,
            appearance: Appearance::System,
        }
    }
}

#[derive(Serialize)]
pub struct Bundle {
    id: String,
    manifest: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    preferences: Preferences,
    theme: Option<Bundle>,
    safe_mode: bool,
}

#[derive(Serialize)]
pub struct Entry {
    id: String,
    name: String,
    description: String,
    author: String,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct Catalog {
    directory: String,
    themes: Vec<Entry>,
}

fn authorize(label: &str, write: bool) -> Result<(), String> {
    if label == "settings" || (!write && label == "main") {
        Ok(())
    } else {
        Err("This theme operation is not available in this window.".into())
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn library(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = data_dir(app)?.join("themes");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || id.starts_with('.')
        || id
            .chars()
            .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
        || id.ends_with(['.', ' '])
    {
        return Err("Invalid theme folder name.".into());
    }
    Ok(())
}

fn relative(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 1024
        || path.chars().any(|c| c.is_control() || "\\:?#".contains(c))
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!(
            "Use a relative path inside the theme folder: {path}"
        ));
    }
    Ok(())
}

fn inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    relative(path)?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let mut target = root.clone();
    for component in path.split('/') {
        target.push(component);
        if fs::symlink_metadata(&target)
            .map_err(|error| format!("{path}: {error}"))?
            .file_type()
            .is_symlink()
        {
            return Err(format!("Theme resources cannot be symbolic links: {path}"));
        }
    }
    let target = target.canonicalize().map_err(|error| error.to_string())?;
    if !target.starts_with(root) {
        return Err("Resource escapes the theme folder.".into());
    }
    Ok(target)
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    if !fs::symlink_metadata(path)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_file()
    {
        return Err(format!("Expected a regular file: {}", path.display()));
    }
    let file = fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err(format!("Expected a regular file: {}", path.display()));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} exceeds {} KiB.", path.display(), limit / 1024));
    }
    Ok(bytes)
}

fn mime(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "css" => Some("text/css; charset=utf-8"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        _ => None,
    }
}

fn resource(root: &Path, path: &str, kind: &str) -> Result<(), String> {
    let content_type = mime(path).ok_or_else(|| format!("Unsupported theme resource: {path}"))?;
    if !content_type.starts_with(kind) {
        return Err(format!("Expected {kind} resource: {path}"));
    }
    let file = inside(root, path)?;
    let metadata = fs::metadata(&file).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > ASSET_LIMIT {
        return Err(format!("Invalid or oversized resource: {path}"));
    }
    if kind == "text/css" {
        String::from_utf8(read_limited(&file, JSON_LIMIT)?).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn manifest(root: &Path) -> Result<Value, String> {
    let bytes = read_limited(&inside(root, "theme.json")?, JSON_LIMIT)?;
    let data: Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("theme.json: {error}"))?;
    validate_manifest(root, &data)?;
    Ok(data)
}

fn validate_manifest(root: &Path, data: &Value) -> Result<(), String> {
    let object = data.as_object().ok_or("theme.json must be an object.")?;
    if data["version"] != 1 {
        return Err("Unsupported theme version. Expected version 1.".into());
    }
    let name = data["name"].as_str().ok_or("The theme needs a name.")?;
    if name.trim().is_empty() || name.len() > 160 {
        return Err("Theme name must contain 1–160 characters.".into());
    }
    for key in object.keys() {
        if ![
            "$schema",
            "version",
            "name",
            "author",
            "description",
            "appearance",
            "layout",
            "tokens",
            "styles",
            "assets",
            "backgrounds",
            "terminal",
            "stylesheet",
            "stylesheets",
        ]
        .contains(&key.as_str())
        {
            return Err(format!("Unknown theme field: {key}"));
        }
    }
    for key in ["author", "description", "$schema"] {
        if let Some(value) = object.get(key) {
            if value.as_str().is_none_or(|value| value.len() > 2000) {
                return Err(format!("Invalid {key}."));
            }
        }
    }
    if let Some(value) = object.get("appearance") {
        if !matches!(value.as_str(), Some("dark" | "light")) {
            return Err("appearance must be dark or light.".into());
        }
    }
    if let Some(layout) = object.get("layout") {
        let layout = layout.as_object().ok_or("layout must be an object.")?;
        for (key, value) in layout {
            let allowed: &[&str] = match key.as_str() {
                "tabs" => &["inline", "above", "below"],
                "statusbar" => &["top", "bottom"],
                "settingsNavigation" => &["left", "right", "top", "bottom"],
                _ => return Err(format!("Unknown layout field: {key}")),
            };
            if value.as_str().is_none_or(|value| !allowed.contains(&value)) {
                return Err(format!("Invalid layout.{key}."));
            }
        }
    }
    for key in ["tokens", "styles", "assets", "backgrounds", "terminal"] {
        if object.get(key).is_some_and(|value| !value.is_object()) {
            return Err(format!("{key} must be an object."));
        }
    }
    if object.contains_key("stylesheet") && object.contains_key("stylesheets") {
        return Err("Use stylesheets or the legacy stylesheet field, not both.".into());
    }
    let stylesheets = if let Some(value) = object.get("stylesheets") {
        value
            .as_array()
            .ok_or("stylesheets must be an array of relative CSS paths.")?
            .iter()
            .collect::<Vec<_>>()
    } else {
        object.get("stylesheet").into_iter().collect()
    };
    let mut seen = std::collections::HashSet::new();
    for stylesheet in stylesheets {
        let path = stylesheet
            .as_str()
            .ok_or("Stylesheet paths must be strings.")?;
        relative(path)?;
        if !path.ends_with(".css") {
            return Err("Stylesheet paths must name CSS files.".into());
        }
        if !seen.insert(path) {
            return Err("stylesheets must not contain duplicate paths.".into());
        }
        resource(root, path, "text/css")?;
    }

    if let Some(assets) = data["assets"].as_object() {
        for path in assets.values() {
            resource(
                root,
                path.as_str().ok_or("Asset paths must be strings.")?,
                "",
            )?;
        }
    }
    if let Some(backgrounds) = data["backgrounds"].as_object() {
        for (area, background) in backgrounds {
            if ![
                "app",
                "terminal",
                "sidebar",
                "titlebar",
                "statusbar",
                "settings",
                "modal",
            ]
            .contains(&area.as_str())
                || !background.is_object()
            {
                return Err(format!("Invalid background area: {area}"));
            }
            if let Some(path) = background.get("image") {
                resource(
                    root,
                    path.as_str()
                        .ok_or("Background image must be a relative path.")?,
                    "image/",
                )?;
            }
        }
    }
    Ok(())
}

fn bundle(root: &Path, id: &str) -> Result<Bundle, String> {
    valid_id(id)?;
    let folder = inside(root, id)?;
    Ok(Bundle {
        id: id.into(),
        manifest: manifest(&folder)?,
    })
}

fn read_preferences(path: &Path) -> Result<Preferences, String> {
    if !path.try_exists().map_err(|error| error.to_string())? {
        return Ok(Preferences::builtin());
    }
    let result = (|| {
        let value: Preferences = serde_json::from_slice(&read_limited(path, JSON_LIMIT)?)
            .map_err(|error| error.to_string())?;
        if value.version != 1 {
            return Err("Unsupported theme settings version.".into());
        }
        if let Some(id) = &value.active {
            valid_id(id)?;
        }
        Ok(value)
    })();
    result.map_err(|error: String| format!("{error} Theme settings have been left intact at {}. Select Restore DeepMono to recover.", path.display()))
}

#[tauri::command]
pub fn load_theme_preferences(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Themes>,
) -> Result<Current, String> {
    authorize(window.label(), false)?;
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let safe_mode = std::env::var_os("SIMPLEBENCH_SAFE_THEME").is_some_and(|value| value == "1");
    let preferences = if safe_mode {
        Preferences::builtin()
    } else {
        read_preferences(&data_dir(&app)?.join("theme-settings.json"))?
    };
    let theme = preferences
        .active
        .as_ref()
        .map(|id| bundle(&library(&app)?, id))
        .transpose()?;
    Ok(Current {
        preferences,
        theme,
        safe_mode,
    })
}

#[tauri::command]
pub fn load_theme(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Bundle, String> {
    authorize(window.label(), false)?;
    bundle(&library(&app)?, &id)
}

#[tauri::command]
pub fn list_themes(window: WebviewWindow, app: tauri::AppHandle) -> Result<Catalog, String> {
    authorize(window.label(), true)?;
    let directory = library(&app)?;
    let mut themes = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.')
            || !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
        {
            continue;
        }
        let result = bundle(&directory, &id);
        let (name, description, author, error) = match result {
            Ok(bundle) => (
                bundle.manifest["name"].as_str().unwrap_or(&id).into(),
                bundle.manifest["description"].as_str().unwrap_or("").into(),
                bundle.manifest["author"].as_str().unwrap_or("").into(),
                None,
            ),
            Err(error) => (id.clone(), String::new(), String::new(), Some(error)),
        };
        themes.push(Entry {
            id,
            name,
            description,
            author,
            error,
        });
    }
    themes.sort_by_key(|entry| entry.name.to_lowercase());
    Ok(Catalog {
        directory: directory.to_string_lossy().into_owned(),
        themes,
    })
}

#[tauri::command]
pub fn save_theme_preferences(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Themes>,
    data: Preferences,
) -> Result<(), String> {
    authorize(window.label(), true)?;
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    if data.version != 1 {
        return Err("Unsupported theme settings version.".into());
    }
    if let Some(id) = &data.active {
        bundle(&library(&app)?, id)?;
    }
    let directory = data_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    crate::files::write_json(
        &directory.join("theme-settings.json"),
        &data,
        JSON_LIMIT as usize,
    )?;
    app.emit("theme-changed", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn refresh_themes(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    authorize(window.label(), true)?;
    app.emit("theme-changed", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_theme_manifest(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Themes>,
    id: String,
    expected: Value,
    data: Value,
) -> Result<(), String> {
    authorize(window.label(), true)?;
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    save_manifest(&library(&app)?, &id, &expected, &data)?;
    app.emit("theme-changed", ())
        .map_err(|error| error.to_string())
}

fn save_manifest(root: &Path, id: &str, expected: &Value, data: &Value) -> Result<(), String> {
    use std::io::Write;
    valid_id(id)?;
    let folder = inside(root, id)?;
    let path = inside(&folder, "theme.json")?;
    let permissions = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .permissions();
    if permissions.readonly() {
        return Err("This theme file is read-only.".into());
    }
    validate_manifest(&folder, data)?;
    let bytes = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > JSON_LIMIT {
        return Err("theme.json exceeds 256 KiB.".into());
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(&folder).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .set_permissions(permissions)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    // Check immediately before replacement so an external edit is not silently lost.
    if &manifest(&folder)? != expected {
        return Err("This theme changed on disk. Reopen the editor before saving; your draft is still available.".into());
    }
    temporary
        .persist(&path)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_themes_folder(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: Option<String>,
) -> Result<(), String> {
    authorize(window.label(), true)?;
    let mut path = library(&app)?;
    if let Some(id) = id {
        valid_id(&id)?;
        path = inside(&path, &id)?;
    }
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn copy_package(
    source: &Path,
    target: &Path,
    total: &mut u64,
    count: &mut usize,
    depth: usize,
) -> Result<(), String> {
    if depth > 16 {
        return Err("Theme folders may be nested at most 16 levels.".into());
    }
    fs::create_dir(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        *count += 1;
        if *count > 1024 {
            return Err("Theme packages may contain at most 1024 entries.".into());
        }
        let name = entry.file_name();
        relative(
            name.to_str()
                .ok_or("Theme file names must be valid Unicode.")?,
        )?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let destination = target.join(&name);
        if kind.is_dir() {
            copy_package(&entry.path(), &destination, total, count, depth + 1)?;
        } else if kind.is_file() {
            let bytes = read_limited(&entry.path(), ASSET_LIMIT)?;
            *total += bytes.len() as u64;
            if *total > PACKAGE_LIMIT {
                return Err("Theme packages may contain at most 64 MiB.".into());
            }
            fs::write(destination, bytes).map_err(|error| error.to_string())?;
        } else {
            return Err("Theme packages cannot contain symbolic links or special files.".into());
        }
    }
    Ok(())
}

fn import(root: &Path, source: &Path) -> Result<String, String> {
    if fs::symlink_metadata(source)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Choose a theme folder, not a symbolic link.".into());
    }
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    manifest(&source)?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid theme folder.")?;
    valid_id(name)?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if root.starts_with(&source) {
        return Err(
            "Choose an individual theme folder outside the themes directory's ancestors.".into(),
        );
    }
    if source.parent() == Some(root.as_path()) {
        return Ok(name.into());
    }
    let mut id = name.to_string();
    let mut suffix = 2;
    while root.join(&id).exists() {
        id = format!("{name}-{suffix}");
        suffix += 1;
    }
    valid_id(&id)?;
    let temporary = root.join(format!(".import-{id}"));
    if temporary.exists() {
        return Err(
            "An unfinished import folder already exists. Remove it before retrying.".into(),
        );
    }
    let result = (|| {
        copy_package(&source, &temporary, &mut 0, &mut 0, 0)?;
        manifest(&temporary)?;
        fs::rename(&temporary, root.join(&id)).map_err(|error| error.to_string())?;
        Ok(id)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(temporary);
    }
    result
}

#[tauri::command]
pub async fn import_theme(
    window: WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    authorize(window.label(), true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Themes>();
        let _guard = state.0.lock().map_err(|error| error.to_string())?;
        import(&library(&app)?, Path::new(&path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn create_theme(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Themes>,
) -> Result<String, String> {
    authorize(window.label(), true)?;
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    create_starter(&library(&app)?)
}

fn create_starter(root: &Path) -> Result<String, String> {
    let mut id = "my-theme".to_string();
    let mut suffix = 2;
    while root.join(&id).exists() {
        id = format!("my-theme-{suffix}");
        suffix += 1;
    }
    let temporary = root.join(format!(".create-{id}"));
    fs::create_dir(&temporary).map_err(|error| error.to_string())?;
    let result = (|| {
        fs::create_dir(temporary.join("images")).map_err(|error| error.to_string())?;
        fs::create_dir(temporary.join("styles")).map_err(|error| error.to_string())?;
        for (path, contents) in [
            (
                "theme.json",
                include_str!("../../themes/deepmono-custom/theme.json"),
            ),
            (
                "theme.css",
                include_str!("../../themes/deepmono-custom/theme.css"),
            ),
            (
                "styles/components.css",
                include_str!("../../themes/deepmono-custom/styles/components.css"),
            ),
            (
                "images/graphite.svg",
                include_str!("../../themes/deepmono-custom/images/graphite.svg"),
            ),
            (
                "theme.schema.json",
                include_str!("../../themes/theme.schema.json"),
            ),
            (
                "tokens.json",
                include_str!("../../themes/default-tokens.json"),
            ),
            ("README.md", include_str!("../../themes/README.md")),
        ] {
            fs::write(temporary.join(path), contents).map_err(|error| error.to_string())?;
        }
        manifest(&temporary)?;
        fs::rename(&temporary, root.join(&id)).map_err(|error| error.to_string())?;
        Ok(id)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(temporary);
    }
    result
}

#[tauri::command]
pub fn sync_theme_window(window: WebviewWindow, appearance: Appearance) -> Result<(), String> {
    authorize(window.label(), false)?;
    window
        .set_theme(appearance.native())
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    if appearance == Appearance::System {
        // GTK clears prefer-dark when resetting the override. Restore the portal's
        // current value; Tao continues forwarding subsequent portal changes to GTK.
        let theme = window.theme().map_err(|error| error.to_string())?;
        window
            .set_theme(Some(theme))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn asset(root: &Path, uri_path: &str) -> Result<(&'static str, Vec<u8>), String> {
    let decoded = percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|error| error.to_string())?;
    let mut parts = decoded.splitn(3, '/');
    let id = parts.next().ok_or("Missing theme id.")?;
    valid_id(id)?;
    let revision = parts.next().ok_or("Missing asset revision.")?;
    if revision.is_empty()
        || !revision
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Invalid asset revision.".into());
    }
    let path = parts.next().ok_or("Missing resource path.")?;
    let mime = mime(path).ok_or("Unsupported theme resource.")?;
    let folder = inside(root, id)?;
    let path = inside(&folder, path)?;
    let bytes = read_limited(
        &path,
        if mime.starts_with("text/css") {
            JSON_LIMIT
        } else {
            ASSET_LIMIT
        },
    )?;
    Ok((mime, bytes))
}

pub fn protocol(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let label = context.webview_label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let result = authorize(&label, false).and_then(|()| {
            if request.method() != "GET" {
                return Err("Only GET is supported.".into());
            }
            asset(&library(&app)?, request.uri().path())
        });
        let (status, mime, bytes) = match result {
            Ok((mime, bytes)) => (200, mime, bytes),
            Err(_) => (404, "text/plain", b"Theme resource unavailable".to_vec()),
        };
        responder.respond(
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", mime)
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .header("X-Content-Type-Options", "nosniff")
                .header(
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                )
                .body(bytes)
                .expect("valid theme response"),
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_layouts_atomically_and_preserves_external_changes_and_invalid_drafts() {
        let root = tempfile::tempdir().unwrap();
        let folder = fixture(root.path());
        let original = manifest(&folder).unwrap();
        let mut data = original.clone();
        data["layout"] =
            serde_json::json!({"tabs":"below", "statusbar":"top", "settingsNavigation":"right"});
        data["tokens"] = serde_json::json!({"--pane-spacing":"10px", "--pane-border":"3px solid var(--color-outline)"});
        save_manifest(root.path(), "sample", &original, &data).unwrap();
        assert_eq!(manifest(&folder).unwrap(), data);
        assert!(save_manifest(root.path(), "sample", &original, &original)
            .unwrap_err()
            .contains("changed on disk"));
        for layout in [
            serde_json::json!(null),
            serde_json::json!({"tabs":"vertical"}),
            serde_json::json!({"unknown":"left"}),
        ] {
            let mut invalid = data.clone();
            invalid["layout"] = layout;
            assert!(save_manifest(root.path(), "sample", &data, &invalid).is_err());
            assert_eq!(manifest(&folder).unwrap(), data);
        }
        let mut missing = data.clone();
        missing["stylesheet"] = serde_json::json!("missing.css");
        assert!(save_manifest(root.path(), "sample", &data, &missing).is_err());
        assert_eq!(manifest(&folder).unwrap(), data);
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 3);
        assert!(save_manifest(root.path(), "../sample", &data, &data).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = folder.join("theme.json");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
            save_manifest(root.path(), "sample", &data, &data).unwrap();
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o640
            );
            fs::set_permissions(&path, fs::Permissions::from_mode(0o440)).unwrap();
            assert!(save_manifest(root.path(), "sample", &data, &original)
                .unwrap_err()
                .contains("read-only"));
            assert_eq!(manifest(&folder).unwrap(), data);
        }
    }

    fn fixture(root: &Path) -> PathBuf {
        let theme = root.join("sample");
        fs::create_dir(&theme).unwrap();
        fs::write(theme.join("theme.json"), r##"{"version":1,"name":"Sample","backgrounds":{"terminal":{"image":"wall paper.svg"}},"stylesheet":"theme.css"}"##).unwrap();
        fs::write(theme.join("wall paper.svg"), "<svg/>").unwrap();
        fs::write(theme.join("theme.css"), ".tab { border-radius: 0; }").unwrap();
        theme
    }

    #[test]
    fn creates_self_contained_starters_without_overwriting_existing_files() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(create_starter(root.path()).unwrap(), "my-theme");
        fs::write(root.path().join("my-theme/theme.css"), "user changes").unwrap();
        assert_eq!(create_starter(root.path()).unwrap(), "my-theme-2");
        assert_eq!(
            fs::read_to_string(root.path().join("my-theme/theme.css")).unwrap(),
            "user changes"
        );
        let theme = bundle(root.path(), "my-theme-2").unwrap();
        assert_eq!(theme.manifest["name"], "DeepMono Custom");
        assert!(root.path().join("my-theme-2/theme.schema.json").is_file());
        assert!(asset(root.path(), "/my-theme-2/1/images/graphite.svg").is_ok());
    }

    #[test]
    fn missing_legacy_stylesheets_reject_incomplete_themes() {
        let root = tempfile::tempdir().unwrap();
        let theme = fixture(root.path());
        fs::remove_file(theme.join("theme.css")).unwrap();
        assert!(bundle(root.path(), "sample").is_err());
    }

    #[test]
    fn validates_and_imports_all_declared_stylesheets_in_order() {
        let source = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let theme = fixture(source.path());
        fs::create_dir(theme.join("styles")).unwrap();
        fs::write(
            theme.join("styles/żółty motyw.css"),
            ".tab { border-radius: 12px; }",
        )
        .unwrap();
        let mut data = serde_json::json!({"version":1,"name":"CSS theme","stylesheets":["theme.css", "styles/żółty motyw.css"]});
        fs::write(theme.join("theme.json"), data.to_string()).unwrap();
        let id = import(root.path(), &theme).unwrap();
        assert_eq!(
            bundle(root.path(), &id).unwrap().manifest["stylesheets"],
            data["stylesheets"]
        );
        assert_eq!(
            asset(
                root.path(),
                "/sample/1/styles/%C5%BC%C3%B3%C5%82ty%20motyw.css"
            )
            .unwrap()
            .1,
            b".tab { border-radius: 12px; }"
        );
        fs::remove_file(theme.join("styles/żółty motyw.css")).unwrap();
        assert!(manifest(&theme).is_err());
        for invalid in [
            serde_json::json!("theme.css"),
            serde_json::json!(null),
            serde_json::json!([false]),
            serde_json::json!(["theme.css", "theme.css"]),
            serde_json::json!(["../theme.css"]),
            serde_json::json!(["https://example.com/theme.css"]),
            serde_json::json!(["wall paper.svg"]),
        ] {
            data["stylesheets"] = invalid;
            fs::write(theme.join("theme.json"), data.to_string()).unwrap();
            assert!(manifest(&theme).is_err(), "{data}");
        }
        data["stylesheets"] = serde_json::json!([]);
        fs::write(theme.join("theme.json"), data.to_string()).unwrap();
        assert!(manifest(&theme).is_ok());
        data["stylesheet"] = serde_json::json!("theme.css");
        fs::write(theme.join("theme.json"), data.to_string()).unwrap();
        assert!(manifest(&theme).is_err());
    }

    #[test]
    fn imports_complete_packages_without_overwriting_and_serves_local_assets() {
        let source = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let theme = fixture(source.path());
        assert_eq!(import(root.path(), &theme).unwrap(), "sample");
        assert_eq!(import(root.path(), &theme).unwrap(), "sample-2");
        assert_eq!(
            asset(root.path(), "/sample/1/wall%20paper.svg").unwrap().1,
            b"<svg/>"
        );
        assert_eq!(
            asset(root.path(), "/sample/2/theme.css").unwrap().0,
            "text/css; charset=utf-8"
        );
        assert!(asset(root.path(), "/sample/1/theme.json").is_err());
        assert_eq!(
            import(root.path(), &root.path().join("sample")).unwrap(),
            "sample"
        );
    }

    #[test]
    fn rejects_escaping_paths_missing_assets_and_unsupported_versions() {
        let root = tempfile::tempdir().unwrap();
        let theme = fixture(root.path());
        for path in [
            "/sample/1/../wall.svg",
            "/sample/1/%2e%2e/wall.svg",
            "/sample/1/C:%5cwall.svg",
            "/sample/1//wall.svg",
            "/sample/1/https://example.com/wall.svg",
        ] {
            assert!(asset(root.path(), path).is_err(), "{path}");
        }
        fs::remove_file(theme.join("wall paper.svg")).unwrap();
        assert!(manifest(&theme).is_err());
        fs::write(theme.join("theme.json"), r#"{"version":2,"name":"Future"}"#).unwrap();
        assert!(manifest(&theme).is_err());
    }

    #[test]
    fn preserves_invalid_preferences_and_restricts_windows() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("theme-settings.json");
        assert!(read_preferences(&path).unwrap().active.is_none());
        for value in ["broken", r#"{"version":2,"active":null,"customCss":true}"#] {
            fs::write(&path, value).unwrap();
            assert!(read_preferences(&path).unwrap_err().contains("left intact"));
            assert_eq!(fs::read_to_string(&path).unwrap(), value);
        }
        assert!(authorize("main", true).is_err());
        assert!(authorize("main", false).is_ok());
        assert!(authorize("settings", true).is_ok());
        assert!(authorize("other", false).is_err());
    }

    #[test]
    fn appearance_defaults_to_system_and_preserves_invalid_preferences() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("theme-settings.json");
        assert_eq!(
            read_preferences(&path).unwrap().appearance,
            Appearance::System
        );
        fs::write(
            &path,
            r#"{"version":1,"active":"sample","customCss":false}"#,
        )
        .unwrap();
        let legacy = read_preferences(&path).unwrap();
        assert_eq!(legacy.appearance, Appearance::System);
        assert_eq!(legacy.active.as_deref(), Some("sample"));
        assert!(serde_json::to_value(&legacy)
            .unwrap()
            .get("customCss")
            .is_none());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"version":1,"active":"sample","customCss":false}"#
        );
        for appearance in [Appearance::System, Appearance::Light, Appearance::Dark] {
            let preferences = Preferences {
                appearance,
                ..Preferences::builtin()
            };
            fs::write(&path, serde_json::to_vec(&preferences).unwrap()).unwrap();
            assert_eq!(read_preferences(&path).unwrap().appearance, appearance);
        }
        let invalid = r#"{"version":1,"active":null,"customCss":true,"appearance":"auto"}"#;
        fs::write(&path, invalid).unwrap();
        assert!(read_preferences(&path).unwrap_err().contains("left intact"));
        assert_eq!(fs::read_to_string(&path).unwrap(), invalid);
        assert_eq!(Appearance::System.native(), None);
        assert_eq!(Appearance::Light.native(), Some(tauri::Theme::Light));
        assert_eq!(Appearance::Dark.native(), Some(tauri::Theme::Dark));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_and_removes_failed_imports() {
        let source = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let theme = fixture(source.path());
        std::os::unix::fs::symlink("/etc/passwd", theme.join("outside.svg")).unwrap();
        assert!(import(root.path(), &theme).is_err());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        assert!(asset(source.path(), "/sample/1/outside.svg").is_err());
    }
}
