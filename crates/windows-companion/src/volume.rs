use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeStatePayload {
    pub volume_percent: u8,
    pub muted: bool,
}

impl VolumeStatePayload {
    pub fn new(volume_percent: u8, muted: bool) -> Self {
        Self {
            volume_percent: volume_percent.min(100),
            muted,
        }
    }

    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "volumePercent": self.volume_percent,
            "muted": self.muted
        })
    }
}

pub trait AudioBackend: Send + Sync {
    fn get_state(&self) -> Result<VolumeStatePayload, String>;
    fn set_volume(&self, percent: u8) -> Result<VolumeStatePayload, String>;
    fn adjust_volume(&self, delta: i8) -> Result<VolumeStatePayload, String>;
    fn set_mute(&self, muted: bool) -> Result<VolumeStatePayload, String>;
    fn toggle_mute(&self) -> Result<VolumeStatePayload, String>;
}

// ----------------------------------------------------------------------------
// Simulated/Mock Audio Backend (used for tests and non-Windows targets)
// ----------------------------------------------------------------------------

pub struct MockAudioBackend {
    state: Mutex<(u8, bool)>,
    tx: broadcast::Sender<VolumeStatePayload>,
}

impl MockAudioBackend {
    pub fn new(
        initial_volume: u8,
        initial_muted: bool,
        tx: broadcast::Sender<VolumeStatePayload>,
    ) -> Self {
        Self {
            state: Mutex::new((initial_volume.min(100), initial_muted)),
            tx,
        }
    }
}

impl AudioBackend for MockAudioBackend {
    fn get_state(&self) -> Result<VolumeStatePayload, String> {
        let guard = self.state.lock().unwrap();
        Ok(VolumeStatePayload::new(guard.0, guard.1))
    }

    fn set_volume(&self, percent: u8) -> Result<VolumeStatePayload, String> {
        let mut guard = self.state.lock().unwrap();
        let target = percent.min(100);
        guard.0 = target;
        let payload = VolumeStatePayload::new(guard.0, guard.1);
        let _ = self.tx.send(payload.clone());
        Ok(payload)
    }

    fn adjust_volume(&self, delta: i8) -> Result<VolumeStatePayload, String> {
        let mut guard = self.state.lock().unwrap();
        let new_vol = (guard.0 as i16 + delta as i16).clamp(0, 100) as u8;
        guard.0 = new_vol;
        let payload = VolumeStatePayload::new(guard.0, guard.1);
        let _ = self.tx.send(payload.clone());
        Ok(payload)
    }

    fn set_mute(&self, muted: bool) -> Result<VolumeStatePayload, String> {
        let mut guard = self.state.lock().unwrap();
        guard.1 = muted;
        let payload = VolumeStatePayload::new(guard.0, guard.1);
        let _ = self.tx.send(payload.clone());
        Ok(payload)
    }

    fn toggle_mute(&self) -> Result<VolumeStatePayload, String> {
        let mut guard = self.state.lock().unwrap();
        guard.1 = !guard.1;
        let payload = VolumeStatePayload::new(guard.0, guard.1);
        let _ = self.tx.send(payload.clone());
        Ok(payload)
    }
}

