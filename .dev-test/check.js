'use strict';
if (typeof THREE === 'undefined') {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-size:16px;">缺少 three.min.js，请把它和本文件放在同一文件夹。</div>';
  throw new Error('three.min.js missing');
}

/* =====================================================
 * 一、配置（想调手感，改这里就行）
 * ===================================================== */
const WX = 256, WZ = 256, WY = 48;   // 世界尺寸：256×256 格（四周边缘沉入海中，看不到空气墙），高 48 格
const CS = 16;                        // 每个区块 16×16 格
/* ==== 存档引导（必须在 SEED 定值前读：种子决定云图/地形/村庄，读晚了世界就对不上） ====
 * 目的：刷新/重开不丢世界。做法：种子 + 「与生成结果的差异」+ 玩家全状态 存 localStorage。
 * 边界：存档约几十 KB~2MB（雕刻按位打包）；失败表现：try/catch 吃掉，游戏照常，只提示一次。 */
const SAVE_KEY = 'bx_save_v1', SAVE_V = 1;
function readSave() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    return (o && o.v === SAVE_V && Number.isInteger(o.seed)) ? o : null;   // 版本对不上当没有（宁丢档不脏档）
  } catch (e) { return null; }
}
const bootSave = readSave();                    // 开机读一次，只读不改
let SEED = bootSave ? bootSave.seed : ((Math.random() * 1e9) | 0);

/* ==== 昼夜节律 ====
 * DAY_LEN=840s（14 分钟一整天）：白天 462s / 黄昏 63s / 夜 273s / 黎明 42s。
 * rationale：两小时会话 ≈ 8.5 个昼夜——第一夜一定在 10 分钟内到达（教学窗口），终局「活过第五夜」约 70 分钟。
 * NIGHT_DROP=12°C：晴夜森林 14°C（无感）、雨夜 0°C（冷）、雪原夜 -18°C（致命）→ 睡前看天气是真实决策。
 * [PLACEHOLDER · 假设：14 分钟周期；验证：实机玩 3 个昼夜看疲劳点] */
const DAY_LEN = 840, NIGHT_DROP = 12;
const DAY_DUSK = 0.55, DAY_NIGHT = 0.625, DAY_DAWN = 0.95;   // tDay 相位分界（0..1）
let tDay = 0.30, dayCount = 1, nightFactor = 0;    // 从上午开始（≈13:12，给新手一个完整白天做准备）

const WALK_SLOW = 2.8, WALK = 4.3, SPRINT = 6.5;   // 慢走(W) / 快走(双击W) / 疾跑(Shift+W)
const GRAV = 24, JUMP = 5.1;          // 重力 / 起跳速度：约 50cm（正常人水平；1m 方块要靠贴墙攀爬上去）
const HALF = 0.3, PH = 1.75, EYE = 1.58; // 玩家半宽 0.6 / 身高 1.75m / 眼高（方块 1m：跳只有 50cm 上不去，1m 坎要贴墙攀爬）
const REACH = 6;                      // 挖放距离

// 方块类型：1草 2泥土 3石头 4原木 5树叶 6木板 7工具箱 9-14 造型与三维体
// hardness 硬度（越低越好挖）/ density 密度 t/m³（决定挖出多少 kg 材料）/ xp 经验 / tiles 贴图编号
// matName 挖出来的材料名；挖一个方块得到的材料质量 = 密度 kg（质量守恒）
// coh = 粘稠度范围 [最小, 最大]：方块间的连接力。同一材料的实际粘稠度在范围内逐块随机。
//   树叶几乎不粘树叶（靠树枝连着）；石头完全连接；泥土居中（挖空下方容易塌）
// fric = 摩擦力 0~1：攀爬速度、贴墙缓降、地面刹车全看它；<0.5 的面抓不住爬不了（树叶）
const BLOCKS = {
  1: { name: '草方块', matName: '草皮材料', color: 0x5fae38, hardness: 0.8,  density: 1.4, xp: 0.8, coh: [0.35, 0.5],  fric: 0.70, tiles: { top: 0, side: 1, bottom: 2 } },
  2: { name: '泥土',   matName: '泥土材料', color: 0x8a6238, hardness: 0.9,  density: 1.5, xp: 0.9, coh: [0.4, 0.55],  fric: 0.75, tiles: { all: 2 } },
  3: { name: '石头',   matName: '石料',     color: 0x8f9099, hardness: 3.0,  density: 2.5, xp: 3.0, coh: [0.85, 0.95], fric: 0.92, tiles: { all: 3 } },
  4: { name: '原木',   matName: '木料',     color: 0x6b4b2a, hardness: 2.0,  density: 0.7, xp: 2.0, coh: [0.55, 0.7],  fric: 0.85, tiles: { top: 5, side: 4, bottom: 5 } },
  5: { name: '树叶',   matName: '纤维材料', color: 0x3e8f42, hardness: 0.35, density: 0.3, xp: 0.35, coh: [0.02, 0.08], fric: 0.40, soft: true, tiles: { all: 6 } },
  6: { name: '木板',   matName: '木板',     color: 0x9c6b3d, hardness: 1.8,  density: 0.7, xp: 1.8, coh: [0.6, 0.75],  fric: 0.80, tiles: { all: 7 } },
  7: { name: '工具箱', matName: '工具箱',   color: 0x7d5327, hardness: 1.8,  density: 0.7, xp: 1.8, coh: [0.5, 0.6],   fric: 0.80, tiles: { all: 8 } },
  9: { name: '石台阶', matName: '石料',     color: 0x8f9099, hardness: 3.0,  density: 2.5, xp: 3.0, coh: [0.8, 0.9],  fric: 0.92, tiles: { all: 3 }, frag: 3 },
  10: { name: '木台阶', matName: '木料',    color: 0x9c6b3d, hardness: 1.8,  density: 0.7, xp: 1.8, coh: [0.55, 0.7], fric: 0.80, tiles: { all: 7 }, frag: 4 },
  11: { name: '石柱',   matName: '石料',    color: 0x8f9099, hardness: 3.0,  density: 2.5, xp: 3.0, coh: [0.8, 0.9],  fric: 0.92, tiles: { all: 3 }, frag: 3 },
  12: { name: '小石块', matName: '石料',    color: 0x8f9099, hardness: 3.0,  density: 2.5, xp: 3.0, coh: [0.8, 0.9],  fric: 0.92, tiles: { all: 3 }, frag: 3 },
  13: { name: '薄石板', matName: '石料',    color: 0x8f9099, hardness: 3.0,  density: 2.5, xp: 3.0, coh: [0.8, 0.9],  fric: 0.92, tiles: { all: 3 }, frag: 3 },
  14: { name: '木梁',   matName: '木料',    color: 0x9c6b3d, hardness: 1.8,  density: 0.7, xp: 1.8, coh: [0.55, 0.7], fric: 0.85, tiles: { all: 7 }, frag: 4 },
  // 15-20 新材料：沙/砂岩/雪/冰/煤矿/铁矿（沙漠与雪原生物群系 + 地下矿脉）
  15: { name: '沙子',   matName: '沙料',    color: 0xd9c07e, hardness: 0.5,  density: 1.6, xp: 0.5, coh: [0.28, 0.42], fric: 0.60, tiles: { all: 9 } },
  16: { name: '砂岩',   matName: '砂岩料',  color: 0xc9a86b, hardness: 2.2,  density: 2.3, xp: 2.2, coh: [0.8, 0.9],  fric: 0.88, tiles: { all: 10 } },
  17: { name: '雪块',   matName: '雪料',    color: 0xeef4f8, hardness: 0.3,  density: 0.4, xp: 0.3, coh: [0.22, 0.38], fric: 0.35, tiles: { all: 11 } },
  18: { name: '冰',     matName: '冰料',    color: 0xa8d8f0, hardness: 1.6,  density: 0.9, xp: 1.6, coh: [0.7, 0.85],  fric: 0.15, tiles: { all: 12 } },
  19: { name: '煤矿石', matName: '煤料',    color: 0x4a4a52, hardness: 3.5,  density: 2.6, xp: 5.0, coh: [0.85, 0.95], fric: 0.92, tiles: { all: 13 }, frag: 3 },
  20: { name: '铁矿石', matName: '铁料',    color: 0xb08d6e, hardness: 4.5,  density: 3.0, xp: 8.0, coh: [0.85, 0.95], fric: 0.92, tiles: { all: 14 }, frag: 3 },
  21: { name: '蘑菇',   matName: '蘑菇',    color: 0xc98a5a, hardness: 0.25, density: 0.3, xp: 0.2, coh: [0.1, 0.2],  fric: 0.45, tiles: { all: 15 }, frag: 4, food: 'mushroom' },
  // 22 火把 / 23 营火：夜里的光和热（煤的去处）。noCollide=可穿行不挡路；放置只认顶面（插地上，不悬空）
  // rationale density：一把火把 0.2kg（≈小木棍+布头），撞碎按质量散回木料——质量守恒不破例
  22: { name: '火把', matName: '木料', color: 0xffc95e, hardness: 0.4, density: 0.2, xp: 0.3, coh: [0.1, 0.2], fric: 0.6, tiles: { all: 16 }, frag: 4, noCollide: true },
  23: { name: '营火', matName: '木料', color: 0xff9a3c, hardness: 0.5, density: 0.4, xp: 0.4, coh: [0.2, 0.3], fric: 0.8, tiles: { all: 17 }, frag: 4, noCollide: true },
};
const BLOCK_IDS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23];   // 可放置的方块与三维体（蘑菇 21 只能挖/在物品栏里放着）

// bounce = 反弹（反作用力）0~1：撞上去会被弹回的速度比例。石头硬几乎不弹，树叶软弹得欢
const BOUNCE = { 1: 0.18, 2: 0.12, 3: 0.10, 4: 0.26, 5: 0.55, 6: 0.24, 7: 0.24, 9: 0.10, 10: 0.24, 11: 0.10, 12: 0.10, 13: 0.10, 14: 0.26,
  15: 0.15, 16: 0.10, 17: 0.30, 18: 0.40, 19: 0.10, 20: 0.10, 21: 0.45, 22: 0.2, 23: 0.2 };
for (const bid in BOUNCE) BLOCKS[bid].bounce = BOUNCE[bid];

// 放置尺寸档位：G 键循环切换。小于 1m 时直接按「体积×密度」消耗材料质量（挖多少用多少，质量守恒）
// 例：10cm 石方块 = 0.001m³ × 2.5kg/m³ = 2.5g 石料；50cm = 0.3125kg；25cm = 39g
const PLACE_SIZES = [1, 0.5, 0.25, 0.1];
// 玩家偏好用 localStorage 记住（bx_ 前缀，和设置面板的 bx_vol/bx_sens 一致）：刷新/重开不再丢
function savePref(key, val) { try { localStorage.setItem('bx_' + key, String(val)); } catch (e) { } }
function loadPref(key, fallback) { try { const v = localStorage.getItem('bx_' + key); return v === null ? fallback : v; } catch (e) { return fallback; } }
let placeSizeIdx = +loadPref('placeSize', 0) || 0;    // 当前档位（0 = 整块 1m），上次选过的会记住
function setPlaceSize(i) {                   // 设置放置尺寸档位并存档，刷新后还是它
  placeSizeIdx = ((i % PLACE_SIZES.length) + PLACE_SIZES.length) % PLACE_SIZES.length;
  savePref('placeSize', placeSizeIdx);
  showHandName();
  updateSizeTag();
}

// 造型的立体形状（放进世界后用独立网格渲染）：任意尺寸的三维体，体积×密度=材料质量
const SHAPES = {
  9:  { size: [1, 0.5, 1] },          // 石台阶：半高（0.5m³）
  10: { size: [1, 0.5, 1] },          // 木台阶
  11: { size: [0.4, 1, 0.4] },        // 石柱：细柱
  12: { size: [0.5, 0.5, 0.5] },      // 小石块：半尺寸立方（0.125m³）
  13: { size: [1, 0.25, 1] },         // 薄石板：四分之一高（0.25m³）
  14: { size: [1, 0.4, 0.4] },        // 木梁：长条梁（0.16m³）
  21: { size: [0.4, 0.35, 0.4] },   // 蘑菇：树下长的小家伙，挖了直接进食物袋
  // 22 火把 / 23 营火的燃烧参数：life=燃尽秒数 r=取暖/驱怪半径 light=点光源强度 ldist=光照距离
  // rationale life：火把 240s（一夜 273s，一支火把撑不完——要备两支或早睡）；营火 600s（一夜半，能烤肉能守家）
  // rationale r：火把 4.5m 营火 6.5m——两支火把间距 ≤9m 才能连成无死角的光墙
  // [PLACEHOLDER · 假设：驱怪半径=取暖半径；验证：实测夜行者绕光走的最小间距]
  22: { size: [0.12, 0.55, 0.12], fire: { life: 240, r: 4.5, light: 1.1, ldist: 9 } },
  23: { size: [0.7, 0.26, 0.7],   fire: { life: 600, r: 6.5, light: 1.6, ldist: 12 } },
};

/* =====================================================
 * 二、地形生成（值噪声）
 * ===================================================== */
function hash2(x, z, seed) {
  let h = (seed | 0) + x * 374761393 + z * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >>> 16);      // 必须无符号右移：算术 >> 会让最高位恒清零，输出永远 <0.5（森林/高山/铁矿全都不会生成）
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const s = t => t * t * (3 - 2 * t);
  const a = hash2(ix, iz, seed),     b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const u = s(fx), v = s(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, seed) {  // 叠加 4 层噪声，越叠越细腻
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * freq, z * freq, seed + o * 1013) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
function heightAt(x, z) {
  let h = 2 + fbm(x / 34, z / 34, SEED) * 14 + fbm(x / 9, z / 9, SEED + 7777) * 3;
  if (fbm(x / 50, z / 50, SEED + 99) < 0.35) h -= 2.5;   // 低洼盆地：会灌成水塘
  // 世界边缘沉入海：距边 16 格内高度线性压到水下，走到边界看到的是海而不是空气墙
  const edge = Math.min(x, z, WX - 1 - x, WZ - 1 - z);
  if (edge < 16) h = h * (edge / 16) + 1.5 * (1 - edge / 16);
  return Math.max(1, Math.min(WY - 13, Math.floor(h)));
}
// 生物群系：大尺度噪声划区。<0.36 沙漠 / 0.36~0.5 雪原 / >0.5 草原森林（树密度再看一层噪声）
function biomeAt(x, z) {
  const b = fbm(x / 90 + 31, z / 90 - 47, SEED + 4242);
  if (b < 0.36) return 0;      // 沙漠
  if (b < 0.5)  return 1;      // 雪原
  return 2;                    // 草原 / 森林
}

// 世界数据：world[(x*WZ+z)*WY+y] = 方块编号，0 为空气
const world = new Uint8Array(WX * WY * WZ);
const idx = (x, y, z) => (x * WZ + z) * WY + y;
function getBlock(x, y, z) {
  if (x < 0 || x >= WX || y < 0 || y >= WY || z < 0 || z >= WZ) return 0;
  return world[idx(x, y, z)];
}

function generateWorld() {
  const CX = WX / 2, CZ = WZ / 2;             // 世界中心（也是出生点搜索中心）
  for (let x = 0; x < WX; x++) for (let z = 0; z < WZ; z++) {
    const h = heightAt(x, z), biome = biomeAt(x, z);
    for (let y = 0; y <= h; y++) {
      let id;
      if (biome === 0) {                      // 沙漠：沙 / 砂岩 / 石头
        id = y === h ? 15 : (y >= h - 2 ? 15 : (y >= h - 5 ? 16 : 3));
      } else if (biome === 1) {               // 雪原：雪盖 / 泥土 / 石头
        id = y === h ? 17 : (y >= h - 2 ? 2 : 3);
      } else {                                 // 草原森林：草皮 / 泥土 / 石头
        id = y === h ? 1 : (y >= h - 2 ? 2 : 3);
      }
      // 地下矿脉：石头层里混煤矿 / 铁矿（铁埋更深一点）
      if (id === 3 && y < h - 3 && y > 0) {
        const r = hash2(x * 7 + y * 131, z * 13 + y * 57, SEED + 8888);
        if (r < 0.022 && y < h - 2) id = 19;          // 煤：浅层多
        else if (r < 0.022 + 0.010 && y < h - 8) id = 20;   // 铁：深层才有
      }
      world[idx(x, y, z)] = id;
    }
    if (h < 4) for (let y = h + 1; y <= 4; y++) world[idx(x, y, z)] = (biome === 1 && y === 4) ? 18 : 8;   // 低洼灌水（雪原的水面结冰）
  }
  // 长树（水下/沙漠不长；雪原稀疏；森林看密度噪声）
  for (let x = 2; x < WX - 2; x++) for (let z = 2; z < WZ - 2; z++) {
    const biome = biomeAt(x, z);
    if (biome === 0) continue;                // 沙漠不长树
    if (heightAt(x, z) < 4) continue;
    if (Math.abs(x - CX) < 3 && Math.abs(z - CZ) < 3) continue;   // 出生点附近不留树
    const density = biome === 1 ? 0.003 : (fbm(x / 24, z / 24, SEED + 606) > 0.55 ? 0.045 : 0.008);   // 森林成片 / 草原零星
    if (hash2(x, z, SEED ^ 0x9e3779) >= density) continue;
    const h = heightAt(x, z), th = 4 + (hash2(x, z, SEED + 55) < 0.5 ? 0 : 1);
    for (let y = h + 1; y <= h + th; y++) world[idx(x, y, z)] = 4; // 树干
    for (let dy = th - 2; dy <= th + 1; dy++) {                    // 树叶团
      const ly = h + dy, r = dy <= th - 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(x + dx, z + dz, SEED + dy) < 0.6) continue;
        if (r === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;  // 顶层留十字
        const bx = x + dx, by = ly, bz = z + dz;
        if (bx < 0 || bx >= WX || by < 0 || by >= WY || bz < 0 || bz >= WZ) continue;
        if (world[idx(bx, by, bz)] === 0) world[idx(bx, by, bz)] = 5;
      }
    }
    // 树脚下概率长蘑菇（食物：蛋白质来源）。地面用 heightAt 找：topAt 会被自家树冠挡住导致草皮判定永假
    if (hash2(x, z, SEED + 777) < 0.3) {
      for (const [mx, mz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const gx = x + mx, gz = z + mz;
        if (gx < 0 || gx >= WX || gz < 0 || gz >= WZ) continue;
        const gy = heightAt(gx, gz);
        if (world[idx(gx, gy, gz)] === 1 && world[idx(gx, gy + 1, gz)] === 0 && hash2(gx * 3, gz * 5, SEED + 999) < 0.35) {
          world[idx(gx, gy + 1, gz)] = 21; worldShapes.push([gx, gy + 1, gz, 21]); break;
        }
      }
    }
  }
  generateVillages();
}
let villageSpots = [];                        // 村庄位置（调试/罗盘用）
function generateVillages() {                 // 村庄：4 个候选点找平地盖木屋（内含免费工具箱）+ 一口石头井
  const spots = [];
  for (let tries = 0; tries < 60 && spots.length < 4; tries++) {
    const vx = 24 + Math.floor(hash2(tries * 17, 3, SEED + 31) * (WX - 48));
    const vz = 24 + Math.floor(hash2(3, tries * 29, SEED + 67) * (WZ - 48));
    if (Math.abs(vx - WX / 2) < 20 && Math.abs(vz - WZ / 2) < 20) continue;    // 别压着出生点
    if (spots.some(s => Math.hypot(s[0] - vx, s[1] - vz) < 50)) continue;      // 村子间隔
    const h0 = heightAt(vx, vz);
    if (h0 < 5) continue;                     // 别在水里
    let flat = true;
    for (let dx = -4; dx <= 4 && flat; dx++) for (let dz = -4; dz <= 4 && flat; dz++)
      if (Math.abs(heightAt(vx + dx, vz + dz) - h0) > 2) flat = false;   // 放宽到 ±2：有起伏的地也能安家
    if (flat) spots.push([vx, vz, h0]);
  }
  villageSpots = spots.map(([vx, vz, h]) => ({ x: vx, y: h, z: vz }));
  for (const [vx, vz, h] of spots) {
    // 屋子 7×7：木板地板 + 原木角柱 + 木板墙（门口朝 ±x）+ 木板平顶 + 屋内一个工具箱
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const gx = vx + dx, gz = vz + dz;
      for (let y = h + 1; y <= h + 4; y++) world[idx(gx, y, gz)] = 0;   // 先清出空间（把草/树顶掉）
      world[idx(gx, h, gz)] = (dx === -3 || dx === 3 || dz === -3 || dz === 3) ? 4 : 6;   // 地板：边框原木，中间木板
      const wall = (Math.abs(dx) === 3 || Math.abs(dz) === 3);
      const door = (dz === 0 && Math.abs(dx) === 3);
      if (wall) for (let y = h + 1; y <= h + 3; y++) world[idx(gx, y, gz)] = (door && y <= h + 2) ? 0 : ((Math.abs(dx) === 3 && Math.abs(dz) === 3) ? 4 : 6);
      else world[idx(gx, h + 4, gz)] = 6;     // 屋顶（平顶，只盖内部范围）
    }
    world[idx(vx - 2, h + 1, vz - 2)] = 7;    // 屋里放个工具箱：村庄是天然的合成点
    // 门口两级木台阶方便进出（1m 门槛，跳 50cm 上不去，台阶半格正好）
    const dx0 = vx + 4;
    if (dx0 < WX) { world[idx(dx0, h, vz)] = 10; world[idx(dx0, h + 1, vz)] = 0; worldShapes.push([dx0, h, vz, 10]); }
    const dx1 = vx - 4;
    if (dx1 > 0) { world[idx(dx1, h, vz)] = 10; world[idx(dx1, h + 1, vz)] = 0; worldShapes.push([dx1, h, vz, 10]); }
    // 房前一口井：3×3 石圈 + 中心水柱
    const wx2 = vx + 8, wz2 = vz + 4;
    if (wx2 + 1 < WX - 16 && wz2 + 1 < WZ - 16) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const gx = wx2 + dx, gz = wz2 + dz, gh = heightAt(gx, gz);
        if (dx === 0 && dz === 0) { for (let y = gh; y >= Math.max(1, gh - 4); y--) world[idx(gx, y, gz)] = 8; }
        else { world[idx(gx, gh, gz)] = 3; for (let y = gh + 1; y <= gh + 2; y++) world[idx(gx, y, gz)] = 0; }
      }
    }
  }
}
function topAt(x, z) { for (let y = WY - 1; y >= 0; y--) if (world[idx(x, y, z)]) return y; return 0; }

/* =====================================================
 * 三、Three.js 场景
 * ===================================================== */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd4f2, 60, 170);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 200);   // far=200：雾(170)外不渲染，tris 大减；穹顶球心在玩家处不会被裁
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
const RENDER_SCALES = [1, 0.75, 0.5, 0.35];   // 画质档位：渲染分辨率比例（N 键循环，卡就往下调）
let renderScaleIdx = +(localStorage.getItem('bx_res') || 0) || 0;
function applyRenderScale() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * RENDER_SCALES[renderScaleIdx]);
  renderer.setSize(innerWidth, innerHeight);
}
try { if (localStorage.getItem('bx_res') === null) localStorage.setItem('bx_res', '0'); } catch (e) {}
applyRenderScale();
renderer.setClearColor(0x9fd4f2);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6b7b8c, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(60, 100, 40);
scene.add(sun);

/* ---- 天空：渐变穹顶 + 太阳/月亮 + 星星 + 漂移云层（都跟着玩家移动，永远包围在四周） ---- */
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const skyDomeMat = new THREE.MeshBasicMaterial({          // 穹顶材质单独存着：坏天气把它整体调暗
  vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
let sunSprite, moonSprite, starsMat;                      // 昼夜系统每帧要动它们（在下面的块里赋值）
{
  // 穹顶：大球内侧，天顶深蓝、地平线浅蓝白
  const geo = new THREE.SphereGeometry(320, 24, 12);
  const cols = [];
  const top = new THREE.Color(0x3d8bd0), mid = new THREE.Color(0x9fd4f2), bot = new THREE.Color(0xd9f0fb);
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 320;      // -1(底)..1(顶)
    const c = y >= 0 ? mid.clone().lerp(top, Math.min(1, y * 1.5))
                     : mid.clone().lerp(bot, Math.min(1, -y * 3));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const dome = new THREE.Mesh(geo, skyDomeMat);
  dome.renderOrder = -1;                                  // 最先画，不挡任何东西
  skyGroup.add(dome);

  // 太阳：径向渐变光晕（昼夜系统会挪它的位置、染晨昏色）
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g2 = cv.getContext('2d');
  const gr = g2.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,252,225,1)');
  gr.addColorStop(0.22, 'rgba(255,246,190,0.95)');
  gr.addColorStop(0.55, 'rgba(255,238,160,0.28)');
  gr.addColorStop(1, 'rgba(255,238,160,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(cv);
  sunSprite = new THREE.Mesh(new THREE.PlaneGeometry(70, 70),
    new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }));
  sunSprite.position.set(160, 266, 106).normalize().multiplyScalar(185);
  sunSprite.lookAt(0, 0, 0);
  skyGroup.add(sunSprite);

  // 月亮：同一张光晕图调成冷色小盘，走夜弧（太阳的反向）
  moonSprite = new THREE.Mesh(new THREE.PlaneGeometry(42, 42),
    new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false, color: 0xcfd8ef, opacity: 0.75 }));
  moonSprite.position.set(-160, 266, -106).normalize().multiplyScalar(185);
  moonSprite.lookAt(0, 0, 0);
  skyGroup.add(moonSprite);

  // 星星：穹顶上随机 240 个点，夜里才显形（不随天气转，但雾会自然盖住地平线处的）
  const sPos = [];
  for (let i = 0; i < 240; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 0.95 + 0.03);   // 只在上半球
    const r = 190;                                        // 必须小于相机 far(200)，否则被裁掉
    sPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  starsMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(sGeo, starsMat);
  skyGroup.add(stars);
}

// 云层：体素风扁平云块。图案以 128 为周期无缝循环，缓慢向左漂移
const CLOUD_PERIOD = 128, CLOUD_Y = 54, CLOUD_SPEED = 1.6;
let skyDrift = 0;
const cloudMesh = (() => {
  const cell = 4, n = CLOUD_PERIOD / cell, span = 512;    // 一格 4 米，图案 32×32 格，铺 512×512
  const L = 8, grid = [];                                 // 周期化的随机点阵（均匀分布）
  let cs = (SEED % 2147483646) + 1;
  for (let i = 0; i < L * L; i++) { cs = (cs * 16807) % 2147483647; grid.push(cs / 2147483647); }
  const gAt = (i, j) => grid[((j % L + L) % L) * L + ((i % L + L) % L)];
  const sm = t => t * t * (3 - 2 * t);
  const cnoise = (fx, fz) => {
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = sm(fx - ix), v = sm(fz - iz);
    const a = gAt(ix, iz), b = gAt(ix + 1, iz), c2 = gAt(ix, iz + 1), d = gAt(ix + 1, iz + 1);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
  const pos = [], ind = [];
  for (let cx = 0; cx < n * 4; cx++) for (let cz = 0; cz < n * 4; cz++) {
    const v = cnoise(cx * L / n, cz * L / n) * 0.65 + cnoise(cx * L / n * 2, cz * L / n * 2) * 0.35;
    if (v < 0.55) continue;
    const a = pos.length / 3, x = cx * cell, z = cz * cell;
    pos.push(x, 0, z,  x + cell, 0, z,  x + cell, 0, z + cell,  x, 0, z + cell);
    ind.push(a, a + 2, a + 1, a, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(ind);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    fog: false, depthWrite: false }));
  mesh.renderOrder = 1;
  mesh.position.set(-192, CLOUD_Y, -192);
  scene.add(mesh);
  return mesh;
})();

/* ---- 程序化贴图：用画布现画出每种方块的纹理 ---- */
const ATLAS_W = 256, ATLAS_H = 512;          // 4 列 × 8 行贴图（32 格，0-15 原有，16 火把 17 营火）
const TILE_PX = 64;                          // 每张贴图 64px
function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = ATLAS_W; cv.height = ATLAS_H;
  const g = cv.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX; tmp.height = TILE_PX;
  const t = tmp.getContext('2d');
  let s = 987654321;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const fill = c => { t.fillStyle = c; t.fillRect(0, 0, TILE_PX, TILE_PX); };
  const spot = (c, n, max) => { for (let i = 0; i < n; i++) { t.fillStyle = c; t.fillRect((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 1 + (rnd() * max | 0), 1 + (rnd() * max | 0)); } };
  const stamp = idx => {   // 铺进网格：4 列 2 行，64px 精确对齐
    g.drawImage(tmp, (idx % 4) * TILE_PX, ((idx / 4) | 0) * TILE_PX);
  };

  fill('#5fae38'); spot('#529930', 260, 2); spot('#6fc245', 200, 2); spot('#7ad24f', 60, 1);          // 0 草顶：草地杂色
  stamp(0);
  fill('#7c5a33'); spot('#6b4c29', 240, 2); spot('#8d683c', 180, 2);                                  // 1 草侧：泥土 + 锯齿草皮
  for (let x = 0; x < TILE_PX; x++) {
    const depth = 11 + ((rnd() * 8) | 0);
    t.fillStyle = '#5fae38'; t.fillRect(x, 0, 1, depth);
    if (rnd() < 0.5) { t.fillStyle = '#4c8f2c'; t.fillRect(x, depth - 2, 1, 2); }
  }
  spot('#529930', 40, 2);
  stamp(1);
  fill('#8a6238'); spot('#75522c', 240, 3); spot('#9c7245', 200, 2); spot('#5f4526', 60, 2);          // 2 泥土
  stamp(2);
  fill('#8f9099');                                                                                    // 3 石头：色斑 + 裂纹
  for (let i = 0; i < 26; i++) { t.fillStyle = rnd() < 0.5 ? '#7d7e88' : '#9fa0a9'; t.fillRect((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 3 + (rnd() * 7 | 0), 2 + (rnd() * 5 | 0)); }
  t.strokeStyle = '#6b6c76'; t.lineWidth = 1;
  for (let i = 0; i < 5; i++) { t.beginPath(); let x = rnd() * TILE_PX, y = rnd() * TILE_PX; t.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 18; y += (rnd() - 0.5) * 18; t.lineTo(x, y); } t.stroke(); }
  stamp(3);
  fill('#6b4b2a');                                                                                    // 4 原木侧：竖向木纹
  for (let x = 0; x < TILE_PX; x += 3 + (rnd() * 4 | 0)) { t.fillStyle = rnd() < 0.5 ? '#5a3d20' : '#7d5a35'; t.fillRect(x, 0, 1 + (rnd() * 2 | 0), TILE_PX); }
  spot('#4e3419', 40, 2);
  stamp(4);
  fill('#a87b4c');                                                                                    // 5 原木顶：年轮
  for (let r = 30; r > 0; r -= 4) { t.strokeStyle = (r / 4) % 2 ? '#8a6238' : '#6b4b2a'; t.beginPath(); t.arc(32, 32, r, 0, Math.PI * 2); t.stroke(); }
  spot('#96693f', 60, 2);
  stamp(5);
  fill('#3e8f42'); spot('#2f7334', 200, 4); spot('#4fa854', 160, 3); spot('#26622a', 90, 3); spot('#57b45e', 50, 2);  // 6 树叶
  stamp(6);
  fill('#9c6b3d');                                                                                    // 7 木板
  for (let y = 0; y < TILE_PX; y += 16) { t.fillStyle = '#7d5327'; t.fillRect(0, y, TILE_PX, 2); }
  spot('#8a5e33', 120, 2);
  stamp(7);
  fill('#9c6b3d'); spot('#8a5e33', 100, 2);                                                           // 8 工具箱：木台 + 深框 + 2×2 工作格
  t.strokeStyle = '#5a3d20'; t.lineWidth = 6; t.strokeRect(3, 3, TILE_PX - 6, TILE_PX - 6);
  t.fillStyle = '#5a3d20'; t.fillRect(30, 4, 4, TILE_PX - 8); t.fillRect(4, 30, TILE_PX - 8, 4);
  spot('#7d5327', 50, 2);
  stamp(8);
  fill('#d9c07e'); spot('#cbb069', 220, 2); spot('#e6d194', 180, 2); spot('#bfa157', 90, 2);          // 9 沙子：细密沙粒
  stamp(9);
  fill('#c9a86b');                                                                                    // 10 砂岩：水平层理
  for (let y = 0; y < TILE_PX; y += 8 + (rnd() * 6 | 0)) { t.fillStyle = rnd() < 0.5 ? '#b8975a' : '#d4b678'; t.fillRect(0, y, TILE_PX, 3 + (rnd() * 3 | 0)); }
  spot('#a8894e', 60, 2);
  stamp(10);
  fill('#eef4f8'); spot('#dde9f2', 180, 3); spot('#f8fbfd', 140, 3); spot('#cddced', 60, 2);          // 11 雪块
  stamp(11);
  fill('#a8d8f0');                                                                                    // 12 冰：淡蓝 + 斜向高光
  t.strokeStyle = 'rgba(255,255,255,0.5)'; t.lineWidth = 2;
  for (let i = 0; i < 4; i++) { t.beginPath(); t.moveTo(-8 + i * 20, 64); t.lineTo(20 + i * 20, 0); t.stroke(); }
  spot('#8ec4e4', 50, 2); spot('#c4e6f6', 40, 3);
  stamp(12);
  fill('#8f9099');                                                                                    // 13 煤矿石：石头底 + 黑煤斑
  for (let i = 0; i < 14; i++) { t.fillStyle = rnd() < 0.5 ? '#7d7e88' : '#9fa0a9'; t.fillRect((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 4 + (rnd() * 8 | 0), 3 + (rnd() * 5 | 0)); }
  for (let i = 0; i < 7; i++) { t.fillStyle = '#2b2b31'; t.beginPath(); t.arc((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 4 + (rnd() * 5 | 0), 0, Math.PI * 2); t.fill(); }
  spot('#3d3d45', 60, 2);
  stamp(13);
  fill('#8f9099');                                                                                    // 14 铁矿石：石头底 + 锈黄铁斑
  for (let i = 0; i < 14; i++) { t.fillStyle = rnd() < 0.5 ? '#7d7e88' : '#9fa0a9'; t.fillRect((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 4 + (rnd() * 8 | 0), 3 + (rnd() * 5 | 0)); }
  for (let i = 0; i < 6; i++) { t.fillStyle = '#c9973f'; t.beginPath(); t.arc((rnd() * TILE_PX) | 0, (rnd() * TILE_PX) | 0, 3 + (rnd() * 4 | 0), 0, Math.PI * 2); t.fill(); }
  spot('#b0832e', 50, 2);
  stamp(14);
  fill('#e8ddca');                                                                                    // 15 蘑菇：奶油伞面 + 褐斑
  t.fillStyle = '#c98a5a';
  t.beginPath(); t.arc(32, 26, 24, Math.PI, 0); t.fill();             // 伞盖
  t.fillRect(8, 26, 48, 5);
  t.fillStyle = '#efe6d4'; t.fillRect(28, 31, 8, 20);                 // 菌柄
  spot('#a06b42', 26, 3);
  stamp(15);
  fill('#6b4b2a'); spot('#5a3d20', 30, 2);                    // 16 火把：竖木棍，顶上一团浸油的亮头
  t.fillStyle = '#ffd97a'; t.fillRect(24, 4, 16, 14);
  t.fillStyle = '#fff3c0'; t.fillRect(27, 6, 10, 8);
  stamp(16);
  fill('#4c3a2c');                                             // 17 营火：石圈 + 交叉木柴 + 中间炭火
  t.strokeStyle = '#7a7a82'; t.lineWidth = 5; t.strokeRect(4, 42, 56, 20);
  t.strokeStyle = '#6b4b2a'; t.lineWidth = 7; t.lineCap = 'round';
  t.beginPath(); t.moveTo(12, 54); t.lineTo(52, 42); t.moveTo(12, 42); t.lineTo(52, 54); t.stroke();
  t.fillStyle = '#ff8030'; t.fillRect(24, 44, 16, 10);
  t.fillStyle = '#ffd060'; t.fillRect(28, 47, 8, 5);
  stamp(17);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;      // 关闭 mipmap：远处的轻微闪烁用雾遮住，换取不串色
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  return tex;
}
const atlasTexture = makeAtlas();
const blockMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true });

/* =====================================================
 * 四、分块网格：只渲染暴露在空气中的面（性能关键）
 * ===================================================== */
// 6 个面：法线、四个顶点（保证朝外）、明暗系数、uv 取哪两个坐标轴 [u轴, v轴]
const FACES = [
  { n: [ 1, 0, 0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], s: 0.82, uv: [2, 1] },
  { n: [-1, 0, 0], v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], s: 0.82, uv: [2, 1] },
  { n: [ 0, 1, 0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], s: 1.00, uv: [0, 2] },
  { n: [ 0,-1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], s: 0.58, uv: [0, 2] },
  { n: [ 0, 0, 1], v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], s: 0.70, uv: [0, 1] },
  { n: [ 0, 0,-1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], s: 0.70, uv: [0, 1] },
];
function faceVisible(nx, ny, nz, id) {      // 网格相邻判断：界外算空气（画边缘悬崖），底部以下算实体
  if (ny < 0) return false;
  if (nx < 0 || nx >= WX || nz < 0 || nz >= WZ || ny >= WY) return id !== 8;
  const ni = idx(nx, ny, nz);
  const nId = carved.has(ni) ? 0 : world[ni];   // 被雕刻的方块当空气处理（洞要露出来）
  if (id === 8) return nId === 0 || nId >= 9;   // 水对着空气和造型画
  return nId === 0 || nId === 8 || nId >= 9;    // 实体对着水/造型也画（造型不是满格子）
}
function tileFor(id, f) {                    // 这个方块这个面用哪张贴图
  const tl = BLOCKS[id].tiles;
  const kind = f.n[1] === 1 ? 'top' : (f.n[1] === -1 ? 'bottom' : 'side');
  return tl[kind] !== undefined ? tl[kind] : tl.all;
}
function tileUV(idx) {                       // 贴图在图集里的 uv 范围（4 列 × 8 行）
  const c = idx % 4, r = (idx / 4) | 0;
  return {
    u0: c / 4, u1: (c + 1) / 4,
    v1: 1 - r / 8,                           // 贴图上边（flipY 后 v 大的在上）；图集 8 行
    v0: 1 - (r + 1) / 8,
  };
}
function setBoxTileUV(geo, t) {              // 把 BoxGeometry 的 uv 整体指到图集某格（造型/小方块/手持物共用）
  const u0 = (t % 4) / 4, vBot = 1 - (((t / 4) | 0) + 1) / 8, vTop = 1 - ((t / 4) | 0) / 8;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.25, vBot + uv.getY(i) * (vTop - vBot));
}
function blockJitter(x, y, z) {              // 每个方块随机轻微深浅，增加自然感
  return 0.94 + hash2(x * 3 + y * 57, z * 5 + y * 131, SEED + 123) * 0.09;
}
const AO_CURVE = [0.55, 0.72, 0.86, 1.0];    // 环境光遮蔽：角落处按档位变暗
function vertexAO(x, y, z, F, v) {           // 看这个顶点两侧和斜角有没有方块，有就压暗
  const nb = [x + F.n[0], y + F.n[1], z + F.n[2]];
  const ax = F.n[0] !== 0 ? [1, 2] : (F.n[1] !== 0 ? [0, 2] : [0, 1]);
  const d1 = v[ax[0]] === 1 ? 1 : -1;
  const d2 = v[ax[1]] === 1 ? 1 : -1;
  const p1 = [nb[0], nb[1], nb[2]]; p1[ax[0]] += d1;
  const p2 = [nb[0], nb[1], nb[2]]; p2[ax[1]] += d2;
  const pc = [nb[0], nb[1], nb[2]]; pc[ax[0]] += d1; pc[ax[1]] += d2;
  const s1 = getBlock(p1[0], p1[1], p1[2]) ? 1 : 0;
  const s2 = getBlock(p2[0], p2[1], p2[2]) ? 1 : 0;
  const sc = getBlock(pc[0], pc[1], pc[2]) ? 1 : 0;
  return (s1 && s2) ? 0 : 3 - (s1 + s2 + sc);
}

