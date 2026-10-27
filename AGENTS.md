# Glass Music

App de escritorio Windows, Tauri 2 + Rust y React/TypeScript. Es un reproductor local, sin login, registro, nube ni telemetría. Discord Rich Presence es opcional y usa el cliente local; el portal se abre solo al pulsar su botón. Lee FLAC/MP3; nunca modificar archivos originales sin una acción explícita del usuario.

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
- npm run test:ui (instalar Chromium con npx playwright install chromium)
- npm run format:check
- cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
- cargo test --locked --manifest-path src-tauri/Cargo.toml
- npm run tauri -- build --bundles nsis (Windows)

El adaptador del navegador permite comprobar la interfaz con IndexedDB y HTML Audio. No sustituye las pruebas de audio y del instalador nativos en Windows.
