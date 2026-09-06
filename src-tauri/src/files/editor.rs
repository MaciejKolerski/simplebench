use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, WebviewWindow};

const FILE_LIMIT: u64 = 16 * 1024 * 1024;

#[derive(Default)]
struct FileWatch {
    watcher: Option<RecommendedWatcher>,
    directories: HashSet<PathBuf>,
}

#[derive(Default)]
pub struct EditorFiles {
    writes: Mutex<()>,
    watch: Mutex<FileWatch>,
    paths: Arc<Mutex<HashSet<PathBuf>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorError {
    kind: &'static str,
    message: String,
}

impl EditorError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
    fn io(error: impl std::fmt::Display) -> Self {
        Self::new("io", error.to_string())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    path: String,
    relative: String,
    content: Option<String>,
    revision: String,
    encoding: Encoding,
    read_only: bool,
}

#[derive(Clone, Deserialize)]
pub struct FileLocation {
    root: String,
    relative: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    root: String,
    relative: String,
    content: String,
    revision: String,
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_bytes(path: &Path) -> Result<(Vec<u8>, fs::Metadata), EditorError> {
    let file = fs::File::open(path).map_err(EditorError::io)?;
    let metadata = file.metadata().map_err(EditorError::io)?;
    if !metadata.is_file() {
        return Err(EditorError::new(
            "unsupported",
            "Only regular text files can be edited.",
        ));
    }
    if metadata.len() > FILE_LIMIT {
        return Err(EditorError::new(
            "tooLarge",
            "This file exceeds the 16 MiB editor limit.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(EditorError::io)?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err(EditorError::new(
            "tooLarge",
            "This file exceeds the 16 MiB editor limit.",
        ));
    }
    Ok((bytes, metadata))
}

fn decode(bytes: &[u8]) -> Result<(String, Encoding), EditorError> {
    let invalid = || {
        EditorError::new(
            "unsupported",
            "This file is not supported text. Use UTF-8 or UTF-16 with a byte order mark.",
        )
    };
    let (text, encoding) = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if !bytes.len().is_multiple_of(2) {
            return Err(invalid());
        }
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| {
                if little {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        (
            String::from_utf16(&units).map_err(|_| invalid())?,
            if little {
                Encoding::Utf16Le
            } else {
                Encoding::Utf16Be
            },
        )
    } else {
        let (data, encoding) = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            (&bytes[3..], Encoding::Utf8Bom)
        } else {
            (bytes, Encoding::Utf8)
        };
        (
            std::str::from_utf8(data).map_err(|_| invalid())?.to_owned(),
            encoding,
        )
    };
    if text
        .chars()
        .any(|ch| ch == '\0' || (ch < ' ' && !matches!(ch, '\n' | '\r' | '\t' | '\u{000c}')))
    {
        return Err(EditorError::new(
            "unsupported",
            "Binary files cannot be edited as text.",
        ));
    }
    Ok((text, encoding))
}

fn encode(text: &str, encoding: Encoding) -> Result<Vec<u8>, EditorError> {
    let mut bytes = match encoding {
        Encoding::Utf8 => Vec::new(),
        Encoding::Utf8Bom => vec![0xef, 0xbb, 0xbf],
        Encoding::Utf16Le => vec![0xff, 0xfe],
        Encoding::Utf16Be => vec![0xfe, 0xff],
    };
    if matches!(encoding, Encoding::Utf8 | Encoding::Utf8Bom) {
        bytes.extend_from_slice(text.as_bytes());
    } else {
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&if encoding == Encoding::Utf16Le {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
    }
    if bytes.len() as u64 > FILE_LIMIT {
        return Err(EditorError::new(
            "tooLarge",
            "The edited file exceeds the 16 MiB save limit. Your changes are still in the editor.",
        ));
    }
    Ok(bytes)
}

fn resolve(root: &str, relative: &str) -> Result<(PathBuf, String), EditorError> {
    let path = super::inside(root, relative).map_err(EditorError::io)?;
    if !path.is_file() {
        return Err(EditorError::new(
            "unsupported",
            "Only regular files can be opened in the editor.",
        ));
    }
    let root = super::directory(root).map_err(EditorError::io)?;
    let relative = path
        .strip_prefix(root)
        .map_err(EditorError::io)?
        .to_str()
        .ok_or_else(|| EditorError::new("unsupported", "This filename is not valid Unicode."))?
        .to_owned();
    Ok((path, relative))
}

fn read(root: &str, relative: &str, known: Option<&str>) -> Result<EditorFile, EditorError> {
    let (path, relative) = resolve(root, relative)?;
    let (bytes, metadata) = read_bytes(&path)?;
    let hash = revision(&bytes);
    let (text, encoding) = decode(&bytes)?;
    Ok(EditorFile {
        path: path
            .to_str()
            .ok_or_else(|| EditorError::new("unsupported", "This filename is not valid Unicode."))?
            .to_owned(),
        relative,
        content: (known != Some(hash.as_str())).then_some(text),
        revision: hash,
        encoding,
        read_only: metadata.permissions().readonly(),
    })
}

fn write(request: &SaveFile) -> Result<String, EditorError> {
    let (path, _) = resolve(&request.root, &request.relative)?;
    let (original, metadata) = read_bytes(&path)?;
    if revision(&original) != request.revision {
        return Err(EditorError::new(
            "conflict",
            "The file changed on disk. Reload it or explicitly overwrite the disk version.",
        ));
    }
    if metadata.permissions().readonly() {
        return Err(EditorError::new(
            "readOnly",
            "This file is read-only. Your changes are still in the editor.",
        ));
    }
    let (_, encoding) = decode(&original)?;
    let bytes = encode(&request.content, encoding)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".simplebench-")
        .tempfile_in(
            path.parent()
                .ok_or_else(|| EditorError::new("io", "The file has no parent directory."))?,
        )
        .map_err(EditorError::io)?;
    temporary.write_all(&bytes).map_err(EditorError::io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let created = temporary.as_file().metadata().map_err(EditorError::io)?;
        if created.uid() != metadata.uid() || created.gid() != metadata.gid() {
            std::os::unix::fs::chown(temporary.path(), Some(metadata.uid()), Some(metadata.gid()))
                .map_err(EditorError::io)?;
        }
    }
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(EditorError::io)?;
    temporary.as_file().sync_all().map_err(EditorError::io)?;
    // Revalidate after preparing the replacement, including changes made by another process.
    let (current_path, _) = resolve(&request.root, &request.relative)?;
    let (current, _) = read_bytes(&current_path)?;
    if current_path != path || revision(&current) != request.revision {
        return Err(EditorError::new(
            "conflict",
            "The file changed while saving. Your changes are still in the editor.",
        ));
    }
    temporary.persist(&path).map_err(EditorError::io)?;
    Ok(revision(&bytes))
}

#[tauri::command]
pub async fn resolve_editor_file(
    window: WebviewWindow,
    root: String,
    relative: String,
) -> Result<String, EditorError> {
    super::main_window(&window).map_err(EditorError::io)?;
    tauri::async_runtime::spawn_blocking(move || {
        resolve(&root, &relative).map(|(_, relative)| relative)
    })
    .await
    .map_err(EditorError::io)?
}

#[tauri::command]
pub async fn read_editor_file(
    window: WebviewWindow,
    root: String,
    relative: String,
    known_revision: Option<String>,
) -> Result<EditorFile, EditorError> {
    super::main_window(&window).map_err(EditorError::io)?;
    tauri::async_runtime::spawn_blocking(move || read(&root, &relative, known_revision.as_deref()))
        .await
        .map_err(EditorError::io)?
}

#[tauri::command]
pub async fn save_editor_file(
    window: WebviewWindow,
    app: tauri::AppHandle,
    request: SaveFile,
) -> Result<String, EditorError> {
    super::main_window(&window).map_err(EditorError::io)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditorFiles>();
        let _guard = state.writes.lock().map_err(EditorError::io)?;
        write(&request)
    })
    .await
    .map_err(EditorError::io)?
}

