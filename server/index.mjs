import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(process.env.GLASS_SERVER_DATA ?? "server-data");
const statePath = join(root, "devices.json");
const invitePath = join(root, "invite.json");
const random = () => randomBytes(32).toString("hex");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const secretPattern = /^[a-f0-9]{64}$/;
const safeId = /^[A-Za-z0-9_-]{1,128}$/;
function same(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  );
}
function save(path, value) {
  const temporary = path + "." + randomBytes(8).toString("hex");
  writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}
function load(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
function publicOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Usa la dirección HTTPS del túnel, sin rutas ni parámetros.",
    );
  }
  return url.origin;
}
function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const pieces = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 4096) throw new Error("Solicitud demasiado grande");
    pieces.push(part);
  }
  return JSON.parse(Buffer.concat(pieces).toString("utf8"));
}

mkdirSync(root, { recursive: true, mode: 0o700 });
if (process.argv[2] === "invite") {
  const origin = publicOrigin(process.argv[3]);
  const secret = random();
  save(invitePath, { hash: hash(secret), expires: Date.now() + 5 * 60_000 });
  console.log(JSON.stringify({ origin, secret }));
  process.exit(0);
}
if (process.argv[2] === "devices") {
  const state = load(statePath, { devices: [] });
  console.log(
    JSON.stringify(
      state.devices.map(({ id, name }) => ({ id, name })),
      null,
      2,
    ),
  );
  process.exit(0);
}
if (process.argv[2] === "revoke") {
  const state = load(statePath, { devices: [] });
  const devices = state.devices.filter(({ id }) => id !== process.argv[3]);
  if (devices.length === state.devices.length)
    throw new Error("Dispositivo no encontrado.");
  save(statePath, { ...state, devices });
  process.exit(0);
}
if (process.argv[2])
  throw new Error("Comandos disponibles: invite, devices, revoke.");

const upstream = new URL(
  process.env.GLASS_NAVIDROME_URL ?? "http://127.0.0.1:4533",
);
const user = process.env.GLASS_NAVIDROME_USER;
const password = process.env.GLASS_NAVIDROME_PASSWORD;
if (!user || !password)
  throw new Error("Configura GLASS_NAVIDROME_USER y GLASS_NAVIDROME_PASSWORD.");
if (
  upstream.origin !== "http://127.0.0.1:" + (upstream.port || "80") &&
  upstream.protocol !== "https:"
) {
  throw new Error("Navidrome debe usar HTTPS o HTTP en 127.0.0.1.");
}
if (!load(statePath, null))
  save(statePath, { signingKey: random(), devices: [] });
const port = Number(process.env.GLASS_SERVER_PORT ?? 8767);

function navidrome(method, fields, options) {
  const url = new URL(upstream.href);
  url.pathname = url.pathname.replace(/\/$/, "") + "/rest/" + method + ".view";
  const salt = randomBytes(12).toString("hex");
  const token = createHash("md5")
    .update(password + salt)
    .digest("hex");
  url.search = new URLSearchParams({
    u: user,
    t: token,
    s: salt,
    c: "GlassMusic",
    v: "1.16.1",
    f: "json",
    ...fields,
  });
  return fetch(url, { ...options, redirect: "error" });
}

