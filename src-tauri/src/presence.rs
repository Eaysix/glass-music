use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub application_id: String,
    pub show_album: bool,
}
#[derive(Clone, Serialize)]
pub struct Status {
    pub state: &'static str,
    pub message: String,
}
impl Status {
    fn new(state: &'static str, message: &str) -> Self {
        Self {
            state,
            message: message.into(),
        }
    }
}
#[derive(Clone)]
pub struct Song {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
}
struct Update {
    config: Config,
    song: Option<Song>,
    playing: bool,
    position: f64,
    reply: mpsc::SyncSender<Status>,
}
pub struct Presence {
    sender: mpsc::SyncSender<()>,
    pending: Arc<Mutex<Option<Update>>>,
}
fn short_text(text: &str) -> String {
    let mut result = String::new();
    for ch in text.trim().chars() {
        if result.len() + ch.len_utf8() > 120 {
            break;
        }
        result.push(ch);
    }
    if result.is_empty() {
        result = "Glass Music".into();
    }
    if result.len() < 2 {
        result.push(' ');
    }
    result
}
// The payload deliberately has no paths, lyrics, cover files, or user identity.
fn activity(song: &Song, position: f64, show_album: bool, now: i64) -> Value {
    let state = if show_album && !song.album.is_empty() {
        format!("{} · {}", song.artist, song.album)
    } else {
        song.artist.clone()
    };
    let position = if position.is_finite() {
        position.max(0.0).min(song.duration.max(0.0))
    } else {
        0.0
    };
    let start = now - position as i64;
    let mut data = json!({"type":2,"details":short_text(&song.title),"state":short_text(&state),"assets":{"large_image":"glass_music","large_text":"Glass Music · Tu música, siempre contigo"},"timestamps":{"start":start}});
    if song.duration.is_finite() && song.duration > 0.0 {
        data["timestamps"]["end"] = json!(start + song.duration as i64);
    }
    data
}
trait Transport {
    fn connect(&mut self, id: &str) -> Result<(), String>;
    fn publish(&mut self, payload: Option<Value>) -> Result<(), String>;
    fn disconnect(&mut self);
}
#[derive(Default)]
struct Connection {
    client: Option<DiscordIpcClient>,
    nonce: u64,
}
impl Connection {
    fn response(&mut self, nonce: Option<&str>) -> Result<(), String> {
        let client = self.client.as_mut().ok_or("Discord no conectado")?;
        for _ in 0..16 {
            let (op, data) = client.recv().map_err(|e| e.to_string())?;
            if op == 3 {
                client.send(data, 4).map_err(|e| e.to_string())?;
                continue;
            }
            if op == 2 || data["evt"] == "ERROR" {
                return Err("Discord rechazó la actividad. Revisa el Application ID.".into());
            }
            if nonce.is_none() && data["evt"] == "READY" {
                return Ok(());
            }
            if let Some(expected) = nonce {
                if data["nonce"].as_str() == Some(expected) && data["cmd"] == "SET_ACTIVITY" {
                    return Ok(());
                }
            }
        }
        Err("Discord no confirmó la actividad.".into())
    }
}
impl Transport for Connection {
    fn connect(&mut self, id: &str) -> Result<(), String> {
        self.disconnect();
        let mut client = DiscordIpcClient::new(id);
        client
            .connect_ipc()
            .map_err(|_| "Abre Discord de escritorio para compartir tu música.".to_string())?;
        client
            .send(json!({"v":1,"client_id":id}), 0)
            .map_err(|e| e.to_string())?;
        self.client = Some(client);
        self.response(None)
    }
    fn publish(&mut self, payload: Option<Value>) -> Result<(), String> {
        self.nonce = self.nonce.wrapping_add(1);
        let nonce = format!("glass-{}-{}", std::process::id(), self.nonce);
        self.client.as_mut().ok_or("Discord no conectado")?.send(json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id(),"activity":payload},"nonce":nonce}),1).map_err(|e|e.to_string())?;
        self.response(Some(&nonce))
    }
    fn disconnect(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.close();
        }
    }
}
struct Session<T: Transport> {
    transport: T,
    application_id: Option<String>,
}
impl<T: Transport> Session<T> {
    fn clear(&mut self) {
        if self.application_id.take().is_some() {
            let _ = self.transport.publish(None);
        }
        self.transport.disconnect();
    }
    fn update(
        &mut self,
        config: &Config,
        song: Option<&Song>,
        playing: bool,
        position: f64,
    ) -> Status {
        if !config.enabled {
            self.clear();
            return Status::new("disabled", "Actividad de Discord desactivada.");
        }
        let id = config.application_id.trim();
        if !(17..=20).contains(&id.len()) || !id.bytes().all(|c| c.is_ascii_digit()) {
            self.clear();
            return Status::new(
                "needs-id",
                "Introduce el Application ID público de Glass Music.",
            );
        }
        let song = match song.filter(|_| playing) {
            Some(song) => song,
            None => {
                self.clear();
                return Status::new("paused", "Listo. La actividad aparecerá al reproducir.");
            }
        };
        if self.application_id.as_deref() != Some(id) {
            self.clear();
            if let Err(e) = self.transport.connect(id) {
                self.transport.disconnect();
                return Status::new("unavailable", &e);
            }
            self.application_id = Some(id.into());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        match self
            .transport
            .publish(Some(activity(song, position, config.show_album, now)))
        {
            Ok(()) => Status::new(
                "connected",
                "Actividad enviada a Discord. Tu visibilidad depende de tus ajustes de Discord.",
            ),
            Err(e) => {
                self.application_id = None;
                self.transport.disconnect();
                Status::new("unavailable", &e)
            }
        }
    }
}
impl Presence {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel::<()>(1);
        let pending: Arc<Mutex<Option<Update>>> = Arc::new(Mutex::new(None));
        let worker_pending = pending.clone();
        std::thread::spawn(move || {
            let mut session = Session {
                transport: Connection::default(),
                application_id: None,
            };
            while receiver.recv().is_ok() {
                let request = worker_pending.lock().ok().and_then(|mut p| p.take());
                let Some(request) = request else {
                    continue;
                };
                let status = session.update(
                    &request.config,
                    request.song.as_ref(),
                    request.playing,
                    request.position,
                );
                let _ = request.reply.send(status);
            }
            session.clear();
        });
        Self { sender, pending }
    }
    pub fn update(
        &self,
        config: Config,
        song: Option<Song>,
        playing: bool,
        position: f64,
    ) -> Status {
        let (reply, receiver) = mpsc::sync_channel(1);
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(Update {
                config,
                song,
                playing,
                position,
                reply,
            });
        } else {
            return Status::new(
                "unavailable",
                "Reinicia Glass Music para reconectar Discord.",
            );
        }
        let _ = self.sender.try_send(());
        receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|_| {
                Status::new(
                    "unavailable",
                    "Discord no respondió. La reproducción continúa normalmente.",
                )
            })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake {
        connected: Vec<String>,
        sent: Vec<Option<Value>>,
        fail: bool,
    }
    impl Transport for Fake {
        fn connect(&mut self, id: &str) -> Result<(), String> {
            self.connected.push(id.into());
            if self.fail {
                Err("offline".into())
            } else {
                Ok(())
            }
        }
        fn publish(&mut self, payload: Option<Value>) -> Result<(), String> {
            self.sent.push(payload);
            Ok(())
        }
        fn disconnect(&mut self) {}
    }
    fn song() -> Song {
        Song {
            title: "Mi canción 💙".into(),
            artist: "Artista".into(),
            album: "Álbum".into(),
            duration: 120.0,
        }
    }
    #[test]
    fn presence_payload_has_music_and_seek_timestamps() {
        let v = activity(&song(), 30.0, true, 1000);
        assert_eq!(v["timestamps"]["start"], 970);
        assert_eq!(v["timestamps"]["end"], 1090);
        assert_eq!(v["type"], 2);
        assert_eq!(v["state"], "Artista · Álbum");
        assert_eq!(activity(&song(), 0.0, false, 1000)["state"], "Artista");
        assert!(v.get("path").is_none());
        assert_eq!(v["assets"]["large_image"], "glass_music");
        assert_eq!(v["assets"].as_object().unwrap().len(), 2);
        assert_eq!(
            v["assets"]["large_text"],
            "Glass Music · Tu música, siempre contigo"
        );
        assert!(short_text(&"💙".repeat(200)).len() <= 120);
    }
    #[test]
    fn pause_disable_and_invalid_id_clear_old_activity() {
        let mut s = Session {
            transport: Fake::default(),
            application_id: None,
        };
        let mut c = Config {
            enabled: true,
            application_id: "123456789012345678".into(),
            show_album: true,
        };
        assert_eq!(s.update(&c, Some(&song()), true, 0.0).state, "connected");
        assert_eq!(s.update(&c, Some(&song()), false, 0.0).state, "paused");
        assert!(s.transport.sent.last().unwrap().is_none());
        assert_eq!(s.update(&c, Some(&song()), true, 0.0).state, "connected");
        c.enabled = false;
        assert_eq!(s.update(&c, Some(&song()), true, 0.0).state, "disabled");
        assert!(s.transport.sent.last().unwrap().is_none());
        c.enabled = true;
        c.application_id = "not-a-token".into();
        assert_eq!(s.update(&c, Some(&song()), true, 0.0).state, "needs-id");
        assert_eq!(s.transport.connected.len(), 2);
    }
    #[test]
    fn offline_discord_does_not_publish() {
        let mut s = Session {
            transport: Fake {
                fail: true,
                ..Default::default()
            },
            application_id: None,
        };
        let c = Config {
            enabled: true,
            application_id: "123456789012345678".into(),
            show_album: false,
        };
        assert_eq!(s.update(&c, Some(&song()), true, 0.0).state, "unavailable");
        assert!(s.transport.sent.is_empty());
    }
}