const chunkMeshes = new Map();              // key: "cx,cz"（实体）
const chunkWaterMeshes = new Map();         // 水单独一份（半透明材质不同）
const waterMaterial = new THREE.MeshLambertMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0.55, depthWrite: false });
function rebuildChunk(cx, cz) {
  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) { scene.remove(old); old.geometry.dispose(); chunkMeshes.delete(key); }
  const oldW = chunkWaterMeshes.get(key);
  if (oldW) { scene.remove(oldW); oldW.geometry.dispose(); chunkWaterMeshes.delete(key); }

  const pos = [], nor = [], col = [], uvs = [], ind = [];
  const posW = [], norW = [], indW = [];
  const x0 = cx * CS, z0 = cz * CS;
  for (let x = x0; x < x0 + CS; x++) for (let z = z0; z < z0 + CS; z++) for (let y = 0; y < WY; y++) {
    const id = world[idx(x, y, z)];
    if (!id) continue;
    if (SHAPES[id]) continue;              // 造型（台阶/石柱）用独立网格渲染，不进方块网格
    if (carved.has(idx(x, y, z))) continue; // 被雕刻的方块由自己的"剩余子格"网格渲染
      if (id === 8) {                                        // 水：单独网格 + 半透明材质
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          if (!faceVisible(x + F.n[0], y + F.n[1], z + F.n[2], 8)) continue;
          const aW = posW.length / 3;
          for (const v of F.v) { posW.push(x + v[0], y + v[1], z + v[2]); norW.push(F.n[0], F.n[1], F.n[2]); }
          indW.push(aW, aW + 1, aW + 2, aW, aW + 2, aW + 3);
        }
        continue;
      }
    const jit = blockJitter(x, y, z);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      if (!faceVisible(x + F.n[0], y + F.n[1], z + F.n[2], id)) continue;
      const uvR = tileUV(tileFor(id, F));
      const a = pos.length / 3;
      const ao = [];
      for (const v of F.v) {
        pos.push(x + v[0], y + v[1], z + v[2]);
        nor.push(F.n[0], F.n[1], F.n[2]);
        uvs.push(uvR.u0 + v[F.uv[0]] * (uvR.u1 - uvR.u0), uvR.v0 + v[F.uv[1]] * (uvR.v1 - uvR.v0));
        const q = vertexAO(x, y, z, F, v);              // 环境光遮蔽档位
        ao.push(q);
        const shade = F.s * AO_CURVE[q] * jit;          // 颜色只当“明暗系数”用，花纹交给贴图
        col.push(shade, shade, shade);
      }
      // 按遮蔽分布选三角形对角线，避免转角出现难看的渐变
      if (ao[0] + ao[2] >= ao[1] + ao[3]) ind.push(a, a + 1, a + 2, a, a + 2, a + 3);
      else ind.push(a + 1, a + 2, a + 3, a + 1, a + 3, a);
    }
  }
  if (indW.length) {
    const geoW = new THREE.BufferGeometry();
    geoW.setAttribute('position', new THREE.Float32BufferAttribute(posW, 3));
    geoW.setAttribute('normal', new THREE.Float32BufferAttribute(norW, 3));
    geoW.setIndex(indW);
    const water = new THREE.Mesh(geoW, waterMaterial);
    water.renderOrder = 2;
    scene.add(water);
    chunkWaterMeshes.set(key, water);
  }
  if (!ind.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(ind);
  const mesh = new THREE.Mesh(geo, blockMaterial);
  scene.add(mesh);
  chunkMeshes.set(key, mesh);
}

/* ---- 造型（台阶/石柱）：每个是一个独立网格，从图集裁贴图 ---- */
const shapeMeshes = new Map();              // key: "x,y,z" → 网格
function addShapeMesh(x, y, z, id) {
  const S = SHAPES[id];
  const geo = new THREE.BoxGeometry(S.size[0], S.size[1], S.size[2]);
  setBoxTileUV(geo, BLOCKS[id].tiles.all);
  const mesh = new THREE.Mesh(geo, blockMaterial);
  mesh.position.set(x + 0.5, y + S.size[1] / 2, z + 0.5);
  scene.add(mesh);
  shapeMeshes.set(x + ',' + y + ',' + z, mesh);
}
function removeShapeMesh(x, y, z) {
  const k = x + ',' + y + ',' + z;
  const m = shapeMeshes.get(k);
  if (m) { scene.remove(m); m.geometry.dispose(); shapeMeshes.delete(k); }
}
// 世界自带的造型（村庄台阶、蘑菇）：生成期收集，建区块网格后统一建独立网格
const worldShapes = [];
let mushroomMesh = null;                     // 蘑菇量大（森林成片），合并成一个网格：省 100+ draw calls
function rebuildMushrooms() {                // 按 world 当前值全量重建（放置/挖掉蘑菇时低频调用，扫 y<30 约 5ms）
  if (mushroomMesh) { scene.remove(mushroomMesh); mushroomMesh.geometry.dispose(); mushroomMesh = null; }
  const pos = [], nor = [], uv = [], ind = [];
  const t15 = tileUV(15), S = SHAPES[21];
  for (let x = 0; x < WX; x++) for (let z = 0; z < WZ; z++) for (let y = 1; y < 30; y++) {
    if (world[idx(x, y, z)] !== 21) continue;
    for (const F of FACES) {
      const a = pos.length / 3;
      for (const v of F.v) {
        pos.push(x + 0.5 + (v[0] - 0.5) * S.size[0], y + v[1] * S.size[1], z + 0.5 + (v[2] - 0.5) * S.size[2]);
        nor.push(F.n[0], F.n[1], F.n[2]);
        uv.push(t15.u0 + v[F.uv[0]] * (t15.u1 - t15.u0), t15.v0 + v[F.uv[1]] * (t15.v1 - t15.v0));
      }
      ind.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
  }
  if (!ind.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(ind);
  mushroomMesh = new THREE.Mesh(geo, blockMaterial);
  scene.add(mushroomMesh);
}
function buildAllChunks() {
  for (let cx = 0; cx < WX / CS; cx++) for (let cz = 0; cz < WZ / CS; cz++) rebuildChunk(cx, cz);
  for (const [x, y, z, id] of worldShapes) if (id !== 21) addShapeMesh(x, y, z, id);   // 蘑菇走合并网格
  rebuildMushrooms();
}
function setBlockAndRebuild(x, y, z, id) {  // 改一个方块，重建所在区块（边缘时连邻居一起）
  world[idx(x, y, z)] = id;
  refreshNeighborCarved(x, y, z);            // 邻块若有"咬过的洞"，暴露面变了要重画
  const set = new Set([((x >> 4) + ',' + (z >> 4))]);
  if ((x & 15) === 0  && x > 0)        set.add(((x >> 4) - 1) + ',' + (z >> 4));
  if ((x & 15) === 15 && x < WX - 1)   set.add(((x >> 4) + 1) + ',' + (z >> 4));
  if ((z & 15) === 0  && z > 0)        set.add((x >> 4) + ',' + ((z >> 4) - 1));
  if ((z & 15) === 15 && z < WZ - 1)   set.add((x >> 4) + ',' + ((z >> 4) + 1));
  set.forEach(k => { const [a, b] = k.split(',').map(Number); rebuildChunk(a, b); });
}

/* ---- 体素雕刻：每个 1m 方块由 10×10×10 个 10cm 子格组成，挖一下只咬掉一个子格 ---- */
const SUB = 10;                              // 每边 10 个 10cm 子格
const carved = new Map();                    // 体素索引 → { bits:Uint8Array(1000) 0=实体, n:已咬数, mesh }
const subIdx = (sx, sy, sz) => sx * 100 + sy * 10 + sz;
function isSubSolid(c, sx, sy, sz) {
  return sx >= 0 && sx < SUB && sy >= 0 && sy < SUB && sz >= 0 && sz < SUB && c.bits[subIdx(sx, sy, sz)] === 0;
}
function removeCarvedMesh(x, y, z) {
  const c = carved.get(idx(x, y, z));
  if (c && c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
}
function rebuildChunkAround(x, z) {          // 咬一口后重建所在区块（邻居的面要朝洞补画）
  const set = new Set([(x >> 4) + ',' + (z >> 4)]);
  if ((x & 15) === 0  && x > 0)        set.add(((x >> 4) - 1) + ',' + (z >> 4));
  if ((x & 15) === 15 && x < WX - 1)   set.add(((x >> 4) + 1) + ',' + (z >> 4));
  if ((z & 15) === 0  && z > 0)        set.add((x >> 4) + ',' + ((z >> 4) - 1));
  if ((z & 15) === 15 && z < WZ - 1)   set.add((x >> 4) + ',' + ((z >> 4) + 1));
  set.forEach(k => { const [a, b] = k.split(',').map(Number); rebuildChunk(a, b); });
}
function rebuildCarvedMesh(x, y, z) {        // 把剩余子格拼成网格：沿 X 合并成条；条的两端面整面判暴露，
  // 上下前后四个侧面按子格逐段判暴露——整条只在起点判一次会在挖井时漏画井壁，洞就成了透视窟窿
  const vi = idx(x, y, z), c = carved.get(vi);
  removeCarvedMesh(x, y, z);
  if (!c || c.n >= SUB * SUB * SUB) return;
  const id = world[vi];
  if (!id || SHAPES[id]) return;
  const jit = blockJitter(x, y, z);
  const pos = [], nor = [], col = [], uvs = [], ind = [];
  const solidOut = (sx, sy, sz) => {         // 某子格"外侧那格"是否实心：本块内看 bits；邻块没咬过=整块实，咬过看对面子格
    let nx = x, ny = y, nz = z, lx = sx, ly = sy, lz = sz;
    if (sx < 0) { nx--; lx = SUB - 1; } else if (sx >= SUB) { nx++; lx = 0; }
    if (sy < 0) { ny--; ly = SUB - 1; } else if (sy >= SUB) { ny++; ly = 0; }
    if (sz < 0) { nz--; lz = SUB - 1; } else if (sz >= SUB) { nz++; lz = 0; }
    if (nx === x && ny === y && nz === z) return isSubSolid(c, lx, ly, lz);
    if (ny < 0) return true;                 // 世界底层
    if (nx < 0 || nx >= WX || ny >= WY || nz < 0 || nz >= WZ) return false;
    const nid = world[idx(nx, ny, nz)];
    if (!nid || nid === 8 || SHAPES[nid]) return false;
    const nc = carved.get(idx(nx, ny, nz));
    if (!nc) return true;                    // 邻块没被咬过：整块都实
    return nc.bits[subIdx(lx, ly, lz)] === 0;   // 咬过：看对面那格还在不在（双方都实就不画，避免共面闪烁）
  };
  const ringAO = (ox, oy, oz, F) => {        // 面外侧那格的四周实体越多越暗（洞里不再亮得刺眼）
    const a = F.n[0] !== 0 ? [1, 2] : (F.n[1] !== 0 ? [0, 2] : [0, 1]);
    let solid = 0;
    const t1 = [0, 0, 0], t2 = [0, 0, 0];
    t1[a[0]] = 1; t2[a[1]] = 1;
    if (isSubSolid(c, ox + t1[0], oy + t1[1], oz + t1[2])) solid++;
    if (isSubSolid(c, ox - t1[0], oy - t1[1], oz - t1[2])) solid++;
    if (isSubSolid(c, ox + t2[0], oy + t2[1], oz + t2[2])) solid++;
    if (isSubSolid(c, ox - t2[0], oy - t2[1], oz - t2[2])) solid++;
    return AO_CURVE[Math.max(0, 3 - solid)];
  };
  const pushFace = (F, bx0, by0, bz0, bx1, by1, bz1, ao, depthMul, topRow) => {
    // 草方块：绿只在最表面那一层——顶排子格的朝天面用草皮贴图，内部露出的朝天面一律泥土贴图
    let tile = tileFor(id, F);
    if (id === 1 && F.n[1] === 1 && !topRow) tile = BLOCKS[2].tiles.all;
    const uvR = tileUV(tile);
    const a = pos.length / 3;
    const mn = [bx0, by0, bz0], mx = [bx1, by1, bz1];
    for (const v of F.v) {
      const l = [mn[0] + v[0] * (mx[0] - mn[0]), mn[1] + v[1] * (mx[1] - mn[1]), mn[2] + v[2] * (mx[2] - mn[2])];
      pos.push(x + l[0], y + l[1], z + l[2]);
      nor.push(F.n[0], F.n[1], F.n[2]);
      uvs.push(uvR.u0 + l[F.uv[0]] * (uvR.u1 - uvR.u0), uvR.v0 + l[F.uv[1]] * (uvR.v1 - uvR.v0));
    const soft = c.stomp ? 0.5 : 0;          // 踩出来的印：遮蔽和深度变暗都减半，看起来是"压实的雪"而不是黑洞
    const shade = F.s * jit * (ao + (1 - ao) * soft) * (depthMul + (1 - depthMul) * soft);
    col.push(shade, shade, shade);
    }
    ind.push(a, a + 1, a + 2, a, a + 2, a + 3);
  };
  for (let sy = 0; sy < SUB; sy++) for (let sz = 0; sz < SUB; sz++) {
    let sx = 0;
    while (sx < SUB) {
      if (!isSubSolid(c, sx, sy, sz)) { sx++; continue; }
      let x1 = sx;
      while (x1 + 1 < SUB && isSubSolid(c, x1 + 1, sy, sz)) x1++;
      const dep = Math.min(sx, SUB - 1 - x1, sy, SUB - 1 - sy, sz, SUB - 1 - sz);
      const depthMul = 1 - dep * 0.09;
      const topRow = sy === SUB - 1;
      const Y0 = sy / SUB, Y1 = (sy + 1) / SUB, Z0 = sz / SUB, Z1 = (sz + 1) / SUB;
      // 东西两端面：只占一个子格宽，整面判定
      if (!solidOut(x1 + 1, sy, sz)) pushFace(FACES[0], (x1 + 1) / SUB, Y0, Z0, (x1 + 1) / SUB, Y1, Z1, ringAO(x1 + 1, sy, sz, FACES[0]), depthMul, topRow);
      if (!solidOut(sx - 1, sy, sz)) pushFace(FACES[1], sx / SUB, Y0, Z0, sx / SUB, Y1, Z1, ringAO(sx - 1, sy, sz, FACES[1]), depthMul, topRow);
      // 上下前后四个侧面：沿条逐子格判暴露，连续暴露的合并成一段（井壁每一段都画到）
      for (const [F, oy, oz] of [[FACES[2], 1, 0], [FACES[3], -1, 0], [FACES[4], 0, 1], [FACES[5], 0, -1]]) {
        let i = sx;
        while (i <= x1) {
          if (solidOut(i, sy + oy, sz + oz)) { i++; continue; }
          let j = i;
          while (j + 1 <= x1 && !solidOut(j + 1, sy + oy, sz + oz)) j++;
          const ao = ringAO(i, sy + oy, sz + oz, F);
          const iX0 = i / SUB, iX1 = (j + 1) / SUB;
          if (oy === 1)       pushFace(F, iX0, Y1, Z0, iX1, Y1, Z1, ao, depthMul, topRow);
          else if (oy === -1) pushFace(F, iX0, Y0, Z0, iX1, Y0, Z1, ao, depthMul, topRow);
          else if (oz === 1)  pushFace(F, iX0, Y0, Z1, iX1, Y1, Z1, ao, depthMul, topRow);
          else                pushFace(F, iX0, Y0, Z0, iX1, Y1, Z0, ao, depthMul, topRow);
          i = j + 1;
        }
      }
      sx = x1 + 1;
    }
  }
  if (!ind.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(ind);
  const mesh = new THREE.Mesh(geo, blockMaterial);
  scene.add(mesh);
  c.mesh = mesh;
}
function refreshNeighborCarved(x, y, z) {     // 某格方块变动后：旁边被咬过的方块，洞壁的暴露面变了，要重画（否则出现透视窟窿）
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (nx < 0 || nx >= WX || ny < 0 || ny >= WY || nz < 0 || nz >= WZ) continue;
    if (carved.has(idx(nx, ny, nz))) rebuildCarvedMesh(nx, ny, nz);
  }
}
function findChip(hit) {                     // 从命中处沿视线细步前进：能穿过雕出来的洞，找到第一个还实着的 10cm 子格
  const o = eyePos(), dir = viewDir();
  const clamp9 = v => Math.max(0, Math.min(SUB - 1, v));
  let t = Math.max(hit.t, 0);
  while (t <= hit.t + 1.7 && t <= REACH) {
    const wx = o.x + dir.x * t, wy = o.y + dir.y * t, wz = o.z + dir.z * t;
    const cx = Math.floor(wx), cy = Math.floor(wy), cz = Math.floor(wz);
    if (cy < 0) return null;
    if (cx >= 0 && cx < WX && cz >= 0 && cz < WZ && cy < WY) {
      const vi = idx(cx, cy, cz), id = world[vi];
      if (id && id !== 8 && !SHAPES[id]) {     // 水和造型不参与咬子格
        const c = carved.get(vi);
        const sx = clamp9(Math.floor((wx - cx) * SUB)), sy = clamp9(Math.floor((wy - cy) * SUB)), sz = clamp9(Math.floor((wz - cz) * SUB));
        if (!c || isSubSolid(c, sx, sy, sz)) return { x: cx, y: cy, z: cz, sx, sy, sz };
      }
    }
    t += 0.02;
  }
  return null;
}
function doBite(x, y, z, chip0, n) {         // 咬掉以命中子格为中心的 n×n×n 立方（10cm 子格）：工具越大一口越大
  const vi = idx(x, y, z);
  const id = world[vi], b = BLOCKS[id];
  let c = carved.get(vi);
  const firstBite = !c;                        // 第一口才需要动区块网格（之后这格在区块网格里恒按空气渲染）
  if (!c) { c = { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null }; carved.set(vi, c); }
  const ox = Math.max(0, Math.min(SUB - n, chip0.sx - ((n - 1) >> 1)));   // 瞄准的子格尽量居中，贴边时往回缩
  const oy = Math.max(0, Math.min(SUB - n, chip0.sy - ((n - 1) >> 1)));
  const oz = Math.max(0, Math.min(SUB - n, chip0.sz - ((n - 1) >> 1)));
  let got = 0;
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) for (let dz = 0; dz < n; dz++) {
    const k = subIdx(ox + dx, oy + dy, oz + dz);
    if (!c.bits[k]) { c.bits[k] = 1; c.n++; got++; }
  }
  if (!got) return false;
  const m = +(b.density * got / (SUB * SUB * SUB)).toFixed(4);
  const fid = b.frag !== undefined ? b.frag : id;
  frags[fid] = +((frags[fid] || 0) + m).toFixed(4);
  gainFeed('+' + (m * 1000).toFixed(1) + 'g ' + b.matName);
  gainXp(b.xp * got / (SUB * SUB * SUB));    // 经验按咬掉的份额给
  mining.chip = { ...chip0, n };             // 高亮框按咬口大小画
  if (c.n >= SUB * SUB * SUB) {              // 整块被咬完
    finishBreak(x, y, z, id, 0);
  } else {
    if (c.n >= SUB * SUB * SUB / 2 && !c.half) { c.half = true; checkAroundForCollapse(x, y, z); }   // 大口会一步跨过 500，用标记只查一次
    if (world[vi] !== id) return true;       // 塌方检查把这块顺带塌掉了：不再重复建网格
    rebuildCarvedMesh(x, y, z);
    refreshNeighborCarved(x, y, z);          // 邻块也咬过洞时，对面遮挡变了要重画（跨块子格级遮挡）
    if (firstBite) rebuildChunkAround(x, z); // 区块网格只关心"这格是否开始被咬"，第一口之后不用再动
    burst(x + (ox + n / 2) / SUB, y + (oy + n / 2) / SUB, z + (oz + n / 2) / SUB, b.color, 3 + got);
    sfxMine(id);
  }
  return true;
}
function stompFootprint() {                  // 踩脚印：雪/沙被踩实下陷——用 10cm 子格真实压出凹痕（不掉材料、不算挖掘）
  const sp = Math.hypot(P.vel.x, P.vel.z);
  if (sp < 0.5) return;
  const gy = Math.floor(P.pos.y - 0.05);
  footSide = -footSide;                      // 左右脚交替
  const fx = P.pos.x + (-P.vel.z / sp) * 0.13 * footSide;   // 脚踩点在行进方向垂直侧偏 ±13cm（鞋钉在腿上的位置）
  const fz = P.pos.z + ( P.vel.x / sp) * 0.13 * footSide;
  const gx = Math.floor(fx), gz = Math.floor(fz);
  if (gx < 0 || gx >= WX || gz < 0 || gz >= WZ || gy < 0 || gy >= WY) return;
  const vi = idx(gx, gy, gz), id = world[vi];
  if (id !== 15 && id !== 17) return;        // 只有沙和雪这么软会留印（草皮泥土踩不出 10cm 坑）
  let c = carved.get(vi);
  const firstBite = !c;                      // 这块第一次被踩：区块网格里还画着整块，要摘掉
  if (!c) { c = { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null, stomp: true }; carved.set(vi, c); }
  c.stomp = true;                            // 踩出来的凹坑用柔光渲染，不然洞壁黑得像窟窿
  const lx = Math.max(0, Math.min(SUB - 2, Math.floor((fx - gx) * SUB)));
  const lz = Math.max(0, Math.min(SUB - 2, Math.floor((fz - gz) * SUB)));
  // 印迹按鞋底尺寸踩：鞋 26×30cm → 20×30cm（两格宽是鞋宽，三格长顺着行进方向），深 1 格（10cm）
  const dx = P.vel.x > 0 ? 1 : -1, dz = P.vel.z > 0 ? 1 : -1;
  const xLen = Math.abs(P.vel.x) > Math.abs(P.vel.z);
  const clamp9 = v => Math.max(0, Math.min(SUB - 1, v));
  const cells = [];
  for (const a of [0, dx, 2 * dx]) for (const b of [0, 1])
    cells.push(xLen ? [clamp9(lx + a), SUB - 1, clamp9(lz + b)] : [clamp9(lx + b), SUB - 1, clamp9(lz + a)]);
  let bit = false;
  for (const [a, b2, c2] of cells) {
    const k = subIdx(a, b2, c2);
    if (!c.bits[k]) { c.bits[k] = 1; c.n++; bit = true; }
  }
  if (!bit) return;                          // 这格顶面已经踩满了：不再重建网格
  stompCount++;
  if (c.n >= SUB * SUB * SUB) { finishBreak(gx, gy, gz, id, 0); return; }   // 整块被踩散（罕见）
  rebuildCarvedMesh(gx, gy, gz);
  refreshNeighborCarved(gx, gy, gz);
  if (firstBite) rebuildChunkAround(gx, gz);   // 不摘掉区块里的完整顶面，脚印凹坑会被盖住看不见，还跟剩余顶面共面闪烁
  if (c.n === SUB * SUB * SUB / 2) checkAroundForCollapse(gx, gy, gz);
}
function impactCrater(cx, cy, cz, v) {        // 重重摔在松软地面：砸出一片坑，落得越重坑越大越深
  const id = getBlock(cx, cy, cz);
  if (id !== 15 && id !== 17 && id !== 1 && id !== 2) return;   // 沙/雪/草/泥会砸出坑
  const r = Math.max(1, Math.min(3, Math.floor((v - 10) / 3)));
  const depth = v > 21 ? 2 : 1;               // 砸得特别狠：坑深两层（20cm）
  let total = 0;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (dx * dx + dz * dz > r * r + 1) continue;
    const gx = cx + dx, gz = cz + dz;
    const nid = getBlock(gx, cy, gz);
    if (nid !== 15 && nid !== 17 && nid !== 1 && nid !== 2) continue;
    const vi = idx(gx, cy, gz);
    let c = carved.get(vi);
    if (!c) { c = { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null }; carved.set(vi, c); }
    let got = 0;
    for (let sx = 0; sx < SUB; sx++) for (let sz = 0; sz < SUB; sz++)
      for (let sy = SUB - depth; sy < SUB; sy++) {
        const k = subIdx(sx, sy, sz);
        if (!c.bits[k]) { c.bits[k] = 1; c.n++; got++; }
      }
    if (got) {
      total += got;
      const b = BLOCKS[nid], fid = b.frag !== undefined ? b.frag : nid;
      frags[fid] = +((frags[fid] || 0) + b.density * got / (SUB * SUB * SUB)).toFixed(4);
      rebuildCarvedMesh(gx, cy, gz);
    }
  }
  if (total) {
    rebuildChunkAround(cx, cz);
    burst(cx + 0.5, cy + 1, cz + 0.5, BLOCKS[id].color, 10);
    noiseHit(160, 0.2, 0.3);
    gainFeed('砸出坑 + ' + Math.round(BLOCKS[id].density * total) + 'g ' + BLOCKS[id].matName);
    checkAroundForCollapse(cx, cy, cz);       // 砸坑也可能把松软的边缘震塌
  }
}
function finishBreak(x, y, z, id, extraMass) {  // 整块碎掉：优先整块捡进手里（满了才散成材料），清除雕刻数据
  removeShapeMesh(x, y, z);
  removeCarvedMesh(x, y, z);
  carved.delete(idx(x, y, z));
  glued.delete(idx(x, y, z));                   // 挖掉就不再是放置/粘合状态
  placedBlocks.delete(idx(x, y, z));
  if (id === 22 || id === 23) unregisterFire(id, idx(x, y, z));   // 火把/营火被挖掉：从火光注册表除名
  setBlockAndRebuild(x, y, z, 0);
  if (id === 21) rebuildMushrooms();                 // 蘑菇走合并网格：world 变了要重建
  if (id === 21) {                            // 蘑菇：直接进食物袋（蛋白质）
    food.mushroom++;
    gainFeed('+1 蘑菇（蛋白质）');
    tone(750, 0.08, 0.1, 'sine', 1.3);
    updateItemsUI();
    burst(x, y, z, BLOCKS[21].color, 6);
    checkGoals();
    return;
  }
  const b = BLOCKS[id];
  const fid = b.frag !== undefined ? b.frag : id;
  if (extraMass > 0.0001) {
    if (addToHands(id, 1)) {                 // 手里接得住：整块拿走，只剩 ±10% 的碎屑散装材料
      const dust = Math.max(0, +(extraMass - b.density).toFixed(3));
      if (dust > 0.0001) frags[fid] = +((frags[fid] || 0) + dust).toFixed(3);
      gainFeed('+1 ' + b.name + '（拿在手里）');
    } else {                                 // 双手都满：散成材料质量
      frags[fid] = +((frags[fid] || 0) + extraMass).toFixed(3);
      gainFeed('手满了！+' + fmtMass(extraMass) + ' ' + b.matName);
    }
  }
  if (id === 3) stonesMined++;
  burst(x, y, z, b.color);
  sfxBreak(id);
  if (id === 5) {                            // 挖树叶掉食物：苹果（碳水）/ 浆果（碳水+纤维）
    const r = Math.random();
    if (r < 0.18) { food.apple++; tone(700, 0.08, 0.12, 'sine', 1.3); }
    else if (r < 0.30) { food.berry++; tone(900, 0.08, 0.12, 'sine', 1.3); }
    updateItemsUI();
  }
  checkGoals();
  checkAroundForCollapse(x, y, z);           // 挖掉一块后：周围失去支撑的会塌
}

/* ---- 粘稠度与塌落：方块之间连接要花"粘稠预算"，连不回地面就整体塌落 ---- */
function cohesionOf(x, y, z, id) {           // 这一块的实际粘稠度：材料范围内按位置确定性随机
  const r = BLOCKS[id].coh;
  return r[0] + hash2(x * 7 + y * 101, z * 13 + y * 57, SEED + 555) * (r[1] - r[0]);
}
function supported(x, y, z) {                // 从这块出发洪泛：粘稠预算 1.0 内能连到"脚下有实体"的方块 = 稳
  const startId = world[idx(x, y, z)];
  if (!startId || startId === 8 || SHAPES[startId]) return null;
  const best = new Map([[idx(x, y, z), 0]]);
  const open = [{ x, y, z, cost: 0 }];
  let visited = 0;
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);    // 节点不多，直接挑最便宜的扩展
    const cur = open.shift();
    if (cur.cost > (best.get(idx(cur.x, cur.y, cur.z)) ?? 9)) continue;   // 旧条目
    visited++;
    if (visited > 256) return null;          // 连通体太大：默认当稳固（保性能）
    if (cur.y === 0) return null;            // 世界底层 = 天然支撑
    if (glued.has(idx(cur.x, cur.y, cur.z))) return null;   // 粘合剂固定的方块 = 锚点，永远稳
    const belowId = world[idx(cur.x, cur.y - 1, cur.z)];
    if (belowId && belowId !== 8 && BLOCKS[belowId].coh[0] >= 0.15) return null;   // 脚下是"扎实"材料 = 接地（树叶不算）
    const curId = world[idx(cur.x, cur.y, cur.z)];
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = cur.x + d[0], ny = cur.y + d[1], nz = cur.z + d[2];
      if (nx < 0 || nx >= WX || ny < 0 || ny >= WY || nz < 0 || nz >= WZ) continue;
      const nid = world[idx(nx, ny, nz)];
      if (!nid || nid === 8 || SHAPES[nid]) continue;
      // 同材料：粘稠度越低越难借力（树叶一环就断，石头能连很远）；不同材料：钉住就算搭上
      let step = nid === curId ? (1 - cohesionOf(nx, ny, nz, nid)) * 1.15 : 0.12;
      const cc = carved.get(idx(nx, ny, nz));
      if (cc && cc.n >= SUB * SUB * SUB / 2) step *= 2;   // 被咬掉一半的方块传力变弱
      const nc = cur.cost + step;
      if (nc >= 1) continue;
      const k = idx(nx, ny, nz);
      if (nc < (best.get(k) ?? 9)) { best.set(k, nc); open.push({ x: nx, y: ny, z: nz, cost: nc }); }
    }
  }
  return [...best.keys()].map(k => {         // 预算走遍了也没接地 → 全都悬空，返回名单
    const v = k / WY | 0;
    return [Math.floor(v / WZ), k % WY, v % WZ];
  });
}
function makeVoxMesh(px, py, pz, id) {       // 完整方块的独立网格（塌落下落时用）
  const pos = [], nor = [], col = [], uvs = [], ind = [];
  const jit = blockJitter(px, py, pz);
  for (const F of FACES) {
    const uvR = tileUV(tileFor(id, F));
    const a = pos.length / 3;
    for (const v of F.v) {
      pos.push(px + v[0], py + v[1], pz + v[2]);
      nor.push(F.n[0], F.n[1], F.n[2]);
      uvs.push(uvR.u0 + v[F.uv[0]] * (uvR.u1 - uvR.u0), uvR.v0 + v[F.uv[1]] * (uvR.v1 - uvR.v0));
      col.push(F.s * jit, F.s * jit, F.s * jit);
    }
    ind.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(ind);
  return new THREE.Mesh(geo, blockMaterial);
}
const fallers = [];                          // 正在下落的东西：{ x,y,z, vy, id|small 信息, mesh, coh, startY }
const placedBlocks = new Set();              // 玩家放置的整块方块（体素索引）：没粘合的会被撞倒
const glued = new Set();                     // 用粘合剂固定过的方块：锚死不塌、撞不倒
let glue = 0;                                // 粘合剂库存
function knockBlock(x, y, z, vx, vz) {       // 把一个没固定的方块撞飞（带玩家冲量）；造型撞碎直接散料
  const vi = idx(x, y, z), id = world[vi];
  if (!id || id === 8) return false;
  removeShapeMesh(x, y, z);
  removeCarvedMesh(x, y, z);
  carved.delete(vi);
  glued.delete(vi);
  placedBlocks.delete(vi);
  if (id === 22 || id === 23) unregisterFire(id, vi);   // 火把/营火被撞碎：火光除名（散回木料）
  world[vi] = 0;
  if (id === 21) rebuildMushrooms();               // 蘑菇合并网格重建
  rebuildChunkAround(x, z);
  refreshNeighborCarved(x, y, z);
  detachLooseSmall(x, y, z);
  burst(x + 0.5, y + 0.5, z + 0.5, BLOCKS[id].color, 6);
  if (SHAPES[id]) {                          // 造型没有独立碰撞体，撞飞复杂：直接撞碎散料
    const fid = BLOCKS[id].frag !== undefined ? BLOCKS[id].frag : id;
    const mass = SHAPES[id].size[0] * SHAPES[id].size[1] * SHAPES[id].size[2] * BLOCKS[id].density;
    frags[fid] = +((frags[fid] || 0) + mass).toFixed(4);
    noiseHit(600, 0.08, 0.15);
    checkGoals();
    return true;
  }
  const mesh = makeVoxMesh(x, y, z, id);
  mesh.geometry.translate(-x - 0.5, -y - 0.5, -z - 0.5);   // 几何挪到以方块中心为原点：翻滚才绕自己转（不然绕世界原点公转）
  scene.add(mesh);
  fallers.push({ x, y, z, vx, vz, vy: 1.6, id, mesh, coh: 0.5, startY: y, startX: x, startZ: z,
    rx: (Math.random() - 0.5) * 5, rz: (Math.random() - 0.5) * 5 });   // 撞飞的刚体带翻滚角速度
  noiseHit(500, 0.1, 0.2);
  return true;
}
function shatterFaller(f, i) {               // 下落中散架：直接变材料（叶子一碰就散，摔太狠也散）
  const b = BLOCKS[f.id];
  const fid = b.frag !== undefined ? b.frag : f.id;
  const mass = f.small ? f.mass : b.density;
  frags[fid] = +((frags[fid] || 0) + mass).toFixed(4);
  gainFeed('塌落散开 +' + (mass * 1000).toFixed(1) + 'g ' + b.matName);
  burst(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z), b.color, 8);
  noiseHit(600, 0.08, 0.15);
  scene.remove(f.mesh);
  f.mesh.geometry.dispose();
  fallers.splice(i, 1);
}
function updateFallers(dt) {                 // 每帧：下落（可带水平冲量）→ 撞到实体就落回世界（或散架）
  for (let i = fallers.length - 1; i >= 0; i--) {
    const f = fallers[i];
    f.vy = Math.max((f.vy ?? 0) - GRAV * dt, -28);
    if (f.vx || f.vz) {                      // 被撞飞的水平冲量：前方有实体就停
      const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
      const cx = Math.floor(nx + (f.small ? f.s / 2 : 0.5)), cz = Math.floor(nz + (f.small ? f.s / 2 : 0.5));
      const cy = Math.floor(f.y + (f.small ? f.s / 2 : 0.5));
      if (cx < 0 || cx >= WX || cz < 0 || cz >= WZ || cy < 0 || isSolidBlock(cx, cy, cz)) f.vx = f.vz = 0;
      else { f.x = nx; f.z = nz; }
    }
    const ny = f.y + f.vy * dt;
    const fell = f.startY - ny;
    const bottomCell = Math.floor(ny - 0.001);
    const fx = Math.floor(f.x), fz = Math.floor(f.z);
    if (bottomCell < 0 || isSolidBlock(fx, bottomCell, fz)) {
      const landY = bottomCell + 1;
      // 砸到玩家：按方块中心格比较（旧代码用最小角格，半数情况砸不中），按下落力度扣血
      const fcx = Math.floor(f.x + (f.small ? f.s / 2 : 0.5)), fcz = Math.floor(f.z + (f.small ? f.s / 2 : 0.5));
      if (fcx === Math.floor(P.pos.x) && fcz === Math.floor(P.pos.z)) {
        const pTop = P.pos.y + P.ph;
        if (landY < pTop && landY + 1 > P.pos.y) {
          const dmg = Math.round(Math.min(30, Math.abs(f.vy) * 1.8));
          if (dmg > 0) hurt(dmg, '你被塌下来的' + BLOCKS[f.id].name + '砸中了');
        }
      }
      if (fell > 6 || f.coh < 0.15) { shatterFaller(f, i); continue; }   // 摔碎了
      if (f.small) {
        subVox.push({ x: f.x, y: landY, z: f.z, sx: f.s, sy: f.s, sz: f.s, mat: f.mat, mass: f.mass, mesh: f.mesh });
        f.mesh.position.set(f.x + f.s / 2, landY + f.s / 2, f.z + f.s / 2);
        f.mesh.rotation.set(0, 0, 0);        // 落地摆正（下落中在翻滚）
      } else {
        f.mesh.geometry.dispose();
        const landVi = idx(fx, landY, fz), landId = world[landVi];
        if (landId === 22 || landId === 23) unregisterFire(landId, landVi);   // 砸进火把格子：火被压灭
        world[landVi] = f.id;
        rebuildChunkAround(fx, fz);
        refreshNeighborCarved(fx, landY, fz);
        scene.remove(f.mesh);
      }
      noiseHit(300, 0.06, 0.12);
      fallers.splice(i, 1);
      continue;
    }
    f.y = ny;
    f.mesh.position.set(f.x + (f.small ? f.s / 2 : 0.5), f.y + (f.small ? f.s / 2 : 0.5), f.z + (f.small ? f.s / 2 : 0.5));   // 几何以中心为原点：位置=中心，翻滚绕自身
    if (f.rx || f.rz) {                       // 翻滚中的刚体：落地前一直转
      f.mesh.rotation.x += f.rx * dt;
      f.mesh.rotation.z += f.rz * dt;
    }
    if (f.coh < 0.15 && fell > 1.5) shatterFaller(f, i);                 // 叶子类在空中就散
  }
}
function detachLooseSmall(x, y, z) {         // 放置的小方块失去了脚下的方块 → 掉下来
  for (let i = subVox.length - 1; i >= 0; i--) {
    const o = subVox[i];
    if (Math.floor(o.x) !== x || Math.floor(o.z) !== z) continue;
    if (Math.floor(o.y) !== y + 1) continue; // 小方块正好站在这块的顶上
    subVox.splice(i, 1);
    fallers.push({ x: o.x, y: o.y, z: o.z, vy: 0, small: true, s: o.sx, mat: o.mat, mass: o.mass,
      mesh: o.mesh, coh: cohesionOf(x, y, z, o.mat), startY: o.y, id: o.mat,
      rx: (Math.random() - 0.5) * 3, rz: (Math.random() - 0.5) * 3 });   // 掉落的小方块也翻滚
  }
}
function checkAroundForCollapse(x, y, z) {   // 一块消失后：上下四周 + 失去根基的小方块都查一遍
  detachLooseSmall(x, y, z);
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (nx < 0 || nx >= WX || ny < 0 || ny >= WY || nz < 0 || nz >= WZ) continue;
    const nid = world[idx(nx, ny, nz)];
    if (!nid || nid === 8 || SHAPES[nid]) continue;
    const bad = supported(nx, ny, nz);
    if (bad) {
      showToast('塌方了！');
      const dirty = new Set();
      for (const [cx, cy, cz] of bad) {
        const vi = idx(cx, cy, cz), id = world[vi];
        if (!id || id === 8) continue;
        removeShapeMesh(cx, cy, cz);
        removeCarvedMesh(cx, cy, cz);
        carved.delete(vi);
        glued.delete(vi);                       // 塌走了就不再是放置/粘合状态
        placedBlocks.delete(vi);
        world[vi] = 0;
        detachLooseSmall(cx, cy, cz);        // 塌落方块顶上的小方块也跟着掉
        refreshNeighborCarved(cx, cy, cz);   // 邻块的洞壁暴露面也变了
        const mesh = makeVoxMesh(cx, cy, cz, id);
        mesh.geometry.translate(-cx - 0.5, -cy - 0.5, -cz - 0.5);   // 以方块中心为原点（同上：翻滚绕自身）
        scene.add(mesh);
        fallers.push({ x: cx, y: cy, z: cz, vy: 0, id, mesh, coh: cohesionOf(cx, cy, cz, id), startY: cy, startX: cx, startZ: cz,
          rx: (Math.random() - 0.5) * 1.6, rz: (Math.random() - 0.5) * 1.6 });   // 塌落刚体也慢慢翻滚
        dirty.add((cx >> 4) + ',' + (cz >> 4));
        if ((cx & 15) === 0  && cx > 0)      dirty.add(((cx >> 4) - 1) + ',' + (cz >> 4));
        if ((cx & 15) === 15 && cx < WX - 1) dirty.add(((cx >> 4) + 1) + ',' + (cz >> 4));
        if ((cz & 15) === 0  && cz > 0)      dirty.add((cx >> 4) + ',' + ((cz >> 4) - 1));
        if ((cz & 15) === 15 && cz < WZ - 1) dirty.add((cx >> 4) + ',' + ((cz >> 4) + 1));
      }
      dirty.forEach(k => { const [a, b2] = k.split(',').map(Number); rebuildChunk(a, b2); });
      for (const [cx, cy, cz] of bad) checkAroundForCollapse(cx, cy, cz);   // 级联：挂在塌方体上的继续塌
    }
  }
}

