// E2E:站平地 → 瞄前方地面挖井 → 走到井口 → 掉不掉?
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
    // 找平整草地(先 7x7,再 5x5,再 3x3,最后随便一块草),玩家站中心
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
    // 站中心,朝 +x 看,低头瞄前方 ~2.5m 的地面
    // eye 高 1.58,瞄 2.5m 外地面 → pitch = -atan(1.58/2.5) ≈ -0.56
    P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0);
    P.stance = 0; applyStance();
    P.yaw = -Math.PI / 2;                        // 朝 +x(视线 fwd = (-sin(yaw), -cos(yaw)) → yaw=-90° 时 fwd=(1,0)? 验证:-sin(-π/2)=1, -cos(-π/2)=0 → +x 对)
    P.pitch = -0.56;
    for (let i = 0; i < 30; i++) update(1 / 60);

    const ground = groundAimPoint();              // 可能为 null(不朝下)
    const digSec = 60;
    DEBUG.setMine(true);
    let wellAnchor = null;
    const digLog = [];
    for (let f = 0; f < digSec * 60; f++) {
      P.yaw = -Math.PI / 2; P.pitch = -0.56;
      update(1 / 60);
      if (mining.wellAx !== undefined) wellAnchor = { x: +mining.wellAx.toFixed(2), z: +mining.wellAz.toFixed(2) };
      if (f % (10 * 60) === 0) {
        const fl = wellAnchor ? wellFloor(wellAnchor.x, wellAnchor.z) : null;
        digLog.push({ s: f / 60, y: +P.pos.y.toFixed(2), well: wellAnchor, floor: fl ? { y: fl.y, sy: fl.sy } : null });
      }
    }
    DEBUG.setMine(false);
    for (let i = 0; i < 30; i++) update(1 / 60);  // 停挖稳住

    // 井剖面:井锚点为中心 ±0.4,从地表往下每层的空格率
    const profile = [];
    if (wellAnchor) {
      for (let y = spot.t; y > spot.t - 4 && y > 0; y--) {
        let empty = 0, total = 0;
        for (let gx = Math.floor(wellAnchor.x - 0.4); gx <= Math.floor(wellAnchor.x + 0.4 - 1e-9); gx++)
          for (let gz = Math.floor(wellAnchor.z - 0.4); gz <= Math.floor(wellAnchor.z + 0.4 - 1e-9); gz++) {
            const c = carved.get(idx(gx, y, gz));
            const sx0 = Math.max(0, Math.floor((wellAnchor.x - 0.4 - gx) * 10 + 1e-6)), sx1 = Math.min(9, Math.floor((wellAnchor.x + 0.4 - gx) * 10 - 1e-6));
            const sz0 = Math.max(0, Math.floor((wellAnchor.z - 0.4 - gz) * 10 + 1e-6)), sz1 = Math.min(9, Math.floor((wellAnchor.z + 0.4 - gz) * 10 - 1e-6));
            for (let sy = 0; sy < 10; sy++) for (let sx = sx0; sx <= sx1; sx++) for (let sz = sz0; sz <= sz1; sz++) {
              total++; if (c && c.bits[subIdx(sx, sy, sz)]) empty++;
            }
          }
        profile.push({ y, pct: Math.round(empty / total * 100) });
      }
    }

    // 走向井口:yaw 对准井锚,按 W 走最多 8 秒
    const walk = [];
    if (wellAnchor) {
      const dx = wellAnchor.x - P.pos.x, dz = wellAnchor.z - P.pos.z;
      P.yaw = Math.atan2(-dx, -dz);              // fwd=(-sin,-cos) 指向井
      P.pitch = 0;
      keys['KeyW'] = true;
      let fell = false;
      for (let f = 0; f < 8 * 60; f++) {
        update(1 / 60);
        if (f % 30 === 0) walk.push({ s: +(f / 60).toFixed(1), x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), g: P.onGround });
        if (P.pos.y < spot.t + 0.95) { fell = true; break; }
      }
      keys['KeyW'] = false;
      return { spot, groundAim: ground, wellAnchor, digLog, profile, fell, final: { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2) }, walkTail: walk.slice(-6) };
    }
    return { spot, groundAim: ground, wellAnchor, digLog, err: 'no well anchor — 挖井从未开始' };
  });

  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
