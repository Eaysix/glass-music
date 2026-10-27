import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1424, strictPort: true },
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
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function choose(button, files) {
  const pending = page.waitForEvent("filechooser");
  await button.click();
  await (await pending).setFiles(files);
}
async function create(name) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Crear playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill(name);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
}
async function saved() {
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("glass-music-dev", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("data")
            .objectStore("data")
            .get("settings");
          q.onsuccess = () => {
            resolve(
              q.result?.playlists.length === 2 &&
                q.result?.recentPlaylists?.length === 1,
            );
            r.result.close();
          };
        };
      }),
  );
}
await fs.mkdir("artifacts", { recursive: true });
try {
  await page.goto("http://127.0.0.1:1424");
  await page
    .getByRole("heading", { name: "Tu música, Mi espacio.", exact: true })
    .waitFor();
  assert.equal(await page.locator(".track-row").count(), 0);
  await page
    .getByRole("button", { name: "Crear mi primera playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill("Alucín");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("heading", { name: "Alucín", exact: true }).waitFor();
  const first = path.resolve("tests/fixtures/first.flac"),
    second = path.resolve("tests/fixtures/second.mp3");
  await choose(
    page.getByRole("button", { name: "Añadir canciones", exact: true }),
    [first],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".track-row").length === 1,
  );
  await create("Desamor");
  await choose(
    page.getByRole("button", { name: "Añadir canciones", exact: true }),
    [first, second],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".track-row").length === 2,
  );
  assert.match(await page.locator("nav").textContent(), /Todas las canciones2/);
  await choose(
    page.getByRole("button", { name: "Añadir canciones", exact: true }),
    [first],
  );
  await page
    .getByText("0 canciones añadidas a «Desamor»", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".track-row").count(), 2);
  await page
    .getByRole("button", { name: "Reproducir Primera luz", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".app").classList.contains("is-playing"),
  );
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await page
    .getByRole("heading", { name: "Escuchadas recientemente", exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "Seguir escuchando", exact: true })
    .waitFor();
  assert.equal(await page.locator(".track-row").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Abrir playlist Desamor", exact: true })
      .count(),
    2,
  );
  const resize = page.getByRole("separator", {
    name: "Ancho del panel de letras y cola",
    exact: true,
  });
  await resize.focus();
  await resize.press("ArrowLeft");
  assert.equal(await resize.getAttribute("aria-valuenow"), "340");
  await page.screenshot({ path: "artifacts/home.png" });
  await page.getByRole("textbox", { name: "Buscar música" }).fill("Primera");
  await page.waitForFunction(
    () => document.querySelectorAll(".track-row").length === 1,
  );
  await page
    .getByRole("heading", { name: "Resultados de búsqueda", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await saved();
  await page.reload();
  await page
    .getByRole("heading", { name: "Tu música, Mi espacio.", exact: true })
    .waitFor();
  assert(
    !(await page
      .locator(".app")
      .evaluate((el) => el.classList.contains("is-playing"))),
  );
  await page
    .getByRole("heading", { name: "Escuchadas recientemente", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Abrir playlist Alucín", exact: true })
    .click();
  assert.equal(await page.locator(".track-row").count(), 1);
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await page.setViewportSize({ width: 960, height: 720 });
  for (let i = 0; i < 5; i++) await page.keyboard.press("Control+=");
  await page
    .getByRole("button", { name: "Abrir playlist Alucín", exact: true })
    .waitFor();
  const width = await page
    .locator(".home-content")
    .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  assert(width.scroll <= width.width + 1);
  await page.screenshot({ path: "artifacts/home-compact.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS home, direct playlist imports, duplicate reuse, recents, search, restore without autoplay and 150% HUD",
  );
} catch (e) {
  await page.screenshot({ path: "artifacts/home-error.png" }).catch(() => {});
  console.log(
    "Home diagnostics",
    await page
      .locator("main")
      .innerText()
      .catch(() => ""),
  );
  throw e;
} finally {
  await browser.close();
  await server.close();
}
