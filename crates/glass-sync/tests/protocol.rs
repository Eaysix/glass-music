use glass_sync::{
    models::*,
    store::{hash, Store},
    Server,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
struct Fixture {
    root: tempfile::TempDir,
    db: PathBuf,
    audio: Vec<u8>,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("covers")).unwrap();
        let db = root.path().join("library.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;CREATE TABLE tracks(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,lyrics TEXT NOT NULL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();
        let audio: Vec<u8> = (0..20000).map(|n| (n % 251) as u8).collect();
        let file = root.path().join("personal.flac");
        std::fs::write(&file, &audio).unwrap();
        let outside = root.path().join("private-key.txt");
        std::fs::write(&outside, b"must never be served as cover").unwrap();
        let metadata = json!({"id":"one","path":file,"title":"Canción 世界","artist":"Artista","album":"Álbum","feats":"","duration":180.0,"format":"FLAC","sampleRate":44100,"bitDepth":24,"cover":outside,"favorite":false,"modifiedAt":1000});
        conn.execute(
            "INSERT INTO tracks VALUES('one',?1,?2,?3)",
            params![
                file.to_string_lossy(),
                metadata.to_string(),
                "[00:01]<00:01>Mi <00:02>letra"
            ],
        )
        .unwrap();
        conn.execute("INSERT INTO settings VALUES('app',?1)",[json!({"profile":{"name":"Mi música","photo":"do not expose"},"discord":{"applicationId":"private setting"},"appearance":{"accent":"#8CCDF3"},"queue":{"current":"one"},"position":12.5,"playlists":[{"id":"p","name":"Playlist","trackIds":["one"],"cover":null}]}).to_string()]).unwrap();
        Self { root, db, audio }
    }
    async fn server(&self) -> Server {
        Server::start(self.db.clone(), self.root.path().into(), 0, || {})
            .await
            .unwrap()
    }
}
fn client(server: &Server) -> reqwest::Client {
    reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_der(&server.certificate).unwrap())
        .danger_accept_invalid_hostnames(true)
        .build()
        .unwrap()
}
async fn pair(server: &Server, client: &reqwest::Client) -> PairResponse {
    let code = server.invitation("127.0.0.1").unwrap();
    client
        .post(format!("https://127.0.0.1:{}/v1/pair", code.port))
        .json(&json!({"secret":code.secret,"deviceName":"iPhone de prueba"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
}
#[tokio::test]
async fn pairing_authentication_single_use_and_revocation() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    let client = client(&server);
    let code = server.invitation("127.0.0.1").unwrap();
    let base = format!("https://127.0.0.1:{}/v1", code.port);
    assert_eq!(
        client
            .get(format!("{base}/manifest"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let request = json!({"secret":code.secret,"deviceName":"iPhone"});
    let paired: PairResponse = client
        .post(format!("{base}/pair"))
        .json(&request)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        client
            .post(format!("{base}/pair"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert!(client
        .get(format!("{base}/manifest"))
        .bearer_auth(&paired.token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    server.revoke(&paired.device_id).unwrap();
    assert_eq!(
        client
            .get(format!("{base}/manifest"))
            .bearer_auth(&paired.token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let store = Store::open(fixture.db.clone(), fixture.root.path().into()).unwrap();
    assert!(store.devices().unwrap().is_empty());
}
#[tokio::test]
async fn pairing_rate_limit_and_manifest_never_expose_paths_or_credentials() {
    let f = Fixture::new();
    let server = f.server().await;
    let c = client(&server);
    let code = server.invitation("127.0.0.1").unwrap();
    let url = format!("https://127.0.0.1:{}/v1/pair", code.port);
    for _ in 0..5 {
        assert_eq!(
            c.post(&url)
                .json(&json!({"secret":"wrong","deviceName":"x"}))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        c.post(&url)
            .json(&json!({"secret":code.secret,"deviceName":"x"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let pair = pair(&server, &c).await;
    let url = format!(
        "https://127.0.0.1:{}/v1/manifest",
        server.status().unwrap().port
    );
    let manifest: Value = c
        .get(url)
        .bearer_auth(&pair.token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let raw = manifest.to_string();
    assert!(
        !raw.contains("personal.flac")
            && !raw.contains("private-key")
            && !raw.contains("discord")
            && !raw.contains("token")
            && !raw.contains("do not expose")
    );
    assert_eq!(manifest["tracks"][0]["title"], "Canción 世界");
    assert_eq!(manifest["tracks"][0]["fileSize"], 20000);
    assert_eq!(manifest["playlists"][0]["trackIds"][0], "one");
    assert_eq!(manifest["resumes"][0]["position"], 12.5);
}
#[tokio::test]
async fn tls_file_transfer_ranges_preconditions_and_cover_confinement() {
    let f = Fixture::new();
    let server = f.server().await;
    let c = client(&server);
    let pair = pair(&server, &c).await;
    let base = format!("https://127.0.0.1:{}/v1", server.status().unwrap().port);
    let full = c
        .get(format!("{base}/file/one"))
        .bearer_auth(&pair.token)
        .send()
        .await
        .unwrap();
    let etag = full.headers()["etag"].clone();
    assert_eq!(full.bytes().await.unwrap().as_ref(), f.audio.as_slice());
    let partial = c
        .get(format!("{base}/file/one"))
        .bearer_auth(&pair.token)
        .header("Range", "bytes=1234-")
        .header("If-Range", etag)
        .send()
        .await
        .unwrap();
    assert_eq!(partial.status(), 206);
    assert_eq!(partial.headers()["content-range"], "bytes 1234-19999/20000");
    assert_eq!(partial.bytes().await.unwrap().as_ref(), &f.audio[1234..]);
    assert_eq!(
        c.get(format!("{base}/file/one"))
            .bearer_auth(&pair.token)
            .header("Range", "bytes=999999-")
            .send()
            .await
            .unwrap()
            .status(),
        416
    );
    assert_eq!(
        c.get(format!("{base}/file/one"))
            .bearer_auth(&pair.token)
            .header("If-Match", "\"old\"")
            .send()
            .await
            .unwrap()
            .status(),
        412
    );
    assert_eq!(
        c.get(format!("{base}/cover/one"))
            .bearer_auth(&pair.token)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        c.get(format!("{base}/file/unknown"))
            .bearer_auth(&pair.token)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let untrusted = reqwest::Client::new();
    assert!(untrusted
        .get(format!("{base}/manifest"))
        .send()
        .await
        .is_err());
}
#[tokio::test]
async fn lyrics_conflicts_are_non_destructive_and_resume_does_not_replace_pc_queue() {
    let f = Fixture::new();
    let events = Arc::new(AtomicUsize::new(0));
    let count = events.clone();
    let server = Server::start(f.db.clone(), f.root.path().into(), 0, move || {
        count.fetch_add(1, Ordering::SeqCst);
    })
    .await
    .unwrap();
    let c = client(&server);
    let paired = pair(&server, &c).await;
    let base = format!("https://127.0.0.1:{}/v1", server.status().unwrap().port);
    let initial: Lyrics = c
        .get(format!("{base}/lyrics/one"))
        .bearer_auth(&paired.token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let changed = "[00:01]<00:01>Nueva <00:02>letra";
    let result:Vec<ChangeResult>=c.post(format!("{base}/changes")).bearer_auth(&paired.token).json(&json!({"changes":[{"kind":"lyrics","id":"one","baseRevision":initial.revision,"text":changed},{"kind":"favorite","id":"one","value":true},{"kind":"resume","trackId":"one","position":45.25}]})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert!(result.iter().all(|r| r.applied));
    let conflict:Vec<ChangeResult>=c.post(format!("{base}/changes")).bearer_auth(&paired.token).json(&json!({"changes":[{"kind":"lyrics","id":"one","baseRevision":initial.revision,"text":"stale iPhone edit"}]})).send().await.unwrap().json().await.unwrap();
    assert!(!conflict[0].applied);
    assert_eq!(conflict[0].conflict.as_ref().unwrap()["text"], changed);
    let store = Store::open(f.db.clone(), f.root.path().into()).unwrap();
    assert_eq!(store.lyrics("one").unwrap().revision, hash(changed));
    let snapshot = store.manifest().unwrap();
    assert!(snapshot.tracks[0].favorite);
    assert_eq!(
        snapshot
            .resumes
            .iter()
            .find(|r| r.device_id == paired.device_id)
            .unwrap()
            .position,
        45.25
    );
    assert_eq!(
        snapshot
            .resumes
            .iter()
            .find(|r| r.device_id == "pc")
            .unwrap()
            .position,
        12.5
    );
    assert!(events.load(Ordering::SeqCst) >= 2);
    assert_eq!(
        std::fs::read(f.root.path().join("personal.flac")).unwrap(),
        f.audio
    );
}
#[test]
fn database_upgrade_preserves_existing_lyrics_and_identity() {
    let f = Fixture::new();
    let first = Store::open(f.db.clone(), f.root.path().into()).unwrap();
    let second = Store::open(f.db.clone(), f.root.path().into()).unwrap();
    assert_eq!(first.server_id, second.server_id);
    assert_eq!(
        first.lyrics("one").unwrap().text,
        "[00:01]<00:01>Mi <00:02>letra"
    );
}

#[test]
fn phone_playlists_and_device_minutes_survive_retries_and_deletion() {
    let fixture = Fixture::new();
    let store = Store::open(fixture.db.clone(), fixture.root.path().into()).unwrap();
    let phone = store.add_device("Phone").unwrap();
    let create = || Change::Playlist { id: "local-test".into(), name: "Mi lista 世界".into(), track_ids: vec!["one".into()], base_revision: None, deleted: false, cover: None };
    assert!(store.apply(&phone.device_id, vec![create()]).unwrap()[0].applied);
    assert!(store.apply(&phone.device_id, vec![create()]).unwrap()[0].applied);
    let list = store.manifest().unwrap().playlists.into_iter().find(|p| p.id == "local-test").unwrap();
    assert_eq!(list.track_ids, vec!["one"]);
    let edit = Change::Playlist { id: list.id.clone(), name: "Renombrada".into(), track_ids: vec!["one".into()], base_revision: Some(list.revision.clone()), deleted: false, cover: None };
    assert!(store.apply(&phone.device_id, vec![edit]).unwrap()[0].applied);
    assert!(!store.apply(&phone.device_id, vec![create()]).unwrap()[0].applied); // stale edit must not overwrite
    let data = || vec![ListeningValue { day: "2026-10-29".into(), track_id: "one".into(), seconds: 120.0 }];
    for _ in 0..3 { assert!(store.apply(&phone.device_id, vec![Change::Listening { source_id: "stable-phone".into(), entries: data() }]).unwrap()[0].applied); }
    let conn = Connection::open(&fixture.db).unwrap();
    Store::merge_listening(&conn, "pc", vec![ListeningValue { day: "2026-10-29".into(), track_id: "one".into(), seconds: 60.0 }]).unwrap();
    assert_eq!(store.listening().unwrap().iter().map(|e| e.value.seconds).sum::<f64>(), 180.0);
    // Re-pairing still sends the same stable source: no duplicate listening time.
    let paired_again = store.add_device("Phone again").unwrap();
    store.apply(&paired_again.device_id, vec![Change::Listening { source_id: "stable-phone".into(), entries: data() }]).unwrap();
    assert_eq!(store.listening().unwrap().iter().map(|e| e.value.seconds).sum::<f64>(), 180.0);
    let delete = || Change::Playlist { id: list.id.clone(), name: String::new(), track_ids: vec![], base_revision: None, deleted: true, cover: None };
    assert!(store.apply(&phone.device_id, vec![delete(), delete()]).unwrap().iter().all(|r| r.applied));
    assert!(!store.apply(&phone.device_id, vec![create()]).unwrap()[0].applied);
    assert!(!store.manifest().unwrap().playlists.iter().any(|p| p.id == list.id));
    assert!(fixture.root.path().join("personal.flac").is_file());
}
