/**
 * 《小樹放置天堂》完整前端架構與數據配置表 TypeScript 型別定義
 * Base URL: https://test.xiaoshu.gg/play/
 * Engine: Cocos Creator 3.8.8 + GoLine Protocol Engine
 */

export namespace XiaoShu {
    // ==========================================
    // 1. 核心靜態資料庫根結構 (GameData Root)
    // ==========================================
    export interface GameDatabase {
        items: Record<string, ItemConfig>;
        mobs: Record<string, MonsterConfig>;
        skills: Record<string, SkillConfig>;
        dolls: DollConfig[];
        dollCfg: DollSystemConfig;
        maps: Record<string, MapConfig>;
        mapCategories: Record<string, MapCategoryConfig>;
        towns: Record<string, TownConfig>;
        worldBosses: Record<string, WorldBossConfig>;
        sets: Record<string, EquipmentSetConfig>;
        castle: Record<string, any>;
    }

    // ==========================================
    // 2. 裝備與道具配置表 (Item Schema)
    // ==========================================
    export type ItemType = 'wpn' | 'arm' | 'acc' | 'etc' | 'scroll' | 'potion' | 'book';
    export type ItemSlot = 
        | 'wpn' | 'helm' | 'armor' | 'cloak' | 'tshirt' 
        | 'shield' | 'gloves' | 'boots' | 'amulet' 
        | 'ring' | 'ring1' | 'ring2' | 'belt';
    export type ClassRequirement = 'all' | 'knight' | 'mage' | 'elf' | 'dark' | 'prince';

    export interface ItemConfig {
        id: string;                 // 道具唯一代碼 (e.g. "wpn_1", "acc_116")
        n: string;                  // 顯示名稱 (e.g. "匕首", "傳送戒指")
        type: ItemType;             // 主類別
        slot?: ItemSlot;            // 裝備欄位
        wcat?: string;              // 武器子分類 (e.g. "單手劍", "雙手劍", "弓", "魔杖", "匕首", "鋼爪", "雙刀")
        req?: ClassRequirement;     // 職業配戴要求
        p?: number;                 // 商店基本買價/賣價金幣 (Price)
        safe?: number;              // 安定值 (武器通常為 6, 防具為 4, 黑色米索莉/骨頭為 0)
        
        // 武器專屬數值
        dmgS?: number;              // 對小型怪物基礎傷害骰
        dmgL?: number;              // 對大型怪物基礎傷害骰
        hit?: number;               // 額外命中率 (Hit Bonus)
        spd?: number;               // 攻擊速度乘數 (預設 1.0 ~ 1.2)
        twoHanded?: boolean;        // 是否為雙手武器

        // 防具專屬數值
        ac?: number;                // 物理防禦值 (負值計算，如 -2 代表 AC-2)
        mDef?: number;              // 魔法防禦值 (MR)
        
        // 詞條與特殊效果
        fx?: string[];              // 詞綴描述陣列 (e.g. ["力量 +2", "近距離傷害 +3", "每強化 +1:魔防 +1"])
        d?: string;                 // 詳細道具說明 (Description)
        gachaWeight?: number;       // 抽卡/掉落權重
        glow?: string;              // 裝備發光等級特效 ('none' | 'white' | 'green' | 'blue' | 'red' | 'purple')
    }

    // ==========================================
    // 3. 怪物與首領配置表 (Monster Schema)
    // ==========================================
    export interface DropItem {
        id: string;                 // 掉落道具 ID
        chance: number;             // 掉落機率 (0.0001 ~ 1.0)
        min?: number;               // 最小掉落數量
        max?: number;               // 最大掉落數量
    }

    export interface MonsterConfig {
        id: string;                 // 怪物 ID (e.g. "bugbear", "ant_queen")
        n: string;                  // 怪物名稱 (e.g. "食人妖精", "螞蟻皇后")
        lv: number;                 // 等級 (決定命中減免 mobEvade = lv * 0.85)
        hp: number;                 // 基礎 HP
        maxHp?: number;             // 最大 HP
        mp?: number;                // 基礎 MP (影響瑪那吸魔上限)
        ac?: number;                // 物理防禦 AC
        exp: number;                // 擊殺獎勵基礎經驗值
        align?: number;             // 正義值
        boss?: boolean;             // 是否為世界王/頭目
        arrowDr?: number;           // 遠程箭矢減免 (Arrow DR)
        drops?: DropItem[];         // 怪物掉落表
        atkSpeed?: number;          // 怪物攻擊頻率 (毫秒)
    }

