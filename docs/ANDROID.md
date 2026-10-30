# Glass Music · Android 0.1.0

Primera versión local para Android 8 o posterior. APK de prueba con firma de depuración, sin cuenta, publicidad ni permisos para acceder a toda la música del teléfono. No requiere internet. No se publica en Google Play todavía.

- Importa FLAC/MP3 desde el selector de archivos de Android. Se copia el audio a la app para escucharlo sin conexión; el original se conserva. Las copias idénticas se reutilizan por SHA-256.
- Inicio, biblioteca, favoritas, playlists, portada embebida y reproductor grande. El mini reproductor reserva espacio sobre la navegación.
- Importación directamente a playlists y desde el editor de creación. Eliminar una playlist conserva canciones; quitar una canción de la app requiere confirmar y solo elimina la copia privada.
- Audio nativo con Media3, servicio multimedia, controles de pantalla bloqueada/auriculares, foco de audio y pausa al desconectar audífonos.
- Cola manual FIFO antes del contexto automático. Orden por fecha de modificación del proveedor, antiguo/nuevo; desconocidas al final. La cola real, repetición, selección de mezcla y posición se guardan sin reproducir al iniciar.
- Letras locales editables en texto o LRC, resaltado y navegación por línea, e inserción manual del tiempo en el cursor. El marcado asistido por palabra y la lectura de todas las variantes de letras embebidas no forman parte de esta primera versión.
- Nombre local, acento `#8CCDF3`, tamaño de interfaz, volumen y aurora animada opcional. No hay promesas de CPU/RAM hasta medir el APK en un teléfono físico.

La sincronización Android-PC, las estadísticas compartidas y Android Auto quedan para una siguiente etapa. Los datos de PC/iPhone no se importan automáticamente en Android.

## Instalar

Descarga el artefacto APK de una ejecución **aprobada** de Android en Actions y descomprime el ZIP. Abre el `.apk` en el teléfono y autoriza instalar desde esa fuente. La firma de prueba se conserva en la caché del CI; una distribución estable necesitará una clave de firma duradera. No desinstales una instalación con música sin haber conservado sus originales.

## Desarrollo y validación

JDK 17, Gradle 8.13, Android SDK 36 y Build Tools 35.0.0. Desde `android/`:

```sh
gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
gradle :app:connectedDebugAndroidTest
```

Para las pruebas instrumentadas, copia únicamente los audios sintéticos de `tests/fixtures/` a `android/app/src/debug/assets/`, como hace CI. No añadir música personal ni claves de firma al repositorio. El proyecto Android permanece en su propia rama; `main` conserva la versión de PC.

Referencias: [MediaSessionService](https://developer.android.com/media/media3/session/background-playback), [Media3](https://developer.android.com/jetpack/androidx/releases/media3), [compatibilidad AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes).
