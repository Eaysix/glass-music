# Glass Music

App de escritorio Windows, Tauri 2 + Rust y React/TypeScript. Es un reproductor local, sin login, registro, nube ni telemetría. Lee FLAC/MP3; nunca modificar archivos originales sin una acción explícita del usuario.

## Trabajo

- Requisitos y decisiones: docs/REQUISITOS.md. Actualizarlos si cambia el alcance.
- No subir música personal, bases de datos, credenciales ni compilaciones. Los dos audios en tests/fixtures son silencio sintético para pruebas.
- Usar ramas por función, commits pequeños y PRs para revisión.
- Conservar cola real, historial y preferencias entre sesiones; no reproducir automáticamente al abrir.
- Mantener reproducción nativa, decodificación en streaming, portadas pequeñas en caché y lista virtualizada. Evitar temporizadores cuando no se reproduce.
- Sin promesas de consumo de memoria/CPU hasta medir una compilación release en Windows.

## Comprobaciones

- npm ci
- npm test
- npm run build
- cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
- cargo test --locked --manifest-path src-tauri/Cargo.toml
- npm run tauri -- build --bundles nsis (Windows)

El adaptador del navegador permite comprobar la interfaz con IndexedDB y HTML Audio. No sustituye las pruebas de audio y del instalador nativos en Windows.
