use serde_json::{json, Value};
use std::collections::VecDeque;

/// Delivery acknowledgements never govern persistence or provider cancellation.
/// A stalled view receives one resync notice; only the latest snapshot is kept.
pub struct Delivery {
    pub epoch: u64,
    pub sequence: u64,
    pub snapshot: Value,
    pub terminal: Option<Value>,
    outstanding: VecDeque<(u64, usize)>,
    bytes: usize,
    pub response_bytes: usize,
    limit: usize,
    paused: bool,
}
impl Delivery {
    pub fn new(assistant: &str, limit: usize) -> Self {
        Self {
            epoch: 0,
            sequence: 0,
            snapshot: json!({"message":{"id":assistant,"role":"assistant","parts":[]},"blocks":{}}),
            terminal: None,
            outstanding: VecDeque::new(),
            bytes: 0,
            response_bytes: 0,
            limit,
            paused: false,
        }
    }
    #[cfg(feature = "chat-probe")]
    pub fn restore_production_window(&mut self) {
        self.limit = 4 * 1024 * 1024;
    }
    pub fn subscribe(&mut self) -> Value {
        self.epoch += 1;
        self.outstanding.clear();
        self.bytes = 0;
        self.paused = false;
        json!({"type":"snapshot","epoch":self.epoch,"sequence":self.sequence,"snapshot":self.snapshot,"terminal":self.terminal})
    }
    pub fn ack(&mut self, epoch: u64, sequence: u64) {
        if epoch != self.epoch || sequence > self.sequence {
            return;
        }
        while self
            .outstanding
            .front()
            .is_some_and(|(seq, _)| *seq <= sequence)
        {
            self.bytes -= self.outstanding.pop_front().unwrap().1;
        }
    }
    pub fn chunk(&mut self, sequence: u64, chunk: &Value) -> Result<Option<Value>, String> {
        if sequence <= self.sequence {
            return Err("Out-of-order AI event.".into());
        }
        let size = serde_json::to_vec(chunk)
            .map_err(|_| "Invalid response.")?
            .len();
        if self.response_bytes + size > 2 * 1024 * 1024 {
            return Err("Response exceeds the size limit.".into());
        }
        self.response_bytes += size;
        self.sequence = sequence;
        match chunk["type"].as_str() {
            Some("text-start" | "reasoning-start") => {
                let id = chunk["id"].as_str().ok_or("Missing block ID.")?;
                if self.snapshot["blocks"].get(id).is_some() {
                    return Err("Duplicate block ID.".into());
                }
                let kind = if chunk["type"] == "text-start" {
                    "text"
                } else {
                    "reasoning"
                };
                let parts = self.snapshot["message"]["parts"]
                    .as_array_mut()
                    .ok_or("Invalid snapshot.")?;
                let index = parts.len();
                if index >= 1024 {
                    return Err("Too many response blocks.".into());
                }
                parts.push(json!({"type":kind,"text":"","state":"streaming"}));
                self.snapshot["blocks"][id] = json!({"index":index,"type":kind,"open":true});
            }
            Some("text-delta" | "reasoning-delta" | "text-end" | "reasoning-end") => {
                let id = chunk["id"].as_str().ok_or("Missing block ID.")?;
                let block = &self.snapshot["blocks"][id];
                if block["open"] != true {
                    return Err("Missing open response block.".into());
                }
                let index = block["index"].as_u64().ok_or("Invalid response block.")? as usize;
                let part = &mut self.snapshot["message"]["parts"][index];
                if let Some(delta) = chunk["delta"].as_str() {
                    let text = part["text"].as_str().ok_or("Invalid response text.")?;
                    if text.len() + delta.len() > 2 * 1024 * 1024 {
                        return Err("Response exceeds the size limit.".into());
                    }
                    part["text"] = Value::String(format!("{text}{delta}"));
                } else {
                    part["state"] = json!("done");
                    self.snapshot["blocks"][id]["open"] = json!(false);
                }
            }
            Some("start") => (),
            _ => return Err("Unsupported AI stream part.".into()),
        }
        if self.paused {
            return Ok(None);
        }
        let bytes = serde_json::to_vec(chunk)
            .map_err(|_| "Invalid chunk.")?
            .len();
        if self.bytes + bytes > self.limit || self.outstanding.len() >= 4096 {
            self.paused = true;
            self.outstanding.clear();
            self.bytes = 0;
            return Ok(Some(
                json!({"type":"resync","epoch":self.epoch,"sequence":self.sequence}),
            ));
        }
        self.bytes += bytes;
        self.outstanding.push_back((sequence, bytes));
        Ok(Some(
            json!({"type":"chunk","epoch":self.epoch,"sequence":self.sequence,"chunk":chunk}),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_delivery_and_atomic_watermark() {
        let mut stream = Delivery::new("assistant", 200);
        let first = stream.subscribe();
        assert_eq!(first["epoch"], 1);
        stream
            .chunk(1, &json!({"type":"text-start","id":"p"}))
            .unwrap();
        let mut resyncs = 0;
        for sequence in 2..1000 {
            let event = stream
                .chunk(
                    sequence,
                    &json!({"type":"text-delta","id":"p","delta":"日"}),
                )
                .unwrap();
            resyncs += usize::from(event.is_some_and(|event| event["type"] == "resync"));
        }
        assert_eq!(resyncs, 1);
        assert!(stream.outstanding.is_empty());
        let snapshot = stream.subscribe();
        assert_eq!(snapshot["sequence"], 999);
        assert_eq!(
            snapshot["snapshot"]["message"]["parts"][0]["text"],
            "日".repeat(998)
        );
        assert_eq!(snapshot["snapshot"]["blocks"]["p"]["open"], true);
        stream
            .chunk(1000, &json!({"type":"text-delta","id":"p","delta":"本"}))
            .unwrap();
        stream.ack(1, 1000);
        assert!(!stream.outstanding.is_empty());
        stream.ack(2, 1000);
        assert!(stream.outstanding.is_empty());
    }
}
