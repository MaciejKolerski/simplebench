use super::{checked, configured_command, relative};
use crate::files::{directory, main_window};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{self, Read},
    path::Path,
    process::Stdio,
    thread,
};
use tauri::Window;

const PAGE_SIZE: usize = 50;
const PATCH_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    id: String,
    short_id: String,
    subject: String,
    author_name: String,
    authored_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    commits: Vec<CommitSummary>,
    tips: Vec<String>,
    has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    path: String,
    original_path: Option<String>,
    status: String,
    additions: Option<u64>,
    deletions: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    commit: CommitSummary,
    author_email: String,
    committer_name: String,
    committer_email: String,
    committed_at: String,
    parents: Vec<String>,
    message: String,
    files: Vec<CommitFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    patch: String,
    truncated: bool,
}

fn object_id(id: &str) -> Result<(), String> {
    if !matches!(id.len(), 40 | 64) || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("A full commit hash is required.".into());
    }
    Ok(())
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn history(
    root: &Path,
    tips: Option<Vec<String>>,
    skip: u32,
    path: Option<&str>,
) -> Result<HistoryPage, String> {
    // Freeze the starting revisions so new commits cannot shift subsequent pages.
    let tips = match tips {
        Some(tips) => tips,
        None => text(&checked(root, &["rev-list", "--all", "--no-walk"])?)
            .lines()
            .map(String::from)
            .collect(),
    };
    for tip in &tips {
        object_id(tip)?;
    }
    if tips.is_empty() {
        return Ok(HistoryPage {
            commits: vec![],
            tips,
            has_more: false,
        });
    }
    let count = format!("--max-count={}", PAGE_SIZE + 1);
    let skip = format!("--skip={skip}");
    let mut args = vec![
        "--literal-pathspecs",
        "log",
        "--date-order",
        "--no-decorate",
        "--no-notes",
        "--no-color",
        "--no-show-signature",
        "--encoding=UTF-8",
        "-z",
        "--format=%H%x00%h%x00%s%x00%an%x00%aI",
        &count,
        &skip,
    ];
    args.extend(tips.iter().map(String::as_str));
    args.push("--");
    if let Some(path) = path {
        if !path.is_empty() {
            relative(path)?;
            args.push(path);
        }
    }
    let bytes = checked(root, &args)?;
    let mut fields = bytes.split(|byte| *byte == 0);
    let mut commits = Vec::new();
    while let Some(id) = fields.next().filter(|id| !id.is_empty()) {
        let mut next = || {
            fields
                .next()
                .map(text)
                .ok_or("Cannot read the commit history.")
        };
        commits.push(CommitSummary {
            id: text(id),
            short_id: next()?,
            subject: next()?,
            author_name: next()?,
            authored_at: next()?,
        });
    }
    let has_more = commits.len() > PAGE_SIZE;
    commits.truncate(PAGE_SIZE);
    Ok(HistoryPage {
        commits,
        tips,
        has_more,
    })
}

fn metadata(root: &Path, id: &str) -> Result<CommitDetails, String> {
    object_id(id)?;
    let revision = format!("{id}^{{commit}}");
    let bytes = checked(
        root,
        &[
            "show",
            "--no-patch",
            "--no-notes",
            "--no-show-signature",
            "--no-color",
            "--encoding=UTF-8",
            "--format=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%P%x00%B",
            &revision,
            "--",
        ],
    )?;
    let fields: Vec<_> = bytes.splitn(11, |byte| *byte == 0).map(text).collect();
    if fields.len() != 11 {
        return Err("Cannot read the commit details.".into());
    }
    Ok(CommitDetails {
        commit: CommitSummary {
            id: fields[0].clone(),
            short_id: fields[1].clone(),
            subject: fields[2].clone(),
            author_name: fields[3].clone(),
            authored_at: fields[5].clone(),
        },
        author_email: fields[4].clone(),
        committer_name: fields[6].clone(),
        committer_email: fields[7].clone(),
        committed_at: fields[8].clone(),
        parents: fields[9].split_whitespace().map(String::from).collect(),
        message: fields[10].clone(),
        files: vec![],
    })
}

fn diff_args<'a>(details: &'a CommitDetails, format: &'a str) -> Vec<&'a str> {
    let mut args = vec![
        "--literal-pathspecs",
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-M",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-relative",
        "--ignore-submodules=none",
        format,
    ];
    if let Some(parent) = details.parents.first() {
        args.push(parent);
    }
    args.push(&details.commit.id);
    args
}

