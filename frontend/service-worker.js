/* 설치한 앱의 연결 끊김 화면을 제공한다. 지도·기록·API 응답은 캐시에 넣지 않는다. */
'use strict';

const CACHE_PREFIX = 'seoul-compass-offline-';
const CACHE_NAME = CACHE_PREFIX + '1';
const OFFLINE_PAGE = '/offline.html';
const APP_PAGES = new Set(['/', '/alternatives']);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add(new Request(OFFLINE_PAGE, {cache:'reload'}));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !APP_PAGES.has(url.pathname)) return;
  event.respondWith(fetch(request).catch(async () => {
    const page = await caches.match(OFFLINE_PAGE, {cacheName:CACHE_NAME});
    return page || Response.error();
  }));
});
