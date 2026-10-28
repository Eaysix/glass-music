use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink};
use serde::Serialize;
use std::{
    fs::File,
    io::BufReader,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub track_id: Option<String>,
    pub position: f64,
    pub playing: bool,
    pub ended: bool,
    pub output_error: Option<String>,
}
struct Request {
    action: String,
    id: Option<String>,
    path: Option<PathBuf>,
    value: Option<f64>,
    reply: mpsc::SyncSender<Result<Status, String>>,
}
enum Message {
    Request(Request),
    OutputChanged,
    StreamError(u64),
    Shutdown,
}
pub struct Player {
    sender: mpsc::Sender<Message>,
}
pub(crate) fn open_decoder(path: PathBuf) -> Result<Decoder<BufReader<File>>, String> {
    let file = File::open(path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    Decoder::builder()
        .with_data(BufReader::new(file))
        .with_byte_len(length)
        .with_seekable(true)
        .build()
        .map_err(|e| format!("Audio no compatible o dañado: {e}"))
}

trait Output {
    fn generation(&self) -> Option<u64>;
    fn start(&mut self, path: PathBuf, position: f64, volume: f32) -> Result<(), String>;
    fn snapshot(&self) -> Option<(f64, bool)>;
    fn close(&mut self);
    fn seek(&self, position: f64) -> Result<(), String>;
    fn volume(&self, volume: f32);
}
struct RodioOutput {
    stream: Option<OutputStream>,
    sink: Option<Sink>,
    sender: mpsc::Sender<Message>,
    next_generation: u64,
    active_generation: Option<u64>,
}
impl Output for RodioOutput {
    fn generation(&self) -> Option<u64> {
        self.active_generation
    }
    fn start(&mut self, path: PathBuf, position: f64, volume: f32) -> Result<(), String> {
        // Prepare the new source before replacing a working song.
        let decoder = open_decoder(path)?;
        self.next_generation += 1;
        let generation = self.next_generation;
        let sender = self.sender.clone();
        let reported = Arc::new(AtomicBool::new(false));
        // Keep configuration fallbacks on the selected default device, never an arbitrary output.
        let mut stream = OutputStreamBuilder::from_default_device()
            .map_err(|e| format!("No se pudo abrir la salida de audio: {e}"))?
            .with_error_callback(move |_| {
                // Audio callbacks only notify the worker. They never open devices or block.
                if !reported.swap(true, Ordering::Relaxed) {
                    let _ = sender.send(Message::StreamError(generation));
                }
            })
            .open_stream_or_fallback()
            .map_err(|e| format!("No se pudo abrir la salida de audio: {e}"))?;
        stream.log_on_drop(false);
        let next = Sink::connect_new(stream.mixer());
        next.pause();
        next.set_volume(volume);
        next.append(decoder);
        if position > 0.0 {
            next.try_seek(Duration::from_secs_f64(position))
                .map_err(|e| format!("No se pudo recuperar la posición: {e}"))?;
        }
        self.close();
        self.active_generation = Some(generation);
        self.sink = Some(next);
        self.stream = Some(stream);
        self.sink.as_ref().unwrap().play();
        Ok(())
    }
    fn snapshot(&self) -> Option<(f64, bool)> {
        self.sink
            .as_ref()
            .map(|sink| (sink.get_pos().as_secs_f64(), sink.empty()))
    }
    fn close(&mut self) {
        // Invalidate callbacks before dropping the previous stream.
        self.active_generation = None;
        self.sink = None;
        self.stream = None;
    }
    fn seek(&self, position: f64) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.try_seek(Duration::from_secs_f64(position))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    fn volume(&self, volume: f32) {
        if let Some(sink) = &self.sink {
            sink.set_volume(volume);
        }
    }
}
struct Engine<B: Output> {
    output: B,
    status: Status,
    path: Option<PathBuf>,
    volume: f32,
    error_recoveries: u8,
    last_recovery_position: f64,
}
impl<B: Output> Engine<B> {
    fn new(output: B) -> Self {
        Self {
            output,
            status: Status::default(),
            path: None,
            volume: 0.7,
            error_recoveries: 0,
            last_recovery_position: 0.0,
        }
    }
    fn refresh(&mut self) {
        if let Some((position, ended)) = self.output.snapshot() {
            self.status.position = position;
            self.status.ended = ended;
            if ended {
                self.status.playing = false;
                self.output.close();
            }
        }
    }
    fn command(
        &mut self,
        action: &str,
        id: Option<String>,
        path: Option<PathBuf>,
        value: Option<f64>,
    ) -> Result<Status, String> {
        self.refresh();
        match action {
            "play" => {
                let id = id.ok_or("No hay canción seleccionada.")?;
                let same = self.status.track_id.as_ref() == Some(&id);
                let position = value
                    .filter(|v| v.is_finite() && *v >= 0.0)
                    .unwrap_or(if same { self.status.position } else { 0.0 });
                if !same || self.output.snapshot().is_none() {
                    let path = path.ok_or("Ruta no disponible.")?;
                    self.output.start(path.clone(), position, self.volume)?;
                    self.path = Some(path);
                } else if value.is_some() {
                    self.output.seek(position)?;
                }
                self.error_recoveries = 0;
                self.status = Status {
                    track_id: Some(id),
                    position,
                    playing: true,
                    ended: false,
                    output_error: None,
                };
            }
            "pause" => {
                self.error_recoveries = 0;
                self.output.close();
                self.status.playing = false;
                self.status.output_error = None;
            }
            "seek" => {
                let position = value
                    .filter(|s| s.is_finite() && *s >= 0.0)
                    .ok_or("Posición inválida.")?;
                self.output.seek(position)?;
                self.error_recoveries = 0;
                self.status.position = position;
                self.status.ended = false;
            }
            "volume" => {
                self.volume = value
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.7)
                    .clamp(0.0, 1.0) as f32;
                self.output.volume(self.volume);
            }
            "stop" => {
                self.error_recoveries = 0;
                self.output.close();
                self.path = None;
                self.status = Status::default();
            }
            "status" => {}
            _ => return Err("Acción de audio desconocida.".into()),
        }
        Ok(self.status.clone())
    }
    fn stream_error(&mut self, generation: u64, wait: impl FnMut()) {
        if self.output.generation() != Some(generation) {
            return;
        }
        self.refresh();
        if !self.status.playing {
            return;
        }
        if (self.status.position - self.last_recovery_position).abs() > 1.0 {
            self.error_recoveries = 0;
        }
        if self.error_recoveries >= 3 {
            self.output.close();
            self.status.playing = false;
            self.status.ended = false;
            self.status.output_error =
                Some("La salida de audio volvió a fallar después de reconectarse.".into());
            return;
        }
        self.error_recoveries += 1;
        self.last_recovery_position = self.status.position;
        self.reconnect(wait);
    }
    fn reconnect(&mut self, mut wait: impl FnMut()) {
        // Capture the sink clock once; retries never advance the song or its queue.
        self.refresh();
        if !self.status.playing {
            return;
        }
        let Some(path) = self.path.clone() else {
            return;
        };
        self.output.close();
        let mut last_error = String::new();
        for attempt in 0..3 {
            if attempt > 0 {
                wait();
            }
            match self
                .output
                .start(path.clone(), self.status.position, self.volume)
            {
                Ok(()) => {
                    self.status.output_error = None;
                    return;
                }
                Err(error) => last_error = error,
            }
        }
        // A missing output is a pause, never a completed song. Play can retry without restarting.
        self.output.close();
        self.status.playing = false;
        self.status.ended = false;
        self.status.output_error = Some(last_error);
    }
}

