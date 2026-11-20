const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const baseUrl = process.env.WMS_UI_BASE_URL || 'http://localhost:3000';

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

function publicUrl(file) {
  const relative = path.relative(publicRoot, file).split(path.sep).join('/');
  return `/${relative}`;
}

function pageUrl(file) {
  const relative = path.relative(publicRoot, file).split(path.sep).join('/');
  return `/${relative}`;
}

async function request(url) {
  const response = await fetch(new URL(url, baseUrl), { redirect: 'manual' });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

async function main() {
  const version = await (await request('/api/version')).json();
  if (!version?.success || path.resolve(version.root).toLowerCase() !== root.toLowerCase()) {
    throw new Error(`The running app does not point at this project: ${JSON.stringify(version)}`);
  }

  const files = (await walk(publicRoot)).filter(file => file.endsWith('.html'));
  const assetFailures = [];
  let assets = 0;
  for (const file of files) {
    const url = pageUrl(file);
    const html = await (await request(url)).text();
    const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(value => value.startsWith('/') && !value.startsWith('//'))
      .filter(value => /\.(?:js|css)(?:[?#]|$)/i.test(value));
    for (const ref of references) {
      assets++;
      try { await request(ref); }
      catch (error) { assetFailures.push(`${url} -> ${ref}: ${error.message}`); }
    }
  }

  const pickHtml = await fs.readFile(path.join(publicRoot, 'desktop', 'pick.html'), 'utf8');
  const batchScript = await fs.readFile(path.join(publicRoot, 'js', 'fg-pick-batch.js'), 'utf8');
  if (!pickHtml.includes('fg-pick-batch.js?v=20261120-atomic-fg-batch-4')) {
    assetFailures.push('PICK page cache version does not reference the current FG batch UI.');
  }
  if (!batchScript.includes('reference.hidden=!isFG') || !batchScript.includes("reference.style.display=isFG?'block':'none'")) {
    assetFailures.push('FG-only batch number is not hidden in non-FG pick modes.');
  }
  if (assetFailures.length) throw new Error(assetFailures.join('\n'));
  console.log(JSON.stringify({ success: true, appVersion: version.version, htmlPages: files.length, localJsCssReferences: assets, checkedRoot: version.root }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
