use portable_pty::CommandBuilder;
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub program: String,
    pub distro: Option<String>,
    pub home: String,
}

pub fn home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn executable(program: &str) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.is_absolute() && program_path.is_file() {
        return Some(program_path.to_owned());
    }
    for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
        let path = directory.join(program);
        if path.is_file() {
            return Some(path);
        }
        #[cfg(windows)]
        if path.with_extension("exe").is_file() {
            return Some(path.with_extension("exe"));
        }
    }
    None
}

fn kind(program: &str) -> String {
    Path::new(program)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
}

pub fn discover() -> Vec<Profile> {
    let default =
        env::var("SHELL").unwrap_or_else(|_| if cfg!(windows) { "pwsh" } else { "bash" }.into());
    let mut profiles = Vec::new();
    for candidate in [
        &default,
        "zsh",
        "bash",
        "fish",
        "pwsh",
        "powershell",
        "cmd",
        "sh",
    ] {
        if let Some(path) = executable(candidate) {
            let program = path.to_string_lossy().into_owned();
            let kind = kind(&program);
            if profiles
                .iter()
                .any(|profile: &Profile| profile.id == format!("local:{kind}"))
            {
                continue;
            }
            profiles.push(Profile {
                id: format!("local:{kind}"),
                name: kind.clone(),
                kind,
                program,
                distro: None,
                home: home().to_string_lossy().into_owned(),
            });
        }
    }
    #[cfg(windows)]
    if let Ok(output) = quiet_command("wsl.exe")
        .args(["--list", "--quiet"])
        .output()
    {
        if output.status.success() {
            let text = if output.stdout.contains(&0) {
                String::from_utf16_lossy(
                    &output
                        .stdout
                        .chunks_exact(2)
                        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                        .collect::<Vec<_>>(),
                )
            } else {
                String::from_utf8_lossy(&output.stdout).into_owned()
            };
            for distro in text
                .trim_start_matches('\u{feff}')
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
            {
                let result = quiet_command("wsl.exe")
                    .args([
                        "-d",
                        distro,
                        "--exec",
                        "sh",
                        "-c",
                        "printf '%s\\n%s\\n' \"${SHELL:-/bin/sh}\" \"$HOME\"",
                    ])
                    .output();
                let (program, home) = result
                    .ok()
                    .filter(|output| output.status.success())
                    .map(|output| {
                        let text = String::from_utf8_lossy(&output.stdout);
                        let mut lines = text.lines();
                        (
                            lines.next().unwrap_or("/bin/sh").to_string(),
                            lines.next().unwrap_or("/").to_string(),
                        )
                    })
                    .unwrap_or(("/bin/sh".into(), "/".into()));
                profiles.push(Profile {
                    id: format!("wsl:{distro}"),
                    name: format!("WSL · {distro}"),
                    kind: kind(&program),
                    program,
                    distro: Some(distro.into()),
                    home,
                });
            }
        }
    }
    profiles
}

pub fn quiet_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub fn wsl_path(distro: &str, path: &str) -> Result<String, String> {
    if path.starts_with('/') {
        return Ok(path.into());
    }
    // Windows canonicalization adds a verbatim prefix that wslpath does not accept.
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    let path = path
        .strip_prefix(r"UNC\")
        .map_or_else(|| path.to_owned(), |tail| format!(r"\\{tail}"));
    let output = quiet_command("wsl.exe")
        .args(["-d", distro, "--exec", "wslpath", "-a", "-u", &path])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

pub fn prepare(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path.join("zsh")).map_err(|error| error.to_string())?;
    for (name, content) in [
        ("bash.sh", include_str!("../shell/bash.sh")),
        ("zsh/.zshrc", include_str!("../shell/zsh.sh")),
        ("fish.fish", include_str!("../shell/fish.fish")),
        ("powershell.ps1", include_str!("../shell/powershell.ps1")),
    ] {
        fs::write(path.join(name), content).map_err(|error| error.to_string())?;
    }
    // Zsh reads .zshenv before .zshrc; forward the user's original file as well.
    fs::write(path.join("zsh/.zshenv"), "[[ -f \"${SIMPLEBENCH_ZDOTDIR:-$HOME}/.zshenv\" ]] && source \"${SIMPLEBENCH_ZDOTDIR:-$HOME}/.zshenv\"\n").map_err(|error| error.to_string())?;
    Ok(())
}

pub fn build(
    profile: &Profile,
    cwd: &str,
    integration: &Path,
) -> Result<(CommandBuilder, String), String> {
    let cwd = if let Some(distro) = &profile.distro {
        wsl_path(distro, cwd)?
    } else {
        crate::files::directory(cwd)?.to_string_lossy().into_owned()
    };
    let integration = if let Some(distro) = &profile.distro {
        wsl_path(distro, &integration.to_string_lossy())?
    } else {
        integration.to_string_lossy().into_owned()
    };
    let join = |name: &str| {
        if profile.distro.is_some() {
            format!("{integration}/{name}")
        } else {
            Path::new(&integration)
                .join(name)
                .to_string_lossy()
                .into_owned()
        }
    };
    let mut command = if let Some(distro) = &profile.distro {
        let mut command = CommandBuilder::new("wsl.exe");
        command.args([
            "-d",
            distro,
            "--cd",
            &cwd,
            "--exec",
            "env",
            "TERM=xterm-256color",
            "COLORTERM=truecolor",
            "TERM_PROGRAM=SimpleBench",
        ]);
        if profile.kind == "zsh" {
            command.arg(format!("ZDOTDIR={}", join("zsh")));
            command.arg(format!("SIMPLEBENCH_ZDOTDIR={}", profile.home));
        }
        command.arg(&profile.program);
        command
    } else {
        let mut command = CommandBuilder::new(&profile.program);
        command.cwd(&cwd);
        command
    };
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "SimpleBench");
    match profile.kind.as_str() {
        "bash" => {
            command.args(["--rcfile", &join("bash.sh"), "-i"]);
        }
        "zsh" => {
            command.env(
                "SIMPLEBENCH_ZDOTDIR",
                env::var("ZDOTDIR").unwrap_or_else(|_| profile.home.clone()),
            );
            command.env("ZDOTDIR", join("zsh"));
            command.arg("-i");
        }
        "fish" => {
            command.args([
                "-i",
                "-C",
                &format!("source {}", quote(&join("fish.fish"), "fish")?),
            ]);
        }
        "pwsh" | "powershell" => {
            command.args([
                "-NoLogo",
                "-NoExit",
                "-Command",
                &format!(". {}", quote(&join("powershell.ps1"), "pwsh")?),
            ]);
        }
        "cmd" => {
            command.args(["/Q", "/D", "/V:OFF"]);
            command.env(
                "PROMPT",
                "$E]133;D$E\\$E]7;file://localhost/$P$E\\$E]133;A$E\\$P$G$E]133;B$E\\",
            );
        }
        _ => {
            command.arg("-i");
        }
    }
    Ok((command, cwd))
}