fn files(root: &Path, details: &CommitDetails) -> Result<Vec<CommitFile>, String> {
    let mut args = diff_args(details, "--name-status");
    args.extend(["-z", "--"]);
    let bytes = checked(root, &args)?;
    let mut entries = bytes.split(|byte| *byte == 0);
    let mut files = Vec::new();
    while let Some(status) = entries.next().filter(|entry| !entry.is_empty()) {
        let first = entries.next().ok_or("Cannot read the changed files.")?;
        let (path, original_path) = if matches!(status[0], b'R' | b'C') {
            (
                entries.next().ok_or("Cannot read a renamed file.")?,
                Some(text(first)),
            )
        } else {
            (first, None)
        };
        files.push(CommitFile {
            path: text(path),
            original_path,
            status: text(&status[..1]),
            additions: None,
            deletions: None,
        });
    }
    let mut args = diff_args(details, "--numstat");
    args.extend(["-z", "--"]);
    let bytes = checked(root, &args)?;
    let mut entries = bytes.split(|byte| *byte == 0);
    let mut stats = HashMap::new();
    while let Some(entry) = entries.next().filter(|entry| !entry.is_empty()) {
        let mut fields = entry.splitn(3, |byte| *byte == b'\t');
        let additions = text(fields.next().ok_or("Cannot read file statistics.")?)
            .parse::<u64>()
            .ok();
        let deletions = text(fields.next().ok_or("Cannot read file statistics.")?)
            .parse::<u64>()
            .ok();
        let mut path = fields.next().ok_or("Cannot read file statistics.")?;
        if path.is_empty() {
            entries
                .next()
                .ok_or("Cannot read renamed file statistics.")?;
            path = entries
                .next()
                .ok_or("Cannot read renamed file statistics.")?;
        }
        stats.insert(text(path), (additions, deletions));
    }
    for file in &mut files {
        (file.additions, file.deletions) =
            stats.remove(&file.path).ok_or("Missing file statistics.")?;
    }
    Ok(files)
}

fn details(root: &Path, id: &str) -> Result<CommitDetails, String> {
    let mut details = metadata(root, id)?;
    details.files = files(root, &details)?;
    Ok(details)
}

fn patch(
    root: &Path,
    id: &str,
    path: &str,
    original_path: Option<&str>,
) -> Result<CommitDiff, String> {
    relative(path)?;
    if let Some(original) = original_path {
        relative(original)?;
    }
    let details = metadata(root, id)?;
    let mut args = diff_args(&details, "--patch");
    args.extend([
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--output-indicator-new=+",
        "--output-indicator-old=-",
        "--output-indicator-context= ",
        "--",
        path,
    ]);
    if let Some(original) = original_path {
        args.push(original);
    }
    let bytes = patch_bytes(root, &args)?;
    let mut end = bytes.len().min(PATCH_LIMIT);
    let mut lines = 0;
    for (index, byte) in bytes[..end].iter().enumerate() {
        if *byte == b'\n' {
            lines += 1;
        }
        if lines == 20_000 {
            end = index + 1;
            break;
        }
    }
    Ok(CommitDiff {
        patch: text(&bytes[..end]),
        truncated: end < bytes.len(),
    })
}