    // ==========================================
    // 4. 技能與法術配置表 (Skill Schema)
    // ==========================================
    export interface SkillConfig {
        id: string;                 // 技能 ID (e.g. "sk_elf_triple", "sk_shock_stun")
        n: string;                  // 技能名稱 (e.g. "三重矢", "衝擊之暈")
        cls: ClassRequirement;     // 專屬職業
        lv: number;                 // 學習等級要求
        mp: number;                 // 施法耗費 MP
        hp?: number;                // 施法耗費 HP
        cd: number;                 // 冷卻時間 (毫秒)
        dur?: number;               // BUFF 持續秒數
        dmgDice?: number;           // 傷害骰數
        ele?: 'fire' | 'water' | 'earth' | 'wind' | 'neutral'; // 屬性分類
        d?: string;                 // 技能敘述
    }

    // ==========================================
    // 5. 變身與魔法娃娃 (Morph & Doll Schema)
    // ==========================================
    export interface DollConfig {
        id: string;                 // 娃娃代碼 (e.g. "doll_001")
        n: string;                  // 娃娃名稱 (e.g. "小巴風特")
        g: 1 | 2 | 3 | 4 | 5;       // 品階 (1:普通, 2:高級, 3:稀有, 4:英雄, 5:傳說)
        fx?: string[];              // 附帶效果 (e.g. ["經驗值 +10%", "負重 +500", "近戰傷害 +2"])
        expPct?: number;            // 經驗加乘百分比
        weight?: number;            // 負重上限增加
    }

    export interface DollSystemConfig {
        minLv: number;
        freePerDay: number;
        resetHour: number;
        goldPrices: number[];
        diaPrices: number[];
    }

    // ==========================================
    // 6. 地圖與傳送獵場配置表 (Map Schema)
    // ==========================================
    export interface MapConfig {
        id: string;                 // 地圖 ID (e.g. "gludio_dungeon_1f")
        n: string;                  // 地圖名稱 (e.g. "古魯丁地監 1樓")
        cat: 'village' | 'wild' | 'dungeon' | 'special';
        minLv: number;              // 建議進入等級
        maxLv?: number;             // 上限等級
        tpCost?: number;            // 傳送金幣消耗
        mobs?: string[];            // 該獵場刷怪 ID 列表
        boss?: string;              // 該地圖出沒之世界王 ID
        area?: [number, number, number, number]; // 地圖座標範圍 [minX, minY, maxX, maxY]
    }

    export interface MapCategoryConfig {
        n: string;
        order: number;
    }

    export interface TownConfig {
        id: string;
        n: string;
        map: string;
        gx: number;
        gy: number;
    }

    export interface WorldBossConfig {
        id: string;
        mobId: string;
        mapId: string;
        spawnHours: number[];
        broadcast: boolean;
    }

    export interface EquipmentSetConfig {
        id: string;
        n: string;
        items: string[];
        bonus: string[];
    }

    // ==========================================
    // 7. NPC 與對話/製作配方 (NPC & Crafting Schema)
    // ==========================================
    export interface NpcConfig {
        id: string;
        n: string;
        title: string;
        type: 'shop' | 'wh' | 'craft' | 'teleport' | 'talk';
        d: string;
        pack: string;
        map: string;
        gx: number;
        gy: number;
        dir: number;
        dist: number;
    }

    export interface CraftRecipe {
        resultId: string;
        resultCount: number;
        costGold: number;
        materials: Array<{ itemId: string; count: number }>;
        successRate: number;        // 1.0 代表 100%
    }

    // ==========================================
    // 8. 強化計算預覽結構 (Enhance Preview Schema)
    // ==========================================
    export interface EnhancePreview {
        type: 'wpn' | 'arm';        // 武器或防具
        safe: number;               // 安定值 (0, 4, 6)
        en: number;                 // 當前強化等級
        nextEn: number;             // 成功後強化等級 (祝卷可能 +2 ~ +3)
        jump: number;               // 祝卷跳級階數 (1 ~ 3)
        succ: number;               // 成功機率 (0 ~ 100%)
        stay: number;               // 維持不變機率 (0 ~ 100%)
        destroy: number;            // 爆裝消失機率 (0 ~ 100%)
        cur: {
            dmgS?: number;
            dmgL?: number;
            dmg?: number;
            hit?: number;
            ac?: number;
        };
        next: {
            dmgS?: number;
            dmgL?: number;
            dmg?: number;
            hit?: number;
            ac?: number;
        };
    }

    // ==========================================
    // 9. 即時連線封包格式 (WebSocket Protocol)
    // ==========================================
    export interface GolinePacket<T = any> {
        action: string;             // 動作名稱 (e.g. "auth", "selectChar", "attack", "useItem", "move")
        nonce?: string;             // 一次性防重放憑證
        token?: string;             // JWT 登入 Session
        payload?: T;                // 資料主體
        timestamp: number;          // 發送時間戳
    }
}
