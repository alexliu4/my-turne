use serde_json::Value;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VolumeStatePayload {
    pub volume: u8,
    pub volume_percent: u8,
    pub muted: bool,
}

impl VolumeStatePayload {
    pub fn new(volume: u8, muted: bool) -> Self {
        let vol = volume.min(100);
        Self {
            volume: vol,
            volume_percent: vol,
            muted,
        }
    }

    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "volume": self.volume,
            "volumePercent": self.volume_percent,
            "muted": self.muted
        })
    }
}

pub struct VolumeManager {
    volume: Mutex<u8>,
    muted: Mutex<bool>,
}

impl VolumeManager {
    pub fn new(initial_volume: u8, initial_muted: bool) -> Self {
        Self {
            volume: Mutex::new(initial_volume.min(100)),
            muted: Mutex::new(initial_muted),
        }
    }

    pub fn get_state(&self) -> VolumeStatePayload {
        let vol = *self.volume.lock().unwrap();
        let muted = *self.muted.lock().unwrap();
        VolumeStatePayload::new(vol, muted)
    }

    pub fn set_volume(&self, target: u8) -> VolumeStatePayload {
        let mut vol = self.volume.lock().unwrap();
        *vol = target.min(100);
        let muted = *self.muted.lock().unwrap();
        VolumeStatePayload::new(*vol, muted)
    }

    pub fn adjust_volume(&self, delta: i8) -> VolumeStatePayload {
        let mut vol = self.volume.lock().unwrap();
        let new_vol = (*vol as i16 + delta as i16).clamp(0, 100) as u8;
        *vol = new_vol;
        let muted = *self.muted.lock().unwrap();
        VolumeStatePayload::new(*vol, muted)
    }

    pub fn toggle_mute(&self, target_muted: Option<bool>) -> VolumeStatePayload {
        let mut muted = self.muted.lock().unwrap();
        *muted = target_muted.unwrap_or(!*muted);
        let vol = *self.volume.lock().unwrap();
        VolumeStatePayload::new(vol, *muted)
    }

    pub fn handle_action(&self, action: &str, payload: Option<&Value>) -> Result<VolumeStatePayload, String> {
        match action {
            "volume.get" => Ok(self.get_state()),
            "volume.set" => {
                let target = if let Some(p) = payload {
                    if let Some(vol) = p.get("volume").and_then(|v| v.as_u64()) {
                        Some(vol as u8)
                    } else if let Some(vol_pct) = p.get("volumePercent").and_then(|v| v.as_u64()) {
                        Some(vol_pct as u8)
                    } else if let Some(n) = p.as_u64() {
                        Some(n as u8)
                    } else {
                        None
                    }
                } else {
                    None
                };
                let target_vol = target.ok_or_else(|| "Missing volume or volumePercent in payload".to_string())?;
                Ok(self.set_volume(target_vol))
            }
            "volume.adjust" => {
                let delta = if let Some(p) = payload {
                    if let Some(d) = p.get("delta").and_then(|v| v.as_i64()) {
                        d as i8
                    } else if let Some(n) = p.as_i64() {
                        n as i8
                    } else {
                        0
                    }
                } else {
                    0
                };
                Ok(self.adjust_volume(delta))
            }
            "volume.toggleMute" | "volume.mute" => {
                let muted_target = payload.and_then(|p| {
                    p.get("muted").and_then(|v| v.as_bool()).or_else(|| p.as_bool())
                });
                Ok(self.toggle_mute(muted_target))
            }
            _ => Err(format!("Unknown volume action: {action}")),
        }
    }
}

impl Default for VolumeManager {
    fn default() -> Self {
        Self::new(75, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_volume_manager_actions() {
        let mgr = VolumeManager::new(50, false);
        let state = mgr.get_state();
        assert_eq!(state.volume, 50);
        assert_eq!(state.muted, false);

        // set volume
        let res = mgr.handle_action("volume.set", Some(&json!({ "volume": 80 }))).unwrap();
        assert_eq!(res.volume, 80);

        // adjust volume
        let res = mgr.handle_action("volume.adjust", Some(&json!({ "delta": -15 }))).unwrap();
        assert_eq!(res.volume, 65);

        // toggle mute
        let res = mgr.handle_action("volume.toggleMute", None).unwrap();
        assert_eq!(res.muted, true);

        // toggle mute back
        let res = mgr.handle_action("volume.toggleMute", Some(&json!({ "muted": false }))).unwrap();
        assert_eq!(res.muted, false);
    }
}
