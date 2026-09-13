use std::{fs, io::Read};
use tauri::{ipc::Response, Window};

const IMAGE_LIMIT: u64 = 16 * 1024 * 1024;

fn read_image(root: &str, relative: &str) -> Result<Vec<u8>, String> {
    let path = super::inside(root, relative)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "ico"
    ) {
        return Err("Only image files can be shown in Markdown previews.".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > IMAGE_LIMIT {
        return Err("Markdown images must be regular files no larger than 16 MiB.".into());
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(IMAGE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > IMAGE_LIMIT {
        return Err("This image exceeds the 16 MiB preview limit.".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_markdown_image(
    window: Window,
    root: String,
    relative: String,
) -> Result<Response, String> {
    super::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || read_image(&root, &relative).map(Response::new))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_stay_inside_the_project_and_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().to_str().unwrap();
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        fs::write(root.path().join("picture.svg"), svg).unwrap();
        assert_eq!(read_image(root_path, "picture.svg").unwrap(), svg);
        fs::write(root.path().join("secret.txt"), "text").unwrap();
        assert!(read_image(root_path, "secret.txt").is_err());
        assert!(read_image(root_path, "../picture.svg").is_err());
        assert!(read_image(root_path, root.path().join("picture.svg").to_str().unwrap()).is_err());
        fs::create_dir(root.path().join("directory.png")).unwrap();
        assert!(read_image(root_path, "directory.png").is_err());
        let large = fs::File::create(root.path().join("large.png")).unwrap();
        large.set_len(IMAGE_LIMIT + 1).unwrap();
        assert!(read_image(root_path, "large.png").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn image_symlinks_cannot_escape_the_project() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("private.svg"), "private").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("private.svg"),
            root.path().join("link.svg"),
        )
        .unwrap();
        assert!(read_image(root.path().to_str().unwrap(), "link.svg").is_err());
    }
}
