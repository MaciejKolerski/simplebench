use super::{
    history::{limit_patch, patch_bytes, CommitDiff, PATCH_LIMIT},
    relative, status,
};
use crate::files::inside;
use serde::Serialize;
use std::{fs, io::Read, path::Path};

#[derive(Serialize)]
pub struct FileDiff {
    #[serde(flatten)]
    diff: CommitDiff,
    notice: Option<String>,
}

pub(super) fn read(root: &str, path: &str, staged: bool) -> Result<FileDiff, String> {
    relative(path)?;
    let status = status(root)?.ok_or("This directory is not a Git repository.")?;
    let root = Path::new(&status.root);
    let change = status.changes.iter().find(|change| change.path == path);
    let untracked = change.is_some_and(|change| change.worktree == '?');
    let conflict = change.is_some_and(|change| {
        change.index == 'U'
            || change.worktree == 'U'
            || matches!((change.index, change.worktree), ('A', 'A') | ('D', 'D'))
    });
    if staged && conflict {
        return Err("Resolve this file's merge conflicts before comparing staged changes. Open the file to resolve them.".into());
    }
    let mut notice = conflict
        .then(|| "Unmerged file: comparing our index version with the file on disk.".into());
    if !untracked || staged {
        let mut args = vec![
            "--literal-pathspecs",
            "diff",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            "--unified=2147483647",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--output-indicator-new=+",
            "--output-indicator-old=-",
            "--output-indicator-context= ",
        ];
        if staged {
            args.push("--cached");
        } else if conflict {
            args.push("--ours");
        }
        args.extend(["--", path]);
        if staged {
            if let Some(original) = change.and_then(|change| change.original_path.as_deref()) {
                args.push(original);
            }
        }
        let bytes = patch_bytes(root, &args)?;
        let text = String::from_utf8_lossy(&bytes);
        if text.lines().any(|line| line.starts_with("Binary files ")) {
            return Ok(FileDiff {
                diff: limit_patch(&[]),
                notice: Some("Binary file: line-by-line changes are unavailable.".into()),
            });
        }
        if text.lines().any(|line| line.starts_with("@@ -")) || bytes.len() > PATCH_LIMIT {
            return Ok(FileDiff {
                diff: limit_patch(&bytes),
                notice,
            });
        }
        if change.is_some_and(|change| {
            if staged {
                change.index == 'D'
            } else {
                change.worktree == 'D'
            }
        }) {
            return Ok(FileDiff {
                diff: limit_patch(&[]),
                notice: Some("This empty file was deleted.".into()),
            });
        }
        notice = Some(if bytes.is_empty() {
            "No text changes. Showing the complete file.".into()
        } else {
            "Only file metadata changed. Showing the complete file.".into()
        });
    }
    let bytes = if staged {
        patch_bytes(root, &["show", &format!(":{path}")])?
    } else {
        let relative = Path::new(path);
        let parent = relative.parent().and_then(Path::to_str).unwrap_or("");
        let file = inside(&status.root, parent)?
            .join(relative.file_name().ok_or("Select a file to compare.")?);
        let metadata = fs::symlink_metadata(&file).map_err(|error| error.to_string())?;
        if metadata.is_symlink() {
            fs::read_link(&file)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .as_bytes()
                .to_vec()
        } else {
            if !metadata.is_file() {
                return Err("Only regular files can be displayed in this view.".into());
            }
            let mut bytes = Vec::new();
            fs::File::open(file)
                .map_err(|error| error.to_string())?
                .take((PATCH_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            bytes
        }
    };
    if bytes.contains(&0) {
        return Ok(FileDiff {
            diff: limit_patch(&[]),
            notice: Some("Binary or UTF-16 file: a UTF-8 line comparison is unavailable.".into()),
        });
    }
    let added = untracked && !staged;
    let text = String::from_utf8_lossy(&bytes);
    let count = text.lines().count();
    let mut patch = format!(
        "@@ -{},{} +1,{} @@\n",
        if added { 0 } else { 1 },
        if added { 0 } else { count },
        count
    );
    for line in text.split_inclusive('\n') {
        patch.push(if added { '+' } else { ' ' });
        patch.push_str(line);
        if !line.ends_with('\n') {
            patch.push_str("\n\\ No newline at end of file\n");
        }
    }
    if bytes.is_empty() {
        notice = Some("This file is empty.".into());
    }
    Ok(FileDiff {
        diff: limit_patch(patch.as_bytes()),
        notice,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::checked;

    fn repository() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        checked(root.path(), &["init", "-b", "main"]).unwrap();
        for (key, value) in [
            ("user.name", "Diff Test"),
            ("user.email", "diff@example.test"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", ".git/disabled-hooks"),
            ("core.autocrlf", "false"),
        ] {
            checked(root.path(), &["config", key, value]).unwrap();
        }
        root
    }

    #[test]
    fn shows_full_files_with_separate_index_and_worktree_versions() {
        let root = repository();
        let path = root.path().to_str().unwrap();
        let original = (1..=60)
            .map(|line| format!("line {line}\n"))
            .collect::<String>();
        let name = "file [1].txt";
        fs::write(root.path().join(name), &original).unwrap();
        checked(root.path(), &["add", "."]).unwrap();
        checked(root.path(), &["commit", "-m", "initial"]).unwrap();
        let staged = original.replace("line 30\n", "staged 🦀\n");
        fs::write(root.path().join(name), &staged).unwrap();
        checked(root.path(), &["--literal-pathspecs", "add", "--", name]).unwrap();
        fs::write(
            root.path().join(name),
            staged.replace("staged 🦀\n", "working\nadded\n"),
        )
        .unwrap();
        let index = read(path, name, true).unwrap().diff;
        let worktree = read(path, name, false).unwrap().diff;
        for diff in [&index, &worktree] {
            assert!(diff.patch.contains("\n line 1\n"));
            assert!(diff.patch.ends_with(" line 60\n"));
            assert!(!diff.truncated);
        }
        assert!(index.patch.contains("-line 30\n+staged 🦀\n"));
        assert!(!index.patch.contains("working"));
        assert!(worktree.patch.contains("-staged 🦀\n+working\n+added\n"));
        assert!(read(path, "../outside", false).is_err());
        assert!(read(path, "/absolute", false).is_err());
        assert!(read(path, "missing.txt", false).is_err());
    }

    #[test]
    fn displays_new_deleted_renamed_and_unchanged_files_without_touching_the_index() {
        let root = repository();
        let path = root.path().to_str().unwrap();
        let text = "first\r\nzażółć 🦀\r\nlast";
        fs::write(root.path().join("new.txt"), text).unwrap();
        let new = read(path, "new.txt", false).unwrap();
        assert!(new.diff.patch.contains("+first\r\n+zażółć 🦀\r\n+last\n"));
        assert!(new.diff.patch.contains("\\ No newline at end of file"));
        assert!(checked(root.path(), &["ls-files"]).unwrap().is_empty());
        fs::write(root.path().join("empty.txt"), "").unwrap();
        assert_eq!(
            read(path, "empty.txt", false).unwrap().notice.as_deref(),
            Some("This file is empty.")
        );
        checked(root.path(), &["add", "."]).unwrap();
        assert!(read(path, "new.txt", true)
            .unwrap()
            .diff
            .patch
            .contains("+first"));
        checked(root.path(), &["commit", "-m", "initial"]).unwrap();
        assert!(read(path, "new.txt", false)
            .unwrap()
            .diff
            .patch
            .contains(" first\r\n"));
        checked(root.path(), &["mv", "new.txt", "renamed.txt"]).unwrap();
        assert!(read(path, "renamed.txt", true)
            .unwrap()
            .diff
            .patch
            .contains(" zażółć 🦀\r\n"));
        fs::remove_file(root.path().join("renamed.txt")).unwrap();
        assert!(read(path, "renamed.txt", false)
            .unwrap()
            .diff
            .patch
            .contains("-first\r\n"));
        fs::remove_file(root.path().join("empty.txt")).unwrap();
        assert_eq!(
            read(path, "empty.txt", false).unwrap().notice.as_deref(),
            Some("This empty file was deleted.")
        );
        checked(root.path(), &["add", "-u"]).unwrap();
        assert!(read(path, "new.txt", true)
            .unwrap()
            .diff
            .patch
            .contains("-first\r\n"));
    }

    #[test]
    fn reports_binary_and_large_files_explicitly() {
        let root = repository();
        let path = root.path().to_str().unwrap();
        fs::write(root.path().join("binary"), [0, 1, 2]).unwrap();
        let binary = read(path, "binary", false).unwrap();
        assert!(binary.diff.patch.is_empty());
        assert!(binary.notice.unwrap().contains("Binary"));
        checked(root.path(), &["add", "."]).unwrap();
        checked(root.path(), &["commit", "-m", "binary"]).unwrap();
        fs::write(root.path().join("binary"), [0, 2, 3]).unwrap();
        assert!(read(path, "binary", false)
            .unwrap()
            .notice
            .unwrap()
            .contains("Binary"));
        fs::write(root.path().join("large.txt"), "a\n".repeat(20_100)).unwrap();
        let large = read(path, "large.txt", false).unwrap().diff;
        assert!(large.truncated);
        assert!(large.patch.lines().count() <= 20_000);
        fs::write(
            root.path().join("large.txt"),
            "x".repeat(PATCH_LIMIT + 1000),
        )
        .unwrap();
        let large = read(path, "large.txt", false).unwrap().diff;
        assert!(large.truncated);
        assert!(large.patch.len() <= PATCH_LIMIT);
    }

    #[cfg(unix)]
    #[test]
    fn shows_symlink_targets_without_reading_outside_the_repository() {
        let root = repository();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("file"), "outside contents").unwrap();
        std::os::unix::fs::symlink(outside.path().join("file"), root.path().join("link")).unwrap();
        let diff = read(root.path().to_str().unwrap(), "link", false).unwrap();
        assert!(!diff.diff.patch.contains("outside contents"));
        assert!(diff
            .diff
            .patch
            .contains(&outside.path().to_string_lossy().to_string()));
        std::os::unix::fs::symlink(outside.path(), root.path().join("directory")).unwrap();
        assert!(read(root.path().to_str().unwrap(), "directory/file", false).is_err());
    }

    #[test]
    fn compares_unmerged_worktree_with_ours_and_rejects_unresolved_staged_changes() {
        let root = repository();
        let path = root.path().to_str().unwrap();
        fs::write(root.path().join("file"), "first\nbase\ntail\n").unwrap();
        checked(root.path(), &["add", "."]).unwrap();
        checked(root.path(), &["commit", "-m", "base"]).unwrap();
        checked(root.path(), &["checkout", "-b", "side"]).unwrap();
        fs::write(root.path().join("file"), "first\ntheirs\ntail\n").unwrap();
        checked(root.path(), &["commit", "-am", "theirs"]).unwrap();
        checked(root.path(), &["checkout", "main"]).unwrap();
        fs::write(root.path().join("file"), "first\nours\ntail\n").unwrap();
        checked(root.path(), &["commit", "-am", "ours"]).unwrap();
        assert!(checked(root.path(), &["merge", "side"]).is_err());
        let result = read(path, "file", false).unwrap();
        assert!(result.notice.unwrap().contains("our index version"));
        assert!(result.diff.patch.contains("+<<<<<<< HEAD"));
        assert!(result.diff.patch.contains("+theirs"));
        assert!(result.diff.patch.ends_with(" tail\n"));
        assert!(
            matches!(read(path, "file", true), Err(error) if error.contains("merge conflicts"))
        );
    }
}
