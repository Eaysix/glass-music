use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub feats: String,
    pub duration: f64,
    pub format: String,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub favorite: bool,
    pub modified_at: Option<f64>,
    pub file_size: Option<u64>,
    pub file_revision: Option<String>,
    pub cover_revision: Option<String>,
    pub lyrics_revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub revision: String,
    pub cover_revision: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    pub device_id: String,
    pub device_name: String,
    pub track_id: String,
    pub position: f64,
    pub updated_at: f64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub protocol_version: u32,
    pub server_id: String,
    pub library_name: String,
    pub accent: String,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub resumes: Vec<Resume>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub text: String,
    pub revision: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub last_seen: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub secret: String,
    pub device_name: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResponse {
    pub device_id: String,
    pub server_id: String,
    pub token: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub protocol_version: u32,
    pub server_id: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub secret: String,
    pub expires_at: f64,
}
#[derive(Deserialize, Serialize, Debug)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Change {
    Lyrics {
        id: String,
        base_revision: String,
        text: String,
    },
    Favorite {
        id: String,
        value: bool,
    },
    Playlist {
        id: String,
        base_revision: Option<String>,
        name: String,
        track_ids: Vec<String>,
    },
    Resume {
        track_id: String,
        position: f64,
    },
}
#[derive(Deserialize, Serialize)]
pub struct Changes {
    pub changes: Vec<Change>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub index: usize,
    pub applied: bool,
    pub error: Option<String>,
    pub conflict: Option<serde_json::Value>,
}
