const CACHE='ventkub-payments-pwa-v1';
const STATIC=[
  '/ventkub-payments/',
  '/ventkub-payments/manifest.webmanifest',
  '/ventkub-payments/app.css?v=1',
  '/ventkub-payments/app1.js?v=1',
  '/ventkub-payments/app2.js?v=1',
  '/shared-assets/ventkub-payments/icon-180.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.pathname.startsWith('/api/')) return;
  if(event.request.method!=='GET') return;
  event.respondWith(
    fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      return response;
    }).catch(()=>caches.match(event.request))
  );
});
