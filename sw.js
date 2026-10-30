const CACHE_NAME = 'finalCountdown';
const VIRTUAL_CACHE_NAME = 'gmjs-virtual-workspace';
let activeDirectoryHandle = null;

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map(k => k !== CACHE_NAME && k !== VIRTUAL_CACHE_NAME && caches.delete(k)))));
    self.clients.claim();
});

// Receive directory handle from main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_WORKSPACE_HANDLE') {
        activeDirectoryHandle = event.data.handle;
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass browser-sync or live-reload sockets if present
    if (url.pathname.includes('browser-sync')) {
        return;
    }

    // Intercept test preview requests to serve active editor content from persistent cache and relative local assets
    if (url.pathname.includes('__workspace_preview__')) {
        event.respondWith(async function() {
            try {
                if (url.pathname.endsWith('index.html') || url.pathname.endsWith('/__workspace_preview__/')) {
                    const cache = await caches.open(VIRTUAL_CACHE_NAME);
                    const cachedRes = await cache.match('virtual-index.html');
                    if (cachedRes) {
                        return cachedRes;
                    }
                    return new Response('<h1>No Code Found in Workspace Cache</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
                }

                // For relative assets (images/dog.png, css/style.css), pull from local directory handle
                if (activeDirectoryHandle) {
                    let pathParts = url.pathname.split('__workspace_preview__/')[1].split('/');
                    let currentHandle = activeDirectoryHandle;

                    for (let i = 0; i < pathParts.length - 1; i++) {
                        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
                    }
                    const fileHandle = await currentHandle.getFileHandle(pathParts[pathParts.length - 1]);
                    const file = await fileHandle.getFile();
                    
                    return new Response(file, {
                        status: 200,
                        headers: { 'Content-Type': file.type || 'application/octet-stream' }
                    });
                }

                return new Response('Workspace folder not linked', { status: 404, headers: { 'Content-Type': 'text/plain' } });
            } catch (err) {
                return new Response('Asset not found in local workspace folder', { status: 404, headers: { 'Content-Type': 'text/plain' } });
            }
        }());
        return;
    }

    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            });
        }).catch(() => {
            // CRITICAL FIX: Always return a valid Response instead of undefined to prevent SW crashes
            return new Response('Network error or resource unavailable', { status: 404, headers: { 'Content-Type': 'text/plain' } });
        })
    );
});