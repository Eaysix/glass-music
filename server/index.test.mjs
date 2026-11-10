import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("private search, one-use pairing, seek ranges and revocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "glass-server-"));
  const script = fileURLToPath(new URL("index.mjs", import.meta.url));
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.searchParams.get("u"), "test-user");
    assert.equal(url.searchParams.get("t")?.length, 32);
    if (url.pathname.endsWith("/search3.view")) {
      assert.equal(url.searchParams.get("query"), "Example");
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          "subsonic-response": {
            status: "ok",
            searchResult3: {
              song: [{ id: "song-1", title: "Example", suffix: "flac" }],
            },
          },
        }),
      );
    }
    assert.equal(url.pathname, "/rest/stream.view");
    assert.equal(url.searchParams.get("format"), "raw");
    assert.equal(req.headers.range, "bytes=2-4");
    res.writeHead(206, {
      "Content-Type": "audio/flac",
      "Content-Length": 3,
      "Content-Range": "bytes 2-4/8",
      "Accept-Ranges": "bytes",
    });
    res.end("abc");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const env = {
    ...process.env,
    GLASS_SERVER_DATA: root,
    GLASS_NAVIDROME_USER: "test-user",
    GLASS_NAVIDROME_PASSWORD: "test-only",
    GLASS_NAVIDROME_URL: "http://127.0.0.1:" + upstream.address().port,
    GLASS_SERVER_PORT: "0",
  };
  const child = spawn(process.execPath, [script], {
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const command = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [script, ...args], {
        env,
        encoding: "utf8",
      }),
    );
  try {
    const [chunk] = await once(child.stdout, "data");
    const origin = "http://" + chunk.toString().trim().split(" ").at(-1);
    const request = (path, init) => fetch(origin + path, init);
    assert.equal((await request("/v1/search?q=Example")).status, 401);
    const invite = command("invite", "https://example.test");
    const pair = () =>
      request("/v1/pair", {
        method: "POST",
        body: JSON.stringify({ secret: invite.secret }),
      });
    const [a, b] = await Promise.all([pair(), pair()]);
    const accepted = a.ok ? a : b;
    assert.equal((a.ok ? b : a).status, 401);
    const { token, serverId } = await accepted.json();
    assert.match(serverId, /^[a-f0-9]{64}$/);
    const headers = { Authorization: "Bearer " + token };
    const tracks = await (
      await request("/v1/search?q=Example", { headers })
    ).json();
    assert.deepEqual(tracks, [
      {
        id: "song-1",
        title: "Example",
        artist: "",
        album: "",
        duration: 0,
        format: "flac",
      },
    ]);
    const { path } = await (
      await request("/v1/ticket", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: tracks[0].id, format: "flac" }),
      })
    ).json();
    assert.equal((await request(path.replace("song-1", "song-2"))).status, 401);
    const response = await request(path, { headers: { Range: "bytes=2-4" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-4/8");
    assert.equal(await response.text(), "abc");
    const [{ id }] = command("devices");
    execFileSync(process.execPath, [script, "revoke", id], { env });
    assert.equal((await request(path)).status, 401);
    assert.equal(
      (await request("/v1/search?q=Example", { headers })).status,
      401,
    );
  } finally {
    child.kill();
    upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});
