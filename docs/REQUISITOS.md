# Glass Music — alcance y decisiones

Estado: primera implementación alpha autorizada por el usuario. Nombre provisional: Glass Music. Plataforma inicial: Windows PC.

## Objetivo

Reproductor personal de música local, principalmente FLAC y también MP3, con biblioteca, letras y apariencia de vidrio ajustable. Priorizar consumo bajo de RAM, CPU y GPU; medirlo antes de afirmar resultados.

## Inicio y Windows (0.4.0)

- Inicio con portadas de playlists; continuar manualmente la última canción, playlists reproducidas recientemente y accesos a favoritas / sin organizar. No mostrar bloques vacíos.
- Importación dentro de una playlist, incluidos archivos ya indexados, sin duplicarlos ni reemplazar ediciones. Todas las canciones es una colección secundaria.
- Filas con separación, selección sutil, encabezado reducido, textos más legibles y columnas equilibradas. Panel de letras/cola con ancho ajustable.
- Windows SMTC para metadata, portada, progreso y teclas multimedia, incluso al usar otra app. Integración nativa, sin red y sin APIs privadas de Nusa.
- Nusa usa LRCLIB para letras; no existe un puente documentado a letras locales. Confirmación real de Nusa/teclado pendiente del usuario.

## Funciones acordadas

- Importar canciones y carpetas sin mover los originales.
- Reproducir FLAC y MP3 directamente, sin conversión previa ni carga completa del archivo en memoria.
- Controles de reproducción, pausa, avance, volumen, repetición y aleatorio.
- Leer título, artista, álbum, portada y letras integradas cuando existan.
- Editar título, artista, artistas invitados, álbum y portada; agregar los datos que falten.
- Mostrar y editar letras manuales; admitir archivos LRC sincronizados. Editor integrado para marcar líneas con la posición real del audio, corregir tiempos, deshacer y guardar sin tocar originales.
- Crear playlists para distintas ocasiones, renombrarlas, cambiarles portada y ordenar canciones.
- Arrastrar canciones desde biblioteca, cola o reproductor a las playlists de la barra lateral, con confirmación y sin duplicados. Arrastrar filas para reordenar una playlist en «Tu orden».
- Clic derecho con acciones de música junto al cursor, sin menú de página web en las superficies del reproductor.
- Diseño de cristal ahumado con reflejos, transparencias y fondo frío; animaciones de paneles, cambios de canción, menús y controles. Desactivarlas con efectos reducidos o la preferencia del sistema.
- Marcar favoritas y mostrar una lista automática de Me gusta.
- Buscar por canción, artista, invitados o álbum.
- Cola visible que refleje el orden real: reordenar, quitar, reproducir después y agregar al final.
- Aleatorio sin repetir canciones hasta terminar la lista, conservando el orden al pausar.
- Mezcla variada que intente separar canciones del mismo artista o álbum.
- Personalizar colores, fondo, tema claro/oscuro e intensidad del vidrio; ofrecer efectos reducidos.
- Selección con Ctrl + clic, rangos con clic y Shift + clic, Ctrl + A y recuadro desde el espacio o margen de la lista. Arrastre y acciones sobre toda la selección; quitar requiere confirmación y conserva originales.
- Escala del HUD persistente (75–150%) con Ctrl + / −, Ctrl + rueda y Ctrl + 0.
- Color principal #8CCDF3 en interfaz e icono instalado; los colores posteriores personalizados se conservan.
- Barra inferior autoocultable con mouse o teclado. Volumen ampliado/exacto, rueda, pasos y nivel previo al silenciar.
- Ajustes separados: perfil, apariencia, reproductor, Discord y rendimiento. Fondo de portada, opacidad, tamaño de letra y animaciones.
- Discord Rich Presence opcional: título, artista, álbum opcional y progreso e imagen del logo con el asset `glass_music`; se retira al pausar/desactivar. Requiere cliente de escritorio y Application ID público de Glass Music, pendiente del propietario. Sin token ni subida de archivos.
- **Perfil local con nombre y foto editables; sin registro de usuarios ni login.**

## Decisiones de la alpha

