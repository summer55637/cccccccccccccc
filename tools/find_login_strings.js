const fs = require('fs');

const d = JSON.parse(fs.readFileSync('C:/Users/user/Desktop/小樹/client/decoded_strings_main.json', 'utf8'));
for (let [k, v] of Object.entries(d)) {
  if (typeof v === 'string' && (v.includes('註冊') || v.includes('登入') || v.includes('帳號') || v.includes('密碼') || v.includes('創角'))) {
    console.log(k, '=>', v);
  }
}
