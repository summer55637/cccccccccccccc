const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('C:/Users/user/Desktop/小樹/client/assets-packs/packs-manifest.json', 'utf8'));
console.log('Total pack groups:', manifest.groups.length);
let totalBytes = 0;
for (let g of manifest.groups) {
  console.log(`  group: ${g.group}, file: ${g.file}, size: ${(g.size / 1024 / 1024).toFixed(2)} MB`);
  totalBytes += g.size;
}
console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
