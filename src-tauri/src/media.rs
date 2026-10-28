//! Windows SMTC publishes to Windows/Nusa; lyrics remain local to Glass Music.
use serde::Serialize;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlEvent {
    pub action: &'static str,
    pub position: Option<f64>,
}
#[derive(Clone, PartialEq)]
pub struct Metadata {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: String,
    pub duration: f64,
}
pub fn bounded_position(position: f64, duration: f64) -> f64 {
    let end = if duration.is_finite() {
        duration.max(0.0)
    } else {
        0.0
    };
    if position.is_finite() {
        position.max(0.0).min(end)
    } else {
        0.0
    }
}
#[cfg(target_os = "windows")]
mod windows_session {
    use super::*;
    use std::sync::{Arc, Mutex};
    use windows::{
        core::HSTRING,
        Foundation::{TimeSpan, TypedEventHandler},
        Media::{
            MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
            SystemMediaTransportControls, SystemMediaTransportControlsButton,
            SystemMediaTransportControlsButtonPressedEventArgs,
            SystemMediaTransportControlsDisplayUpdater,
            SystemMediaTransportControlsTimelineProperties,
        },
        Storage::{StorageFile, Streams::RandomAccessStreamReference},
        Win32::{Foundation::HWND, System::WinRT::ISystemMediaTransportControlsInterop},
    };
    pub struct Apartment;
    impl Apartment {
        pub fn new() -> windows::core::Result<Self> {
            unsafe {
                windows::Win32::System::WinRT::RoInitialize(
                    windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
                )?;
            }
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                windows::Win32::System::WinRT::RoUninitialize();
            }
        }
    }
    pub struct Session {
        controls: SystemMediaTransportControls,
        updater: SystemMediaTransportControlsDisplayUpdater,
        button_token: i64,
        seek_token: i64,
        metadata: Option<Metadata>,
    }
    impl Session {
        pub fn new(
            hwnd: usize,
            callback: impl Fn(ControlEvent) + Send + Sync + 'static,
        ) -> windows::core::Result<Self> {
            let interop: ISystemMediaTransportControlsInterop = windows::core::factory::<
                SystemMediaTransportControls,
                ISystemMediaTransportControlsInterop,
            >()?;
            let controls: SystemMediaTransportControls =
                unsafe { interop.GetForWindow(HWND(hwnd as *mut _)) }?;
            controls.SetIsEnabled(false)?;
            controls.SetIsPlayEnabled(true)?;
            controls.SetIsPauseEnabled(true)?;
            controls.SetIsStopEnabled(true)?;
            controls.SetIsFastForwardEnabled(true)?;
            controls.SetIsRewindEnabled(true)?;
            let callback = Arc::new(callback);
            let buttons = callback.clone();
            let button_token = controls.ButtonPressed(&TypedEventHandler::new(
                move |_,
                      args: windows::core::Ref<
                    '_,
                    SystemMediaTransportControlsButtonPressedEventArgs,
                >| {
                    let Some(args) = args.as_ref() else {
                        return Ok(());
                    };
                    let button = args.Button()?;
                    let action = if button == SystemMediaTransportControlsButton::Play {
                        "play"
                    } else if button == SystemMediaTransportControlsButton::Pause {
                        "pause"
                    } else if button == SystemMediaTransportControlsButton::Next {
                        "next"
                    } else if button == SystemMediaTransportControlsButton::Previous {
                        "previous"
                    } else if button == SystemMediaTransportControlsButton::Stop {
                        "stop"
                    } else if button == SystemMediaTransportControlsButton::FastForward {
                        "forward"
                    } else if button == SystemMediaTransportControlsButton::Rewind {
                        "backward"
                    } else {
                        return Ok(());
                    };
                    buttons(ControlEvent {
                        action,
                        position: None,
                    });
                    Ok(())
                },
            ))?;
            let seek_token = controls.PlaybackPositionChangeRequested(&TypedEventHandler::new(
                move |_, args: windows::core::Ref<'_, PlaybackPositionChangeRequestedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        callback(ControlEvent {
                            action: "seek",
                            position: Some(
                                args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0,
                            ),
                        });
                    }
                    Ok(())
                },
            ))?;
            let updater = controls.DisplayUpdater()?;
            Ok(Self {
                controls,
                updater,
                button_token,
                seek_token,
                metadata: None,
            })
        }
        pub fn configure(
            &mut self,
            metadata: Option<Metadata>,
            can_next: bool,
            can_previous: bool,
            position: f64,
        ) -> windows::core::Result<()> {
            self.controls.SetIsNextEnabled(can_next)?;
            self.controls.SetIsPreviousEnabled(can_previous)?;
            if self.metadata != metadata {
                self.updater.ClearAll()?;
                if let Some(ref track) = metadata {
                    self.updater.SetType(MediaPlaybackType::Music)?;
                    let music = self.updater.MusicProperties()?;
                    music.SetTitle(&HSTRING::from(&track.title))?;
                    music.SetArtist(&HSTRING::from(&track.artist))?;
                    music.SetAlbumTitle(&HSTRING::from(&track.album))?;
                    // Only our cached local artwork is used; no network URLs.
                    if let Ok(file) =
                        StorageFile::GetFileFromPathAsync(&HSTRING::from(&track.cover))
                            .and_then(|op| op.join())
                    {
                        if let Ok(thumbnail) = RandomAccessStreamReference::CreateFromFile(&file) {
                            self.updater.SetThumbnail(&thumbnail)?;
                        }
                    }
                }
                self.updater.Update()?;
                self.metadata = metadata;
            }
            self.playback(false, position)
        }
        pub fn playback(&mut self, playing: bool, position: f64) -> windows::core::Result<()> {
            let Some(track) = &self.metadata else {
                self.controls
                    .SetPlaybackStatus(MediaPlaybackStatus::Stopped)?;
                self.controls.SetIsEnabled(false)?;
                return Ok(());
            };
            self.controls.SetIsEnabled(true)?;
            self.controls.SetPlaybackStatus(if playing {
                MediaPlaybackStatus::Playing
            } else {
                MediaPlaybackStatus::Paused
            })?;
            self.controls.SetPlaybackRate(1.0)?;
            let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
            let span = |seconds: f64| TimeSpan {
                Duration: (seconds * 10_000_000.0) as i64,
            };
            timeline.SetStartTime(span(0.0))?;
            timeline.SetMinSeekTime(span(0.0))?;
            let end = bounded_position(track.duration, track.duration);
            timeline.SetEndTime(span(end))?;
            timeline.SetMaxSeekTime(span(end))?;
            timeline.SetPosition(span(bounded_position(position, end)))?;
            self.controls.UpdateTimelineProperties(&timeline)
        }
        pub fn update(&mut self, status: &crate::audio::Status) -> windows::core::Result<()> {
            if self.metadata.as_ref().map(|m| &m.id) == status.track_id.as_ref() {
                self.playback(status.playing, status.position)?;
            } else if status.track_id.is_some() {
                self.controls.SetIsEnabled(false)?;
            }
            Ok(())
        }
    }
    impl Drop for Session {
        fn drop(&mut self) {
            let _ = self.controls.SetIsEnabled(false);
            let _ = self.controls.RemoveButtonPressed(self.button_token);
            let _ = self
                .controls
                .RemovePlaybackPositionChangeRequested(self.seek_token);
            let _ = self.updater.ClearAll();
            let _ = self.updater.Update();
        }
    }
    pub struct Bridge(pub Mutex<Option<Session>>);
    impl Bridge {
        pub fn new(hwnd: usize, callback: impl Fn(ControlEvent) + Send + Sync + 'static) -> Self {
            Self(Mutex::new(Session::new(hwnd, callback).ok()))
        }
        pub fn configure(
            &self,
            metadata: Option<Metadata>,
            can_next: bool,
            can_previous: bool,
            position: f64,
            status: &crate::audio::Status,
        ) -> Result<(), String> {
            let mut guard = self.0.lock().map_err(|_| "Controles multimedia ocupados")?;
            let session = guard
                .as_mut()
                .ok_or("Windows no pudo activar los controles multimedia")?;
            // Do not replace a newer native track with a delayed frontend update.
            if status.track_id.is_some()
                && metadata.as_ref().map(|m| &m.id) != status.track_id.as_ref()
            {
                return Ok(());
            }
            let position = if status.track_id.is_some() {
                status.position
            } else {
                position
            };
            session
                .configure(metadata, can_next, can_previous, position)
                .map_err(|e| e.to_string())?;
            session.update(status).map_err(|e| e.to_string())
        }
        pub fn update(&self, status: &crate::audio::Status) {
            if let Ok(mut guard) = self.0.lock() {
                if let Some(session) = guard.as_mut() {
                    let _ = session.update(status);
                }
            }
        }
        pub fn clear(&self) {
            if let Ok(mut session) = self.0.lock() {
                session.take();
            }
        }
    }
}
#[cfg(target_os = "windows")]
pub use windows_session::{Apartment, Bridge};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeline_never_leaves_track_bounds() {
        assert_eq!(bounded_position(-5.0, 180.0), 0.0);
        assert_eq!(bounded_position(190.0, 180.0), 180.0);
        assert_eq!(bounded_position(f64::NAN, 180.0), 0.0);
        assert_eq!(bounded_position(42.5, 180.0), 42.5);
    }
}
