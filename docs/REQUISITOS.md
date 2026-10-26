# Glass Music — requisitos iniciales

Estado: definición del producto. No iniciar código de la aplicación hasta que el usuario lo indique.
Nombre provisional: Glass Music.
Plataforma inicial: Windows PC.

## Objetivo

Reproductor personal de música local, principalmente FLAC y también MP3, con biblioteca, letras y apariencia de vidrio ajustable. Priorizar consumo bajo de RAM, CPU y GPU; medirlo antes de afirmar resultados.

## Funciones acordadas

- Importar canciones y carpetas sin mover los originales.
- Reproducir FLAC y MP3 directamente, sin conversión previa ni carga completa del archivo en memoria.
- Controles de reproducción, pausa, avance, volumen, repetición y aleatorio.
- Leer título, artista, álbum, portada y letras integradas cuando existan.
- Editar título, artista, artistas invitados, álbum y portada; agregar los datos que falten.
- Mostrar y editar letras manuales; admitir archivos LRC con líneas sincronizadas.
- Crear playlists para distintas ocasiones, renombrarlas, cambiarles portada y ordenar canciones.
- Marcar favoritas y mostrar una lista automática de Me gusta.
- Buscar por canción, artista o álbum.
- Cola visible que refleje el orden real: reordenar arrastrando, quitar, reproducir después y agregar al final.
- Aleatorio sin repetir canciones hasta terminar la lista, conservando el orden al pausar.
- Mezcla variada que intente separar canciones del mismo artista o álbum.
- Personalizar colores, fondo, tema claro/oscuro e intensidad del vidrio; ofrecer efectos reducidos.

## Datos y archivos

Los cambios de metadatos, portadas y letras se guardarán inicialmente en la biblioteca de la app. Escribirlos dentro de los archivos originales requerirá una acción explícita del usuario. La reproducción y biblioteca funcionarán sin internet. La búsqueda de letras en internet se plantea como acción manual, pero proveedor y alcance siguen pendientes.

## Rendimiento

Dirección técnica propuesta: Tauri + Rust, pendiente de validación técnica antes de implementar. Indexar al importar y reutilizar los datos; cargar portadas y listas según se necesiten; evitar sondeos, efectos y tareas constantes. Actualizar letras sincronizadas solo cuando corresponda. Evaluar el coste del glassmorphism y permitir reducirlo.

Pendiente definir equipo de prueba, tamaño de biblioteca, límites medibles de RAM/CPU/GPU y tiempo de arranque. No hay mediciones ni promesas de consumo cero.

## Control de versiones

- Repositorio privado: Eaysix/glass-music.
- main para cambios revisados; ramas por función al implementar.
- Commits pequeños y descriptivos; issues para requisitos, tareas y errores.
- Releases numeradas cuando existan builds verificadas para Windows.
- No subir canciones, biblioteca personal, credenciales, cachés ni compilaciones al código fuente.
- La existencia de esta política no significa que haya reglas de protección o CI configurados.

## Próximas decisiones

1. Nombre definitivo y referencias visuales.
2. Distribución de biblioteca, reproductor, letras y cola.
3. Comportamiento del aleatorio al cambiar de lista, reiniciar o terminar una ronda.
4. Reglas para archivos movidos, duplicados y guardado de cambios.
5. Alcance de búsqueda de letras y escritura de etiquetas.
6. Validación de arquitectura de audio y objetivos de rendimiento.

## Skills e integraciones

GitHub conectado. Figma es opcional. Se propusieron skills propias de Tauri/Rust, rendimiento y pruebas de audio; todavía no se han creado ni instalado.
