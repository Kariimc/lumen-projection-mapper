const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const WebSocket = createRequire(path.join(__dirname, '../desktop/package.json'))('ws');
if (process.argv[2] === 'child') {
  const root = process.argv[3];
  const state = require('../desktop/src/main/state').createState(root);
  const servers = require('../desktop/src/main/server').startServers(state, root, () => {}, {
    httpPort: 0, wsPort: 0, host: '127.0.0.1', controllerDir: path.join(root, 'controller')
  });
  Promise.all([once(servers.httpServer, 'listening'), once(servers.wss, 'listening')])
    .then(() => process.send({ http: servers.httpServer.address().port, ws: servers.wss.address().port }));
} else {
  function request(port, target, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: target, headers }, res => {
        let body = ''; res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.setTimeout(2000, () => req.destroy(new Error('request timeout')));
      req.on('error', reject);
    });
  }
  async function scenario(name, check) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-server-security-'));
    fs.mkdirSync(path.join(root, 'controller')); fs.mkdirSync(path.join(root, 'controller-private'));
    fs.writeFileSync(path.join(root, 'controller/index.html'), '0123456789');
    fs.writeFileSync(path.join(root, 'controller-private/secret.txt'), 'private');
    const child = fork(__filename, ['child', root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let errors = ''; child.stderr.on('data', chunk => errors += chunk);
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill(), 8000);
    try {
      const ports = await Promise.race([once(child, 'message').then(([value]) => value), exited.then(() => { throw new Error(errors || 'server exited'); })]);
      await check(ports);
      console.log('PASS ' + name);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
      assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  (async () => {
    let failed = 0;
    for (const [name, check] of [
      ['static sibling traversal rejected', async ({ http: port }) => {
        assert.equal((await request(port, '/')).body, '0123456789');
        assert.equal((await request(port, '/../controller-private/secret.txt')).status, 403);
      }],
      ['invalid WS values preserve server and valid command', async ({ http: port, ws: wsPort }) => {
        const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
        try {
          await once(ws, 'open');
          ws.send('null'); ws.send('[]'); ws.send('42'); ws.send(JSON.stringify({ type: 'output.blackout', enabled: true }));
          await new Promise((resolve, reject) => {
            ws.on('message', raw => { if (JSON.parse(raw).blackout === true) resolve(); });
            ws.once('close', () => reject(new Error('server closed after invalid message')));
          });
          assert.equal((await request(port, '/')).status, 200);
        } finally { ws.terminate(); }
      }],
      ['malformed ranges rejected; ordinary and suffix ranges work', async ({ http: port }) => {
        for (const range of ['bytes=abc-', 'bytes=8-2', 'bytes=100-', 'bytes=0-1,3-4'])
          assert.equal((await request(port, '/', { Range: range })).status, 416, range);
        assert.equal((await request(port, '/', { Range: 'bytes=2-4' })).body, '234');
        assert.equal((await request(port, '/', { Range: 'bytes=-3' })).body, '789');
        assert.equal((await request(port, '/', { Range: 'bytes=8-99' })).body, '89');
      }]
    ]) {
      try { await scenario(name, check); } catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
    }
    if (failed) process.exitCode = 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