/* =====================================================
 * 五、玩家物理（第一人称，分轴碰撞）
 * ===================================================== */
const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: Math.PI * 0.75, pitch: -0.1, onGround: false,
  xp: 0, level: 1,                         // 经验与力量等级（成长系统）
  hp: 100, hunger: 10, thirst: 10,         // 生命 / 饥饿 / 缺水：生命满值 100（10 格），其余 10 格
  stam: 100, exhausted: false,             // 体力：疾跑消耗，耗尽后要歇回 25 才能再跑
  cold: 0, hot: 0,                         // 寒冷 / 炎热：气温离舒适区越远积得越快，满了开始冻伤/中暑
  stunT: 0, roll: 0,                       // 绊倒硬直 / 镜头侧倾
  climbing: false, shakeT: 0,               // 贴墙攀爬中 / 撞墙镜头震动
  muscle: 32, fatPct: 15,                   // 硬核体质：肌肉量 kg（默认 32）/ 体脂率 %（默认 15）→ BMR≈1394 kcal/日
  calPool: 800, proPool: 20, actT: 0,       // 营养池：胃里热量 kcal / 蛋白 g / 近期运动量（长肌肉要练）
  stance: 0, ph: 1.75, eyeH: 1.58,        // 姿态：0站立 1蹲下 2趴下（C 蹲 X 趴）
};
// 姿态表：身高 / 眼睛高度 / 移动速度倍率。泥土这种松软材料必须蹲/趴才能挖
const STANCES = [
  { name: '站立', ph: 1.75, eye: 1.58, mult: 1 },
  { name: '蹲下', ph: 1.35, eye: 1.06, mult: 0.5 },
  { name: '趴下', ph: 0.7,  eye: 0.48, mult: 0.3 },
];
function applyStance() { const s = STANCES[P.stance]; P.ph = s.ph; P.eyeH = s.eye; }
function updateStance() {                    // 每帧：按住 X 趴 / C 蹲；起身要检查头顶有没有空间
  const want = keys['KeyX'] ? 2 : (keys['KeyC'] ? 1 : 0);
  if (want === P.stance) return;
  if (want > P.stance) { P.stance = want; applyStance(); return; }   // 蹲/趴随时可以
  const s = STANCES[want];                   // 想起身：身体要占的空间不能被挡
  const bx = Math.floor(P.pos.x), bz = Math.floor(P.pos.z);
  for (let yy = Math.floor(P.pos.y + 0.05); yy <= Math.floor(P.pos.y + s.ph - 0.05); yy++) {
    if (yy < 0) return;                      // 世界底层
    if (yy >= WY || bx < 0 || bx >= WX || bz < 0 || bz >= WZ) continue;
    const v = world[idx(bx, yy, bz)];
    if (!v || v === 8 || BLOCKS[v].soft) continue;
    const sh = SHAPES[v];
    if (sh && yy + sh.size[1] <= P.pos.y + 0.05) continue;   // 站在台阶/薄板顶上：造型不高于脚面，不挡起身
    return;                                  // 头顶有实心方块：起不来
  }
  P.stance = want; applyStance();
};
function isSolidBlock(x, y, z) {            // 物理碰撞判断：水不挡路，世界边缘是隐形墙
  if (y < 0) return true;
  if (y >= WY) return false;
  if (x < 0 || x >= WX || z < 0 || z >= WZ) return true;
  const v = world[idx(x, y, z)];
  return v !== 0 && v !== 8;
}
function blocksPlayer(x, y, z) {            // 玩家的碰撞：柔性材料（树叶）可以穿过，但仍可被瞄准挖掘
  if (y < 0) return true;                   // 被咬过的方块也不算整格实心——细节碰撞交给 10cm 子格系统（否则掉不进挖出来的坑）
  if (y >= WY) return false;
  if (x < 0 || x >= WX || z < 0 || z >= WZ) return true;
  const v = world[idx(x, y, z)];
  if (!v || v === 8 || BLOCKS[v].soft || BLOCKS[v].noCollide) return false;   // 火把/营火可穿行（能瞄准能挖，就是不绊人）
  return !carved.has(idx(x, y, z));
}
function moveAxis(axis, amount) {
  if (!amount) return;
  P.pos[axis] += amount;
  const minX = P.pos.x - HALF, maxX = P.pos.x + HALF;
  const minY = P.pos.y,       maxY = P.pos.y + P.ph;
  const minZ = P.pos.z - HALF, maxZ = P.pos.z + HALF;
  for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-9); x++)
    for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-9); y++)
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-9); z++) {
        if (!blocksPlayer(x, y, z)) continue;
        if (axis !== 'y' && y >= 0 && y < WY && x >= 0 && x < WX && z >= 0 && z < WZ) {
          // 水平撞上造型：只挡它实际占的那截高度（站在同级台阶上能直接走过去，不用跳）
          const sh = SHAPES[world[idx(x, y, z)]];
          if (sh && y + sh.size[1] <= minY + 1e-3) continue;
        }
        if (axis === 'x') { P.pos.x = amount > 0 ? x - HALF - 1e-4 : x + 1 + HALF + 1e-4; P.vel.x = 0; lastWallHit = { x, y, z }; }
        else if (axis === 'y') {
          if (amount > 0) {
            P.pos.y = y - P.ph - 1e-4;
          } else {
            // 造型（台阶/小石块/薄石板…）按实际高度碰撞：站在它的"顶面"上
            const cellId = world[idx(x, y, z)];
            const sh = SHAPES[cellId];
            const topY = sh ? y + sh.size[1] : y + 1;
            P.pos.y = topY + 1e-4;
            P.onGround = true;
          }
          P.vel.y = 0;
        }
        else { P.pos.z = amount > 0 ? z - HALF - 1e-4 : z + 1 + HALF + 1e-4; P.vel.z = 0; lastWallHit = { x, y, z }; }
      }
}
function respawn() {
  // 出生点要避开水面/树叶顶：从世界中心螺旋往外找第一块硬实地
  const CX = WX >> 1, CZ = WZ >> 1;
  let sx = CX, sz = CZ;
  outer:
  for (let r = 0; r < 40; r++) for (let x = CX - r; x <= CX + r; x++) for (let z = CZ - r; z <= CZ + r; z++) {
    if (Math.max(Math.abs(x - CX), Math.abs(z - CZ)) !== r) continue;
    const top = topAt(x, z);
    const tid = world[idx(x, top, z)];
    if (tid && tid !== 8 && !BLOCKS[tid].soft && !SHAPES[tid]) { sx = x; sz = z; break outer; }   // 硬实地：树叶顶/水塘顶不算（会掉进水里）
  }
  const top = topAt(sx, sz);
  P.pos.set(sx + 0.5, top + 1, sz + 0.5);
  P.vel.set(0, 0, 0);
  P.hp = 100; P.hunger = 10; P.thirst = 10; P.cold = 0; P.hot = 0;
  P.stam = 100; P.exhausted = false; wasExhausted = false;   // 重生把体力也喘满
  P.calPool = 800; P.proPool = 20; P.actT = 0;               // 营养池回满（饿死/冻死重来）
  if (typeof updateStatusUI === 'function' && cellEls.hp.length) updateStatusUI();
}
let lastFallVy = 0;                          // 下落过程中的竖直速度（落地瞬间用它算摔伤）
let prevStrafe = 0;                          // 上一帧有没有按着 A/D（绊倒看的是"突然按下去"那一刻）
let wasExhausted = false;                    // 上一子步是否已力竭（只在"刚力竭"那一刻弹提示）
let lastWallHit = null;                      // 这一子步水平撞上的方块格（冲撞撞倒 / 反弹要用）
let leafCrashT = 0;                          // 穿越树叶的刮蹭节拍（别每帧都响）
let wallHitCd = 0;                           // 撞墙后果冷却：贴墙按住前进时每个物理子步都会"撞一次"，没冷却血会被机关枪扫掉
let scrambleCd = 0;                          // 蹬踏松散坎的冷却（沙/雪：走上去像上台阶）
let footSide = 1, stompCount = 0;            // 左右脚交替（踩脚印用）/ 脚印总数（调试）
const leafBends = [];                        // 被撞开的树叶：拨弯的形变痕迹，慢慢回弹
function stepPhysics(h) {
  // —— 体力与动量移动：疾跑渐加速、体力见底渐降、松开缓降回巡航、S 是渐进刹车 ——
  // 方向速度分级：正面最快、后退次之、侧移最慢（螃蟹步本来就慢；疾跑中突然侧移会被绊倒）
  let ix = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const iw = keys['KeyW'] ? 1 : 0;
  const isBack = keys['KeyS'] ? 1 : 0;
  const rawStrafe = ix !== 0 ? 1 : 0;
  const fwd = { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) };
  const fdot = P.vel.x * fwd.x + P.vel.z * fwd.z;          // 当前速度里朝前的那份
  // 绊倒：跑得很快时（前向速度 > 5，只有疾跑能到）这一瞬间突然按 A/D 侧移 = 螃蟹步，摔一跤扣 1/4 颗心（2.5 血）
  // 一开始就斜着跑不算（速度是慢慢起来的）；疾跑中按才算，走路速度到不了 5
  if (P.stunT > 0) {                                       // 摔倒硬直：不听输入
    P.stunT -= h; ix = 0;
  } else if (rawStrafe && !prevStrafe && fdot > 5 && P.onGround) {
    hurt(2.5, '你跑太快突然侧移，把自己绊倒了');
    P.stunT = 0.6; P.roll = 0.5;
    P.vel.x *= 0.15; P.vel.z *= 0.15;
  }
  prevStrafe = rawStrafe;
  let iz = iw - isBack;                                    // W 前进，S 后退
  const moving = ix !== 0 || iz !== 0;
  if (moving) { const len = Math.hypot(ix, iz); ix /= len; iz /= len; }
  // 体力：只有按住 Shift 且在移动才疾跑；跑得越快耗得越快；耗尽后歇回 25 才能再跑
  if (P.stam <= 0) P.exhausted = true;
  if (P.exhausted && P.stam >= 25) P.exhausted = false;
  if (P.exhausted && !wasExhausted) showToast('体力耗尽！歇口气，缓到 25% 才能再疾跑/双手刨');
  wasExhausted = P.exhausted;
  const wantSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && moving && P.stance === 0;   // 只有站立能疾跑
  const sprinting = wantSprint && !P.exhausted;
  P.sprinting = sprinting;                    // 记下来：疾跑 FOV 与调试要用
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (sprinting) P.stam = Math.max(0, P.stam - (3 + 7 * Math.min(1, hs / SPRINT)) * effortMult() * h);   // 疾跑耗力×肌肉系数
  else if (!mining.active) P.stam = Math.min(100, P.stam + (moving ? 7 : 14) * h);   // 挖掘时是干活不是休息：只扣不回（扣的量在 updateMining 里按方式算）
  // 目标速度：疾跑上限随体力下滑；方向分级 正面1.0 / 后退0.7 / 侧移0.6；蹲×0.5 趴×0.3
  let dirMult = 1;
  if (iz > 0) dirMult = 1;                                // 正面最快
  else if (iz < 0) dirMult = ix !== 0 ? 0.75 : 0.7;       // 后退次之（斜后混合稍快）
  else if (moving) dirMult = 0.6;                         // 纯侧移最慢
  // 疾跑恒定全速：体力只决定"能跑多久"，不再随体力压速度
  // （旧公式速度=走速+增量×体力%：力竭过一次后体力总在低位，加速只剩约 10%，按 Shift 像完全失灵）
  // 行走三档：W 慢走 2.8 / 双击 W 快走 4.3 / Shift 疾跑 6.5
  const cap = (sprinting ? SPRINT : (fastWalk ? WALK : WALK_SLOW) * STANCES[P.stance].mult) * dirMult
            * (P.cold >= 100 ? 0.7 : 1);      // 冻僵了跑不动
  const tvx = moving ? (-Math.sin(P.yaw) * iz + Math.cos(P.yaw) * ix) * cap : 0;
  const tvz = moving ? (-Math.cos(P.yaw) * iz - Math.sin(P.yaw) * ix) * cap : 0;
  // 动量：疾跑渐加速 8；行走/蹲/趴恒速（即时）；没输入的刹车率看脚下材质摩擦（冰上滑得停不下来）
  const groundId = P.onGround ? getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y - 0.3), Math.floor(P.pos.z)) : 0;
  const groundFric = groundId && BLOCKS[groundId] ? (BLOCKS[groundId].fric ?? 0.8) : 0.8;
  const rate = !moving ? (0.6 + groundFric * 4.4) : (sprinting ? 8 : 30);   // 冰 0.15 → 1.26/s 滑；草 0.7 → 3.7/s 正常刹
  const dx = tvx - P.vel.x, dz = tvz - P.vel.z, dl = Math.hypot(dx, dz);
  if (dl > 1e-4) { const sc = Math.min(1, rate * h / dl); P.vel.x += dx * sc; P.vel.z += dz * sc; }
  // 水里：下沉变慢，空格上浮；陆地上：空格跳跃；面前有抓得住的墙 → 攀爬（跳只有 50cm，1m 的坎靠爬上去）
  const inWater = getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + 0.4), Math.floor(P.pos.z)) === 8
               || getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + 1.5), Math.floor(P.pos.z)) === 8;
  // 攀爬检测：面前 0.55m 处从脚到头扫一遍，取最抓得住的墙面摩擦力（≥0.5 才爬得动）
  // 三种情况不算能爬：①可穿越的软块（树叶能直接穿过去，没得抓）②粘稠度 < 0.3 的松散块（抓上去墙先散）
  // ③正在冲向墙（前向速度 ≥ 2.6 = 撞击：先摔/弹/伤，等速度被墙吃掉才挂上墙开爬）
  let wallFric = 0;
  const climbX = Math.floor(P.pos.x + fwd.x * 0.55), climbZ = Math.floor(P.pos.z + fwd.z * 0.55);
  if (!inWater && climbX >= 0 && climbX < WX && climbZ >= 0 && climbZ < WZ) {
    for (let yy = Math.max(0, Math.floor(P.pos.y + 0.1)); yy <= Math.min(WY - 1, Math.floor(P.pos.y + P.ph - 0.2)); yy++) {
      const wid = world[idx(climbX, yy, climbZ)];
      if (!wid || wid === 8 || BLOCKS[wid].soft) continue;      // 水和可穿越的软块不算墙
      if (BLOCKS[wid].coh[0] < 0.3) continue;                   // 松散材料（粘稠度太低）抓不牢
      const f = BLOCKS[wid].fric ?? 0.7;
      if (f > wallFric) wallFric = f;
    }
  }
  P.wallFric = wallFric;                       // 挂到调试接口上看
  const fdotNow = P.vel.x * fwd.x + P.vel.z * fwd.z;   // 此刻朝前（朝墙）的速度
  const canClimb = !inWater && P.stance === 0 && P.stunT <= 0 && wallFric >= 0.5 && P.stam > 0 && fdotNow < 2.6;
  if (canClimb && iw > 0 && !P.climbing) P.climbing = true;    // 慢速贴墙按住 W 才开始爬
  if (P.climbing && (!canClimb || iw <= 0)) P.climbing = false; // 松开 W / 墙到头 / 没体力：下来
  // 松散坎（沙/雪）：粘滞度低挂不住墙、不能贴墙攀爬——但一踩就陷，可以直接蹬上去一格，
  // 走沙丘雪坡像上台阶。两格以上的松散崖翻不过去：得挖台阶或垫方块
  if (scrambleCd > 0) scrambleCd -= h;
  if (!P.climbing && !inWater && P.stance === 0 && P.onGround && iw > 0 && P.stunT <= 0
      && fdotNow > 0.4 && scrambleCd <= 0
      && climbX >= 0 && climbX < WX && climbZ >= 0 && climbZ < WZ) {
    const fy = Math.floor(P.pos.y + 0.1);
    if (fy >= 0 && fy < WY) {
      const wid = world[idx(climbX, fy, climbZ)];
      const pass = v => !v || v === 8 || (BLOCKS[v] && BLOCKS[v].soft);
      if (wid && wid !== 8 && !BLOCKS[wid].soft && !SHAPES[wid] && BLOCKS[wid].coh[0] < 0.3
          && pass(getBlock(climbX, fy + 1, climbZ)) && pass(getBlock(climbX, fy + 2, climbZ))) {
        P.vel.y = 7.2;                       // 蹬一下：够翻上 1 米的坎
        P.vel.x += fwd.x * 1.5; P.vel.z += fwd.z * 1.5;
        P.stam = Math.max(0, P.stam - 3);
        scrambleCd = 0.45;
        noiseHit(430, 0.07, 0.1);
      }
    }
  }
  if (inWater) {
    if (keys['Space']) {
      // 贴着岸且前面是 1 格高的坎：给一个跃出水面的力，能爬上岸
      const fx2 = -Math.sin(P.yaw), fz2 = -Math.cos(P.yaw);
      const pushing = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
      const wallAtFeet = blocksPlayer(Math.floor(P.pos.x + fx2 * 0.7), Math.floor(P.pos.y + 0.3), Math.floor(P.pos.z + fz2 * 0.7));
      const wallAtHead = blocksPlayer(Math.floor(P.pos.x + fx2 * 0.7), Math.floor(P.pos.y + 1.4), Math.floor(P.pos.z + fz2 * 0.7));
      if (pushing && wallAtFeet && !wallAtHead) P.vel.y = Math.max(P.vel.y, 7.5);
      else P.vel.y = Math.min(P.vel.y + 46 * h, 5);
    }
  } else if (P.climbing) {
    // 贴墙爬：速度看墙面摩擦力（石墙快、土墙慢），空格使劲爬、S 往下退；耗体力
    const spd = 2.3 * wallFric * (P.exhausted ? 0.55 : 1);
    P.vel.y = keys['Space'] ? spd : (isBack ? -spd : spd * 0.55);
    P.vel.x = P.vel.z = 0;
    P.stam = Math.max(0, P.stam - 9 * effortMult() * h);   // 攀爬耗力×肌肉系数
    // 爬到顶（头顶上方没实心了）→ 翻越沿口
    const aboveId = getBlock(climbX, Math.floor(P.pos.y + P.ph + 0.12), climbZ);
    if ((!aboveId || aboveId === 8 || BLOCKS[aboveId].soft) && P.vel.y > 0) {
      P.climbing = false;
      P.vel.y = 4.8; P.vel.x = fwd.x * 3.4; P.vel.z = fwd.z * 3.4;
      tone(300, 0.08, 0.1, 'triangle', 1.4);
    }
  } else if (keys['Space'] && P.onGround) P.vel.y = JUMP;
  if (!P.climbing) P.vel.y = Math.max(P.vel.y - GRAV * (inWater ? 0.22 : 1) * h, inWater ? -4 : -36);
  P.onGround = false;
  const mvy = P.vel.y * h, mvx = P.vel.x * h, mvz = P.vel.z * h;   // 先存本步位移：碰撞把速度清零后，小方块检测仍要用原方向
  moveAxis('y', mvy);
  collideSubVoxAxis('y', mvy);
  collideCarvedAxis('y', mvy);
  if (!P.onGround && P.vel.y < 0) lastFallVy = P.vel.y;    // 还在下落：记下当前落速（落地后保留，供摔伤判定）
  // 刚体碰撞：全速撞墙按力度扣血（速度被清零说明撞实了）
  const preVx = P.vel.x, preVz = P.vel.z;
  lastWallHit = null;                          // 本子步的撞墙记录重新收集（x/z 两趟都可能撞，别互相清掉）
  moveAxis('x', mvx);
  collideSubVoxAxis('x', mvx);
  collideCarvedAxis('x', mvx);
  moveAxis('z', mvz);
  collideSubVoxAxis('z', mvz);
  collideCarvedAxis('z', mvz);
  const slamV = Math.hypot((P.vel.x === 0 ? preVx : 0), (P.vel.z === 0 ? preVz : 0));
  if (wallHitCd > 0) wallHitCd -= h;          // 撞墙后果冷却推进
  if (slamV > 1.5 && lastWallHit) {
    const vi = idx(lastWallHit.x, lastWallHit.y, lastWallHit.z);
    const wid = world[vi];
    if (wid && placedBlocks.has(vi) && !glued.has(vi) && slamV > 3.2 && wallHitCd <= 0) {
      // 撞倒：没粘合的方块被撞飞（带玩家的冲量），玩家只掉速不扣血
      knockBlock(lastWallHit.x, lastWallHit.y, lastWallHit.z,
        (P.vel.x === 0 ? preVx : 0) * 1.1, (P.vel.z === 0 ? preVz : 0) * 1.1);
      P.vel.x = preVx * 0.25; P.vel.z = preVz * 0.25;
      P.shakeT = 0.22;
      wallHitCd = 0.35;
      showToast('撞倒了 ' + BLOCKS[wid].name + '！没粘合的方块一撞就倒');
    } else if (wid) {
      // 反作用力（反弹）：按材质弹性把人弹回去——走路碰墙只被轻轻弹开，不掉血不绊倒
      const mat = BLOCKS[wid];
      const bounce = (mat.bounce ?? 0.2) * 0.85;
      if (P.vel.x === 0 && Math.abs(preVx) > 1) P.vel.x = -preVx * bounce;
      if (P.vel.z === 0 && Math.abs(preVz) > 1) P.vel.z = -preVz * bounce;
      // 撞伤/绊倒只在疾跑级速度（>5.0，走路 4.3 永远够不着）才结算，且带 1.2 秒冷却
      // dmg = (v-5) × 2.2 × (硬度/3) × (1.25 - 平均黏着度×0.5)：越硬越黏越疼，松软材料散开吸冲击
      if (wallHitCd <= 0 && slamV > 5) {
        wallHitCd = 1.2;
        const cohF = (mat.coh[0] + mat.coh[1]) / 2;
        const dmg = (slamV - 5) * 2.2 * (mat.hardness / 3) * (1.25 - cohF * 0.5);
        if (dmg >= 1.2) {                     // 撞伤：附带硬直 + 震屏
          hurt(+(dmg * 10).toFixed(1) / 10, '你全速撞在了' + mat.name + '上');
          P.stunT = Math.max(P.stunT, 0.45); P.roll = 0.4;
          P.shakeT = Math.min(0.3, slamV * 0.03);
        } else {                              // 撞在软/松的东西上：伤害太低，只绊个趔趄
          P.stunT = Math.max(P.stunT, 0.55); P.roll = 0.45;
          P.shakeT = 0.15;
          showToast('跑太快撞上' + mat.name + '，绊了个趔趄');
        }
      }
    } else if (slamV > 6.2 && wallHitCd <= 0) {
      wallHitCd = 1.2;
      hurt(Math.round(Math.min(12, (slamV - 6) * 5)), '你全速撞在了墙上');
      P.shakeT = Math.min(0.3, slamV * 0.03);
    }
  }
  // 软材料（树叶）不做碰撞阻挡：撞击伤害过低 + 反弹过低 → 直接穿越（撞得叶子纷飞、刮点皮、被枝叶拖慢）
  // 刚体角色路过柔性体：枝叶被身体拨开、弹簧式慢慢回弹——留下"有人经过"的形变痕迹
  const midId = getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + P.ph * 0.5), Math.floor(P.pos.z));
  if (midId && midId !== 8 && BLOCKS[midId].soft) {   // 水没有 BLOCKS 表条目，先排除掉
    leafCrashT -= h;
    if (leafCrashT <= 0 && Math.hypot(P.vel.x, P.vel.z) > 2) {
      leafCrashT = 0.35;
      sfxStep(midId);
      burst(P.pos.x, P.pos.y + 0.8, P.pos.z, BLOCKS[midId].color, 4);
      P.vel.x *= 0.9; P.vel.z *= 0.9;
      hurt(0.2, '你撞穿了' + BLOCKS[midId].name);
      // 身体所在格 + 前进方向的下一格：叶子被拨弯（回弹痕迹）
      spawnLeafBend(Math.floor(P.pos.x), Math.floor(P.pos.y + P.ph * 0.5), Math.floor(P.pos.z));
      const aheadX = Math.floor(P.pos.x + P.vel.x * 0.3), aheadZ = Math.floor(P.pos.z + P.vel.z * 0.3);
      spawnLeafBend(aheadX, Math.floor(P.pos.y + P.ph * 0.5), aheadZ);
    }
  }
  if (P.pos.y < -20) respawn();
}
function resolveBoxAxis(axis, amount, ox, oy, oz, w, h, d) {   // 玩家 AABB 与一个盒子做单轴碰撞（小方块 / 10cm 子格共用）
  const minX = P.pos.x - HALF, maxX = P.pos.x + HALF;
  const minY = P.pos.y,       maxY = P.pos.y + P.ph;
  const minZ = P.pos.z - HALF, maxZ = P.pos.z + HALF;
  if (maxX <= ox || minX >= ox + w || maxZ <= oz || minZ >= oz + d || maxY <= oy || minY >= oy + h) return false;
  if (axis === 'y') {
    if (amount > 0) P.pos.y = oy - P.ph - 1e-4;
    else { P.pos.y = oy + h + 1e-4; P.onGround = true; }
    P.vel.y = 0;
  } else if (axis === 'x') {
    P.pos.x = amount > 0 ? ox - HALF - 1e-4 : ox + w + HALF + 1e-4; P.vel.x = 0;
  } else {
    P.pos.z = amount > 0 ? oz - HALF - 1e-4 : oz + d + HALF + 1e-4; P.vel.z = 0;
  }
  return true;
}
function collideSubVoxAxis(axis, amount) {   // 小方块的碰撞：可以站上去，但会实打实挡路（要跳才能上）
  if (!subVox.length || !amount) return;
  for (const o of subVox) {
    if (Math.abs(o.x + o.sx / 2 - P.pos.x) > 3 || Math.abs(o.z + o.sz / 2 - P.pos.z) > 3) continue;
    resolveBoxAxis(axis, amount, o.x, o.y, o.z, o.sx, o.sy, o.sz);
  }
}
function collideCarvedAxis(axis, amount) {   // 被咬过的方块按 10cm 子格碰撞：能掉进挖出来的坑，也能站在半高的坑沿上
  if (!carved.size || !amount) return;
  const SUBV = 1 / SUB;
  const gx0 = Math.floor(P.pos.x - HALF - 0.05), gx1 = Math.floor(P.pos.x + HALF + 0.05);
  const gy0 = Math.max(0, Math.floor(P.pos.y - 0.05)), gy1 = Math.min(WY - 1, Math.floor(P.pos.y + P.ph + 0.05));
  const gz0 = Math.floor(P.pos.z - HALF - 0.05), gz1 = Math.floor(P.pos.z + HALF + 0.05);
  for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) for (let gz = gz0; gz <= gz1; gz++) {
    if (gx < 0 || gx >= WX || gz < 0 || gz >= WZ) continue;
    const bid = world[idx(gx, gy, gz)];
    if (!bid || bid === 8 || BLOCKS[bid].soft) continue;   // 软块（树叶）永远可穿越：咬没咬过都穿得过去
    const c = carved.get(idx(gx, gy, gz));
    if (!c) continue;
    // 只遍历玩家身体覆盖到的子格范围（每块最多 7×19×7 个，不是全 1000 个）
    // 起点用 floor：ceil 会跳过正包着脚的那层子格，站在子格地板上会不停抖
    const sx0 = Math.max(0, Math.floor((P.pos.x - HALF - gx) * SUB + 1e-6)), sx1 = Math.min(SUB - 1, Math.floor((P.pos.x + HALF - gx) * SUB));
    const sy0 = Math.max(0, Math.floor((P.pos.y - gy) * SUB + 1e-6)),         sy1 = Math.min(SUB - 1, Math.floor((P.pos.y + P.ph - gy) * SUB));
    const sz0 = Math.max(0, Math.floor((P.pos.z - HALF - gz) * SUB + 1e-6)), sz1 = Math.min(SUB - 1, Math.floor((P.pos.z + HALF - gz) * SUB));
    for (let sx = sx0; sx <= sx1; sx++) for (let sy = sy0; sy <= sy1; sy++) for (let sz = sz0; sz <= sz1; sz++) {
      if (!isSubSolid(c, sx, sy, sz)) continue;
      if (resolveBoxAxis(axis, amount, gx + sx * SUBV, gy + sy * SUBV, gz + sz * SUBV, SUBV, SUBV, SUBV)) {
        if (axis !== 'y') lastWallHit = { x: gx, y: gy, z: gz };   // 撞上咬过的墙也计入撞击判定
        return;
      }
    }
  }
}
function physics(dt) {                      // 子步进，防止高速穿墙
  const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) stepPhysics(h);
}

