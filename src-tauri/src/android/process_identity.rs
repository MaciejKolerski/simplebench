use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Recovery must additionally verify the managed AVD and authenticated instance.
/// A PID alone can be reused after exit, including while a stale record remains.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub pid: u32,
    pub executable: PathBuf,
    pub created: u64,
    pub boot: String,
}

impl Identity {
    pub fn read(pid: u32) -> Result<Self, String> {
        if pid == 0 || pid > i32::MAX as u32 {
            return Err("Invalid managed process ID".into());
        }
        native(pid).map_err(|error| format!("Cannot verify Android process identity: {error}"))
    }

    pub fn still_matches(&self) -> Result<bool, String> {
        Ok(Self::read(self.pid)? == *self)
    }

    pub fn matches_or_exited(&self) -> Result<bool, String> {
        match Self::read(self.pid) {
            Ok(current) => Ok(current == *self),
            Err(_) if self.pid > 0 && self.pid <= i32::MAX as u32 && absent(self.pid) => Ok(false),
            Err(error) => Err(error),
        }
    }
}

#[cfg(unix)]
fn absent(pid: u32) -> bool {
    // Signal zero checks existence/permissions without delivering a signal.
    unsafe {
        libc::kill(pid as i32, 0) == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
    }
}

#[cfg(windows)]
fn absent(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER},
        System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        unsafe { GetLastError() == ERROR_INVALID_PARAMETER }
    } else {
        unsafe {
            CloseHandle(handle);
        }
        false
    }
}

#[cfg(target_os = "linux")]
fn native(pid: u32) -> Result<Identity, String> {
    use std::{fs, io::Read};
    let root = PathBuf::from(format!("/proc/{pid}"));
    let read = || -> Result<u64, String> {
        let mut text = String::new();
        fs::File::open(root.join("stat"))
            .map_err(|e| e.to_string())?
            .take(16385)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() > 16384 {
            return Err("Process stat exceeds its bound".into());
        }
        // comm can contain spaces and parentheses; numeric fields follow its final ')'.
        text.rsplit_once(") ")
            .and_then(|(_, fields)| fields.split_whitespace().nth(19))
            .and_then(|value| value.parse().ok())
            .ok_or("Missing process start time".into())
    };
    let created = read()?;
    let executable = fs::read_link(root.join("exe")).map_err(|e| e.to_string())?;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(|e| e.to_string())?;
    if read()? != created {
        return Err("Process changed during identity lookup".into());
    }
    Ok(Identity {
        pid,
        executable,
        created,
        boot: boot.trim().into(),
    })
}

#[cfg(target_os = "macos")]
fn native(pid: u32) -> Result<Identity, String> {
    use std::{
        ffi::{c_char, c_int, c_void, CStr},
        os::unix::ffi::OsStrExt,
    };
    // rusage_info_v0 from the macOS SDK: UUID followed by ten uint64_t counters.
    #[repr(C)]
    #[derive(Default)]
    struct Usage {
        uuid: [u8; 16],
        counters: [u64; 10],
    }
    unsafe extern "C" {
        fn proc_pidpath(pid: c_int, buffer: *mut c_void, size: u32) -> c_int;
        fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *mut c_void) -> c_int;
        fn sysctlbyname(
            name: *const c_char,
            output: *mut c_void,
            size: *mut usize,
            input: *mut c_void,
            input_size: usize,
        ) -> c_int;
    }
    let read = || -> Result<Usage, String> {
        let mut usage = Usage::default();
        if unsafe { proc_pid_rusage(pid as c_int, 0, (&mut usage as *mut Usage).cast()) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if usage.counters[9] != 0 {
            return Err("Process has exited and must be reaped".into());
        }
        Ok(usage)
    };
    let before = read()?;
    let mut path = [0u8; 4096];
    if unsafe { proc_pidpath(pid as c_int, path.as_mut_ptr().cast(), path.len() as u32) } <= 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let path = CStr::from_bytes_until_nul(&path).map_err(|e| e.to_string())?;
    let executable = PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes()));
    let mut boot = [0u8; 128];
    let mut length = boot.len();
    if unsafe {
        sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            boot.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || length > boot.len()
    {
        return Err("Cannot read the host boot identity".into());
    }
    let boot = CStr::from_bytes_until_nul(&boot[..length])
        .map_err(|e| e.to_string())?
        .to_str()
        .map_err(|e| e.to_string())?
        .to_owned();
    let after = read()?;
    if before.counters[8] != after.counters[8] || before.uuid != after.uuid {
        return Err("Process changed during identity lookup".into());
    }
    Ok(Identity {
        pid,
        executable,
        created: before.counters[8],
        boot,
    })
}

#[cfg(windows)]
fn native(pid: u32) -> Result<Identity, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE},
        System::Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    let handle = Handle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) });
    if handle.0.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut created: FILETIME = unsafe { std::mem::zeroed() };
    let mut exit = created;
    let mut kernel = created;
    let mut user = created;
    if unsafe { GetProcessTimes(handle.0, &mut created, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if exit.dwHighDateTime != 0 || exit.dwLowDateTime != 0 {
        return Err("Process has exited".into());
    }
    let mut path = vec![0u16; 32768];
    let mut length = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(handle.0, 0, path.as_mut_ptr(), &mut length) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(Identity {
        pid,
        executable: PathBuf::from(std::ffi::OsString::from_wide(&path[..length as usize])),
        created: (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime),
        // Windows creation FILETIME is an absolute timestamp, not boot-relative ticks.
        boot: String::new(),
    })
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn native(_: u32) -> Result<Identity, String> {
    Err("Host process identity is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_process_creation_and_executable_are_required_for_a_match() {
        let identity = Identity::read(std::process::id()).unwrap();
        assert_eq!(
            std::fs::canonicalize(&identity.executable).unwrap(),
            std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
        );
        assert!(identity.created > 0);
        assert!(identity.still_matches().unwrap());
        let mut stale = identity.clone();
        stale.created += 1;
        assert!(!stale.still_matches().unwrap());
        stale = identity;
        stale.executable = PathBuf::from("not-the-managed-emulator");
        assert!(!stale.still_matches().unwrap());
        assert!(Identity::read(0).is_err());
        assert!(Identity::read(u32::MAX).is_err());
    }
}
