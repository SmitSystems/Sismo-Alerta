// Corrobora USGS + EMSC + GFZ y envía por FCM solo lo verificado. Estado/dedupe en Firestore (colección "alerts").
import admin from 'firebase-admin';
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=admin.firestore(),fcm=admin.messaging();
const MIN_MAG=3,WIN_H=3,BOX={s:-56,n:14,w:-82,e:-34};        // Sudamérica; ajusta a gusto
const T_MS=120e3,D_KM=150,MAG_GAP=0.7,WAIT_MIN=10;            // criterios de corroboración
const iso=t=>new Date(t).toISOString().slice(0,19),since=Date.now()-WIN_H*36e5;
const km=(a,b)=>{const r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lon-a.lon)*r,h=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;return 12742*Math.asin(Math.sqrt(h))};
const get=async(u,t='json')=>{const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(r.status);return t==='json'?r.json():r.text()};
const box=`minlatitude=${BOX.s}&maxlatitude=${BOX.n}&minlongitude=${BOX.w}&maxlongitude=${BOX.e}`;
const SRC={
 USGS:async()=>(await get(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${iso(since)}&minmagnitude=${MIN_MAG}&${box}`)).features.map(f=>({src:'USGS',id:f.id,t:f.properties.time,mag:f.properties.mag,lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],place:f.properties.place})),
 EMSC:async()=>(await get(`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&orderby=time&limit=500&minmag=${MIN_MAG}&start=${iso(since)}&minlat=${BOX.s}&maxlat=${BOX.n}&minlon=${BOX.w}&maxlon=${BOX.e}`)).features.map(f=>{const p=f.properties;return{src:'EMSC',id:p.unid||f.id,t:Date.parse(p.time),mag:+p.mag,lon:p.lon,lat:p.lat,place:p.flynn_region}}),
 GFZ:async()=>(await get(`https://geofon.gfz.de/fdsnws/event/1/query?format=text&starttime=${iso(since)}&minmagnitude=${MIN_MAG}&${box}`,'text')).split('\n').filter(l=>l&&l[0]!=='#').map(l=>{const c=l.split('|');return{src:'GFZ',id:c[0],t:Date.parse(c[1].replace(/Z?$/,'Z')),lat:+c[2],lon:+c[3],mag:+c[10],place:c[12]}})
};
const ok={},all=[];
await Promise.all(Object.entries(SRC).map(async([n,f])=>{try{const r=(await f()).filter(e=>e.mag>0&&e.t>=since);all.push(...r);ok[n]=r.length}catch(e){ok[n]=null;console.warn(n,'falló:',e.message)}}));
console.log('Fuentes:',ok);
if(!Object.values(ok).some(v=>v!==null))process.exit(0);
const cl=[];
for(const e of all.sort((a,b)=>a.t-b.t)){const c=cl.find(c=>!c.by[e.src]&&Math.abs(c.t-e.t)<T_MS&&km(c,e)<D_KM);
  if(c)c.by[e.src]=e;else cl.push({t:e.t,lat:e.lat,lon:e.lon,place:e.place,by:{[e.src]:e}})}
const prev=new Map((await db.collection('alerts').where('t','>',since-36e5).get()).docs.map(d=>[d.id,d.data()]));
const findPrev=c=>[...prev].find(([,p])=>Math.abs(p.t-c.t)<2*T_MS&&km(p,c)<D_KM);
const devs=(await db.collection('devices').get()).docs.map(d=>({token:d.id,...d.data()}));
const bad=[];
async function send(kind,c,data){
  const targets=devs.filter(d=>kind==='inconsistency'?d.inc:(c.mag>=(d.am??4.5)&&(!d.lat||!(d.rad>0)||km(d,c)<=d.rad)));
  if(!targets.length)return;
  const res=await fcm.sendEach(targets.map(d=>({token:d.token,data,webpush:{headers:{Urgency:'high',TTL:'1800'}}})));
  res.responses.forEach((r,i)=>{if(!r.success&&/registration-token|not-registered/.test(r.error?.code||''))bad.push(targets[i].token)});
  console.log(kind,data.id,'→',res.successCount,'/',targets.length);
}
for(const c of cl){
  const m=Object.values(c.by),ms=m.map(e=>e.mag),n=m.length,spread=Math.max(...ms)-Math.min(...ms);
  c.mag=Math.round(ms.reduce((a,b)=>a+b)/n*10)/10;
  const ageMin=(Date.now()-c.t)/6e4,names=m.map(e=>e.src).join('+');
  const hit=findPrev(c),id=hit?hit[0]:`${Math.round(c.t/1000)}_${c.lat.toFixed(1)}_${c.lon.toFixed(1)}`,st=hit?hit[1]:{};
  const base={id,mag:c.mag.toFixed(1),place:c.place||'',t:String(c.t),lat:String(c.lat),lon:String(c.lon),srcs:String(n)};
  const upd={t:c.t,lat:c.lat,lon:c.lon,mag:c.mag,srcs:names,n,spread:+spread.toFixed(2)};
  if(n>=2&&spread<MAG_GAP&&!st.notified){await send('alert',c,{...base,kind:'alert',title:`Sismo M${c.mag.toFixed(1)} · confirmado por ${n} fuentes`,body:`${c.place||''} (${names})`});upd.notified=true}
  if(((n===1&&ageMin>WAIT_MIN)||(n>=2&&spread>=MAG_GAP))&&!st.incNotified){
    const why=n===1?`Solo ${names} lo reporta tras ${Math.round(ageMin)} min`:`Magnitudes difieren ${spread.toFixed(1)} (${m.map(e=>e.src+' '+e.mag).join(' · ')})`;
    await send('inconsistency',c,{...base,kind:'inconsistency',title:`Inconsistencia · M${c.mag.toFixed(1)}`,body:`${c.place||''}: ${why}`});upd.incNotified=true}
  await db.collection('alerts').doc(id).set(upd,{merge:true});
}
await Promise.all(bad.map(t=>db.collection('devices').doc(t).delete()));
