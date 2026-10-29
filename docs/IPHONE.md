# Glass Music para iPhone · 0.5.0

Esta versión usa SwiftUI y AVPlayer en iOS 17 o posterior. Reproduce FLAC/MP3 descargados o importados desde Archivos, también sin conexión, en segundo plano y desde los controles de la pantalla bloqueada. No requiere una cuenta. CarPlay queda para una etapa posterior.

## Vincular y descargar

1. Instalar el compañero Windows 1.0.0-rc.7. En Ajustes → iPhone, activar la conexión local. Si Windows solicita acceso de red, permitirlo en la red privada de confianza.
2. Conectar PC e iPhone a la misma red. En la PC, elegir la dirección de esa red y generar el QR. Caduca a los cinco minutos y solo sirve una vez.
3. En iPhone, abrir Sincronizar → Vincular mi PC, permitir acceso a la red local y escanear el QR. También se puede pegar el código completo.
4. Sincronizar para ver la colección de la PC. Descargar las canciones o una playlist. Solo las descargas se reproducen sin conexión; ver el catálogo no descarga toda la música.
5. Para actualizar letras, favoritas y progreso, mantener Glass Music abierto en la PC, activar su conexión local y pulsar Sincronizar en el teléfono. La sincronización es manual y no usa datos móviles.

La PC envía canciones, portadas, playlists, letras editadas y sus tiempos. Las letras y favoritas editadas en el iPhone se envían a la PC al sincronizar. Si ambos equipos editaron la misma letra, se conservan ambas versiones hasta elegir una. El progreso permite continuar en el otro dispositivo sin cambiar de canción automáticamente. Las playlists creadas en el teléfono se envían a la PC al sincronizar, junto con sus portadas y las estadísticas de escucha. Los archivos originales de la PC no se modifican.

Descargar una canción copia el archivo completo al almacenamiento de la app. Quitar una descarga libera esa copia y conserva los datos; no borra el original de la PC. Desinstalar la app elimina sus descargas y datos locales. Si cambia la IP de la PC, generar otro QR para renovar su dirección. No exponer el puerto 38473 a internet.

## IPA sin firma

Actions genera `Glass-Music-iPhone-0.5.0-build<N>-<commit>-unsigned.ipa`. Es un paquete para pruebas: un iPhone normal necesita que se firme después con una identidad y un perfil válidos antes de instalarlo. No se incluyen certificados, perfiles ni credenciales en el repositorio. Esta compilación no está publicada en App Store y no prueba el funcionamiento en un teléfono físico.

## Comprobaciones

El flujo `ios.yml` ejecuta las pruebas del protocolo Rust, compila para dispositivo sin firma y ejecuta pruebas unitarias e interfaz en Simulator. La prueba de cliente nativo usa un servidor Rust temporal con dos audios de silencio sintético para comprobar vinculación, descarga TLS, letras, conflictos y rechazo de certificados distintos. No accede a una biblioteca personal. Los resultados y capturas quedan como artifacts de Actions.

Antes de uso cotidiano, comprobar en el iPhone real: permiso de red local/cámara, FLAC/MP3 propios, pausa/siguiente/seek desde pantalla bloqueada, Bluetooth y llamadas, reproducción sin Wi-Fi, sincronización de letras editadas y descarga interrumpida. La transferencia se realiza con la app abierta; la continuación en segundo plano de una sincronización larga queda pendiente.

## Interfaz

La barra inferior reserva espacio para el minirreproductor y los cinco destinos: Inicio, Biblioteca, Descargas, Sincronizar y Ajustes. El contenido puede desplazarse hasta el final sin quedar tapado. El reproductor grande se abre a pantalla completa y permite desplazarse en pantallas pequeñas o en horizontal.

En Ajustes se puede cambiar el nombre y la foto del perfil local, elegir color propio o seguir el de la PC, seleccionar fondo Aurora/Medianoche/Grafito, ajustar el cristal, el tamaño del HUD, la portada, la letra y las animaciones. Estas preferencias se guardan en el iPhone y la sincronización no las reemplaza. Restablecer apariencia conserva el nombre, la foto, la música y las letras. Se respetan Reducir movimiento y Reducir transparencia de iOS.

Las portadas se normalizan a RGB y se reducen a 512 píxeles reales; las fotos de perfil a 256. El fondo base se prepara una vez y se reutiliza. Aurora añade dos luces en movimiento por Core Animation y detiene el efecto al desaparecer, suspender la app, reducir movimiento o activar ahorro de energía. La comprobación en el iPhone físico sigue siendo necesaria para confirmar la desaparición de los bloques de color informados.

En iOS 26, la navegación y el minirreproductor usan Liquid Glass nativo. En iOS 17/18 se usa material translúcido compatible. Actions selecciona Xcode 26 estable, prueba el diseño principal en iOS 26 y comprueba la navegación en un iPhone SE cuando ese simulador está disponible (iOS 18.5 si está instalado; iOS 26 en otro caso).

## Versiones por plataforma

