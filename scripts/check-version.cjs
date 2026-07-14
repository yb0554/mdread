const fs = require('node:fs');

const packageVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const tauriVersion = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = { 'package.json': packageVersion, 'src-tauri/tauri.conf.json': tauriVersion, 'src-tauri/Cargo.toml': cargoVersion };
if (!cargoVersion || new Set(Object.values(versions)).size !== 1) {
  console.error(`Version mismatch: ${Object.entries(versions).map(([file, version]) => `${file}=${version ?? 'missing'}`).join(', ')}`);
  process.exit(1);
}
console.log(`Versions match: ${packageVersion}`);