- Tauri 2 + Rust; React/TypeScript para la interfaz. Sin Electron.
- Audio nativo con Rodio/Symphonia; SQLite para biblioteca y ajustes. Seguir cambios de salida predeterminada de Windows sin reiniciar la app; conservar canción, posición, volumen y pausa. Si no hay dispositivo, pausar sin avanzar la cola y permitir reanudar al conectar uno.
- Los cambios de información, portadas y letras se guardan en la biblioteca. No se escriben etiquetas en originales.
- En Windows, `dragDropEnabled: false` permite el arrastre HTML dentro de la app; importar archivos sigue usando el selector de archivos/carpetas.
- Portadas reducidas a un máximo de 512 px, almacenadas en caché.
- Vista grande de portada o letra, que sigue la canción actual y conserva los controles visibles.
- Enhanced LRC con sincronización por palabra y limpieza de marcas de voces. El editor permite marcar palabras con el reloj de reproducción, corregir, escuchar y deshacer. Usa el color personalizado; no distribuye tiempos ficticios. Ajustar tiempos de línea conserva y desplaza las palabras existentes.
- Letras embebidas y archivos .lrc junto al audio se leen al importar. Un LRC externo tiene prioridad. Se editan luego desde la app.
- La mezcla variada separa artistas cuando hay alternativas; la separación por álbum queda pendiente.
- Cambiar el modo aleatorio reordena únicamente lo que queda en la cola; no vuelve a añadir lo ya escuchado.
- Una lista ordenada comienza desde la canción elegida. Una selección aleatoria recorre las otras canciones de la lista una vez.
- Solo Repetir todo comienza una nueva ronda. Repetir una canción se aplica al terminar, no al pulsar Siguiente.
- La cola permite duplicados añadidos manualmente. Las playlists no incluyen duplicados internos.
- La cola y su orden persisten. La posición se guarda al pausar, adelantar o cerrar la app nativa; no se reanuda automáticamente al abrir.
- Importar una ruta ya existente no vuelve a indexarla ni reemplaza ediciones. No hay deduplicación acústica.
- Quitar una canción de la biblioteca conserva el archivo y la retira de playlists y cola.
- No hay búsquedas online ni telemetría. Discord opcional usa IPC local; el cliente de Discord publica la actividad.

## Control de versiones

Repositorio público: Eaysix/glass-music. main para cambios revisados; ramas por función y PRs. Commits descriptivos e issues para requisitos, tareas y errores. GitHub Actions comprobará y generará el instalador Windows. No hay reglas de protección configuradas todavía.

No subir música personal, bibliotecas, credenciales, cachés ni compilaciones al código fuente. Se incluyen dos archivos de silencio sintético exclusivamente para pruebas.

## Pendientes

1. Nombre definitivo y revisión visual con el usuario.
2. Medir RAM/CPU/GPU y arranque con una compilación release, hardware y biblioteca representativos.
3. Validar reproducción y seek en Windows con la colección real; gapless y salida exclusiva no implementados.
4. Relocalización de archivos movidos, deduplicación por contenido y relectura de etiquetas.
5. Escritura explícita de etiquetas al archivo y búsqueda de letras online.
6. Fondo personalizado; mezcla con separación por álbum; importación de playlists CSV.
7. Firma del instalador y actualizaciones de la app.
8. Figma opcional y skills personalizadas: no creadas ni instaladas todavía.

## Rendimiento 0.2.0

El usuario informó aproximadamente 8% de CPU y menos de 300 MB de RAM con 0.1.2; no es una medición controlada. El reloj de 0.2.0 no vuelve a evaluar la biblioteca cada segundo. El fondo se prepara en un canvas de 32px una vez por portada. Equilibrado limita el desenfoque a 12px; Ahorro lo desactiva. El audio se consulta cada segundo (500ms en máxima apariencia) solo al reproducir. Discord se actualiza por eventos y cada 15s únicamente cuando reproduce y está habilitado. Falta comparar el resultado en Windows con el mismo archivo, vista y equipo.

## iPhone · primera versión

- App nativa iOS 17+, reproducción local FLAC/MP3, audio en segundo plano y controles de pantalla bloqueada. Sin reproducción automática al abrir.
- Vinculación de una PC mediante QR temporal, TLS con certificado fijado y credencial guardada en Keychain; sincronización manual en la misma red, sin datos móviles ni servidor en internet.
- Catálogo y playlists de PC al teléfono; descarga selectiva de archivos para escuchar sin conexión. Letras editadas y favoritas en ambos sentidos, con resolución explícita de conflictos. Progreso para continuar sin alterar la reproducción activa del otro equipo.
- Playlists nuevas en iPhone se sincronizan con PC; las importaciones de audio desde Archivos siguen siendo locales. Sin compartir archivos SQLite entre dispositivos.
- IPA sin firma para pruebas. CarPlay, publicación en App Store y sincronización por servidor quedan para después. Guía: [IPHONE.md](IPHONE.md).

