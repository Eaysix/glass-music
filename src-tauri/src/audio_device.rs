//! Default render endpoint notifications. No background polling while idle.
#[cfg(target_os = "windows")]
use windows::{
    Foundation::TypedEventHandler,
    Media::Devices::{AudioDeviceRole, DefaultAudioRenderDeviceChangedEventArgs, MediaDevice},
};

pub struct Watcher {
    #[cfg(target_os = "windows")]
    token: i64,
}
impl Watcher {
    pub fn new(notify: impl Fn() + Send + Sync + 'static) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            let token = MediaDevice::DefaultAudioRenderDeviceChanged(&TypedEventHandler::new(
                move |_, args: windows::core::Ref<'_, DefaultAudioRenderDeviceChangedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        if args.Role()? == AudioDeviceRole::Default {
                            notify();
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| e.to_string())?;
            Ok(Self { token })
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = notify;
            Ok(Self {})
        }
    }
}
#[cfg(target_os = "windows")]
impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = MediaDevice::RemoveDefaultAudioRenderDeviceChanged(self.token);
    }
}
/// Also checked by existing play/status requests as a fallback if subscription fails.
pub fn default_id() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        MediaDevice::GetDefaultAudioRenderId(AudioDeviceRole::Default)
            .ok()
            .map(|id| id.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}
