const fs = require('fs');

const d = JSON.parse(fs.readFileSync('C:/Users/user/Desktop/小樹/client/decoded_strings_main.json', 'utf8'));
for (let [k, v] of Object.entries(d)) {
  if (typeof v === 'string' && (v.includes('資源包') || v.includes('packs-manifest') || v.includes('lin_map0'))) {
    console.log(k, '=>', v);
  }
}
