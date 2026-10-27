import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { messages } from "../src/locales";
import { translate, languages, setLanguage, getLanguage, t } from "../src/i18n";
describe("interface translations", () => {
  it("covers every explicit message in all UI modules", () => {
    const missing = new Set<string>();
    for (const file of readdirSync("src").filter(
      (f) => /\.(tsx?|ts)$/.test(f) && !["locales.ts", "i18n.ts"].includes(f),
    )) {
      const source = ts.createSourceFile(
        file,
        readFileSync(`src/${file}`, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      function visit(n: ts.Node) {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          ["t", "tr"].includes(n.expression.text) &&
          n.arguments[0] &&
          ts.isStringLiteral(n.arguments[0])
        ) {
          const key = n.arguments[0].text.trim();
          if (!messages[key]) missing.add(key);
        }
        ts.forEachChild(n, visit);
      }
      visit(source);
    }
    expect([...missing]).toEqual([]);
  });
  it("has nonempty English, German and Simplified Chinese catalogs with valid placeholders", () => {
    for (const [key, translations] of Object.entries(messages))
      for (const language of languages.filter((l) => l !== "es")) {
        expect(translations[language], `${language}: ${key}`).toBeTruthy();
        const allowed = new Set(
          [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
        );
        for (const m of translations[language].matchAll(/\{(\w+)\}/g))
          expect(allowed.has(m[1]), `${language}: ${key} ${m[1]}`).toBe(true);
      }
  });
  it("interpolates user content without translating it and preserves spacing", () => {
    expect(translate("en", "Abrir playlist {p0}", { p0: "Inicio" })).toBe(
      "Open playlist Inicio",
    );
    expect(
      translate("zh-CN", "Abrir playlist {p0}", {
        p0: "<script>歌曲</script>",
      }),
    ).toBe("打开播放列表 <script>歌曲</script>");
    expect(translate("de", " Perfil local")).toBe(" Lokales Profil");
    expect(translate("es", " Reproducir")).toBe(" Reproducir");
  });
  it("switches all four locales and rejects invalid persisted language values", () => {
    for (const language of languages) {
      setLanguage(language);
      expect(getLanguage()).toBe(language);
      expect(t("Inicio")).toBe(translate(language, "Inicio"));
    }
    setLanguage("bad" as never);
    expect(getLanguage()).toBe("zh-CN");
    setLanguage("es");
  });
});
