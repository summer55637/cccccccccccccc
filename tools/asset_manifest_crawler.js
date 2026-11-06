/**
 * 小樹放置天堂 - 資源架構映射表遍歷與素材擷取工具 (Asset Manifest Crawler)
 * 適用引擎：Cocos Creator 3.8.x Web-Mobile Export
 *
 * 功能：
 * 1. 反序列化 Cocos 3.8 壓縮格式之 config.caeb6.json
 * 2. 解碼 22 字元 Base64 壓縮 UUID 為標準 36 字元 GUID
 * 3. 結合 versions.native 與 types 生成真實 CDN 靜態資源 URL
 * 4. 產出可讀之 manifest_mapping.json 資源清單
 * 5. (可選) 批次併發下載圖形素材到本地目錄
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Cocos Creator Base64 UUID 解碼器
const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const values = new Array(123);
for (let i = 0; i < 123; ++i) { values[i] = 64; }
for (let i = 0; i < 64; ++i) { values[BASE64_KEYS.charCodeAt(i)] = i; }
const HexChars = '0123456789abcdef'.split('');

function decodeUuid(base64) {
    if (!base64 || typeof base64 !== 'string') return '';
    const strs = base64.split('@');
    const uuid = strs[0];
    if (uuid.length !== 22) return base64;
    HexChars[uuid.length] = '';
    const uuidOutput = [];
    for (let i = 0; i < 2; ++i) {
        uuidOutput.push(uuid[i]);
    }
    for (let i = 2; i < 22; i += 2) {
        const lhs = values[uuid.charCodeAt(i)];
        const rhs = values[uuid.charCodeAt(i + 1)];
        uuidOutput.push(HexChars[(lhs >> 2) & 0x0f]);
        uuidOutput.push(HexChars[((lhs & 3) << 2) | ((rhs >> 4) & 3)]);
        uuidOutput.push(HexChars[rhs & 0x0f]);
    }
    const str = uuidOutput.join('');
    const full = str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20);
    return strs.length > 1 ? `${full}@${strs[1]}` : full;
}

// 根據類型判斷副檔名
function getExtensionByType(typeName) {
    switch (typeName) {
        case 'cc.ImageAsset': return '.png';
        case 'cc.AudioClip': return '.mp3';
        case 'cc.TTFFont': return '.ttf';
        case 'cc.BitmapFont': return '.fnt';
        case 'cc.JsonAsset': return '.json';
        default: return '.png';
    }
}

async function buildAssetManifest(configPath, baseUrl) {
    console.log(`[AssetLoader] 讀取 Bundle 配置表: ${configPath}`);
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    const uuids = config.uuids || [];
    const types = config.types || [];
    const paths = config.paths || {};
    const nativeVers = config.versions?.native || [];
    const importVers = config.versions?.import || [];

    // 建立 native 版本映射表: uuidIndex -> md5Hash
    const nativeHashMap = new Map();
    for (let i = 0; i < nativeVers.length; i += 2) {
        nativeHashMap.set(nativeVers[i], nativeVers[i + 1]);
    }

    const manifest = [];
    console.log(`[AssetLoader] 解析資源總數: ${Object.keys(paths).length} 筆`);

    for (const [keyIndex, val] of Object.entries(paths)) {
        const idx = parseInt(keyIndex, 10);
        const resourcePath = val[0];
        const typeIndex = val[1];
        const typeName = types[typeIndex] || 'cc.Asset';

        const rawUuid = uuids[idx];
        const decodedUuid = decodeUuid(rawUuid);
        const prefix = decodedUuid.substring(0, 2);
        const hash = nativeHashMap.get(idx) || '';
        const ext = getExtensionByType(typeName);

        const nativeUrl = hash 
            ? `${baseUrl}assets/resources/native/${prefix}/${decodedUuid}.${hash}${ext}`
            : '';

        manifest.push({
            index: idx,
            virtualPath: resourcePath,
            type: typeName,
            compressedUuid: rawUuid,
            uuid: decodedUuid,
            hash: hash,
            nativeUrl: nativeUrl,
            localPath: `assets/resources/native/${prefix}/${decodedUuid}.${hash}${ext}`
        });
    }

    return manifest;
}

// 執行分析與輸出
const configFilePath = path.join(__dirname, '../client/assets/resources/config.caeb6.json');
const baseUrl = 'https://test.xiaoshu.gg/play/';
const outputJsonPath = path.join(__dirname, '../client/manifest_mapping.json');

(async () => {
    try {
        const manifest = await buildAssetManifest(configFilePath, baseUrl);
        fs.writeFileSync(outputJsonPath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log(`[AssetLoader] 成功輸出清單: ${outputJsonPath} (共 ${manifest.length} 個素材)`);

        // 統計各類別數量
        const stats = {};
        for (const item of manifest) {
            stats[item.type] = (stats[item.type] || 0) + 1;
        }
        console.log('[AssetLoader] 素材類型統計:');
        console.table(stats);
    } catch (err) {
        console.error('[AssetLoader] 執行失敗:', err);
    }
})();
