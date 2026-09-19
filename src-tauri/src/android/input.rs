use super::{adb::Guest, auth, manager::Manager, rpc::Connection, storage::valid_id};
use crate::android_protocol as proto;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::Semaphore;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Focus {
        #[serde(rename = "viewId")]
        view_id: String,
    },
    Blur {
        lease: String,
    },
    Send {
        lease: String,
        sequence: u64,
        event: Event,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Event {
    Key {
        key: String,
        down: bool,
    },
    Navigation {
        key: String,
    },
    Touch {
        identifier: i32,
        x: i32,
        y: i32,
        phase: TouchPhase,
    },
    Text {
        action: TextAction,
        text: String,
    },
    Paste {
        text: String,
    },
    Rotate {
        #[serde(rename = "quarterTurns")]
        quarter_turns: u32,
    },
    Settings,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TouchPhase {
    Down,
    Move,
    Up,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TextAction {
    Commit,
    Compose,
    Finish,
    Delete,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub lease: Option<String>,
    pub sequence: u64,
}

pub enum Command {
    Focus(String),
    Release,
    Send {
        lease: String,
        sequence: u64,
        event: Event,
    },
}

struct Owner {
    device: String,
    generation: String,
    view: String,
    lease: String,
}

/// One native focus owner across all phones. The sole in-flight command is
/// retained after an invoke disappears; callers cannot queue unbounded input.
pub struct Router {
    gate: Arc<Semaphore>,
    owner: Mutex<Option<Owner>>,
    releasing: AtomicBool,
}
impl Default for Router {
    fn default() -> Self {
        Self {
            gate: Arc::new(Semaphore::new(1)),
            owner: Mutex::new(None),
            releasing: AtomicBool::new(false),
        }
    }
}
impl Router {
    pub async fn submit(
        manager: Arc<Manager>,
        device: String,
        generation: String,
        request: Request,
    ) -> Result<Reply, String> {
        if manager.input.releasing.load(Ordering::Acquire) {
            return Err(
                "Android input is releasing focus. Try again after focusing the phone.".into(),
            );
        }
        let permit = manager
            .input
            .gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Android input is busy. Wait for the current action.")?;
        tokio::spawn(async move {
            let _permit = permit;
            let runtime = manager.runtime(&device, &generation)?;
            match request {
                Request::Focus { view_id } => {
                    if !valid_id(&view_id) { return Err("Invalid Android view identity".into()); }
                    Self::release(&manager).await?;
                    let lease = auth::new_id()?;
                    let reply = runtime.input(generation.clone(), Command::Focus(lease.clone())).await?;
                    *manager.input.owner.lock().map_err(|_| "Android focus failed")? = Some(Owner { device, generation, view: view_id, lease });
                    Ok(reply)
                }
                Request::Blur { lease } => {
                    let current = manager.input.owner.lock().map_err(|_| "Android focus failed")?.as_ref().is_some_and(|owner| owner.device == device && owner.generation == generation && owner.lease == lease);
                    if current { Self::release(&manager).await?; }
                    Ok(Reply { lease: None, sequence: 0 })
                }
                Request::Send { lease, sequence, event } => {
                    if !manager.input.owner.lock().map_err(|_| "Android focus failed")?.as_ref().is_some_and(|owner| owner.device == device && owner.generation == generation && owner.lease == lease) {
                        return Err("This Android view no longer owns keyboard and touch input. Focus the phone again.".into());
                    }
                    runtime.input(generation, Command::Send { lease, sequence, event }).await
                }
            }
        }).await.map_err(|_| "Android input operation failed")?
    }

    async fn release(manager: &Arc<Manager>) -> Result<(), String> {
        let previous = manager
            .input
            .owner
            .lock()
            .map_err(|_| "Android focus failed")?
            .as_ref()
            .map(|owner| {
                (
                    owner.device.clone(),
                    owner.generation.clone(),
                    owner.view.clone(),
                )
            });
        if let Some((device, generation, _view)) = previous {
            if let Ok(runtime) = manager.runtime(&device, &generation) {
                runtime.input(generation, Command::Release).await?;
            }
            *manager
                .input
                .owner
                .lock()
                .map_err(|_| "Android focus failed")? = None;
        }
        Ok(())
    }

    pub fn release_from_host(manager: Arc<Manager>) {
        if manager.input.releasing.swap(true, Ordering::AcqRel) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            if let Ok(_permit) = manager.input.gate.clone().acquire_owned().await {
                if let Err(error) = Self::release(&manager).await {
                    manager.emit(super::events::Event::InputError(error));
                }
            }
            manager.input.releasing.store(false, Ordering::Release);
        });
    }
}

#[derive(Default)]
pub struct State {
    lease: Option<String>,
    sequence: u64,
    keys: BTreeSet<String>,
    touches: BTreeMap<i32, (i32, i32)>,
    composing: bool,
}
impl State {
    pub async fn apply(
        &mut self,
        command: Command,
        connection: &Connection,
        guest: &Guest,
        display: (u32, u32),
    ) -> Result<Reply, String> {
        match command {
            Command::Release => {
                self.release(connection, guest).await?;
                self.lease = None;
            }
            Command::Focus(lease) => {
                self.release(connection, guest).await?;
                self.lease = Some(lease);
                self.sequence = 0;
            }
            Command::Send {
                lease,
                sequence,
                event,
            } => {
                if self.lease.as_deref() != Some(&lease)
                    || self.sequence.checked_add(1) != Some(sequence)
                    || sequence >= (1u64 << 53)
                {
                    return Err("Stale or unordered Android input. Focus the phone again.".into());
                }
                validate(&event, display)?;
                // A lost response must never replay text or a navigation action.
                self.sequence = sequence;
                match event {
                    Event::Key { key, down } => {
                        if down && self.keys.len() >= 8 && !self.keys.contains(&key) {
                            return Err("Too many simultaneous Android keys. Release the keyboard and refocus the phone.".into());
                        }
                        if down {
                            self.keys.insert(key.clone());
                        }
                        key_event(connection, &key, if down { 0 } else { 1 }).await?;
                        if !down {
                            self.keys.remove(&key);
                        }
                    }
                    Event::Navigation { key } => key_event(connection, &key, 2).await?,
                    Event::Touch {
                        identifier,
                        x,
                        y,
                        phase,
                    } => {
                        match phase {
                            TouchPhase::Down if self.touches.contains_key(&identifier) => {
                                return Err("Android touch is already down".into())
                            }
                            TouchPhase::Move | TouchPhase::Up
                                if !self.touches.contains_key(&identifier) =>
                            {
                                return Err("Android touch has no matching down event".into())
                            }
                            _ => {}
                        }
                        self.touches.insert(identifier, (x, y));
                        touch_event(
                            connection,
                            identifier,
                            x,
                            y,
                            if phase == TouchPhase::Up { 0 } else { 1024 },
                        )
                        .await?;
                        if phase == TouchPhase::Up {
                            self.touches.remove(&identifier);
                        }
                    }
                    Event::Text { action, text } => {
                        if action == TextAction::Compose {
                            self.composing = true;
                        }
                        let guest = guest.clone();
                        let name = match action {
                            TextAction::Commit => "commit",
                            TextAction::Compose => "compose",
                            TextAction::Finish => "finish",
                            TextAction::Delete => "delete",
                        };
                        tokio::task::spawn_blocking(move || guest.text(name, &text))
                            .await
                            .map_err(|e| e.to_string())??;
                        if matches!(action, TextAction::Commit | TextAction::Finish) {
                            self.composing = false;
                        }
                    }
                    Event::Paste { text } => {
                        // Emulator clipboard acknowledgement precedes guest delivery.
                        // The selected IME sets the real guest clipboard and invokes
                        // Android's Paste action in order, only for explicit Paste.
                        let guest = guest.clone();
                        tokio::task::spawn_blocking(move || guest.text("paste", &text))
                            .await
                            .map_err(|e| e.to_string())??;
                    }
                    Event::Rotate { quarter_turns } => {
                        self.release(connection, guest).await?;
                        connection
                            .client()
                            .set_physical_model(connection.request(
                                "setPhysicalModel",
                                proto::PhysicalModelValue {
                                    target: proto::physical_model_value::PhysicalType::Rotation
                                        as i32,
                                    value: Some(proto::ParameterValue {
                                        data: vec![
                                            0.0,
                                            0.0,
                                            [0.0, 90.0, 180.0, -90.0][quarter_turns as usize],
                                        ],
                                    }),
                                    interpolation: proto::physical_model_value::Interpolation::Step
                                        as i32,
                                    ..Default::default()
                                },
                            )?)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                    Event::Settings => {
                        let guest = guest.clone();
                        tokio::task::spawn_blocking(move || guest.open_settings())
                            .await
                            .map_err(|e| e.to_string())??;
                    }
                }
            }
        }
        Ok(Reply {
            lease: self.lease.clone(),
            sequence: self.sequence,
        })
    }

    pub async fn release(&mut self, connection: &Connection, guest: &Guest) -> Result<(), String> {
        let mut failure = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let mut failure = None;
            for key in self.keys.clone() {
                match key_event(connection, &key, 1).await {
                    Ok(()) => {
                        self.keys.remove(&key);
                    }
                    Err(error) => failure = Some(error),
                }
            }
            for (id, (x, y)) in self.touches.clone() {
                match touch_event(connection, id, x, y, 0).await {
                    Ok(()) => {
                        self.touches.remove(&id);
                    }
                    Err(error) => failure = Some(error),
                }
            }
            failure
        })
        .await
        .unwrap_or_else(|_| {
            Some(
                "Android did not release all input in time. Retry Stop or reconnect the phone."
                    .into(),
            )
        });
        if self.composing {
            let guest = guest.clone();
            // The field may have disappeared since composition started. Ending
            // composition cannot retain a physical key or finger in the guest.
            let _ = tokio::task::spawn_blocking(move || guest.text("finish", "")).await;
            self.composing = false;
        }
        failure.take().map_or(Ok(()), Err)
    }
}

