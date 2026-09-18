pub mod attachments;
pub mod backend;
pub mod commands;
pub mod credentials;
pub mod delivery;
pub mod preferences;
pub mod process;
pub mod storage;
pub mod store;

#[cfg(windows)]
mod windows_permissions;
