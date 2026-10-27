# Glass Music — alcance y decisiones

Estado: primera implementación alpha autorizada por el usuario. Nombre provisional: Glass Music. Plataforma inicial: Windows PC.

## Objetivo

Reproductor personal de música local, principalmente FLAC y también MP3, con biblioteca, letras y apariencia de vidrio ajustable. Priorizar consumo bajo de RAM, CPU y GPU; medirlo antes de afirmar resultados.

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
- Audio nativo con Rodio/Symphonia; SQLite para biblioteca y ajustes.
- Los cambios de información, portadas y letras se guardan en la biblioteca. No se escriben etiquetas en originales.
- En Windows, `dragDropEnabled: false` permite el arrastre HTML dentro de la app; importar archivos sigue usando el selector de archivos/carpetas.
- Portadas reducidas a un máximo de 512 px, almacenadas en caché.
- Vista grande de portada o letra, que sigue la canción actual y conserva los controles visibles.
- Enhanced LRC con sincronización por palabra y limpieza de marcas de voces.
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

Repositorio privado: Eaysix/glass-music. main para cambios revisados; ramas por función y PRs. Commits descriptivos e issues para requisitos, tareas y errores. GitHub Actions comprobará y generará el instalador Windows. No hay reglas de protección configuradas todavía.

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