impl Player {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<Message>();
        let events = sender.clone();
        std::thread::spawn(move || {
            #[cfg(target_os = "windows")]
            let _apartment = crate::media::Apartment::new().ok();
            let notifications = events.clone();
            let _watcher = crate::audio_device::Watcher::new(move || {
                let _ = notifications.send(Message::OutputChanged);
            })
            .ok();
            let mut default_device = crate::audio_device::default_id();
            let mut engine = Engine::new(RodioOutput {
                stream: None,
                sink: None,
                sender: events,
                next_generation: 0,
                active_generation: None,
            });
            while let Ok(message) = receiver.recv() {
                let probe = matches!(&message, Message::OutputChanged)
                    || matches!(&message, Message::Request(request) if request.action == "play" || request.action == "status");
                if probe {
                    let current = crate::audio_device::default_id();
                    if current != default_device {
                        default_device = current;
                        engine.reconnect(|| std::thread::sleep(Duration::from_millis(150)));
                    }
                }
                match message {
                    Message::Request(request) => {
                        let result = engine.command(
                            &request.action,
                            request.id,
                            request.path,
                            request.value,
                        );
                        let _ = request.reply.send(result);
                    }
                    Message::StreamError(generation) => {
                        // Late callbacks from a replaced stream cannot interrupt the new song.
                        engine.stream_error(generation, || {
                            std::thread::sleep(Duration::from_millis(150))
                        });
                    }
                    Message::OutputChanged => {}
                    Message::Shutdown => break,
                }
            }
        });
        Self { sender }
    }
    pub fn command(
        &self,
        action: String,
        id: Option<String>,
        path: Option<PathBuf>,
        value: Option<f64>,
    ) -> Result<Status, String> {
        let (reply, receive) = mpsc::sync_channel(1);
        self.sender
            .send(Message::Request(Request {
                action,
                id,
                path,
                value,
                reply,
            }))
            .map_err(|_| "El reproductor se cerró.".to_string())?;
        receive
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "El reproductor no respondió.".to_string())?
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.sender.send(Message::Shutdown);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;

    #[test]
    fn flac_and_mp3_seek_forward_backward_and_reopen_at_pause_position() {
        for name in ["first.flac", "second.mp3"] {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../tests/fixtures")
                .join(name);
            let mut decoder = open_decoder(path.clone()).unwrap();
            for seconds in [5.0, 2.0, 14.0, 0.0] {
                decoder
                    .try_seek(Duration::from_secs_f64(seconds))
                    .unwrap_or_else(|e| panic!("{name} seek {seconds}: {e}"));
                assert!(decoder.next().is_some());
            }
            drop(decoder);
            let mut resumed = open_decoder(path).unwrap();
            resumed
                .try_seek(Duration::from_secs_f64(7.5))
                .expect("resume must support nonzero positions");
            assert!(resumed.next().is_some());
        }
    }
}

