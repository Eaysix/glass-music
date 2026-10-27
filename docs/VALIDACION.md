# Validación de la alpha

## Comprobaciones realizadas

| Comprobación                                                                                                                        | Resultado                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TypeScript y build de producción Vite                                                                                               | Correcto                                                        |
| Cola, Fisher–Yates, variedad de artistas, historial, persistencia de orden y LRC                                                    | 9 pruebas correctas                                             |
| SQLite con Unicode y rutas duplicadas, lectura/decodificación FLAC y MP3, portadas limitadas a 512 px                               | 3 pruebas Rust correctas                                        |
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
