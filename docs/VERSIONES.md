# Versiones y distribución

`main` contiene Windows. Las referencias móviles no se fusionan a main en este bloque.

| Plataforma | Última referencia previa | Candidato de este bloque | Rama de trabajo          |
| ---------- | ------------------------ | ------------------------ | ------------------------ |
| Windows    | 1.0.0-rc.8               | 1.0.0-rc.9               | feat/pc-release-order    |
| iPhone     | 0.6.0                    | 0.6.1                    | feat/ios-timeline-lyrics |
| Android    | 0.1.0                    | 0.2.0                    | feat/android-lan-lyrics  |

Las versiones de cada plataforma son independientes. El nombre del archivo incluye versión, plataforma, build y/o commit. No reutilizar etiquetas publicadas. El borrador antiguo 0.1.1 y la release Alpha se conservan como históricos, no representan el estado actual.

## Flujo

1. Trabajar en una rama por plataforma, con PR de alcance concreto.
2. Cada push pertinente ejecuta pruebas; no entrega otro instalador por cada ajuste.
3. Con pruebas aprobadas, crear una única rama `release/windows-VERSION`, `release/ios-VERSION` o `release/android-VERSION` desde el commit exacto, o ejecutar manualmente con `package=true`.
4. Ese candidato repite las pruebas y entrega el paquete únicamente si pasan. Probar físicamente antes de publicar.
5. Una release pública se crea de forma explícita, con notas y archivos de esa plataforma. Las comprobaciones y los candidatos no publican releases.

No borrar historial de Actions ni ramas antiguas para aparentar una limpieza: los enlaces antiguos siguen siendo útiles. Los resultados recientes se identifican por nombre de plataforma y commit. Los artefactos de Actions caducan; una release pública conserva los archivos que se suban a ella.
