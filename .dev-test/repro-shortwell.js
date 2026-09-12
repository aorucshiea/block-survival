// 短井测试:挖 15 秒 → 井口顶层(sy=9)是否全宽完整 → 人走过去掉不掉
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    setState('playing');
    const cx = WX >> 1, cz = WZ >> 1;
    let spot = null;
    for (const rad of [3, 2, 1, 0]) {
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
    P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0);
    P.stance = 0; applyStance();
    P.yaw = -Math.PI / 2; P.pitch = -0.56;
    for (let i = 0; i < 30; i++) update(1 / 60);

    DEBUG.setMine(true);
    let wellAnchor = null;
    for (let f = 0; f < 15 * 60; f++) {
      P.yaw = -Math.PI / 2; P.pitch = -0.56;
      update(1 / 60);
      if (mining.wellAx !== undefined) wellAnchor = { x: +mining.wellAx.toFixed(2), z: +mining.wellAz.toFixed(2) };
    }
    DEBUG.setMine(false);
    for (let i = 0; i < 30; i++) update(1 / 60);

    // 分层剖面:井区每个 y 块、每个 sy 子格层的空格率(看入口层 sy=9 是否全空)
    const layers = [];
    if (wellAnchor) {
      for (let y = spot.t; y > spot.t - 3 && y > 0; y--) {
        const row = { y, sy: [] };
        for (let sy = 9; sy >= 0; sy--) {
          let empty = 0, total = 0;
          for (let gx = Math.floor(wellAnchor.x - 0.4); gx <= Math.floor(wellAnchor.x + 0.4 - 1e-9); gx++)
            for (let gz = Math.floor(wellAnchor.z - 0.4); gz <= Math.floor(wellAnchor.z + 0.4 - 1e-9); gz++) {
              const c = carved.get(idx(gx, y, gz));
              const sx0 = Math.max(0, Math.floor((wellAnchor.x - 0.4 - gx) * 10 + 1e-6)), sx1 = Math.min(9, Math.floor((wellAnchor.x + 0.4 - gx) * 10 - 1e-6));
              const sz0 = Math.max(0, Math.floor((wellAnchor.z - 0.4 - gz) * 10 + 1e-6)), sz1 = Math.min(9, Math.floor((wellAnchor.z + 0.4 - gz) * 10 - 1e-6));
              for (let sx = sx0; sx <= sx1; sx++) for (let sz = sz0; sz <= sz1; sz++) {
                total++; if (c && c.bits[subIdx(sx, sy, sz)]) empty++;
              }
            }
          row.sy.push(sy + ':' + Math.round(empty / total * 100));
        }
        layers.push(row);
      }
    }

    // 走向井口
    let fell = false;
    const walk = [];
    if (wellAnchor) {
      const dx = wellAnchor.x - P.pos.x, dz = wellAnchor.z - P.pos.z;
      P.yaw = Math.atan2(-dx, -dz); P.pitch = 0;
      keys['KeyW'] = true;
      for (let f = 0; f < 8 * 60; f++) {
        update(1 / 60);
        if (f % 30 === 0) walk.push({ s: +(f / 60).toFixed(1), x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2) });
        if (P.pos.y < spot.t + 0.95) { fell = true; break; }
      }
      keys['KeyW'] = false;
    }
    return { spot, wellAnchor, layers, fell, finalY: +P.pos.y.toFixed(2), walkTail: walk.slice(-4) };
  });

  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
