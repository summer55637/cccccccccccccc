const protobuf = require('protobufjs');

const root = protobuf.loadSync('C:/Users/user/Desktop/小樹/tools/goline.proto');

function dumpType(typeName) {
  try {
    const t = root.lookupType('goline.' + typeName);
    console.log(`\n=== ${typeName} ===`);
    for (let [name, field] of Object.entries(t.fields)) {
      console.log(`  ${field.id}: ${name} -> ${field.type}${field.repeated ? '[]' : ''}`);
    }
  } catch(e) {
    console.log(`\n=== ${typeName} NOT FOUND ===`);
  }
}

['StateFrame'].forEach(dumpType);
