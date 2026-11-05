'use strict';
// Run on DESKTOP-RT67GE0 from an elevated terminal. No npm packages are installed by this script.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const SERVICE = 'WHStock5555';
const RULE = 'WHStock5555-LAN';
const WINSW_URL = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe';

function parseArgs(args) {
  const config = { action: 'install', appPath: path.resolve(__dirname, '..'), host: 'DESKTOP-RT67GE0', dbServer: 'DESKTOP-RT67GE0', sqlService: '', offline: false, dryRun: false };
  let actionSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { config.action = 'help'; continue; }
    if (arg === '--offline') { config.offline = true; continue; }
    if (arg === '--dry-run') { config.dryRun = true; continue; }
    const key = { '--app': 'appPath', '--host': 'host', '--db-server': 'dbServer', '--sql-service': 'sqlService' }[arg];
    if (key) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing value for ' + arg); config[key] = args[++i]; continue; }
    if (!actionSet && ['install', 'check', 'start', 'stop', 'restart', 'status', 'uninstall', 'logs'].includes(arg)) { config.action = arg; actionSet = true; continue; }
    throw Error('Unknown argument: ' + arg + '. Use --help.');
  }
  config.appPath = path.resolve(config.appPath);
  return config;
}
function escapeXml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function buildXml(config) {
  const x = escapeXml;
  return `<?xml version="1.0" encoding="UTF-8"?>
<service>
  <id>${SERVICE}</id>
  <name>WH Stock Web (5555)</name>
  <description>Warehouse stock application on port 5555.</description>
  <executable>${x(config.nodePath)}</executable>
  <arguments>&quot;${x(path.join(config.appPath, 'src', 'server.js'))}&quot;</arguments>
  <workingdirectory>${x(config.appPath)}</workingdirectory>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="5555" />
  <env name="APP_HOST" value="${x(config.host)}" />
  <env name="DB_SERVER" value="${x(config.dbServer)}" />
  <env name="DB_DATABASE" value="dbMaster" />
  <startmode>Automatic</startmode>
  <delayedAutoStart />
  ${config.sqlService ? '<depend>' + x(config.sqlService) + '</depend>' : ''}
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <stoptimeout>30 sec</stoptimeout>
  <logpath>${x(config.logs)}</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
</service>
`;
}
function powershell(script, data = {}) {
  // Values are serialized as data, never interpolated into PowerShell source.
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const code = "$ErrorActionPreference='Stop'; $p=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "')));\n" + script;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr?.trim() || 'PowerShell command failed.');
  return result.stdout.replace(/^\uFEFF/, '').trim();
}
function serviceStatus() {
  const output = powershell("$s=Get-Service -Name $p.name -ErrorAction SilentlyContinue; if($s){[pscustomobject]@{Name=$s.Name;Status=$s.Status.ToString();StartType=$s.StartType.ToString()}|ConvertTo-Json -Compress}else{'null'}", { name: SERVICE });
  return JSON.parse(output);
}
function requireAdmin() {
  const admin = powershell("$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id);$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
  if (admin !== 'True') throw Error('Open Command Prompt or PowerShell using Run as administrator, then run this command again.');
}
function runWrapper(executable, action) {
  if (!fs.existsSync(executable)) throw Error('Missing service wrapper: ' + executable);
  const result = spawnSync(executable, [action], { encoding: 'utf8', windowsHide: true, timeout: 90000 });
  if (result.stdout?.trim()) console.log(result.stdout.trim());
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr?.trim() || ('WinSW ' + action + ' failed. Inspect service logs.'));
}
async function assertPortFree() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', () => reject(Error('Port 5555 is occupied. Stop the process using it before installing.'))); server.listen(5555, '0.0.0.0', () => server.close(resolve)); });
}
function inspectApp(config) {
  for (const relative of ['src/server.js', '.env', 'node_modules/express/package.json', 'node_modules/mssql/package.json', 'node_modules/dotenv/package.json']) {
    if (!fs.existsSync(path.join(config.appPath, relative))) throw Error('Missing ' + relative + '. Copy .env and run npm ci in ' + config.appPath);
  }
  const dotenv = require(path.join(config.appPath, 'node_modules', 'dotenv'));
  const env = dotenv.parse(fs.readFileSync(path.join(config.appPath, '.env')));
  for (const key of ['DB_USER', 'DB_PASSWORD', 'JWT_SECRET']) if (!env[key]?.trim()) throw Error('Set ' + key + ' in .env first.');
  const syntax = spawnSync(process.execPath, ['--check', path.join(config.appPath, 'src', 'server.js')], { encoding: 'utf8', windowsHide: true });
  if (syntax.status !== 0) throw Error('src/server.js has syntax errors.');
  return env;
}
async function checkDatabases(config, env) {
  const sql = require(path.join(config.appPath, 'node_modules', 'mssql'));
  const pool = new sql.ConnectionPool({ server: config.dbServer, port: Number(env.DB_PORT) || 1433, database: 'dbMaster', user: env.DB_USER, password: env.DB_PASSWORD, connectionTimeout: 10000, requestTimeout: 10000, options: { encrypt: env.DB_ENCRYPT === 'true', trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE !== 'false' } });
  try {
    await pool.connect();
    await pool.request().query('SELECT TOP (0) ProductId FROM dbMaster.dbo.tblProducts; SELECT TOP (0) StockId FROM dbWMS.dbo.tblStock; SELECT TOP (0) TransId FROM dbWMS.dbo.tblStockTransactions;');
    console.log('Database connection: dbMaster and dbWMS OK (read-only check).');
  } catch (error) {
    // Do not print database configuration or driver errors containing credentials.
    throw Error('Database check failed (' + (error.code || 'UNKNOWN') + '). Check DB_SERVER/DB_PORT, the copied .env credentials, both restored databases and login permissions.');
  } finally { await pool.close(); }
}
function findSqlService(config) {
  const localNames = [os.hostname(), 'localhost', '.', '127.0.0.1'].map(s => s.toLowerCase());
  const serverHost = config.dbServer.split('\\')[0].toLowerCase();
  if (!localNames.includes(serverHost) && !config.sqlService) return '';
  if (config.sqlService) {
    powershell('Get-Service -Name $p.name | Out-Null', { name: config.sqlService });
    return config.sqlService;
  }
  const names = JSON.parse(powershell("$names=@(Get-Service | Where-Object {$_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*'} | Select-Object -ExpandProperty Name);ConvertTo-Json -InputObject $names -Compress"));
  if (names.length !== 1) throw Error('Specify the local SQL service explicitly: --sql-service MSSQLSERVER or --sql-service "MSSQL$SQLEXPRESS".');
  return names[0];
}
async function downloadWrapper(destination) {
  if (fs.existsSync(destination)) return;
  console.log('Downloading WinSW 2.12.0 from the official GitHub release...');
  const response = await fetch(WINSW_URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error('WinSW download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw Error('Downloaded WinSW file is not a Windows executable.');
  const temporary = destination + '.download';
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, destination);
  console.log('Downloaded SHA256: ' + crypto.createHash('sha256').update(bytes).digest('hex'));
}
function grantServiceAccess(config) {
  for (const [target, grant] of [[config.appPath, '*S-1-5-19:(OI)(CI)RX'], [config.serviceDir, '*S-1-5-19:(OI)(CI)RX'], [config.logs, '*S-1-5-19:(OI)(CI)M']]) {
    const result = spawnSync('icacls.exe', [target, '/grant', grant, '/T', '/Q'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (result.error || result.status !== 0) throw Error('Cannot grant LocalService access to ' + target);
  }
}
async function waitReady(config) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5555/index.html', { signal: AbortSignal.timeout(2000) });
      if (response.ok && serviceStatus()?.Status === 'Running') {
        console.log('Service running: http://' + config.host + ':5555');
        console.log('Logs: ' + config.logs);
        return;
      }
    } catch (_) { }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('Service did not become ready. Run node createport/install.js status and inspect ' + config.logs);
}
async function main(args = process.argv.slice(2)) {
  const config = parseArgs(args);
  if (config.action === 'help') {
    console.log(`Usage: node createport/install.js [install|check|start|stop|restart|status|uninstall|logs] [options]
  --dry-run                 Inspect configuration without installation, network access or changes
  --offline                 Skip the SQL connection check (check action only)
  --app PATH                Project directory (default: parent of createport)
  --host NAME               Service target host (default: DESKTOP-RT67GE0)
  --db-server NAME          SQL server (default: DESKTOP-RT67GE0)
  --sql-service NAME        Local SQL service dependency, e.g. MSSQLSERVER

Default action: install. Administrative rights are required for service changes.
Service: WHStock5555. Web: port 5555. Credentials are loaded from the existing .env.
Runtime files/logs stay in C:\\ProgramData\\WHStock5555, outside the Git repository.`);
    return;
  }
  if (process.platform !== 'win32') throw Error('This installer is for Windows only.');
  if (Number(process.versions.node.split('.')[0]) < 18) throw Error('Install Node.js 18 or later.');
  config.nodePath = process.execPath;
  config.serviceDir = path.join(process.env.ProgramData || 'C:\\ProgramData', SERVICE);
  config.logs = path.join(config.serviceDir, 'logs');
  const wrapper = path.join(config.serviceDir, SERVICE + '.exe');
  const xmlPath = path.join(config.serviceDir, SERVICE + '.xml');
  if (config.dryRun) {
    inspectApp(config);
    const xml = buildXml(config);
    if (/DB_PASSWORD|JWT_SECRET|DB_USER/.test(xml)) throw Error('Unexpected credentials in service XML.');
    console.log('DRY RUN: no files, firewall rules or services changed.');
    console.log(JSON.stringify({ app: config.appPath, node: config.nodePath, service: SERVICE, host: config.host, port: 5555, dbServer: config.dbServer, database: 'dbMaster', sqlService: config.sqlService || 'auto-detect at installation', credentials: 'existing .env (not copied)', logs: config.logs }, null, 2));
    return;
  }
  if (config.action === 'logs') { console.log(config.logs); return; }
  if (config.action === 'status') { console.log(JSON.stringify(serviceStatus() || { Name: SERVICE, Status: 'Not installed' }, null, 2)); console.log('Logs: ' + config.logs); return; }
  if (config.action === 'check') {
    const env = inspectApp(config);
    console.log('Application and environment files: OK. Target: ' + config.host + ':5555');
    if (!config.offline) await checkDatabases(config, env);
    return;
  }
  if (config.offline) throw Error('--offline is only supported with check. Installation always checks the databases.');
  if (os.hostname().toLowerCase() !== config.host.toLowerCase()) throw Error('Run this command on ' + config.host + '. Current host: ' + os.hostname());
  requireAdmin();
  const existing = serviceStatus();
  if (config.action === 'uninstall') {
    if (existing) { if (existing.Status !== 'Stopped') runWrapper(wrapper, 'stop'); runWrapper(wrapper, 'uninstall'); }
    powershell('Get-NetFirewallRule -Name $p.rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule', { rule: RULE });
    console.log('Service removed. Project, .env, databases, wrapper and logs retained.');
    return;
  }
  if (['start', 'stop', 'restart'].includes(config.action)) {
    if (!existing) throw Error('Service is not installed. Run install first.');
    runWrapper(wrapper, config.action);
    if (config.action !== 'stop') await waitReady(config);
    return;
  }
  if (existing) throw Error('Service ' + SERVICE + ' already exists. Use restart, or uninstall before reinstalling with new settings. Existing configuration was not overwritten.');
  if (process.arch !== 'x64') throw Error('Use a machine-wide 64-bit Node.js installation.');
  const userRoot = process.env.USERPROFILE;
  if (userRoot && config.nodePath.toLowerCase().startsWith(path.resolve(userRoot).toLowerCase() + path.sep)) throw Error('Install Node.js for all users, e.g. C:\\Program Files\\nodejs, so LocalService can execute it.');
  const env = inspectApp(config);
  await assertPortFree();
  await checkDatabases(config, env);
  config.sqlService = findSqlService(config);
  fs.mkdirSync(config.logs, { recursive: true });
  await downloadWrapper(wrapper);
  fs.writeFileSync(xmlPath, buildXml(config), 'utf8');
  grantServiceAccess(config);
  runWrapper(wrapper, 'install');
  powershell("if(-not(Get-NetFirewallRule -Name $p.rule -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name $p.rule -DisplayName 'WH Stock 5555 (Private LAN)' -Direction Inbound -Protocol TCP -LocalPort 5555 -RemoteAddress LocalSubnet -Profile Private -Action Allow | Out-Null}", { rule: RULE });
  runWrapper(wrapper, 'start');
  await waitReady(config);
}
module.exports = { parseArgs, escapeXml, buildXml, main };
if (require.main === module) main().catch(error => { console.error('ERROR: ' + error.message); process.exitCode = 1; });
