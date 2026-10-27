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
        args: ["--no-sandbox", "--no-zygote", "--single-process"],
      }
    : {}),
});
const errors = [];
const deadline = setTimeout(() => {
  console.error("UI test deadline exceeded");
  process.exit(1);
}, 90000);
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
  await page.getByLabel("Nombre del perfil").fill("Eaysix");
  await choose(page.locator(".photo-picker"), image);
  await page.getByAltText("Foto de perfil").waitFor();
  await page.getByLabel("Color #c2a4ff", { exact: true }).click();
  await page.getByLabel("Reducir efectos").check();
  assert(
    await page
      .locator(".app")
      .evaluate((el) => el.classList.contains("reduced")),
  );
  await page.getByLabel("Reducir efectos").uncheck();
  await page.getByRole("button", { name: "Día", exact: true }).click();
  assert(
    await page.locator(".app").evaluate((el) => el.classList.contains("light")),
  );
  await page.screenshot({ path: "artifacts/light.png" });
  console.log("profile and theme configured");
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
  await page
    .getByRole("button", { name: "Opciones de Primera luz", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Añadir a playlist", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "De noche", exact: true })
    .click();
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
  assert.deepEqual(errors, []);
  console.log(
    "PASS: importar FLAC/MP3, reproducción web, letras, edición, portada, favoritas, playlists, cola, perfil con foto, temas, persistencia y ancho 960px.",
  );
} catch (e) {
  await page.screenshot({ path: "artifacts/ui-failure.png" });
  throw e;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await server.close();
}
