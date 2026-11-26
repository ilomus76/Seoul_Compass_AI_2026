const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');

const read = path => readFileSync(join(__dirname, '../frontend', path));

test('설치 매니페스트의 앱 아이콘 크기와 홈 화면 시작 주소를 확인한다', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    assert.ok(icon?.purpose.split(' ').includes('any'));
    const png = read(icon.src);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.match(read('index.html').toString(), /rel="manifest" href="\/manifest.webmanifest"/);
});

test('오프라인에는 연결 화면을 제공하고 여행 API 응답은 캐시하지 않는다', async () => {
  const origin = 'http://127.0.0.1:9200';
  const listeners = new Map();
  const cached = new Map();
  const removed = [];
  const offlinePage = {body:read('offline.html').toString()};
  const onlinePage = {body:'app'};
  let online = true;
  const self = {
    location:{origin}, addEventListener:(name, listener) => listeners.set(name, listener),
    async skipWaiting() {}, clients:{async claim() {}}
  };
  const caches = {
    async keys() { return [...cached.keys(), 'seoul-compass-offline-old', 'other-app']; },
    async open(name) {
      const entries = new Map();
      cached.set(name, entries);
      return {async add(request) { entries.set(new URL(request.url).pathname, offlinePage); }};
    },
    async delete(name) { removed.push(name); },
    async match(path, options) { return cached.get(options.cacheName)?.get(path); }
  };
  const scope = {self, caches, URL,
    Request: class {constructor(path) { this.url = new URL(path, origin); }},
    async fetch() {
      if (!online) throw new Error('offline');
      return onlinePage;
    }
  };
  runInNewContext(read('service-worker.js').toString(), scope);
  function dispatch(name, fields = {}) {
    let result;
    const capture = promise => { result = promise; };
    listeners.get(name)({...fields, waitUntil:capture, respondWith:capture});
    return result;
  }
  const navigate = path => dispatch('fetch', {request:{url:origin + path, method:'GET', mode:'navigate'}});
  await dispatch('install');
  await dispatch('activate');
  assert.deepEqual(removed, ['seoul-compass-offline-old']);
  assert.deepEqual([...cached.values()][0].size, 1);
  assert.equal(await navigate('/'), onlinePage);
  online = false;
  assert.equal(await navigate('/alternatives'), offlinePage);
  assert.match(offlinePage.body, /다시 연결/);
  assert.equal(navigate('/api/trips'), undefined);
  assert.equal(dispatch('fetch', {request:{url:origin + '/', method:'POST', mode:'navigate'}}), undefined);
});