#[cfg(test)]
mod routing_tests {
    use super::*;
    use std::cell::Cell;
    #[derive(Default)]
    struct FakeOutput {
        sample: Cell<Option<(f64, bool)>>,
        opens: Vec<(PathBuf, f64, f32)>,
        failures: usize,
        counter: u64,
        generation: Option<u64>,
        volume: Cell<f32>,
    }
    impl Output for FakeOutput {
        fn generation(&self) -> Option<u64> {
            self.generation
        }
        fn start(&mut self, path: PathBuf, position: f64, volume: f32) -> Result<(), String> {
            self.opens.push((path, position, volume));
            self.counter += 1;
            if self.failures > 0 {
                self.failures -= 1;
                return Err("output unplugged".into());
            }
            self.generation = Some(self.counter);
            self.sample.set(Some((position, false)));
            self.volume.set(volume);
            Ok(())
        }
        fn snapshot(&self) -> Option<(f64, bool)> {
            self.sample.get()
        }
        fn close(&mut self) {
            self.sample.set(None);
            self.generation = None;
        }
        fn seek(&self, position: f64) -> Result<(), String> {
            if self.sample.get().is_some() {
                self.sample.set(Some((position, false)));
            }
            Ok(())
        }
        fn volume(&self, volume: f32) {
            self.volume.set(volume);
        }
    }
    fn playing() -> Engine<FakeOutput> {
        let mut engine = Engine::new(FakeOutput::default());
        engine
            .command(
                "play",
                Some("one".into()),
                Some("one.flac".into()),
                Some(7.5),
            )
            .unwrap();
        engine
    }
    #[test]
    fn device_switch_keeps_current_track_sink_position_and_volume() {
        let mut engine = playing();
        engine.command("volume", None, None, Some(0.32)).unwrap();
        engine.output.sample.set(Some((12.75, false)));
        engine.reconnect(|| panic!("ready device should need no retry"));
        assert_eq!(engine.status.track_id.as_deref(), Some("one"));
        assert_eq!(engine.status.position, 12.75);
        assert!(engine.status.playing);
        assert!(!engine.status.ended);
        assert_eq!(
            engine.output.opens.last().unwrap(),
            &(PathBuf::from("one.flac"), 12.75, 0.32)
        );
    }
    #[test]
    fn changing_output_when_paused_or_idle_never_autoplays() {
        let mut engine = Engine::new(FakeOutput::default());
        engine.reconnect(|| panic!());
        assert!(engine.output.opens.is_empty());
        engine = playing();
        engine.command("pause", None, None, None).unwrap();
        engine.reconnect(|| panic!());
        assert_eq!(engine.output.opens.len(), 1);
        engine.command("seek", None, None, Some(11.2)).unwrap();
        engine
            .command("play", Some("one".into()), Some("one.flac".into()), None)
            .unwrap();
        assert_eq!(engine.output.opens.last().unwrap().1, 11.2);
    }
    #[test]
    fn transient_device_initialization_retries_from_one_frozen_position() {
        let mut engine = playing();
        engine.output.sample.set(Some((8.25, false)));
        engine.output.failures = 2;
        let mut waits = 0;
        engine.reconnect(|| waits += 1);
        assert_eq!(waits, 2);
        assert!(engine.status.playing);
        assert!(engine.status.output_error.is_none());
        assert!(engine.output.opens[1..]
            .iter()
            .all(|(_, position, _)| *position == 8.25));
    }
    #[test]
    fn no_device_pauses_instead_of_ending_and_play_recovers_without_restart() {
        let mut engine = playing();
        engine.output.sample.set(Some((9.75, false)));
        engine.output.failures = 3;
        engine.reconnect(|| {});
        let status = engine.command("status", None, None, None).unwrap();
        assert!(!status.playing && !status.ended);
        assert_eq!(status.track_id.as_deref(), Some("one"));
        assert_eq!(status.position, 9.75);
        assert!(status.output_error.is_some());
        // Reconnecting hardware alone must not restart a deliberately paused player.
        engine.reconnect(|| panic!());
        assert_eq!(engine.output.opens.len(), 4);
        let resumed = engine
            .command("play", Some("one".into()), Some("one.flac".into()), None)
            .unwrap();
        assert!(resumed.playing && !resumed.ended);
        assert!(resumed.output_error.is_none());
        assert_eq!(resumed.position, 9.75);
    }
    #[test]
    fn old_stream_errors_cannot_interrupt_new_tracks_or_resume_after_pause() {
        let mut engine = playing();
        let old = engine.output.generation().unwrap();
        engine.reconnect(|| {});
        let current = engine.output.generation().unwrap();
        engine.stream_error(old, || panic!());
        assert_eq!(engine.output.opens.len(), 2);
        engine.command("pause", None, None, None).unwrap();
        engine.stream_error(current, || panic!());
        assert_eq!(engine.output.opens.len(), 2);
        engine
            .command(
                "play",
                Some("two".into()),
                Some("two.mp3".into()),
                Some(0.0),
            )
            .unwrap();
        engine.stream_error(current, || panic!());
        assert_eq!(engine.output.opens.len(), 3);
        assert_eq!(engine.status.track_id.as_deref(), Some("two"));
        let current = engine.output.generation().unwrap();
        engine.stream_error(current, || {});
        assert_eq!(engine.output.opens.len(), 4);
        assert_eq!(
            engine.output.opens.last().unwrap().0,
            PathBuf::from("two.mp3")
        );
    }
    #[test]
    fn repeated_asynchronous_driver_errors_are_bounded_and_manual_play_can_retry() {
        let mut engine = playing();
        for _ in 0..10 {
            if let Some(generation) = engine.output.generation() {
                engine.stream_error(generation, || {});
            }
        }
        assert_eq!(engine.output.opens.len(), 4);
        assert!(!engine.status.playing && !engine.status.ended);
        assert!(engine.status.output_error.is_some());
        engine
            .command("play", Some("one".into()), Some("one.flac".into()), None)
            .unwrap();
        let generation = engine.output.generation().unwrap();
        engine.stream_error(generation, || {});
        assert!(engine.status.playing);
        assert_eq!(engine.output.opens.len(), 6);
    }
    #[test]
    fn natural_end_and_stop_still_release_output_and_do_not_reconnect() {
        let mut engine = playing();
        engine.output.sample.set(Some((16.0, true)));
        let status = engine.command("status", None, None, None).unwrap();
        assert!(status.ended && !status.playing);
        engine.reconnect(|| panic!());
        assert_eq!(engine.output.opens.len(), 1);
        engine.command("stop", None, None, None).unwrap();
        engine.reconnect(|| panic!());
        assert!(engine.status.track_id.is_none());
        assert!(engine.path.is_none());
    }
    #[test]
    fn failed_new_track_does_not_replace_existing_track_or_recovery_path() {
        let mut engine = playing();
        engine.output.failures = 1;
        assert!(engine
            .command(
                "play",
                Some("two".into()),
                Some("two.mp3".into()),
                Some(0.0)
            )
            .is_err());
        assert_eq!(engine.status.track_id.as_deref(), Some("one"));
        assert_eq!(engine.path, Some("one.flac".into()));
        engine.reconnect(|| {});
        assert_eq!(
            engine.output.opens.last().unwrap().0,
            PathBuf::from("one.flac")
        );
    }
}
