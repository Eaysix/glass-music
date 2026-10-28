use crate::models::*;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
pub type Result<T> = std::result::Result<T, String>;
pub fn hash(data: impl AsRef<[u8]>) -> String {
    hex::encode(Sha256::digest(data.as_ref()))
}
pub fn random() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}
fn db_result<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|e| e.to_string())
}
#[derive(Clone)]
pub struct Store {
    pub db: PathBuf,
    pub root: PathBuf,
    pub server_id: String,
}
impl Store {
    pub fn open(db: PathBuf, root: PathBuf) -> Result<Self> {
        let conn = db_result(Connection::open(&db))?;
        db_result(conn.execute_batch("CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sync_devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,last_seen REAL NOT NULL); CREATE TABLE IF NOT EXISTS sync_resume(device_id TEXT PRIMARY KEY,track_id TEXT NOT NULL,position REAL NOT NULL,updated_at REAL NOT NULL);"))?;
        let id: Option<String> = db_result(
            conn.query_row(
                "SELECT value FROM sync_meta WHERE key='server_id'",
                [],
                |r| r.get(0),
            )
            .optional(),
        )?;
        let server_id = id.unwrap_or_else(random);
        db_result(conn.execute(
            "INSERT OR IGNORE INTO sync_meta VALUES('server_id',?1)",
            [&server_id],
        ))?;
        Ok(Self {
            db,
            root,
            server_id,
        })
    }
    fn connect(&self) -> Result<Connection> {
        let c = db_result(Connection::open(&self.db))?;
        db_result(c.busy_timeout(Duration::from_secs(5)))?;
        Ok(c)
    }
    pub fn add_device(&self, name: &str) -> Result<PairResponse> {
        if name.trim().is_empty() || name.len() > 150 {
            return Err("Invalid device name".into());
        }
        let id = random();
        let token = random();
        db_result(self.connect()?.execute(
            "INSERT INTO sync_devices VALUES(?1,?2,?3,?4)",
            params![id, name.trim(), hash(&token), now()],
        ))?;
        Ok(PairResponse {
            device_id: id,
            server_id: self.server_id.clone(),
            token,
        })
    }
    pub fn authenticate(&self, token: &str) -> Result<String> {
        if token.len() != 64 {
            return Err("Unauthorized".into());
        }
        let conn = self.connect()?;
        let id: Option<String> = db_result(
            conn.query_row(
                "SELECT id FROM sync_devices WHERE token_hash=?1",
                [hash(token)],
                |r| r.get(0),
            )
            .optional(),
        )?;
        let id = id.ok_or("Unauthorized")?;
        db_result(conn.execute(
            "UPDATE sync_devices SET last_seen=?1 WHERE id=?2",
            params![now(), id],
        ))?;
        Ok(id)
    }
    pub fn devices(&self) -> Result<Vec<Device>> {
        let conn = self.connect()?;
        let mut stmt = db_result(
            conn.prepare("SELECT id,name,last_seen FROM sync_devices ORDER BY last_seen DESC"),
        )?;
        let rows = db_result(stmt.query_map([], |r| {
            Ok(Device {
                id: r.get(0)?,
                name: r.get(1)?,
                last_seen: r.get(2)?,
            })
        }))?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }
    pub fn revoke(&self, id: &str) -> Result<()> {
        let c = self.connect()?;
        db_result(c.execute("DELETE FROM sync_devices WHERE id=?1", [id]))?;
        db_result(c.execute("DELETE FROM sync_resume WHERE device_id=?1", [id]))?;
        Ok(())
    }
    fn settings(conn: &Connection) -> Result<Value> {
        let raw: Option<String> = db_result(
            conn.query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
                r.get(0)
            })
            .optional(),
        )?;
        raw.map(|r| serde_json::from_str(&r).map_err(|e| e.to_string()))
            .unwrap_or_else(|| Ok(json!({})))
    }
    pub fn manifest(&self) -> Result<Manifest> {
        let conn = self.connect()?;
        let settings = Self::settings(&conn)?;
        let mut statement =
            db_result(conn.prepare("SELECT metadata,lyrics FROM tracks ORDER BY rowid"))?;
        let rows = db_result(
            statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))),
        )?;
        let mut tracks = Vec::new();
        for row in rows {
            let (raw, lyrics) = db_result(row)?;
            let t: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let file = t["path"].as_str().and_then(|p| file_info(Path::new(p)));
            tracks.push(Track {
                id: text(&t, "id"),
                title: text(&t, "title"),
                artist: text(&t, "artist"),
                album: text(&t, "album"),
                feats: text(&t, "feats"),
                duration: t["duration"].as_f64().unwrap_or(0.0),
                format: text(&t, "format"),
                sample_rate: t["sampleRate"].as_u64().map(|n| n as u32),
                bit_depth: t["bitDepth"].as_u64().map(|n| n as u8),
                favorite: t["favorite"].as_bool().unwrap_or(false),
                modified_at: t["modifiedAt"].as_f64(),
                file_size: file.as_ref().map(|f| f.0),
                file_revision: file.map(|f| f.1),
                cover_revision: self
                    .safe_cover(t["cover"].as_str())
                    .and_then(|p| file_info(&p).map(|f| f.1)),
                lyrics_revision: hash(lyrics),
            });
        }
        let playlists = settings["playlists"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| self.playlist(p))
            .collect();
        let mut stmt=db_result(conn.prepare("SELECT r.device_id,d.name,r.track_id,r.position,r.updated_at FROM sync_resume r JOIN sync_devices d ON d.id=r.device_id ORDER BY r.updated_at DESC"))?;
        let mut resumes: Vec<Resume> = db_result(stmt.query_map([], |r| {
            Ok(Resume {
                device_id: r.get(0)?,
                device_name: r.get(1)?,
                track_id: r.get(2)?,
                position: r.get(3)?,
                updated_at: r.get(4)?,
            })
        }))?
        .map(|r| r.map_err(|e| e.to_string()))
        .collect::<Result<_>>()?;
        if let Some(id) = settings["queue"]["current"].as_str() {
            resumes.push(Resume {
                device_id: "pc".into(),
                device_name: "PC".into(),
                track_id: id.into(),
                position: settings["position"].as_f64().unwrap_or(0.0),
                updated_at: 0.0,
            });
        }
        Ok(Manifest {
            protocol_version: 1,
            server_id: self.server_id.clone(),
            library_name: settings["profile"]["name"]
                .as_str()
                .unwrap_or("Glass Music")
                .into(),
            accent: settings["appearance"]["accent"]
                .as_str()
                .filter(|s| {
                    s.len() == 7
                        && s.starts_with('#')
                        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
                })
                .unwrap_or("#8CCDF3")
                .into(),
            tracks,
            playlists,
            resumes,
        })
    }
    fn playlist(&self, p: &Value) -> Playlist {
        let ids: Vec<String> = p["trackIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        Playlist {
            id: text(p, "id"),
            name: text(p, "name"),
            revision: playlist_revision(p),
            track_ids: ids,
            cover_revision: self
                .safe_cover(p["cover"].as_str())
                .and_then(|p| file_info(&p).map(|f| f.1)),
        }
    }
    fn track(conn: &Connection, id: &str) -> Result<Value> {
        let raw: String = db_result(conn.query_row(
            "SELECT metadata FROM tracks WHERE id=?1",
            [id],
            |r| r.get(0),
        ))?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    }
    pub fn lyrics(&self, id: &str) -> Result<Lyrics> {
        let text: String = db_result(self.connect()?.query_row(
            "SELECT lyrics FROM tracks WHERE id=?1",
            [id],
            |r| r.get(0),
        ))?;
        Ok(Lyrics {
            revision: hash(&text),
            text,
        })
    }
    pub fn media(&self, id: &str) -> Result<PathBuf> {
        let t = Self::track(&self.connect()?, id)?;
        let p = PathBuf::from(t["path"].as_str().ok_or("No file")?);
        if !p.is_file() {
            return Err("File unavailable".into());
        }
        Ok(p)
    }
    pub fn cover(&self, id: &str, playlist: bool) -> Result<PathBuf> {
        let conn = self.connect()?;
        let value = if playlist {
            Self::settings(&conn)?["playlists"]
                .as_array()
                .and_then(|a| a.iter().find(|p| p["id"] == id))
                .cloned()
                .ok_or("No playlist")?
        } else {
            Self::track(&conn, id)?
        };
        self.safe_cover(value["cover"].as_str())
            .ok_or("No cover".into())
    }
    fn safe_cover(&self, path: Option<&str>) -> Option<PathBuf> {
        let root = self.root.join("covers").canonicalize().ok()?;
        let p = Path::new(path?).canonicalize().ok()?;
        (p.starts_with(root) && p.is_file()).then_some(p)
    }
    pub fn apply(&self, device_id: &str, changes: Vec<Change>) -> Result<Vec<ChangeResult>> {
        if changes.len() > 500 {
            return Err("Too many changes".into());
        }
        let mut conn = self.connect()?;
        let mut results = Vec::new();
        for (index, change) in changes.into_iter().enumerate() {
            let tx = db_result(conn.transaction())?;
            let result = (|| -> Result<Option<Value>> {
                match change {
                    Change::Lyrics {
                        id,
                        base_revision,
                        text,
                    } => {
                        if text.len() > 1024 * 1024 {
                            return Err("Lyrics exceed 1 MB".into());
                        }
                        let current: String = db_result(tx.query_row(
                            "SELECT lyrics FROM tracks WHERE id=?1",
                            [&id],
                            |r| r.get(0),
                        ))?;
                        if hash(&current) != base_revision && current != text {
                            return Ok(Some(
                                json!({"kind":"lyrics","text":current,"revision":hash(&current)}),
                            ));
                        }
                        db_result(tx.execute(
                            "UPDATE tracks SET lyrics=?1 WHERE id=?2",
                            params![text, id],
                        ))?;
                    }
                    Change::Favorite { id, value } => {
                        let mut t = Self::track(&tx, &id)?;
                        t["favorite"] = json!(value);
                        db_result(tx.execute(
                            "UPDATE tracks SET metadata=?1 WHERE id=?2",
                            params![t.to_string(), id],
                        ))?;
                    }
                    Change::Resume { track_id, position } => {
                        let t = Self::track(&tx, &track_id)?;
                        if !position.is_finite() || position < 0.0 {
                            return Err("Invalid position".into());
                        }
                        let position =
                            position.min(t["duration"].as_f64().unwrap_or(position).max(0.0));
                        db_result(tx.execute("INSERT INTO sync_resume VALUES(?1,?2,?3,?4) ON CONFLICT(device_id) DO UPDATE SET track_id=excluded.track_id,position=excluded.position,updated_at=excluded.updated_at",params![device_id,track_id,position,now()]))?;
                    }
                }
                Ok(None)
            })();
            match result {
                Ok(conflict) => {
                    let applied = conflict.is_none();
                    if applied {
                        db_result(tx.commit())?;
                    }
                    results.push(ChangeResult {
                        index,
                        applied,
                        error: None,
                        conflict,
                    });
                }
                Err(error) => results.push(ChangeResult {
                    index,
                    applied: false,
                    error: Some(error),
                    conflict: None,
                }),
            }
        }
        Ok(results)
    }
}
fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").into()
}
pub fn file_info(path: &Path) -> Option<(u64, String)> {
    let m = fs::metadata(path).ok()?;
    let modified = m
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some((m.len(), hash(format!("{}:{modified}", m.len()))))
}
fn playlist_revision(p: &Value) -> String {
    hash(json!({"name":p["name"],"trackIds":p["trackIds"]}).to_string())
}
