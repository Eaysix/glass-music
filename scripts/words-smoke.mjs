import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
const server = await createServer({
  server: { host: "127.0.0.1", port: 1426, strictPort: true },
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
async function edit() {
  await page
    .getByRole("button", { name: "Opciones de Primera luz", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Editar letra", exact: true })
    .click();
}
async function seek(time) {
  const slider = page.locator(".editor .seek input");
  await slider.fill(String(time));
  await slider.press("ArrowRight");
}
async function timeWord(line, word, time) {
  const chip = page.locator(`[data-sync-row="${line}"] .word-chip`).nth(word);
  await chip.click();
  await seek(time);
  const mark = page.getByRole("button", {
    name: "Marcar palabra y seguir",
    exact: true,
  });
  await mark.focus();
  await mark.press("Space");
  await page.waitForFunction(
    ({ line, word }) =>
      !document
        .querySelectorAll(`[data-sync-row="${line}"] .word-chip`)
        [word]?.textContent.includes("Sin marcar"),
    { line, word },
  );
}
await fs.mkdir("artifacts", { recursive: true });
try {
  await page.goto("http://127.0.0.1:1426");
  await page
    .getByRole("button", { name: "Crear mi primera playlist", exact: true })
    .click();
  await page.getByLabel("Nombre de la playlist").fill("Palabras");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const pending = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Añadir canciones", exact: true })
    .click();
  await (await pending).setFiles(path.resolve("tests/fixtures/first.flac"));
  await page
    .getByRole("button", { name: "Reproducir Primera luz", exact: true })
    .click();
  await page.getByRole("button", { name: "Pausar", exact: true }).focus();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await edit();
  await page.getByLabel("Letra de la canción").fill("Hola mundo\nOtra vez");
  await page
    .getByRole("tab", { name: "Sincronizar palabras", exact: true })
    .click();
  assert.equal(await page.locator(".word-chip").count(), 4);
  await timeWord(0, 0, 1.2);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Faltan palabras" })
    .waitFor();
  await timeWord(0, 1, 2.2);
  await page
    .getByRole("button", { name: "Deshacer marca", exact: true })
    .click();
  assert.match(
    await page.locator('[data-sync-row="0"] .word-chip').nth(1).textContent(),
    /Sin marcar/,
  );
  await timeWord(0, 1, 2.2);
  await timeWord(1, 0, 5.2);
  await timeWord(1, 1, 6.2);
  await page.locator('[data-sync-row="0"] .word-chip').nth(1).click();
  await page
    .getByLabel("Tiempo de la palabra seleccionada en segundos")
    .fill("2.5");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await edit();
  const saved = await page.getByLabel("Letra de la canción").inputValue();
  assert.match(saved, /<00:01\.30>Hola <00:02\.50>mundo/);
  await page
    .getByRole("tab", { name: "Sincronizar líneas", exact: true })
    .click();
  await page
    .getByLabel("Tiempo de línea 1 en segundos", { exact: true })
    .fill("1.5");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await edit();
  assert.match(
    await page.getByLabel("Letra de la canción").inputValue(),
    /<00:01\.50>Hola <00:02\.70>mundo/,
  );
  await page
    .getByRole("tab", { name: "Sincronizar palabras", exact: true })
    .click();
  await page.locator(".word-chip").first().click();
  await page
    .getByLabel("Tiempo de la palabra seleccionada en segundos")
    .fill("9");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Ajustes de apariencia y perfil",
      exact: true,
    })
    .click();
  await page.getByLabel("Color #c2a4ff", { exact: true }).click();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  const slider = page.locator(".player .seek input");
  await slider.focus();
  await slider.fill("1.9");
  await slider.press("ArrowRight");
  const highlighted = page.locator(".lyric-line.highlight .lyric-word");
  await highlighted.first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".lyric-line.highlight .lyric-word.sung")
        .length === 1,
  );
  await page.waitForFunction(() => {
    const word = document.querySelector(
      ".lyric-line.highlight .lyric-word.sung",
    );
    return word && getComputedStyle(word).color === "rgb(194, 164, 255)";
  });
  assert.equal(
    await highlighted.first().evaluate((el) => getComputedStyle(el).color),
    "rgb(194, 164, 255)",
  );
  assert(!(await highlighted.nth(1).getAttribute("class")).includes("sung"));
  await slider.fill("3");
  await slider.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".lyric-line.highlight .lyric-word.sung")
        .length === 2,
  );
  await slider.fill("1.9");
  await slider.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".lyric-line.highlight .lyric-word.sung")
        .length === 1,
  );
  await page.screenshot({ path: "artifacts/word-color.png" });
  await edit();
  await page
    .getByRole("tab", { name: "Sincronizar palabras", exact: true })
    .click();
  await page.setViewportSize({ width: 960, height: 720 });
  for (let i = 0; i < 5; i++) await page.keyboard.press("Control+Equal");
  assert(
    await page
      .locator(".lyric-workshop")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.screenshot({ path: "artifacts/word-editor.png" });
  await page.keyboard.press("Control+0");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(
    () =>
      document.querySelector(".app").style.getPropertyValue("--ui-scale") ===
      "1",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Abrir playlist Palabras", exact: true })
    .first()
    .click();
  await edit();
  assert.match(
    await page.getByLabel("Letra de la canción").inputValue(),
    /<00:01\.50>Hola <00:02\.70>mundo/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: word marking with Space, incomplete-save protection, undo, correction, line edit preserves words, cancellation, custom accent, seek backwards, compact HUD and persistence",
  );
} catch (e) {
  await page.screenshot({ path: "artifacts/word-error.png" }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await server.close();
}
