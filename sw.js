const CACHE_NAME = 'warungku-v3-pwa-v1';
const ASSETS = ['./','./index.html','./style.css','./app.js','./supabaseClient.js','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c=>c.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):null)))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;

  // IMPORTANT: Cache API only supports GET. Never cache POST/PUT/etc.
  if(req.method !== 'GET'){
    return; // let network handle it (Supabase POST, etc.)
  }

  // Only handle same-origin requests (app assets). External (Supabase) should just pass through.
  const url = new URL(req.url);
  if(url.origin !== self.location.origin){
    return;
  }

  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        // Cache successful responses
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c=>c.put(req, copy));
        }
        return res;
      }).catch(()=>cached);
    })
  );
});
