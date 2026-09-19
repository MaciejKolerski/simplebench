use std::{ffi::OsString, path::Path, process::Command};

/// The parent environment is never mutated. Every Android child receives one owned
/// SDK, private user directories and an explicit loopback ADB endpoint.
pub fn command(
    program: &Path,
    root: &Path,
    sdk: &Path,
    java: Option<&Path>,
    adb_port: u16,
) -> Result<Command, String> {
    if !program.is_absolute() || !root.is_absolute() || !sdk.is_absolute() || adb_port == 0 {
        return Err("Invalid managed Android process configuration.".into());
    }
    let mut command = Command::new(program);
    sanitize(&mut command, std::env::vars_os().map(|(name, _)| name));
    let cli_home = root.join("user/cli-home");
    let cli_home = cli_home
        .to_str()
        .ok_or("Android CLI requires a Unicode data-directory path.")?;
    command
        .current_dir(root.join("user"))
        .env("ANDROID_HOME", sdk)
        .env("ANDROID_SDK_ROOT", sdk)
        .env("ANDROID_USER_HOME", root.join("user"))
        .env("ANDROID_EMULATOR_HOME", root.join("emulator-home"))
        .env("ANDROID_AVD_HOME", root.join("avd"))
        .env("ANDROID_ADB_SERVER_PORT", adb_port.to_string())
        .env("ADB_SERVER_SOCKET", format!("tcp:127.0.0.1:{adb_port}"))
        .env("TMPDIR", root.join("tmp"))
        .env("TMP", root.join("tmp"))
        .env("TEMP", root.join("tmp"))
        // Android CLI reads .androidrc using Java's user.home, independently of SDK flags.
        .env("JAVA_TOOL_OPTIONS", java_home_option(cli_home));
    if let Some(java) = java {
        command.env("JAVA_HOME", java);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    Ok(command)
}

fn sanitize(command: &mut Command, names: impl IntoIterator<Item = OsString>) {
    for name in names {
        let upper = name.to_string_lossy().to_ascii_uppercase();
        if [
            "ANDROID_",
            "ADB_",
            "JAVA_",
            "JDK_",
            "_JAVA_",
            "REPO_",
            "QT_",
            "SDKMANAGER_",
            "AVDMANAGER_",
            "DYLD_",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix))
            || matches!(
                upper.as_str(),
                "LD_PRELOAD" | "LD_LIBRARY_PATH" | "CLASSPATH"
            )
        {
            command.env_remove(name);
        }
    }
}

fn java_home_option(path: &str) -> String {
    // HotSpot's environment-option parser concatenates adjacent quoted fragments.
    // Backslash-escaping quotes corrupts paths; verified against the private JRE.
    format!("-Duser.home='{}'", path.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn children_cannot_inherit_foreign_sdk_adb_or_jvm_configuration() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let mut process = command(&root.join("tool"), root, &root.join("sdk"), None, 5037).unwrap();
        let dangerous = [
            "ANDROID_SDK_HOME",
            "ADB_SERVER_PORT",
            "JDK_JAVA_OPTIONS",
            "_JAVA_OPTIONS",
            "REPO_OS_OVERRIDE",
            "CLASSPATH",
            "DYLD_INSERT_LIBRARIES",
        ];
        sanitize(&mut process, dangerous.into_iter().map(OsString::from));
        let environment: std::collections::BTreeMap<_, _> = process.get_envs().collect();
        for name in dangerous {
            assert_eq!(environment.get(std::ffi::OsStr::new(name)), Some(&None));
        }
        assert!(!environment.contains_key(std::ffi::OsStr::new("HOME")));
        assert!(!environment.contains_key(std::ffi::OsStr::new("PATH")));
        assert_eq!(
            environment[std::ffi::OsStr::new("ADB_SERVER_SOCKET")],
            Some(std::ffi::OsStr::new("tcp:127.0.0.1:5037"))
        );
        assert_eq!(process.get_current_dir(), Some(root.join("user").as_path()));
        assert_eq!(
            java_home_option("/data/Bob's \"phone\""),
            "-Duser.home='/data/Bob'\"'\"'s \"phone\"'"
        );
    }
}