/* =====================================================
 * 六、输入与指针锁定
 * ===================================================== */
let state = 'start';                        // start / playing / paused
let playingSince = 0;                       // 进入游戏时刻（用于忽略误触点击）
const keys = {};

let lastWDown = 0, fastWalk = false;          // 双击 W 检测：280ms 内连按两次 → 快走档，松开 W 回慢走
addEventListener('keydown', e => {
  initAudio();                               // 任何按键都可激活声音
  keys[e.code] = true;
  if (e.code === 'Space' && state === 'playing') e.preventDefault();
  if (e.code === 'KeyW' && !e.repeat && state === 'playing') {
    const now = performance.now();
    if (now - lastWDown < 280 && !fastWalk) {
      fastWalk = true;
      showToast('快走 · 按 Shift 疾跑更快');
    }
    lastWDown = now;
  }
  if (e.code === 'KeyM' && !e.repeat) {
    muted = !muted;
    savePref('muted', muted ? '1' : '0');
    showToast(muted ? '已静音' : '声音开启');
  }
  if (e.code === 'KeyE' && !e.repeat) {
    if (state === 'playing') openCraft();
    else if (state === 'craft') closeCraft();
  }
  if (e.code === 'KeyF' && state === 'playing' && !e.repeat) eat();
  if (e.code === 'KeyR' && state === 'playing' && !e.repeat) drink();
  if (state === 'playing' && e.code === 'KeyG' && !e.repeat) {   // G：循环切换放置尺寸（按住不会连跳档位）
    placeSizeIdx = ((placeSizeIdx + 1) % PLACE_SIZES.length + PLACE_SIZES.length) % PLACE_SIZES.length;
    savePref('placeSize', placeSizeIdx);
    showHandName();
    updateSizeTag();
  }
  if (e.code === 'KeyN' && !e.repeat && state === 'playing') {   // N：画质档位（渲染分辨率），卡就往下调
    renderScaleIdx = (renderScaleIdx + 1) % RENDER_SCALES.length;
    applyRenderScale();
    try { localStorage.setItem('bx_res', String(renderScaleIdx)); } catch (e) {}
    showToast('渲染分辨率 ' + Math.round(RENDER_SCALES[renderScaleIdx] * 100) + '%');
  }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state === 'playing' && !e.repeat && P.stance !== 0)
    showToast(P.stance === 1 ? '蹲着跑不动 —— 松开 C 站起来再疾跑' : '趴着跑不动 —— 松开 X 站起来再疾跑');
  if (e.code === 'Escape' && state === 'playing' && document.pointerLockElement !== renderer.domElement) {
    setState('paused');   // 兜底：正常情况 Esc 走「退指针锁→自动暂停」，浏览器拦掉重锁时这里直接暂停
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyW') fastWalk = false;    // 松开 W：快走档复位，下次要重新双击
});
addEventListener('blur', () => {              // 切出窗口时松开所有按键，防止人物自己跑个不停
  for (const k in keys) keys[k] = false;
  fastWalk = false;
  mining.active = false;
});
addEventListener('keydown', e => {          // F5/V：第一人称 ↔ 第三人称（拦下 F5 防止刷新页面）
  if ((e.code === 'F5' || e.code === 'KeyV') && state !== 'start') {
    e.preventDefault();
    viewMode = viewMode === 'first' ? 'third' : 'first';
    savePref('view', viewMode);
    showToast(viewMode === 'third' ? '第三人称视角' : '第一人称视角');
  }
});
document.addEventListener('mousemove', e => {
  if (state !== 'playing' || document.pointerLockElement !== renderer.domElement) return;
  if (!isFinite(e.movementX) || !isFinite(e.movementY)) return;   // 防御：个别事件会带非数值，进了视角就再也打不准
  P.yaw -= e.movementX * 0.0022 * sensMult;
  P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - e.movementY * 0.0022 * sensMult));
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') setState('paused');
});
function lockPointer() { try { renderer.domElement.requestPointerLock(); } catch (e) { /* 无所谓，键鼠操作仍可用 */ } }

/* =====================================================
 * 七、射线拾取：挖方块 / 放方块 / 选中高亮
 * ===================================================== */
const camDir = new THREE.Vector3();
const _voxPoint = new THREE.Vector3();       // 命中点复用对象：每帧要做好几次射线，别再 clone 了
function raycastVoxel() {                   // 从眼睛沿视线步进，找第一个实体方块（第三人称也以眼睛为准）
  const o = eyePos(), dir = viewDir();
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tdX = Math.abs(1 / (dir.x || 1e-10)), tdY = Math.abs(1 / (dir.y || 1e-10)), tdZ = Math.abs(1 / (dir.z || 1e-10));
  let tmX = (stepX > 0 ? x + 1 - o.x : o.x - x) * tdX;
  let tmY = (stepY > 0 ? y + 1 - o.y : o.y - y) * tdY;
  let tmZ = (stepZ > 0 ? z + 1 - o.z : o.z - z) * tdZ;
  let face = null, t = 0;
  for (let i = 0; i < 256 && t <= REACH; i++) {
    if (isSolidBlock(x, y, z)) return { x, y, z, face, t, point: _voxPoint.copy(o).addScaledVector(dir, t) };
    if (tmX < tmY && tmX < tmZ)      { x += stepX; t = tmX; tmX += tdX; face = [-stepX, 0, 0]; }
    else if (tmY < tmZ)              { y += stepY; t = tmY; tmY += tdY; face = [0, -stepY, 0]; }
    else                             { z += stepZ; t = tmZ; tmZ += tdZ; face = [0, 0, -stepZ]; }
  }
  return null;
}
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111 })
);
highlight.visible = false;
const highlightGroup = new THREE.Group();    // 开关包一层：瞄准黑线框默认关闭（干扰视线），设置里可开
highlightGroup.add(highlight);
scene.add(highlightGroup);
const settings = { wireframe: (() => { try { return localStorage.getItem('bx_wire') === '1'; } catch (e) { return false; } })() };
highlightGroup.visible = settings.wireframe;
function setWireframe(v) {
  settings.wireframe = v;
  highlightGroup.visible = v;
  try { localStorage.setItem('bx_wire', v ? '1' : '0'); } catch (e) { /* 无痕模式存不了就算了 */ }
  showToast(v ? '瞄准线框：开' : '瞄准线框：关');
}

/* ---- 微型件：独立小件系统（10cm 级，自由位置，不占体素格） ---- */
const subVox = [];                            // { x,y,z(最小角), sx,sy,sz, mKey, mat, mass, mesh }
const subRay = new THREE.Raycaster();
function raySubVox() {                        // 对所有微型件做精确射线检测 + 小目标宽容拾取
  if (!subVox.length) return null;
  subRay.set(eyePos(), viewDir());            // 与挖方块的射线同源（第三人称也对得上）
  const hits = subRay.intersectObjects(subVox.map(o => o.mesh));
  if (hits.length && hits[0].distance <= REACH) {
    const mesh = hits[0].object;
    const obj = subVox.find(o => o.mesh === mesh);
    if (obj) return { obj, dist: hits[0].distance, point: hits[0].point, normal: hits[0].face ? hits[0].face.normal : null };
  }
  // 宽容拾取：准星射线离物体中心足够近（半径+12cm）也算命中，10cm 级目标才好点
  const origin = subRay.ray.origin, dir = subRay.ray.direction;
  let best = null;
  for (const o of subVox) {                  // 纯标量运算，避免每帧 new 一堆 Vector3
    const tx = o.x + o.sx / 2 - origin.x, ty = o.y + o.sy / 2 - origin.y, tz = o.z + o.sz / 2 - origin.z;
    const along = tx * dir.x + ty * dir.y + tz * dir.z;
    if (along < 0 || along > REACH) continue;
    const perp2 = tx * tx + ty * ty + tz * tz - along * along;
    const r = Math.max(o.sx, o.sy, o.sz) / 2 + 0.12;
    if (perp2 <= r * r && (!best || along < best.along)) best = { obj: o, dist: along };
  }
  return best ? { obj: best.obj, dist: best.dist, point: null, normal: null } : null;
}
function rayAny() {                           // 统一瞄准：微型件与体素取更近者
  const v = raycastVoxel();
  const s = raySubVox();
  if (s && (!v || s.dist < v.t)) return { type: 'sub', obj: s.obj, dist: s.dist, point: s.point, normal: s.normal };
  if (v) return { type: 'vox', x: v.x, y: v.y, z: v.z, face: v.face, t: v.t, point: v.point };
  return null;
}
let _rayFrame = null, _rayReady = false;      // 每帧只做一次瞄准射线：高亮 / 挖掘 / 放置预览共用
function frameRay() { if (!_rayReady) { _rayFrame = rayAny(); _rayReady = true; } return _rayFrame; }
function removeSubVox(obj) {
  scene.remove(obj.mesh);
  obj.mesh.geometry.dispose();
  const i = subVox.indexOf(obj);
  if (i >= 0) subVox.splice(i, 1);
}
const ghost = new THREE.Mesh(                 // 放置预览：半透明+白边，大小 = 将要放出的实际大小
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false })
);
ghost.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)),
  new THREE.LineBasicMaterial({ color: 0xffffff })
));
ghost.visible = false;
scene.add(ghost);

const aimTipEl = document.getElementById('aimTip');
function aimTip(text) {                       // 准星旁小字：看着什么 / 将放什么 / 多大
  if (aimTipEl._t === text) return;
  aimTipEl._t = text;
  aimTipEl.textContent = text;
  aimTipEl.style.display = text ? 'block' : 'none';
}
const sizeText = s => {                       // [0.1,0.1,0.1] -> "10cm"；长方形 -> "40×10×40cm"
  const cm = s.map(v => Math.round(v * 100));
  return cm.every(v => v === cm[0]) ? cm[0] + 'cm' : cm.join('×') + 'cm';
};
const smallSize = () => PLACE_SIZES[placeSizeIdx];                  // 当前放置尺寸
const smallCost = (id, s) => +(s * s * s * BLOCKS[id].density);     // 小方块造价 = 体积×密度(kg)
function getSmallPlace(id, s, ray) {          // 小方块落点：贴命中面 + 准星指向点 + 5cm 吸附（预览与真放置共用）
  const t = ray || rayAny();                  // 预览时直接复用本帧已算好的射线
  if (!t) return null;
  let px, py, pz, nx, ny, nz;
  if (t.type === 'sub') {
    if (t.point) { px = t.point.x; py = t.point.y; pz = t.point.z; }
    else { const o = t.obj; px = o.x + o.sx / 2; py = o.y + o.sy / 2; pz = o.z + o.sz / 2; }
    nx = t.normal ? t.normal.x : 0; ny = t.normal ? t.normal.y : 1; nz = t.normal ? t.normal.z : 0;
  } else {
    if (!t.point || !t.face) return null;      // 视线起点就在方块里：没有可贴的面
    px = t.point.x; py = t.point.y; pz = t.point.z;   // 用准星指的确切位置，不吸附到格子中心
    nx = t.face[0]; ny = t.face[1]; nz = t.face[2];
  }
  const snap = v => Math.round(v / 0.05) * 0.05;
  const x = +(snap(px + nx * s / 2) - s / 2).toFixed(3);
  const y = +(snap(py + ny * s / 2) - s / 2).toFixed(3);
  const z = +(snap(pz + nz * s / 2) - s / 2).toFixed(3);
  // 覆盖到的格子都不能是实体（只查中心会让小方块斜着穿进邻格的墙里）
  const eps = 1e-4;
  for (let ax = Math.floor(x + eps); ax <= Math.floor(x + s - eps); ax++)
    for (let ay = Math.floor(y + eps); ay <= Math.floor(y + s - eps); ay++)
      for (let az = Math.floor(z + eps); az <= Math.floor(z + s - eps); az++)
        if (isSolidBlock(ax, ay, az)) return null;
  // 不能和其他小方块重叠
  for (const o of subVox)
    if (x < o.x + o.sx - 1e-4 && x + s > o.x + 1e-4 &&
        y < o.y + o.sy - 1e-4 && y + s > o.y + 1e-4 &&
        z < o.z + o.sz - 1e-4 && z + s > o.z + 1e-4) return null;
  // 不能卡进玩家身体
  if (x + s > P.pos.x - HALF - 1e-3 && x < P.pos.x + HALF + 1e-3 &&
      y + s > P.pos.y + 1e-3 && y < P.pos.y + P.ph - 1e-3 &&
      z + s > P.pos.z - HALF - 1e-3 && z < P.pos.z + HALF + 1e-3) return null;
  return { x, y, z };
}
function updateHighlight() {
  const h = hands.R;
  const sel = (h && !h.tool) ? h.id : -1;      // 拿着工具时不显示放置预览                   // 右手拿什么就放什么（没有快捷栏了）
  const s = smallSize();
  const t = frameRay();
  if (s < 1 && sel !== 22 && sel !== 23) {     // 小尺寸模式：收起 1m 大方格，显示实际大小的放置预览（火把/营火只整件放）
    highlight.visible = false;
    if (sel < 0) { ghost.visible = false; aimTip(t ? '右手没拿方块 —— 按 E 打开物品栏挑一个放进右手' : ''); return; }
    const p = getSmallPlace(sel, s, t);
    if (p) {
      ghost.scale.set(s, s, s);
      ghost.position.set(p.x + s / 2, p.y + s / 2, p.z + s / 2);
      ghost.visible = true;
      aimTip('放置：' + sizeText([s]) + ' ' + BLOCKS[sel].name + ' · 消耗 ' + fmtMass(smallCost(sel, s)) + BLOCKS[sel].matName);
    } else {
      ghost.visible = false;
      const fid = BLOCKS[sel].frag !== undefined ? BLOCKS[sel].frag : sel;
      aimTip(t ? ((frags[fid] || 0) < smallCost(sel, s) && h.n <= 0
        ? BLOCKS[sel].matName + '不够（挖方块就有材料）' : '这里放不下') : '');
    }
    return;
  }
  ghost.visible = false;
  if (!t) { highlight.visible = false; aimTip(''); return; }
  if (t.type === 'sub') {                      // 看着小方块：框缩到它实际大小，并标出尺寸
    const o = t.obj;
    highlight.position.set(o.x + o.sx / 2, o.y + o.sy / 2, o.z + o.sz / 2);
    highlight.scale.set(o.sx + 0.01, o.sy + 0.01, o.sz + 0.01);
    aimTip(BLOCKS[o.mat].matName + '小方块 · ' + sizeText([o.sx, o.sy, o.sz]));
  } else if (mining.active && mining.hasTarget && mining.chip && world[idx(mining.chip.x, mining.chip.y, mining.chip.z)]) {
    const k = mining.chip, bn = k.n || 1;      // 正在挖：框缩到这一口咬掉的大小（1/2/3/4 × 10cm）
    const hs = bn * 0.1 + 0.01;
    highlight.position.set(k.x + (k.sx + bn / 2) / SUB, k.y + (k.sy + bn / 2) / SUB, k.z + (k.sz + bn / 2) / SUB);
    highlight.scale.set(hs, hs, hs);
    aimTip('咬掉 ' + (bn * 10) + 'cm · ' + BLOCKS[world[idx(k.x, k.y, k.z)]].name);
  } else {
    highlight.scale.set(1, 1, 1);
    highlight.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    const gid = world[idx(t.x, t.y, t.z)];
    aimTip(gid ? BLOCKS[gid].name + (BLOCKS[gid].soft ? ' · 可穿越' : '') + ' · 粘稠 ' + Math.round(cohesionOf(t.x, t.y, t.z, gid) * 100) + '%' : '');
  }
  highlight.visible = true;
}
function addSmallBlock(x, y, z, s, id) {      // 放一个小方块（独立网格，按体积记质量）
  const b = BLOCKS[id];
  const fid = b.frag !== undefined ? b.frag : id;
  const tile = b.tiles.all !== undefined ? b.tiles.all : b.tiles.side;
  const geo = new THREE.BoxGeometry(s, s, s);
  setBoxTileUV(geo, tile);
  const mesh = new THREE.Mesh(geo, blockMaterial);
  mesh.position.set(x + s / 2, y + s / 2, z + s / 2);
  scene.add(mesh);
  subVox.push({ x, y, z, sx: s, sy: s, sz: s, mat: fid, mass: +(s * s * s * b.density), mesh });
}
function placeSmall(id, s) {                  // 放置小方块：位置与预览一致，按质量扣材料（右手必须拿着这种方块）
  const fid = BLOCKS[id].frag !== undefined ? BLOCKS[id].frag : id;
  const cost = smallCost(id, s);
  const p = getSmallPlace(id, s);
  if (!p) { showToast('这里放不下（看准星旁的提示）'); return; }
  if ((frags[fid] || 0) < cost) {             // 材料不够：就地拆右手一整块成材料，剩下的质量留着
    const h = hands.R;
    if (!h || h.id !== id || h.n <= 0) { showToast('右手要拿着' + BLOCKS[id].name + '，还需要 ' + fmtMass(cost) + BLOCKS[id].matName); return; }
    h.n--; if (h.n <= 0) hands.R = null;
    frags[fid] = +((frags[fid] || 0) + BLOCKS[id].density).toFixed(4);
    gainFeed('拆了 1 个' + BLOCKS[id].name);
  }
  frags[fid] = +((frags[fid] - cost).toFixed(4));
  addSmallBlock(p.x, p.y, p.z, s, id);
  updateHandsUI();
  sfxPlace(3);
  swingT = 0;
}
const sizeTagEl = document.getElementById('sizeTag');
function updateSizeTag() {                    // 右下角常显：当前放置尺寸
  const s = smallSize();
  sizeTagEl.textContent = '放置大小 G：' + (s === 1 ? '整块 1m' : sizeText([s]) + '（耗材料）');
}
updateSizeTag();

/* ---- 按住左键持续挖掘：进度按「材料硬度×密度 ÷ 力量加成」积累 ---- */
const mineBarEl = document.getElementById('mineBar');
const mineBarFill = mineBarEl.querySelector('.fill');
const mining = { active: false, both: false, hasTarget: false, x: 0, y: 0, z: 0, progress: 0 };   // both: 左右键一起按=双手刨

function breakBlock(x, y, z, id) {          // 整块挖掉（造型/调试用）：掉「剩余质量」= 密度 − 已咬掉的部分
  const c = carved.get(idx(x, y, z));
  const remain = +(BLOCKS[id].density * (0.9 + Math.random() * 0.3) - (c ? c.n * BLOCKS[id].density / (SUB * SUB * SUB) : 0));
  gainXp(BLOCKS[id].xp);
  finishBreak(x, y, z, id, Math.max(0, remain));
}
function mine() {                            // 瞬间挖掉瞄准的方块（调试用；正常玩法是按住挖）
  const hit = raycastVoxel();
  if (!hit || hit.y === 0) return;           // 最底层不可挖，防止挖穿世界
  breakBlock(hit.x, hit.y, hit.z, world[idx(hit.x, hit.y, hit.z)]);
}
function updateMining(dt) {                  // 每帧调用：按住左键时一口一口咬 10cm，挖满进度整块碎
  if (!mining.active) { resetMining(); return; }
  const t = frameRay();
  if (!t) { resetMining(); return; }
  if (t.type === 'sub') {                    // 放置的小方块：一碰就碎，直接回收成材料质量
    const o = t.obj;
    frags[o.mat] = +((frags[o.mat] || 0) + o.mass).toFixed(4);
    gainFeed('+' + (o.mass * 1000).toFixed(1) + 'g ' + BLOCKS[o.mat].matName);
    removeSubVox(o);
    noiseHit(2000, 0.04, 0.1, 'highpass');
    mining.hasTarget = false; mining.progress = 0;
    return;
  }
  if (t.y === 0) { resetMining(); return; }
  if (SHAPES[world[idx(t.x, t.y, t.z)]]) {   // 造型（台阶/石柱）保持整块挖
    mineWhole(dt, t.x, t.y, t.z);
    return;
  }
  const chip = findChip(t);                  // 沿视线找第一个实体子格（可穿过雕刻的洞）
  if (!chip || chip.y === 0) { resetMining(); return; }
  const id = world[idx(chip.x, chip.y, chip.z)];
  // 松软的土：只有"往下掏地面"（瞄准的是方块顶面、且顶面不高于脚底，比如往脚下挖坑）才要蹲/趴；
  // 挖土墙（竖着的面）站着随便挖——就算洞越咬越深，看的也是你瞄的那个面
  if ((id === 1 || id === 2) && t.face && t.face[1] > 0 && chip.y + 1 <= P.pos.y + 0.01 && P.stance === 0) {
    resetMining();
    aimTip('往下挖脚边的松土要蹲下 —— 按住 C 蹲下');
    return;
  }
  if (!mining.hasTarget || chip.x !== mining.x || chip.y !== mining.y || chip.z !== mining.z) {
    mining.x = chip.x; mining.y = chip.y; mining.z = chip.z;
    mining.hasTarget = true; mining.progress = 0;      // 换了目标就从头挖
    mining.chipT = 0;
  }
  const mode = digMode();                              // 这一手的挖掘方式（工具/单手/双手）与效力、耗力
  P.stam = Math.max(0, P.stam - mode.drain * effortMult() * dt);      // 挖掘是力气活：按方式持续耗体力（×肌肉系数）
  if (P.stam <= 0) P.exhausted = true;
  mining.chipT = (mining.chipT || 0) - dt;
  // 挥击节奏：工具每击间隔按挥击倍率缩短——空手必须是最慢的挥击；工具另设更低下限，软材料上也能看出节奏差
  const chipFloor = (mode.swing || 1) > 1 ? 0.07 : 0.12;
  const chipDur = Math.max(chipFloor, mineTime(id, cohesionOf(chip.x, chip.y, chip.z, id), mode.power) / SUB / (mode.swing || 1) * (P.exhausted ? 1.5 : 1));   // 没力气了：节奏慢半拍
  if (mining.chipT <= 0) {                             // 每隔一小会儿咬一口；一口咬多大看手里的工具/姿势
    mining.chipT = chipDur;
    if (doBite(chip.x, chip.y, chip.z, chip, mode.n)) swingT = 0;
  }
  mineBarEl.style.display = 'block';                   // 进度条改成"下一口"节奏条
  mineBarFill.style.width = Math.min(100, (1 - Math.max(0, mining.chipT) / chipDur) * 100) + '%';
}
function mineWhole(dt, x, y, z) {            // 造型的整块挖法：攒满进度一次碎
  if (!mining.hasTarget || x !== mining.x || y !== mining.y || z !== mining.z) {
    mining.x = x; mining.y = y; mining.z = z;
    mining.hasTarget = true; mining.progress = 0;
  }
  const id = world[idx(x, y, z)];
  const wMode = digMode();
  mining.progress += dt * (wMode.swing || 1) / mineTime(id, cohesionOf(x, y, z, id), wMode.power);
  mineSfxT -= dt;
  if (mineSfxT <= 0) { sfxMine(id); mineSfxT = 0.25; swingT = 0; }
  if (mining.progress >= 1) {
    mining.hasTarget = false; mining.progress = 0;
    breakBlock(x, y, z, id);
    return;
  }
  mineBarEl.style.display = 'block';
  mineBarFill.style.width = Math.min(100, mining.progress * 100) + '%';
}
function resetMining() {
  mining.hasTarget = false; mining.progress = 0; mining.chip = null;
  mineBarEl.style.display = 'none';
}
function blockIntersectsPlayer(bx, by, bz) {
  return bx + 1 > P.pos.x - HALF && bx < P.pos.x + HALF &&
         by + 1 > P.pos.y       && by < P.pos.y + P.ph &&
         bz + 1 > P.pos.z - HALF && bz < P.pos.z + HALF;
}
function place() {
  const h = hands.R;                           // 右键放右手拿的东西
  if (!h) { showToast('右手没拿东西 —— 按 E 打开物品栏'); return; }
  if (h.tool) { showToast('右手拿着工具，放不了方块 —— 换只手拿'); return; }
  const id = h.id;
  const isFire = id === 22 || id === 23;
  const s = smallSize();
  if (s < 1 && !isFire) { placeSmall(id, s); return; }    // 小尺寸：独立小方块（火把/营火只整件放，小件没火光）
  if (h.n <= 0) return;
  const hit = raycastVoxel();
  if (!hit || !hit.face) { showToast('准星里没有可贴着的方块面'); return; }
  const bx = hit.x + hit.face[0], by = hit.y + hit.face[1], bz = hit.z + hit.face[2];
  if (bx < 0 || bx >= WX || by < 0 || by >= WY || bz < 0 || bz >= WZ) { showToast('放到世界外面去了 —— 瞄近处一点'); return; }
  if (world[idx(bx, by, bz)] !== 0) { showToast('那格已经被占了（水也占格子）'); return; }
  if (isFire && hit.face[1] !== 1) { showToast('火把/营火要放在地面上（瞄脚边的地面放）'); return; }
  if (blockIntersectsPlayer(bx, by, bz)) { showToast('会卡住自己 —— 瞄远一点的面再放'); return; }
  for (const o of subVox) {                  // 已有小方块的格子别再放整块（会互相卡进去）
    if (Math.abs(o.x + o.sx / 2 - (bx + 0.5)) > 1.6 || Math.abs(o.z + o.sz / 2 - (bz + 0.5)) > 1.6) continue;
    if (bx < o.x + o.sx - 1e-4 && bx + 1 > o.x + 1e-4 &&
        by < o.y + o.sy - 1e-4 && by + 1 > o.y + 1e-4 &&
        bz < o.z + o.sz - 1e-4 && bz + 1 > o.z + 1e-4) { showToast('和小方块重叠，放不进去'); return; }
  }
  setBlockAndRebuild(bx, by, bz, id);
  const vi = idx(bx, by, bz);
  placedBlocks.add(vi);                       // 记录是玩家放的：没粘合会被撞倒
  if (glue > 0 && !isFire) {                  // 火把/营火不耗粘合剂（可穿行，没东西撞它——除了你自己）
    glue--;
    glued.add(vi);
    showToast('已用 1 个粘合剂固定' + BLOCKS[id].name + '（撞不倒、塌不了）');
  } else if (glue <= 0 && !isFire && performance.now() - (place._noGlueT || 0) > 5000) {   // 提示限流：别刷屏
    place._noGlueT = performance.now();
    showToast(BLOCKS[id].name + '没固定：受冲撞会倒（合成粘合剂再放）');
  }
  h.n--; if (h.n <= 0) hands.R = null;
  updateHandsUI();
  sfxPlace(id);
  swingT = 0;                                          // 放置也挥一下手
  if (SHAPES[id] && !isFire && id !== 21) addShapeMesh(bx, by, bz, id);
  if (id === 21) rebuildMushrooms();           // 装饰蘑菇也进合并网格
  if (id === 22) { registerTorch(bx, by, bz); torchPlaced++; checkGoals(); }   // 火把：进火光注册表（合并网格+光源池）
  if (id === 23) registerCampfire(bx, by, bz);
  if (id === 7 && !benchPlaced) {          // 第一次放下工具箱：提示并推进目标
    benchPlaced = true;
    showToast('工具箱已放置！站在它旁边按 E 合成工具');
    checkGoals();
  }
}
let mouseLDown = false, mouseRDown = false;               // 左右键按住状态（双手刨 = 两键同时按住）
function syncMouseButtons() { mining.both = mouseLDown && mouseRDown; }
document.addEventListener('mousedown', e => {
  initAudio();                                            // 点击也可激活声音
  if (e.button === 1) e.preventDefault();                 // 中键别触发浏览器的滚动光标
  if (state !== 'playing') return;
  if (document.pointerLockElement !== renderer.domElement) {   // 玩着但鼠标没锁上（浏览器拦截过重锁）：先补锁再操作
    lockPointer(); return;
  }
  if (!e.isTrusted) return;                               // 只认真实鼠标输入，忽略程序合成的点击
  if (performance.now() - playingSince < 250) return;     // 刚进入游戏的瞬间忽略点击，防止误挖
  if (e.button === 0) {
    if (tryAttack()) return;                 // 点中夜行者：这一下是攻击，不进入挖掘
    mouseLDown = true; mining.active = true;   // 按住左键开始挖（单手/工具）
  }
  else if (e.button === 2) mouseRDown = true;             // 右键单按不做事，和左键一起按住 = 双手刨
  else if (e.button === 1) place();                       // 中键（滚轮按下）：放置右手的东西
  syncMouseButtons();
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { mouseLDown = false; mining.active = false; }   // 松开左键停止挖
  else if (e.button === 2) mouseRDown = false;
  syncMouseButtons();
});
document.addEventListener('contextmenu', e => e.preventDefault());

/* =====================================================
 * 八、碎块粒子（挖掉方块时的小特效）
 * ===================================================== */
const PMAX = 120;
const pPos = new Float32Array(PMAX * 3).fill(-9999);
const pVel = new Float32Array(PMAX * 3);
const pCol = new Float32Array(PMAX * 3);
const pLife = new Float32Array(PMAX);
let pNext = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true }));
points.frustumCulled = false;
scene.add(points);
function burst(bx, by, bz, colorHex, n = 10) {
  const base = new THREE.Color(colorHex);
  for (let k = 0; k < n; k++) {
    const i = pNext; pNext = (pNext + 1) % PMAX;
    pLife[i] = 0.45 + Math.random() * 0.25;
    pPos[i*3] = bx + 0.2 + Math.random() * 0.6;
    pPos[i*3+1] = by + 0.2 + Math.random() * 0.6;
    pPos[i*3+2] = bz + 0.2 + Math.random() * 0.6;
    pVel[i*3] = (Math.random() - 0.5) * 3;
    pVel[i*3+1] = 1 + Math.random() * 3.5;
    pVel[i*3+2] = (Math.random() - 0.5) * 3;
    const s = 0.8 + Math.random() * 0.4;
    pCol[i*3] = base.r * s; pCol[i*3+1] = base.g * s; pCol[i*3+2] = base.b * s;
  }
  pGeo.attributes.color.needsUpdate = true;
}
function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) continue;
    any = true;
    pLife[i] -= dt;
    pVel[i*3+1] -= 12 * dt;
    pPos[i*3] += pVel[i*3] * dt; pPos[i*3+1] += pVel[i*3+1] * dt; pPos[i*3+2] += pVel[i*3+2] * dt;
    if (pLife[i] <= 0) pPos[i*3+1] = -9999;
  }
  if (any) pGeo.attributes.position.needsUpdate = true;
}

