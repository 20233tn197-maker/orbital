# ORBITAL / ARENA

Juego de combate espacial 3D en navegador, con modo solitario contra IA y salas privadas de hasta 8 naves (humanos + bots). Interfaz en español, Three.js, GSAP y WebSockets con servidor autoritativo Node.js.

## Jugar en este equipo

Necesitas **Node.js 22 o superior** (recomendado: 24 LTS), un ordenador con teclado y mouse y un navegador actualizado compatible con WebGL 2.

En Windows, abre **`JUGAR.bat`**. Instala las dependencias si faltan, abre el navegador y ejecuta el servidor. Mantén la ventana del servidor abierta.

También puedes usar una terminal en esta carpeta:

```powershell
npm.cmd install
npm.cmd start
```

Abre **http://localhost:3000**. Si el servidor ya está en marcha, solo abre la dirección. Para detenerlo: `Ctrl+C` en su terminal.

1. Elige un nombre de piloto.
2. **Vuelo solitario**: configura duración y bots, inicia y pulsa **Entrar en cabina**.
3. **Crear sala privada**: comparte el código de 5 dígitos y la dirección del juego. Los demás eligen **Unirse a una sala**.
4. El anfitrión inicia. También se puede entrar durante una partida en curso.
5. Al terminar, aparece la clasificación. **Otra partida** mantiene a todos en la misma sala. **Ajustar partida** permite cambiar duración y bots antes de la revancha.

El modo solitario usa el mismo servidor local, sin conexión a servicios externos. Las librerías se sirven desde el proyecto: después de instalar las dependencias, no necesita CDN ni Internet para jugar en localhost.

## Controles

| Control | Acción |
|---|---|
| W / S | Avanzar / retroceder |
| A / D | Desplazamiento lateral |
| Mouse | Apuntar y orientar la nave sin límite de giro |
| Q / E | Rotación longitudinal (roll) |
| Espacio / Shift | Ascender / descender en el eje local |
| R + W | Turbo |
| Clic izquierdo | Metralleta |
| Clic derecho | Cañón de dispersión |
| C | Primera / tercera persona |
| Tab, mantenida | Clasificación |
| Esc | Liberar el mouse y abrir el menú |

El turbo se consume en unos 3,2 s; empieza a recargar tras 0,9 s sin usarlo, a 20 unidades/s. Si lo agotas, debe recuperar un 25 % antes de activarse de nuevo. La nave reaparece 3 segundos después de morir, con un escudo de 2,5 s que se desactiva al disparar. Las colisiones con asteroides hacen daño según la velocidad. Gana quien tenga más bajas; en empate, menos muertes; si ambos valores coinciden se declara empate.

## Amigos desde otras ubicaciones

**`localhost` solo funciona en el equipo que ejecuta el juego.** Para jugar desde cualquier lugar, publica este proyecto en un servidor accesible por Internet. La web y los WebSockets se sirven juntos: una sola dirección y un solo puerto.

### Publicar en Render

1. Sube esta carpeta a un repositorio de GitHub, incluyendo `package-lock.json` y excluyendo `node_modules`.
2. En Render, crea un **Web Service** desde ese repositorio (o un Blueprint usando `render.yaml`).
3. Comando de instalación: `npm ci --omit=dev`. Inicio: `npm start`. Health check: `/health`.
4. Usa Node.js 24 y una instancia con proceso persistente para partidas sin suspensión por inactividad.
5. Render proporciona una URL HTTPS. Abre esa URL, crea una sala y comparte el enlace copiado por el juego.

El cliente usa **WSS** automáticamente si la página se sirve por HTTPS. El proveedor debe permitir WebSockets y reenviar los encabezados de actualización de conexión. No necesitas abrir puertos en los routers de tus amigos.

También puedes usar Railway, Fly.io o un VPS. La publicación necesita una cuenta en el proveedor; no se crea automáticamente al ejecutar el juego localmente.

### Docker / VPS

```sh
docker build -t orbital-arena .
docker run -d --name orbital --restart unless-stopped -p 3000:3000 orbital-arena
```

Para HTTPS con Caddy y un dominio apuntando al VPS:

```caddyfile
juego.tudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

El proxy debe conservar el host original. El proceso respeta la variable `PORT` y escucha en `0.0.0.0`.

### Red local

Otros ordenadores de tu misma red pueden abrir `http://IP-LOCAL-DEL-SERVIDOR:3000`. Permite Node.js en el firewall de Windows para redes privadas. La captura del mouse y el audio dependen de las políticas del navegador; para acceso público utiliza HTTPS.

## Configuración y funcionamiento

- Duración: 1, 3, 5, 10, 15, 20 o 30 minutos desde la interfaz. El servidor acepta cualquier entero entre 1 y 30.
- Hasta 6 bots configurables y máximo 8 naves simultáneas. Se reducen los bots si entran humanos.
- Simulación: 30 Hz con paso fijo. Estados de red: 15 Hz. Renderizado independiente con `requestAnimationFrame`.
- Predicción local del vuelo, corrección suave e interpolación de rivales.
- Proyectiles con detección de colisión por segmento para evitar atravesar objetos entre ticks.
- Asteroides móviles, destrucción, fragmentación y reposición limitada.
- Geometrías reutilizadas, proyectiles instanciados y partículas con un pool de tamaño fijo.
- Audio sintetizado localmente con Web Audio.
- Recuperación de sesión tras desconexiones breves; el anfitrión se transfiere a otro humano conectado.
- Las salas viven en memoria. Reiniciar el servidor elimina las partidas. Ejecuta **una única instancia**; escalar horizontalmente requiere enrutamiento por sala o coordinación adicional.
- Códigos privados de acceso, sin cuentas. No hay matchmaking público ni almacenamiento de datos personales.
- Calidad, sensibilidad, volumen y sesión se guardan en el navegador.

El rendimiento depende de GPU, resolución y conexión. Baja a **Rendimiento** en ajustes si hace falta. El indicador de FPS y ping está abajo a la derecha durante la partida.

## Comprobaciones

```powershell
npm.cmd run check
npm.cmd test
```

Las pruebas cubren vuelo y energía, daño, escudos, armas, colisiones, asteroides, reaparición y ciclo multijugador con WebSockets reales: códigos, permisos del anfitrión, unión, reconexión y revancha.

Prueba de navegador (requiere Chromium de Playwright):

```powershell
npx.cmd playwright install chromium
node test/browser-smoke.js
```

El smoke test arranca un servidor de prueba independiente y verifica interfaz, dos clientes en una sala, inicio, cámara y vuelo con mouse capturado, final y revancha. Los resultados gráficos se guardan en `test-results/`.

## Estructura

```text
public/         Cliente, interfaz, renderizado Three.js y audio
server/         Servidor HTTP/WebSocket y simulación autoritativa
shared/         Modelo de vuelo y reglas compartidas
test/           Pruebas de simulación, red y navegador
Dockerfile      Contenedor de producción
render.yaml     Configuración de despliegue
JUGAR.bat       Lanzador Windows
```
