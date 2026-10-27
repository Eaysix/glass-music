import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
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
const errors = [];
const deadline = setTimeout(() => {
  console.error("UI test deadline exceeded");
  process.exit(1);
}, 150000);
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => errors.push(e.message));
async function present(selector) {
  await page.locator(selector).first().waitFor();
}
async function choose(button, files) {
  const pending = page.waitForEvent("filechooser");
  await button.click();
  await (await pending).setFiles(files);
}
async function savedProfile(name) {
  await page.waitForFunction(
    (name) =>
      new Promise((resolve) => {
        const open = indexedDB.open("glass-music-dev", 1);
        open.onsuccess = () => {
          const req = open.result
            .transaction("data")
            .objectStore("data")
            .get("settings");
          req.onsuccess = () => {
            resolve(req.result?.profile.name === name);
            open.result.close();
          };
        };
      }),
    name,
  );
}
const first = path.resolve("tests/fixtures/first.flac"),
  second = path.resolve("tests/fixtures/second.mp3"),
  image = path.resolve("src-tauri/icons/icon.png");
await fs.mkdir("artifacts", { recursive: true });
try {
  await page.goto("http://127.0.0.1:1421");
  await page.getByRole("heading", { name: "Tu biblioteca" }).waitFor();
  await page.screenshot({ path: "artifacts/empty.png" });
  await page
    .getByRole("button", { name: "Ajustes de apariencia y perfil" })
    .click();
  await page.getByRole("tab", { name: "Perfil", exact: true }).click();
  await page.getByLabel("Nombre del perfil").fill("Eaysix");
  await choose(page.locator(".photo-picker"), image);
  await page.getByAltText("Foto de perfil").waitFor();
  await page.getByRole("tab", { name: "Apariencia", exact: true }).click();
  assert.equal(
    await page.getByLabel("Código del color").inputValue(),
    "#8CCDF3",
  );
  await page.getByLabel("Color #c2a4ff", { exact: true }).click();
  await page.getByLabel("Reducir efectos").check();
  assert(
    await page
      .locator(".app")
      .evaluate((el) => el.classList.contains("reduced")),
  );
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    "none",
  );
  assert.equal(
    await page
      .locator(".hero-copy")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByLabel("Reducir efectos").uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".hero-copy")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Día", exact: true }).click();
  assert(
    await page.locator(".app").evaluate((el) => el.classList.contains("light")),
  );
  await page.screenshot({ path: "artifacts/light.png" });
  await page.getByRole("tab", { name: "Discord", exact: true }).click();
  await page.getByLabel("Compartir en Discord", { exact: true }).check();
  await page
    .getByText(
      "La conexión con Discord está disponible en la aplicación de Windows.",
      { exact: true },
    )
    .waitFor();
  await page.getByLabel("Application ID de Discord").fill("123456789012345678");
  await page.getByLabel("Compartir en Discord", { exact: true }).uncheck();
  await page.getByRole("tab", { name: "Rendimiento", exact: true }).click();
  await page.getByRole("button", { name: /Ahorro Cristal/ }).click();
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    "none",
  );
  await page.getByRole("button", { name: /Equilibrado Desenfoque/ }).click();
  await page.getByRole("tab", { name: "Reproductor", exact: true }).click();
  await page
    .getByLabel("Ocultar reproductor automáticamente", { exact: true })
    .uncheck();
  await page.getByLabel("Pasos de volumen", { exact: true }).selectOption("5");
  await page.getByRole("tab", { name: "Apariencia", exact: true }).click();
  console.log(
    "profile, appearance, player, Discord and performance settings configured",
  );
  await page.getByRole("button", { name: "Noche", exact: true }).click();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await savedProfile("Eaysix");
  console.log("profile saved");
  await choose(
    page.getByRole("button", { name: "Añadir música", exact: true }),
    [first, second],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".track-row").length === 2,
  );
  console.log("imported two tracks");
  await page
    .getByRole("button", { name: "Me gusta Primera luz", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crear playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill("De noche");
  await choose(
    page.getByRole("button", { name: "Elegir portada", exact: true }),
    image,
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  // Native Windows must allow HTML drag/drop; Tauri's default intercepts it.
  const config = JSON.parse(
    await fs.readFile("src-tauri/tauri.conf.json", "utf8"),
  );
  assert.equal(config.app.windows[0].dragDropEnabled, false);
  const firstRow = page
    .locator(".track-row")
    .filter({ hasText: "Primera luz" });
  const playlistTarget = page
    .locator(".playlists-nav > button")
    .filter({ hasText: "De noche" });
  await firstRow.dragTo(playlistTarget);
  await page.getByText("Añadida a «De noche»", { exact: true }).waitFor();
  await firstRow.dragTo(playlistTarget);
  await page.getByText("Ya está en «De noche»", { exact: true }).waitFor();
  // Right-click uses the song menu, positioned within the viewport.
  await firstRow.click({ button: "right" });
  await page.getByRole("menu", { name: "Opciones de canción" }).waitFor();
  assert.equal(
    await page.getByRole("menuitem", { name: "Print", exact: true }).count(),
    0,
  );
  await page.keyboard.press("End");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "Quitar de la biblioteca…",
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "Quitar de Me gusta",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  assert(
    await page
      .locator(".app")
      .evaluate(
        (el) =>
          !el.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
      ),
  );
  await page
    .getByRole("button", { name: "Opciones de Primera luz", exact: true })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Editar información y portada",
      exact: true,
    })
    .click();
  await page.getByLabel("Título", { exact: true }).fill("Primera luz editada");
  await page.getByLabel("Artistas invitados").fill("Invitado");
  await choose(
    page.getByRole("button", { name: "Cambiar portada", exact: true }),
    image,
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page
    .locator(".track-row")
    .filter({ hasText: "Otro momento" })
    .dragTo(playlistTarget);
  await playlistTarget.click();
  assert.equal(await page.locator(".track-row").count(), 2);
  await page
    .locator(".track-row")
    .filter({ hasText: "Otro momento" })
    .dragTo(
      page.locator(".track-row").filter({ hasText: "Primera luz editada" }),
    );
  assert.equal(
    await page
      .locator(".track-row")
      .filter({ hasText: "Otro momento" })
      .evaluate((el) => el.style.top),
    "0px",
  );
  await page
    .locator(".track-row")
    .filter({ hasText: "Otro momento" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Quitar de esta playlist", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Biblioteca/ })
    .first()
    .click();
  console.log(
    "drag to playlist, duplicate protection, reordering and right-click menu passed",
  );
  await page
    .getByRole("button", { name: "Crear playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill("Selección");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const songTitles = page.locator(".track-title");
  await songTitles.nth(0).click();
  await songTitles.nth(1).click({ modifiers: ["Control"] });
  assert.equal(await page.locator(".selected-track").count(), 2);
  await page.locator(".track-row").nth(1).click({ button: "right" });
  await page
    .locator(".context-menu > strong")
    .filter({ hasText: "2 canciones seleccionadas" })
    .waitFor();
  await page
    .getByRole("menuitem", { name: "Añadir a playlist", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Selección", exact: true })
    .click();
  const multiPlaylist = page
    .locator(".playlists-nav > button")
    .filter({ hasText: "Selección" });
  assert.match(await multiPlaylist.textContent(), /2 canciones/);
  await page.locator(".track-row").first().dragTo(multiPlaylist);
  await page.getByText("Ya están en «Selección»", { exact: true }).waitFor();
  await songTitles.nth(0).click();
  await songTitles.nth(1).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".selected-track").count(), 2);
  await songTitles.nth(1).click({ modifiers: ["Control"] });
  assert.equal(await page.locator(".selected-track").count(), 1);
  await page
    .getByRole("button", { name: "Limpiar selección", exact: true })
    .click();
  const listBox = await page.locator(".track-list").boundingBox();
  await page.mouse.move(listBox.x + listBox.width - 7, listBox.y + 155);
  await page.mouse.down();
  await page.mouse.move(listBox.x + 15, listBox.y + 5, { steps: 8 });
  assert.equal(await page.locator(".selected-track").count(), 2);
  await page.screenshot({ path: "artifacts/marquee.png" });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Limpiar selección", exact: true })
    .click();
  console.log("Ctrl/Shift selection, marquee and bulk playlist actions passed");
  console.log("playlist and track edited");
  await page
    .getByRole("button", {
      name: "Reproducir Primera luz editada",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Pausar", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('input[aria-label="Posición de reproducción"]')
          .value,
      ) > 0,
  );
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const seek = page.getByRole("slider", {
    name: "Posición de reproducción",
    exact: true,
  });
  await seek.press("Home");
  await seek.press("ArrowRight");
  await page.waitForFunction(
    () =>
      Math.abs(
        Number(
          document.querySelector('input[aria-label="Posición de reproducción"]')
            .value,
        ) - 0.1,
      ) < 0.01,
  );
  await page
    .getByRole("button", { name: "Segunda línea de prueba", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('input[aria-label="Posición de reproducción"]')
          .value,
      ) >= 5,
  );
  await seek.press("Home");
  await present(".lyric-line.highlight");
  await page
    .getByRole("button", {
      name: "Opciones de Primera luz editada",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Editar letra", exact: true })
    .click();
  await page
    .getByLabel("Letra de la canción")
    .fill("Primera línea manual\nSegunda línea manual");
  await page
    .getByRole("tab", { name: "Sincronizar líneas", exact: true })
    .click();
  const syncSeek = page.locator(".editor .seek input");
  await syncSeek.fill("1.2");
  await syncSeek.press("ArrowRight");
  await page
    .getByRole("button", { name: "Marcar línea y seguir", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[aria-label="Tiempo de línea 1 en segundos"]')
          .value,
      ) > 0,
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Faltan líneas" }).waitFor();
  await syncSeek.fill("3.4");
  await syncSeek.press("ArrowRight");
  await page
    .getByRole("button", { name: "Marcar línea y seguir", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[aria-label="Tiempo de línea 2 en segundos"]')
          .value,
      ) > 3,
  );
  await page
    .getByRole("button", { name: "Deshacer marca", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Tiempo de línea 2 en segundos", { exact: true })
      .inputValue(),
    "",
  );
  await page
    .getByRole("button", { name: "Marcar línea y seguir", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[aria-label="Tiempo de línea 2 en segundos"]')
          .value,
      ) > 3,
  );
  await page
    .getByLabel("Tiempo de línea 1 en segundos", { exact: true })
    .fill("1.25");
  await page.screenshot({ path: "artifacts/lyrics-sync.png" });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Opciones de Primera luz editada",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Editar letra", exact: true })
    .click();
  assert.match(
    await page.getByLabel("Letra de la canción").inputValue(),
    /\[00:01\.25\]Primera línea manual/,
  );
  await page.getByLabel("Letra de la canción").fill("Esto no debe guardarse");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Opciones de Primera luz editada",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Editar letra", exact: true })
    .click();
  assert.match(
    await page.getByLabel("Letra de la canción").inputValue(),
    /Primera línea manual/,
  );
  console.log(
    "manual lyrics timing, undo, persistence and cancellation passed",
  );
  await page
    .getByLabel("Letra de la canción")
    .fill(
      "[00:00.00]v3:<00:00.00>Una <00:00.20><00:00.20>letra <00:00.50>guardada<00:04.00>\n[00:05.00]v2:<00:05.00>Otra <00:05.30>línea",
    );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page
    .getByRole("button", { name: "Opciones de Otro momento", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Reproducir después", exact: true })
    .click();
  await page.getByRole("button", { name: "Mostrar cola", exact: true }).click();
  await present(".queue-row");
  assert.equal(await page.locator(".queue-row").count(), 2);
  await page
    .getByRole("button", { name: "Bajar Otro momento", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Mostrar letra", exact: true })
    .click();
  await page.getByText("Una letra guardada", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".lyric-line").first().textContent(),
    "Una letra guardada",
  );
  await page
    .getByRole("button", { name: "Ampliar letra", exact: true })
    .click();
  await page.getByRole("region", { name: "Reproductor ampliado" }).waitFor();
  assert.equal(
    await page.locator(".focus-line").first().textContent(),
    "Una letra guardada",
  );
  await page.screenshot({ path: "artifacts/focus-lyrics.png" });
  await page.getByRole("button", { name: "Portada", exact: true }).click();
  assert(
    await page
      .locator(".focus-stage")
      .evaluate((el) => el.classList.contains("cover-mode")),
  );
  await page.screenshot({ path: "artifacts/focus-cover.png" });
  await page.getByRole("button", { name: "Mostrar cola", exact: true }).click();
  assert.equal(await page.locator(".focus-stage").count(), 0);
  await page
    .getByRole("heading", { name: "A continuación", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Ampliar portada", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mostrar letra", exact: true })
    .click();
  assert(
    await page
      .locator(".focus-stage")
      .evaluate((el) => el.classList.contains("lyrics-mode")),
  );
  await page.getByRole("button", { name: "Portada", exact: true }).click();

  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page
    .locator(".focus-stage h1")
    .filter({ hasText: "Otro momento" })
    .waitFor();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await page.getByRole("button", { name: "Pausar", exact: true }).waitFor();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".focus-stage").count(), 0);
  assert.equal(
    await page
      .locator(".brand-mark span")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
    "playing animation must stop on pause",
  );
  // Restore the first track and the explicit queue before persistence checks.
  await page
    .getByRole("button", {
      name: "Reproducir Primera luz editada",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page
    .getByRole("button", { name: "Opciones de Otro momento", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Reproducir después", exact: true })
    .click();
  await page.locator(".player-track").click({ button: "right" });
  const menuBox = await page.getByRole("menu").boundingBox();
  assert(menuBox.y >= 12 && menuBox.y + menuBox.height <= 960 - 11);
  await page.screenshot({ path: "artifacts/context-menu.png" });
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".app").evaluate((el) => el.scrollTop),
    0,
    "lyrics must only scroll their own container",
  );
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.locator(".main").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Control+Equal");
  await page.waitForFunction(
    () =>
      Number(
        getComputedStyle(document.querySelector(".app")).getPropertyValue(
          "--ui-scale",
        ),
      ) === 1.1,
  );
  await page.keyboard.press("Control+Minus");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForFunction(
    () =>
      Number(
        getComputedStyle(document.querySelector(".app")).getPropertyValue(
          "--ui-scale",
        ),
      ) === 1.05,
  );
  await page.keyboard.press("Control+0");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+Equal");
  await page.locator(".track-row").first().click({ button: "right" });
  const zoomMenu = await page.getByRole("menu").boundingBox();
  assert(
    zoomMenu.x >= 0 &&
      zoomMenu.y >= 0 &&
      zoomMenu.x + zoomMenu.width <= 1441 &&
      zoomMenu.y + zoomMenu.height <= 961,
  );
  await page.screenshot({ path: "artifacts/hud-large.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+0");
  await page
    .getByRole("button", { name: "Ajustar volumen", exact: true })
    .click();
  await page.getByLabel("Porcentaje de volumen", { exact: true }).fill("37");
  assert.equal(
    await page
      .getByRole("slider", { name: "Volumen", exact: true })
      .inputValue(),
    "0.37",
  );
  await page
    .getByRole("button", { name: "Subir volumen", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Porcentaje de volumen", { exact: true })
      .inputValue(),
    "42",
  );
  await page.getByRole("button", { name: "Silenciar", exact: true }).click();
  await page
    .getByRole("button", { name: "Activar sonido", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Porcentaje de volumen", { exact: true })
      .inputValue(),
    "42",
  );
  await page.getByRole("button", { name: "75%", exact: true }).click();
  await page.getByRole("slider", { name: "Volumen", exact: true }).hover();
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Volumen"]').value === "0.8",
  );
  await page.screenshot({ path: "artifacts/volume.png" });
  await page
    .getByRole("button", { name: "Cerrar volumen", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Ajustes de apariencia y perfil",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Reproductor", exact: true }).click();
  await page
    .getByLabel("Ocultar reproductor automáticamente", { exact: true })
    .check();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.mouse.move(600, 300);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".player")).opacity === "0",
  );
  await page
    .getByRole("button", {
      name: "Mostrar controles de reproducción",
      exact: true,
    })
    .hover();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".player")).opacity === "1",
  );
  await page.mouse.move(600, 300);
  await page.getByRole("button", { name: "Siguiente", exact: true }).focus();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".player")).opacity === "1",
  );
  await page
    .getByRole("button", {
      name: "Ajustes de apariencia y perfil",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Reproductor", exact: true }).click();
  await page
    .getByLabel("Ocultar reproductor automáticamente", { exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.screenshot({ path: "artifacts/library.png" });
  await page.setViewportSize({ width: 960, height: 720 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "artifacts/compact.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await savedProfile("Eaysix");
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
            resolve(q.result?.queue.upcoming.length === 2);
            r.result.close();
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole("heading", { name: "Tu biblioteca" }).waitFor();
  await page.getByRole("button", { name: /Eaysix Perfil local/ }).waitFor();
  assert.equal(await page.locator(".track-row").count(), 2);
  await page.getByRole("button", { name: "De noche", exact: true }).click();
  assert.equal(await page.locator(".track-row").count(), 1);
  await page
    .getByRole("button", { name: /Biblioteca/ })
    .first()
    .click();
  await choose(
    page.getByRole("button", { name: "Añadir música", exact: true }),
    [first, second],
  );
  await page.getByText(/0 canciones añadidas/).waitFor();
  assert.equal(await page.locator(".track-row").count(), 2);
  await page.getByRole("button", { name: "MP3", exact: true }).click();
  assert.equal(await page.locator(".track-row").count(), 1);
  await page.getByRole("button", { name: "Todo", exact: true }).click();
  await page.getByRole("textbox", { name: "Buscar música" }).fill("Invitado");
  assert.equal(await page.locator(".track-row").count(), 1);
  await page
    .getByRole("button", { name: "Limpiar búsqueda", exact: true })
    .click();
  await page.getByRole("button", { name: "Me gusta", exact: true }).click();
  assert.equal(await page.locator(".track-row").count(), 1);
  await page
    .getByRole("button", {
      name: "Opciones de Primera luz editada",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Quitar de la biblioteca…", exact: true })
    .click();
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Aquí van las que te encantan" })
    .waitFor();
  await page
    .getByRole("button", { name: /Biblioteca/ })
    .first()
    .click();
  assert.equal(await page.locator(".track-row").count(), 1);
  // Wait for the app's last settings write before replacing the test database.
  // Otherwise its pending debounce can overwrite the synthetic queue after seeding.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("glass-music-dev", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db.transaction("data").objectStore("data").get("settings");
          q.onsuccess = () => {
            resolve(q.result?.queue.current === null);
            db.close();
          };
        };
      }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("glass-music-dev", 1);
        req.onsuccess = () => {
          const database = req.result;
          const tx = database.transaction("data", "readwrite"),
            store = tx.objectStore("data");
          const source = store.get("tracks");
          source.onsuccess = () => {
            const tracks = Array.from({ length: 5000 }, (_, i) => ({
              ...source.result[0],
              id: `synthetic-${i}`,
              title: `Pista ${i}`,
            }));
            store.put(tracks, "tracks");
            const settingsRequest = store.get("settings");
            settingsRequest.onsuccess = () => {
              const settings = settingsRequest.result;
              settings.queue = {
                current: null,
                upcoming: tracks.map((t) => t.id),
                history: [],
                context: tracks.map((t) => t.id),
              };
              store.put(settings, "settings");
            };
          };
          tx.oncomplete = () => {
            database.close();
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByRole("heading", { name: "Tu biblioteca" }).waitFor();
  assert(
    (await page.locator(".track-row").count()) < 25,
    "library must render a bounded window",
  );
  await page.locator(".track-list").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page
    .getByRole("button", { name: "Reproducir Pista 4999", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Mostrar cola", exact: true }).click();
  assert(
    (await page.locator(".queue-row").count()) < 25,
    "queue must render a bounded window",
  );
  await page.locator(".queue-list").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page
    .getByRole("button", { name: "Quitar Pista 4999 de la cola", exact: true })
    .waitFor();
  console.log(
    "PASS: biblioteca y cola de 5.000 canciones virtualizadas, con acceso a la última fila.",
  );
  await page.locator(".track-list").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page
    .getByRole("button", { name: "Reproducir Pista 0", exact: true })
    .waitFor();
  await page.locator(".track-title").first().click();
  await page.keyboard.press("Control+a");
  await page.getByText("5000 seleccionadas", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await page
    .getByText("Los archivos de música permanecerán en sus carpetas.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByText("5000 seleccionadas", { exact: true }).waitFor();
  await page.locator(".track-title").nth(0).click();
  await page
    .locator(".track-title")
    .nth(2)
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await page
    .getByRole("button", { name: "Quitar 3 canciones", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reproducir Pista 3", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Reproducir Pista 0", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page
      .locator(".track-title")
      .first()
      .textContent()
      .then((t) => t.includes("Pista 3")),
    true,
  );
  console.log("bulk remove cancel/commit and 5,000-track selection passed");
  await page.setViewportSize({ width: 960, height: 720 });
  for (let i = 0; i < 5; i++) await page.keyboard.press("Control+Equal");
  await page.locator(".profile").click();
  const scaledDialog = await page.getByRole("dialog").boundingBox();
  assert(
    scaledDialog.x >= 0 &&
      scaledDialog.y >= 0 &&
      scaledDialog.x + scaledDialog.width <= 961 &&
      scaledDialog.y + scaledDialog.height <= 721,
  );
  await page.getByRole("tab", { name: "Reproductor", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Escala de la interfaz", { exact: true })
      .inputValue(),
    "1.5",
  );
  await page.screenshot({ path: "artifacts/hud-150.png" });
  await page.keyboard.press("Control+0");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  console.log("150% HUD and settings fit the 960px window");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: importar FLAC/MP3, reproducción web, letras, edición, portada, favoritas, playlists, cola, perfil con foto, temas, persistencia y ancho 960px.",
  );
} catch (e) {
  console.error(
    "UI diagnostics",
    await page.evaluate(() => ({
      app: document.querySelector(".app")?.className,
      queue: (() => {
        const e = document.querySelector(".queue-list");
        return e
          ? {
              top: e.scrollTop,
              height: e.clientHeight,
              total: e.scrollHeight,
              first: e.querySelector(".queue-title")?.textContent,
              last: [...e.querySelectorAll(".queue-title")].at(-1)?.textContent,
              rect: e.getBoundingClientRect().toJSON(),
            }
          : null;
      })(),
    })),
  );
  await page.screenshot({ path: "artifacts/ui-failure.png" });
  throw e;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await server.close();
}
