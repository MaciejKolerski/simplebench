use super::{
    catalog::Host,
    runtime::Launch,
    storage::{Device, Directory, Gpu},
};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub fn launch(directory: &Directory, device: &Device) -> Result<Launch, String> {
    device.validate()?;
    let host = Host::native()?;
    if device.image.rsplit(';').next() != Some(host.abi()) {
        return Err("This phone's system image does not match the host architecture. Create a compatible device in Android settings.".into());
    }
    if device.hardware.quick_boot {
        return Err("Quick Boot is not qualified for this configuration. Select Cold Boot in Android settings.".into());
    }
    if directory.root.join("installation.json").exists() {
        return Err(
            "An interrupted SDK publication needs recovery in Android settings before Start."
                .into(),
        );
    }
    let manifest = directory.manifest()?;
    if manifest
        .packages
        .get(&device.image)
        .is_none_or(|image| image.revision != device.image_revision.to_string())
    {
        return Err("The device's immutable system image revision is missing. Repair this revision in Android settings.".into());
    }
    let image = directory
        .installed_path(&device.image)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let engine = directory.installed_path("emulator")?;
    directory.installed_path("platform-tools")?;
    let avd = directory.avd_path(&device.id)?;
    let locator = read_ini(
        &directory
            .root
            .join("avd")
            .join(format!("sb_{}.ini", device.id)),
    )?;
    if locator.contains_key("path.rel")
        || locator
            .get("path")
            .map(PathBuf::from)
            .and_then(|path| path.canonicalize().ok())
            != Some(avd.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("AVD locator does not match the owned device directory. Repair this device in Settings.".into());
    }
    let config = read_ini(&avd.join("config.ini"))?;
    let image_path = config
        .get("image.sysdir.1")
        .ok_or("Android AVD has no system image. Repair the device in Settings.")?;
    if directory
        .root
        .join("sdk")
        .join(image_path)
        .canonicalize()
        .map_err(|e| e.to_string())?
        != image
    {
        return Err("AVD image files differ from the device's pinned image. Repair this device in Settings.".into());
    }
    let dimensions: Vec<u32> = ["hw.lcd.width", "hw.lcd.height"]
        .iter()
        .map(|key| {
            config
                .get(*key)
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|value| (1..=super::rpc::MAX_DISPLAY_EDGE).contains(value))
                .ok_or("Invalid Android display dimensions")
        })
        .collect::<Result<_, _>>()?;
    if dimensions[0] * dimensions[1] > super::rpc::MAX_DISPLAY_PIXELS {
        return Err(
            "This phone exceeds the supported hardware display size. Choose another phone profile."
                .into(),
        );
    }
    for (key, expected) in [
        ("hw.keyboard", "yes"),
        ("hw.audioInput", "no"),
        ("hw.audioOutput", "no"),
        ("hw.camera.back", "none"),
        ("hw.camera.front", "none"),
        ("hw.sdCard", "no"),
    ] {
        if config.get(key).map(String::as_str) != Some(expected) {
            return Err(format!(
                "Android device preparation is incomplete ({key}). Repair this device in Settings."
            ));
        }
    }
    Ok(Launch {
        root: directory.root.clone(),
        emulator: engine.join(if cfg!(windows) {
            "emulator.exe"
        } else {
            "emulator"
        }),
        discovery: discovery(&directory.root)?,
        device_id: device.id.clone(),
        avd_name: format!("sb_{}", device.id),
        gpu: match device.hardware.gpu {
            Gpu::Auto => "auto",
            Gpu::Host => "host",
            Gpu::Software => "swiftshader",
        }
        .into(),
        memory: device.hardware.ram_mib,
        cores: device.hardware.cpu_count,
        adb_port: 5037,
    })
}

pub fn read_ini(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path
        .symlink_metadata()
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("AVD metadata must be a regular file".into());
    }
    let mut text = String::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(65537)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 65536 {
        return Err("AVD metadata exceeds its bound".into());
    }
    let mut fields = BTreeMap::new();
    for line in text
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
    {
        let (key, value) = line.split_once('=').ok_or("Invalid AVD metadata line")?;
        if fields
            .insert(key.trim().into(), value.trim().into())
            .is_some()
        {
            return Err("Ambiguous AVD metadata; repair this device in Settings".into());
        }
    }
    Ok(fields)
}

// ConfigDirs::getDiscoveryDirectory in the emulator's official source. Paths on
// Linux/Windows still require native qualification; only the owned PID is read.
pub(super) fn discovery(root: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = root;
        Ok(crate::shell::home().join("Library/Caches/TemporaryItems/avd/running"))
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(value) = std::env::var_os("XDG_RUNTIME_DIR").filter(|value| !value.is_empty()) {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("XDG_RUNTIME_DIR must be absolute for Android discovery".into());
            }
            return Ok(path.join("avd/running"));
        }
        unsafe extern "C" {
            fn getuid() -> u32;
        }
        let fallback = PathBuf::from(format!("/run/user/{}", unsafe { getuid() }));
        Ok(if fallback.is_dir() {
            fallback
        } else {
            root.join("emulator-home")
        }
        .join("avd/running"))
    }
    #[cfg(windows)]
    {
        let path = std::env::var_os("LOCALAPPDATA")
            .filter(|value| !value.is_empty())
            .map(|path| PathBuf::from(path).join("Temp"))
            .unwrap_or_else(|| root.join("emulator-home"));
        if !path.is_absolute() {
            return Err("Android discovery directory must be absolute".into());
        }
        Ok(path.join("avd/running"))
    }
}
