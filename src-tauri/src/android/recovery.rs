use super::{
    installation,
    storage::{self, Devices, Directory, Preferences},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum File {
    Preferences,
    Devices,
}
impl File {
    fn name(self) -> &'static str {
        match self {
            Self::Preferences => "preferences.json",
            Self::Devices => "devices.json",
        }
    }
    fn validate(self, bytes: &[u8]) -> Result<u64, String> {
        match self {
            Self::Preferences => {
                let data: Preferences = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
                data.validate()?;
                Ok(data.revision)
            }
            Self::Devices => {
                let data: Devices = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
                data.validate()?;
                Ok(data.revision)
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub file: File,
    pub digest: String,
    pub backup_revision: Option<u64>,
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
        return Err("Metadata recovery requires a regular file no larger than 1 MiB. Preserve and inspect the original file before retrying.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Metadata grew during recovery".into());
    }
    Ok(bytes)
}

pub fn plans(directory: &Directory) -> Result<Vec<Plan>, String> {
    let mut plans = vec![];
    for file in [File::Preferences, File::Devices] {
        let path = directory.root.join(file.name());
        if !path.try_exists().map_err(|e| e.to_string())? {
            continue;
        }
        let bytes = read(&path)?;
        if file.validate(&bytes).is_ok() {
            continue;
        }
        let backup_revision = read(&path.with_extension("previous.json"))
            .ok()
            .and_then(|bytes| file.validate(&bytes).ok());
        plans.push(Plan {
            file,
            digest: format!("{:x}", Sha256::digest(bytes)),
            backup_revision,
        });
    }
    Ok(plans)
}

pub fn restore(directory: &Directory, file: File, digest: &str, reset: bool) -> Result<(), String> {
    let path = directory.root.join(file.name());
    let bytes = read(&path)?;
    if format!("{:x}", Sha256::digest(&bytes)) != digest || file.validate(&bytes).is_ok() {
        return Err(
            "Android metadata changed. Reload the recovery choices before continuing.".into(),
        );
    }
    let mut replacement = if reset {
        match file {
            File::Preferences => serde_json::to_value(Preferences::default()),
            File::Devices => return Err("Device recovery requires a valid backup. The device file and AVD data were preserved.".into()),
        }.map_err(|e| e.to_string())?
    } else {
        let backup = read(&path.with_extension("previous.json"))?;
        file.validate(&backup)?;
        serde_json::from_slice(&backup).map_err(|e| e.to_string())?
    };
    let revision = replacement["revision"]
        .as_u64()
        .ok_or("Invalid backup revision")?;
    replacement["revision"] = revision
        .checked_add(1)
        .filter(|n| *n < (1 << 53))
        .ok_or("Recovery revision limit reached")?
        .into();
    let replacement = serde_json::to_vec_pretty(&replacement).map_err(|e| e.to_string())?;
    file.validate(&replacement)?;
    let preserved = installation::checked_path(&directory.root, Path::new("recovery"))?.join(
        format!("{}-{digest}.json", file.name().trim_end_matches(".json")),
    );
    installation::create_directories(&directory.root, preserved.parent().unwrap())?;
    if preserved.exists() {
        if read(&preserved)? != bytes {
            return Err("Preserved recovery file has changed. No metadata was replaced.".into());
        }
    } else {
        storage::write_bytes(&preserved, &bytes)?;
    }
    // The immutable original is durable before replacing the corrupt descriptor.
    // Bypass normal backup rotation so the valid backup remains available.
    storage::write_bytes(&path, &replacement)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_preserves_corruption_checks_identity_and_retains_avd_data() {
        let root = tempfile::tempdir().unwrap();
        let mut directory = Directory::acquire(root.path().join("android")).unwrap();
        directory
            .save_preferences(Preferences::default(), 0)
            .unwrap();
        let previous = directory.preferences().unwrap();
        directory.save_preferences(previous.clone(), 1).unwrap();
        let path = directory.root.join("preferences.json");
        fs::write(&path, b"{broken").unwrap();
        let plan = plans(&directory).unwrap().remove(0);
        assert_eq!(plan.backup_revision, Some(1));
        assert!(restore(&directory, File::Preferences, "stale", false).is_err());
        restore(&directory, File::Preferences, &plan.digest, false).unwrap();
        assert_eq!(directory.preferences().unwrap().revision, 2);
        // Repeating recovery after the same corruption reuses its immutable copy.
        fs::write(&path, b"{broken").unwrap();
        restore(&directory, File::Preferences, &plan.digest, false).unwrap();
        assert_eq!(
            read(
                &directory
                    .root
                    .join("recovery")
                    .join(format!("preferences-{}.json", plan.digest))
            )
            .unwrap(),
            b"{broken"
        );
        fs::create_dir_all(directory.root.join("avd/retained.avd")).unwrap();
        fs::write(directory.root.join("devices.json"), b"invalid").unwrap();
        let plan = plans(&directory).unwrap().remove(0);
        assert!(restore(&directory, File::Devices, &plan.digest, true).is_err());
        assert!(directory.root.join("avd/retained.avd").exists());
        assert_eq!(
            read(&directory.root.join("devices.json")).unwrap(),
            b"invalid"
        );
    }
}