Windows ofrece `1.0.0-rc.7` e iPhone `0.5.0`; son versiones independientes. Las versiones anteriores siguen permitiendo reproducción local, pero las playlists compartidas y las estadísticas combinadas requieren actualizar ambos. El IPA incluye el número de ejecución de Actions como build y el commit para distinguir intentos. Ajustes lee versión y build del paquete instalado, sin un número escrito a mano. Una ejecución de CI no publica una release ni convierte una compilación fallida en una entrega. Las versiones y assets ya publicados se conservan como historial.

## Orden y movimiento

Biblioteca, Descargas y playlists permiten elegir fecha de modificación (antiguas o nuevas primero), título, artista y orden original. Se guarda por colección en el iPhone, sin cambiar la playlist de PC. Las fechas desconocidas quedan al final y la cola activa sigue los cambios de orden conservando canción, posición e historial. Antiguas primero es el valor inicial.

El HUD anima el indicador de pestaña, cambios de portada, aparición del minirreproductor y tamaño de portada al pausar/reproducir. Aurora incorpora movimiento ambiental suave; se respeta Reducir movimiento y el ajuste Animaciones suaves. El efecto se detiene cuando la app deja de estar activa o entra en ahorro de energía.

Para actualizar, instalar el IPA firmado sobre la app existente con el mismo bundle ID y la misma identidad/equipo de firma. No desinstalar: hacerlo borra las descargas y datos locales. Si cambia la identidad o la herramienta altera el bundle ID, la actualización puede fallar o instalar otra app; conservar la instalación existente y revisar la firma.

Apple ofrece portadas animadas en pantalla bloqueada mediante MPMediaItemAnimatedArtwork en iOS 26. Requiere video local y vista previa, no solamente la imagen integrada del FLAC. Se investigó su viabilidad; esta versión conserva portada estática del sistema y no incluye importación ni generación de videos. Referencia: https://developer.apple.com/documentation/mediaplayer/providing-animated-artwork-for-media-items

## Funciones incorporadas en 0.4.0 · colección, letras y escucha

La actualización de letras y portadas agrupa publicaciones de estado y guardados. Las imágenes se normalizan y escriben fuera del hilo principal. Una edición local durante la transferencia prevalece sobre una letra pendiente de aplicar. Falta comparar la fluidez en el iPhone físico y con la colección del usuario.

Deslizar una canción hacia la derecha añade a la cola manual FIFO. Desde Biblioteca o el reproductor se abre Cola: primero lo añadido por el usuario, después la lista automática. La cola manual persiste, admite repeticiones y no cambia al activar aleatorio.

El editor de letras permite Texto, Líneas y Palabras: reproducir, escuchar desde una posición, marcar y avanzar, deshacer, seleccionar una marca y corregir segundos. Impide guardar marcas incompletas o fuera de orden. Ajustar una línea conserva los tiempos relativos de sus palabras. Cancelar conserva la letra previa.

Las playlists locales tienen portada, búsqueda, selección y edición posterior. Se pueden crear vacías. La selección inicial conserva el orden de elección. En 0.5.0 las listas nuevas del teléfono se envían a PC. Se pueden eliminar listas desde el teléfono sin borrar audios; las listas creadas en PC conservan su editor en PC.

Inicio → Tu música en números muestra minutos por semana, top 5 por tiempo escuchado y resumen anual con períodos anteriores. Empieza desde esta actualización; no reconstruye años anteriores. Registra avance real durante reproducción, excluye saltos y pausas, y reparte intervalos que crucen medianoche. El historial se guarda localmente por dispositivo y, desde 0.5.0/rc.7, los minutos de PC e iPhone se combinan al sincronizar. Sin telemetría ni servidor.

## iPhone 0.5.0

Actualizar también PC a 1.0.0-rc.7. Las playlists del teléfono, incluidas las creadas en 0.4.0, se envían al pulsar **Sincronizar ahora**, junto con nombre, orden, selección y portada. Para borrar una lista, mantener pulsada su tarjeta o usar la papelera dentro de ella y confirmar. Las canciones y descargas se conservan. La eliminación se envía en la siguiente sincronización y se conserva una marca para evitar que una copia antigua restaure la lista. Los conflictos simultáneos ofrecen conservar PC o iPhone desde Sincronizar.

Los minutos de ambos dispositivos se suman al sincronizar. Cada equipo conserva sus contadores propios y las copias del otro se consultan por separado: no se vuelven a contar al reenviar ni al vincular otra vez. Los registros de 0.4.0 y rc.6 se conservan. Sin Wi-Fi puedes seguir escuchando y el tiempo se incorpora al volver a sincronizar. Semanas de lunes a domingo. Los audios importados solo en iPhone aún no se transfieren a PC; su tiempo sí se conserva y puede aparecer sin título en PC.

Aurora incorpora luces lentas en movimiento. Desactivar animaciones, reducir movimiento o activar ahorro de energía detiene el efecto. Actualizar encima con el mismo bundle ID y la misma identidad de firma conserva los datos. No desinstalar para actualizar.