/* ---- 柔性形变痕迹：被撞开的树叶被拨弯，弹簧式慢慢回弹（几秒后痕迹消散） ---- */
const leafBendGeo = new THREE.PlaneGeometry(0.55, 0.55);
{ const uv = leafBendGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.25, 0.5 + uv.getY(i) * 0.25); }   // UV 指到图集的树叶格
const leafBendMat = new THREE.MeshBasicMaterial({ map: atlasTexture, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
function spawnLeafBend(cx, cy, cz) {
  if (getBlock(cx, cy, cz) !== 5) return;    // 只在真的有树叶的格子上留痕
  const m = new THREE.Mesh(leafBendGeo, leafBendMat);
  m.position.set(cx + 0.5, cy + 0.5, cz + 0.5);
  m.rotation.y = Math.random() * Math.PI;
  scene.add(m);
  leafBends.push({ m, t: 0, amp: 0.45 + Math.random() * 0.3, ph: Math.random() * 6 });
  if (leafBends.length > 24) scene.remove(leafBends.shift().m);   // 上限：别堆太多
}
function updateLeafBends(dt) {
  for (let i = leafBends.length - 1; i >= 0; i--) {
    const b = leafBends[i];
    b.t += dt;
    const k = b.amp * Math.exp(-b.t * 1.1) * Math.cos(b.t * 6 + b.ph);   // 弹簧回弹：晃几下幅度衰减到停（回弹慢的柔性体）
    b.m.rotation.z = k;
    b.m.rotation.x = k * 0.6;
    if (b.t > 4.2) { scene.remove(b.m); leafBends.splice(i, 1); }
  }
}

/* ---- 雨雪刚体：受重力下落，撞到方块表面/水面才停——留下痕迹（雨=溅花+湿痕慢慢干，雪=积雪痕慢慢融） ---- */
const groundMarks = [];                       // 地表痕迹贴花 { m, t, life, kind }
const markGeo = new THREE.PlaneGeometry(0.34, 0.34);
const markMatOpts = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
const rainMarkMat = new THREE.MeshBasicMaterial({ color: 0x3a5f7a, opacity: 0.45, ...markMatOpts });
const snowMarkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.85, ...markMatOpts });
function spawnGroundMark(kind, wx, topY, wz) {
  if (groundMarks.length > 24) return;        // 上限：痕迹太多会满地翻搅像闪烁
  const m = new THREE.Mesh(markGeo, kind === 'rain' ? rainMarkMat : snowMarkMat);
  m.rotation.x = -Math.PI / 2;                // 平躺贴在表面上
  m.rotation.z = Math.random() * Math.PI;
  m.position.set(wx, topY + 0.04, wz);        // 抬高 4cm：贴太近会和雪面深度打架（闪）
  m.scale.setScalar(kind === 'snow' ? 0.7 + Math.random() * 0.6 : 0.6 + Math.random() * 0.5);
  scene.add(m);
  groundMarks.push({ m, t: 0, life: kind === 'snow' ? 14 : 5, kind });   // 雪痕化得慢（冷），湿痕几秒就干
}
function updateGroundMarks(dt) {
  for (let i = groundMarks.length - 1; i >= 0; i--) {
    const g = groundMarks[i];
    g.t += dt;
    const k = 1 - g.t / g.life;
    if (k <= 0) { scene.remove(g.m); groundMarks.splice(i, 1); continue; }
    if (k < 0.35) g.m.scale.multiplyScalar(Math.max(0.01, 1 - dt * 0.8));   // 尾声缩小淡出（材质共享，透明度统一衰减做不了单件）
  }
}
function groundTopAt(wx, wy, wz) {            // 从粒子高度往下扫：第一个实体表面（方块顶或水面）。返回表面世界 y 或 null
  const gx = Math.floor(wx), gz = Math.floor(wz);
  if (gx < 0 || gx >= WX || gz < 0 || gz >= WZ) return null;
  let gy = Math.min(WY - 1, Math.floor(wy));
  for (; gy >= 0; gy--) {
    const v = world[idx(gx, gy, gz)];
    if (v && v !== 8) return gy + 1;          // 实心方块顶
    if (v === 8 && gy <= 4) return gy;        // 水面（低洼水面恒在 y<=4）
  }
  return 0;                                   // 扫到底了：世界底
}

/* =====================================================
 * 九、音效系统：Web Audio 现场合成，不加载任何音频文件
 * ===================================================== */
// 浏览器规定：必须先有用户点击/按键，才能出声（initAudio 挂在各类交互上）
let audioCtx = null, masterGain = null, noiseBuf = null;
let muted = loadPref('muted', '0') === '1';   // 静音偏好会记住
let stepT = 0, mineSfxT = 0, wasGround = false;   // 脚步节拍 / 挖掘音节拍 / 落地检测

function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.4;
  masterGain.connect(audioCtx.destination);
  noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5 | 0, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function noiseHit(freq, dur, vol, type = 'lowpass', q = 1) {  // 一声短噪声（沙沙/咔哒）
  if (!audioCtx || muted) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;         // 每次音色略有差异，不重复
  const f = audioCtx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = audioCtx.createGain();
  const t = audioCtx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start(t, Math.random() * 0.3, dur + 0.05);
}
function tone(freq, dur, vol, type = 'sine', slide = 1) {     // 一声短音调（咚/叮）
  if (!audioCtx || muted) return;
  const o = audioCtx.createOscillator();
  o.type = type;
  const t = audioCtx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(masterGain);
  o.start(t); o.stop(t + dur + 0.02);
}
// 每种材质的音色：f=滤波频率 v=音量 hp=用高频噪声（沙沙感）
const STEP_SFX = {
  1: { f: 500,  v: 0.16 },        // 草：软沙沙
  2: { f: 420,  v: 0.18 },        // 泥土：闷
  3: { f: 1600, v: 0.14 },        // 石头：硬咔哒
  4: { f: 900,  v: 0.18 },        // 原木：木质
  5: { f: 2600, v: 0.10, hp: true },  // 树叶：沙沙
  6: { f: 800,  v: 0.16 },        // 木板：木质
  7: { f: 700,  v: 0.16 },        // 工具箱：木质
};
function sfxStep(id) {                        // 脚步
  const s = STEP_SFX[id] || STEP_SFX[2];
  noiseHit(s.f, 0.09, s.v, s.hp ? 'highpass' : 'lowpass');
}
function sfxMine(id) {                        // 挖掘中的一下打击
  const s = STEP_SFX[id] || STEP_SFX[2];
  if (id === 4) tone(150 + Math.random() * 50, 0.07, 0.18, 'triangle', 0.7);
  else noiseHit(s.f + Math.random() * (id === 3 ? 600 : 150), 0.06, 0.22, s.hp ? 'highpass' : 'lowpass', id === 3 ? 2 : 1);
}
function sfxBreak(id) {                       // 方块碎裂
  const s = STEP_SFX[id] || STEP_SFX[2];
  noiseHit(s.f * 0.8, 0.16, 0.3);
  if (id === 3) noiseHit(2400, 0.1, 0.18, 'highpass');      // 石头的脆响
  if (id === 4) tone(120, 0.12, 0.22, 'triangle', 0.6);
}
function sfxPlace(id) {                       // 放置方块
  const s = STEP_SFX[id] || STEP_SFX[2];
  noiseHit(s.f * 0.9, 0.08, 0.22);
  tone(90, 0.06, 0.12);
}
function sfxLevelUp() {                       // 升级：上行三连音
  if (!audioCtx || muted) return;
  [[523, 0], [659, 0.09], [784, 0.18]].forEach(([f, d]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    const t = audioCtx.currentTime + d;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.3);
  });
}

/* =====================================================
 * 十、双手系统：没有背包，只有左手/右手各拿一摞（最多 64 个）
 * ===================================================== */
const HAND_MAX = 64;
const hands = { L: null, R: null };          // 每只手：null = 空手，或 { id: 方块编号, n: 个数 }
function handCount(id) {                     // 两只手里某种方块一共有几个
  return (hands.L && hands.L.id === id ? hands.L.n : 0) + (hands.R && hands.R.id === id ? hands.R.n : 0);
}
function handSpaceFor(id, n) {               // 两只手还装得下 n 个这种方块吗（合成前先检查）
  let space = 0;
  for (const k of ['L', 'R']) {
    const h = hands[k];
    if (!h) space += HAND_MAX;
    else if (h.id === id) space += HAND_MAX - h.n;
  }
  return space >= n;
}
function addToHands(id, n) {                 // 把方块捡进手里：先堆同类，再放空手；放不下返回 false
  let left = n;
  for (const h of [hands.R, hands.L])
    if (h && h.id === id && h.n < HAND_MAX) { const take = Math.min(HAND_MAX - h.n, left); h.n += take; left -= take; }
  for (const k of ['R', 'L'])
    if (!hands[k] && left > 0) { const take = Math.min(HAND_MAX, left); hands[k] = { id, n: take }; left -= take; }
  updateHandsUI();
  return left === 0;
}
function takeFromHands(id, n) {              // 从手里拿走 n 个（合成扣料用）；不够返回 false（不扣）
  if (handCount(id) < n) return false;
  let left = n;
  for (const k of ['L', 'R']) {
    const h = hands[k];
    if (h && h.id === id) {
      const take = Math.min(h.n, left);
      h.n -= take; left -= take;
      if (h.n <= 0) hands[k] = null;
    }
  }
  updateHandsUI();
  return true;
}
const handsHudEl = document.getElementById('handsHud');
const handEls = {};
['L', 'R'].forEach(k => {
  const d = document.createElement('div');
  d.className = 'hslot empty' + (k === 'R' ? ' active' : '');
  const cnt = document.createElement('div'); cnt.className = 'cnt'; d.appendChild(cnt);
  const key = document.createElement('div'); key.className = 'key'; key.textContent = k === 'L' ? '左手' : '右手'; d.appendChild(key);
  handsHudEl.appendChild(d);
  handEls[k] = d;
});
function updateHandsUI() {                   // 刷新双手 HUD + 手里模型 + 物品栏窗口（如果开着）
  for (const k of ['L', 'R']) {
    const el = handEls[k], h = hands[k];
    el.classList.toggle('empty', !h);
    const old = el.querySelector('canvas'); if (old) old.remove();
    const ic = slotIcon(h, 32);
    if (ic) { ic.className = 'cube'; el.appendChild(ic); }
    el.querySelector('.cnt').textContent = h && !h.tool ? h.n : '';
    el.title = h ? (h.tool ? BLOCKS[h.mat].matName + TOOL_KINDS[h.tool].name : BLOCKS[h.id].name) : '';
  }
  if (typeof renderCraftMenu === 'function' && !craftScreen.classList.contains('hidden')) renderCraftMenu();
  updateHeldItem();
}
const selNameEl = document.getElementById('selName');
let selNameT = null, lastHeldId = -1;
function showHandName() {                    // 右手换了东西时闪现名字（含当前放置尺寸）
  const h = hands.R;
  selNameEl.textContent = h ? BLOCKS[h.id].name + (smallSize() < 1 ? ' · 放置 ' + sizeText([smallSize()]) : '') : '右手空了';
  selNameEl.style.display = 'block';
  selNameEl.style.opacity = 1;
  clearTimeout(selNameT);
  selNameT = setTimeout(() => { selNameEl.style.opacity = 0; }, 1400);
}

/* =====================================================
 * 十一、合成与目标系统：给游戏一个"奔头"
 * ===================================================== */
// —— 工具系统：任何材料都能打工具，效力看材料（密度大=有力，柔性大=绵软）；档位决定一口咬多大 ——
// 材料门槛：密度/粘稠度太低（沙、雪、纤维）握不成工具
const TOOL_KINDS = {
  hammer: { name: '小锤子', tier: 1, bite: 2, swing: 1.5, cost: 2.0, bench: false, minDensity: 0.5, minCoh: 0.3 },   // 小型：一口 20cm，挥击 ×1.5
  pick:   { name: '镐子',   tier: 2, bite: 3, swing: 2.0, cost: 3.5, bench: true,  minDensity: 0.6, minCoh: 0.5 },   // 中型：一口 30cm，挥击 ×2
  sledge: { name: '大锤',   tier: 3, bite: 4, swing: 2.5, cost: 6.0, bench: true,  minDensity: 1.2, minCoh: 0.7 },   // 大型：一口 40cm，挥击 ×2.5
};
function toolPower(kind, mat) {              // 工具效力（空手=1）：材料密度越大越有力，柔性越大越绵；工具靠杠杆发力，再软的材料也不低于空手
  const m = BLOCKS[mat];
  return Math.max(1, (0.35 + 0.4 * m.density) * (1 - 0.55 * (m.flex !== undefined ? m.flex : 0.3)) * (1 + 0.5 * (TOOL_KINDS[kind].tier - 1)));
}
function toolDrain(kind, mat) {              // 用这把工具挖掘的耗体力速率（每秒）：越重越费劲
  const m = BLOCKS[mat];
  return 2.0 * (0.8 + 0.35 * m.density) * TOOL_KINDS[kind].tier;
}
function digMode() {                         // 当前挖掘方式：手里拿工具→用工具；空手→单手 1³（左右键一起按住=双手 3³，很耗力气）
  const th = (hands.R && hands.R.tool) ? hands.R : ((hands.L && hands.L.tool) ? hands.L : null);
  if (th) {
    const k = TOOL_KINDS[th.tool];
    return { n: k.bite, power: toolPower(th.tool, th.mat), swing: k.swing, drain: toolDrain(th.tool, th.mat),
             label: BLOCKS[th.mat].matName + k.name + ' · 一口 ' + (k.bite * 10) + 'cm · 挥击 ×' + k.swing };
  }
  if (mining.both && !hands.L && !hands.R)
    return { n: 3, power: 1, swing: 1, drain: 12, label: '双手刨 · 一口 30cm（很费力气）' };
  return { n: 1, power: 1, swing: 1, drain: 2.5, label: '空手 · 一口 10cm' };
}
let sticks = 0, stonesMined = 0, goalIdx = 0, benchPlaced = false;
let craftedBlocks = 0, craftedShapes = 0, craftedTools = 0, craftedPick = false, craftedPickIron = false, craftedSledge = false;
let drankOnce = false, ateOnce = false, torchPlaced = 0, mobKills = 0;   // 生存教学/终局目标用的新旗帜
let craftMat = 3;                            // 打工具选中的材料（默认石料）
const frags = {};                          // 材料库存：挖方块按密度掉落质量(kg)，合成按质量扣
BLOCK_IDS.forEach(id => { frags[id] = 0; });

// 合成配方：cost 里 f开头=材料(kg 按质量扣)，数字=方块编号，'stick'=木棍；bench: true 必须站在工具箱旁
// 材料质量守恒：方块配方价 = 它的密度（挖 1 块得 1 份材料，恰好合成回 1 块）；造型价 = 体积 × 密度
const RECIPES = [
  { id: 'planks',    sec: '材料', name: '木板 ×4', icon: 6, cost: { f4: 2.8 }, out: 6, outN: 4, tip: '最常用的建材' },
  { id: 'bench',     sec: '材料', name: '工具箱',  icon: 7, cost: { 6: 4 }, out: 7, tip: '放置后可合成工具（村庄里就有免费的）' },
  { id: 'stick',     sec: '材料', name: '木棍 ×4', icon: 'stick', cost: { 6: 2 },           tip: '工具手柄' },
  { id: 'glue',      sec: '材料', name: '粘合剂 ×4', icon: 'glue', cost: { f5: 0.2, f2: 0.3 }, tip: '放置方块时自动消耗 1 个牢牢固定（不固定会被撞倒）' },
  { id: 'b1', sec: '方块', name: '草方块',   icon: 1, cost: { f1: 1.4 }, out: 1, tip: '草皮材料 1.4kg' },
  { id: 'b2', sec: '方块', name: '泥土方块', icon: 2, cost: { f2: 1.5 }, out: 2, tip: '泥土材料 1.5kg' },
  { id: 'b3', sec: '方块', name: '石头方块', icon: 3, cost: { f3: 2.5 }, out: 3, tip: '石料 2.5kg' },
  { id: 'b4', sec: '方块', name: '原木方块', icon: 4, cost: { f4: 0.7 }, out: 4, tip: '木料 0.7kg' },
  { id: 'b5', sec: '方块', name: '树叶方块', icon: 5, cost: { f5: 0.3 }, out: 5, tip: '纤维材料 0.3kg' },
  { id: 'b15', sec: '方块', name: '沙子方块', icon: 15, cost: { f15: 1.6 }, out: 15, tip: '沙漠表层 · 松散会塌' },
  { id: 'b16', sec: '方块', name: '砂岩方块', icon: 16, cost: { f16: 2.3 }, out: 16, tip: '沙漠地下层' },
  { id: 'b17', sec: '方块', name: '雪块',     icon: 17, cost: { f17: 0.4 }, out: 17, tip: '雪原表层 · 滑' },
  { id: 'b18', sec: '方块', name: '冰',       icon: 18, cost: { f18: 0.9 }, out: 18, tip: '非常滑（摩擦 0.15）' },
  { id: 'b19', sec: '方块', name: '煤矿石',   icon: 19, cost: { f19: 2.6 }, out: 19, tip: '煤料 2.6kg' },
  { id: 'b20', sec: '方块', name: '铁矿石',   icon: 20, cost: { f20: 3.0 }, out: 20, tip: '铁料 3.0kg · 合成铁镐' },
  { id: 's9',  sec: '造型', name: '石台阶', icon: 9,  cost: { f3: 1.3 }, out: 9,  tip: '半格高 · 0.5m³' },
  { id: 's10', sec: '造型', name: '木台阶', icon: 10, cost: { f4: 0.4 }, out: 10, tip: '半格高 · 0.5m³' },
  { id: 's11', sec: '造型', name: '石柱',   icon: 11, cost: { f3: 0.4 }, out: 11, tip: '细柱 · 0.16m³' },
  { id: 's12', sec: '造型', name: '小石块', icon: 12, cost: { f3: 0.3 }, out: 12, tip: '半尺寸立方 · 0.125m³' },
  { id: 's13', sec: '造型', name: '薄石板', icon: 13, cost: { f3: 0.6 }, out: 13, tip: '四分之一高 · 0.25m³' },
  { id: 's14', sec: '造型', name: '木梁',   icon: 14, cost: { f4: 0.1 }, out: 14, tip: '长条梁 · 0.16m³' },
  { id: 's21', sec: '造型', name: '蘑菇',   icon: 21, cost: { f4: 0.12 }, out: 21, tip: '装饰 · 挖掉可得食物蘑菇' },
  // —— 火光配方（煤的去处）：火把消耗品（4 分钟/支），营火一次投资烧 10 分钟
  // rationale 造价：火把=煤0.3kg+木棍1（一块煤矿 2.6kg ≈ 8 批=32 支，挖一次够多日）；营火贵但半径大、能烤肉
  { id: 'torch', sec: '材料', name: '火把 ×4', icon: 'torch', cost: { f19: 0.3, stick: 1 }, tip: '插地上烧 4 分钟：光 + 热 + 夜行者绕道' },
  { id: 'campfire', sec: '材料', name: '营火', icon: 23, cost: { f19: 0.5, 6: 2, stick: 2 }, tip: '烧 10 分钟：大范围取暖驱怪，旁边按 F 烤肉' },
];
const fmtMass = v => { if (v >= 0.0995) return v.toFixed(1) + 'kg'; const g = v * 1000; return (g < 0.05 ? 0 : g < 9.95 ? +g.toFixed(1) : Math.round(g)) + 'g'; };   // 微量修匀：显示 0g 而非 0.0g
const resName = k => k === 'stick' ? '木棍' : (k[0] === 'f' ? BLOCKS[k.slice(1)].matName : BLOCKS[k].name);
const resHave = k => k === 'stick' ? sticks : (k[0] === 'f' ? (frags[k.slice(1)] || 0) : handCount(+k));   // 方块都拿在手里
const canCraft = r => Object.entries(r.cost).every(([k, v]) => resHave(k) >= v) && (!r.out || handSpaceFor(r.out, r.outN || 1));
function benchNearby() {                 // 玩家 4 格范围内有没有放着的工具箱
  const px = Math.floor(P.pos.x), py = Math.floor(P.pos.y + 0.9), pz = Math.floor(P.pos.z);
  for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++)
    if (getBlock(px + dx, py + dy, pz + dz) === 7) return true;
  return false;
}
let gainFeedT = null;
function gainFeed(text) {                // 捡到材料的漂浮提示
  gainFeedEl.textContent = text;
  gainFeedEl.style.opacity = 1;
  clearTimeout(gainFeedT);
  gainFeedT = setTimeout(() => { gainFeedEl.style.opacity = 0; }, 1100);
}

const craftScreen = document.getElementById('craftScreen');
const recipesEl = document.getElementById('recipes');
const toolLineEl = document.getElementById('toolLine');
const goalEl = document.getElementById('goal');
const gainFeedEl = document.getElementById('gainFeed');
const invHandLEl = document.getElementById('invHandL');
const invHandREl = document.getElementById('invHandR');
const matRowEl = document.getElementById('matRow');
const bagRowEl = document.getElementById('bagRow');
const toolRowEl = document.getElementById('toolRow');
const cursorEl = document.getElementById('cursorStack');
let cursorItem = null;                       // 鼠标上端着的方块摞（在两只手之间倒腾）

function openCraft() {
  renderCraftMenu();
  setState('craft');                     // 先改状态，退出指针锁定时就不会被当成暂停
  document.exitPointerLock();
}
function closeCraft() {
  if (cursorItem) {                      // 关窗口时鼠标上的东西放回手；实在放不下散成材料
    const it = cursorItem; cursorItem = null;
    if (it.tool) {
      if (!addToHandsTool(it.tool, it.mat)) {
        frags[it.mat] = +((frags[it.mat] || 0) + TOOL_KINDS[it.tool].cost * 0.6).toFixed(3);
        gainFeed('手放不下，工具散回了材料');
      }
    } else {
      const before = handCount(it.id);
      addToHands(it.id, it.n);
      const rest = it.n - (handCount(it.id) - before);
      if (rest > 0) {
        const fid = BLOCKS[it.id].frag !== undefined ? BLOCKS[it.id].frag : it.id;
        frags[fid] = +((frags[fid] || 0) + rest * BLOCKS[it.id].density).toFixed(3);
        gainFeed('手放不下，' + rest + ' 个' + BLOCKS[it.id].name + '散成了材料');
      }
    }
  }
  setState('playing'); lockPointer();
}

function itemIconCanvas(spec, size, tint) {  // 物品图标：方块贴图 / 镐 / 锤（可按材料着色）/ 木棍
  if (spec === 'woodPick') return pickaxeIconCanvas('#8d8d94', size);
  if (spec === 'stonePick') return pickaxeIconCanvas('#c9cbd4', size);
  if (spec === 'ironPick') return pickaxeIconCanvas('#e8c99a', size);
  if (spec === 'pick') return pickaxeIconCanvas(tint ? '#' + tint.toString(16).padStart(6, '0') : '#9a9aa4', size);
  if (spec === 'hammer' || spec === 'sledge') {
    const c = tint ? '#' + tint.toString(16).padStart(6, '0') : '#6f6f78';
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    g.strokeStyle = '#8a5e33'; g.lineWidth = size * 0.13; g.lineCap = 'round';     // 木柄
    g.beginPath(); g.moveTo(size * 0.3, size * 0.85); g.lineTo(size * 0.62, size * 0.42); g.stroke();
    g.save();                                                                 // 锤头：材料色的横块（大锤更大）
    g.translate(size * 0.62, size * 0.42); g.rotate(-0.5);
    const w = size * (spec === 'sledge' ? 0.42 : 0.3), hh = size * (spec === 'sledge' ? 0.2 : 0.16);
    g.fillStyle = c; g.fillRect(-w, -hh, w * 2, hh * 2);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-w, -hh, w * 2, hh * 0.6);
    g.restore();
    return cv;
  }
  if (spec === 'glue') {                       // 粘合剂：一滴胶
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = '#e8d44f';
    g.beginPath();
    g.moveTo(size * 0.5, size * 0.16);
    g.bezierCurveTo(size * 0.78, size * 0.48, size * 0.74, size * 0.78, size * 0.5, size * 0.82);
    g.bezierCurveTo(size * 0.26, size * 0.78, size * 0.22, size * 0.48, size * 0.5, size * 0.16);
    g.fill();
    g.fillStyle = '#c8a52e';
    g.beginPath(); g.arc(size * 0.44, size * 0.62, size * 0.07, 0, Math.PI * 2); g.fill();
    return cv;
  }
  if (spec === 'torch') {                       // 火把图标：斜木棍 + 一团亮头
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    g.strokeStyle = '#8a5e33'; g.lineWidth = size * 0.14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(size * 0.32, size * 0.88); g.lineTo(size * 0.62, size * 0.38); g.stroke();
    g.fillStyle = '#ffd97a'; g.beginPath(); g.arc(size * 0.65, size * 0.3, size * 0.15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff3c0'; g.beginPath(); g.arc(size * 0.65, size * 0.3, size * 0.07, 0, Math.PI * 2); g.fill();
    return cv;
  }
  if (spec === 'stick') {
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    g.strokeStyle = '#8a5e33'; g.lineWidth = size * 0.14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(size * 0.28, size * 0.8); g.lineTo(size * 0.72, size * 0.2); g.stroke();
    g.strokeStyle = '#6b4b2a'; g.lineWidth = size * 0.05;
    g.beginPath(); g.moveTo(size * 0.34, size * 0.66); g.lineTo(size * 0.62, size * 0.32); g.stroke();
    return cv;
  }
  return tileIconCanvas(spec, size);
}
function slotIcon(h, size) {                 // 手槽图标：方块贴图，或按材料着色的工具
  if (!h) return null;
  if (h.tool) return itemIconCanvas(h.tool, size, BLOCKS[h.mat].color);
  return tileIconCanvas(h.id, size);
}
function renderHandSlotEl(el, h) {           // 物品栏窗口里的手槽：图标 + 数量
  el.classList.toggle('empty', !h);
  const old = el.querySelector('canvas'); if (old) old.remove();
  let cnt = el.querySelector('.cnt');
  if (!cnt) { cnt = document.createElement('div'); cnt.className = 'cnt'; el.appendChild(cnt); }
  cnt.textContent = h && !h.tool ? h.n : '';
  const ic = slotIcon(h, 34);
  if (ic) el.appendChild(ic);
}
function renderCursor() {                    // 鼠标上端着的东西跟着光标走
  cursorEl.style.display = cursorItem ? 'block' : 'none';
  if (!cursorItem) return;
  const old = cursorEl.querySelector('canvas'); if (old) old.remove();
  const ic = slotIcon(cursorItem, 34);
  if (ic) cursorEl.appendChild(ic);
  cursorEl.querySelector('.cnt').textContent = cursorItem.tool ? '' : (cursorItem.n > 1 ? cursorItem.n : '');
}
function clickHandSlot(k) {                  // 点手槽：拿起 / 放下 / 交换 / 合并（就两只手，倒腾得过来）
  const h = hands[k];
  if (!cursorItem) { if (h) { cursorItem = h; hands[k] = null; } }
  else if (!h) { hands[k] = cursorItem; cursorItem = null; }
  else if (!h.tool && !cursorItem.tool && h.id === cursorItem.id) {
    const take = Math.min(HAND_MAX - h.n, cursorItem.n);
    h.n += take; cursorItem.n -= take;
    if (cursorItem.n <= 0) cursorItem = null;
  } else { hands[k] = cursorItem; cursorItem = h; }
  renderCraftMenu();
  updateHandsUI();
}
function addToHandsTool(tool, mat) {         // 把打好的工具放进空手（工具不叠堆，占一只手）
  for (const k of ['R', 'L'])
    if (!hands[k]) { hands[k] = { tool, mat }; updateHandsUI(); return true; }
  return false;
}
function renderToolCards() {                 // 打工具：三档，效力随选中的材料变化；材料门槛不够就打不了
  toolRowEl.innerHTML = '';
  const m = BLOCKS[craftMat];
  const matCoh = m.coh[0];                   // 材料的粘稠度下限：最差也不能差过工具的门槛
  for (const kind of ['hammer', 'pick', 'sledge']) {
    const k = TOOL_KINDS[kind];
    const needBench = k.bench && !benchNearby();
    const haveMat = (frags[craftMat] || 0) >= k.cost;
    const handFree = !hands.L || !hands.R;
    const lackDen = m.density < k.minDensity;
    const lackCoh = matCoh < k.minCoh;
    const matOk = !lackDen && !lackCoh;
    const ok = haveMat && !needBench && handFree && matOk;
    const card = document.createElement('div');
    card.className = 'rCard' + (ok ? '' : ' no');
    if (ok) card.onclick = () => doCraftTool(kind);
    const nameRow = document.createElement('div'); nameRow.className = 'rName';
    nameRow.appendChild(itemIconCanvas(kind, 20, m.color));
    nameRow.appendChild(document.createTextNode(m.matName + k.name + ' · ' + k.bite * 10 + 'cm'));
    card.appendChild(nameRow);
    const costRow = document.createElement('div'); costRow.className = 'rCost';
    costRow.innerHTML = (haveMat ? '' : '<span class="lack">') + m.matName + ' ' + fmtMass(frags[craftMat] || 0) + '/' + fmtMass(k.cost) + (haveMat ? '' : '</span>')
      + ' · 效力 ×' + toolPower(kind, craftMat).toFixed(2) + ' · 挥击 ×' + k.swing + '（空手=×1）'
      + (lackDen ? '<br><span class="lack">密度不够：要 ≥' + k.minDensity.toFixed(1) + '，这种材料只有 ' + m.density.toFixed(1) + '</span>' : '')
      + (lackCoh ? '<br><span class="lack">粘稠度不够：要 ≥' + k.minCoh.toFixed(2) + '，这种材料只有 ' + matCoh.toFixed(2) + '</span>' : '')
      + (needBench ? '<br><span class="lack">要站在工具箱旁</span>' : '')
      + (!handFree ? '<br><span class="lack">两只手都占着（工具占一只手）</span>' : '');
    card.appendChild(costRow);
    toolRowEl.appendChild(card);
  }
}
function doCraftTool(kind) {                 // 打工具：扣选中的材料，工具拿在手里
  const k = TOOL_KINDS[kind];
  const m = BLOCKS[craftMat];
  if ((frags[craftMat] || 0) < k.cost) return;
  if (m.density < k.minDensity || m.coh[0] < k.minCoh) { showToast('这种材料太松散，做不出' + k.name); return; }
  if (k.bench && !benchNearby()) return;
  if (!addToHandsTool(kind, craftMat)) { showToast('两只手都拿着东西，放不下工具'); return; }
  frags[craftMat] = +((frags[craftMat] || 0) - k.cost).toFixed(4);
  craftedTools++;
  if (kind === 'pick') { craftedPick = true; if (craftMat == 20) craftedPickIron = true; }
  if (kind === 'sledge') craftedSledge = true;
  gainFeed(BLOCKS[craftMat].matName + k.name + '已拿在手里');
  noiseHit(1200, 0.06, 0.12); tone(500, 0.08, 0.15, 'triangle', 1.3);
  updateStrengthUI(); checkGoals();
  renderCraftMenu(); updateHandsUI();
}
function drawCharPreview() {                 // 角色预览：光身子的像素小人（以后做了衣服就在这里穿上）
  const cv = document.getElementById('charPreview');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height, cx = W / 2;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#55555f'; g.fillRect(0, 0, W, H);
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(cx + x, y, w, h); };
  const SKIN = '#d8a06c', SKIN_D = '#bd8956', HAIR = '#45311f';
  px(-20, 10, 40, 36, SKIN);                       // 头
  px(-22, 8, 44, 11, HAIR);                        // 头发
  px(-22, 8, 7, 24, HAIR); px(15, 8, 7, 24, HAIR); // 两侧鬓角
  px(-13, 27, 6, 6, '#26221c'); px(7, 27, 6, 6, '#26221c');   // 眼睛
  px(-5, 38, 10, 3, SKIN_D);                       // 嘴
  px(-6, 46, 12, 6, SKIN_D);                       // 脖子
  px(-24, 52, 48, 56, SKIN);                       // 躯干（光着）
  px(14, 52, 10, 56, SKIN_D);                      // 躯干侧影
  px(-36, 52, 12, 50, SKIN);                       // 左臂
  px(24, 52, 12, 50, SKIN);                        // 右臂
  px(24, 52, 5, 50, SKIN_D);                       // 右臂侧影
  px(-36, 100, 12, 9, SKIN_D); px(24, 100, 12, 9, SKIN_D);    // 手
  px(-18, 110, 16, 50, SKIN);                      // 左腿
  px(2, 110, 16, 50, SKIN);                        // 右腿
  px(11, 110, 7, 50, SKIN_D);                      // 右腿侧影
  px(-18, 158, 16, 8, SKIN_D); px(2, 158, 16, 8, SKIN_D);     // 光脚
}
function renderCraftMenu() {                 // 物品栏窗口：双手槽 + 配方卡片 + 材料袋 + 锁定的背包
  renderHandSlotEl(invHandLEl, hands.L);
  renderHandSlotEl(invHandREl, hands.R);
  renderCursor();
  recipesEl.innerHTML = '';
  let lastSec = '', grid = null;
  RECIPES.forEach((r) => {
    if (r.sec !== lastSec) {                             // 分组小标题
      lastSec = r.sec;
      const head = document.createElement('div');
      head.className = 'mcSec';
      head.textContent = lastSec === '材料' ? '—— 工具与材料 ——' : lastSec === '方块' ? '—— 用材料合成方块 ——' : '—— 用材料合成三维造型 ——';
      recipesEl.appendChild(head);
      grid = document.createElement('div');
      grid.className = 'recipeGrid';
      recipesEl.appendChild(grid);
    }
    const needBench = r.bench && !benchNearby();
    const ok = !needBench && canCraft(r);
    const card = document.createElement('div');
    card.className = 'rCard' + (ok ? '' : ' no');
    if (ok) card.onclick = () => doCraft(r);
    const nameRow = document.createElement('div'); nameRow.className = 'rName';
    if (typeof r.icon === 'number') {
      const ic = document.createElement('i'); ic.className = 'cube';
      ic.style.background = '#' + BLOCKS[r.icon].color.toString(16).padStart(6, '0');
      nameRow.appendChild(ic);
    } else nameRow.appendChild(itemIconCanvas(r.icon, 20));
    nameRow.appendChild(document.createTextNode(r.name));
    card.appendChild(nameRow);
    const costRow = document.createElement('div'); costRow.className = 'rCost';
    costRow.innerHTML = Object.entries(r.cost).map(([k, v]) => {
      const have = resHave(k) >= v;
      const haveTxt = k[0] === 'f' ? fmtMass(resHave(k)) : '×' + resHave(k);
      const costTxt = k[0] === 'f' ? fmtMass(v) : '×' + v;
      return `<span class="${have ? '' : 'lack'}">${resName(k)} ${haveTxt}/${costTxt}</span>`;
    }).join('　') + (needBench ? '<br><span class="lack">要站在工具箱旁</span>' : '');
    card.appendChild(costRow);
    grid.appendChild(card);
  });
  matRowEl.innerHTML = '';                     // 材料袋：挖到过的材料摆出来；点一下 = 选中打工具的材料
  [1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 20].forEach(fid => {
    if (!(frags[fid] > 0)) return;             // 没挖到过的不占格子
    const cell = document.createElement('div'); cell.className = 'matCell' + (fid === craftMat ? ' sel' : '');
    cell.title = '点一下：选中「' + BLOCKS[fid].matName + '」来打工具';
    cell.onclick = () => { craftMat = fid; renderCraftMenu(); };
    const ic = document.createElement('div'); ic.className = 'cube';
    ic.style.background = '#' + BLOCKS[fid].color.toString(16).padStart(6, '0');
    cell.appendChild(ic);
    const nm = document.createElement('div'); nm.className = 'mName'; nm.textContent = BLOCKS[fid].matName; cell.appendChild(nm);
    const ms = document.createElement('div'); ms.className = 'mMass'; ms.textContent = fmtMass(frags[fid] || 0); cell.appendChild(ms);
    matRowEl.appendChild(cell);
  });
  renderToolCards();
  {                                           // 粘合剂按个数摆
    const cell = document.createElement('div'); cell.className = 'matCell';
    cell.appendChild(itemIconCanvas('glue', 22)).className = '';
    const nm = document.createElement('div'); nm.className = 'mName'; nm.textContent = '粘合剂'; cell.appendChild(nm);
    const ms = document.createElement('div'); ms.className = 'mMass'; ms.textContent = '×' + glue; cell.appendChild(ms);
    matRowEl.appendChild(cell);
  }
  bagRowEl.innerHTML = '';                     // 背包还没做出来：一排锁着的格子占位
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('div'); c.className = 'bagCell'; c.textContent = '🔒';
    bagRowEl.appendChild(c);
  }
  drawCharPreview();
}
invHandLEl.onclick = () => clickHandSlot('L');
invHandREl.onclick = () => clickHandSlot('R');
craftScreen.addEventListener('mousemove', e => {
  if (!cursorItem) return;
  cursorEl.style.left = (e.clientX + 8) + 'px';
  cursorEl.style.top = (e.clientY + 8) + 'px';
});
function doCraft(r) {
  if (!canCraft(r)) return;
  if (r.bench && !benchNearby()) return;
  for (const [k, v] of Object.entries(r.cost)) {
    if (k === 'stick') sticks -= v;
    else if (k[0] === 'f') frags[k.slice(1)] = +(frags[k.slice(1)] - v).toFixed(4);   // 材料按质量扣，防浮点残渣（留 4 位，别抹掉零头）
    else takeFromHands(+k, v);                                                       // 方块从手里扣
  }
  if (r.id === 'stick') sticks += 4;
  else if (r.id === 'glue') glue += 4;
  else if (r.id === 'torch') { addToHands(22, 4); gainFeed('4 支火把已拿在手里（天黑前插好）'); }
  else if (r.id === 'campfire') { addToHands(23, 1); gainFeed('营火已拿在手里（找块平地放）'); }
  else if (r.out) {
    addToHands(r.out, r.outN || 1);
    if (r.sec === '方块') { craftedBlocks++; gainFeed('方块已拿在手里'); }
    if (r.sec === '造型') { craftedShapes++; gainFeed('造型已拿在手里'); }
  }
  noiseHit(1200, 0.06, 0.12); tone(320, 0.08, 0.15, 'triangle', 1.2);   // 合成的"咔嗒"声
  updateStrengthUI(); checkGoals();
  renderCraftMenu(); updateHandsUI();
}