pub fn quote(path: &str, shell: &str) -> Result<String, String> {
    if path
        .chars()
        .any(|character| matches!(character, '\0' | '\n' | '\r' | '\u{1b}'))
    {
        return Err("Paths with control characters cannot be pasted into a terminal.".into());
    }
    match shell {
        "pwsh" | "powershell" => Ok(format!("'{}'", path.replace('\'', "''"))),
        "cmd" => {
            if path.contains(['%', '!', '"']) {
                return Err("cmd cannot safely paste paths containing %, !, or quotes. Use PowerShell for this path.".into());
            }
            Ok(format!("\"{path}\""))
        }
        _ => Ok(format!("'{}'", path.replace('\'', "'\\''"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn shell_hooks_preserve_cli_arguments_status_and_custom_commands() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("installed cli");
        fs::create_dir(&bin).unwrap();
        let codex = bin.join("codex");
        fs::write(&codex, "#!/bin/sh\nprintf '%s\\0' \"$@\"\nexit 7\n").unwrap();
        fs::set_permissions(&codex, fs::Permissions::from_mode(0o755)).unwrap();
        let path = env::join_paths(
            std::iter::once(bin).chain(env::split_paths(&env::var_os("PATH").unwrap())),
        )
        .unwrap();
        let run = |setup: &str, args: &[&str]| {
            Command::new("bash")
                .args(["--noprofile", "--norc", "-c"])
                // Source the integration without loading the user's startup files.
                .arg(format!(
                    "source() {{ :; }}\n{setup}\n{}\ncodex \"$@\"",
                    include_str!("../shell/bash.sh")
                ))
                .arg("bash")
                .args(args)
                .env("PATH", &path)
                .current_dir(directory.path())
                .output()
                .unwrap()
        };
        let args = [
            "resume",
            "Dodaj edytor kodu w aplikacji 🦀",
            "",
            "quotes '\"; $(touch should-not-exist)",
            "-c",
            "tui.terminal_title=['project']",
        ];
        let output = run("", &args);
        assert_eq!(output.status.code(), Some(7));
        let expected = args
            .into_iter()
            .flat_map(|arg| arg.bytes().chain(std::iter::once(0)))
            .collect::<Vec<_>>();
        assert_eq!(output.stdout, expected);
        assert!(!directory.path().join("should-not-exist").exists());
        for setup in [
            "function codex { printf custom; return 9; }",
            "shopt -s expand_aliases\nalias codex='printf custom'",
        ] {
            let output = run(setup, &[]);
            assert_eq!(output.stdout, b"custom");
        }
    }

    #[test]
    fn quotes_metacharacters_without_execution() {
        assert_eq!(
            quote("a'b $(touch /tmp/nope)", "bash").unwrap(),
            "'a'\\''b $(touch /tmp/nope)'"
        );
        assert_eq!(
            quote("C:\\it's a file", "pwsh").unwrap(),
            "'C:\\it''s a file'"
        );
        assert_eq!(quote("C:\\a & b", "cmd").unwrap(), "\"C:\\a & b\"");
        assert!(quote("%PATH%", "cmd").is_err());
        assert!(quote("file\ncommand", "bash").is_err());
    }
}
