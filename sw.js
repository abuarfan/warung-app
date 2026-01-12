const CACHE_NAME = 'warungku-v3-nomargin-autosync-v2';
const ASSETS = ['./','./index.html','./style.css','./app.js','./supabaseClient.js','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install', (e)=>{ e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', (e)=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):null))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', (e)=>{ e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res=>{const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request, copy));return res;}).catch(()=>cached))); });