fn validate(event: &Event, display: (u32, u32)) -> Result<(), String> {
    let valid = match event {
        Event::Key { key, .. } => {
            key.len() == 1 && key.as_bytes()[0].is_ascii_graphic()
                || [
                    "Alt",
                    "AltGraph",
                    "Control",
                    "Shift",
                    "Meta",
                    "Escape",
                    "Enter",
                    "Tab",
                    "Backspace",
                    "Delete",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                    " ",
                ]
                .contains(&key.as_str())
        }
        Event::Navigation { key } => {
            ["GoBack", "GoHome", "AppSwitch", "Power"].contains(&key.as_str())
        }
        Event::Touch {
            identifier, x, y, ..
        } => {
            (0..=1).contains(identifier)
                && *x >= 0
                && *y >= 0
                && (*x as u32) < display.0
                && (*y as u32) < display.1
        }
        Event::Text { text, action } => {
            text.len() <= 16384
                && (!matches!(action, TextAction::Finish | TextAction::Delete) || text.is_empty())
        }
        Event::Paste { text } => text.len() <= 16384,
        Event::Rotate { quarter_turns } => *quarter_turns <= 3,
        Event::Settings => true,
    };
    if valid {
        Ok(())
    } else {
        Err("Invalid Android input event".into())
    }
}