- iPhone 0.1.1: interfaz glass con navegación inferior visible al reproducir; reproductor grande adaptable con desplazamiento. Personalización local de perfil/foto, color, fondo, intensidad del cristal, HUD, tamaño de letra, portada y animaciones, conservada al sincronizar. Portadas RGB en caché de hasta 512 píxeles reales.

- Versiones independientes por plataforma: Windows 1.0.0-rc.4 e iPhone 0.2.0. El IPA incluye build de Actions y commit; la interfaz lee la versión del bundle instalado. No reutilizar una versión publicada para una entrega nueva ni cambiar tags históricos.

- Orden configurable y persistente por fecha de modificación en ambas direcciones; antiguas primero como valor inicial, fechas desconocidas al final. iPhone guarda el orden por colección y lo aplica a la cola activa. Windows 1.0.0-rc.5; iPhone 0.3.0. Animaciones del HUD de iPhone por interacción y cambios, respetando movimiento reducido. Las portadas animadas de pantalla bloqueada requieren videos locales y quedan pendientes.

- iPhone 0.4.0: sincronización de metadatos por lotes, portadas fuera del hilo principal, editor de playlists con portada/búsqueda, marcado de letras por línea/palabra con deshacer y validación, cola manual FIFO por gesto. Windows 1.0.0-rc.6: una sola acción Añadir a la cola con FIFO antes del contexto automático. Estadísticas locales por dispositivo desde la actualización: minutos semanales, top 5 por tiempo y resumen anual; sin fusionar entre PC e iPhone ni reconstruir datos anteriores.

## Biblioteca compartida · Windows rc.7 / iPhone 0.5.0

- Playlists creadas/editadas en iPhone viajan a PC con nombre, selección, orden y portada. Las creadas en PC siguen bajando al teléfono; desde iPhone se pueden eliminar listas con confirmación. Eliminar una playlist conserva audios y descargas. Las marcas de eliminación evitan que reaparezca por una copia antigua.
- Conflictos simultáneos de edición de playlist se resuelven explícitamente desde Sincronizar, conservando PC o iPhone. Los guardados de volumen/cola de PC no sobrescriben playlists recibidas en segundo plano.
- Estadísticas de PC e iPhone se combinan al sincronizar por LAN: contadores acumulados por origen/día/canción, fusionados por máximo por origen antes de sumar. Repetir transferencias o volver a vincular el mismo iPhone no duplica minutos. Se conservan los datos locales existentes de rc.6/0.4.0. Semana de lunes a domingo en ambos; top 5 por tiempo y resumen anual compartidos. No requiere cuentas ni servidor externo.
- Actualizar ambas plataformas. El iPhone conserva las ediciones si PC todavía no admite las capacidades nuevas y solicita actualizar PC. Sincronización manual por LAN. Los audios importados desde Archivos en iPhone no se transfieren a PC; su tiempo puede aparecer sin título en PC.
- Fondo aurora con dos capas de gradiente en movimiento por Core Animation, sin reloj SwiftUI por fotograma. Detenido al desaparecer, suspender la app, reducir movimiento, desactivar animaciones o activar ahorro de energía. Personalización y datos existentes se conservan. Sin afirmar una mejora de CPU/GPU hasta medir en dispositivo físico.

## Barra de reproducción al cambiar de pista

- Un arrastre pendiente pertenece a su canción y se descarta al cambiar de pista. Adelantar al final mantiene el orden de la cola y la siguiente canción empieza con su propia posición. Las muestras/respuestas antiguas no deben sobrescribir el reloj de la nueva pista.

- iPhone 0.5.1: entrega de corrección de la barra; no reutilizar el número de la compilación anterior. Las pruebas esperan la pausa y su guardado antes de comprobar posiciones exactas.

## iPhone 0.6.0 · duración real e importación por playlist

- Duración medida por AVPlayerItem, coherente en reproductor grande, mini reproductor, editor de letras, saltos y pantalla bloqueada. Se conserva por archivo/revisión, no se modifica el audio original ni se sustituye por una duración de catálogo al sincronizar. Muestras durante un seek pendiente se descartan.
- Importar FLAC/MP3 desde una playlist añade los archivos directamente a esa lista; el editor de creación permite importar y seleccionar los archivos nuevos antes de guardar. Conserva descargas al eliminar listas. Las playlists recibidas de PC mantienen su ID y revisión al añadirles canciones desde el teléfono. Los audios importados solo en iPhone continúan locales.
- Android 0.1.0 comienza por reproducción local y playlists, independiente de main. La sincronización Android-PC queda para una siguiente etapa.