// 目标清单：合成线 + 生存教学（喝水/吃饭/火把/过夜）+ 终局（杀怪/点亮基地/活过第五夜）
// 节奏：每 2~4 个目标插一个生存节点，玩家每 10 分钟都有明确的「下一件事」
const GOALS = [
  { text: '按住左键砍树，收集木料（按质量计）', done: () => frags[4] > 0 },
  { text: '按 E 合成 4 块木板（木料 2.8kg）', done: () => handCount(6) >= 4 },
  { text: '做一个工具箱（或去找村庄，屋里就有现成的）', done: () => handCount(7) > 0 || benchPlaced || benchNearby() },
  { text: '右手拿着工具箱（E 里点合成），中键(滚轮按下)放到地上', done: () => benchPlaced },
  { text: '【生存】喝一口水：R 键（低头找水塘，村庄有井）', done: () => drankOnce },
  { text: '【生存】吃一口东西：F 键（挖树叶掉苹果/浆果，树下采蘑菇）', done: () => ateOnce },
  { text: '合成 4 根木棍，打一把小锤子（一口 20cm，挥得比空手快）', done: () => craftedTools >= 1 },
  { text: '用材料合成任意方块', done: () => craftedBlocks >= 1 },
  { text: '挖到 10 个石头', progress: () => `（${stonesMined} / 10）`, done: () => stonesMined >= 10 },
  { text: '站在工具箱旁打一把镐子（中型 30cm）', done: () => craftedPick },
  { text: '往深处挖到煤（石头里的黑斑）——过夜它比铁急用', done: () => frags[19] > 0 },
  { text: '合成 4 支火把（煤 0.3kg+木棍 1），中键插在地上', done: () => torchPlaced >= 1 },
  { text: '活过第一夜：待在火光边，别乱跑', done: () => dayCount >= 2 },
  { text: '往深处挖铁矿石（锈黄色斑点，比煤更深）', done: () => frags[20] > 0 },
  { text: '打一把铁料镐（效力最高，揍夜行者也疼）', done: () => craftedPickIron },
  { text: '用材料合成一个三维造型（台阶/石柱/小石块…）', done: () => craftedShapes >= 1 },
  { text: '杀死 1 只夜行者（天亮它们会自燃，但肉得自己动手）', progress: () => `（${mobKills} / 1）`, done: () => mobKills >= 1 },
  { text: '点亮基地：累计插 6 支火把 + 粘合固定 8 块（撞不倒、啃得慢）', done: () => torchPlaced >= 6 && glued.size >= 8 },
  { text: '活过第五夜 · 你已经把这片地住成了家', done: () => dayCount >= 6 },
];
function updateGoals() {
  const g = GOALS[goalIdx];
  if (goalIdx >= GOALS.length - 1 && g.done())
    goalEl.textContent = '✔ 全部达成！自由生存：练肌肉、盖城堡、去雪原和沙漠看看';
  else
    goalEl.textContent = '目标：' + g.text + (g.progress ? g.progress() : '');
  refreshHint();
}
function checkGoals() {
  let advanced = false;
  while (goalIdx < GOALS.length - 1 && GOALS[goalIdx].done()) {
    goalIdx++; advanced = true;
    showToast('✔ 目标完成！');
    if (audioCtx && !muted) tone(660, 0.12, 0.18, 'triangle');
  }
  if (advanced) setTimeout(() => { if (audioCtx && !muted) tone(988, 0.18, 0.18, 'triangle'); }, 110);
  updateGoals();
}
// 左上角提示分级：新手别被 130 字长跑马灯糊脸——按目标进度逐步解锁按键信息
const HINT_TIERS = [
  '左键 挖（每口10cm）· 中键 放右手的东西 · W 走 / 双击W 快走 / Shift 疾跑 · 对墙按住 W 攀爬',
  'E 物品栏/合成 · F 吃 / R 喝水 · C 蹲（挖脚边的土要蹲）· G 换放置大小 · 中键 放东西',
  '左键 挖 · 左右键一起 双手刨 · 中键 放 · G 尺寸 · C/X 蹲趴 · E 合成 · F 吃 R 喝 · F5/V 视角 · M 静音 · 夜里别离火光太远',
];
function refreshHint() {
  const el = document.getElementById('hint');
  if (!el) return;
  const t = goalIdx < 4 ? 0 : goalIdx < 10 ? 1 : 2;
  if (el._tier !== t) { el._tier = t; el.textContent = HINT_TIERS[t]; }
}

/* =====================================================
 * 十二、成长系统：经验 → 力量等级 → 挖掘速度
 * ===================================================== */
// 挖掉方块得经验（越硬经验越多），经验决定力量等级，等级越高挖得越快。
// 升级所需经验：到 Lv.2 要 8，Lv.3 要 24，Lv.4 要 48……（公式 4×n×(n-1)）
const strengthLevelEl = document.getElementById('strengthLevel');
const strengthInfoEl = document.getElementById('strengthInfo');
const strengthFillEl = document.getElementById('strengthFill');
const toastEl = document.getElementById('toast');
let toastTimer = 0;

function levelFromXp(xp) { return Math.max(1, Math.floor((1 + Math.sqrt(1 + xp)) / 2)); }
function strengthMult() { return 1 + 0.2 * (P.level - 1); }   // 每级挖掘速度 +20%
const STONE_IDS = [3, 9, 11, 12, 13, 15, 16, 19, 20];   // 石质/硬质材料：镐子的专精对象（矿石也算）
function mineTime(id, coh, power) {          // 空手挖碎一整块的当量秒数：硬度×目标密度/柔性阻力×粘稠阻力÷力量÷工具效力
  const b = BLOCKS[id];
  if (coh === undefined) coh = 0.5;
  const flex = b.flex !== undefined ? b.flex : 0.3;
  return b.hardness
    * (0.7 + 0.3 * b.density / 2)            // 被挖材料密度越大越难挖
    * (0.4 + 1.6 * coh)                      // 粘稠度相关性最大
    * (0.8 + 1.2 * flex)                     // 柔性越大越难挖（树叶软但弹，很费劲）
    / strengthMult() / (power || 1);
}
function gainXp(amount) {
  P.xp += amount;
  const lv = levelFromXp(P.xp);
  if (lv > P.level) {
    P.level = lv;
    showToast(`力量提升！Lv.${P.level}，挖掘速度 +${Math.round((strengthMult() - 1) * 100)}%`);
    sfxLevelUp();
  }
  updateStrengthUI();
}
function updateStrengthUI() {
  const cur = P.xp - 4 * (P.level - 1) * P.level;              // 本级已攒的经验
  const need = 8 * P.level;                                    // 升到下一级所需经验
  strengthLevelEl.textContent = `力量 Lv.${P.level}`;
  document.getElementById('bodyLine').textContent = `肌肉 ${Math.round(P.muscle)}kg · 体脂 ${Math.round(P.fatPct)}% · 代谢 ${Math.round(370 + 32 * P.muscle)}kcal/日`;
  toolLineEl.textContent = '挖掘：' + digMode().label + (P.exhausted ? ' · 没力气了' : '');
  strengthInfoEl.textContent = `挖掘速度 +${Math.round((strengthMult() - 1) * 100)}% · 经验 ${Math.floor(cur)}/${need}`;
  strengthFillEl.style.width = Math.min(100, cur / need * 100) + '%';
}
function showToast(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = 0; }, 2000);
}

/* =====================================================
 * 十三、生存数值系统：生命 / 饥饿 / 缺水（每条 10 格）
 * ===================================================== */
let food = { apple: 0, berry: 0, mushroom: 0, rawmeat: 0, meat: 0 };   // 食物袋（按个数）：苹果=碳水 / 浆果=碳水+纤维 / 蘑菇=蛋白质 / 生肉·烤肉=夜行者掉落
// 食物营养表（硬核口径）：cal 热量 kcal、pro 蛋白 g。吃进胃里（营养池）随时间吸收
// rawmeat/meat rationale：生吃 180/7 凑合，烤肉 420/24 是蛋白引擎——两块烤肉≈一天蛋白量，长肉速度≈蘑菇 4 倍
// [PLACEHOLDER · 假设：烤肉蛋白 24g；验证：吃两块烤肉后 actT>2 时的肌肉增速体感]
const FOODS = {
  apple:   { name: '苹果', cal: 300, pro: 2 },
  berry:   { name: '浆果', cal: 150, pro: 1 },
  mushroom:{ name: '蘑菇', cal: 120, pro: 6 },
  rawmeat: { name: '生肉', cal: 180, pro: 7 },
  meat:    { name: '烤肉', cal: 420, pro: 24 },
};
let statusUiT = 0;

const statusEl = document.getElementById('status');
const itemsEl = document.getElementById('items');
const waterFxEl = document.getElementById('waterFx');
const deathScreen = document.getElementById('deathScreen');
const deathReasonEl = document.getElementById('deathReason');
const cellEls = { hp: [], hunger: [], thirst: [], stam: [], cold: [], hot: [] };
const numEls = {};

