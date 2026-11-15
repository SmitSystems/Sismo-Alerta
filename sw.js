/* Sube V al publicar una versión nueva. Los datos de sismos nunca se guardan en caché: siempre vienen en vivo. */
const V='sismos-v2',FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||new URL(q.url).origin!==location.origin)return;
  e.respondWith(fetch(q).then(r=>{if(r&&r.status===200){const c=r.clone();caches.open(V).then(x=>x.put(q,c))}return r}).catch(()=>caches.match(q,{ignoreSearch:true}).then(h=>h||caches.match('index.html'))))});
/* Push de Firebase (mensajes solo-datos enviados por el verificador) */
self.addEventListener('push',e=>{let d={};try{d=(e.data.json().data)||{}}catch(x){}
  const inc=d.kind==='inconsistency';
  e.waitUntil(self.registration.showNotification(d.title||(inc?'Inconsistencia entre fuentes':'Sismo M'+d.mag),{body:d.body||d.place||'',tag:d.id||'sismo',requireInteraction:!inc,icon:'icon-192.png',badge:'icon-192.png',data:d,vibrate:[300,150,300,150,600]}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(l=>l.length?l[0].focus():clients.openWindow('./')))});
