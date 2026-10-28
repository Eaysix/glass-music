import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1425, strictPort: true },
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
async function choose(files) {
  const pending = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Añadir canciones", exact: true })
    .click();
  await (await pending).setFiles(files);
}
async function snapshot() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("glass-music-dev", 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("data").objectStore("data").get("settings");
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
        };
      }),
  );
}
async function until(check) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const state = await snapshot();
    if (state && check(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error("Persisted state never reached expected value");
}
const root = path.resolve("artifacts/stability-fixtures");
await fs.mkdir(root, { recursive: true });
const first = path.join(root, "older.flac"),
  second = path.join(root, "newer.mp3");
await fs.copyFile("tests/fixtures/first.flac", first);
await fs.copyFile("tests/fixtures/second.mp3", second);
await fs.utimes(
  first,
  new Date("2020-01-01T12:00:00Z"),
  new Date("2020-01-01T12:00:00Z"),
);
await fs.utimes(
  second,
  new Date("2024-06-15T12:00:00Z"),
  new Date("2024-06-15T12:00:00Z"),
);
try {
  await page.goto("http://127.0.0.1:1425");
  await page
    .getByRole("button", { name: "Crear mi primera playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill("Inicio");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await choose([first]);
  await page
    .getByRole("button", { name: "Reproducir Primera luz", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".app").classList.contains("is-playing"),
  );
  const initial = await until((s) => s.queue.current);
  await choose([second]);
  const imported = await until((s) => s.queue.upcoming.length === 1);
  assert.equal(
    imported.queue.current,
    initial.queue.current,
    "import must preserve the current track",
  );
  const songOrder = page.getByRole("combobox", {
    name: "Orden de canciones",
    exact: true,
  });
  assert.equal(await songOrder.inputValue(), "modified-oldest");
  assert.match(
    await page.locator(".track-row").first().textContent(),
    /Primera luz/,
  );
  await songOrder.selectOption("modified");
  assert.match(
    await page.locator(".track-row").first().textContent(),
    /Otro momento/,
  );
  await songOrder.selectOption("modified-oldest");
  assert.match(
    await page.locator(".track-row").first().textContent(),
    /Primera luz/,
  );
  assert.equal(
    (await until((s) => s.queue.source?.sort === "modified-oldest")).queue
      .current,
    initial.queue.current,
    "changing order must preserve the playing song",
  );
  await page.getByRole("button", { name: "Siguiente", exact: true }).focus();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await until((s) => s.queue.current === imported.queue.upcoming[0]);
  const search = page.getByRole("textbox", {
    name: "Buscar música",
    exact: true,
  });
  await search.fill("Primera");
  await page
    .getByRole("button", { name: "Reproducir Primera luz", exact: true })
    .click();
  await page.getByRole("button", { name: "Pausar", exact: true }).focus();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const filtered = await until((s) => s.queue.context.length === 1);
  await search.fill("");
  const expanded = await until(
    (s) => s.queue.context.length === 2 && s.queue.upcoming.length === 1,
  );
  assert.equal(expanded.queue.current, filtered.queue.current);
  assert.equal(expanded.position, filtered.position);
  assert(
    !(await page
      .locator(".app")
      .evaluate((el) => el.classList.contains("is-playing"))),
    "clearing search must not resume playback",
  );
  console.log(
    "PASS: import during playback, file modification ordering, next, and clearing a filtered playlist without restarting audio",
  );
  await page
    .getByRole("button", {
      name: "Ajustes de apariencia y perfil",
      exact: true,
    })
    .click();
  const select = page.locator(".settings-content select").first();
  const labels = {
    en: "Interface language",
    de: "Sprache der Oberfläche",
    "zh-CN": "界面语言",
    es: "Idioma de la interfaz",
  };
  for (const language of ["en", "de", "zh-CN", "es"]) {
    await select.selectOption(language);
    await page.getByLabel(labels[language], { exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), language);
    await until((s) => s.language === language);
    assert.match(
      await page.locator(".sidebar").textContent(),
      /Inicio/,
      "user playlist names must remain unchanged",
    );
    await page.setViewportSize({ width: 960, height: 720 });
    for (let i = 0; i < 5; i++) await page.keyboard.press("Control+Equal");
    const box = await page.getByRole("dialog").boundingBox();
    assert(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 961 &&
        box.y + box.height <= 721,
    );
    assert(
      await page
        .locator(".settings-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `${language} settings overflow horizontally`,
    );
    await page.screenshot({ path: `artifacts/language-${language}.png` });
    await page.keyboard.press("Control+0");
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  await select.selectOption("de");
  await until((s) => s.language === "de");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "de");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("glass-music-song-sort")),
    "modified-oldest",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Spanish, English, German and Simplified Chinese switch live and persist after reload; user content stays unchanged",
  );
} finally {
  await browser.close();
  await server.close();
}
