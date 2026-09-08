use super::{directory, editor::decode, inside, main_window};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::Serialize;
use std::{
    fs::File,
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{State, WebviewWindow};

const FILE_LIMIT: u64 = 16 * 1024 * 1024;
const MATCH_LIMIT: usize = 1000;

#[derive(Default)]
pub struct ProjectSearch(pub Arc<AtomicU64>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    relative: String,
    line: usize,
    column: usize,
    length: usize,
    preview: String,
    preview_start: usize,
}

#[derive(Default, Serialize)]
pub struct SearchResults {
    matches: Vec<SearchMatch>,
    limited: bool,
    skipped: usize,
}

fn search(
    root: &str,
    relative: &str,
    query: &str,
    case_sensitive: bool,
    include_ignored: bool,
    cancelled: impl Fn() -> bool,
) -> Result<SearchResults, String> {
    if query.is_empty() || query.len() > 1024 || query.contains(['\r', '\n']) {
        return Err("Enter a single-line search of 1–1024 bytes.".into());
    }
    let folder = inside(root, relative)?;
    if !folder.is_dir() {
        return Err("Choose a folder to search.".into());
    }
    let root = directory(root)?;
    let pattern = RegexBuilder::new(&regex::escape(query))
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|error| error.to_string())?;
    let mut walk = WalkBuilder::new(folder);
    walk.hidden(false)
        .follow_links(false)
        .git_ignore(!include_ignored)
        .git_global(!include_ignored)
        .git_exclude(!include_ignored)
        .ignore(!include_ignored)
        .filter_entry(|entry| entry.file_name() != ".git");
    let started = Instant::now();
    let mut result = SearchResults::default();
    'files: for (visited, entry) in walk.build().enumerate() {
        if cancelled() {
            break;
        }
        if visited >= 100_000 || started.elapsed() > Duration::from_secs(15) {
            result.limited = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                result.skipped += 1;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        // Re-resolve each entry so symlinks introduced during the walk cannot escape the project.
        let Some(relative) = entry
            .path()
            .strip_prefix(&root)
            .ok()
            .and_then(|path| path.to_str())
        else {
            result.skipped += 1;
            continue;
        };
        let read = || -> Result<Vec<u8>, String> {
            let path = inside(root.to_str().ok_or("Invalid project path")?, relative)?;
            let file = File::open(path).map_err(|error| error.to_string())?;
            let meta = file.metadata().map_err(|error| error.to_string())?;
            if !meta.is_file() || meta.len() > FILE_LIMIT {
                return Err("Skipped file".into());
            }
            let mut bytes = Vec::new();
            file.take(FILE_LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 > FILE_LIMIT {
                return Err("Skipped file".into());
            }
            Ok(bytes)
        };
        let text = match read().ok().and_then(|bytes| decode(&bytes).ok()) {
            Some((text, _)) => text,
            None => {
                result.skipped += 1;
                continue;
            }
        };
        // Match the editor's normalization of CRLF and standalone CR line endings.
        let text = text.replace("\r\n", "\n").replace('\r', "\n");
        for (line_index, line) in text.split('\n').enumerate() {
            if cancelled() {
                break 'files;
            }
            for found in pattern.find_iter(line) {
                if result.matches.len() == MATCH_LIMIT {
                    result.limited = true;
                    break 'files;
                }
                let start = line[..found.start()]
                    .char_indices()
                    .rev()
                    .nth(60)
                    .map_or(0, |(index, _)| index);
                let end = line[found.start()..]
                    .char_indices()
                    .nth(240)
                    .map_or(line.len(), |(index, _)| found.start() + index);
                result.matches.push(SearchMatch {
                    relative: relative.to_owned(),
                    line: line_index + 1,
                    column: line[..found.start()].encode_utf16().count() + 1,
                    length: found.as_str().encode_utf16().count(),
                    preview: line[start..end].to_owned(),
                    preview_start: line[..start].encode_utf16().count(),
                });
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn search_project(
    window: WebviewWindow,
    state: State<'_, ProjectSearch>,
    root: String,
    relative: String,
    query: String,
    case_sensitive: bool,
    include_ignored: bool,
) -> Result<SearchResults, String> {
    main_window(&window)?;
    let generation = state.0.clone();
    let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        search(
            &root,
            &relative,
            &query,
            case_sensitive,
            include_ignored,
            || generation.load(Ordering::SeqCst) != current,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cancel_project_search(
    window: WebviewWindow,
    state: State<'_, ProjectSearch>,
) -> Result<(), String> {
    main_window(&window)?;
    state.0.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn searches_scoped_text_with_unicode_editor_positions_and_ignores() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::create_dir(root.path().join(".git")).unwrap();
        fs::write(root.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(root.path().join("ignored.txt"), "Zażółć").unwrap();
        fs::write(root.path().join(".git/secret"), "Zażółć").unwrap();
        fs::write(
            root.path().join("src/main.txt"),
            "🦀 ZAŻÓŁĆ\r\nZażółć\rZażółć",
        )
        .unwrap();
        fs::write(root.path().join("src/binary"), b"Za\0\0").unwrap();
        let path = root.path().to_str().unwrap();
        let found = search(path, "src", "zażółć", false, false, || false).unwrap();
        assert_eq!(found.matches.len(), 3);
        assert_eq!(found.matches[0].column, 4);
        assert_eq!(found.matches[0].length, 6);
        assert_eq!(found.matches[2].line, 3);
        assert_eq!(found.skipped, 1);
        assert_eq!(
            search(path, "", "Zażółć", true, false, || false)
                .unwrap()
                .matches
                .len(),
            2
        );
        assert_eq!(
            search(path, "", "Zażółć", true, true, || false)
                .unwrap()
                .matches
                .len(),
            3
        );
        assert!(search(path, "../", "hello", false, false, || false).is_err());
        assert!(search(path, "", "Zażółć", false, true, || true)
            .unwrap()
            .matches
            .is_empty());
    }

    #[test]
    fn bounds_results_and_reads_utf16() {
        let root = tempfile::tempdir().unwrap();
        let bytes: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain("hit".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        fs::write(root.path().join("wide.txt"), bytes).unwrap();
        let path = root.path().to_str().unwrap();
        assert_eq!(
            search(path, "", "hit", true, true, || false)
                .unwrap()
                .matches
                .len(),
            1
        );
        fs::write(root.path().join("many.txt"), "hit\n".repeat(1100)).unwrap();
        let found = search(path, "", "hit", true, true, || false).unwrap();
        assert_eq!(found.matches.len(), MATCH_LIMIT);
        assert!(found.limited);
    }
}
