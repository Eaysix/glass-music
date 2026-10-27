import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Check, Plus, UserRound } from "lucide-react";
import { coverUrl, openDiscordPortal, type PresenceStatus } from "./api";
import { defaults, type Settings } from "./types";
const tabs = [
  ["appearance", "Apariencia"],
  ["profile", "Perfil"],
  ["player", "Reproductor"],
  ["discord", "Discord"],
  ["performance", "Rendimiento"],
] as const;
export default function SettingsPanel({
  settings: s,
  setSettings: set,
  photo,
  presence,
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  photo: () => void;
  presence: PresenceStatus;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("appearance"),
    [hex, setHex] = useState(s.appearance.accent.toUpperCase()),
    [error, setError] = useState("");
  useEffect(
    () => setHex(s.appearance.accent.toUpperCase()),
    [s.appearance.accent],
  );
  const appearance = (patch: Partial<Settings["appearance"]>) =>
    set((v) => ({ ...v, appearance: { ...v.appearance, ...patch } }));
  const player = (patch: Partial<Settings["player"]>) =>
    set((v) => ({ ...v, player: { ...v.player, ...patch } }));
  const discord = (patch: Partial<Settings["discord"]>) =>
    set((v) => ({ ...v, discord: { ...v.discord, ...patch } }));
  return (
    <div className="settings-panel">
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Secciones de ajustes"
      >
        {tabs.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`settings-${id}`}
            id={`tab-${id}`}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={`settings-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="settings-content"
      >
        {tab === "profile" && (
          <>
            <p className="modal-description">
              Tu perfil se guarda en este equipo. Sin registro ni login.
            </p>
            <div className="profile-editor">
              <button
                type="button"
                className="photo-picker"
                aria-label="Cambiar foto de perfil"
                onClick={photo}
              >
                {s.profile.photo ? (
                  <img src={coverUrl(s.profile.photo)} alt="Foto de perfil" />
                ) : (
                  <UserRound size={28} />
                )}
                <span>
                  <Plus size={14} />
                </span>
              </button>
              <label>
                Nombre del perfil
                <input
                  maxLength={60}
                  value={s.profile.name}
                  onChange={(e) =>
                    set((v) => ({
                      ...v,
                      profile: { ...v.profile, name: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
            {s.profile.photo && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  set((v) => ({ ...v, profile: { ...v.profile, photo: null } }))
                }
              >
                Quitar foto
              </button>
            )}
          </>
        )}
        {tab === "appearance" && (
          <>
            <p className="modal-description">
              Azul Glass como base. El color elegido también cambia el logo de
              la interfaz.
            </p>
            <div className="settings-section">
              <h3>Color principal</h3>
              <div className="swatches">
                {["#8CCDF3", "#c9ed87", "#c2a4ff", "#f6a6c7", "#ffbd88"].map(
                  (color) => (
                    <button
                      type="button"
                      key={color}
                      style={{ background: color }}
                      aria-label={`Color ${color}`}
                      aria-pressed={
                        s.appearance.accent.toLowerCase() ===
                        color.toLowerCase()
                      }
                      onClick={() => appearance({ accent: color })}
                    >
                      {s.appearance.accent.toLowerCase() ===
                        color.toLowerCase() && <Check size={18} />}
                    </button>
                  ),
                )}
                <label className="custom-color" title="Elegir otro color">
                  <Plus size={17} />
                  <input
                    type="color"
                    aria-label="Color personalizado"
                    value={s.appearance.accent}
                    onChange={(e) => appearance({ accent: e.target.value })}
                  />
                </label>
              </div>
              <label className="color-hex">
                Código del color
                <input
                  aria-label="Código del color"
                  value={hex}
                  maxLength={7}
                  onChange={(e) => {
                    setHex(e.target.value);
                    if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                      appearance({ accent: e.target.value });
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => setHex(s.appearance.accent.toUpperCase())}
                />
              </label>
            </div>
            <div className="settings-section">
              <h3>Ambiente</h3>
              <div className="theme-options">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    className={s.appearance.theme === theme ? "selected" : ""}
                    onClick={() => appearance({ theme })}
                  >
                    {theme === "dark" ? "Noche" : "Día"}
                  </button>
                ))}
              </div>
              <label className="range-label">
                Intensidad del vidrio<span>{s.appearance.glass}px</span>
                <input
                  aria-label="Intensidad del vidrio"
                  type="range"
                  min="0"
                  max="32"
                  step="4"
                  disabled={s.appearance.reduced || s.performance === "economy"}
                  value={s.appearance.glass}
                  onChange={(e) =>
                    appearance({ glass: Number(e.target.value) })
                  }
                />
              </label>
              <label className="range-label">
                Opacidad de los paneles<span>{s.appearance.opacity}%</span>
                <input
                  aria-label="Opacidad de los paneles"
                  type="range"
                  min="20"
                  max="90"
                  step="5"
                  value={s.appearance.opacity}
                  onChange={(e) =>
                    appearance({ opacity: Number(e.target.value) })
                  }
                />
              </label>
              <label className="toggle-label">
                <span>
                  <strong>Fondo con la portada</strong>
                  <small>El ambiente cambia con la canción.</small>
                </span>
                <input
                  type="checkbox"
                  checked={s.appearance.albumBackground}
                  onChange={(e) =>
                    appearance({ albumBackground: e.target.checked })
                  }
                />
              </label>
              <label className="toggle-label">
                <span>
                  <strong>Animaciones</strong>
                  <small>Transiciones de paneles, canciones y controles.</small>
                </span>
                <input
                  type="checkbox"
                  checked={s.appearance.animations}
                  onChange={(e) => appearance({ animations: e.target.checked })}
                />
              </label>
              <label className="toggle-label">
                <span>
                  <strong>Reducir efectos</strong>
                  <small>Desactiva desenfoques, sombras y animaciones.</small>
                </span>
                <input
                  type="checkbox"
                  checked={s.appearance.reduced}
                  onChange={(e) => appearance({ reduced: e.target.checked })}
                />
              </label>
            </div>
            <button
              type="button"
              className="text-button restore-appearance"
              onClick={() => appearance(defaults().appearance)}
            >
              Restaurar apariencia Glass
            </button>
          </>
        )}
        {tab === "player" && (
          <>
            <p className="modal-description">
              Controles a tu ritmo, sin ocupar espacio cuando escuchas.
            </p>
            <label className="toggle-label">
              <span>
                <strong>Ocultar reproductor automáticamente</strong>
                <small>
                  Acerca el mouse al borde inferior o llega con Tab.
                </small>
              </span>
              <input
                aria-label="Ocultar reproductor automáticamente"
                type="checkbox"
                checked={s.player.autoHide}
                onChange={(e) => player({ autoHide: e.target.checked })}
              />
            </label>
            <label className="range-label">
              Escala de la interfaz<span>{Math.round(s.uiScale * 100)}%</span>
              <input
                aria-label="Escala de la interfaz"
                type="range"
                min="0.75"
                max="1.5"
                step="0.05"
                value={s.uiScale}
                onChange={(e) =>
                  set((v) => ({ ...v, uiScale: Number(e.target.value) }))
                }
              />
            </label>
            <p className="settings-help">
              Ctrl + / Ctrl − o Ctrl + rueda para cambiar el tamaño. Ctrl + 0
              restablece el 100%.
            </p>
            <label className="settings-select">
              Pasos de volumen
              <select
                aria-label="Pasos de volumen"
                value={s.player.volumeStep}
                onChange={(e) => player({ volumeStep: Number(e.target.value) })}
              >
                {[1, 2, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}% por paso
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-help">
              La rueda y + / − usan este paso. El porcentaje permite escribir un
              valor exacto.
            </p>
            <label className="range-label">
              Tamaño de la letra
              <span>{Math.round(s.appearance.lyricScale * 100)}%</span>
              <input
                aria-label="Tamaño de la letra"
                type="range"
                min="0.85"
                max="1.35"
                step="0.05"
                value={s.appearance.lyricScale}
                onChange={(e) =>
                  appearance({ lyricScale: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
        {tab === "discord" && (
          <>
            <p className="modal-description">
              Muestra la canción, el artista y Glass Music en tu actividad de
              Discord de escritorio.
            </p>
            <label className="toggle-label">
              <span>
                <strong>Compartir en Discord</strong>
                <small>
                  La actividad se retira al pausar o desactivar esta opción.
                </small>
              </span>
              <input
                aria-label="Compartir en Discord"
                type="checkbox"
                checked={s.discord.enabled}
                onChange={(e) => discord({ enabled: e.target.checked })}
              />
            </label>
            <div className={`presence-status ${presence.state}`} role="status">
              <i />
              {s.discord.enabled
                ? presence.message
                : "Actividad de Discord desactivada."}
            </div>
            <label className="toggle-label">
              <span>
                <strong>Mostrar álbum</strong>
                <small>Añade el álbum junto al artista.</small>
              </span>
              <input
                type="checkbox"
                checked={s.discord.showAlbum}
                onChange={(e) => discord({ showAlbum: e.target.checked })}
              />
            </label>
            <label className="settings-field">
              Application ID de Glass Music
              <input
                aria-label="Application ID de Discord"
                inputMode="numeric"
                maxLength={20}
                placeholder="ID público de la aplicación"
                value={s.discord.applicationId}
                onChange={(e) =>
                  discord({ applicationId: e.target.value.replace(/\D/g, "") })
                }
              />
            </label>
            <p className="settings-help">
              Configuración inicial del proyecto: crea una aplicación llamada
              Glass Music en el{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void openDiscordPortal().catch((e) => setError(String(e)));
                }}
              >
                portal de desarrolladores de Discord
              </button>{" "}
              y copia su Application ID. Es público; no pegues tokens ni
              secretos. Con ese ID podemos incluir la integración lista para
              todos en el siguiente instalador.
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="discord-preview">
              <small>VISTA PREVIA</small>
              <strong>Escuchando Glass Music</strong>
              <span>
                Canción · Artista{s.discord.showAlbum ? " · Álbum" : ""}
              </span>
            </div>
          </>
        )}
        {tab === "performance" && (
          <>
            <p className="modal-description">
              El consumo real depende del equipo y debe medirse en Windows.
            </p>
            <div className="performance-options">
              {(
                [
                  [
                    "economy",
                    "Ahorro",
                    "Cristal sin desenfoques ni animaciones continuas. Reloj a 1 segundo.",
                  ],
                  [
                    "balanced",
                    "Equilibrado",
                    "Desenfoque limitado a 12px y reloj a 1 segundo.",
                  ],
                  [
                    "quality",
                    "Máxima apariencia",
                    "Hasta 32px de desenfoque y reloj a medio segundo.",
                  ],
                ] as const
              ).map(([id, title, text]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={s.performance === id}
                  onClick={() => set((v) => ({ ...v, performance: id }))}
                >
                  <span>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </span>
                  {s.performance === id && <Check size={18} />}
                </button>
              ))}
            </div>
            <p className="settings-help">
              El reloj actualiza solo sus controles y la línea activa. El fondo
              se prepara una vez por portada. Al pausar no hay consultas
              periódicas del audio ni reconexiones de Discord.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