// ----------------------------------------------------------------------------
// Windows Native Core Audio Backend (target_os = "windows")
// ----------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use windows::core::*;
    use windows::Win32::Media::Audio::Endpoints::*;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    pub struct WindowsAudioBackend {
        volume: IAudioEndpointVolume,
        callback: IAudioEndpointVolumeCallback,
    }

    // Windows Core Audio interfaces (IAudioEndpointVolume, IAudioEndpointVolumeCallback)
    // belong to the Multithreaded Apartment (MTA) model and safely support concurrent
    // calls across threads.
    unsafe impl Send for WindowsAudioBackend {}
    unsafe impl Sync for WindowsAudioBackend {}

    struct ComThreadGuard;
    impl ComThreadGuard {
        fn new() -> Self {
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED).ok();
            }
            Self
        }
    }
    impl Drop for ComThreadGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    #[implement(IAudioEndpointVolumeCallback)]
    struct VolumeCallback {
        tx: broadcast::Sender<VolumeStatePayload>,
    }

    impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
        fn OnNotify(&self, pnotifydata: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
            let _com = ComThreadGuard::new();
            unsafe {
                if !pnotifydata.is_null() {
                    let data = &*pnotifydata;
                    let vol = (data.fMasterVolume * 100.0).round().clamp(0.0, 100.0) as u8;
                    let muted = data.bMuted.as_bool();
                    let payload = VolumeStatePayload::new(vol, muted);
                    let _ = self.tx.send(payload);
                }
            }
            Ok(())
        }
    }

    impl WindowsAudioBackend {
        pub fn new(tx: broadcast::Sender<VolumeStatePayload>) -> std::result::Result<Self, String> {
            let _com = ComThreadGuard::new();
            unsafe {
                let setup = || -> Result<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)> {
                    let enumerator: IMMDeviceEnumerator =
                        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                    let device: IMMDevice = enumerator
                        .GetDefaultAudioEndpoint(eRender, eMultimedia)?;
                    let volume: IAudioEndpointVolume = device
                        .Activate(CLSCTX_ALL, None)?;
                    let callback: IAudioEndpointVolumeCallback = VolumeCallback { tx }.into();
                    volume.RegisterControlChangeNotify(&callback)?;
                    Ok((volume, callback))
                };

                match setup() {
                    Ok((volume, callback)) => Ok(Self {
                        volume,
                        callback,
                    }),
                    Err(err) => Err(format!("Failed to initialize Windows Core Audio volume backend: {err}")),
                }
            }
        }
    }

    impl Drop for WindowsAudioBackend {
        fn drop(&mut self) {
            let _com = ComThreadGuard::new();
            unsafe {
                let _ = self.volume.UnregisterControlChangeNotify(&self.callback);
            }
        }
    }

    impl AudioBackend for WindowsAudioBackend {
        fn get_state(&self) -> std::result::Result<VolumeStatePayload, String> {
            let _com = ComThreadGuard::new();
            unsafe {
                let level = self
                    .volume
                    .GetMasterVolumeLevelScalar()
                    .map_err(|e| format!("GetMasterVolumeLevelScalar error: {e}"))?;
                let muted = self
                    .volume
                    .GetMute()
                    .map_err(|e| format!("GetMute error: {e}"))?
                    .as_bool();
                let vol_pct = (level * 100.0).round().clamp(0.0, 100.0) as u8;
                Ok(VolumeStatePayload::new(vol_pct, muted))
            }
        }

        fn set_volume(&self, percent: u8) -> std::result::Result<VolumeStatePayload, String> {
            let _com = ComThreadGuard::new();
            unsafe {
                let scalar = (percent.min(100) as f32) / 100.0;
                self.volume
                    .SetMasterVolumeLevelScalar(scalar, std::ptr::null())
                    .map_err(|e| format!("SetMasterVolumeLevelScalar error: {e}"))?;
            }
            self.get_state()
        }

        fn adjust_volume(&self, delta: i8) -> std::result::Result<VolumeStatePayload, String> {
            let current = self.get_state()?;
            let new_vol = (current.volume_percent as i16 + delta as i16).clamp(0, 100) as u8;
            self.set_volume(new_vol)
        }

        fn set_mute(&self, muted: bool) -> std::result::Result<VolumeStatePayload, String> {
            let _com = ComThreadGuard::new();
            unsafe {
                self.volume
                    .SetMute(muted, std::ptr::null())
                    .map_err(|e| format!("SetMute error: {e}"))?;
            }
            self.get_state()
        }

        fn toggle_mute(&self) -> std::result::Result<VolumeStatePayload, String> {
            let current = self.get_state()?;
            self.set_mute(!current.muted)
        }
    }
}

// ----------------------------------------------------------------------------
// Volume Manager Facade
// ----------------------------------------------------------------------------

pub struct VolumeManager {
    backend: Arc<dyn AudioBackend>,
}

impl VolumeManager {
    pub fn new_mock(initial_volume: u8, initial_muted: bool) -> (Self, broadcast::Receiver<VolumeStatePayload>) {
        let (tx, rx) = broadcast::channel(16);
        let backend = Arc::new(MockAudioBackend::new(initial_volume, initial_muted, tx));
        (Self { backend }, rx)
    }

    pub fn try_new_auto() -> Result<(Self, broadcast::Receiver<VolumeStatePayload>), String> {
        let (tx, rx) = broadcast::channel(16);
        #[cfg(target_os = "windows")]
        {
            let win_backend = windows_impl::WindowsAudioBackend::new(tx.clone())?;
            return Ok((Self { backend: Arc::new(win_backend) }, rx));
        }

        #[cfg(not(target_os = "windows"))]
        {
            let backend = Arc::new(MockAudioBackend::new(75, false, tx));
            Ok((Self { backend }, rx))
        }
    }

    pub fn get_state(&self) -> Result<VolumeStatePayload, String> {
        self.backend.get_state()
    }