function buildStatusUI() {                   // 每条 10 个格子，整行由 JS 搭出来
  [['hp', '生命'], ['hunger', '饥饿'], ['thirst', '缺水'], ['stam', '体力'], ['cold', '寒冷'], ['hot', '炎热']].forEach(([k, label]) => {
    const row = document.createElement('div'); row.className = 'vrow';
    const lbl = document.createElement('span'); lbl.className = 'vlabel'; lbl.textContent = label;
    const cells = document.createElement('div'); cells.className = 'vcells';
    cells.id = 'cells' + k[0].toUpperCase() + k.slice(1);
    const num = document.createElement('span'); num.className = 'vnum';
    num.id = 'num' + k[0].toUpperCase() + k.slice(1);
    for (let i = 0; i < 10; i++) { const c = document.createElement('i'); cells.appendChild(c); cellEls[k].push(c); }
    row.appendChild(lbl); row.appendChild(cells); row.appendChild(num);
    statusEl.appendChild(row);
    numEls[k] = num;
  });
}
function updateStatusUI() {
  const vals = { hp: Math.ceil(P.hp / 10), hunger: Math.round(P.hunger), thirst: Math.round(P.thirst), stam: Math.round(P.stam / 10), cold: Math.round(P.cold / 10), hot: Math.round(P.hot / 10) };  // round：喝满就是满，不会闪回 9 格
  for (const k of ['hp', 'hunger', 'thirst', 'stam', 'cold', 'hot']) {
    cellEls[k].forEach((c, i) => c.classList.toggle('on', i < vals[k]));
    numEls[k].textContent = k === 'hp' ? Math.ceil(P.hp) : (k === 'cold' || k === 'hot' ? Math.round(P[k]) : vals[k]);
  }
  const stamCells = cellEls.stam[0] && cellEls.stam[0].parentNode;
  if (stamCells) stamCells.classList.toggle('exhausted', P.exhausted);   // 力竭时体力格变红：一眼看出为什么跑不动
  toolLineEl.textContent = '挖掘：' + digMode().label + (P.exhausted ? ' · 没力气了' : '');
  // 罗盘：最近村庄的方向箭头（相对玩家朝向）+ 距离——迷路是探索的大敌，信息即决策
  const navEl = document.getElementById('navLine');
  if (navEl) {
    if (villageSpots.length) {
      let best = null, bd = 1e9;
      for (const v of villageSpots) { const d = (v.x - P.pos.x) ** 2 + (v.z - P.pos.z) ** 2; if (d < bd) { bd = d; best = v; } }
      const dx = best.x - P.pos.x, dz = best.z - P.pos.z;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);              // 玩家面朝方向
      const a = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);      // 有符号夹角：+90°=正右方
      const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const i8 = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      navEl.textContent = `最近村庄 ${ARROWS[i8]} ${Math.round(Math.sqrt(bd))}m`;
    } else navEl.textContent = '';
  }
  // 材料速览：身上 Top3（不用开 E 也能看见家底）
  const matEl = document.getElementById('matLine');
  if (matEl) {
    const top = Object.entries(frags).filter(e => e[1] > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
    matEl.textContent = top.length
      ? top.map(([k, v]) => BLOCKS[k].matName.replace('材料', '').replace('料', '') + ' ' + fmtMass(v)).join(' · ')
      : '还没挖到材料';
  }
}
function buildItemsBar() {                   // 物品栏：三种食物（F 吃）+ 三把镐
  itemsEl.innerHTML = '';
  const mk = (icon, key, cntId) => {
    const d = document.createElement('div');
    d.className = 'islot';
    if (icon) { icon.className = 'cube'; d.appendChild(icon); }
    if (cntId) { const c = document.createElement('div'); c.className = 'cnt'; c.id = cntId; d.appendChild(c); }
    if (key) { const k = document.createElement('div'); k.className = 'key'; k.textContent = key; d.appendChild(k); }
    itemsEl.appendChild(d);
    return d;
  };
  mk(appleIconCanvas(32), 'F', 'appleCnt').id = 'slotApple';
  mk(berryIconCanvas(32), 'F', 'berryCnt').id = 'slotBerry';
  mk(mushroomIconCanvas(32), 'F', 'mushroomCnt').id = 'slotMushroom';
  mk(meatIconCanvas(false), 'F', 'rawmeatCnt').id = 'slotRawmeat';
  mk(meatIconCanvas(true), 'F', 'meatCnt').id = 'slotMeat';
}
function updateItemsUI() {
  // 全部判空：restorePlayerFrom 在 buildItemsBar 之前也会调到这里（存档恢复路径），元素还没建不能崩
  const set = (id, cnt, v) => { const el = document.getElementById(id); if (el) { el.textContent = cnt; el.classList.toggle('off', !v); } };
  set('appleCnt', food.apple, food.apple > 0); set('slotApple', food.apple, food.apple > 0);
  set('berryCnt', food.berry, food.berry > 0); set('slotBerry', food.berry, food.berry > 0);
  set('mushroomCnt', food.mushroom, food.mushroom > 0); set('slotMushroom', food.mushroom, food.mushroom > 0);
  set('rawmeatCnt', food.rawmeat, food.rawmeat > 0); set('slotRawmeat', food.rawmeat > 0);
  set('meatCnt', food.meat, food.meat > 0); set('slotMeat', food.meat > 0);
}
function meatIconCanvas(cooked) {            // 画一块肉（生的血红 / 熟的焦褐带烤痕）
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = cooked ? '#9c5b2e' : '#c04343';
  g.beginPath(); g.ellipse(15, 19, 11, 8, 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = cooked ? '#7a421e' : '#8f2b2b';
  g.beginPath(); g.ellipse(13, 21, 6, 4, 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#efe6d4'; g.fillRect(21, 8, 4, 9); g.beginPath(); g.arc(23, 7, 3, 0, Math.PI * 2); g.fill();   // 骨头把
  if (cooked) { g.strokeStyle = '#5a3014'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, 15); g.lineTo(20, 23); g.stroke(); }
  return cv;
}
function tileIconCanvas(id, size) {          // 从图集裁方块的贴图当图标（清晰）
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const t = BLOCKS[id].tiles;
  const tile = t.all !== undefined ? t.all : t.side;
  const sx = (tile % 4) * TILE_PX, sy = ((tile / 4) | 0) * TILE_PX;
  if (SHAPES[id]) {                          // 造型：画成缩小/压扁的样子
    if (SHAPES[id].size[1] < 1) g.drawImage(atlasTexture.image, sx, sy + TILE_PX / 2, TILE_PX, TILE_PX / 2, 0, size / 2, size, size / 2);
    else g.drawImage(atlasTexture.image, sx + TILE_PX * 0.3, sy, TILE_PX * 0.4, TILE_PX, size * 0.3, 0, size * 0.4, size);
    return cv;
  }
  g.drawImage(atlasTexture.image, sx, sy, TILE_PX, TILE_PX, 0, 0, size, size);
  return cv;
}
function pickaxeIconCanvas(headColor, size = 32) { // 画一把镐子图标
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.strokeStyle = '#8a5e33'; g.lineWidth = size * 0.13; g.lineCap = 'round';
  g.beginPath(); g.moveTo(size * 0.26, size * 0.82); g.lineTo(size * 0.66, size * 0.32); g.stroke();
  g.strokeStyle = headColor; g.lineWidth = size * 0.16;
  g.beginPath(); g.arc(size * 0.42, size * 0.44, size * 0.4, -Math.PI * 0.82, -Math.PI * 0.18); g.stroke();
  return cv;
}
function appleIconCanvas(size) {             // 画一个苹果图标
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#e53935';
  g.beginPath(); g.arc(size / 2, size * 0.6, size * 0.3, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7cb342';
  g.beginPath(); g.ellipse(size * 0.63, size * 0.27, size * 0.13, size * 0.06, -0.6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#5d4037'; g.lineWidth = size * 0.05;
  g.beginPath(); g.moveTo(size * 0.5, size * 0.32); g.lineTo(size * 0.53, size * 0.16); g.stroke();
  return cv;
}
function berryIconCanvas(size) {             // 画一串浆果图标
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  for (const [bx, by, r] of [[0.38, 0.62, 0.14], [0.62, 0.58, 0.13], [0.5, 0.76, 0.12]]) {
    g.fillStyle = '#8e24aa';
    g.beginPath(); g.arc(size * bx, size * by, size * r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c05fd6';
    g.beginPath(); g.arc(size * (bx - 0.04), size * (by - 0.05), size * r * 0.35, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#7cb342';
  g.beginPath(); g.ellipse(size * 0.5, size * 0.3, size * 0.14, size * 0.07, 0, 0, Math.PI * 2); g.fill();
  return cv;
}
function mushroomIconCanvas(size) {          // 画一个蘑菇图标
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#c98a5a';
  g.beginPath(); g.arc(size * 0.5, size * 0.45, size * 0.36, Math.PI, 0); g.fill();
  g.fillRect(size * 0.14, size * 0.45, size * 0.72, size * 0.08);
  g.fillStyle = '#a06b42';
  for (const [dx, dy, r] of [[0.32, 0.32, 0.06], [0.55, 0.28, 0.05], [0.68, 0.38, 0.045]])
    { g.beginPath(); g.arc(size * dx, size * dy, size * r, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#efe6d4';
  g.fillRect(size * 0.4, size * 0.53, size * 0.2, size * 0.34);
  return cv;
}
function eat() {                             // F：吃一口 —— 营火旁先烤肉；蛋白缺口大先吃蘑菇；烤肉优先；生肉是绝望选项
  if (campfireNear(2.5) && food.rawmeat > 0) {   // 营火旁：把生肉烤了（决策：带回家烤，还是当场生吞）
    food.rawmeat--; food.meat++;
    noiseHit(2400, 0.25, 0.15, 'highpass', 1);   // 滋啦——
    setTimeout(() => noiseHit(1800, 0.15, 0.1, 'highpass', 1), 150);
    showToast('肉烤好了（+420kcal · 蛋白 24g 的硬菜）');
    updateItemsUI(); updateStatusUI();
    ateOnce = true; checkGoals();
    return;
  }
  if (P.calPool > 1600) { showToast('胃里塞满了，消化消化再来'); return; }
  let pick = null;
  if (P.proPool < 12 && food.mushroom > 0) pick = 'mushroom';
  else if (food.meat > 0) pick = 'meat';         // 烤肉：热量蛋白双高，留着压舱不如吃了长劲
  else if (food.apple > 0) pick = 'apple';
  else if (food.berry > 0) pick = 'berry';
  else if (food.mushroom > 0) pick = 'mushroom';
  else if (food.rawmeat > 0) pick = 'rawmeat';   // 实在没得吃了……生的也是肉
  if (!pick) { showToast('没吃的了——挖树叶掉苹果/浆果，树下采蘑菇，夜里杀夜行者掉肉'); return; }
  food[pick]--;
  const f = FOODS[pick];
  P.calPool = Math.min(2000, P.calPool + f.cal);
  P.proPool = Math.min(120, P.proPool + f.pro);
  P.stam = Math.min(100, P.stam + 8);        // 糖原立刻回一点体力
  noiseHit(700, 0.1, 0.18);
  setTimeout(() => noiseHit(500, 0.1, 0.15), 120);
  showToast(pick === 'rawmeat' ? `生吞了${f.name}（+${f.cal}kcal · 腥，但活着）` : `吃了${f.name}（+${f.cal}kcal · 蛋白 +${f.pro}g）`);
  updateItemsUI(); updateStatusUI();
  ateOnce = true; checkGoals();
}
function drink() {                           // R：喝附近的水
  const px = Math.floor(P.pos.x), py = Math.floor(P.pos.y + 1.2), pz = Math.floor(P.pos.z);
  let found = false;
  for (let dx = -2; dx <= 2 && !found; dx++) for (let dy = -2; dy <= 2 && !found; dy++) for (let dz = -2; dz <= 2 && !found; dz++)
    if (getBlock(px + dx, py + dy, pz + dz) === 8) found = true;
  if (!found) { showToast('附近没有水'); return; }
  P.thirst = 10;
  noiseHit(900, 0.15, 0.2, 'lowpass', 3);
  tone(400, 0.15, 0.1, 'sine', 1.5);
  showToast('喝水（缺水已回满）');
  updateStatusUI();
  drankOnce = true; checkGoals();
}
function hurt(dmg, cause) {                  // 受伤
  if (state === 'dead') return;              // 已经死了：别再扣血、别重播死亡音效
  P.hp = Math.max(0, P.hp - dmg);
  noiseHit(200, 0.15, dmg >= 1 ? 0.25 : 0.1);   // 刮蹭级小伤轻响一下就行
  updateStatusUI();
  if (P.hp <= 0) die(cause);
}
function die(reason) {
  deathReasonEl.textContent = reason + '。物品、工具和经验都还在。';
  setState('dead');
  if (audioCtx && !muted) [[392, 0], [330, 0.15], [262, 0.3]].forEach(([f, d]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    const t = audioCtx.currentTime + d;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.32);
  });
}
/* ==== 待办计划：健身与营养系统（硬核人体数据，分段实现） ====
 * 已落地（第一段）：体质两条硬数据 —— 肌肉量 kg / 体脂率 %，以及基础代谢 BMR = 370 + 32×肌肉(kg)。
 *   肌肉多 → 产热旺（寒冷积累变慢）；体脂高 → 隔热好（抗冻）但散热差（中暑快）。
 * 待实现（后续版本）：
 *   1. 蛋白质食物（兽肉/鱼/蛋）：吃蛋白质维持肌肉；蛋白质盈余 + 运动（疾跑/攀爬/挖掘）→ 长肌肉 → 力量与挖掘速度加成
 *   2. 蛋白质长期缺口 → 肌肉流失：力量下降、BMR 降低、越来越怕冷
 *   3. 碳水食物（苹果/浆果/烤薯）：快速能量，决定疾跑耐力池；缺口 → 体力上限临时缩水
 *   4. 热量总盈余 → 长肥肉：抗冻 + 摔伤缓冲，但散热差、疾跑上限降、攀爬变慢
 *   5. 热量缺口 → 掉肥肉：怕冷；体脂过低时寒夜直接失温
 */
function survivalTick(dt) {                  // 每帧：数值随时间变化（现实时间尺度）+ 硬核营养代谢
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  // —— 营养代谢（营养时钟：1 现实秒 = 30 营养秒，一天约 48 现实分钟）——
  // 活动系数：挖掘 2.8 / 疾跑 4 / 移动 1.6 / 静息 1.2；运动量累计（长肌肉的前提）
  let act = 1.2;
  if (mining.active) act = 2.8;
  else if (sprinting) act = 4;
  else if (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']) act = 1.6;
  if (act > 2) P.actT = Math.min(30, P.actT + dt);
  P.actT = Math.max(0, P.actT - dt * 0.25);
  const BMR = 370 + 32 * P.muscle;
  const nH = dt / 120;                       // 经过多少"营养小时"
  // 热量：从胃里烧，烧空了烧脂肪；溢出 600 以上转脂肪
  const burn = BMR * act / 24 * nH;
  P.calPool -= burn;
  if (P.calPool < 0) {
    const fatBurn = -P.calPool;
    P.fatPct = Math.max(3, P.fatPct - fatBurn / 1100);
    P.calPool = 0;
  } else if (P.calPool > 600) {
    P.fatPct = Math.min(50, P.fatPct + (P.calPool - 600) / 1100 * nH * 60);
  }
  // 蛋白：需求 = 肌肉×1.6g/日；盈余+运动 → 长肌肉；亏空 → 掉肌肉（最小 15kg）
  const proNeed = P.muscle * 1.6 / 24 * nH;
  P.proPool -= proNeed;
  if (P.proPool > 6 && P.actT > 2) {         // 练 + 吃：肌肉合成（约 10 分钟 +1kg）
    const gain = Math.min(0.2 * nH, (P.proPool - 6) / 25);
    P.muscle = Math.min(60, P.muscle + gain);
    P.proPool -= gain * 25;
    P.actT = Math.max(0, P.actT - 2 * gain * 10);
  } else if (P.proPool < 0) {
    P.muscle = Math.max(15, P.muscle - 0.15 * nH);
    P.proPool = 0;
  }
  P.calPool = Math.min(2000, P.calPool);     // 胃容量
  P.proPool = Math.min(120, P.proPool);
  // 饥饿条 = 胃里热量的直观展示（10 格 = 800 kcal）
  P.hunger = Math.max(0, Math.min(10, P.calPool / 80));
  P.thirst = Math.max(0, P.thirst - dt / 480 * (sprinting ? 1.6 : 1));   // 满水到脱水：约 80 分钟
  // 体脂过低 + 断粮：身体撑不住，缓慢掉血
  if (P.fatPct <= 3 && P.calPool <= 0) { P.hp -= 0.05 * dt; if (P.hp <= 0) { P.hp = 0; die('你饿得皮包骨，倒下了'); } }
  // 体温：产热看基础代谢（肌肉越多烧得越旺），隔热/散热看体脂（肥肉保热但捂汗）
  const heatMul = 1 + (32 - P.muscle) * 0.006;          // 肌肉 32kg 为基准：+10kg 抗冻 6%，-10kg 更怕冷 6%
  const insCold = 1 - P.fatPct / 100 * 0.8;             // 体脂 15% → 寒冷积累 ×0.88
  const insHot = 1 + P.fatPct / 100 * 0.6;              // 体脂 15% → 中暑积累 ×1.09
  // 有效气温 = 天气温度 − 夜间降温×夜深程度（有屋顶减半）。室内系数 0.45：盖房子抗寒是真实收益
  // rationale 0.45：一间木板屋≈现实里体感+5~8°C；雪原暴雪夜 -18°C 屋内约 -12°C——还是要生火，但活得下来
  const effTemp = curTemp - NIGHT_DROP * nightFactor * (sheltered ? 0.5 : 1);
  if (effTemp < 12) P.cold = Math.min(100, P.cold + (12 - effTemp) * 0.012 * heatMul * insCold * (sheltered ? 0.45 : 1) * dt);
  else P.cold = Math.max(0, P.cold - 0.5 * dt);
  if (effTemp > 30) P.hot = Math.min(100, P.hot + (effTemp - 30) * 0.012 * insHot * (sheltered ? 0.85 : 1) * dt);
  else P.hot = Math.max(0, P.hot - 0.5 * dt);
  if (fireWarmth > 0) P.cold = Math.max(0, P.cold - 3.5 * fireWarmth * dt);   // 烤火：冻僵了靠火真回得来（不只是慢下来）
  let cause = null;
  if (P.thirst <= 0) { P.hp -= 0.15 * dt; cause = '你渴死了'; }
  if (P.cold >= 100) { P.hp -= 0.15 * dt; cause = cause || '你冻死了'; }          // 失温：掉血 + 跑不动（×0.7 在移动里）
  if (P.hot >= 100) { P.hp -= 0.08 * dt; P.thirst = Math.max(0, P.thirst - 0.02 * dt); cause = cause || '你热死了'; }   // 中暑：掉血 + 脱水加快
  if (!cause && P.hunger >= 7 && P.thirst >= 7 && P.hp < 100) P.hp = Math.min(100, P.hp + 0.8 * dt);  // 吃饱喝足慢慢回血
  if (cause && P.hp <= 0) { P.hp = 0; die(cause); }
}

/* =====================================================
 * 十三B、肌肉兑现（红线：不改移动/攀爬/挖掘的既有数学，只在「耗力」上乘系数）
 * ===================================================== */
// effortMult：42/(10+肌肉kg)。32kg=×1.00（基准），42kg=×0.77（省 23% 力气），22kg=×1.31（虚得慌）
// rationale：肌肉是力气本钱——练出来的每一公斤都该看得见；但幅度克制（±25%），别让数值碾压操作
// 应用点：疾跑/攀爬/挖掘/攻击的体力消耗。验证：DEBUG.effort() 配合 DEBUG.setBody(42,15) 前后挖同一块石头计时
function effortMult() { return 42 / (10 + P.muscle); }

/* =====================================================
 * 十三C、昼夜系统：14 分钟一整天，太阳月亮星星各就各位
 * purpose：夜晚=威胁窗口（夜温+夜行者），把「赶在天黑前」变成每 10 分钟一次的节奏器
 * 输入：dt；输出：光照曲线、天色（雾/清屏色/穹顶）、日月位置、nightFactor（怪/夜温共用）
 * 边界：tDay 跨 1 时 dayCount++ 并结算 onDawn（提示+存档）；失败表现：极端相位也只是颜色难看，逻辑不炸
 * ===================================================== */
const _skyDayC = new THREE.Color(0x9fd4f2), _skyNightC = new THREE.Color(0x0a1024), _skyDuskC = new THREE.Color(0xd98a4a);
const _skyCol = new THREE.Color();
const _sunDirV = new THREE.Vector3();
let lastPhaseName = '';
function dayPhase() { return tDay < DAY_DUSK ? '白天' : tDay < DAY_NIGHT ? '黄昏' : tDay < DAY_DAWN ? '夜晚' : '黎明'; }
function clockText() {                     // tDay → 24 小时制（t=0 是 06:00）
  const h = (6 + tDay * 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
function updateDayNight(dt) {
  tDay += dt / DAY_LEN;
  if (tDay >= 1) { tDay -= 1; dayCount++; onDawn(); }
  const isDayArc = tDay < DAY_NIGHT;                            // 太阳弧（黎明段也算太阳弧的尾巴）
  const p = isDayArc ? tDay / DAY_NIGHT : (tDay - DAY_NIGHT) / (1 - DAY_NIGHT);
  const sy = Math.sin(Math.PI * p);                             // 日/月在弧上的高度 0..1..0
  const dayL = isDayArc ? Math.min(1, sy * 1.35) : 0;           // 白天光量（夜=0）
  nightFactor = isDayArc ? Math.max(0, Math.min(1, 1 - sy * 3.2)) : 1;   // 黄昏渐深、黎明渐亮
  _sunDirV.set(Math.cos(Math.PI * p), Math.max(sy, 0.02), 0.35).normalize();
  // —— 光照曲线：夜 0.10 的天光（月光下勉强认路）+ 方向光晨昏偏橙、夜里冷蓝 ——
  hemi.intensity = (0.10 + 0.85 * dayL) * dimCur;
  sun.intensity = 0.12 + 0.5 * Math.pow(dayL, 0.7);
  sun.color.setHex(dayL > 0.3 ? 0xfff4e0 : dayL > 0.03 ? 0xffc9a0 : 0x8fa3c8);
  sun.position.copy(_sunDirV).multiplyScalar(100);              // 方向光：从日月方向照过来
  // —— 太阳/月亮 sprite（跟着 skyGroup 贴玩家）——
  if (isDayArc || tDay >= DAY_DAWN) {
    sunSprite.visible = sy > -0.05;
    sunSprite.position.copy(_sunDirV).multiplyScalar(185);
    sunSprite.lookAt(skyGroup.position);
    sunSprite.material.color.setHex(dayL > 0.3 ? 0xffffff : 0xffb070);
    moonSprite.visible = false;
  } else {
    moonSprite.visible = sy > -0.05;
    moonSprite.position.copy(_sunDirV).multiplyScalar(185);
    moonSprite.lookAt(skyGroup.position);
    sunSprite.visible = false;
  }
  starsMat.opacity = nightFactor * 0.9;
  // —— 天色：夜→昼基色，再向晨昏橙偏移；乘天气亮度（阴雨天整体压暗）——
  const duskK = Math.max(0, 1 - Math.abs(sy - 0.18) / 0.2) * (isDayArc ? 1 : 0.5);
  _skyCol.copy(_skyNightC).lerp(_skyDayC, Math.min(1, dayL * 1.6)).lerp(_skyDuskC, duskK * 0.5);
  _skyCol.multiplyScalar(0.45 + 0.55 * dimCur);
  scene.fog.color.copy(_skyCol);
  renderer.setClearColor(_skyCol);
  skyDomeMat.color.copy(_skyCol).multiplyScalar(1.3);           // 穹顶若被渲染，颜色与雾一致（多数情况被 far 面裁掉）
  // —— 相位切换的一句人话 ——
  const ph = dayPhase();
  if (ph !== lastPhaseName) {
    if (ph === '黄昏' && state === 'playing') showToast('太阳落山了……生火（火把/营火），或者回有屋顶的地方');
    if (ph === '夜晚' && state === 'playing' && dayCount === 1) showToast('第一夜：夜行者怕火，待在火光边上');
    lastPhaseName = ph;
  }
  weatherLineEl.textContent = `第${dayCount}天 ${ph} ${clockText()} · ${WEATHERS[weatherIdx].name} ${Math.round(curTemp)}°C`;
}
function onDawn() {                        // 天亮：结算「活过一夜」+ 存档点
  if (state === 'playing' || state === 'paused') showToast(`☀ 第 ${dayCount} 天 · 你活过了昨晚`);
  if (audioCtx && !muted) tone(523, 0.15, 0.15, 'triangle', 1.2);
  checkGoals();
  saveGame(true);
}

/* =====================================================
 * 十三D、火光系统：火把/营火（煤的去处）
 * purpose：夜间的光/热/驱怪安全区；输入：放置/挖碎/燃尽事件；输出：光源、取暖系数、驱怪半径、烤肉
 * 边界：全部火把合成 2 个网格（棍+亮头）+ 4 盏点光源池轮换最近的——draw calls 恒定不涨
 * 失败表现：光源池满时远处的火只剩自发光贴图（没有动态光，可接受）
 * ===================================================== */
const torches = new Map();                 // 体素索引 → { x, y, z, rem }（rem=剩余燃烧秒）
const campfires = new Map();
const fireStickMat = new THREE.MeshLambertMaterial({ map: atlasTexture });
const fireGlowMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });   // 不受光照：黑夜里也亮
let fireStickMesh = null, fireGlowMesh = null;
function viToXYZ(vi) { const y = vi % WY, v = (vi - y) / WY; return [Math.floor(v / WZ), y, v % WZ]; }
function rebuildFireMeshes() {             // 所有火合成两个网格（放置/注销/燃尽时才调用，不在热循环）
  if (fireStickMesh) { scene.remove(fireStickMesh); fireStickMesh.geometry.dispose(); fireStickMesh = null; }
  if (fireGlowMesh) { scene.remove(fireGlowMesh); fireGlowMesh.geometry.dispose(); fireGlowMesh = null; }
  const sPos = [], sNor = [], sUV = [], sInd = [], gPos = [], gInd = [];
  const addFace = (P, N, U, I, F, cx, cy, cz, w, h, d, uvR) => {
    const a = P.length / 3;
    for (const v of F.v) {
      P.push(cx + (v[0] - 0.5) * w, cy + (v[1] - 0.5) * h, cz + (v[2] - 0.5) * d);
      if (N) N.push(F.n[0], F.n[1], F.n[2]);
      if (U && uvR) U.push(uvR.u0 + v[F.uv[0]] * (uvR.u1 - uvR.u0), uvR.v0 + v[F.uv[1]] * (uvR.v1 - uvR.v0));
    }
    I.push(a, a + 1, a + 2, a, a + 2, a + 3);
  };
  const t16 = tileUV(16), t17 = tileUV(17);
  for (const t of torches.values()) {
    for (const F of FACES) addFace(sPos, sNor, sUV, sInd, F, t.x + 0.5, t.y + 0.275, t.z + 0.5, 0.12, 0.55, 0.12, t16);
    for (const F of FACES) addFace(gPos, null, null, gInd, F, t.x + 0.5, t.y + 0.58, t.z + 0.5, 0.17, 0.14, 0.17, null);
  }
  for (const c of campfires.values()) {
    for (const F of FACES) addFace(sPos, sNor, sUV, sInd, F, c.x + 0.5, c.y + 0.13, c.z + 0.5, 0.7, 0.26, 0.7, t17);
    for (const F of FACES) addFace(gPos, null, null, gInd, F, c.x + 0.5, c.y + 0.30, c.z + 0.5, 0.55, 0.08, 0.55, null);
  }
  if (sInd.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(sNor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(sUV, 2));
    geo.setIndex(sInd);
    fireStickMesh = new THREE.Mesh(geo, fireStickMat);
    scene.add(fireStickMesh);
  }
  if (gInd.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    geo.setIndex(gInd);
    fireGlowMesh = new THREE.Mesh(geo, fireGlowMat);
    scene.add(fireGlowMesh);
  }
}
function registerTorch(x, y, z) {
  torches.set(idx(x, y, z), { x, y, z, rem: SHAPES[22].fire.life });
  rebuildFireMeshes();
  noiseHit(2000, 0.12, 0.12, 'highpass');        // 嚓——点着了
}
function registerCampfire(x, y, z) {
  campfires.set(idx(x, y, z), { x, y, z, rem: SHAPES[23].fire.life });
  rebuildFireMeshes();
  noiseHit(800, 0.2, 0.2); tone(160, 0.15, 0.12, 'triangle', 0.7);
}
function unregisterFire(id, vi) {
  if (id === 22) torches.delete(vi); else if (id === 23) campfires.delete(vi);
  rebuildFireMeshes();
}
// 点光源池：恒 4 盏从开机就在场景里（数量不变 → 材质不重编译），每 0.4s 指派给最近的火
const lightPool = [];
for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffb066, 0, 9, 2); scene.add(L); lightPool.push(L); }
let lightAssignT = 0;
function updateFires(dt) {
  let expired = null;                             // 燃尽名单（别在遍历里删自己）
  for (const [vi, t] of torches) { t.rem -= dt; if (t.rem <= 0) (expired = expired || []).push([22, vi]); }
  for (const [vi, c] of campfires) { c.rem -= dt; if (c.rem <= 0) (expired = expired || []).push([23, vi]); }
  if (expired) for (const [id, vi] of expired) {
    const [x, y, z] = viToXYZ(vi);
    setBlockAndRebuild(x, y, z, 0);
    unregisterFire(id, vi);
    burst(x + 0.5, y + 0.4, z + 0.5, 0x8a8a96, 5);   // 一缕青烟：火到了头
    if (state === 'playing') gainFeed(id === 22 ? '一支火把烧完了' : '营火熄了');
  }
  lightAssignT -= dt;
  if (lightAssignT <= 0) {
    lightAssignT = 0.4;
    const cand = [];
    for (const t of torches.values()) { const d = Math.hypot(t.x - P.pos.x, t.y - P.pos.y, t.z - P.pos.z); if (d < 30) cand.push([d, t.x + 0.5, t.y + 0.6, t.z + 0.5, 22]); }
    for (const c of campfires.values()) { const d = Math.hypot(c.x - P.pos.x, c.y - P.pos.y, c.z - P.pos.z); if (d < 30) cand.push([d, c.x + 0.5, c.y + 0.4, c.z + 0.5, 23]); }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < 4; i++) {
      const L = lightPool[i];
      if (i < cand.length) {
        const cfg = SHAPES[cand[i][4]].fire;
        L.position.set(cand[i][1], cand[i][2], cand[i][3]);
        L.distance = cfg.ldist; L._base = cfg.light;
      } else L._base = 0;
    }
  }
  const tt = performance.now() / 1000;            // 火苗闪烁：4 盏灯各自相位
  for (let i = 0; i < 4; i++) { const L = lightPool[i]; L.intensity = L._base ? L._base * (0.86 + 0.14 * Math.sin(tt * 13 + i * 2.1)) : 0; }
}
function campfireNear(r) {                 // 营火旁？（烤肉判定用，调用频率低）
  for (const c of campfires.values())
    if (Math.hypot(c.x + 0.5 - P.pos.x, c.y - P.pos.y, c.z + 0.5 - P.pos.z) < r) return true;
  return false;
}
// 环境节拍（0.5s 一次）：火光取暖强度 + 室内判定。喂给 survivalTick / 烤肉 / HUD
let envTickT = 0, fireWarmth = 0, sheltered = false;
function updateEnvTick(dt) {
  envTickT -= dt; if (envTickT > 0) return; envTickT = 0.5;
  fireWarmth = 0;
  for (const t of torches.values()) {
    const d = Math.hypot(t.x + 0.5 - P.pos.x, t.y - P.pos.y, t.z + 0.5 - P.pos.z);
    const w = 1 - d / SHAPES[22].fire.r; if (w > fireWarmth) fireWarmth = w;
  }
  for (const c of campfires.values()) {
    const d = Math.hypot(c.x + 0.5 - P.pos.x, c.y - P.pos.y, c.z + 0.5 - P.pos.z);
    const w = 1 - d / SHAPES[23].fire.r; if (w > fireWarmth) fireWarmth = w;
  }
  // 屋顶判定：头顶 3×3 柱向上 6 格里有 ≥4 个实心块 = 有顶（一块飘着的板不算，真屋顶一盖就是 9）
  // rationale 4：防「单板遮天」白嫖；树叶不算（挡雨不挡风——雨的粒子碰撞本来就把树叶当屋顶了）
  const px = Math.floor(P.pos.x), pz = Math.floor(P.pos.z), py = Math.floor(P.pos.y + P.ph);
  let roof = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy < 6; dy++) {
    const v = getBlock(px + dx, py + dy, pz + dz);
    if (v && v !== 8 && !BLOCKS[v].soft && !BLOCKS[v].noCollide) roof++;
  }
  sheltered = roof >= 4;
}

/* =====================================================
 * 十三E、夜行者：夜里的威胁（也是肉和蛋白的来源）
 * purpose：把「建粘合基地 / 点火 / 做武器」从可选变成刚需
 * 输入：夜晚生成，扑向玩家；输出：撞倒未粘合方块（复用 knockBlock）、啃墙（复用 doBite 同款 10cm 雕刻）、掉生肉
 * 边界：场上 ≤8 只；每帧纯标量运算零分配；天亮燃烧退场（不掉肉）；极端卡死 15s 自爆成烟
 * 失败表现：卡在悬崖/水底 → 自爆消失，绝不挡服
 * ===================================================== */
const MOB = { hp: 30, speed: 3.2, atk: 8 };          // [PLACEHOLDER · 假设：玩家快走 4.3 > 3.2，走路甩不掉、快走能拉开；验证：实机夜跑]
// 数值 rationale：hp 30=石镐两下/空手三下；atk 8=夜里挨三下会死（100血），逼你either点火either刚正面
function mobCap() { return Math.min(2 + Math.floor((dayCount - 1) * 1.2), 8); }   // 夜1=2 夜3=4 夜5=7 夜6+=8：压力随天数爬
const mobs = [];
const mobBodyGeo = new THREE.BoxGeometry(0.62, 0.85, 0.42);
const mobMat = new THREE.MeshLambertMaterial({ color: 0x232733, emissive: 0x11141c });
const mobHurtMat = new THREE.MeshLambertMaterial({ color: 0x8a2020, emissive: 0x550000 });
const mobEyeGeo = new THREE.PlaneGeometry(0.3, 0.1);
const mobEyeMat = new THREE.MeshBasicMaterial({ map: (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ff5030'; g.shadowColor = '#ff5030'; g.shadowBlur = 10;
  g.beginPath(); g.arc(20, 32, 6, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(44, 32, 6, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(cv);
})(), transparent: true });                        // 眼睛不受光：黑夜里两粒红光先到
let mobSpawnT = 10;
function sfxGrowl(dist) {                           // 低吼：隔着 40 米也能听见一点
  if (!audioCtx || muted) return;
  const vol = Math.max(0.03, 0.22 * (1 - dist / 45));
  tone(85 + Math.random() * 30, 0.5, vol, 'sawtooth', 0.7);
  setTimeout(() => { if (audioCtx && !muted) tone(70, 0.4, vol * 0.8, 'sawtooth', 0.8); }, 240);
}
function spawnMobAt(gx, gy, gz) {
  const mesh = new THREE.Mesh(mobBodyGeo, mobMat);
  const eyes = new THREE.Mesh(mobEyeGeo, mobEyeMat);
  eyes.position.set(0, 0.18, 0.22);
  mesh.add(eyes);
  scene.add(mesh);
  mobs.push({ x: gx + 0.5, y: gy + 1, z: gz + 0.5, vx: 0, vy: 0, vz: 0, hp: MOB.hp, mesh,
    atkT: 1, knockT: 0, chewT: 0, hurtT: 0, dieT: 0, burnT: 0, stuckT: 0, walkPh: Math.random() * 6, yaw: 0 });
  burst(gx + 0.5, gy + 1.2, gz + 0.5, 0x2a2f3a, 8);
}
function removeMob(i) {
  scene.remove(mobs[i].mesh);                       // 几何体/材质共享，只摘不删
  mobs.splice(i, 1);
}
function killMob(i, byPlayer) {
  const m = mobs[i];
  if (byPlayer) {
    const n = 1 + (Math.random() < 0.45 ? 1 : 0);
    food.rawmeat += n;
    gainFeed(`+${n} 生肉（营火旁按 F 烤）`);
    gainXp(6);
    mobKills++;
    checkGoals();
    updateItemsUI();
  }
  burst(m.x, m.y + 0.5, m.z, 0x2a2f3a, 10);
  noiseHit(180, 0.2, 0.25);
  tone(140, 0.25, 0.2, 'sawtooth', 0.5);
  m.dieT = 0.5;                                     // 倒地动画 0.5s 再消失
}
function mobBlocked(x, y, z) {                      // 夜行者的 AABB 是否撞到实体块（复用玩家的碰撞规则：树叶/火把可穿）
  const x0 = Math.floor(x - 0.31), x1 = Math.floor(x + 0.31 - 1e-9);
  const y0 = Math.floor(y), y1 = Math.floor(y + 0.85 - 1e-9);
  const z0 = Math.floor(z - 0.31), z1 = Math.floor(z + 0.31 - 1e-9);
  for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++)
    if (blocksPlayer(bx, by, bz)) return { x: bx, y: by, z: bz };
  return null;
}
function trySpawnMob() {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2, d = 22 + Math.random() * 16;
    const gx = Math.floor(P.pos.x + Math.cos(a) * d), gz = Math.floor(P.pos.z + Math.sin(a) * d);
    if (gx < 2 || gx >= WX - 2 || gz < 2 || gz >= WZ - 2) continue;
    const gy = topAt(gx, gz);
    if (world[idx(gx, gy, gz)] === 8) continue;                     // 不从水里冒出来
    if (Math.abs(gy - P.pos.y) > 12) continue;                      // 别从天上/地底空降
    let lit = false;                                                // 火光边不刷（安全区是安全区）
    for (const t of torches.values()) if (Math.hypot(t.x - gx, t.z - gz) < 6) { lit = true; break; }
    if (!lit) for (const c of campfires.values()) if (Math.hypot(c.x - gx, c.z - gz) < 8) { lit = true; break; }
    if (lit) continue;
    spawnMobAt(gx, gy, gz);
    sfxGrowl(d);
    return true;
  }
  return false;
}
function updateMobs(dt) {
  // 生成节拍：深夜每 14~22s 补一只，封顶随天数涨
  if (nightFactor > 0.85) {
    mobSpawnT -= dt;
    if (mobSpawnT <= 0) { mobSpawnT = 14 + Math.random() * 8; if (mobs.length < mobCap()) trySpawnMob(); }
  } else mobSpawnT = Math.max(mobSpawnT, 5);
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (m.dieT > 0) {                              // 倒地动画
      m.dieT -= dt;
      m.mesh.rotation.x = (1 - Math.max(0, m.dieT) / 0.5) * Math.PI / 2;
      if (m.dieT <= 0) removeMob(i);
      continue;
    }
    // —— 怕火：算到最近火的斥力 ——
    let fleeX = 0, fleeZ = 0, fear = 0;
    for (const t of torches.values()) {
      const d = Math.hypot(t.x + 0.5 - m.x, t.z + 0.5 - m.z), r = SHAPES[22].fire.r;
      if (d < r) { fear = Math.max(fear, (r - d) / r); fleeX += m.x - t.x - 0.5; fleeZ += m.z - t.z - 0.5; }
    }
    for (const c of campfires.values()) {
      const d = Math.hypot(c.x + 0.5 - m.x, c.z + 0.5 - m.z), r = SHAPES[23].fire.r;
      if (d < r) { fear = Math.max(fear, (r - d) / r); fleeX += m.x - c.x - 0.5; fleeZ += m.z - c.z - 0.5; }
    }
    const dx = P.pos.x - m.x, dz = P.pos.z - m.z, dist = Math.hypot(dx, dz);
    let dirX, dirZ;
    if (fear > 0.15) { const l = Math.hypot(fleeX, fleeZ) || 1; dirX = fleeX / l; dirZ = fleeZ / l; }   // 掉头逃火
    else { const l = dist || 1; dirX = dx / l; dirZ = dz / l; }
    const spd = MOB.speed * (fear > 0.5 ? 1.35 : 1) * (nightFactor < 0.3 ? 0.6 : 1);
    m.vx = dirX * spd; m.vz = dirZ * spd;
    // —— 物理：重力 + 三轴移动（撞墙记下来给下面撞倒/啃/跳用）——
    m.vy = Math.max(m.vy - GRAV * dt, -28);
    const px0 = m.x, pz0 = m.z;
    const nx = m.x + m.vx * dt;
    let blockedCell = mobBlocked(nx, m.y, m.z);
    if (!blockedCell) m.x = nx;
    const nz = m.z + m.vz * dt;
    const bz2 = mobBlocked(m.x, m.y, nz);
    if (!bz2) m.z = nz; else blockedCell = blockedCell || bz2;
    const ny = m.y + m.vy * dt;
    let onGround = false;
    const by2 = mobBlocked(m.x, ny, m.z);
    if (by2) {
      const sh = SHAPES[world[idx(by2.x, by2.y, by2.z)]];
      if (m.vy < 0) { m.y = by2.y + (sh ? sh.size[1] : 1) + 1e-3; onGround = true; }   // 造型按实际高度落脚
      else m.y = by2.y - 0.86;
      m.vy = 0;
    } else m.y = ny;
    // 卡死自爆（悬崖/水底转圈 15s）：化烟退场，绝不挡服
    if (onGround && Math.hypot(m.x - px0, m.z - pz0) < 0.004) m.stuckT += dt; else m.stuckT = 0;
    if (m.stuckT > 15) { burst(m.x, m.y + 0.5, m.z, 0x3a3f4a, 8); removeMob(i); continue; }
    // —— 撞倒 / 啃墙 / 蹬跳 ——
    m.knockT -= dt; m.chewT -= dt; m.atkT -= dt;
    if (blockedCell && onGround) {
      const vi = idx(blockedCell.x, blockedCell.y, blockedCell.z), id = world[vi];
      if (id && placedBlocks.has(vi) && !glued.has(vi) && m.knockT <= 0) {
        knockBlock(blockedCell.x, blockedCell.y, blockedCell.z, m.vx * 1.3, m.vz * 1.3);   // 复用撞倒：没粘合的墙一撞就倒
        m.knockT = 0.9;
        if (!mobs._warned) { mobs._warned = true; showToast('夜行者撞倒了你的方块——没粘合的墙挡不住它们'); }
      } else if (id && id !== 8 && !SHAPES[id] && m.chewT <= 0 && dist < 9) {
        // 啃墙：和玩家同一套 10cm 雕刻（doBite）。间隔按硬度：铁墙(4.5)是木板(1.8)的 2.5 倍耗时——铁=防御材料
        const chip = { x: blockedCell.x, y: blockedCell.y, z: blockedCell.z,
          sx: Math.abs(m.vx) > Math.abs(m.vz) ? (m.vx > 0 ? 0 : 9) : Math.max(0, Math.min(9, Math.floor((m.x - blockedCell.x + 0.5) * SUB))),
          sy: Math.max(0, Math.min(9, Math.floor((m.y + 0.5 - blockedCell.y) * SUB))),
          sz: Math.abs(m.vz) >= Math.abs(m.vx) ? (m.vz > 0 ? 0 : 9) : Math.max(0, Math.min(9, Math.floor((m.z - blockedCell.z + 0.5) * SUB))) };
        doBite(blockedCell.x, blockedCell.y, blockedCell.z, chip, 1);
        m.chewT = 1.2 * (BLOCKS[id].hardness / 3);
      } else if (!blocksPlayer(blockedCell.x, blockedCell.y + 1, blockedCell.z)
              && !blocksPlayer(blockedCell.x, blockedCell.y + 2, blockedCell.z)) {
        m.vy = 7.4;                                // 蹬一下翻 1 格（和玩家蹬沙坎同款力度）
      }
    }
    // —— 扑咬玩家 ——
    const d3 = Math.hypot(P.pos.x - m.x, (P.pos.y + 0.9) - (m.y + 0.4), P.pos.z - m.z);
    if (d3 < 1.25 && m.atkT <= 0 && state === 'playing') {
      m.atkT = 1.3;
      hurt(MOB.atk, '夜行者扑倒了你');
      const kl = Math.hypot(dx, dz) || 1;
      P.vel.x += (dx / kl) * 2.6; P.vel.z += (dz / kl) * 2.6; P.vel.y = Math.max(P.vel.y, 2.2);   // 被扑得踉跄
      P.shakeT = 0.25;
      sfxGrowl(0);
    }
    // —— 天亮自燃（烧没了：不留肉）——
    if (nightFactor < 0.5) {
      m.hp -= 12 * dt;
      m.burnT -= dt;
      if (m.burnT <= 0) { m.burnT = 0.3; burst(m.x, m.y + 0.8, m.z, 0x5a5a66, 2); }
      if (m.hp <= 0) { removeMob(i); continue; }
    }
    if (dist > 70) { removeMob(i); continue; }     // 走丢了
    // —— 表现：走路摇晃 / 受击闪红 / 眼睛朝向 ——
    m.hurtT -= dt;
    m.mesh.material = m.hurtT > 0 ? mobHurtMat : mobMat;
    m.walkPh += dt * (fear > 0.15 ? 13 : 9);
    m.mesh.position.set(m.x, m.y + 0.425 + Math.sin(m.walkPh) * 0.03, m.z);
    m.mesh.rotation.y = Math.atan2(dirX, dirZ);
    m.mesh.rotation.z = Math.sin(m.walkPh) * 0.06;
  }
}
/* ==== 战斗：左键点向夜行者 = 挥击 ====
 * 伤害 = 3 + 工具效力×7 + 肌肉/9：空手约 13 / 石镐约 19 / 铁大锤约 28（两只内解决 30 血）
 * [PLACEHOLDER · 假设：两击一只的节奏；验证：实机对拼掉血速度]
 * 边界：只认点击那一下（不连打）；打不中就照旧开始挖 */
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {   // slab 法 ray-AABB（点击时才调用，允许小对象）
  let tmin = 0, tmax = 20;
  const ax = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (let a = 0; a < 3; a++) {
    const o = ax[a][0], d = ax[a][1], lo = ax[a][2], hi = ax[a][3];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}
function tryAttack() {
  if (state !== 'playing' || !mobs.length) return false;
  const o = eyePos(), d = viewDir();
  const bh = raycastVoxel();
  const maxT = Math.min(3.4, bh ? bh.t : 3.4);     // 隔着墙打不到
  let best = null, bestT = maxT;
  for (const m of mobs) {
    if (m.dieT > 0) continue;
    const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, m.x - 0.35, m.y, m.z - 0.35, m.x + 0.35, m.y + 0.9, m.z + 0.35);
    if (t !== null && t < bestT) { bestT = t; best = m; }
  }
  if (!best) return false;
  const mode = digMode();
  const dmg = 3 + mode.power * 7 + P.muscle / 9;
  best.hp -= dmg;
  best.hurtT = 0.18;
  best.vx += d.x * 4.5; best.vz += d.z * 4.5; best.vy = Math.max(best.vy, 2.2);   // 击退
  P.stam = Math.max(0, P.stam - 6 * effortMult());
  swingT = 0;
  noiseHit(320, 0.08, 0.25); tone(180, 0.06, 0.15, 'square', 0.8);
  if (best.hp <= 0) killMob(mobs.indexOf(best), true);
  return true;
}

/* =====================================================
 * 十三F、存档系统：种子 + 世界差异 + 全状态 → localStorage
 * 断面一致：死亡（重生后存）/ 刷新（beforeunload+visibilitychange）/ 换世界（显式删档）三条路径不丢档不脏档
 * 边界：雕刻子格按位打包（1000 bits→125B→b64）；worldDiff 用全量对比（3.1M 次 Uint8 比较 ≈ 数 ms，20s 一次无感）
 * 失败表现：写入异常 → 提示一次，游戏照常（内存里的世界不受影响）
 * ===================================================== */
let origWorld = null, deletingSave = false, saveT = 20, saveWarned = false;
function packBits(bits) {                 // 1000 子格 → 125 字节 → base64
  const out = new Uint8Array(125);
  for (let i = 0; i < 1000; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < 125; i += 40) s += String.fromCharCode.apply(null, out.subarray(i, Math.min(i + 40, 125)));
  return btoa(s);
}
function unpackBits(str) {
  const bits = new Uint8Array(1000);
  if (!str) return bits;
  const s = atob(str);
  for (let i = 0; i < 1000; i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) bits[i] = 1;
  return bits;
}
function saveGame() {
  if (state === 'start' || !origWorld) return;     // 没进过世界不存（别用菜单背景覆盖真存档）
  const worldDiff = [];
  for (let i = 0; i < world.length; i++) if (world[i] !== origWorld[i]) worldDiff.push([i, world[i]]);
  const carvedArr = [];
  for (const [vi, c] of carved) carvedArr.push([vi, c.n, packBits(c.bits)]);
  const fireRem = [];
  for (const [vi, t] of torches) fireRem.push([vi, Math.round(t.rem)]);
  for (const [vi, c] of campfires) fireRem.push([vi, Math.round(c.rem)]);
  const sv = {
    v: SAVE_V, seed: SEED, dayCount, tDay: +tDay.toFixed(4),
    weather: { idx: weatherIdx, t: Math.round(weatherT), temp: +curTemp.toFixed(1) },
    player: {
      pos: [+P.pos.x.toFixed(3), +P.pos.y.toFixed(3), +P.pos.z.toFixed(3)], yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3),
      hp: +P.hp.toFixed(1), hunger: +P.hunger.toFixed(2), thirst: +P.thirst.toFixed(2), stam: +P.stam.toFixed(1),
      cold: +P.cold.toFixed(1), hot: +P.hot.toFixed(1), muscle: +P.muscle.toFixed(2), fatPct: +P.fatPct.toFixed(2),
      calPool: Math.round(P.calPool), proPool: +P.proPool.toFixed(1), actT: +P.actT.toFixed(1), xp: +P.xp.toFixed(2), stance: P.stance,
    },
    hands: { L: hands.L, R: hands.R }, frags: { ...frags }, food: { ...food }, glue, sticks, craftMat, goalIdx,
    counters: { stonesMined, craftedBlocks, craftedShapes, craftedTools, craftedPick, craftedPickIron, craftedSledge,
      benchPlaced, torchPlaced, mobKills, drankOnce, ateOnce },
    worldDiff, carved: carvedArr, placed: [...placedBlocks], glued: [...glued],
    subVox: subVox.map(o => [+o.x.toFixed(3), +o.y.toFixed(3), +o.z.toFixed(3), o.sx, o.mat]), fireRem,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(sv));
  } catch (e) {
    if (!saveWarned) { saveWarned = true; showToast('自动存档失败：浏览器存储满了'); }
  }
}
function applySave(sv) {                   // 世界与实体部分（在 buildAllChunks 之前跑，区块网格才能画对）
  for (const [vi, id] of sv.worldDiff) world[vi] = id;
  for (const [vi, n, bits] of sv.carved) carved.set(vi, { bits: unpackBits(bits), n, mesh: null });
  for (const vi of sv.placed || []) placedBlocks.add(vi);
  for (const vi of sv.glued || []) glued.add(vi);
  for (const [x, y, z, s, mat] of sv.subVox || []) addSmallBlock(x, y, z, s, mat);
  for (const [vi, id] of sv.worldDiff) {  // 造型/火把/营火从差异表里认回来（蘑菇 21 走合并网格，启动末尾统一建）
    if (!SHAPES[id] || id === 21) continue;
    const [x, y, z] = viToXYZ(vi);
    if (id === 22) torches.set(vi, { x, y, z, rem: SHAPES[22].fire.life });
    else if (id === 23) campfires.set(vi, { x, y, z, rem: SHAPES[23].fire.life });
    else addShapeMesh(x, y, z, id);
  }
  for (const [vi, rem] of sv.fireRem || []) {      // 燃烧进度恢复
    if (torches.has(vi)) torches.get(vi).rem = rem;
    else if (campfires.has(vi)) campfires.get(vi).rem = rem;
  }
  rebuildFireMeshes();
}
function restorePlayerFrom(sv) {           // 玩家与库存部分（respawn() 重置之后覆盖回来）
  const q = sv.player;
  P.pos.set(q.pos[0], q.pos[1], q.pos[2]); P.yaw = q.yaw; P.pitch = q.pitch;
  P.hp = q.hp; P.hunger = q.hunger; P.thirst = q.thirst; P.stam = q.stam; P.exhausted = P.stam <= 0;
  P.cold = q.cold; P.hot = q.hot; P.muscle = q.muscle; P.fatPct = q.fatPct;
  P.calPool = q.calPool; P.proPool = q.proPool; P.actT = q.actT; P.xp = q.xp;
  P.level = levelFromXp(P.xp);
  P.stance = q.stance || 0; applyStance();
  hands.L = sv.hands.L || null; hands.R = sv.hands.R || null;
  for (const k in frags) frags[k] = 0;
  for (const k in sv.frags) frags[k] = sv.frags[k];
  food = { apple: 0, berry: 0, mushroom: 0, rawmeat: 0, meat: 0, ...sv.food };
  glue = sv.glue || 0; sticks = sv.sticks || 0; craftMat = sv.craftMat || 3;
  goalIdx = sv.goalIdx || 0;
  const c = sv.counters || {};
  stonesMined = c.stonesMined || 0; craftedBlocks = c.craftedBlocks || 0; craftedShapes = c.craftedShapes || 0;
  craftedTools = c.craftedTools || 0; craftedPick = !!c.craftedPick; craftedPickIron = !!c.craftedPickIron; craftedSledge = !!c.craftedSledge;
  benchPlaced = !!c.benchPlaced; torchPlaced = c.torchPlaced || 0; mobKills = c.mobKills || 0;
  drankOnce = !!c.drankOnce; ateOnce = !!c.ateOnce;
  if (sv.weather) { setWeather(sv.weather.idx, true); weatherT = sv.weather.t || 90; curTemp = sv.weather.temp; }
  dayCount = sv.dayCount || 1; tDay = sv.tDay || 0.3;
  updateHandsUI(); updateStrengthUI(); updateGoals(); updateItemsUI(); updateStatusUI();
}

/* =====================================================
 * 十四、界面状态切换与主循环
 * ===================================================== */
const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
function setState(s) {
  state = s;
  if (s === 'playing') playingSince = performance.now();
  else { mining.active = false; resetMining(); }
  startScreen.classList.toggle('hidden', s !== 'start');
  pauseScreen.classList.toggle('hidden', s !== 'paused');
  craftScreen.classList.toggle('hidden', s !== 'craft');
  deathScreen.classList.toggle('hidden', s !== 'dead');
  document.body.classList.toggle('playing', s === 'playing');
}
document.getElementById('startBtn').onclick = () => { initAudio(); setState('playing'); lockPointer(); };
document.getElementById('resumeBtn').onclick = () => { initAudio(); setState('playing'); lockPointer(); };
document.getElementById('deathBtn').onclick = () => { initAudio(); respawn(); setState('playing'); lockPointer(); saveGame(); };
document.getElementById('craftClose').onclick = () => closeCraft();
document.getElementById('regenBtn').onclick = () => {   // 换世界=显式删档（唯一主动丢档的路径）
  deletingSave = true;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  showToast('正在生成新世界…');
  setTimeout(() => location.reload(), 400);
};
document.getElementById('seedTag').textContent = SEED;
// —— 设置面板（主菜单 / 暂停共用）：音量 / 灵敏度 / 瞄准线框，全部存 localStorage ——
const settingsScreen = document.getElementById('settingsScreen');
const setVolEl = document.getElementById('setVol'), setVolValEl = document.getElementById('setVolVal');
const setSensEl = document.getElementById('setSens'), setSensValEl = document.getElementById('setSensVal');
const setWire2El = document.getElementById('setWire2');
let sensMult = 1;
(function loadSettings() {
  try {
    const v = localStorage.getItem('bx_vol'); if (v !== null && +v >= 0 && +v <= 100) { setVolEl.value = v; }
    const s = localStorage.getItem('bx_sens'); if (s !== null && +s >= 30 && +s <= 200) { setSensEl.value = s; }
  } catch (e) { /* 无痕模式 */ }
  setVolValEl.textContent = setVolEl.value + '%';
  setSensValEl.textContent = setSensEl.value + '%';
  sensMult = setSensEl.value / 100;
  setWire2El.checked = settings.wireframe;
})();
function applyVol() {
  setVolValEl.textContent = setVolEl.value + '%';
  if (masterGain) masterGain.gain.value = setVolEl.value / 100 * 0.9;
  try { localStorage.setItem('bx_vol', setVolEl.value); } catch (e) {}
}
function applySens() {
  setSensValEl.textContent = setSensEl.value + '%';
  sensMult = setSensEl.value / 100;
  try { localStorage.setItem('bx_sens', setSensEl.value); } catch (e) {}
}
setVolEl.oninput = applyVol;
setSensEl.oninput = applySens;
setWire2El.onchange = () => setWireframe(setWire2El.checked);
function openSettings() { settingsScreen.classList.remove('hidden'); }
document.getElementById('menuSettingsBtn').onclick = () => openSettings();
document.getElementById('menuHelpBtn').onclick = () => document.getElementById('helpScreen').classList.remove('hidden');
document.getElementById('helpClose').onclick = () => document.getElementById('helpScreen').classList.add('hidden');
document.getElementById('pauseSettingsBtn').onclick = () => { pauseScreen.classList.add('hidden'); settingsScreen.classList.remove('hidden'); };
document.getElementById('settingsClose').onclick = () => {
  settingsScreen.classList.add('hidden');
  if (state === 'paused') pauseScreen.classList.remove('hidden');   // 从暂停进的回暂停，从主菜单进的回主菜单
};

