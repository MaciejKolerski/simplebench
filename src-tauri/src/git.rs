use crate::files::{directory, main_window};
use serde::Serialize;
use std::{
    path::{Component, Path},
    process::{Command, Output},
};
use tauri::WebviewWindow;

fn command(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .output()
        .map_err(|error| format!("Cannot run Git: {error}"))
}

fn checked(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = command(root, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    path: String,
    original_path: Option<String>,
    index: char,
    worktree: char,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    root: String,
    branch: String,
    changes: Vec<Change>,
}

fn parse_status(bytes: &[u8]) -> Vec<Change> {
    let mut entries = bytes.split(|byte| *byte == 0);
    let mut changes = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let index = entry[0] as char;
        let worktree = entry[1] as char;
        let original_path = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            entries
                .next()
                .map(|path| String::from_utf8_lossy(path).into_owned())
        } else {
            None
        };
        changes.push(Change {
            path: String::from_utf8_lossy(&entry[3..]).into_owned(),
            original_path,
            index,
            worktree,
        });
    }
    changes
}

pub fn status(path: &str) -> Result<Option<GitStatus>, String> {
    let directory = directory(path)?;
    let probe = command(&directory, &["rev-parse", "--show-toplevel"])?;
    if !probe.status.success() {
        let error = String::from_utf8_lossy(&probe.stderr);
        if error.contains("not a git repository") {
            return Ok(None);
        }
        return Err(error.trim().to_owned());
    }
    let root = String::from_utf8_lossy(&probe.stdout).trim().to_string();
    let root_path = Path::new(&root);
    let branch = command(root_path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = if branch.status.success() {
        String::from_utf8_lossy(&branch.stdout).trim().to_owned()
    } else {
        String::from_utf8_lossy(&checked(root_path, &["rev-parse", "--short", "HEAD"])?)
            .trim()
            .to_owned()
    };
    let changes = parse_status(&checked(
        root_path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )?);
    Ok(Some(GitStatus {
        root,
        branch,
        changes,
    }))
}

#[tauri::command]
pub async fn git_status(window: WebviewWindow, root: String) -> Result<Option<GitStatus>, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || status(&root))
        .await
        .map_err(|error| error.to_string())?
}

fn repository(root: &str) -> Result<std::path::PathBuf, String> {
    status(root)?
        .map(|status| std::path::PathBuf::from(status.root))
        .ok_or_else(|| "This directory is not a Git repository.".into())
}

fn relative(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains('\0')
        || Path::new(path).components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Git paths must be relative to the repository.".into());
    }
    Ok(())
}

pub fn change_index(root: &str, paths: &[String], stage: bool) -> Result<(), String> {
    let root = repository(root)?;
    if paths.is_empty() {
        return Ok(());
    }
    for path in paths {
        relative(path)?;
    }
    let has_head = command(&root, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success();
    let mut args = if stage {
        vec!["--literal-pathspecs", "add", "--"]
    } else if has_head {
        vec!["--literal-pathspecs", "restore", "--staged", "--"]
    } else {
        vec!["--literal-pathspecs", "rm", "--cached", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    checked(&root, &args)?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage(
    window: WebviewWindow,
    root: String,
    paths: Vec<String>,
    stage: bool,
) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || change_index(&root, &paths, stage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_diff(
    window: WebviewWindow,
    root: String,
    path: String,
    staged: bool,
) -> Result<String, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        relative(&path)?;
        let root = repository(&root)?;
        let mut args = vec![
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
        ];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", &path]);
        let bytes = checked(&root, &args)?;
        let mut text =
            String::from_utf8_lossy(&bytes[..bytes.len().min(2 * 1024 * 1024)]).into_owned();
        if bytes.len() > 2 * 1024 * 1024 {
            text.push_str("\n[Diff truncated at 2 MiB]");
        }
        if text.is_empty() {
            text = "No text diff is available. This may be an untracked or binary file.".into();
        }
        Ok(text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_commit(
    window: WebviewWindow,
    root: String,
    message: String,
) -> Result<(), String> {
    main_window(&window)?;
    if message.trim().is_empty() {
        return Err("Enter a commit message.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = repository(&root)?;
        checked(&root, &["commit", "-m", &message])?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_renames_and_unusual_names() {
        let changes = parse_status(b"R  new name\0old name\0?? a\nfile\0 M space name\0");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].original_path.as_deref(), Some("old name"));
        assert_eq!(changes[1].path, "a\nfile");
        assert_eq!(changes[2].worktree, 'M');
    }
    #[test]
    fn detects_repositories_and_unstages_unborn_commits_without_deleting_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().to_str().unwrap();
        assert!(status(path).unwrap().is_none());
        checked(root.path(), &["init", "-b", "main"]).unwrap();
        std::fs::write(root.path().join("literal[1].txt"), "hello").unwrap();
        let paths = vec!["literal[1].txt".into()];
        change_index(path, &paths, true).unwrap();
        assert_eq!(status(path).unwrap().unwrap().changes[0].index, 'A');
        change_index(path, &paths, false).unwrap();
        assert!(root.path().join("literal[1].txt").exists());
        assert_eq!(status(path).unwrap().unwrap().changes[0].index, '?');
    }
}
