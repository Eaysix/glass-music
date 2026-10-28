pub mod models;
pub mod store;
use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use models::*;
use serde::Serialize;
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use store::{hash, now, random, Result, Store};
use tokio::io::AsyncReadExt;
use tokio_util::io::ReaderStream;

struct Invitation {
    secret: String,
    expires: Instant,
    attempts: u8,
}
struct Hub {
    store: Store,
    invitation: Mutex<Option<Invitation>>,
    changed: Arc<dyn Fn() + Send + Sync>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub server_id: String,
    pub addresses: Vec<String>,
    pub port: u16,
    pub fingerprint: String,
    pub devices: Vec<Device>,
}
pub struct Server {
    hub: Arc<Hub>,
    handle: axum_server::Handle,
    addresses: Vec<String>,
    port: u16,
    fingerprint: String,
    pub certificate: Vec<u8>,
}
impl Server {
    pub async fn start(
        db: PathBuf,
        root: PathBuf,
        port: u16,
        changed: impl Fn() + Send + Sync + 'static,
    ) -> Result<Self> {
        let store = Store::open(db, root.clone())?;
        let folder = root.join("sync");
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let cert_path = folder.join("certificate.pem");
        let key_path = folder.join("private-key.pem");
        if !cert_path.exists() || !key_path.exists() {
            let rcgen::CertifiedKey { cert, key_pair } =
                rcgen::generate_simple_self_signed(vec!["glass-music.local".into()])
                    .map_err(|e| e.to_string())?;
            fs::write(&cert_path, cert.pem()).map_err(|e| e.to_string())?;
            fs::write(&key_path, key_pair.serialize_pem()).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())?;
            }
        }
        let cert = fs::read(&cert_path).map_err(|e| e.to_string())?;
        let key = fs::read(&key_path).map_err(|e| e.to_string())?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = axum_server::tls_rustls::RustlsConfig::from_pem(cert, key)
            .await
            .map_err(|e| e.to_string())?;
        // Decode the leaf PEM ourselves only for its public SHA-256 pin.
        let pem = fs::read_to_string(&cert_path).map_err(|e| e.to_string())?;
        let der = decode_certificate(&pem)?;
        let fingerprint = hash(&der);
        let listener =
            TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let hub = Arc::new(Hub {
            store,
            invitation: Mutex::new(None),
            changed: Arc::new(changed),
        });
        let router = Router::new()
            .route("/v1/pair", post(pair))
            .route("/v1/manifest", get(manifest))
            .route("/v1/lyrics/{id}", get(lyrics))
            .route("/v1/file/{id}", get(media))
            .route("/v1/cover/{id}", get(cover))
            .route("/v1/playlist-cover/{id}", get(playlist_cover))
            .route("/v1/changes", post(changes))
            .layer(DefaultBodyLimit::max(5 * 1024 * 1024))
            .layer(middleware::from_fn(local_only))
            .with_state(hub.clone());
        let handle = axum_server::Handle::new();
        let task_handle = handle.clone();
        tokio::spawn(async move {
            let _ = axum_server::from_tcp_rustls(listener, config)
                .handle(task_handle)
                .serve(router.into_make_service_with_connect_info::<SocketAddr>())
                .await;
        });
        let mut addresses: Vec<String> = if_addrs::get_if_addrs()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter_map(|i| match i.ip() {
                IpAddr::V4(ip) if ip.is_private() && !ip.is_loopback() => Some(ip.to_string()),
                _ => None,
            })
            .collect();
        addresses.sort();
        addresses.dedup();
        Ok(Self {
            hub,
            handle,
            addresses,
            port,
            fingerprint,
            certificate: der,
        })
    }
    pub fn status(&self) -> Result<Status> {
        Ok(Status {
            running: true,
            server_id: self.hub.store.server_id.clone(),
            addresses: self.addresses.clone(),
            port: self.port,
            fingerprint: self.fingerprint.clone(),
            devices: self.hub.store.devices()?,
        })
    }
    pub fn invitation(&self, host: &str) -> Result<Pairing> {
        if !self.addresses.iter().any(|a| a == host) && host != "127.0.0.1" {
            return Err("Choose a local network address".into());
        }
        let secret = random();
        *self.hub.invitation.lock().map_err(|_| "Pairing is busy")? = Some(Invitation {
            secret: secret.clone(),
            expires: Instant::now() + Duration::from_secs(300),
            attempts: 0,
        });
        Ok(Pairing {
            protocol_version: 1,
            server_id: self.hub.store.server_id.clone(),
            host: host.into(),
            port: self.port,
            fingerprint: self.fingerprint.clone(),
            secret,
            expires_at: now() + 300000.0,
        })
    }
    pub fn revoke(&self, id: &str) -> Result<()> {
        self.hub.store.revoke(id)
    }
    pub fn manifest(&self) -> Result<Manifest> {
        self.hub.store.manifest()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.handle.graceful_shutdown(Some(Duration::from_secs(1)));
    }
}
fn decode_certificate(pem: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    let body: String = pem.lines().filter(|l| !l.starts_with("---")).collect();
    base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|e| e.to_string())
}
async fn local_only(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let local = match peer.ip() {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    };
    if !local {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}
type ApiResult<T> = std::result::Result<T, (StatusCode, String)>;
fn auth(hub: &Hub, headers: &HeaderMap) -> ApiResult<String> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "Pair this device first".into()))?;
    hub.store
        .authenticate(token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Device is not linked".into()))
}
fn failed(error: String) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, error)
}
async fn pair(
    State(hub): State<Arc<Hub>>,
    Json(body): Json<PairRequest>,
) -> ApiResult<Json<PairResponse>> {
    let mut invitation = hub
        .invitation
        .lock()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Pairing is busy".into()))?;
    let code = invitation.as_mut().ok_or((
        StatusCode::FORBIDDEN,
        "Generate a pairing code on PC".into(),
    ))?;
    if code.expires < Instant::now() || code.attempts >= 5 {
        return Err((StatusCode::FORBIDDEN, "Pairing code expired".into()));
    }
    code.attempts += 1;
    if hash(&body.secret) != hash(&code.secret) {
        return Err((StatusCode::FORBIDDEN, "Invalid pairing code".into()));
    }
    let response = hub.store.add_device(&body.device_name).map_err(failed)?;
    *invitation = None;
    Ok(Json(response))
}
async fn manifest(State(hub): State<Arc<Hub>>, headers: HeaderMap) -> ApiResult<Json<Manifest>> {
    auth(&hub, &headers)?;
    let store = hub.store.clone();
    let result = tokio::task::spawn_blocking(move || store.manifest())
        .await
        .map_err(|e| failed(e.to_string()))?
        .map_err(failed)?;
    Ok(Json(result))
}
async fn lyrics(
    State(hub): State<Arc<Hub>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Lyrics>> {
    auth(&hub, &headers)?;
    hub.store
        .lyrics(&id)
        .map(Json)
        .map_err(|_| (StatusCode::NOT_FOUND, "Lyrics unavailable".into()))
}
async fn changes(
    State(hub): State<Arc<Hub>>,
    headers: HeaderMap,
    Json(body): Json<Changes>,
) -> ApiResult<Json<Vec<ChangeResult>>> {
    let device = auth(&hub, &headers)?;
    let store = hub.store.clone();
    let results = tokio::task::spawn_blocking(move || store.apply(&device, body.changes))
        .await
        .map_err(|e| failed(e.to_string()))?
        .map_err(failed)?;
    if results.iter().any(|r| r.applied) {
        (hub.changed)();
    }
    Ok(Json(results))
}
async fn media(
    State(hub): State<Arc<Hub>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    auth(&hub, &headers)?;
    let path = hub
        .store
        .media(&id)
        .map_err(|_| (StatusCode::NOT_FOUND, "Audio file unavailable on PC".into()))?;
    file_response(path, headers, true).await
}
async fn cover(
    State(hub): State<Arc<Hub>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    auth(&hub, &headers)?;
    let path = hub
        .store
        .cover(&id, false)
        .map_err(|_| (StatusCode::NOT_FOUND, "No cover".into()))?;
    file_response(path, headers, false).await
}
async fn playlist_cover(
    State(hub): State<Arc<Hub>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    auth(&hub, &headers)?;
    let path = hub
        .store
        .cover(&id, true)
        .map_err(|_| (StatusCode::NOT_FOUND, "No cover".into()))?;
    file_response(path, headers, false).await
}
async fn file_response(path: PathBuf, headers: HeaderMap, ranges: bool) -> ApiResult<Response> {
    let (size, revision) =
        store::file_info(&path).ok_or((StatusCode::NOT_FOUND, "File unavailable".into()))?;
    let etag = format!("\"{revision}\"");
    let content_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    let mut start = 0;
    let mut length = size;
    let mut partial = false;
    if ranges
        && headers
            .get(header::IF_RANGE)
            .is_none_or(|h| h.to_str().ok() == Some(&etag))
    {
        if let Some(range) = headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
            let parsed = range
                .strip_prefix("bytes=")
                .and_then(|s| s.split_once('-'))
                .and_then(|(s, e)| {
                    Some((
                        s.parse::<u64>().ok()?,
                        if e.is_empty() {
                            size.checked_sub(1)?
                        } else {
                            e.parse::<u64>().ok()?
                        },
                    ))
                });
            let Some((from, to)) =
                parsed.filter(|(from, to)| *from < size && *to >= *from && *to < size)
            else {
                return Ok((
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [(header::CONTENT_RANGE, format!("bytes */{size}"))],
                )
                    .into_response());
            };
            start = from;
            length = to - from + 1;
            partial = true;
        }
    }
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| failed(e.to_string()))?;
    tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| failed(e.to_string()))?;
    let body = Body::from_stream(ReaderStream::new(file.take(length)));
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "private, no-store");
    if ranges {
        response = response.header(header::ACCEPT_RANGES, "bytes");
    }
    if partial {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{size}", start + length - 1),
        );
    }
    response.body(body).map_err(|e| failed(e.to_string()))
}
