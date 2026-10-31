import { chromium } from "playwright";
import { createServer } from "vite";
import path from "node:path";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1428, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(12000);
let requests = 0;
await page.route("https://lrclib.net/api/search**", async (route) => {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "lrclib-client",
    "access-control-allow-methods": "GET,OPTIONS",
  };
  if (route.request().method() === "OPTIONS")
    return route.fulfill({ status: 204, headers });
  requests++;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers,
    body: JSON.stringify([
      {
        id: 51,
        trackName: "Primera luz",
        artistName: "Glass Test",
        albumName: "Pruebas",
        duration: 16,
        plainLyrics: "Synthetic online verse",
        syncedLyrics: "[00:01]Synthetic online verse",
      },
    ]),
  });
});
async function edit() {
  await page
    .getByRole("button", { name: "Opciones de Primera luz", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Editar letra", exact: true })
    .click();
}
async function lookup() {
  await page
    .getByRole("button", { name: "Buscar letra en LRCLIB", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Coincidencia de letra" })
    .selectOption("51");
}
try {
  await page.goto("http://127.0.0.1:1428");
  await page
    .getByRole("button", { name: /Todas las canciones/ })
    .first()
    .click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Añadir música", exact: true })
    .click();
  await (await chooser).setFiles(path.resolve("tests/fixtures/first.flac"));
  await page.locator(".track-row").first().waitFor();
  await edit();
  const original = await page
    .getByLabel("Letra de la canción", { exact: true })
    .inputValue();
  await lookup();
  assert.equal(
    await page.getByLabel("Letra de la canción", { exact: true }).inputValue(),
    original,
  );
  await page
    .getByRole("button", {
      name: "Usar esta letra en el borrador",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByLabel("Letra de la canción", { exact: true }).inputValue(),
    "[00:01]Synthetic online verse",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await edit();
  assert.equal(
    await page.getByLabel("Letra de la canción", { exact: true }).inputValue(),
    original,
  );
  await lookup();
  await page
    .getByRole("button", {
      name: "Usar esta letra en el borrador",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await edit();
  assert.equal(
    await page.getByLabel("Letra de la canción", { exact: true }).inputValue(),
    "[00:01]Synthetic online verse",
  );
  assert.equal(requests, 1);
  console.log(
    "Lyrics preview, explicit draft replacement, cancel, save and response cache passed.",
  );
} finally {
  await browser.close();
  await server.close();
}
