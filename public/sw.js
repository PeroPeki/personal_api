const CACHE='personal-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html','/icon.svg','/'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).then(response=>{if(response.ok&&url.pathname==='/'){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put('/',copy)));}return response;}).catch(async()=>await caches.match('/')||await caches.match('/offline.html')));
  else if(url.pathname.startsWith('/_next/static/'))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;})));
});
self.addEventListener('push',event=>{let payload={};try{payload=event.data.json();}catch{}event.waitUntil(self.registration.showNotification(typeof payload.title==='string'?payload.title:'Personal',{body:typeof payload.body==='string'?payload.body:'Tvoj dnevni pregled je spreman.',icon:'/icon.svg',badge:'/icon.svg',data:{url:'/'}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const open=clients.find(client=>new URL(client.url).origin===self.location.origin);return open?open.focus():self.clients.openWindow('/');}));});
self.addEventListener('message',event=>{if(event.data==='CLEAR_PRIVATE')event.waitUntil(caches.delete(CACHE));if(event.data?.type==='CACHE_ASSETS'&&Array.isArray(event.data.urls)){const urls=event.data.urls.filter(value=>{try{const u=new URL(value,self.location.origin);return u.origin===self.location.origin&&u.pathname.startsWith('/_next/static/');}catch{return false;}}).slice(0,100);event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(urls.map(url=>cache.add(url)))));}});
