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
    if (/<head[ >]/i.test(html) && !html.includes('form-contrast.css?v=20261123-no-faded-form-text-1')) {
      assetFailures.push(`${url} does not load the project-wide non-fading text-box styles.`);
    }
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
  const pickPackEntry = await fs.readFile(path.join(publicRoot, 'js', 'pick-pack-entry.js'), 'utf8');
  const formContrast = await fs.readFile(path.join(publicRoot, 'css', 'form-contrast.css'), 'utf8');
  const pickLean = await fs.readFile(path.join(publicRoot, 'css', 'pick-lean.css'), 'utf8');
  const pickingScript = await fs.readFile(path.join(publicRoot, 'js', 'warehouse-picking.js'), 'utf8');
  const sharedPickingUi = await fs.readFile(path.join(publicRoot, 'js', 'picking-shared-ui.js'), 'utf8');
  const fgPickingUi = await fs.readFile(path.join(publicRoot, 'js', 'fg-picking-ui.js'), 'utf8');
  const pickingRoute = await fs.readFile(path.join(root, 'src', 'routes', 'picking.js'), 'utf8');
  if (!pickHtml.includes('fg-pick-batch.js?v=20261123-fg-compact-layout-2')) {
    assetFailures.push('PICK page cache version does not reference the current FG batch UI.');
  }
  if (!pickHtml.includes('fg-pick-lean.css?v=20261123-compact-warehouse-cards-2') || !batchScript.includes('if(batch&&!batch.lines.length)') || !batchScript.includes('batch?.lines?.length?localStorage.setItem')) {
    assetFailures.push('FG PICK should use the lean layout and avoid persisting empty batch drafts.');
  }
  if (!pickHtml.includes('pick-pack-entry.js?v=20261123-pick-no-fg-pack-fields-1') || pickPackEntry.includes('WmsPacking.mount(input,fgPickState.product.ProductId)') || !pickPackEntry.includes('if(input)WmsPacking.clear(input)') || !pickPackEntry.includes('WmsPacking.mount(input,pickSelected.ProductId)')) {
    assetFailures.push('FG PICK should keep direct quantity entry without the extra packaging panel; PKG/SEMI helper stays available.');
  }
  if (!pickHtml.includes('warehouse-picking.js?v=20261123-pack-semi-multi-sku-1') || !pickHtml.includes('fg-picking-ui.js?v=20261123-fg-dialog-no-header-x-1') || fgPickingUi.includes('class="btn-close" onclick="closeFGPickDialog()"') || !pickHtml.includes('pick-lean.css?v=20261123-pack-semi-compact-3') || !pickHtml.includes('picking-shared-ui.js?v=20261123-pack-semi-lean-flow-1')) {
    assetFailures.push('PICK page should load the dialog layout without the redundant header X.');
  }
  for (const cue of ['searchText.length<2', 'products.size?', "dataset.selection='selected'", "quantityLabel.textContent='จำนวนเบิก ("]) {
    if (!pickingScript.includes(cue)) assetFailures.push(`PKG/SEMI search and quantity flow is missing ${cue}.`);
  }
  if (!pickHtml.includes('data-selection="none"') || !pickHtml.includes('id="pickSubtitle"') || !sharedPickingUi.includes('กรอกจำนวนบรรจุภัณฑ์และใบงานแพ็ค') || !sharedPickingUi.includes('กรอกจำนวนกึ่งสำเร็จรูปและใบงานแพ็ค') || !sharedPickingUi.includes('พิมพ์อย่างน้อย 2 ตัวอักษร แล้วเลือกสินค้าและ Location ที่ต้องการเบิก')) {
    assetFailures.push('PICK should guide the Pack/SEMI steps and hide the empty issue form.');
  }
  if (!pickLean.includes('#fgPickWorkspace .fg-result') || !pickLean.includes('#sharedPickDetailsHost') || !pickLean.includes('flex: 0 0 50%') || !pickLean.includes('max-width: 575.98px')) {
    assetFailures.push('PKG/SEMI picker should group stock by product and use compact selection controls.');
  }
  if (!formContrast.includes('opacity: 1 !important') || !formContrast.includes('color: #34415d !important')) {
    assetFailures.push('Project-wide text-box styles must keep disabled values fully readable.');
  }
  if (pickingScript.includes('class=\\"btn-close\\"') || !pickingScript.includes('>ปิด</button>')) {
    assetFailures.push('FG stock dialog should use one clear footer close action without a redundant X control.');
  }
  if (!batchScript.includes('reference.hidden=!isFG') || !batchScript.includes("reference.style.display=isFG?'block':'none'")) {
    assetFailures.push('FG-only batch number is not hidden in non-FG pick modes.');
  }
  if (!pickHtml.includes('<details id="pickHistoryDetails"') || !pickingScript.includes('!disclosure.open') || batchScript.includes('h.open=true')) {
    assetFailures.push('Pick history should stay collapsed until opened by the user.');
  }
  if (!pickingRoute.includes("warehouseScope.predicate(req,'s.whid')") || !pickingRoute.includes("warehouseScope.predicate(req,'wh.whid')")) {
    assetFailures.push('Pick inventory queries should filter warehouses in SQL before loading rows.');
  }
  if (assetFailures.length) throw new Error(assetFailures.join('\n'));
  console.log(JSON.stringify({ success: true, appVersion: version.version, htmlPages: files.length, localJsCssReferences: assets, checkedRoot: version.root }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
