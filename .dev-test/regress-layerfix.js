// 回归:selfTest 全量 + 蹲挖脚下下沉(smartFootChip 层优先改动的回归)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    const out = {};
    // 1) selfTest
    try { out.selfTest = DEBUG.selfTest(); } catch (e) { out.selfTest = 'ERR: ' + e.message; }

    // 2) 蹲挖脚下:10 秒,人应下沉(旧块优先会斜着钻半边)
    setState('playing');
    const cx = WX >> 1, cz = WZ >> 1;
    let spot = null;
    for (const rad of [2, 1, 0]) {
      for (let r = 0; r < 30 && !spot; r++) for (let x = cx - r; x <= cx + r && !spot; x++) for (let z = cz - r; z <= cz + r && !spot; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        const t = topAt(x, z);
        if (world[idx(x, t, z)] !== 1) continue;
        let flat = true;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) if (topAt(x + dx, z + dz) !== t) flat = false;
        if (flat) spot = { x, z, t };
      }
      if (spot) break;
    }
    // 跨块站位:pos.x 取块边(0.2),身体 [块-0.1, 块+0.5] 跨两块——专测层优先
    P.pos.set(spot.x + 0.2, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0);
    P.stance = 1; applyStance(); keys['KeyC'] = true;
    P.yaw = 0; P.pitch = -1.5;
    for (let i = 0; i < 30; i++) update(1 / 60);
    const y0 = P.pos.y;
    DEBUG.setMine(true);
    for (let f = 0; f < 10 * 60; f++) {
      P.yaw = 0; P.pitch = -1.5; keys['KeyC'] = true;
      update(1 / 60);
    }
    DEBUG.setMine(false);
    keys['KeyC'] = false;
    // 脚下两块的顶层空格率(层优先 → 两块同层都咬,不该一块穿底一块没动)
    const layerStat = (gy, sy) => {
      const r = [];
      for (const gx of [spot.x - 1, spot.x]) {          // 玩家跨的两块
        let empty = 0, total = 0;
        const c = carved.get(idx(gx, gy, spot.z));
        for (let sx = 0; sx < 10; sx++) for (let sz = 0; sz < 10; sz++) { total++; if (c && c.bits[subIdx(sx, sy, sz)]) empty++; }
        r.push(Math.round(empty / total * 100));
      }
      return r;
    };
    out.crouchDig = {
      spot, y0: +y0.toFixed(2), yAfter10s: +P.pos.y.toFixed(2),
      sank: +(y0 - P.pos.y).toFixed(2),
      topLayerBothBlocks: layerStat(spot.t, 9)   // [块A sy9 空格率, 块B sy9 空格率] —— 都该接近覆盖区的量级,而不是一个 100 一个 0
    };
    return out;
  });

  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
