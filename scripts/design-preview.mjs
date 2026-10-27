// Reproducible screenshots with synthetic metadata, artwork and silent test audio.
import { chromium } from "playwright";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1422, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.GLASS_TEST_BROWSER
    ? {
        executablePath: process.env.GLASS_TEST_BROWSER,
        args: [
          "--no-sandbox",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
          "--disable-software-rasterizer",
        ],
      }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1360, height: 880 } });
await fs.mkdir("artifacts/motion", { recursive: true });
try {
  await page.goto("http://127.0.0.1:1422");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Añadir música", exact: true })
    .click();
  await (
    await chooser
  ).setFiles([
    path.resolve("tests/fixtures/first.flac"),
    path.resolve("tests/fixtures/second.mp3"),
  ]);
  await page.waitForFunction(
    () => document.querySelectorAll(".track-row").length === 2,
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("glass-music-dev", 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["data", "files"], "readwrite");
          const store = tx.objectStore("data"),
            files = tx.objectStore("files");
          const get = store.get("tracks");
          get.onsuccess = () => {
            const base = get.result;
            const readAudio = files.get(base[0].id);
            readAudio.onsuccess = () => {
              const titles = [
                "Luz azul",
                "Después de las doce",
                "Órbita",
                "En otra vida",
                "Mar abierto",
                "Sin gravedad",
                "Cerca de ti",
                "Pausa",
              ];
              const artists = [
                "Estudio Norte",
                "Luna Clara",
                "Horizonte",
                "Estudio Norte",
                "Azul Profundo",
                "Luna Clara",
                "Horizonte",
                "Azul Profundo",
              ];
              const colors = [
                ["#234470", "#a7d6f8"],
                ["#5e2d5b", "#eb9eb7"],
                ["#39345a", "#bfa9ed"],
                ["#74452e", "#f4cc8a"],
                ["#154e59", "#9fdfdb"],
                ["#49475a", "#d8c6ff"],
                ["#6e3a40", "#f3ac9e"],
                ["#3b5554", "#d2d7ac"],
              ];
              function cover(i) {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 512;
                const ctx = canvas.getContext("2d");
                const [a, b] = colors[i];
                const gradient = ctx.createLinearGradient(0, 0, 512, 512);
                gradient.addColorStop(0, a);
                gradient.addColorStop(1, "#0e172b");
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, 512, 512);
                ctx.translate(256, 240);
                ctx.rotate(i * 0.2 - 0.4);
                for (let j = 0; j < 9; j++) {
                  ctx.strokeStyle = b + (j % 2 ? "55" : "bb");
                  ctx.lineWidth = 1 + j * 0.3;
                  ctx.beginPath();
                  ctx.ellipse(
                    0,
                    j * 3,
                    70 + j * 20,
                    45 + j * 10,
                    j * 0.06,
                    0,
                    Math.PI * 2,
                  );
                  ctx.stroke();
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillStyle = b;
                ctx.font = "500 21px sans-serif";
                ctx.fillText(titles[i].toUpperCase(), 38, 445);
                ctx.font = "12px sans-serif";
                ctx.fillText("GLASS SESSIONS / 0" + (i + 1), 39, 473);
                return canvas.toDataURL("image/png");
              }
              const tracks = titles.map((title, i) => ({
                ...base[0],
                id: `demo-${i}`,
                title,
                artist: artists[i],
                album: [
                  "Nocturno",
                  "Lado B",
                  "Órbita",
                  "Nocturno",
                  "Mareas",
                  "Lado B",
                  "Órbita",
                  "Mareas",
                ][i],
                cover: cover(i),
                favorite: i === 0 || i === 3,
                feats: "",
              }));
              store.put(tracks, "tracks");
              for (const track of tracks) {
                files.put(readAudio.result, track.id);
                store.put(
                  "[00:00.00]La noche empieza aquí\n[00:03.00]Déjate llevar por el sonido\n[00:06.00]Todo se vuelve luz\n[00:09.00]Y el mundo puede esperar\n[00:12.00]Un momento para ti",
                  `lyrics:${track.id}`,
                );
              }
              store.put(
                {
                  profile: { name: "Mi espacio", photo: null },
                  appearanceVersion: 1,
                  uiScale: 1,
                  player: { autoHide: false, volumeStep: 2 },
                  performance: "balanced",
                  discord: {
                    enabled: false,
                    applicationId: "",
                    showAlbum: true,
                  },
                  appearance: {
                    accent: "#8CCDF3",
                    glass: 20,
                    reduced: false,
                    theme: "dark",
                  },
                  playlists: [
                    {
                      id: "night",
                      name: "Noches lentas",
                      cover: tracks[1].cover,
                      trackIds: ["demo-0", "demo-1", "demo-4"],
                    },
                    {
                      id: "drive",
                      name: "En el camino",
                      cover: tracks[3].cover,
                      trackIds: ["demo-2", "demo-3"],
                    },
                    {
                      id: "pause",
                      name: "Un respiro",
                      cover: tracks[4].cover,
                      trackIds: ["demo-4", "demo-7"],
                    },
                  ],
                  queue: {
                    current: "demo-0",
                    upcoming: tracks.slice(1).map((t) => t.id),
                    history: [],
                    context: tracks.map((t) => t.id),
                  },
                  volume: 0.7,
                  shuffle: "off",
                  repeat: "off",
                  position: 0,
                },
                "settings",
              );
            };
          };
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByRole("heading", { name: "Tu biblioteca" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/design-library.png" });
  await page.locator(".track-title").nth(0).click();
  await page
    .locator(".track-title")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await page.screenshot({ path: "artifacts/design-selection.png" });
  await page
    .getByRole("button", { name: "Limpiar selección", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Ajustes de apariencia y perfil",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Reproductor", exact: true }).click();
  await page.screenshot({ path: "artifacts/design-settings.png" });
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page
    .getByRole("button", { name: "Ajustar volumen", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/design-volume.png" });
  await page
    .getByRole("button", { name: "Cerrar volumen", exact: true })
    .click();
  // Optional recording: capture actual UI frames while exercising transitions.
  if (process.env.GLASS_RECORD_MOTION) {
    let recording = true;
    const frames = [];
    const capture = (async () => {
      while (recording) {
        const file = path.resolve(
          `artifacts/motion/${String(frames.length).padStart(4, "0")}.png`,
        );
        frames.push({ file, at: Date.now() });
        await page.screenshot({ path: file });
        await page.waitForTimeout(65);
      }
    })();
    try {
      await page
        .getByRole("button", { name: "Reproducir", exact: true })
        .last()
        .click();
      await page.waitForTimeout(600);
      await page.locator(".track-row").nth(2).click({ button: "right" });
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Mostrar cola", exact: true })
        .click();
      await page.waitForTimeout(500);
      await page
        .getByRole("button", { name: "Ampliar portada", exact: true })
        .click();
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Letra", exact: true }).click();
      await page.waitForTimeout(600);
      await page
        .getByRole("button", { name: "Siguiente", exact: true })
        .click();
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } finally {
      recording = false;
      await capture;
    }
    await fs.writeFile(
      "artifacts/motion/frames.txt",
      frames
        .map(
          (f, i) =>
            `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + 120) - f.at) / 1000}`,
        )
        .join("\n"),
    );
  }
  await page
    .getByRole("button", { name: "Ampliar portada", exact: true })
    .click();
  await page.getByRole("button", { name: "Letra", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/design-lyrics.png" });
  console.log("Synthetic design previews saved.");
} finally {
  await browser.close();
  await server.close();
}
