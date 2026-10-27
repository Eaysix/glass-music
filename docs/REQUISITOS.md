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
- Mostrar y editar letras manuales; admitir archivos LRC sincronizados.
- Crear playlists para distintas ocasiones, renombrarlas, cambiarles portada y ordenar canciones.
- Marcar favoritas y mostrar una lista automática de Me gusta.
- Buscar por canción, artista, invitados o álbum.
- Cola visible que refleje el orden real: reordenar, quitar, reproducir después y agregar al final.
- Aleatorio sin repetir canciones hasta terminar la lista, conservando el orden al pausar.
- Mezcla variada que intente separar canciones del mismo artista o álbum.
- Personalizar colores, fondo, tema claro/oscuro e intensidad del vidrio; ofrecer efectos reducidos.
- **Perfil local con nombre y foto editables; sin registro de usuarios ni login.**

## Decisiones de la alpha

- Tauri 2 + Rust; React/TypeScript para la interfaz. Sin Electron.
- Audio nativo con Rodio/Symphonia; SQLite para biblioteca y ajustes.
- Los cambios de información, portadas y letras se guardan en la biblioteca. No se escriben etiquetas en originales.
- Portadas reducidas a un máximo de 512 px, almacenadas en caché.
- Letras embebidas y archivos .lrc junto al audio se leen al importar. Un LRC externo tiene prioridad. Se editan luego desde la app.
- La mezcla variada separa artistas cuando hay alternativas; la separación por álbum queda pendiente.
- Cambiar el modo aleatorio reordena únicamente lo que queda en la cola; no vuelve a añadir lo ya escuchado.
- Una lista ordenada comienza desde la canción elegida. Una selección aleatoria recorre las otras canciones de la lista una vez.
- Solo Repetir todo comienza una nueva ronda. Repetir una canción se aplica al terminar, no al pulsar Siguiente.
- La cola permite duplicados añadidos manualmente. Las playlists no incluyen duplicados internos.
- La cola y su orden persisten. La posición se guarda al pausar, adelantar o cerrar la app nativa; no se reanuda automáticamente al abrir.
- Importar una ruta ya existente no vuelve a indexarla ni reemplaza ediciones. No hay deduplicación acústica.
- Quitar una canción de la biblioteca conserva el archivo y la retira de playlists y cola.
- No hay búsquedas online ni conexiones externas durante el uso normal.

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
