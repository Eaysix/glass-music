use rodio::{Decoder, OutputStream, Sink};
use serde::Serialize;
use std::{fs::File, io::BufReader, path::PathBuf, sync::mpsc, time::Duration};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub track_id: Option<String>,
    pub position: f64,
    pub playing: bool,
    pub ended: bool,
}
struct Request {
    action: String,
    id: Option<String>,
    path: Option<PathBuf>,
    value: Option<f64>,
    reply: mpsc::SyncSender<Result<Status, String>>,
}
pub struct Player {
    sender: mpsc::Sender<Request>,
}
impl Player {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<Request>();
        std::thread::spawn(move || {
            // OutputStream stays on this thread and opens only when playing.
            let mut output: Option<OutputStream> = None;
            let mut sink: Option<Sink> = None;
            let mut status = Status::default();
            let mut volume = 0.7_f32;
            while let Ok(request) = receiver.recv() {
                if let Some(active) = &sink {
                    status.position = active.get_pos().as_secs_f64();
                    status.ended = active.empty();
                    status.playing = !active.is_paused() && !status.ended;
                    if status.ended {
                        sink = None;
                        output = None;
                    }
                }
                let result = (|| -> Result<Status, String> {
                    match request.action.as_str() {
                        "play" => {
                            let id = request.id.ok_or("No hay canción seleccionada.")?;
                            if status.track_id.as_ref() != Some(&id) || sink.is_none() {
                                // Open and decode before replacing the existing source.
                                let file =
                                    File::open(request.path.ok_or("Ruta no disponible.")?)
                                        .map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
                                let decoder = Decoder::new(BufReader::new(file))
                                    .map_err(|e| format!("Audio no compatible o dañado: {e}"))?;
                                let (stream, handle) =
                                    OutputStream::try_default().map_err(|e| {
                                        format!("No se pudo abrir la salida de audio: {e}")
                                    })?;
                                let next = Sink::try_new(&handle).map_err(|e| e.to_string())?;
                                next.set_volume(volume);
                                next.pause();
                                next.append(decoder);
                                if let Some(seconds) =
                                    request.value.filter(|v| *v > 0.0 && v.is_finite())
                                {
                                    next.try_seek(Duration::from_secs_f64(seconds)).map_err(
                                        |e| format!("No se pudo recuperar la posición: {e}"),
                                    )?;
                                }
                                sink = Some(next);
                                output = Some(stream);
                            } else if let (Some(active), Some(seconds)) = (&sink, request.value) {
                                if seconds.is_finite() && seconds >= 0.0 {
                                    active
                                        .try_seek(Duration::from_secs_f64(seconds))
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                            sink.as_ref().ok_or("Reproductor no disponible.")?.play();
                            status = Status {
                                track_id: Some(id),
                                position: request.value.unwrap_or(status.position).max(0.0),
                                playing: true,
                                ended: false,
                            };
                        }
                        "pause" => {
                            if let Some(active) = &sink {
                                active.pause();
                                status.position = active.get_pos().as_secs_f64();
                            }
                            status.playing = false;
                            // Release device and decoder while paused; resume reopens at this position.
                            sink = None;
                            output = None;
                        }
                        "seek" => {
                            let seconds = request
                                .value
                                .filter(|s| s.is_finite() && *s >= 0.0)
                                .ok_or("Posición inválida.")?;
                            if let Some(active) = &sink {
                                active
                                    .try_seek(Duration::from_secs_f64(seconds))
                                    .map_err(|e| e.to_string())?;
                            }
                            status.position = seconds;
                            status.ended = false;
                        }
                        "volume" => {
                            volume = request.value.unwrap_or(0.7).clamp(0.0, 1.0) as f32;
                            if let Some(active) = &sink {
                                active.set_volume(volume);
                            }
                        }
                        "stop" => {
                            sink = None;
                            output = None;
                            status = Status::default();
                        }
                        "status" => {}
                        _ => return Err("Acción de audio desconocida.".into()),
                    }
                    Ok(status.clone())
                })();
                let _ = request.reply.send(result);
                // Keep the stream alive across commands until stop/end or process exit.
                let _ = &output;
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
            .send(Request {
                action,
                id,
                path,
                value,
                reply,
            })
            .map_err(|_| "El reproductor se cerró.".to_string())?;
        receive
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "El reproductor no respondió.".to_string())?
    }
}
