# Sismo-Alerta
Panel que corrobora alertas sísmicas entre USGS, EMSC, SGC (Colombia) y GFZ, y notifica por Firebase solo lo verificado.

## Arquitectura
- **Web (GitHub Pages)**: `index.html` + `sw.js`. Dashboard en vivo con USGS, EMSC y el catálogo oficial del SGC (ArcGIS REST, carpeta `catalogo_sismos`, autodetectado); registra el token FCM y tus preferencias en Firestore (`devices`).
- **Verificador (GitHub Actions, cada 5 min)**: `scripts/verify-and-notify.mjs` consulta las 3 fuentes, las cruza y envía push por FCM.
  - **Alerta**: ≥2 fuentes coinciden (±120 s, 150 km, magnitud <0.7 de diferencia).
  - **Inconsistencia** (solo a quien la active): una sola fuente tras 10 min, o magnitudes que difieren ≥0.7.

## Puesta en marcha
1. Firebase Console > *Agregar proyecto*, luego *Agregar app web* y copia la config en `firebase-config.js`.
2. *Cloud Messaging* > Certificados push web > genera el par de claves y pega la VAPID en `firebase-config.js`.
3. *Firestore Database* > crear base (modo producción) y publica `firestore.rules`.
4. *Configuración > Cuentas de servicio* > Generar clave privada. En GitHub: *Settings > Secrets > Actions* > `FIREBASE_SERVICE_ACCOUNT` = contenido del JSON.
5. En Firebase *Authentication > Configuración > Dominios autorizados* agrega `TU-USUARIO.github.io`.
6. Sube todo a GitHub, activa Pages y ejecuta el workflow "Verificar sismos" una vez a mano.
7. Abre la app, pulsa **Activar alertas y ubicación**.

Notas: GitHub puede retrasar los cron varios minutos; para alertas de segundos, migra el verificador a Cloud Functions (plan Blaze). Sube `V` en `sw.js` en cada versión.

## Publicar en Firebase Hosting (alternativa a GitHub Pages)
```
npm i -g firebase-tools
firebase login
firebase use --add        # elige tu proyecto
firebase deploy --only hosting,firestore:rules
```
La URL será `https://TU-PROYECTO.web.app` (agrégala en Authentication > Dominios autorizados si usas otro dominio).

## SGC en el panel
El panel consulta el catálogo del Servicio Geológico Colombiano y lo cruza con USGS y EMSC (±120 s, 150 km). Si el SGC no responde, el panel muestra "SGC sin respuesta" y sigue con las otras fuentes. El verificador de servidor (`scripts/verify-and-notify.mjs`) no venía en los archivos: para que las notificaciones push también usen el SGC, hay que sumarle esta fuente.