function update(dt) {                        // 一帧的游戏逻辑（画面循环与调试 step 共用）
  _rayReady = false;                         // 新的一帧：瞄准射线重新算
  const wasG = wasGround;
  physics(dt);
  wasGround = P.onGround;
  if (!wasG && wasGround) {                  // 落地：闷响 + 高处摔伤
    noiseHit(260, 0.12, 0.2);
    stepT = 0.25;
    if (lastFallVy < -13) hurt(Math.round((-lastFallVy - 12) * 5), '你摔死了');
    if (lastFallVy < -10) impactCrater(Math.floor(P.pos.x), Math.floor(P.pos.y - 0.05), Math.floor(P.pos.z), -lastFallVy);
    lastFallVy = 0;
  }
  if (state !== 'playing') return;           // 可能刚摔死，后面不执行
  if (P.onGround && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'])) {
    stepT -= dt;                             // 走路时的脚步声，间隔随疾跑变短
    if (stepT <= 0) {
      sfxStep(getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y - 0.5), Math.floor(P.pos.z)));
      stompFootprint();                      // 软地面（雪/沙）顺便留下脚印
      stepT = (keys['ShiftLeft'] || keys['ShiftRight']) ? 0.3 : (fastWalk ? 0.42 : 0.55);   // 脚步声跟着档位变节奏
    }
  } else if (!P.onGround) stepT = 0.1;
  updateLeafBends(dt);                       // 被撞开的树叶慢慢回弹
  updateGroundMarks(dt);                     // 雨湿痕变干 / 雪痕消融
  updateHighlight();
  updateMining(dt);
  updateParticles(dt);
  updateFallers(dt);                         // 塌落中的方块/小方块
  survivalTick(dt);
  updateDayNight(dt);                        // 昼夜：时间推进 + 天色/光照/日月星（在天气前跑，闪电的加亮不被覆盖）
  updateWeather(dt);                         // 天气变化 + 雨雪粒子 + 气温 + 雷暴
  updateFires(dt);                           // 火把/营火：燃尽 + 光源池 + 闪烁
  updateMobs(dt);                            // 夜行者：生成/AI/战斗结算
  updateEnvTick(dt);                         // 0.5s 节拍：取暖强度 / 室内判定
  saveT -= dt; if (saveT <= 0) { saveT = 20; saveGame(); }   // 自动存档：20 秒一拍
  skyDrift += dt * CLOUD_SPEED;              // 云缓慢漂移，穹顶与太阳跟着玩家走
  // 云层跟着玩家平铺：图案周期 128 取整对齐，视觉无缝（世界 256 大，云不能只盖原点）
  cloudMesh.position.x = Math.floor(P.pos.x / CLOUD_PERIOD) * CLOUD_PERIOD - 192 - (skyDrift % CLOUD_PERIOD);
  cloudMesh.position.z = Math.floor(P.pos.z / CLOUD_PERIOD) * CLOUD_PERIOD - 192;
  skyGroup.position.set(P.pos.x, P.pos.y + P.eyeH, P.pos.z);
  syncPlayerModel(dt);                       // 角色模型与动画
  updateStance();                            // 蹲/趴姿态
  updateCamera(dt);                          // 相机（第一/第三人称）
  const fovT = 78 + (P.sprinting && Math.hypot(P.vel.x, P.vel.z) > 5 ? 7 : 0);   // 疾跑时视野拉宽一点，一按 Shift 就有"跑起来"的感觉
  if (Math.abs(camera.fov - fovT) > 0.02) {
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
  updateInsideView();                        // 头在树叶里时显示内壁
  // 水下蓝色滤镜（按眼睛位置算，第三人称也准确）
  waterFxEl.style.display = getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + P.eyeH), Math.floor(P.pos.z)) === 8 ? 'block' : 'none';
  statusUiT -= dt;                           // 状态条每 0.25 秒刷新一次就够
  if (statusUiT <= 0) { updateStatusUI(); statusUiT = 0.25; }
}
let last = performance.now();
let menuYaw = 0;                              // 主菜单：站在出生点慢速环视的世界全景
let fpsFrames = 0, fpsTime = 0;
const fpsLineEl = document.getElementById('fpsLine');
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5 && fpsLineEl) {           // 每 0.5 秒刷新帧率显示
    fpsLineEl.textContent = '帧率 ' + Math.round(fpsFrames / fpsTime) + ' fps · 画质 ' + Math.round(RENDER_SCALES[renderScaleIdx] * 100) + '%';
    fpsFrames = 0; fpsTime = 0;
  }
  if (state === 'playing') update(dt);
  else if (state === 'start') {               // 主菜单背景：出生点视角缓慢转头 + 云漂移
    menuYaw += dt * 0.06;
    camera.position.set(P.pos.x, P.pos.y + 1.7, P.pos.z);
    camera.rotation.set(-0.06, menuYaw, 0);
    camera.fov = 70; camera.updateProjectionMatrix();
    skyGroup.position.set(P.pos.x, P.pos.y + 1.6, P.pos.z);
    skyDrift += dt * CLOUD_SPEED;
    cloudMesh.position.x = Math.floor(P.pos.x / CLOUD_PERIOD) * CLOUD_PERIOD - 192 - (skyDrift % CLOUD_PERIOD);
    cloudMesh.position.z = Math.floor(P.pos.z / CLOUD_PERIOD) * CLOUD_PERIOD - 192;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(tick);

/* =====================================================
 * 十六、玩家角色：第三人称全身小人 + 第一人称手部
 * ===================================================== */
scene.add(camera);                          // 相机要进场景，挂在它上面的手才会被渲染
const skinMat  = new THREE.MeshLambertMaterial({ color: 0xd8a06c });   // 皮肤
const shirtMat = new THREE.MeshLambertMaterial({ color: 0xd8a06c });   // 没穿衣服：躯干也是肤色
const pantsMat = new THREE.MeshLambertMaterial({ color: 0xcf9663 });   // 光腿（略深一点好区分前后）
const shoeMat  = new THREE.MeshLambertMaterial({ color: 0xb9855a });   // 光脚
const hairMat  = new THREE.MeshLambertMaterial({ color: 0x45311f });   // 头发
function limb(mat, w, h, d, px, py, pz, parent) {   // 带"关节"的肢体：盒子挂在枢轴下方，绕关节转
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(0, -h / 2, 0);
  pivot.add(m);
  parent.add(pivot);
  return pivot;
}
const playerModel = new THREE.Group();      // 全身模型（脚底为原点，面朝 -Z，总高 1.8m）
const legL = limb(pantsMat, 0.24, 0.56, 0.24, -0.13, 0.7, 0, playerModel);
const legR = limb(pantsMat, 0.24, 0.56, 0.24,  0.13, 0.7, 0, playerModel);
const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.3), shoeMat);   // 鞋钉在腿末端
shoeL.position.set(0, -0.63, 0.02); legL.add(shoeL);
const shoeR = shoeL.clone(); legR.add(shoeR);
const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.26), shirtMat);
bodyMesh.position.set(0, 0.7 + 0.325, 0);
playerModel.add(bodyMesh);
const armL = limb(shirtMat, 0.2, 0.62, 0.2, -0.35, 1.33, 0, playerModel);
const armR = limb(shirtMat, 0.2, 0.62, 0.2,  0.35, 1.33, 0, playerModel);
const handR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), skinMat);  // 手
handR.position.set(0, -0.36, 0); armR.add(handR);
const headPivot = new THREE.Group();        // 头跟着视角上下看
headPivot.position.set(0, 1.35, 0);
const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.45), skinMat);
headMesh.position.set(0, 0.21, 0);
headPivot.add(headMesh);
const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.16, 0.49), hairMat);
hairMesh.position.set(0, 0.36, -0.03);
headPivot.add(hairMesh);
playerModel.add(headPivot);
playerModel.visible = false;
scene.add(playerModel);

// 手里的方块：第一人称挂在相机上，第三人称挂在右手上（两个网格，同一套贴图 UV）
const heldMatFP = new THREE.MeshLambertMaterial({ map: atlasTexture, depthTest: false, transparent: true });
const heldMatTP = new THREE.MeshLambertMaterial({ map: atlasTexture });
const fpGroup = new THREE.Group();          // 第一人称：小臂 + 手中方块，永远画在最上层
const fpArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.5), new THREE.MeshLambertMaterial({ color: 0xd8a06c, depthTest: false, transparent: true }));
fpArm.position.set(0.34, -0.4, -0.5);
fpArm.rotation.set(0.5, -0.35, 0.05);
fpArm.renderOrder = 998;
fpGroup.add(fpArm);
const fpArmL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.5), fpArm.material);   // 左臂：双手刨时才出现
fpArmL.position.set(-0.34, -0.4, -0.5);
fpArmL.rotation.set(0.5, 0.35, -0.05);
fpArmL.renderOrder = 998;
fpArmL.visible = false;
fpGroup.add(fpArmL);
const fpBlock = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), heldMatFP);
fpBlock.position.set(0, 0.1, -0.26);        // 托在手臂末端（跟手一起挥）
fpBlock.renderOrder = 999;
fpArm.add(fpBlock);
const fpTool = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.46), new THREE.MeshLambertMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
fpTool.position.set(0, 0.12, -0.3);         // 手里握着的工具：按材料着色的棍状物
fpTool.renderOrder = 997;
fpArm.add(fpTool);
fpGroup.visible = false;
camera.add(fpGroup);
const heldCubeTP = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), heldMatTP);
heldCubeTP.position.set(0, -0.44, -0.14);
heldCubeTP.visible = false;
armR.add(heldCubeTP);
const tpTool = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.46), new THREE.MeshLambertMaterial({ color: 0xffffff }));
tpTool.position.set(0, -0.46, -0.14);
tpTool.visible = false;
armR.add(tpTool);
function setCubeTileUV(mesh, tile) {        // 立方体六面 UV 指到贴图集的某格
  setBoxTileUV(mesh.geometry, tile);
  mesh.geometry.attributes.uv.needsUpdate = true;
}
function updateHeldItem() {                 // 换手持物：右手拿方块→方块模型；拿工具→材料色工具模型
  if (!window.__heldReady) return;
  const h = hands.R;
  const hasBlock = !!h && !h.tool;
  fpBlock.visible = heldCubeTP.visible = hasBlock;
  fpTool.visible = tpTool.visible = !!h && !!h.tool;
  if (hasBlock) {
    const tl = BLOCKS[h.id].tiles;
    const tile = tl.all !== undefined ? tl.all : tl.side;
    setCubeTileUV(fpBlock, tile); setCubeTileUV(heldCubeTP, tile);
  } else if (h && h.tool) {
    const c = BLOCKS[h.mat].color;
    fpTool.material.color.set(c); tpTool.material.color.set(c);
    const sc = TOOL_KINDS[h.tool].bite / 2;  // 工具越大握着越长
    fpTool.scale.set(sc, sc, 1); tpTool.scale.set(sc, sc, 1);
  }
}
let viewMode = loadPref('view', 'first');    // 'first' 第一人称 / 'third' 第三人称（F5 或 V 切换，会记住）
const eyeV = new THREE.Vector3(), viewDirV = new THREE.Vector3();
function eyePos() { return eyeV.set(P.pos.x, P.pos.y + P.eyeH, P.pos.z); }
function viewDir() {                        // 视线方向：由 yaw/pitch 算，第三人称瞄准也以眼睛为准
  return viewDirV.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
}
let walkPhase = 0, swingT = 1;              // 走路相位 / 挥手进度（0 刚挥，1 收住）
const lastModelPos = new THREE.Vector3();   // 上一帧位置：走路动画靠位置差算速度（引擎不走 vel）
let modelFirst = true;
function syncPlayerModel(dt) {              // 每帧：模型贴着玩家、四肢按速度摆动
  const hSpeed = modelFirst ? 0 : Math.hypot(P.pos.x - lastModelPos.x, P.pos.z - lastModelPos.z) / Math.max(dt, 1e-4);
  lastModelPos.copy(P.pos);
  modelFirst = false;
  walkPhase += hSpeed * dt * 2.2;
  const amp = P.onGround ? Math.min(0.75, hSpeed * 0.22) : 0.1;   // 空中腿微微张开
  const s = Math.sin(walkPhase * Math.PI);
  legL.rotation.x = s * amp;
  legR.rotation.x = -s * amp;
  armL.rotation.x = (mining.active && mining.both) ? -2.3 + Math.sin(performance.now() / 80) * 0.3 : s * amp * 0.8;   // 双手刨：左手跟着一起抡
  armR.rotation.x = mining.active ? -2.3 + Math.sin(performance.now() / 80) * 0.3 : s * amp * 0.8;
  headPivot.rotation.x = P.pitch * 0.85;
  playerModel.position.copy(P.pos);
  playerModel.rotation.y = P.yaw;
  playerModel.scale.set(1, [0.97, 0.73, 0.41][P.stance], P.stance === 2 ? 1.56 : 1);   // 1.8m 素模 ×0.972 = 1.75m；蹲下变矮，趴下压扁拉长
  playerModel.visible = viewMode === 'third';
  fpGroup.visible = viewMode === 'first';
  swingT = Math.min(1, swingT + dt * 4.5);
  const k = Math.sin(swingT * Math.PI);     // 挥手：第一人称手臂向前下方抡一下
  const bob = Math.min(1, hSpeed) * 0.014;
  fpGroup.position.set(Math.cos(walkPhase * Math.PI) * bob, -k * 0.11 - Math.abs(s) * bob, 0);
  fpGroup.rotation.set(-k * 0.85, 0, 0);
  const twoHand = mining.active && mining.both && !(hands.R && hands.R.tool) && !(hands.L && hands.L.tool);
  fpArmL.visible = viewMode === 'first' && twoHand;   // 双手刨：左手也抡起来
  fpArmL.rotation.x = fpArm.rotation.x - k * 0.15;    // 左右臂错开一点，别像一根棍
}
function updateCamera(dt) {                 // 相机：第一人称贴眼睛；第三人称往后拉、被墙挡住就拉近
  if (!isFinite(P.yaw) || !isFinite(P.pitch)) { P.yaw = 0; P.pitch = -0.1; }   // 视角坏了自动回正
  P.roll = Math.max(0, P.roll - 1.6 * dt);  // 绊倒的镜头侧倾慢慢回正
  if (viewMode === 'first') {
    camera.position.set(P.pos.x, P.pos.y + P.eyeH, P.pos.z);
    camera.rotation.set(P.pitch, P.yaw, P.roll);
  } else {
    const eye = eyePos().clone(), dir = viewDir().clone();
    let dist = 4;
    for (let d = 0.5; d <= 4; d += 0.15) {  // 沿视线反方向采样，别让相机钻进墙里（树叶软块可以穿过去）
      const sx = eye.x - dir.x * d, sy = eye.y - dir.y * d, sz = eye.z - dir.z * d;
      const sv = getBlock(Math.floor(sx), Math.floor(sy), Math.floor(sz));
      if (sv && sv !== 8 && !BLOCKS[sv].soft) { dist = Math.max(0.5, d - 0.4); break; }
    }
    camera.position.set(eye.x - dir.x * dist, eye.y - dir.y * dist + 0.3, eye.z - dir.z * dist);
    camera.lookAt(eye.x, eye.y - 0.15, eye.z);
  }
  if (P.shakeT > 0) {                         // 撞墙 / 撞倒的镜头震动
    P.shakeT = Math.max(0, P.shakeT - dt);
    const k = P.shakeT * 0.06;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
    camera.rotation.z += (Math.random() - 0.5) * k;
  }
}
const insideSoftMesh = new THREE.Mesh(      // 站进柔性方块（树叶）里时看到的"内壁"，不然四周一片透明很奇怪
  new THREE.BoxGeometry(1.004, 1.004, 1.004),
  new THREE.MeshLambertMaterial({ map: atlasTexture, side: THREE.BackSide })
);
insideSoftMesh.visible = false;
scene.add(insideSoftMesh);
function updateInsideView() {               // 头所在的柔性方块：包一层它的贴图
  const cx = Math.floor(P.pos.x), cy = Math.floor(P.pos.y + P.eyeH), cz = Math.floor(P.pos.z);
  const id = getBlock(cx, cy, cz);
  if (id && id !== 8 && BLOCKS[id].soft) {   // 水(8)没有材质表条目：先排除再取属性
    const tl = BLOCKS[id].tiles;
    const tile = tl.all !== undefined ? tl.all : tl.side;
    if (insideSoftMesh._tile !== tile) { setCubeTileUV(insideSoftMesh, tile); insideSoftMesh._tile = tile; }
    insideSoftMesh.position.set(cx + 0.5, cy + 0.5, cz + 0.5);
    insideSoftMesh.visible = true;
  } else insideSoftMesh.visible = false;
}

/* =====================================================
 * 十五、测试钩子（浏览器自动化验证用，不影响游戏）
 * ===================================================== */
/* =====================================================
 * 十七、天气与体温：每种天气有自己的温度，太冷太热会出事
 * ===================================================== */
const WEATHERS = [
  { name: '晴朗', temp: 26, weight: 30 },
  { name: '多云', temp: 21, weight: 22 },
  { name: '阴天', temp: 16, weight: 14, dim: 0.72 },
  { name: '小雨', temp: 12, weight: 12, rain: true, dim: 0.55 },
  { name: '雷雨', temp: 10, weight: 7,  rain: true, storm: true, dim: 0.4 },
  { name: '下雪', temp: -6, weight: 9,  snow: true, dim: 0.85 },
  { name: '热浪', temp: 38, weight: 6 },
];
let weatherIdx = 0, weatherT = 90 + Math.random() * 90, curTemp = WEATHERS[0].temp, dimCur = 1;
let thunderT = 8, flashT = 0;                    // 雷暴：下一道闪电倒计时 / 当前闪光剩余
const flashFxEl = document.getElementById('flashFx');
const weatherLineEl = document.getElementById('weatherLine');
// 雨点/雪花：一团圆围着相机的小点，落到底就回到顶上
const precipGroup = new THREE.Group();
scene.add(precipGroup);
function makePrecip(n, size, color, opacity) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 36;
    pos[i * 3 + 1] = Math.random() * 24 - 8;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity }));
  pts.frustumCulled = false;
  pts.visible = false;
  precipGroup.add(pts);
  return pts;
}
const rainPts = makePrecip(420, 0.1, 0xa8c0e0, 0.75);
const snowPts = makePrecip(320, 0.16, 0xffffff, 0.95);
function setWeather(i, quiet) {
  i = Number.isInteger(i) ? i : 0;            // 调试接口防呆：非数字索引别污染天气状态
  weatherIdx = ((i % WEATHERS.length) + WEATHERS.length) % WEATHERS.length;
  weatherT = 60 + Math.random() * 120;
  if (!quiet) showToast('天气：' + WEATHERS[weatherIdx].name + ' · ' + WEATHERS[weatherIdx].temp + '°C');
}
function updateWeather(dt) {
  weatherT -= dt;
  if (weatherT <= 0) {                         // 换天气：加权随机，不连续重复同一种
    let total = 0;
    WEATHERS.forEach((w, i) => { if (i !== weatherIdx) total += w.weight; });
    let roll = Math.random() * total;
    for (let i = 0; i < WEATHERS.length; i++) {
      if (i === weatherIdx) continue;
      roll -= WEATHERS[i].weight;
      if (roll <= 0) { setWeather(i); break; }
    }
  }
  const w = WEATHERS[weatherIdx];
  curTemp += (w.temp - curTemp) * Math.min(1, dt * 0.25);        // 气温慢慢变过去，不跳变
  dimCur += ((w.dim || 1) - dimCur) * Math.min(1, dt * 0.5);     // 天气亮度系数（颜色/光照交给昼夜系统去乘）
  scene.fog.near = w.rain ? 40 : 60;
  scene.fog.far = w.rain ? 120 : 170;
  precipGroup.position.set(P.pos.x, P.pos.y, P.pos.z);         // 雨雪跟着人走（生成区域跟人，粒子本身在世界坐标里撞地形）
  rainPts.visible = !!w.rain;
  snowPts.visible = !!w.snow;
  const set = w.snow ? snowPts : (w.rain ? rainPts : null);
  if (set) {
    const fall = w.snow ? 2.2 : 19;
    const a = set.geometry.attributes.position, arr = a.array;
    const ax = P.pos.x, ay = P.pos.y, az = P.pos.z;            // 粒子本地坐标 → 世界坐标的锚点
    let markBudget = 1;                                        // 每帧最多新增 1 个地表痕迹（多了满地翻搅像闪烁）
    for (let i = 0; i < arr.length; i += 3) {
      const wy0 = arr[i + 1] + ay;
      arr[i + 1] -= fall * dt;
      if (w.snow) arr[i] += Math.sin(performance.now() / 900 + i) * 1.1 * dt;   // 雪花左右飘
      // 刚体碰撞：撞到实体表面/水面才算落地（屋里不淋雨、地下不下雪就是这么来的）
      if (wy0 < ay + 15) {                    // 只在够低的高度做检测（高处粒子离地远，省性能）
        const wx = arr[i] + ax, wz = arr[i + 2] + az;
        const top = groundTopAt(wx, wy0, wz);
        if (top !== null && arr[i + 1] + ay <= top) {
          // 落点表面材质（雪/雨共用）：雪面(17)/冰面(18)不留湿痕、不叠积雪痕
          const gx = Math.floor(wx), gz = Math.floor(wz), gy = Math.max(0, Math.floor(top) - 1);
          const surf = (gx >= 0 && gx < WX && gz >= 0 && gz < WZ && gy < WY) ? world[idx(gx, gy, gz)] : 0;
          if (w.snow) {
            // 雪落在非雪表面上：留积雪痕（慢慢融）
            if (surf !== 17 && surf !== 18 && markBudget > 0) { spawnGroundMark('snow', wx, top, wz); markBudget--; }
          } else if (markBudget > 0 && surf !== 17 && surf !== 18) {   // 雨：雪面/冰面不留深色湿痕
            // 雨落地：溅两粒水花 + 湿痕（几秒干）
            spawnGroundMark('rain', wx, top, wz);
            markBudget--;
            burst(wx, top + 0.05, wz, 0x7ab0d8, 2);
          }
          arr[i + 1] = 16;
          arr[i] = (Math.random() - 0.5) * 36;
          arr[i + 2] = (Math.random() - 0.5) * 36;
          continue;
        }
      }
      if (arr[i + 1] < -8) {
        arr[i + 1] = 16;
        arr[i] = (Math.random() - 0.5) * 36;
        arr[i + 2] = (Math.random() - 0.5) * 36;
      }
    }
    a.needsUpdate = true;
  }
  // 雷暴：随机闪电——画面闪白 + 加亮一瞬 + 延迟的滚雷（延迟越长雷越远的感觉）
  // rationale 间隔 7~20s：一小时雷雨约 250 道闪，够氛围不炸毛
  if (w.storm) {
    thunderT -= dt;
    if (thunderT <= 0) { thunderT = 7 + Math.random() * 13; flashT = 0.32; setTimeout(sfxThunder, 400 + Math.random() * 1600); }
  }
  if (flashT > 0) {
    flashT -= dt;
    flashFxEl.style.opacity = Math.min(0.5, flashT * 1.8);
    hemi.intensity += flashT * 6;              // 闪电把全场照亮一瞬（在昼夜系统之后跑，不会被覆盖）
  } else flashFxEl.style.opacity = 0;
}
function sfxThunder() {
  if (!audioCtx || muted) return;
  noiseHit(120, 1.1, 0.35, 'lowpass', 0.5);
  setTimeout(() => { if (audioCtx && !muted) noiseHit(80, 1.6, 0.28, 'lowpass', 0.4); }, 350);   // 回声滚雷
}

/* =====================================================
 * 十八、启动流程：生成世界 → 应用存档 → 建网格 → 复位玩家（存档覆盖）
 * 放在天气段之后：updateDayNight/restorePlayerFrom 引用的常量这时都已定值
 * ===================================================== */
generateWorld();
origWorld = world.slice();               // 生成原貌快照（3MB）：存档 diff 的对照基准
if (bootSave) applySave(bootSave);       // 有档：世界差异/雕刻/火光先铺回去
buildAllChunks();
respawn();
if (bootSave) restorePlayerFrom(bootSave);   // respawn 会重置状态：之后用存档覆盖（位置/库存/天数/天气/时间）
else { updateHandsUI(); updateStrengthUI(); updateGoals(); }
buildStatusUI();
buildItemsBar();
updateStatusUI();
updateItemsUI();
updateDayNight(0);                       // 开机先刷一次天色（否则存档在深夜时，主菜单也亮堂堂）
// 存档钩子：刷新/切后台前抢救一拍 + 死亡重生后 + 每 20s 自动（自动那份在 update 里）
addEventListener('beforeunload', () => { if (!deletingSave) saveGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !deletingSave) saveGame(); });
// 主菜单文案：有档就「继续」
if (bootSave) {
  document.getElementById('startBtn').textContent = '继 续 世 界';
  document.querySelector('.mcSub').textContent += ` · 上次玩到第 ${bootSave.dayCount} 天`;
  document.getElementById('regenBtn').textContent = '换一个世界（删档重开）';
}

window.DEBUG = {
  state: () => state,
  pos: () => ({ x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2) }),
  setPos: (x, y, z) => { P.pos.set(x, y, z); P.vel.set(0, 0, 0); },
  look: (yaw, pitch) => { P.yaw = yaw; P.pitch = pitch; },
  block: (x, y, z) => getBlock(x, y, z),
  hands: () => ({ L: hands.L && { ...hands.L }, R: hands.R && { ...hands.R } }),
  give: (id, n, hand) => { hands[hand || 'R'] = { id, n: n || 1 }; updateHandsUI(); },
  weather: i => setWeather(i),
  env: () => ({ name: WEATHERS[weatherIdx].name, temp: +curTemp.toFixed(1), cold: +P.cold.toFixed(1), hot: +P.hot.toFixed(1) }),
  keys,
  mine: () => mine(),
  place: () => place(),
  ray: () => raycastVoxel(),
  step: n => { for (let i = 0; i < n; i++) { if (state === 'playing') update(1 / 60); } renderer.render(scene, camera); },
  setState: s => setState(s),
  audio: () => audioCtx ? { state: audioCtx.state, muted } : null,
  vitals: () => ({ hp: +P.hp.toFixed(0), hunger: +P.hunger.toFixed(1), thirst: +P.thirst.toFixed(1), stam: Math.round(P.stam), exhausted: P.exhausted, sprinting: !!P.sprinting, food: { ...food }, dead: state === 'dead' }),
  speed: () => { const x0 = P.pos.x, z0 = P.pos.z; for (let i = 0; i < 60; i++) update(1 / 60); return +Math.hypot(P.pos.x - x0, P.pos.z - z0).toFixed(2); },
  setStam: v => { P.stam = Math.max(0, Math.min(100, v || 0)); },
  fov: () => +camera.fov.toFixed(1),
  fallProbe: () => ({ lastFallVy: +lastFallVy.toFixed(1), wasGround }),
  sub: () => ({ count: subVox.length }),
  subList: () => subVox.map(o => ({ x: o.x, y: o.y, z: o.z, s: o.sx })),
  stance: () => P.stance,
  carvedInfo: (x, y, z) => { const c = carved.get(idx(x, y, z)); return c ? { bitten: c.n, hasMesh: !!c.mesh } : null; },
  cohesion: (x, y, z) => { const id = world[idx(x, y, z)]; return id ? +cohesionOf(x, y, z, id).toFixed(2) : null; },
  support: (x, y, z) => supported(x, y, z) === null ? '稳' : '悬空×' + supported(x, y, z).length,
  fallers: () => fallers.map(f => ({ at: [f.x, f.y, f.z], small: !!f.small, id: f.id })),
  view: () => viewMode,
  setView: v => { viewMode = v; },
  shot: () => { camera.position.set(P.pos.x, P.pos.y + P.eyeH, P.pos.z); camera.rotation.set(P.pitch, P.yaw, 0); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  stats: () => ({ chunks: chunkMeshes.size, children: scene.children.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  sceneProbe: () => scene.children.map(o => ({ t: o.type, tris: o.geometry && o.geometry.index ? o.geometry.index.count / 3 : 0, p: o.position.toArray().map(v => +v.toFixed(1)), ro: o.renderOrder, vis: o.visible })),
  clouds: () => ({ quads: cloudMesh.geometry.index.count / 6, pos: cloudMesh.position.toArray().map(v => +v.toFixed(1)), drift: +skyDrift.toFixed(1) }),
  atlas: () => atlasTexture.image.toDataURL(),
  growth: () => ({ xp: +P.xp.toFixed(2), level: P.level, mult: +strengthMult().toFixed(2) }),
  mineState: () => ({ active: mining.active, hasTarget: mining.hasTarget, progress: +mining.progress.toFixed(2) }),
  setMine: v => { mining.active = !!v; },
  craftInfo: () => ({ sticks, glue, stonesMined, goalIdx, frags: { ...frags }, hands: { L: hands.L && { ...hands.L }, R: hands.R && { ...hands.R } }, craftMat, benchPlaced, benchNearby: benchNearby(), craftedBlocks, craftedShapes, craftedTools, craftedPick, craftedPickIron, craftedSledge }),
  giveGlue: n => { glue += n || 4; },
  phys: () => ({ climbing: P.climbing, wallFric: P.wallFric, fastWalk, onGround: P.onGround, shakeT: +P.shakeT.toFixed(2), stunT: +P.stunT.toFixed(2), wallCd: +wallHitCd.toFixed(2), placed: placedBlocks.size, glued: glued.size, fallers: fallers.length }),
  setFastWalk: v => { fastWalk = !!v; },
  traces: () => ({ footprints: stompCount, leafBends: leafBends.length, groundMarks: groundMarks.length, groundMarkList: groundMarks.map(g => ({ kind: g.kind, pos: g.m.position.toArray().map(v => +v.toFixed(1)), age: +g.t.toFixed(1) })) }),
  body: () => ({ muscle: +P.muscle.toFixed(2), fatPct: +P.fatPct.toFixed(1), bmr: Math.round(370 + 32 * P.muscle), calPool: Math.round(P.calPool), proPool: +P.proPool.toFixed(1), actT: +P.actT.toFixed(1), hp: +P.hp.toFixed(1), hunger: +P.hunger.toFixed(2), thirst: +P.thirst.toFixed(2), cold: +P.cold.toFixed(1), hot: +P.hot.toFixed(1) }),
  villages: () => villageSpots.map(v => ({ ...v })),
  biome: (x, z) => ['沙漠', '雪原', '森林/草原'][biomeAt(x, z)],
  setBody: (m, f) => { if (m !== undefined) P.muscle = m; if (f !== undefined) P.fatPct = f; updateStrengthUI(); },
  settings: () => ({ ...settings }),
  setWire: v => setWireframe(!!v),
  carvedMeshTris: (x, y, z) => { const c = carved.get(idx(x, y, z)); return c && c.mesh ? c.mesh.geometry.index.count / 3 : 0; },
  goal: () => goalEl.textContent,
  addStone: n => { stonesMined += n; checkGoals(); },
  version: 110,
  // —— v1.0 新系统 ——
  time: () => ({ day: dayCount, t: +tDay.toFixed(3), phase: dayPhase(), clock: clockText(), nightFactor: +nightFactor.toFixed(2) }),
  setTime: t => { tDay = ((+t % 1) + 1) % 1; updateDayNight(0); },
  mobs: () => mobs.map(m => ({ x: +m.x.toFixed(1), y: +m.y.toFixed(1), z: +m.z.toFixed(1), hp: +m.hp.toFixed(0), dieT: +m.dieT.toFixed(2) })),
  spawnMob: (x, z) => { const gx = Math.floor(x ?? P.pos.x + 4), gz = Math.floor(z ?? P.pos.z + 4); spawnMobAt(gx, topAt(gx, gz), gz); return mobs.length; },
  clearMobs: () => { while (mobs.length) removeMob(0); return mobs.length; },
  fires: () => ({ torches: torches.size, campfires: campfires.size, warmth: +fireWarmth.toFixed(2), sheltered }),
  giveTorch: n => { addToHands(22, n || 4); updateHandsUI(); },
  attack: () => tryAttack(),
  effort: () => +effortMult().toFixed(2),
  save: () => { saveGame(); const s = localStorage.getItem(SAVE_KEY); return { ok: !!s, bytes: s ? s.length : 0 }; },
  delSave: () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
  selfTest: () => {
    const R = { pass: 0, fail: 0, log: [] };
    const ok = (name, cond) => { if (cond) R.pass++; else { R.fail++; R.log.push('✗ ' + name); } };
    const st0 = state;
    if (state !== 'playing') setState('playing');
    P.hp = 100; P.cold = 0; P.hot = 0; P.thirst = 10;      // 测试过程可能被怪扑两下，先保满状态
    // —— 1. 存档往返：改一格 → 存 → 读回差异里有它 ——
    const tx = Math.floor(P.pos.x) + 2, tz = Math.floor(P.pos.z), ty = topAt(tx, tz) + 1;
    const tvi = idx(tx, ty, tz), oldId = world[tvi];
    world[tvi] = 3; saveGame();
    let sv = readSave();
    ok('存档：差异含测试块', !!sv && sv.worldDiff.some(d => d[0] === tvi && d[1] === 3));
    ok('存档：玩家/天数/时间字段齐', !!sv && Number.isFinite(sv.player.hp) && sv.dayCount >= 1 && Number.isFinite(sv.tDay));
    world[tvi] = oldId; saveGame();
    // —— 2. 时间系统：夜晚判定 + 跨天 ——
    const d0 = dayCount;
    tDay = 0.70; updateDayNight(0);
    ok('昼夜：t=0.70 判为夜晚', nightFactor > 0.9);
    tDay = 0.99999; updateDayNight(1 / 60);
    ok('昼夜：跨天 dayCount+1', dayCount === d0 + 1);
    tDay = 0.30; updateDayNight(0);
    // —— 3. 火把：注册 → 网格 → 光源池 → 注销 ——
    const n0 = torches.size;
    registerTorch(tx, ty - 1, tz);
    for (let i = 0; i < 30; i++) updateFires(1 / 60);      // 跑过光源分配计时器（0.4s）
    ok('火把：注册表 +1', torches.size === n0 + 1);
    ok('火把：光源池点亮', lightPool.some(L => L.intensity > 0));
    ok('火把：取暖系数>0', (() => { envTickT = 0; updateEnvTick(1); return fireWarmth > 0; })());
    unregisterFire(22, idx(tx, ty - 1, tz));
    ok('火把：注销归位', torches.size === n0);
    // —— 4. 夜行者：生成 → 追玩家 → 战斗 → 天亮烧死 ——
    const gx2 = Math.floor(P.pos.x) + 5, gz2 = Math.floor(P.pos.z);
    spawnMobAt(gx2, topAt(gx2, gz2), gz2);
    const m0 = mobs[mobs.length - 1];
    const dStart = Math.hypot(m0.x - P.pos.x, m0.z - P.pos.z);
    tDay = 0.70; updateDayNight(0);
    for (let i = 0; i < 180; i++) updateMobs(1 / 60);      // 3 秒夜
    ok('夜行者：会朝玩家逼近', Math.hypot(m0.x - P.pos.x, m0.z - P.pos.z) < dStart || !mobs.includes(m0));
    m0.x = P.pos.x - Math.sin(P.yaw) * 1.5;                // 挪到面前，视线对准它再打
    m0.z = P.pos.z - Math.cos(P.yaw) * 1.5;
    m0.y = P.pos.y;                                        // 同高，别让 pitch 挑空
    P.pitch = 0;
    const hp0 = m0.hp;
    const hit = tryAttack();
    ok('战斗：挥击命中且掉血', hit && (mobs.includes(m0) ? m0.hp < hp0 : true));
    const len0 = mobs.length;
    for (const mm of mobs) mm.x += 60;                     // 挪远，别在烧死测试里围殴玩家
    tDay = 0.30; updateDayNight(0);
    for (let i = 0; i < 600; i++) updateMobs(1 / 60);      // 10 秒白天：12hp/s 烧死
    ok('夜行者：天亮自燃退场', mobs.length < len0);
    // —— 5. 环境与守恒抽查 ——
    envTickT = 0; updateEnvTick(1);
    ok('环境：取暖/室内计算不炸', true);
    ok('质量：10cm 石方块 = 2.5g', Math.abs(smallCost(3, 0.1) - 0.0025) < 1e-9);
    ok('肌肉：effortMult(32kg)=1.00', Math.abs(effortMult() - 42 / 42) < 0.01);
    // —— 6. 性能预算 ——
    renderer.render(scene, camera);
    R.stats = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    ok('性能：draw calls < 120', R.stats.calls < 120);
    ok('性能：三角面 < 80 万', R.stats.tris < 800000);
    // —— 复位 ——
    tDay = 0.30; updateDayNight(0);
    if (st0 !== 'playing') setState(st0);
    R.summary = `${R.pass} 通过 · ${R.fail} 失败` + (R.log.length ? ' | ' + R.log.join('；') : '');
    return R;
  },
};
window.__heldReady = true;                  // 一切就绪：初始化手里的方块
updateHeldItem();
