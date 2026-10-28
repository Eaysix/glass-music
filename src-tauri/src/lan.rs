use glass_sync::{models::Pairing, Server, Status};
use tauri::{Emitter, Manager, State};
#[derive(Default)]
pub struct Hub(tokio::sync::Mutex<Option<Server>>);
type Result<T> = std::result::Result<T, String>;
#[tauri::command]
pub async fn lan_status(hub: State<'_, Hub>) -> Result<Option<Status>> {
    hub.0.lock().await.as_ref().map(Server::status).transpose()
}
#[tauri::command]
pub async fn lan_start(app: tauri::AppHandle, hub: State<'_, Hub>) -> Result<Status> {
    let mut server = hub.0.lock().await;
    if server.is_none() {
        let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let events = app.clone();
        let started = Server::start(root.join("library.db"), root, 38473, move || {
            let _ = events.emit("lan-library-changed", ());
        })
        .await?;
        let playback = app.clone();
        started.set_resume_provider(move || {
            let status = playback
                .state::<crate::audio::Player>()
                .command("status".into(), None, None, None)
                .ok()?;
            Some(glass_sync::models::Resume {
                device_id: "pc".into(),
                device_name: "PC".into(),
                track_id: status.track_id?,
                position: status.position,
                updated_at: glass_sync::store::now(),
            })
        });
        *server = Some(started);
    }
    server
        .as_ref()
        .ok_or("No se pudo activar la sincronización")?
        .status()
}
#[tauri::command]
pub async fn lan_stop(hub: State<'_, Hub>) -> Result<()> {
    hub.0.lock().await.take();
    Ok(())
}
#[tauri::command]
pub async fn lan_pair(host: String, hub: State<'_, Hub>) -> Result<Pairing> {
    hub.0
        .lock()
        .await
        .as_ref()
        .ok_or("Activa primero la sincronización local")?
        .invitation(&host)
}
#[tauri::command]
pub async fn lan_revoke(id: String, hub: State<'_, Hub>) -> Result<()> {
    hub.0
        .lock()
        .await
        .as_ref()
        .ok_or("Activa primero la sincronización local")?
        .revoke(&id)
}