    pub fn handle_action(&self, action: &str, payload: Option<&Value>) -> Result<VolumeStatePayload, String> {
        match action {
            "volume.get" => self.backend.get_state(),
            "volume.set" => {
                let p = payload.ok_or_else(|| "Missing payload for volume.set".to_string())?;
                let target = extract_u8_percent(p).ok_or_else(|| "Invalid or missing volume/volumePercent in payload".to_string())?;
                self.backend.set_volume(target)
            }
            "volume.adjust" => {
                let p = payload.ok_or_else(|| "Missing payload for volume.adjust".to_string())?;
                let delta = extract_i8_delta(p).ok_or_else(|| "Invalid or missing delta in payload".to_string())?;
                self.backend.adjust_volume(delta)
            }
            "volume.toggleMute" | "volume.mute" => {
                if let Some(p) = payload {
                    if let Some(target_mute) = extract_bool_mute(p) {
                        return self.backend.set_mute(target_mute);
                    } else if !p.is_null() && p.as_object().map_or(true, |o| !o.is_empty()) {
                        return Err("Invalid boolean value for muted".to_string());
                    }
                }
                self.backend.toggle_mute()
            }
            _ => Err(format!("Unknown volume action: {action}")),
        }
    }
}

// ----------------------------------------------------------------------------
// Payload Parsing Helpers with Safe Boundary Validation
// ----------------------------------------------------------------------------

fn extract_u8_percent(val: &Value) -> Option<u8> {
    if let Some(num) = val.get("volumePercent").or_else(|| val.get("volume")) {
        if let Some(n) = num.as_u64() {
            if n <= 100 {
                return Some(n as u8);
            }
        }
    } else if let Some(n) = val.as_u64() {
        if n <= 100 {
            return Some(n as u8);
        }
    }
    None
}

fn extract_i8_delta(val: &Value) -> Option<i8> {
    if let Some(num) = val.get("delta") {
        if let Some(n) = num.as_i64() {
            if n >= -100 && n <= 100 {
                return Some(n as i8);
            }
        }
    } else if let Some(n) = val.as_i64() {
        if n >= -100 && n <= 100 {
            return Some(n as i8);
        }
    }
    None
}

fn extract_bool_mute(val: &Value) -> Option<bool> {
    if let Some(b) = val.get("muted") {
        if let Some(v) = b.as_bool() {
            return Some(v);
        }
    } else if let Some(v) = val.as_bool() {
        return Some(v);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_mock_volume_manager_actions() {
        let (mgr, mut rx) = VolumeManager::new_mock(50, false);

        let state = mgr.get_state().unwrap();
        assert_eq!(state.volume_percent, 50);
        assert!(!state.muted);

        // set volume valid
        let res = mgr.handle_action("volume.set", Some(&json!({ "volumePercent": 80 }))).unwrap();
        assert_eq!(res.volume_percent, 80);
        assert_eq!(rx.try_recv().unwrap().volume_percent, 80);

        // adjust volume valid
        let res = mgr.handle_action("volume.adjust", Some(&json!({ "delta": -15 }))).unwrap();
        assert_eq!(res.volume_percent, 65);
        assert_eq!(rx.try_recv().unwrap().volume_percent, 65);

        // toggle mute
        let res = mgr.handle_action("volume.toggleMute", None).unwrap();
        assert!(res.muted);
        assert!(rx.try_recv().unwrap().muted);

        // explicit mute
        let res = mgr.handle_action("volume.toggleMute", Some(&json!({ "muted": false }))).unwrap();
        assert!(!res.muted);
    }

    #[test]
    fn test_boundary_and_malformed_inputs() {
        let (mgr, _rx) = VolumeManager::new_mock(50, false);

        // Out of bounds positive volume (> 100) rejected
        assert!(mgr.handle_action("volume.set", Some(&json!({ "volumePercent": 150 }))).is_err());

        // Negative volume set rejected
        assert!(mgr.handle_action("volume.set", Some(&json!({ "volumePercent": -20 }))).is_err());

        // Out of bounds delta rejected
        assert!(mgr.handle_action("volume.adjust", Some(&json!({ "delta": 500 }))).is_err());

        // String payload instead of integer rejected
        assert!(mgr.handle_action("volume.set", Some(&json!({ "volumePercent": "80" }))).is_err());

        // Malformed explicit mute payload rejected
        assert!(mgr.handle_action("volume.toggleMute", Some(&json!({ "muted": "invalid" }))).is_err());

        // Missing payload rejected
        assert!(mgr.handle_action("volume.set", None).is_err());
    }
}