async fn key_event(connection: &Connection, key: &str, event_type: i32) -> Result<(), String> {
    connection
        .client()
        .send_key(connection.request(
            "sendKey",
            proto::KeyboardEvent {
                key: key.into(),
                event_type,
                ..Default::default()
            },
        )?)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
async fn touch_event(
    connection: &Connection,
    identifier: i32,
    x: i32,
    y: i32,
    pressure: i32,
) -> Result<(), String> {
    connection
        .client()
        .send_touch(connection.request(
            "sendTouch",
            proto::TouchEvent {
                touches: vec![proto::Touch {
                    identifier,
                    x,
                    y,
                    pressure,
                    ..Default::default()
                }],
                ..Default::default()
            },
        )?)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_and_control_validation_do_not_treat_unicode_as_emulator_key_codes() {
        let display = (720, 1280);
        assert!(validate(
            &Event::Text {
                action: TextAction::Commit,
                text: "Zażółć gęślą jaźń日本語".into()
            },
            display
        )
        .is_ok());
        assert!(validate(
            &Event::Key {
                key: "ż".into(),
                down: true
            },
            display
        )
        .is_err());
        assert!(validate(
            &Event::Text {
                action: TextAction::Finish,
                text: "unexpected payload".into()
            },
            display
        )
        .is_err());
        assert!(validate(
            &Event::Paste {
                text: "x".repeat(16385)
            },
            display
        )
        .is_err());
        for (id, x, y) in [(2, 0, 0), (0, -1, 0), (0, 720, 0), (0, 0, 1280)] {
            assert!(validate(
                &Event::Touch {
                    identifier: id,
                    x,
                    y,
                    phase: TouchPhase::Down
                },
                display
            )
            .is_err());
        }
        assert!(validate(
            &Event::Touch {
                identifier: 1,
                x: 719,
                y: 1279,
                phase: TouchPhase::Down
            },
            display
        )
        .is_ok());
        assert!(
            serde_json::from_str::<Request>(r#"{"type":"focus","viewId":"x","port":5554}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<Event>(r#"{"type":"shell","command":"echo unexpected"}"#)
                .is_err()
        );
    }
}