function signature(state, device, id, expires) {
  return createHmac("sha256", state.signingKey)
    .update([device, id, expires].join(":"))
    .digest("hex");
}
async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  let state = load(statePath, null);
  if (req.method === "POST" && url.pathname === "/v1/pair") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: "Invitación inválida" });
    }
    const invite = load(invitePath, null);
    if (
      !invite ||
      Date.now() >= invite.expires ||
      typeof body?.secret !== "string" ||
      !secretPattern.test(body.secret) ||
      !same(hash(body.secret), invite.hash)
    ) {
      return json(res, 401, { error: "Invitación inválida o vencida" });
    }
    unlinkSync(invitePath);
    state = load(statePath, null);
    const token = random();
    const device = {
      id: randomBytes(16).toString("hex"),
      name: String(body.name ?? "Glass Music").slice(0, 80),
      hash: hash(token),
    };
    state.devices.push(device);
    save(statePath, state);
    return json(res, 200, { token, serverId: hash(state.signingKey) });
  }
  const media = /^\/v1\/audio\/([A-Za-z0-9_-]{1,128})\.(flac|mp3)$/.exec(
    url.pathname,
  );
  if ((req.method === "GET" || req.method === "HEAD") && media) {
    const [, id, extension] = media;
    const device = url.searchParams.get("d");
    const expires = Number(url.searchParams.get("e"));
    const supplied = url.searchParams.get("s");
    if (
      !state.devices.some((item) => item.id === device) ||
      !Number.isSafeInteger(expires) ||
      expires <= Date.now() ||
      !secretPattern.test(supplied ?? "") ||
      !same(supplied, signature(state, device, id + "." + extension, expires))
    ) {
      return json(res, 401, { error: "Enlace de audio vencido" });
    }
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    const headers = {};
    if (req.headers.range) {
      if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range))
        return json(res, 416, { error: "Rango inválido" });
      headers.Range = req.headers.range;
    }
    const response = await navidrome(
      "stream",
      { id, format: "raw" },
      { headers, signal: abort.signal },
    );
    if (response.status === 416) {
      const range = response.headers.get("content-range");
      if (range) res.setHeader("Content-Range", range);
      await response.body?.cancel();
      res.writeHead(416).end();
      return;
    }
    const type = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !/^(audio\/|application\/octet-stream)/i.test(type) ||
      (headers.Range && response.status !== 206)
    ) {
      await response.body?.cancel();
      return json(res, 502, {
        error: "Navidrome no entregó el audio o el rango solicitado",
      });
    }
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader(
      "Content-Type",
      extension === "flac" ? "audio/flac" : "audio/mpeg",
    );
    res.writeHead(response.status);
    if (req.method === "HEAD" || !response.body) {
      await response.body?.cancel();
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), res);
    return;
  }
  const auth = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? "");
  const device =
    auth && state.devices.find((item) => same(item.hash, hash(auth[1])));
  if (!device) return json(res, 401, { error: "Vincula este dispositivo" });
  if (req.method === "GET" && url.pathname === "/v1/search") {
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length < 2 || query.length > 150)
      return json(res, 400, { error: "Escribe entre 2 y 150 caracteres" });
    const response = await navidrome(
      "search3",
      { query, songCount: "60", artistCount: "0", albumCount: "0" },
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok)
      return json(res, 502, { error: "Navidrome no respondió" });
    const payload = (await response.json())["subsonic-response"];
    if (payload?.status !== "ok")
      return json(res, 502, { error: "Navidrome rechazó la búsqueda" });
    const songs = (payload.searchResult3?.song ?? []).filter(
      (song) => safeId.test(song.id) && ["flac", "mp3"].includes(song.suffix),
    );
    return json(
      res,
      200,
      songs.map(({ id, title, artist, album, duration, suffix }) => ({
        id,
        title,
        artist: artist ?? "",
        album: album ?? "",
        duration: duration ?? 0,
        format: suffix,
      })),
    );
  }
  if (req.method === "POST" && url.pathname === "/v1/ticket") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: "Canción inválida" });
    }
    if (
      typeof body?.id !== "string" ||
      !safeId.test(body.id) ||
      !["flac", "mp3"].includes(body.format)
    ) {
      return json(res, 400, { error: "Canción inválida" });
    }
    const expires = Date.now() + 6 * 60 * 60_000;
    const file = body.id + "." + body.format;
    const query = new URLSearchParams({
      d: device.id,
      e: String(expires),
      s: signature(state, device.id, file, expires),
    });
    return json(res, 200, { path: "/v1/audio/" + file + "?" + query });
  }
  json(res, 404, { error: "Ruta no disponible" });
}

const server = createServer((req, res) => {
  route(req, res).catch(() => {
    if (res.headersSent) res.destroy();
    else if (!res.destroyed)
      json(res, 502, { error: "El servidor no pudo completar la solicitud" });
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log("Glass Music en 127.0.0.1:" + server.address().port),
);
