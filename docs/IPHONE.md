# Glass Music para iPhone · primera prueba

Esta versión usa SwiftUI y AVPlayer en iOS 17 o posterior. Reproduce FLAC/MP3 descargados o importados desde Archivos, también sin conexión, en segundo plano y desde los controles de la pantalla bloqueada. No requiere una cuenta. CarPlay queda para una etapa posterior.

## Vincular y descargar

1. Instalar el compañero Windows 1.0.0-rc.4. En Ajustes → iPhone, activar la conexión local. Si Windows solicita acceso de red, permitirlo en la red privada de confianza.
2. Conectar PC e iPhone a la misma red. En la PC, elegir la dirección de esa red y generar el QR. Caduca a los cinco minutos y solo sirve una vez.
3. En iPhone, abrir Sincronizar → Vincular mi PC, permitir acceso a la red local y escanear el QR. También se puede pegar el código completo.
4. Sincronizar para ver la colección de la PC. Descargar las canciones o una playlist. Solo las descargas se reproducen sin conexión; ver el catálogo no descarga toda la música.
5. Para actualizar letras, favoritas y progreso, mantener Glass Music abierto en la PC, activar su conexión local y pulsar Sincronizar en el teléfono. La sincronización es manual y no usa datos móviles.

La PC envía canciones, portadas, playlists, letras editadas y sus tiempos. Las letras y favoritas editadas en el iPhone se envían a la PC al sincronizar. Si ambos equipos editaron la misma letra, se conservan ambas versiones hasta elegir una. El progreso permite continuar en el otro dispositivo sin cambiar de canción automáticamente. Las playlists creadas en el teléfono son locales en esta primera versión. Los archivos originales de la PC no se modifican.

Descargar una canción copia el archivo completo al almacenamiento de la app. Quitar una descarga libera esa copia y conserva los datos; no borra el original de la PC. Desinstalar la app elimina sus descargas y datos locales. Si cambia la IP de la PC, generar otro QR para renovar su dirección. No exponer el puerto 38473 a internet.

## IPA sin firma

Actions genera `Glass-Music-iPhone-0.1.1-unsigned.ipa`. Es un paquete para pruebas: un iPhone normal necesita que se firme después con una identidad y un perfil válidos antes de instalarlo. No se incluyen certificados, perfiles ni credenciales en el repositorio. Esta compilación no está publicada en App Store y no prueba el funcionamiento en un teléfono físico.

## Comprobaciones

El flujo `ios.yml` ejecuta las pruebas del protocolo Rust, compila para dispositivo sin firma y ejecuta pruebas unitarias e interfaz en Simulator. La prueba de cliente nativo usa un servidor Rust temporal con dos audios de silencio sintético para comprobar vinculación, descarga TLS, letras, conflictos y rechazo de certificados distintos. No accede a una biblioteca personal. Los resultados y capturas quedan como artifacts de Actions.

Antes de uso cotidiano, comprobar en el iPhone real: permiso de red local/cámara, FLAC/MP3 propios, pausa/siguiente/seek desde pantalla bloqueada, Bluetooth y llamadas, reproducción sin Wi-Fi, sincronización de letras editadas y descarga interrumpida. La transferencia se realiza con la app abierta; la continuación en segundo plano de una sincronización larga queda pendiente.

## Interfaz 0.1.1

La barra inferior reserva espacio para el minirreproductor y los cinco destinos: Inicio, Biblioteca, Descargas, Sincronizar y Ajustes. El contenido puede desplazarse hasta el final sin quedar tapado. El reproductor grande se abre a pantalla completa y permite desplazarse en pantallas pequeñas o en horizontal.

En Ajustes se puede cambiar el nombre y la foto del perfil local, elegir color propio o seguir el de la PC, seleccionar fondo Aurora/Medianoche/Grafito, ajustar el cristal, el tamaño del HUD, la portada, la letra y las animaciones. Estas preferencias se guardan en el iPhone y la sincronización no las reemplaza. Restablecer apariencia conserva el nombre, la foto, la música y las letras. Se respetan Reducir movimiento y Reducir transparencia de iOS.

Las portadas se normalizan a RGB y se reducen a 512 píxeles reales; las fotos de perfil a 256. El fondo se dibuja una vez y se reutiliza, sin animaciones continuas ni degradados de SwiftUI sobre la portada. La comprobación en el iPhone físico sigue siendo necesaria para confirmar la desaparición de los bloques de color informados.

En iOS 26, la navegación y el minirreproductor usan Liquid Glass nativo. En iOS 17/18 se usa material translúcido compatible. Actions selecciona Xcode 26 estable, prueba el diseño principal en iOS 26 y comprueba la navegación en un iPhone SE cuando ese simulador está disponible (iOS 18.5 si está instalado; iOS 26 en otro caso).
