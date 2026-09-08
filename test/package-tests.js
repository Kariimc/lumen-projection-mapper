// Verify real package contents and run its server through the packaged runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');

async function runtime(directory) {
  const archive = path.join(directory, 'resources/app.asar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-packaged-runtime-'));
  const deadline = setTimeout(() => process.exit(1), 10000);
  let servers;
  try {
    assert.equal(process.versions.electron, require('../desktop/package.json').devDependencies.electron);
    assert.equal(path.resolve(process.resourcesPath), path.join(directory, 'resources'));
    const state = require(path.join(archive, 'src/main/state.js')).createState(root);
    servers = require(path.join(archive, 'src/main/server.js')).startServers(state, root, () => {}, {
      httpPort: 0, wsPort: 0, host: '127.0.0.1'
    });
    await Promise.all([once(servers.httpServer, 'listening'), once(servers.wss, 'listening')]);
    for (const file of ['index.html', 'controller.js', 'style.css']) {
      const response = await new Promise((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port: servers.httpServer.address().port,
          path: file === 'index.html' ? '/' : '/' + file }, reply => {
          const chunks = [];
          reply.on('data', chunk => chunks.push(chunk));
          reply.on('end', () => resolve({ status: reply.statusCode, body: Buffer.concat(chunks) }));
        });
        request.setTimeout(2000, () => request.destroy(new Error('HTTP timeout')));
        request.on('error', reject);
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, fs.readFileSync(path.join(directory, 'resources/controller', file)));
    }
    console.log('PASS packaged executable loads ASAR dependencies and serves all controller files on loopback');
  } finally {
    clearTimeout(deadline);
    if (servers) await Promise.all([new Promise(resolve => servers.httpServer.close(resolve)),
      new Promise(resolve => servers.wss.close(resolve))]);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const directory = path.resolve(process.argv[3] || path.join(__dirname, '../desktop/dist/win-unpacked'));
  if (process.argv[2] === 'runtime') return runtime(directory);
  const asar = require('@electron/asar');
  const archive = path.join(directory, 'resources/app.asar');
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
  for (const required of ['/src/main/index.js', '/src/main/server.js', '/src/control/control.html',
    '/src/output/output.html', '/node_modules/ws/package.json', '/node_modules/qrcode/package.json']) {
    assert(files.includes(required), `package missing ${required}`);
  }
  assert(!files.some(file => /\/(?:\.env(?:\.|$)|\.git\/|test\/)/.test(file)), 'private/test files in archive');
  for (const file of ['index.html', 'controller.js', 'style.css']) {
    assert.deepEqual(fs.readFileSync(path.join(directory, 'resources/controller', file)),
      fs.readFileSync(path.join(__dirname, '../controller', file)), `packaged controller ${file} differs`);
  }
  console.log('PASS package contains application/dependencies and exact controller assets');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const result = spawnSync(path.join(directory, 'Lumen.exe'), [__filename, 'runtime', directory], {
    env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  process.stdout.write(result.stdout);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
