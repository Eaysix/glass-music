import { useState } from "react";

const registryUrl =
  "https://raw.githubusercontent.com/mornyeapp/Mornye-Extension/main/registry.json";
const supportedIds = new Set(["spotify-web", "tidal-web", "qobuz-web"]);

interface CatalogEntry {
  id: string;
  display_name: string;
  version: string;
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<CatalogEntry>;
  return (
    typeof entry.id === "string" &&
    supportedIds.has(entry.id) &&
    typeof entry.display_name === "string" &&
    typeof entry.version === "string"
  );
}

export default function ExtensionRegistry() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRegistry() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(registryUrl, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (data?.version !== 1 || !Array.isArray(data.extensions))
        throw new Error("Formato de registro incompatible");
      setCatalog(data.extensions.filter(isCatalogEntry));
    } catch (failure) {
      setCatalog([]);
      setError(
        failure instanceof Error ? failure.message : "Error de conexión",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <button type="button" disabled={loading} onClick={loadRegistry}>
        {loading ? "Cargando…" : "Consultar repositorio de Mornye"}
      </button>
      {error && <p role="alert">{error}</p>}
      {catalog.length > 0 && (
        <>
          <p>
            Vista previa del catálogo. La búsqueda y descarga siguen pendientes.
          </p>
          <ul>
            {catalog.map((entry) => (
              <li key={entry.id}>
                {entry.display_name} · {entry.version}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
