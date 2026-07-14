const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || 'release-assets');
const outputPath = path.join(root, 'SHA256SUMS.txt');

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (filePath === outputPath) return [];
    if (entry.isDirectory()) return collectFiles(filePath);
    return entry.isFile() ? [filePath] : [];
  });
}

if (!fs.existsSync(root)) {
  throw new Error(`Checksum directory does not exist: ${root}`);
}

const lines = collectFiles(root)
  .sort()
  .map((filePath) => {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    return `${digest}  ${relativePath}`;
  });

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Generated ${outputPath} for ${lines.length} files.`);
