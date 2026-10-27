# Glass Music

Tu música local, a tu manera. Reproductor para Windows centrado en FLAC y MP3, con interfaz de vidrio ajustable y perfil local con nombre y foto. Sin registro, login ni telemetría.

## Primera versión (alpha)

- Importación de archivos/carpetas; etiquetas y portadas integradas; evita volver a importar una misma ruta.
- Audio nativo en streaming con Rodio/Symphonia; reproducción, pausa, volumen, seek, anterior, siguiente y repetición.
- Biblioteca SQLite, búsqueda por título/artista/álbum, favoritos y lista virtualizada.
- Edición local de título, artista, invitados, álbum y portada; originales intactos.
- Letras integradas, LRC junto al audio y letras manuales; sincronización y salto por línea.
- Playlists con nombre, portada y orden propio.
- Cola editable, arrastrable y con flechas; reproducir después o agregar al final.
- Aleatorio sin repeticiones y mezcla que separa artistas cuando es posible.
- Perfil local, colores personalizados, día/noche y modo de efectos reducidos.

## Instalar en Windows

En [Actions](https://github.com/Eaysix/glass-music/actions), abre una ejecución completada correctamente de **Windows · comprobar y crear instalador** y descarga el artefacto **Glass-Music-Windows-x64**. Descomprime el ZIP y ejecuta el instalador `*-setup.exe`. El artefacto se genera solo si pasan las comprobaciones; este README no confirma que una ejecución haya terminado.

La alpha no está firmada con un certificado de distribución. Windows puede mostrar una advertencia de editor desconocido. El instalador utiliza WebView2; si falta, su instalación inicial puede requerir internet. La reproducción y los datos de la app funcionan sin internet.

## Desarrollo en Windows

Requisitos: Node.js 22+, Rust estable y las herramientas C++ de Visual Studio (carga **Desarrollo para el escritorio con C++**), además de WebView2.

```powershell
npm ci
npm run tauri dev
```

Para compilar:

```powershell
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles nsis
```

El instalador queda en `src-tauri/target/release/bundle/nsis/`. Para revisar solo la interfaz: `npm run dev`. Ese modo usa IndexedDB y HTML Audio dentro del navegador; no usa el motor nativo ni comparte su biblioteca.

## Datos y rendimiento

En Windows, SQLite y las portadas están bajo el directorio local de datos de la aplicación (`%LOCALAPPDATA%/com.eaysix.glassmusic`). El audio permanece en sus carpetas originales: no se copia a la biblioteca ni se carga entero en RAM. Las portadas se reducen a un máximo de 512 px. Las letras se cargan al seleccionar una canción. El estado de audio se consulta cada 500 ms solo durante reproducción.

El modo reducido elimina desenfoques, sombras y transiciones. Todavía deben medirse RAM, CPU, GPU y arranque en una compilación release de Windows; no se afirma consumo cero, audio bit-perfect ni reproducción gapless.

## Límites actuales

- Alpha: verificar salida de audio y seek con tu colección y dispositivo en Windows.
- Los cambios de etiquetas y letras se guardan en la biblioteca: escribirlos al archivo y buscar letras online quedan para una versión posterior.
- Si mueves o renombras un archivo desde el Explorador, debes volver a importarlo; no hay relocalización automática. Duplicados por ruta, no por huella acústica.
- La cola y su orden persisten. La posición se guarda al pausar o adelantar, no en cada actualización; al abrir siempre empieza en pausa.
- El tema ofrece un fondo ambiental; elegir un fondo propio queda pendiente.
- Playlists sin duplicados internos. La cola sí admite añadir una canción otra vez explícitamente.
- No se han creado todavía las skills personalizadas propuestas.

[Requisitos y decisiones](docs/REQUISITOS.md) · [Pendientes](https://github.com/Eaysix/glass-music/issues)