#[tauri::command]
pub async fn watch_editor_files(
    window: WebviewWindow,
    app: tauri::AppHandle,
    files: Vec<FileLocation>,
) -> Result<(), String> {
    super::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditorFiles>();
        let paths: HashSet<PathBuf> = files
            .iter()
            .filter_map(|file| super::inside(&file.root, &file.relative).ok())
            .collect();
        let directories: HashSet<PathBuf> = paths
            .iter()
            .filter_map(|path| path.parent().map(Path::to_path_buf))
            .collect();
        let mut watch = state.watch.lock().map_err(|error| error.to_string())?;
        *state.paths.lock().map_err(|error| error.to_string())? = paths;
        if directories.is_empty() {
            *watch = FileWatch::default();
            return Ok(());
        }
        if watch.watcher.is_none() {
            let app = app.clone();
            let paths = state.paths.clone();
            watch.watcher = Some(
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if let Ok(ref event) = event {
                        if matches!(event.kind, EventKind::Access(_)) && !event.need_rescan() {
                            return;
                        }
                    }
                    if let Ok(paths) = paths.lock() {
                        let changed: Vec<String> = paths
                            .iter()
                            .filter(|file| {
                                event.as_ref().map_or(true, |event| {
                                    event.need_rescan()
                                        || event.paths.is_empty()
                                        || event
                                            .paths
                                            .iter()
                                            .any(|path| *file == path || file.starts_with(path))
                                })
                            })
                            .map(|path| path.to_string_lossy().into_owned())
                            .collect();
                        if !changed.is_empty() {
                            let _ = app.emit_to("main", "editor-files-changed", changed);
                        }
                    }
                })
                .map_err(|error| error.to_string())?,
            );
        }
        let removed: Vec<_> = watch
            .directories
            .difference(&directories)
            .cloned()
            .collect();
        let added: Vec<_> = directories
            .difference(&watch.directories)
            .cloned()
            .collect();
        for directory in removed {
            let _ = watch.watcher.as_mut().unwrap().unwatch(&directory);
            watch.directories.remove(&directory);
        }
        for directory in added {
            watch
                .watcher
                .as_mut()
                .unwrap()
                .watch(&directory, RecursiveMode::NonRecursive)
                .map_err(|error| error.to_string())?;
            watch.directories.insert(directory);
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_encodings_and_preserves_exact_text() {
        let root = tempfile::tempdir().unwrap();
        let root_str = root.path().to_str().unwrap();
        for encoding in [
            Encoding::Utf8,
            Encoding::Utf8Bom,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
        ] {
            let original = "fn main() {\r\n  // zażółć 🦀\n}\r";
            fs::write(
                root.path().join("main.rs"),
                encode(original, encoding).unwrap(),
            )
            .unwrap();
            let opened = read(root_str, "main.rs", None).unwrap();
            assert_eq!(opened.content.as_deref(), Some(original));
            assert_eq!(opened.encoding, encoding);
            assert!(read(root_str, "main.rs", Some(&opened.revision))
                .unwrap()
                .content
                .is_none());
            let updated = original.replace("main", "start");
            let hash = write(&SaveFile {
                root: root_str.into(),
                relative: "main.rs".into(),
                content: updated.clone(),
                revision: opened.revision,
            })
            .unwrap();
            assert_eq!(
                fs::read(root.path().join("main.rs")).unwrap(),
                encode(&updated, encoding).unwrap()
            );
            assert_eq!(read(root_str, "main.rs", None).unwrap().revision, hash);
        }
    }

    #[test]
    fn refuses_conflicting_writes_and_cleans_temporary_files() {
        let root = tempfile::tempdir().unwrap();
        let root_str = root.path().to_str().unwrap();
        let path = root.path().join("a.txt");
        fs::write(&path, "before").unwrap();
        let opened = read(root_str, "a.txt", None).unwrap();
        fs::write(&path, "external").unwrap();
        let error = write(&SaveFile {
            root: root_str.into(),
            relative: "a.txt".into(),
            content: "mine".into(),
            revision: opened.revision,
        })
        .unwrap_err();
        assert_eq!(error.kind, "conflict");
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_binary_invalid_encoding_large_files_and_escape_paths() {
        assert!(decode(b"abc\0def").is_err());
        assert!(decode(&[0xff, 0xfe, 0x61]).is_err());
        assert!(decode(&[0xfe, 0xff, 0xd8, 0x00]).is_err());
        assert!(decode(&[0x80]).is_err());
        let root = tempfile::tempdir().unwrap();
        let root_str = root.path().to_str().unwrap();
        let file = fs::File::create(root.path().join("large.txt")).unwrap();
        file.set_len(FILE_LIMIT + 1).unwrap();
        assert_eq!(
            read(root_str, "large.txt", None).unwrap_err().kind,
            "tooLarge"
        );
        assert!(read(root_str, "../outside", None).is_err());
        assert!(read(root_str, root_str, None).is_err());
        assert!(read(root_str, ".", None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn preserves_executable_permissions_and_internal_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = root.path().join("script.sh");
        fs::write(&path, "echo before\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o750)).unwrap();
        symlink(&path, root.path().join("alias.sh")).unwrap();
        let opened = read(root.path().to_str().unwrap(), "alias.sh", None).unwrap();
        assert_eq!(opened.relative, "script.sh");
        write(&SaveFile {
            root: root.path().to_str().unwrap().into(),
            relative: "alias.sh".into(),
            content: "echo after\n".into(),
            revision: opened.revision,
        })
        .unwrap();
        assert!(root.path().join("alias.sh").is_symlink());
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o750
        );
        fs::write(outside.path().join("a.txt"), "outside").unwrap();
        symlink(outside.path(), root.path().join("escape")).unwrap();
        assert!(read(root.path().to_str().unwrap(), "escape/a.txt", None).is_err());
    }
}
