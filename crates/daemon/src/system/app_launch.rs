use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, OnceCell};

const SETTINGS_PATH: &str = "/var/lib/nocturne/app-launch.json";
static SETTINGS: OnceCell<Mutex<AppLaunchStore>> = OnceCell::const_new();

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AppLaunchSettings {
    pub foreground: bool,
    #[serde(default = "default_spotify")]
    pub spotify: bool,
}

fn default_spotify() -> bool {
    true
}

impl Default for AppLaunchSettings {
    fn default() -> Self {
        Self {
            foreground: true,
            spotify: default_spotify(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AppLaunchUpdate {
    pub foreground: Option<bool>,
    pub spotify: Option<bool>,
}

impl AppLaunchUpdate {
    fn apply(self, settings: AppLaunchSettings) -> AppLaunchSettings {
        AppLaunchSettings {
            foreground: self.foreground.unwrap_or(settings.foreground),
            spotify: self.spotify.unwrap_or(settings.spotify),
        }
    }
}

struct AppLaunchStore {
    path: PathBuf,
    settings: AppLaunchSettings,
}

impl AppLaunchStore {
    async fn load(path: &Path) -> Result<Self> {
        let settings = match tokio::fs::read(path).await {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                AppLaunchSettings::default()
            }
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path: path.to_owned(),
            settings,
        })
    }

    async fn set(&mut self, settings: AppLaunchSettings) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(&settings)?;
        let mut file = tokio::fs::File::create(&temporary).await?;
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        tokio::fs::rename(&temporary, &self.path).await?;
        self.settings = settings;
        if let Some(parent) = self.path.parent() {
            tokio::fs::File::open(parent).await?.sync_all().await?;
        }
        Ok(())
    }
}

async fn store() -> Result<&'static Mutex<AppLaunchStore>> {
    SETTINGS
        .get_or_try_init(|| async {
            AppLaunchStore::load(Path::new(SETTINGS_PATH))
                .await
                .map(Mutex::new)
        })
        .await
}

pub async fn get() -> Result<AppLaunchSettings> {
    Ok(store().await?.lock().await.settings)
}

pub async fn update(update: AppLaunchUpdate) -> Result<AppLaunchSettings> {
    let mut store = store().await?.lock().await;
    let settings = update.apply(store.settings);
    store.set(settings).await?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_to_foreground_and_retains_background_after_reload() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state/app-launch.json");
        let mut store = AppLaunchStore::load(&path).await?;
        assert!(store.settings.foreground);
        assert!(store.settings.spotify);
        store
            .set(AppLaunchSettings {
                foreground: false,
                spotify: false,
            })
            .await?;
        assert!(!AppLaunchStore::load(&path).await?.settings.foreground);
        store.set(AppLaunchSettings::default()).await?;
        assert!(AppLaunchStore::load(&path).await?.settings.foreground);
        Ok(())
    }

    #[tokio::test]
    async fn legacy_saved_preference_loads_with_spotify_enabled() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("app-launch.json");
        tokio::fs::write(&path, br#"{"foreground":false}"#).await?;
        let settings = AppLaunchStore::load(&path).await?.settings;
        assert!(!settings.foreground);
        assert!(settings.spotify);
        Ok(())
    }

    #[test]
    fn partial_update_preserves_omitted_fields() {
        let saved = AppLaunchSettings {
            foreground: false,
            spotify: true,
        };
        let foreground_only: AppLaunchUpdate =
            serde_json::from_str(r#"{"foreground":true}"#).unwrap();
        assert_eq!(
            foreground_only.apply(saved),
            AppLaunchSettings {
                foreground: true,
                spotify: true,
            }
        );
        let spotify_only: AppLaunchUpdate = serde_json::from_str(r#"{"spotify":false}"#).unwrap();
        assert_eq!(
            spotify_only.apply(saved),
            AppLaunchSettings {
                foreground: false,
                spotify: false,
            }
        );
        assert!(serde_json::from_str::<AppLaunchUpdate>(r#"{"spotify":"true"}"#).is_err());
        assert!(serde_json::from_str::<AppLaunchUpdate>(r#"{"other":true}"#).is_err());
    }

    #[tokio::test]
    async fn invalid_saved_preference_does_not_enable_foreground_launch() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("app-launch.json");
        tokio::fs::write(&path, br#"{"foreground":"false"}"#).await?;
        assert!(AppLaunchStore::load(&path).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn failed_save_preserves_current_preference() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("app-launch.json");
        let mut store = AppLaunchStore::load(&path).await?;
        tokio::fs::create_dir(&path).await?;
        assert!(store
            .set(AppLaunchSettings {
                foreground: false,
                spotify: true,
            })
            .await
            .is_err());
        assert!(store.settings.foreground);
        Ok(())
    }
}
