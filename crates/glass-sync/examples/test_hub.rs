//! Synthetic library for Simulator integration tests. Never opens a user's library.
use glass_sync::Server;
use rusqlite::{params, Connection};
use serde_json::json;
use std::{path::PathBuf, time::Duration};
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let output = PathBuf::from(args.get(1).expect("path for ephemeral Simulator fixture"));
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("covers")).unwrap();
    let db = root.path().join("test.db");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;CREATE TABLE tracks(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,lyrics TEXT NOT NULL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
    for (id, file, title) in [
        ("first", "first.flac", "Primera luz"),
        ("second", "second.mp3", "Otro momento"),
    ] {
        let path = fixtures.join(file).canonicalize().unwrap();
        let metadata = json!({"id":id,"path":path,"title":title,"artist":"Glass Test","album":"Pruebas","feats":"","duration":16.0,"format":if file.ends_with("flac"){"FLAC"}else{"MP3"},"favorite":false,"sampleRate":44100,"bitDepth":16,"cover":null,"modifiedAt":1000});
        conn.execute(
            "INSERT INTO tracks VALUES(?1,?2,?3,?4)",
            params![
                id,
                path.to_string_lossy(),
                metadata.to_string(),
                "[00:01]<00:01>Hola <00:02>mundo"
            ],
        )
        .unwrap();
    }
    conn.execute("INSERT INTO settings VALUES('app',?1)",[json!({"profile":{"name":"Glass Test"},"appearance":{"accent":"#8CCDF3"},"playlists":[{"id":"test","name":"Silencio sintético","trackIds":["first","second"],"cover":null}]}).to_string()]).unwrap();
    let server = Server::start(db, root.path().into(), 0, || {})
        .await
        .unwrap();
    let code = server.invitation("127.0.0.1").unwrap();
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(output, serde_json::to_vec(&code).unwrap()).unwrap();
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}