fn patch_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut child = configured_command(root, args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Cannot run Git: {error}"))?;
    let mut stderr = child.stderr.take().expect("piped Git stderr");
    let errors = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = (&mut stderr).take(8192).read_to_end(&mut bytes);
        let _ = io::copy(&mut stderr, &mut io::sink());
        bytes
    });
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .expect("piped Git stdout")
        .take((PATCH_LIMIT + 1) as u64)
        .read_to_end(&mut bytes);
    let truncated = bytes.len() > PATCH_LIMIT;
    if truncated || read.is_err() {
        let _ = child.kill();
    }
    let status = child.wait();
    let stderr = errors.join().unwrap_or_default();
    read.map_err(|error| format!("Cannot read the commit diff: {error}"))?;
    let status = status.map_err(|error| error.to_string())?;
    if !truncated && !status.success() {
        return Err(format!(
            "Cannot read the commit diff: {}",
            text(&stderr).trim()
        ));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn git_history(
    window: Window,
    root: String,
    tips: Option<Vec<String>>,
    skip: u32,
    path: Option<String>,
) -> Result<HistoryPage, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        history(&directory(&root)?, tips, skip, path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_commit_details(
    window: Window,
    root: String,
    id: String,
) -> Result<CommitDetails, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || details(&directory(&root)?, &id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_commit_diff(
    window: Window,
    root: String,
    id: String,
    path: String,
    original_path: Option<String>,
) -> Result<CommitDiff, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        patch(&directory(&root)?, &id, &path, original_path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        checked(root.path(), &["init", "-b", "main"]).unwrap();
        for (key, value) in [
            ("user.name", "History Test"),
            ("user.email", "history@example.test"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", ".git/disabled-hooks"),
            ("core.autocrlf", "false"),
        ] {
            checked(root.path(), &["config", key, value]).unwrap();
        }
        root
    }

    fn commit(root: &Path, message: &str) -> String {
        checked(root, &["add", "--all"]).unwrap();
        checked(
            root,
            &[
                "commit",
                "--allow-empty",
                "--cleanup=verbatim",
                "-m",
                message,
            ],
        )
        .unwrap();
        text(&checked(root, &["rev-parse", "HEAD"]).unwrap())
            .trim()
            .to_owned()
    }

    #[test]
    fn filters_history_by_literal_file_or_folder() {
        let root = repository();
        std::fs::create_dir(root.path().join("src")).unwrap();
        std::fs::write(root.path().join("src/[a].txt"), "first").unwrap();
        let first = commit(root.path(), "feat(test): add literal filename");
        std::fs::write(root.path().join("src/a.txt"), "second").unwrap();
        let second = commit(root.path(), "feat(test): add another file");
        std::fs::write(root.path().join("other.txt"), "unrelated").unwrap();
        commit(root.path(), "feat(test): add unrelated file");
        let file = history(root.path(), None, 0, Some("src/[a].txt")).unwrap();
        assert_eq!(file.commits.len(), 1);
        assert_eq!(file.commits[0].id, first);
        let folder = history(root.path(), None, 0, Some("src")).unwrap();
        assert_eq!(folder.commits.len(), 2);
        assert_eq!(folder.commits[0].id, second);
        assert!(history(root.path(), None, 0, Some("../outside")).is_err());
    }

    #[test]
    fn pages_entire_history_without_shifting_when_new_commits_arrive() {
        let root = repository();
        let empty = history(root.path(), None, 0, None).unwrap();
        assert!(empty.commits.is_empty());
        assert!(!empty.has_more);
        let mut ids = Vec::new();
        for index in 0..56 {
            ids.push(commit(root.path(), &format!("chore(test): record {index}")));
        }
        let first = history(root.path(), None, 0, None).unwrap();
        assert_eq!(first.commits.len(), PAGE_SIZE);
        assert!(first.has_more);
        assert_eq!(first.commits[0].id, ids[55]);
        let added = commit(root.path(), "chore(test): add a newer commit");
        let next = history(root.path(), Some(first.tips), PAGE_SIZE as u32, None).unwrap();
        assert_eq!(next.commits.len(), 6);
        assert!(!next.has_more);
        let all: Vec<_> = first
            .commits
            .iter()
            .chain(next.commits.iter())
            .map(|commit| &commit.id)
            .collect();
        assert_eq!(all, ids.iter().rev().collect::<Vec<_>>());
        assert_eq!(
            history(root.path(), None, 0, None).unwrap().commits[0].id,
            added
        );
    }

    #[test]
    fn includes_other_branches_and_detached_head() {
        let root = repository();
        let first = commit(root.path(), "feat(test): initialize");
        checked(root.path(), &["checkout", "-b", "side"]).unwrap();
        let side = commit(root.path(), "feat(test): change the side branch");
        checked(root.path(), &["checkout", "main"]).unwrap();
        checked(root.path(), &["checkout", "--detach"]).unwrap();
        let detached = commit(root.path(), "feat(test): change detached HEAD");
        let page = history(root.path(), None, 0, None).unwrap();
        let ids: Vec<_> = page
            .commits
            .iter()
            .map(|commit| commit.id.as_str())
            .collect();
        assert_eq!(ids.len(), 3);
        for id in [first, side, detached] {
            assert!(ids.contains(&id.as_str()));
        }
    }

    #[test]
    fn reads_initial_commits_renames_binary_files_and_literal_paths() {
        let root = repository();
        let unusual = if cfg!(windows) {
            "space name.txt"
        } else {
            "zażółć\tname\n.txt"
        };
        std::fs::write(root.path().join(unusual), "old\nline\n").unwrap();
        std::fs::write(root.path().join("literal[1].txt"), "literal\n").unwrap();
        std::fs::write(root.path().join("literal1.txt"), "not the literal path\n").unwrap();
        std::fs::write(root.path().join("image.bin"), b"\0\x01\xff").unwrap();
        let message = "feat(test): add Unicode 🦀\n\nPreserve the full body.  \n\nValidation:\n- Checked files\n";
        let first = commit(root.path(), message);
        let initial = details(root.path(), &first).unwrap();
        assert_eq!(initial.message, message);
        assert_eq!(initial.commit.author_name, "History Test");
        assert_eq!(initial.author_email, "history@example.test");
        assert!(initial.parents.is_empty());
        assert_eq!(initial.files.len(), 4);
        assert!(initial.files.iter().all(|file| file.status == "A"));
        let binary = initial
            .files
            .iter()
            .find(|file| file.path == "image.bin")
            .unwrap();
        assert_eq!(binary.additions, None);
        assert_eq!(binary.deletions, None);
        let literal = patch(root.path(), &first, "literal[1].txt", None).unwrap();
        assert!(literal.patch.contains("+literal"));
        assert!(!literal.patch.contains("not the literal path"));
        assert!(patch(root.path(), &first, "image.bin", None)
            .unwrap()
            .patch
            .contains("Binary files"));

        checked(root.path(), &["mv", "--", unusual, "renamed.txt"]).unwrap();
        std::fs::write(root.path().join("literal[1].txt"), "updated\n").unwrap();
        std::fs::remove_file(root.path().join("literal1.txt")).unwrap();
        let second = commit(root.path(), "refactor(test): rename and update files");
        let renamed = details(root.path(), &second).unwrap();
        assert_eq!(renamed.parents, vec![first]);
        let file = renamed
            .files
            .iter()
            .find(|file| file.path == "renamed.txt")
            .unwrap();
        assert_eq!(file.status, "R");
        assert_eq!(file.original_path.as_deref(), Some(unusual));
        assert_eq!((file.additions, file.deletions), (Some(0), Some(0)));
        assert!(renamed
            .files
            .iter()
            .any(|file| file.path == "literal1.txt" && file.status == "D"));
        let renamed_patch = patch(root.path(), &second, "renamed.txt", Some(unusual)).unwrap();
        assert!(renamed_patch.patch.contains("rename to renamed.txt"));

        std::fs::write(root.path().join("literal[1].txt"), "uncommitted\n").unwrap();
        checked(root.path(), &["add", "--", "literal[1].txt"]).unwrap();
        std::fs::write(root.path().join("literal[1].txt"), "working tree\n").unwrap();
        let before = checked(root.path(), &["status", "--porcelain=v1", "-z"]).unwrap();
        let actual = patch(root.path(), &second, "literal[1].txt", None).unwrap();
        assert!(actual.patch.contains("+updated"));
        assert!(!actual.patch.contains("working tree"));
        assert!(!actual.patch.contains("uncommitted"));
        assert_eq!(
            checked(root.path(), &["status", "--porcelain=v1", "-z"]).unwrap(),
            before
        );
    }

    #[test]
    fn compares_merge_commits_with_the_first_parent() {
        let root = repository();
        commit(root.path(), "feat(test): initialize");
        checked(root.path(), &["checkout", "-b", "side"]).unwrap();
        std::fs::write(root.path().join("side.txt"), "side\n").unwrap();
        let side = commit(root.path(), "feat(test): add side file");
        checked(root.path(), &["checkout", "main"]).unwrap();
        std::fs::write(root.path().join("main.txt"), "main\n").unwrap();
        let main = commit(root.path(), "feat(test): add main file");
        checked(
            root.path(),
            &["merge", "--no-ff", "side", "-m", "feat(test): merge side"],
        )
        .unwrap();
        let id = text(&checked(root.path(), &["rev-parse", "HEAD"]).unwrap())
            .trim()
            .to_owned();
        let merged = details(root.path(), &id).unwrap();
        assert_eq!(merged.parents, vec![main, side]);
        assert_eq!(merged.files.len(), 1);
        assert_eq!(merged.files[0].path, "side.txt");
        assert!(patch(root.path(), &id, "side.txt", None)
            .unwrap()
            .patch
            .contains("+side"));
    }

    #[test]
    fn rejects_revision_expressions_and_marks_large_patches_as_truncated() {
        let root = repository();
        std::fs::write(root.path().join("large.txt"), "content\n".repeat(20_100)).unwrap();
        let id = commit(root.path(), "feat(test): add a large file");
        for invalid in ["--all", "HEAD", "HEAD~1", "../HEAD", ""] {
            assert!(metadata(root.path(), invalid).is_err());
            assert!(history(root.path(), Some(vec![invalid.to_owned()]), 0, None).is_err());
        }
        assert!(patch(root.path(), &id, "../outside", None).is_err());
        assert!(patch(root.path(), &id, "large.txt", Some("../outside")).is_err());
        let diff = patch(root.path(), &id, "large.txt", None).unwrap();
        assert!(diff.truncated);
        assert_eq!(diff.patch.lines().count(), 20_000);
        assert_eq!(
            details(root.path(), &id).unwrap().files[0].additions,
            Some(20_100)
        );
        std::fs::write(
            root.path().join("large.txt"),
            "x".repeat(PATCH_LIMIT + 1000),
        )
        .unwrap();
        let large = commit(root.path(), "feat(test): add a very long line");
        let diff = patch(root.path(), &large, "large.txt", None).unwrap();
        assert!(diff.truncated);
        assert!(diff.patch.len() <= PATCH_LIMIT);
    }
}
