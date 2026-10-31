# Glass Music para Android 0.2.0

Reproducción local FLAC/MP3 y sincronización opcional con Windows por Wi-Fi. No necesita cuenta.

## Vincular

1. En Windows abre Ajustes → Sincronizar, activa la conexión local y genera un código.
2. Abre «Usar un código en lugar de la cámara» y copia el JSON. El código dura cinco minutos y se usa una vez.
3. En Android abre Ajustes → Windows ↔ Android, pega el código y pulsa Vincular PC.
4. Pulsa Sincronizar datos. Descarga una canción desde sus opciones, una playlist desde su cabecera o toda la biblioteca desde Ajustes.
5. Letras, favoritas, playlists y minutos se intercambian al sincronizar. Los conflictos se resuelven explícitamente conservando Android o PC. Las descargas siguen disponibles sin red.

La conexión usa el mismo protocolo v1 de iPhone. El certificado se fija al código y el token se cifra con Android Keystore. La sincronización requiere Wi-Fi/Ethernet, no usa datos móviles. Buscar letras en LRCLIB es una función externa separada y requiere internet. Solo envía título/artista; revisa el resultado antes de aplicarlo. Buscar letras faltantes por lista usa coincidencia exacta y duración ±2 s; nunca reemplaza una letra guardada.

## Límites de esta versión

- Los archivos importados en Android no se suben a Windows. Una playlist puede sincronizar referencias a esas canciones aunque la PC no tenga el archivo.
- No incluye Android Auto, catálogo comercial ni alineación automática del audio por palabra. Los resultados LRC disponibles se conservan; la edición manual sigue disponible.
- Sincronización manual en primer plano: no promete transferencia permanente cuando Android cierra la app.
- APK de prueba firmado con clave debug en caché de Actions. Para intentar conservar la firma de la primera APK, el candidato de este bloque se genera en la rama original `feat/android-first`, mediante un commit explícito `candidate(android): ...`; las ramas de desarrollo no generan APK. La huella pública de firma se compara con la APK anterior antes de recomendar actualizar encima. Para distribución estable hay que provisionar una clave duradera; la caché por sí sola no garantiza futuras actualizaciones encima.
- No se han medido CPU, RAM ni batería en teléfono físico.

## Verificación

Gradle 8.13, JDK 17 y SDK 36. `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` y pruebas instrumentadas con servidor TLS sintético. El workflow comprueba el protocolo Rust existente y, en el emulador, hace intercambio real de descargas, letras, playlists, favoritas, conflictos y minutos sin duplicados. Los candidatos se generan explícitamente como indica [VERSIONES.md](VERSIONES.md).
