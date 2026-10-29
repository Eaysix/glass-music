mod audio;
mod audio_device;
mod lan;
mod media;
mod presence;
use lofty::{file::AudioFile, prelude::*, tag::ItemKey};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

type Result<T> = std::result::Result<T, String>;
struct Database(Mutex<Connection>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    path: String,
    title: String,
    artist: String,
    album: String,
    feats: String,
    duration: f64,
    format: String,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
    cover: Option<String>,
    favorite: bool,
    #[serde(default)]
    modified_at: Option<f64>,
}
#[derive(Serialize)]
struct ImportReport {
    tracks: Vec<Track>,
    skipped: usize,
    #[serde(rename = "existingIds")]
    existing_ids: Vec<String>,
    errors: Vec<String>,
}
#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
}
fn sql<T>(value: rusqlite::Result<T>) -> Result<T> {
    value.map_err(|e| format!("Biblioteca: {e}"))
}
fn connection(db: &Database) -> Result<std::sync::MutexGuard<'_, Connection>> {
    db.0.lock()
        .map_err(|_| "La biblioteca está ocupada. Reinicia la app.".into())
}
fn track_from_db(conn: &Connection, id: &str) -> Result<Track> {
    let json: String = sql(conn.query_row(
        "SELECT metadata FROM tracks WHERE id=?1",
        [id],
        |row| row.get(0),
    ))?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
fn serialize<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_library(db: State<'_, Database>) -> Result<Vec<Track>> {
    let conn = connection(&db)?;
    let mut statement = sql(conn.prepare("SELECT metadata FROM tracks ORDER BY rowid"))?;
    let rows = sql(statement.query_map([], |row| row.get::<_, String>(0)))?;
    let mut tracks: Vec<Track> = rows
        .map(|row| serde_json::from_str(&sql(row)?).map_err(|e| e.to_string()))
        .collect::<Result<_>>()?;
    drop(statement);
    for track in &mut tracks {
        if let Some(modified) = file_modified(Path::new(&track.path)) {
            if track.modified_at != Some(modified) {
                track.modified_at = Some(modified);
                sql(conn.execute(
                    "UPDATE tracks SET metadata=json_set(metadata,'$.modifiedAt',?1) WHERE id=?2",
                    params![modified, track.id],
                ))?;
            }
        }
    }
    Ok(tracks)
}
#[tauri::command]
fn load_settings(db: State<'_, Database>) -> Result<Option<serde_json::Value>> {
    let conn = connection(&db)?;
    let json: Option<String> = sql(conn
        .query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
            r.get(0)
        })
        .optional())?;
    json.map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .transpose()
}
#[tauri::command]
fn save_settings(mut settings: serde_json::Value, db: State<'_, Database>) -> Result<serde_json::Value> {
    if !settings.is_object() { return Err("Ajustes inválidos.".into()); }
    if serialize(&settings)?.len() > 16 * 1024 * 1024 { return Err("Los ajustes superan el límite de 16 MB.".into()); }
    let mut conn = connection(&db)?;
    let tx = sql(conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let raw: Option<String> = sql(tx.query_row("SELECT value FROM settings WHERE key='app'", [], |r| r.get(0)).optional())?;
    let stored: serde_json::Value = raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let base = settings["playlistBase"].as_array().cloned().unwrap_or_default();
    let incoming = settings["playlists"].as_array().cloned().unwrap_or_default();
    let mut merged = stored["playlists"].as_array().cloned().unwrap_or_default();
    sql(tx.execute_batch("CREATE TABLE IF NOT EXISTS sync_deleted_playlists(id TEXT PRIMARY KEY)"))?;
    for previous in &base {
        if !incoming.iter().any(|p| p["id"] == previous["id"]) {
            merged.retain(|p| p["id"] != previous["id"]);
            sql(tx.execute("INSERT OR IGNORE INTO sync_deleted_playlists VALUES(?1)", [previous["id"].as_str().unwrap_or("")]))?;
        }
    }
    for playlist in incoming {
        if base.iter().find(|p| p["id"] == playlist["id"]) != Some(&playlist) {
            if let Some(i) = merged.iter().position(|p| p["id"] == playlist["id"]) { merged[i] = playlist; }
            else {
                let deleted: bool = sql(tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_deleted_playlists WHERE id=?1)", [playlist["id"].as_str().unwrap_or("")], |r| r.get(0)))?;
                if !deleted { merged.push(playlist); }
            }
        }
    }
    settings.as_object_mut().unwrap().remove("playlistBase");
    settings["playlists"] = serde_json::json!(merged);
    sql(tx.execute("INSERT INTO settings(key,value) VALUES('app',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serialize(&settings)?]))?;
    sql(tx.commit())?;
    Ok(settings["playlists"].clone())
}
#[tauri::command]
fn listening_exchange(days: std::collections::BTreeMap<String, std::collections::BTreeMap<String, f64>>, app: tauri::AppHandle, db: State<'_, Database>) -> Result<std::collections::BTreeMap<String, std::collections::BTreeMap<String, f64>>> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let store = glass_sync::store::Store::open(root.join("library.db"), root)?;
    let mut conn = connection(&db)?;
    let tx = sql(conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let entries: Vec<_> = days.into_iter().flat_map(|(day,songs)| songs.into_iter().map(move |(track_id,seconds)| glass_sync::models::ListeningValue { day:day.clone(),track_id,seconds })).collect();
    for batch in entries.chunks(500) { glass_sync::store::Store::merge_listening(&tx, "pc", batch.to_vec())?; }
    sql(tx.commit())?;
    let mut totals: std::collections::BTreeMap<String,std::collections::BTreeMap<String,f64>> = Default::default();
    for entry in store.listening()? { *totals.entry(entry.value.day).or_default().entry(entry.value.track_id).or_default() += entry.value.seconds; }
    Ok(totals)
}
#[tauri::command]
fn update_track(mut track: Track, db: State<'_, Database>) -> Result<Track> {
    let mut conn = connection(&db)?;
    let tx = sql(conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let original = track_from_db(&tx, &track.id)?;
    if track.title.trim().is_empty() {
        return Err("El título no puede estar vacío.".into());
    }
    track.path = original.path;
    track.duration = original.duration;
    track.format = original.format;
    track.sample_rate = original.sample_rate;
    track.bit_depth = original.bit_depth;
    track.modified_at = original.modified_at;
    // A metadata edit must not reset a favorite received concurrently from iPhone.
    track.favorite = original.favorite;
    sql(tx.execute(
        "UPDATE tracks SET metadata=?1 WHERE id=?2",
        params![serialize(&track)?, track.id],
    ))?;
    sql(tx.commit())?;
    Ok(track)
}
#[tauri::command]
fn set_favorite(id: String, favorite: bool, db: State<'_, Database>) -> Result<Track> {
    let mut conn = connection(&db)?;
    let tx = sql(conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let mut track = track_from_db(&tx, &id)?;
    track.favorite = favorite;
    sql(tx.execute(
        "UPDATE tracks SET metadata=?1 WHERE id=?2",
        params![serialize(&track)?, id],
    ))?;
    sql(tx.commit())?;
    Ok(track)
}
#[tauri::command]
fn get_lyrics(id: String, db: State<'_, Database>) -> Result<String> {
    sql(
        connection(&db)?.query_row("SELECT lyrics FROM tracks WHERE id=?1", [id], |row| {
            row.get(0)
        }),
    )
}
#[tauri::command]
fn save_lyrics(
    id: String,
    lyrics: String,
    expected_lyrics: Option<String>,
    db: State<'_, Database>,
) -> Result<()> {
    if lyrics.len() > 1024 * 1024 {
        return Err("La letra supera 1 MB.".into());
    }
    let conn = connection(&db)?;
    let changed = if let Some(expected) = expected_lyrics {
        sql(conn.execute(
            "UPDATE tracks SET lyrics=?1 WHERE id=?2 AND (lyrics=?3 OR lyrics=?1)",
            params![lyrics, id, expected],
        ))?
    } else {
        sql(conn.execute(
            "UPDATE tracks SET lyrics=?1 WHERE id=?2",
            params![lyrics, id],
        ))?
    };
    if changed == 0 {
        return Err("La letra cambió en otro dispositivo o la canción ya no está. Conserva tu borrador y vuelve a abrir la letra antes de guardar.".into());
    }
    Ok(())
}
#[tauri::command]
fn remove_track(id: String, db: State<'_, Database>) -> Result<()> {
    sql(connection(&db)?.execute("DELETE FROM tracks WHERE id=?1", [id]))?;
    Ok(())
}
fn remove_track_ids(conn: &mut Connection, ids: &[String]) -> Result<()> {
    let transaction = sql(conn.transaction())?;
    {
        let mut delete = sql(transaction.prepare("DELETE FROM tracks WHERE id=?1"))?;
        for id in ids {
            sql(delete.execute([id]))?;
        }
    }
    sql(transaction.commit())
}
#[tauri::command]
fn remove_tracks(ids: Vec<String>, db: State<'_, Database>) -> Result<()> {
    let mut conn = connection(&db)?;
    remove_track_ids(&mut conn, &ids)
}
fn thumbnail(bytes: &[u8], directory: &Path) -> Result<String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("La imagen supera 20 MB.".into());
    }
    let path = directory.join(format!("{:x}.jpg", Sha256::digest(bytes)));
    if !path.exists() {
        let mut reader = image::ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|e| format!("Imagen no válida: {e}"))?
            .thumbnail(512, 512)
            .to_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
            .encode_image(&image)
            .map_err(|e| e.to_string())?;
        fs::write(&path, jpeg).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
async fn import_image(path: String, app: tauri::AppHandle) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = Path::new(&path);
        let extension = file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) {
            return Err("Formato de imagen no compatible.".into());
        }
        if fs::metadata(file).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
            return Err("Elige una imagen de menos de 20 MB.".into());
        }
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("covers");
        thumbnail(&fs::read(file).map_err(|e| e.to_string())?, &directory)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn read_lyrics_file(path: String) -> Result<String> {
    let path = Path::new(&path);
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["lrc", "txt"].contains(&extension.as_str()) {
        return Err("Selecciona un .lrc o .txt.".into());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("La letra supera 1 MB.".into());
    }
    fs::read_to_string(path)
        .map(|s| s.trim_start_matches('\u{feff}').to_string())
        .map_err(|e| format!("Guarda la letra como texto UTF-8: {e}"))
}
fn file_modified(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|value| value.as_millis() as f64)
}
fn read_track(path: &Path, covers: &Path) -> Result<(Track, String)> {
    let file =
        lofty::read_from_path(path).map_err(|e| format!("Etiquetas o audio dañados: {e}"))?;
    let properties = file.properties();
    let tag = file.primary_tag().or_else(|| file.first_tag());
    let fallback = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Sin título")
        .to_string();
    let cover = tag
        .and_then(|t| t.pictures().first())
        .and_then(|picture| thumbnail(picture.data(), covers).ok());
    let embedded = tag
        .and_then(|t| t.get_string(&ItemKey::Lyrics))
        .unwrap_or("")
        .to_string();
    let lrc = path.with_extension("lrc");
    let lyrics = if lrc.is_file()
        && fs::metadata(&lrc)
            .map(|m| m.len() <= 1024 * 1024)
            .unwrap_or(false)
    {
        fs::read_to_string(lrc).unwrap_or(embedded)
    } else {
        embedded
    };
    let path_string = path.to_string_lossy().into_owned();
    let track = Track {
        id: format!("{:x}", Sha256::digest(path_string.as_bytes())),
        path: path_string,
        title: tag
            .and_then(|t| t.title())
            .map(|v| v.into_owned())
            .unwrap_or(fallback),
        artist: tag
            .and_then(|t| t.artist())
            .map(|v| v.into_owned())
            .unwrap_or_else(|| "Artista desconocido".into()),
        album: tag
            .and_then(|t| t.album())
            .map(|v| v.into_owned())
            .unwrap_or_else(|| "Sin álbum".into()),
        feats: String::new(),
        duration: properties.duration().as_secs_f64(),
        format: path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_uppercase(),
        sample_rate: properties.sample_rate(),
        bit_depth: properties.bit_depth(),
        cover,
        favorite: false,
        modified_at: file_modified(path),
    };
    Ok((track, lyrics))
}
#[tauri::command]
async fn import_music(paths: Vec<String>, app: tauri::AppHandle) -> Result<ImportReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut report = ImportReport {
            tracks: vec![],
            skipped: 0,
            existing_ids: vec![],
            errors: vec![],
        };
        let mut files = Vec::<PathBuf>::new();
        for root in paths {
            if Path::new(&root).is_dir() {
                for entry in WalkDir::new(&root).follow_links(false) {
                    match entry {
                        Ok(entry) if entry.file_type().is_file() => files.push(entry.into_path()),
                        Err(error) => report.errors.push(error.to_string()),
                        _ => {}
                    }
                }
            } else {
                files.push(PathBuf::from(root));
            }
        }
        files.retain(|p| {
            p.extension()
                .and_then(|s| s.to_str())
                .map(|s| ["flac", "mp3"].contains(&s.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
        });
        files.sort();
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("covers");
        let database = app.state::<Database>();
        let mut seen = {
            let conn = connection(&database)?;
            let mut statement = sql(conn.prepare("SELECT path FROM tracks"))?;
            let rows = sql(statement.query_map([], |r| r.get::<_, String>(0)))?;
            rows.collect::<rusqlite::Result<HashSet<_>>>()
                .map_err(|e| e.to_string())?
        };
        let total = files.len();
        for (index, path) in files.into_iter().enumerate() {
            let result = (|| -> Result<()> {
                let absolute = fs::canonicalize(&path).map_err(|e| e.to_string())?;
                let key = absolute.to_string_lossy().into_owned();
                if seen.contains(&key) {
                    let id: String = sql(connection(&database)?.query_row(
                        "SELECT id FROM tracks WHERE path=?1",
                        [&key],
                        |row| row.get(0),
                    ))?;
                    report.existing_ids.push(id);
                    report.skipped += 1;
                    return Ok(());
                }
                let (track, lyrics) = read_track(&absolute, &directory)?;
                let changed = sql(connection(&database)?.execute(
                    "INSERT OR IGNORE INTO tracks(id,path,metadata,lyrics) VALUES(?1,?2,?3,?4)",
                    params![track.id, track.path, serialize(&track)?, lyrics],
                ))?;
                if changed == 0 {
                    report.skipped += 1;
                } else {
                    report.tracks.push(track);
                }
                seen.insert(key);
                Ok(())
            })();
            if let Err(error) = result {
                report.errors.push(format!("{}: {error}", path.display()));
            }
            if index % 10 == 0 || index + 1 == total {
                let _ = app.emit(
                    "import-progress",
                    Progress {
                        done: index + 1,
                        total,
                    },
                );
            }
        }
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn audio_command(
    action: String,
    track_id: Option<String>,
    value: Option<f64>,
    app: tauri::AppHandle,
) -> Result<audio::Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = if action == "play" {
            let database = app.state::<Database>();
            let conn = connection(&database)?;
            Some(PathBuf::from(
                track_from_db(
                    &conn,
                    track_id.as_deref().ok_or("No hay canción seleccionada.")?,
                )?
                .path,
            ))
        } else {
            None
        };
        let status = app
            .state::<audio::Player>()
            .command(action, track_id, path, value)?;
        #[cfg(target_os = "windows")]
        {
            let _apartment = media::Apartment::new().ok();
            app.state::<media::Bridge>().update(&status);
        }
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn media_update(
    track_id: Option<String>,
    can_next: bool,
    can_previous: bool,
    position: f64,
    app: tauri::AppHandle,
) -> Result<()> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        let _apartment = media::Apartment::new().map_err(|e| e.to_string())?;
        let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let metadata = track_id
            .map(|id| {
                let db = app.state::<Database>();
                let conn = connection(&db)?;
                let track = track_from_db(&conn, &id)?;
                let cover = track
                    .cover
                    .filter(|path| Path::new(path).starts_with(root.join("covers")))
                    .unwrap_or_else(|| {
                        root.join("covers/glass-music.png")
                            .to_string_lossy()
                            .into_owned()
                    });
                Ok::<_, String>(media::Metadata {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    cover,
                    duration: track.duration,
                })
            })
            .transpose()?;
        let status = app
            .state::<audio::Player>()
            .command("status".into(), None, None, None)?;
        app.state::<media::Bridge>()
            .configure(metadata, can_next, can_previous, position, &status)
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (track_id, can_next, can_previous, position, app);
        Ok(())
    }
}
#[tauri::command]
async fn discord_update(
    config: presence::Config,
    track_id: Option<String>,
    playing: bool,
    position: f64,
    app: tauri::AppHandle,
) -> Result<presence::Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let song = if config.enabled && playing {
            if let Some(id) = track_id {
                let db = app.state::<Database>();
                let conn = connection(&db)?;
                let track = track_from_db(&conn, &id)?;
                Some(presence::Song {
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration,
                })
            } else {
                None
            }
        } else {
            None
        };
        Ok(app
            .state::<presence::Presence>()
            .update(config, song, playing, position))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_discord_portal() -> Result<()> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args([
            "url.dll,FileProtocolHandler",
            "https://discord.com/developers/applications",
        ])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg("https://discord.com/developers/applications")
        .spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg("https://discord.com/developers/applications")
        .spawn();
    result
        .map(|_| ())
        .map_err(|_| "Abre https://discord.com/developers/applications en tu navegador.".into())
}
fn initialize_database(conn: &Connection) -> rusqlite::Result<()> {
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL, lyrics TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=1;")
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            fs::create_dir_all(root.join("covers"))?;
            let conn = Connection::open(root.join("library.db"))?;
            initialize_database(&conn)?;
            app.manage(Database(Mutex::new(conn)));
            app.manage(lan::Hub::default());
            app.manage(audio::Player::new());
            app.manage(presence::Presence::new());
            #[cfg(target_os = "windows")]
            {
                fs::write(
                    root.join("covers/glass-music.png"),
                    include_bytes!("../icons/icon.png"),
                )?;
                let window = app
                    .get_webview_window("main")
                    .ok_or("No existe la ventana principal")?;
                let handle = app.handle().clone();
                app.manage(media::Bridge::new(
                    window.hwnd()?.0 as usize,
                    move |event| {
                        let _ = handle.emit("media-control", event);
                    },
                ));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<media::Bridge>().clear();
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            load_settings,
            save_settings,
            update_track,
            set_favorite,
            get_lyrics,
            save_lyrics,
            remove_track,
            remove_tracks,
            import_image,
            read_lyrics_file,
            import_music,
            audio_command,
            discord_update,
            media_update,
            open_discord_portal,
            listening_exchange,
            lan::lan_status,
            lan::lan_start,
            lan::lan_stop,
            lan::lan_pair,
            lan::lan_revoke
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Glass Music");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bulk_remove_preserves_original_files() {
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_database(&conn).unwrap();
        let mut paths = Vec::new();
        for id in ["one", "two", "keep"] {
            let path =
                std::env::temp_dir().join(format!("glass-bulk-{}-{id}.flac", std::process::id()));
            fs::write(&path, b"original music remains here").unwrap();
            conn.execute(
                "INSERT INTO tracks(id,path,metadata) VALUES(?1,?2,'{}')",
                params![id, path.to_string_lossy().to_string()],
            )
            .unwrap();
            paths.push(path);
        }
        remove_track_ids(&mut conn, &["one".into(), "two".into()]).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tracks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        for path in paths {
            assert_eq!(fs::read(&path).unwrap(), b"original music remains here");
            fs::remove_file(path).unwrap();
        }
    }
    #[test]
    fn database_rejects_duplicate_paths_and_roundtrips_unicode() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_database(&conn).unwrap();
        let track = Track {
            id: "one".into(),
            path: "C:\\Música\\Canción.flac".into(),
            title: "Canción 🎵".into(),
            artist: "Artista".into(),
            album: "Álbum".into(),
            feats: String::new(),
            duration: 240.0,
            format: "FLAC".into(),
            sample_rate: Some(96000),
            bit_depth: Some(24),
            cover: None,
            favorite: false,
            modified_at: None,
        };
        conn.execute(
            "INSERT INTO tracks VALUES(?1,?2,?3,?4)",
            params![
                track.id,
                track.path,
                serialize(&track).unwrap(),
                "[00:01.00] Hola"
            ],
        )
        .unwrap();
        assert_eq!(track_from_db(&conn, "one").unwrap().title, "Canción 🎵");
        assert!(conn
            .execute("INSERT INTO tracks VALUES('two',?1,'{}','')", [track.path])
            .is_err());
        conn.execute("DELETE FROM tracks WHERE id='one'", [])
            .unwrap();
        assert!(track_from_db(&conn, "one").is_err());
    }
    #[test]
    fn reads_flac_mp3_metadata_and_decodes_without_an_audio_device() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        let root = std::env::temp_dir().join(format!("glass-audio-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        for (filename, title) in [
            ("first.flac", "Primera luz"),
            ("second.mp3", "Otro momento"),
        ] {
            let path = fixtures.join(filename);
            let (track, lyrics) = read_track(&path, &root).unwrap();
            assert_eq!(track.title, title);
            assert!(track.duration > 15.0 && track.duration < 18.0);
            if filename.ends_with("flac") {
                assert!(lyrics.contains("Primera línea"));
            }
            let decoder =
                rodio::Decoder::new(std::io::BufReader::new(fs::File::open(path).unwrap()))
                    .unwrap();
            assert!(decoder.take(1000).count() > 0);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn file_modified_is_filesystem_time_and_legacy_metadata_still_loads() {
        let root = std::env::temp_dir().join(format!("glass-date-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("date.flac");
        fs::write(&path, b"date test").unwrap();
        let expected = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_650_000_000);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(expected))
            .unwrap();
        assert_eq!(file_modified(&path), Some(1_650_000_000_000.0));
        fs::remove_file(&path).unwrap();
        assert_eq!(file_modified(&path), None);
        let legacy = serde_json::json!({"id":"old","path":"missing.flac","title":"Manual title","artist":"Artist","album":"Album","feats":"","duration":180.0,"format":"FLAC","sampleRate":null,"bitDepth":null,"cover":null,"favorite":true});
        let track: Track = serde_json::from_value(legacy).unwrap();
        assert_eq!(track.modified_at, None);
        assert_eq!(track.title, "Manual title");
        assert!(track.favorite);
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn thumbnails_are_bounded_and_deduplicated() {
        let root = std::env::temp_dir().join(format!("glass-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = image::RgbImage::new(1200, 600);
        let mut png = Cursor::new(Vec::new());
        source.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let path = thumbnail(png.get_ref(), &root).unwrap();
        let result = image::open(&path).unwrap();
        assert_eq!(result.width(), 512);
        assert_eq!(result.height(), 256);
        assert_eq!(thumbnail(png.get_ref(), &root).unwrap(), path);
        assert!(thumbnail(b"not an image", &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
