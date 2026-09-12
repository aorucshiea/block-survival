// 测试矩阵（纯 evaluate，无真实鼠标）：所有木头相关路径的挖掘时间
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    const D = window.DEBUG;
    setState('playing');
    const out = {};

    // —— 找平地 ——
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      let flat = true;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (topAt(x + dx, z + dz) !== t) flat = false;
      if (flat && world[idx(x, t, z)] !== 8) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: 'no flat spot' };

    const px = spot.x + 0.5, pz = spot.z + 0.5 - 1.5, py = spot.t + 1;

    // 测一个目标：pin 玩家 → 瞄准 → 按住挖到碎（或超时），返回耗时
    const timeMine = (cfg, aimFn, label, maxSec) => {
      const setupFn = cfg;
      const e = () => ({ x: px, y: py + P.eyeH, z: pz });
      const pinAndAim = () => {
        P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
        const t = aimFn();
        const d = { x: t.x - e().x, y: t.y - e().y, z: t.z - e().z };
        const l = Math.hypot(d.x, d.y, d.z);
        P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
      };
      pinAndAim();
      let frames = 0; const cap = Math.round((maxSec || 20) * 60);
      D.setMine(true);
      let alive = () => true;
      let lastState = null;
      while (frames < cap) {
        pinAndAim();
        update(1 / 60);
        frames++;
        alive = setupFn.check ? setupFn.check() : null;
        if (alive === false) break;
        if (setupFn.done && setupFn.done()) break;
      }
      D.setMine(false); update(1 / 60);
      return { label, tookSec: +(frames / 60).toFixed(2), note: setupFn.report ? setupFn.report() : '' };
    };

    // —— 1. 整块原木 ——
    {
      const wx = spot.x, wy = spot.t + 1, wz = spot.z;
      const reset = () => { world[idx(wx, wy, wz)] = 4; carved.delete(idx(wx, wy, wz)); rebuildChunkAround(wx, wz); };
      reset();
      const r = timeMine(
        { done: () => world[idx(wx, wy, wz)] === 0, report: () => 'gone=' + (world[idx(wx, wy, wz)] === 0) },
        () => ({ x: wx + 0.5, y: wy + 0.5, z: wz + 0.5 }),
        '整块原木(空手)', 90
      );
      out.fullLog = r;
      // 清理
      world[idx(wx, wy, wz)] = 0; carved.delete(idx(wx, wy, wz)); rebuildChunkAround(wx, wz);
    }

    // —— 2. 木台阶（SHAPES 整块路径）——
    {
      const wx = spot.x, wy = spot.t + 1, wz = spot.z;
      world[idx(wx, wy, wz)] = 10; carved.delete(idx(wx, wy, wz)); rebuildChunkAround(wx, wz);
      const r = timeMine(
        { done: () => world[idx(wx, wy, wz)] === 0 },
        () => ({ x: wx + 0.5, y: wy + 0.25, z: wz + 0.5 }),
        '木台阶(空手)', 30
      );
      out.step = r;
      world[idx(wx, wy, wz)] = 0; rebuildChunkAround(wx, wz);
    }

    // —— 3. 小方块系列：10 / 30 / 50 / 100cm 木板 ——
    out.subs = {};
    for (const s of [0.1, 0.3, 0.5, 1.0]) {
      // 清掉场上 subVox
      while (subVox.length) removeSubVox(subVox[0]);
      const bx = spot.x + 0.5 - s / 2, bz = spot.z + 0.5 - s / 2, by = spot.t + 1;
      addSmallBlock(bx, by, bz, s, 6);
      const target = subVox[subVox.length - 1];
      let frames = 0; const cap = Math.round(30 * 60);
      const pinAndAim = () => {
        P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
        const e = { x: px, y: py + P.eyeH, z: pz };
        const d = { x: bx + s / 2 - e.x, y: by + s / 2 - e.y, z: bz + s / 2 - e.z };
        const l = Math.hypot(d.x, d.y, d.z);
        P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
      };
      pinAndAim();
      D.setMine(true);
      while (subVox.includes(target) && frames < cap) { pinAndAim(); update(1 / 60); frames++; }
      D.setMine(false); update(1 / 60);
      out.subs[s + 'm'] = { tookSec: +(frames / 60).toFixed(2), broke: !subVox.includes(target) };
    }

    // —— 4. 对照：拿石锤挖 30cm 木板 ——
    {
      while (subVox.length) removeSubVox(subVox[0]);
      hands.R = { tool: 'hammer', mat: 3, n: 1 }; updateHandsUI();   // 石锤
      const s = 0.3;
      const bx = spot.x + 0.5 - s / 2, bz = spot.z + 0.5 - s / 2, by = spot.t + 1;
      addSmallBlock(bx, by, bz, s, 6);
      const target = subVox[subVox.length - 1];
      let frames = 0; const cap = Math.round(30 * 60);
      const pinAndAim = () => {
        P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
        const e = { x: px, y: py + P.eyeH, z: pz };
        const d = { x: bx + s / 2 - e.x, y: by + s / 2 - e.y, z: bz + s / 2 - e.z };
        const l = Math.hypot(d.x, d.y, d.z);
        P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
      };
      pinAndAim();
      D.setMine(true);
      while (subVox.includes(target) && frames < cap) { pinAndAim(); update(1 / 60); frames++; }
      D.setMine(false); update(1 / 60);
      out.subsStoneHammer = { tookSec: +(frames / 60).toFixed(2), broke: !subVox.includes(target) };
      hands.R = null; updateHandsUI();
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
