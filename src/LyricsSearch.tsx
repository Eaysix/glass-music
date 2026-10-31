import { t } from "./i18n";
import { useState } from "react";
import type { Track } from "./types";
import { searchLyrics, lyricText, type LyricResult } from "./lyrics-search";
export default function LyricsSearch({
  track,
  apply,
}: {
  track: Track;
  apply: (text: string) => void;
}) {
  const [results, setResults] = useState<LyricResult[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<LyricResult>();
  return (
    <section className="lyrics-search">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const found = await searchLyrics(track);
            setResults(found);
            if (!found.length)
              setError(
                t("Sin coincidencias. Puedes escribir la letra manualmente."),
              );
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t("Buscando…") : t("Buscar letra en LRCLIB")}
      </button>
      <small>
        {t("Envía título y artista a LRCLIB. El audio se queda en tu equipo.")}
      </small>
      {error && <p role="status">{error}</p>}
      {results.length > 0 && (
        <select
          aria-label={t("Coincidencia de letra")}
          value={selected?.id ?? ""}
          onChange={(e) =>
            setSelected(results.find((r) => r.id === Number(e.target.value)))
          }
        >
          <option value="">{t("Elige una versión…")}</option>
          {results.map((r) => (
            <option key={r.id} value={r.id}>
              {r.trackName} · {r.artistName} · {Math.round(r.duration)} s ·{" "}
              {r.syncedLyrics ? t("Sincronizada") : t("Texto")}
            </option>
          ))}
        </select>
      )}
      {selected && (
        <>
          <pre className="lyrics-search-preview">{lyricText(selected)}</pre>
          <button
            type="button"
            onClick={() => {
              apply(lyricText(selected));
              setResults([]);
              setSelected(undefined);
            }}
          >
            {t("Usar esta letra en el borrador")}
          </button>
        </>
      )}
    </section>
  );
}
