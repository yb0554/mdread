#!/usr/bin/env node
/** Build an E2E-only Tauri binary without leaving test permissions in releases. */
const { copyFileSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'e2e', 'wdio-capability.json');
const destination = path.join(root, 'src-tauri', 'capabilities', 'wdio-e2e.json');
const configSource = path.join(root, 'src-tauri', 'tauri.e2e.conf.json');
const configDestination = path.join(root, 'src-tauri', 'tauri.e2e.generated.conf.json');
const command = process.execPath;
const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

copyFileSync(source, destination);
const config = JSON.parse(readFileSync(configSource, 'utf8'));
// Each run uses a distinct app identity. This prevents a stale single-instance
// test process or its WebView storage from hijacking a later E2E invocation.
config.identifier = `com.mdread.reader.e2e.${process.pid}`;
writeFileSync(configDestination, `${JSON.stringify(config, null, 2)}\n`);
try {
  const result = spawnSync(command, [
    tauriCli, 'build', '--debug', '--no-bundle', '--features', 'e2e',
    '--config', 'src-tauri/tauri.e2e.generated.conf.json',
  ], {
    cwd: root,
    env: { ...process.env, VITE_E2E: 'true' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(destination, { force: true });
  rmSync(configDestination, { force: true });
}
