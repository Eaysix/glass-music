import { useEffect, useState } from "react";
import {
  Copy,
  Link,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import QRCode from "qrcode";
import * as api from "./api";
import { t } from "./i18n";
import { timeLabel } from "./queue";
export default function LANPanel({
  resume,
}: {
  resume: (id: string, position: number) => void;
}) {
  const [status, setStatus] = useState<api.LANStatus | null>(null),
    [host, setHost] = useState("");
  const [pairing, setPairing] = useState<api.LANPairing | null>(null),
    [image, setImage] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    const next = await api.lanStatus();
    setStatus(next);
    if (next)
      setHost((current) =>
        next.addresses.includes(current)
          ? current
          : (next.addresses.find((ip) => ip.startsWith("192.168.")) ??
            next.addresses[0] ??
            ""),
      );
  }
  useEffect(() => {
    let alive = true,
      stop: (() => void) | undefined;
    void refresh().catch((e) => {
      if (alive) setError(String(e));
    });
    if (api.native)
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen("lan-library-changed", () => {
            if (alive) void refresh().catch((e) => setError(String(e)));
          }),
        )
        .then((unlisten) => {
          if (alive) stop = unlisten;
          else unlisten();
        });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  async function operate(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lan-panel">
      <div className="lan-heading">
        <Smartphone size={30} />
        <div>
          <h3>{t("Tu música, también en el iPhone")}</h3>
          <p>
            {t(
              "Reproducción local y sincronización por la misma red, sin cuentas ni datos móviles.",
            )}
          </p>
        </div>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={15} />
        {t(
          "Conexión cifrada. Solo los dispositivos que vincules pueden acceder a la biblioteca.",
        )}
      </div>
      {!api.native && (
        <p className="settings-help">
          {t("La sincronización está disponible en la app de Windows.")}
        </p>
      )}
      {status?.running ? (
        <>
          <div className="lan-actions">
            <span>
              <Wifi size={16} />
              {t("Sincronización local activa")}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  await api.lanStop();
                  setStatus(null);
                  setPairing(null);
                  setImage("");
                })
              }
            >
              {t("Desactivar")}
            </button>
          </div>
          <label className="settings-select">
            {t("Dirección de la PC en tu Wi-Fi")}
            <select
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                setPairing(null);
                setImage("");
              }}
            >
              {status.addresses.map((address) => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </select>
          </label>
          {!host && (
            <p className="form-error">
              {t("Conecta la PC a una red local para generar el código.")}
            </p>
          )}
          <div className="lan-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !host}
              onClick={() =>
                void operate(async () => {
                  const code = await api.lanPair(host);
                  setPairing(code);
                  setImage(
                    await QRCode.toDataURL(
                      "glassmusic://pair?data=" +
                        encodeURIComponent(btoa(JSON.stringify(code))),
                      {
                        width: 640,
                        margin: 3,
                        errorCorrectionLevel: "M",
                        color: { dark: "#101725", light: "#ffffff" },
                      },
                    ),
                  );
                })
              }
            >
              <Link size={16} />
              {t("Generar QR para vincular")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void operate(refresh)}
            >
              <RefreshCw size={14} />
              {t("Actualizar")}
            </button>
          </div>
          {pairing && (
            <div className="lan-pairing">
              {image && (
                <img
                  src={image}
                  alt={t("QR para vincular tu dispositivo")}
                  className="lan-qr"
                />
              )}
              <p>
                {t(
                  "En iPhone escanea este QR desde Sincronizar. En Android pega el código en Ajustes → Windows ↔ Android. El código dura 5 minutos y se usa una sola vez.",
                )}
              </p>
              <details>
                <summary>{t("Usar un código en lugar de la cámara")}</summary>
                <textarea
                  readOnly
                  value={JSON.stringify(pairing)}
                  aria-label={t("Código de vinculación")}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void operate(async () => {
                      await navigator.clipboard.writeText(
                        JSON.stringify(pairing),
                      );
                    })
                  }
                >
                  <Copy size={14} />
                  {t("Copiar código")}
                </button>
              </details>
            </div>
          )}
          <div className="settings-section">
            <h3>{t("Dispositivos vinculados")}</h3>
            {!status.devices.length && (
              <p className="settings-help">
                {t("Todavía no has vinculado ningún dispositivo.")}
              </p>
            )}
            {status.devices.map((device) => (
              <div className="lan-device" key={device.id}>
                <Smartphone size={17} />
                <span>{device.name}</span>
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => {
                      await api.lanRevoke(device.id);
                      await refresh();
                    })
                  }
                >
                  {t("Desvincular")}
                </button>
              </div>
            ))}
          </div>
          {status.latestResume && (
            <div className="settings-section">
              <h3>{t("Continuar desde el iPhone")}</h3>
              <p>
                {status.latestResume.title} ·{" "}
                {timeLabel(status.latestResume.position)}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  resume(
                    status.latestResume!.trackId,
                    status.latestResume!.position,
                  )
                }
              >
                {t("Continuar en esta PC")}
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={busy || !api.native}
          onClick={() =>
            void operate(async () => {
              await api.lanStart();
              await refresh();
            })
          }
        >
          <Wifi size={16} />
          {t("Activar sincronización local")}
        </button>
      )}
      <p className="settings-help">
        {t(
          "Mantén Glass Music abierto en la PC y usa la misma red en el iPhone. Si Windows pide acceso de red, permite la red privada. Al cerrar o desactivar la sincronización deja de compartir.",
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
