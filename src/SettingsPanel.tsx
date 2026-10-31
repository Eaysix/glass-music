import LANPanel from "./LANPanel";
import { t, setLanguage, type Language } from "./i18n";
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
  ["sync", "Sincronizar"],
] as const;
export default function SettingsPanel({
  settings: s,
  setSettings: set,
  photo,
  presence,
  resumePhone,
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  photo: () => void;
  presence: PresenceStatus;
  resumePhone: (id: string, position: number) => void;
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
        aria-label={t("Secciones de ajustes")}
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
            {t(label)}
          </button>
        ))}
      </div>
      <div
        id={`settings-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="settings-content"
      >
        {tab === "sync" && <LANPanel resume={resumePhone} />}
        {tab === "profile" && (
          <>
            <p className="modal-description">
              {t("Tu perfil se guarda en este equipo. Sin registro ni login.")}
            </p>
            <div className="profile-editor">
              <button
                type="button"
                className="photo-picker"
                aria-label={t("Cambiar foto de perfil")}
                onClick={photo}
              >
                {s.profile.photo ? (
                  <img
                    src={coverUrl(s.profile.photo)}
                    alt={t("Foto de perfil")}
                  />
                ) : (
                  <UserRound size={28} />
                )}
                <span>
                  <Plus size={14} />
                </span>
              </button>
              <label>
                {t("Nombre del perfil")}
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
                {t("Quitar foto")}
              </button>
            )}
          </>
        )}
        {tab === "appearance" && (
          <>
            <label className="settings-select">
              {t("Idioma de la interfaz")}
              <select
                aria-label={t("Idioma de la interfaz")}
                value={s.language}
                onChange={(e) => {
                  const language = e.target.value as Language;
                  setLanguage(language);
                  set((v) => ({ ...v, language }));
                }}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </label>

            <p className="modal-description">
              {t(
                "Azul Glass como base. El color elegido tambi\u00E9n cambia el logo de la interfaz.",
              )}
            </p>
            <div className="settings-section">
              <h3>{t("Color principal")}</h3>
              <div className="swatches">
                {["#8CCDF3", "#c9ed87", "#c2a4ff", "#f6a6c7", "#ffbd88"].map(
                  (color) => (
                    <button
                      type="button"
                      key={color}
                      style={{ background: color }}
                      aria-label={t("Color {p0}", {
                        p0: color,
                      })}
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
                <label className="custom-color" title={t("Elegir otro color")}>
                  <Plus size={17} />
                  <input
                    type="color"
                    aria-label={t("Color personalizado")}
                    value={s.appearance.accent}
                    onChange={(e) => appearance({ accent: e.target.value })}
                  />
                </label>
              </div>
              <label className="color-hex">
                {t("C\u00F3digo del color")}
                <input
                  aria-label={t("C\u00F3digo del color")}
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
              <h3>{t("Ambiente")}</h3>
              <div className="theme-options">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    className={s.appearance.theme === theme ? "selected" : ""}
                    onClick={() => appearance({ theme })}
                  >
                    {theme === "dark" ? t("Noche") : t("D\u00EDa")}
                  </button>
                ))}
              </div>
              <label className="range-label">
                {t("Intensidad del vidrio")}
                <span>{s.appearance.glass}px</span>
                <input
                  aria-label={t("Intensidad del vidrio")}
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
                {t("Opacidad de los paneles")}
                <span>{s.appearance.opacity}%</span>
                <input
                  aria-label={t("Opacidad de los paneles")}
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
                  <strong>{t("Fondo con la portada")}</strong>
                  <small>{t("El ambiente cambia con la canci\u00F3n.")}</small>
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
                  <strong>{t("Animaciones")}</strong>
                  <small>
                    {t("Transiciones de paneles, canciones y controles.")}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={s.appearance.animations}
                  onChange={(e) => appearance({ animations: e.target.checked })}
                />
              </label>
              <label className="toggle-label">
                <span>
                  <strong>{t("Reducir efectos")}</strong>
                  <small>
                    {t("Desactiva desenfoques, sombras y animaciones.")}
                  </small>
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
              {t("Restaurar apariencia Glass")}
            </button>
          </>
        )}
        {tab === "player" && (
          <>
            <p className="modal-description">
              {t("Controles a tu ritmo, sin ocupar espacio cuando escuchas.")}
            </p>
            <label className="toggle-label">
              <span>
                <strong>{t("Ocultar reproductor autom\u00E1ticamente")}</strong>
                <small>
                  {t("Acerca el mouse al borde inferior o llega con Tab.")}
                </small>
              </span>
              <input
                aria-label={t("Ocultar reproductor autom\u00E1ticamente")}
                type="checkbox"
                checked={s.player.autoHide}
                onChange={(e) => player({ autoHide: e.target.checked })}
              />
            </label>
            <label className="range-label">
              {t("Escala de la interfaz")}
              <span>{Math.round(s.uiScale * 100)}%</span>
              <input
                aria-label={t("Escala de la interfaz")}
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
              {t(
                "Ctrl + / Ctrl \u2212 o Ctrl + rueda para cambiar el tama\u00F1o. Ctrl + 0 restablece el 100%.",
              )}
            </p>
            <label className="settings-select">
              {t("Pasos de volumen")}
              <select
                aria-label={t("Pasos de volumen")}
                value={s.player.volumeStep}
                onChange={(e) => player({ volumeStep: Number(e.target.value) })}
              >
                {[1, 2, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {t("% por paso")}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-help">
              {t(
                "La rueda y + / \u2212 usan este paso. El porcentaje permite escribir un valor exacto.",
              )}
            </p>
            <label className="range-label">
              {t("Tama\u00F1o de la letra")}
              <span>{Math.round(s.appearance.lyricScale * 100)}%</span>
              <input
                aria-label={t("Tama\u00F1o de la letra")}
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
              {t(
                "Muestra la canci\u00F3n, el artista y Glass Music en tu actividad de Discord de escritorio.",
              )}
            </p>
            <label className="toggle-label">
              <span>
                <strong>{t("Compartir en Discord")}</strong>
                <small>
                  {t(
                    "La actividad se retira al pausar o desactivar esta opci\u00F3n.",
                  )}
                </small>
              </span>
              <input
                aria-label={t("Compartir en Discord")}
                type="checkbox"
                checked={s.discord.enabled}
                onChange={(e) => discord({ enabled: e.target.checked })}
              />
            </label>
            <div className={`presence-status ${presence.state}`} role="status">
              <i />
              {s.discord.enabled
                ? t(presence.message)
                : t("Actividad de Discord desactivada.")}
            </div>
            <label className="toggle-label">
              <span>
                <strong>{t("Mostrar \u00E1lbum")}</strong>
                <small>{t("A\u00F1ade el \u00E1lbum junto al artista.")}</small>
              </span>
              <input
                type="checkbox"
                checked={s.discord.showAlbum}
                onChange={(e) => discord({ showAlbum: e.target.checked })}
              />
            </label>
            <label className="settings-field">
              {t("Application ID de Glass Music")}
              <input
                aria-label={t("Application ID de Discord")}
                inputMode="numeric"
                maxLength={20}
                placeholder={t("ID p\u00FAblico de la aplicaci\u00F3n")}
                value={s.discord.applicationId}
                onChange={(e) =>
                  discord({ applicationId: e.target.value.replace(/\D/g, "") })
                }
              />
            </label>
            <p className="settings-help">
              {t(
                "Configuraci\u00F3n inicial del proyecto: crea una aplicaci\u00F3n llamada Glass Music en el",
              )}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void openDiscordPortal().catch((e) => setError(String(e)));
                }}
              >
                {t("portal de desarrolladores de Discord")}
              </button>{" "}
              {t(
                "y copia su Application ID. En Rich Presence \u2192 Art Assets, sube el logo con el nombre glass_music para mostrarlo en la actividad. El ID es p\u00FAblico; no pegues tokens ni secretos.",
              )}
            </p>
            {error && <p className="form-error">{t(error)}</p>}
            <div className="discord-preview">
              <small>{t("VISTA PREVIA")}</small>
              <strong>{t("Escuchando Glass Music")}</strong>
              <span>
                {t("Canci\u00F3n \u00B7 Artista")}
                {s.discord.showAlbum ? t(" \u00B7 \u00C1lbum") : ""}
              </span>
            </div>
          </>
        )}
        {tab === "performance" && (
          <>
            <p className="modal-description">
              {t(
                "El consumo real depende del equipo y debe medirse en Windows.",
              )}
            </p>
            <div className="performance-options">
              {(
                [
                  [
                    "economy",
                    t("Ahorro"),
                    t(
                      "Cristal sin desenfoques ni animaciones continuas. Reloj a 1 segundo.",
                    ),
                  ],
                  [
                    "balanced",
                    t("Equilibrado"),
                    t("Desenfoque limitado a 12px y reloj a 1 segundo."),
                  ],
                  [
                    "quality",
                    t("M\u00E1xima apariencia"),
                    t("Hasta 32px de desenfoque y reloj a medio segundo."),
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
              {t(
                "El reloj actualiza solo sus controles y la l\u00EDnea activa. El fondo se prepara una vez por portada. Al pausar no hay consultas peri\u00F3dicas del audio ni reconexiones de Discord.",
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
