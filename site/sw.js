const CACHE='shioai-static-dropbox-v1.1'
const assets=['./','./index.html','./assets/compass.svg','./assets/observatory.webp','./styles/main.css','./js/app.js','./js/config.js','./js/domain.js','./js/sync.js','./js/dropbox.js','./js/storage.js','./js/view.js']
const urls=new Set(assets.map(path=>new URL(path,self.registration.scope).href))
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...urls])))
})
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('shioai-static-') && key!==CACHE).map(key=>caches.delete(key)))))
})
self.addEventListener('fetch',event=>{
  const request=event.request
  if (request.method!=='GET' || !urls.has(request.url)) return
  event.respondWith(fetch(request).catch(async()=> await (await caches.open(CACHE)).match(request) || Response.error()))
})
