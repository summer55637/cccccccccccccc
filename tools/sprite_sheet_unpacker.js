/**
 * 小樹放置天堂 - 圖集/SpriteFrame 還原與 TexturePacker 格式轉譯器 (SpriteSheet Unpacker)
 *
 * 功能：
 * 1. 深度解析 Cocos 3.8 聚合包 (08c9e34a0.145aa.json) 內之 cc.SpriteFrame 物件
 * 2. 提取子圖裁切矩形 (rect)、偏移量 (offset)、原始尺寸 (originalSize)、UV 座標 (nuv)
 * 3. 關聯對應之母圖 (cc.ImageAsset / cc.Texture2D)
 * 4. 輸出工業標準之 TexturePacker JSON Hash / Array 格式，供 Pixi.js / Phaser / Canvas 引擎無縫載入
 */

const fs = require('fs');
const path = require('path');

function parseCocosSpriteFrames(packPath, manifestPath) {
    console.log(`[SpriteUnpacker] 讀取 Import 聚合包: ${packPath}`);
    const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];

    // 建立 UUID -> Manifest 查找表
    const uuidToManifest = new Map();
    for (const item of manifest) {
        uuidToManifest.set(item.compressedUuid, item);
        uuidToManifest.set(item.uuid, item);
    }

    const spriteFrames = [];
    const texturePackerFrames = {};

    const items = pack[5] || [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        if (!Array.isArray(entry) || !entry[0] || !Array.isArray(entry[0])) continue;

        const obj = entry[0][0];
        if (!obj || typeof obj !== 'object' || !obj.rect || !obj.originalSize) continue;

        const name = obj.name || `frame_${i}`;
        const rect = obj.rect;
        const offset = obj.offset || { x: 0, y: 0 };
        const orig = obj.originalSize;
        const isRotated = !!obj.rotated;
        const pivot = obj.pivot || { x: 0.5, y: 0.5 };
        const capInsets = obj.capInsets || [0, 0, 0, 0];

        // 轉譯為 TexturePacker 標準 JSON Hash 結構
        texturePackerFrames[name] = {
            frame: {
                x: rect.x,
                y: rect.y,
                w: rect.width,
                h: rect.height
            },
            rotated: isRotated,
            trimmed: rect.width !== orig.width || rect.height !== orig.height,
            spriteSourceSize: {
                x: offset.x,
                y: offset.y,
                w: rect.width,
                h: rect.height
            },
            sourceSize: {
                w: orig.width,
                h: orig.height
            },
            pivot: {
                x: pivot.x,
                y: pivot.y
            },
            capInsets: {
                top: capInsets[0],
                bottom: capInsets[1],
                left: capInsets[2],
                right: capInsets[3]
            }
        };

        spriteFrames.push({
            name,
            rect,
            offset,
            originalSize: orig,
            rotated: isRotated,
            pivot,
            nuv: obj.vertices?.nuv || []
        });
    }

    const tpOutput = {
        frames: texturePackerFrames,
        meta: {
            app: "Antigravity Cocos3.x Unpacker",
            version: "1.0",
            image: "atlas.png",
            format: "RGBA8888",
            size: { w: 2048, h: 2048 },
            scale: "1"
        }
    };

    return { spriteFrames, tpOutput };
}

// 執行轉換
const packFilePath = path.join(__dirname, '../client/assets/resources/import/08/08c9e34a0.145aa.json');
const manifestFilePath = path.join(__dirname, '../client/manifest_mapping.json');
const outTpJsonPath = path.join(__dirname, '../client/texture_packer_atlas.json');

try {
    const { spriteFrames, tpOutput } = parseCocosSpriteFrames(packFilePath, manifestFilePath);
    fs.writeFileSync(outTpJsonPath, JSON.stringify(tpOutput, null, 2), 'utf8');
    console.log(`[SpriteUnpacker] 成功提取 ${spriteFrames.length} 個 SpriteFrame 子圖`);
    console.log(`[SpriteUnpacker] 已輸出標準 TexturePacker 格式: ${outTpJsonPath}`);

    // 列印前 5 個範例
    console.log('[SpriteUnpacker] 前 5 個子圖座標範例:');
    console.log(spriteFrames.slice(0, 5));
} catch (err) {
    console.error('[SpriteUnpacker] 解析失敗:', err);
}
