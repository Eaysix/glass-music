# Validación de la alpha

## Comprobaciones realizadas

| Comprobación                                                                                                                        | Resultado                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TypeScript y build de producción Vite                                                                                               | Correcto                                                        |
| Cola, Fisher–Yates, variedad de artistas, historial, persistencia de orden y LRC                                                    | 11 pruebas correctas                                            |
| SQLite con Unicode y rutas duplicadas, lectura/decodificación FLAC y MP3, portadas limitadas a 512 px                               | 4 pruebas Rust correctas                                        |
| Importación, reproducción web, letras, edición, portada, favoritas, playlists, cola, perfil con foto, colores, temas y persistencia | Recorrido automatizado correcto                                 |
| Ventana de 960 × 720 y 1440 × 960                                                                                                   | Revisadas visualmente, sin desbordamiento horizontal            |
| Biblioteca y cola con 5.000 registros sintéticos                                                                                    | Ventanas de filas acotadas; acceso a la última canción correcto |

Los archivos FLAC y MP3 del repositorio contienen silencio sintético de 16 segundos con etiquetas de prueba. Las capturas muestran esos archivos, no una biblioteca real del usuario.

El flujo de GitHub Actions repite las pruebas y construye un instalador NSIS en Windows. Un cambio solo tiene instalador verificado cuando su ejecución termina correctamente y publica el artefacto; consultar Actions para el estado exacto del commit.

## Lo que queda por comprobar en el equipo del usuario

- Instalar, iniciar y reproducir archivos reales FLAC/MP3, incluidos FLAC de 24 bits y frecuencias distintas.
- Probar pausa/reanudación, cambios de canción, seek y salida de audio con sus dispositivos de Windows.
- Revisar el guardado al cerrar y la restauración de cola, perfil y posición, sin reproducción automática.
- Medir RAM, CPU, GPU y tiempo de arranque en release, en reposo, reproduciendo y con efectos reducidos.

No se ha medido todavía el consumo del ejecutable en Windows. Las pruebas del adaptador del navegador y la decodificación sin dispositivo no validan por sí solas la salida nativa de audio. No se afirma reproducción gapless, salida exclusiva, bit-perfect ni consumo cero.

## Regresiones corregidas en 0.1.1

- Se reprodujo `SymphoniaDecoder(BaseSeek(SeekError(Unseekable)))` con el constructor anterior y el FLAC sintético sin tabla de saltos.
- El constructor nuevo usa Rodio 0.21.1 con longitud real y búsqueda habilitada. La prueba abre FLAC y MP3, salta a 5/2/14/0 segundos y reabre a 7,5 segundos como al reanudar una pausa.
- Enhanced LRC: se ocultan etiquetas `<mm:ss.mmm>` duplicadas y prefijos de voces; se conservan los tiempos de cada palabra y el offset.
- La prueba de interfaz comprueba letras limpias, vistas grandes de portada/letra, cambio de canción dentro de la vista, pausa/reanudación y salida con Esc.

La prueba de decodificación sin dispositivo reproduce y corrige el error del lector; la salida de audio con el archivo y dispositivo concretos del usuario sigue requiriendo prueba en su PC.

## Candidata 1.0.0-rc.1

- La cola conserva el origen de reproducción (playlist, biblioteca, favoritas o sin organizar). Importar canciones actualiza las pendientes del origen activo; quitar una búsqueda restaura el conjunto completo sin reiniciar la canción ni reanudarla si estaba pausada.
- Las entradas añadidas manualmente a la cola, incluidos duplicados, sobreviven a los cambios de filtro. Las canciones ya escuchadas no se reinsertan automáticamente.
- El orden predeterminado usa la fecha de modificación del archivo, de más reciente a más antigua. La app de Windows recupera esta fecha también para registros anteriores; si el archivo no está disponible, conserva la última fecha conocida. El orden manual de playlist sigue disponible.
- La interfaz admite español, inglés, alemán y chino simplificado desde Ajustes → Apariencia. El idioma se guarda localmente. Los títulos, artistas, nombres de playlists y letras conservan su contenido original; los diagnósticos del sistema pueden mantenerse en su idioma de origen.
- Se añadieron pruebas de cola con 1.500 canciones, entradas manuales, filtros e importaciones, cobertura del catálogo y un recorrido de interfaz que cambia los cuatro idiomas y verifica su persistencia. El flujo de Windows ejecuta estos recorridos además de los de letras, edición, selección, inicio y virtualización de 5.000 registros.

La candidata sigue pendiente de una prueba real en el PC del usuario: teclas multimedia de Windows con la ventana en segundo plano, metadatos en Nusa y letras de sus archivos, presencia de Discord con su aplicación configurada y rendimiento con su biblioteca. Compilar correctamente y pasar pruebas sintéticas no confirma por sí solo esas integraciones ni autoriza a describir la candidata como estable.

## Sincronización por palabras en 1.0.0-rc.2

El editor permite marcar palabras con el reloj nativo, corregir segundos, escuchar desde una palabra y deshacer. No deja guardar una sincronización incompleta o desordenada, tampoco al volver a otra pestaña. Ajustar una línea conserva sus palabras y desplaza sus tiempos; los versos repetidos, offsets, voces y milisegundos se conservan al editar. Las palabras sin espacios, como el chino, no reciben espacios artificiales en reproducción. El color de las palabras cantadas y de la palabra actual sigue el acento personalizado.

Se añade un recorrido de interfaz para marcar con Espacio, impedir guardados incompletos, deshacer, corregir, conservar palabras al editar líneas, cancelar cambios, comprobar el color de acento y el retroceso, verificar el HUD pequeño y reabrir la letra guardada. Se ejecuta también en el flujo de Windows antes de generar el instalador. Las pruebas de palabras no sustituyen la comprobación de sincronía con la voz de las canciones del usuario.

## Cambio de salida en 1.0.0-rc.3

- Windows avisa de cambios de salida mediante `MediaDevice.DefaultAudioRenderDeviceChanged`. Las consultas existentes de play/status comprueban también el identificador del dispositivo predeterminado como respaldo; no se añade un temporizador en reposo.
- El callback de error de Rodio avisa al hilo del reproductor. La reconstrucción y el seek se hacen fuera del callback, con hasta tres intentos y una posición congelada entre intentos. Se usan las configuraciones de la salida predeterminada, sin elegir otra salida arbitraria.
- Se invalidan callbacks de streams anteriores. Un error tardío no interrumpe una canción nueva ni reanuda música tras pausar o detener.
- Si no se puede abrir la salida, la canción queda pausada con un aviso y `ended = false`; no se avanza la cola. Reproducir vuelve a intentar la salida actual conservando la posición.
- Ocho pruebas del motor simulan cambio de salida, recuperación temporal, ausencia total de dispositivos, volumen/posición, pausa, callbacks antiguos, fin natural, fallos repetidos del controlador y cambio de canción fallido. Se ejecutan sin un dispositivo de audio. Las pruebas nativas y la compilación Windows se repiten en Actions.

La conmutación física entre USB, Bluetooth y salida integrada queda pendiente de comprobar en el equipo del usuario. Pasar la simulación no confirma el comportamiento de sus controladores.

Referencias: [evento de cambio de salida de Windows](https://learn.microsoft.com/en-us/uwp/api/windows.media.devices.mediadevice.defaultaudiorenderdevicechanged) y [builder de audio de Rodio 0.21.1](https://docs.rs/rodio/0.21.1/rodio/stream/struct.OutputStreamBuilder.html).
