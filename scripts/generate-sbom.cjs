const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const outputDirectory = path.join(root, 'release-assets');
fs.mkdirSync(outputDirectory, { recursive: true });

function component(name, version, ecosystem, packagePath, license) {
  const purlName = ecosystem === 'npm' ? encodeURIComponent(name).replace(/%40/g, '@') : name;
  const item = {
    type: 'library',
    name,
    version,
    purl: `pkg:${ecosystem}/${purlName}@${version}`,
  };
  if (packagePath) item.properties = [{ name: 'mdread:source-path', value: packagePath }];
  if (license) item.licenses = [{ license: { name: license } }];
  return item;
}

function packageNameFromLockPath(lockPath, entry) {
  if (entry.name) return entry.name;
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index >= 0 ? lockPath.slice(index + marker.length) : lockPath;
}

const components = [];
for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
  if (!lockPath || !lockPath.includes('node_modules/') || entry.dev || !entry.version) continue;
  components.push(component(
    packageNameFromLockPath(lockPath, entry),
    entry.version,
    'npm',
    lockPath,
    entry.license,
  ));
}

const cargoMetadata = JSON.parse(execFileSync(
  'cargo',
  ['metadata', '--locked', '--format-version=1', '--manifest-path', 'src-tauri/Cargo.toml'],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
for (const pkg of cargoMetadata.packages || []) {
  if (pkg.name === 'mdread') continue;
  components.push(component(pkg.name, pkg.version, 'cargo', pkg.manifest_path, pkg.license));
}

const uniqueComponents = [...new Map(
  components
    .sort((left, right) => left.purl.localeCompare(right.purl))
    .map((item) => [item.purl, item]),
).values()];

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'mdread', name: 'scripts/generate-sbom.cjs' }],
    component: {
      type: 'application',
      name: packageJson.name,
      version: packageJson.version,
      purl: `pkg:generic/${packageJson.name}@${packageJson.version}`,
    },
  },
  components: uniqueComponents,
};

const outputPath = path.join(outputDirectory, `mdread-${packageJson.version}.cdx.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Generated ${outputPath} with ${uniqueComponents.length} dependency components.`);
