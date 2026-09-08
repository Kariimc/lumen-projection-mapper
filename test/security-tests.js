// The dependency's real extractor must reject an escaping symlink (CVE-2026-56876).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const fromDesktop = createRequire(path.join(__dirname, '../desktop/package.json'));
const fromElectron = createRequire(fromDesktop.resolve('electron/package.json'));
const dependency = fromElectron('./package.json').dependencies;
const loaded = fromElectron(dependency['@electron-internal/extract-zip'] ? '@electron-internal/extract-zip' : 'extract-zip');
const extract = loaded.extract || loaded;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-zip-security-'));
(async () => {
  try {
    const dir = path.join(root, 'output'); fs.mkdirSync(dir);
    const validZip = path.join(root, 'valid.zip');
    fs.writeFileSync(validZip, Buffer.from('UEsDBBQAAAAAAGVnKF2PKKQfBAAAAAQAAAAIAAAAc2FmZS50eHRzYWZlUEsBAhQAFAAAAAAAZWcoXY8opB8EAAAABAAAAAgAAAAAAAAAAAAAAIABAAAAAHNhZmUudHh0UEsFBgAAAAABAAEANgAAACoAAAAAAA==', 'base64'));
    await extract(validZip, { dir });
    assert.equal(fs.readFileSync(path.join(dir, 'safe.txt'), 'utf8'), 'safe');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'keep');
    const zip = path.join(root, 'input.zip');
    // Stored Unix symlink named escape -> ../outside.txt; every path stays in our fixture.
    fs.writeFileSync(zip, Buffer.from('UEsDBBQAAAAAAAAAIQDGnafXDgAAAA4AAAAGAAAAZXNjYXBlLi4vb3V0c2lkZS50eHRQSwECFAMUAAAAAAAAACEAxp2n1w4AAAAOAAAABgAAAAAAAAAAAAAA/6EAAAAAZXNjYXBlUEsFBgAAAAABAAEANAAAADIAAAAAAA==', 'base64'));
    await assert.rejects(extract(zip, { dir }), /symlink|outside|escap|travers/i);
    assert.equal(fs.existsSync(path.join(dir, 'escape')), false);
    assert.equal(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8'), 'keep');
    console.log('PASS archive extractor rejects escaping symlink; outside fixture unchanged');
  } finally {
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'fixture must remain inside the temporary directory');
    assert(path.basename(root).startsWith('lumen-zip-security-'), 'only the owned fixture may be removed');
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
