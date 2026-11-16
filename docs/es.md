# DOODS

Lleva la **detección local de objetos** de [DOODS](https://github.com/snowzach/doods2) (Dedicated
Open Object Detection Service) a las imágenes de sus cámaras: Gladys sabe si una persona, un coche, un
gato… está a la vista, cuántos, y muestra la imagen con los recuadros que dibujó DOODS. Todo queda en
casa: sin nube, sin cuenta. DOODS analiza una imagen bajo demanda; no es un grabador de vídeo (para
eso, vea Frigate o Viseron).

Probada contra un servidor DOODS real en Docker (snowzach/doods2, CPU, detectores `default` tflite y
`tensorflow`) con fotos libres (una persona, coches, un gato, una habitación vacía), aún no con
cámaras reales en servicio: sus comentarios son bienvenidos en
[GitHub](https://github.com/guim31/gladys-doods/issues) o en el foro de Gladys.

## Requisitos

- Gladys 5.1 o posterior.
- Un servidor DOODS (imagen Docker `snowzach/doods2`), accesible desde Gladys en su puerto (8080 por
  defecto).
- Para cada cámara, una dirección que DOODS pueda leer: una **URL de instantánea JPEG** (la mayoría de
  las cámaras IP tienen una, p. ej. `http://usuario:contraseña@192.168.1.30/snapshot.jpg`) o un
  **flujo RTSP** (`rtsp://…`).

Una integración no puede leer la imagen de una cámara que ya está en Gladys (las integraciones
externas no tienen ese acceso): indique la dirección de la propia cámara.

## Instalación

1. Inicie DOODS, por ejemplo: `docker run -d --restart unless-stopped -p 8080:8080 snowzach/doods2`.
2. En Gladys, **Integraciones → Instalar desde GitHub**, dirección
   `https://github.com/guim31/gladys-doods`.
3. En la configuración, rellene **Dirección de DOODS** y, para cada cámara (cuatro como máximo), un
   **Nombre** y una **Dirección de la imagen**.
4. Ejecute la acción **Comprobar la conexión**: indica el detector y analiza cada cámara una vez.
5. Abra la pestaña **Descubrir** y añada las cámaras: un dispositivo por cámara.

Ajustes:

- **Detector**: `default` (tflite, rápido: unos 0,3 s por imagen en una CPU) o `tensorflow` (más
  preciso, unos 2 s, y más de un minuto para su primerísima imagen mientras carga el modelo), o
  cualquier detector configurado en su DOODS.
- **Objetos buscados**: las etiquetas del detector, en inglés, separadas por comas: `person`, `car`,
  `truck`, `bicycle`, `motorcycle`, `cat`, `dog`, `bird`… (las 80 etiquetas COCO). `*` conserva todas
  las etiquetas. Cada cámara puede tener su propia lista en **Objetos (opcional)**.
- **Confianza mínima**: las detecciones por debajo se ignoran. Una cámara puede tener la suya en
  **Confianza en % (opcional)**.
- **Intervalo de análisis**: con qué frecuencia se analiza cada cámara añadida, una tras otra. **Solo
  bajo demanda** no analiza nada por sí mismo (acción de escena, botón del widget, imagen pedida por
  Gladys).
- **Idioma de los nombres**: nombres de las funciones, objetos y textos de las escenas.

**Carga de CPU**: cada análisis decodifica una imagen y ejecuta el modelo en la máquina de DOODS. Con
cuatro cámaras cada 10 segundos y el detector `tensorflow`, una máquina pequeña está ocupada todo el
tiempo; 1 minuto con `default` es un buen comienzo.

## Los dispositivos en Gladys

Un dispositivo por cámara, con:

- **Imagen**: la última imagen analizada, con los recuadros de DOODS (reducida para Gladys).
- **Objeto detectado**: uno de los objetos buscados está a la vista (Sí/No).
- **Objetos detectados**: lo que está a la vista, p. ej. «Persona ×2, Coche», o «Ninguno».
- Un contador por etiqueta buscada, p. ej. **Persona (número)**, **Coche (número)** (no con `*`).

La insignia del dispositivo pasa a «inaccesible» cuando no se puede leer la imagen de la cámara.

## Widget del panel

**Cámara DOODS**: la imagen analizada, los objetos hallados, la mejor confianza, el número de cada
etiqueta buscada, la hora del análisis y un botón **Analizar ahora** (el ajuste **Ocultar el botón
Analizar** lo oculta).

## Escenas

### Disparadores

- **Objeto detectado por DOODS**: un objeto aparece en un análisis regular (estaba ausente del
  anterior), en una cámara o en cualquiera. Filtro por objetos. Variables: cámara, objeto, número,
  confianza. Un evento cuando el objeto aparece, no uno por análisis.
- **Imagen de cámara no leída**: no se pudo leer la imagen de una cámara (primer fallo seguido).

Los disparadores proceden solo de los análisis regulares: con **Solo bajo demanda**, nunca se
disparan.

### Acciones

- **Analizar una cámara con DOODS**: analiza la cámara ahora y actualiza su imagen. Salidas: objeto
  detectado, objetos detectados, número de objetos, número de personas, mejor confianza. No dispara
  ningún disparador.

### Ideas de escenas

- Cuando se abre la puerta de entrada, **Analizar una cámara con DOODS** y, si el número de personas
  es mayor que 0, la acción «Enviar una imagen de cámara» del núcleo le envía la imagen con sus
  recuadros.
- **Objeto detectado por DOODS** (persona, cámara del jardín) con la alarma activada → notificación.
- Un coche en la entrada de noche → encender la luz exterior.

## Solución de problemas

- **DOODS no responde**: compruebe la dirección y el puerto (8080), y que DOODS está en marcha
  (`docker logs`).
- **No tiene el detector «…»**: el estado enumera los detectores de su servidor; copie el nombre en
  **Detector**.
- **Imagen no leída**: abra la dirección de la cámara en un navegador desde la máquina de Gladys. Una
  dirección HTTP debe dar una imagen JPEG, no una página. La autenticación Digest no se admite en
  HTTP: use el flujo RTSP. Un flujo RTSP lo lee el propio DOODS, que debe por tanto alcanzar la
  cámara.
- **Etiquetas que este detector no conoce**: una errata en **Objetos buscados**, u otro modelo.
- **No se detecta nada**: baje la **Confianza mínima**, o pruebe el detector `tensorflow`.
- Registros detallados: `LOG_LEVEL=debug`.

## Límites

- Cuatro cámaras como máximo y ocho etiquetas contadas por cámara.
- Sin vídeo: una imagen por análisis; un objeto que pasa entre dos análisis no se ve.
- Sin zonas de detección (`regions` de DOODS) en esta versión.
- Las imágenes de las cámaras se envían a Gladys como máximo cada 5 segundos por cámara.
- Sin relación con el proyecto DOODS. Desarrollada sin cámaras reales: sus comentarios son
  bienvenidos.
