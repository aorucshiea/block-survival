// 模拟真实挖井：站在平地朝面前地面按住挖——记录洞形/深度/玩家位置（纯 evaluate）
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

    // —— 找平地（脚下是泥/草）——
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      const id = world[idx(x, t, z)];
      if (id !== 1 && id !== 2) continue;           // 只要泥/草地
      let flat = true;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const tt = topAt(x + dx, z + dz);
        if (tt !== t) { flat = false; }
      }
      if (flat) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: 'no flat dirt spot' };
    out.spot = spot;

    // —— 玩家站位：站 spot 北缘，低头 45° 瞄面前的地面（井口开在身前）——
    const px = spot.x + 0.5, pz = spot.z + 0.5 - 0.8, py = spot.t + 1;
    const pitCx = spot.x + 0.5, pitCz = spot.z + 0.5;   // 井口中心（身前 0.8m）

    const pin = () => {
      P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
      // 低头 45° 瞄井口中心
      const e = { x: px, y: py + P.eyeH, z: pz };
      const d = { x: pitCx - e.x, y: spot.t - e.y, z: pitCz - e.z };
      const l = Math.hypot(d.x, d.y, d.z);
      P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
    };
    pin();

    // —— 井形快照：wellFloor 深度 + 各层子格实心数 ——
    const pitProfile = () => {
      const gx = Math.floor(pitCx), gz = Math.floor(pitCz);
      // 60cm 井区（以井口中心为准）
      const sx0 = Math.max(0, Math.floor((pitCx - 0.3 - gx) * 10)), sx1 = Math.min(9, Math.floor((pitCx + 0.3 - gx) * 10));
      const sz0 = Math.max(0, Math.floor((pitCz - 0.3 - gz) * 10)), sz1 = Math.min(9, Math.floor((pitCz + 0.3 - gz) * 10));
      const layers = [];
      for (let y = spot.t; y >= spot.t - 3 && y > 0; y--) {
        const c = carved.get(idx(gx, y, gz));
        if (!c) { layers.push({ y, solid: 1000, empty: 0 }); continue; }
        let empty = 0;
        for (let sy = 0; sy < 10; sy++) for (let sx = sx0; sx <= sx1; sx++) for (let sz = sz0; sz <= sz1; sz++)
          if (c.bits[subIdx(sx, sy, sz)]) empty++;
        const total = (sx1 - sx0 + 1) * (sz1 - sz0 + 1) * 10;
        layers.push({ y, empty, total, pct: Math.round(empty / total * 100) });
        if (empty < total / 2) break;   // 没掏到一半的层不用再往下看
      }
      return layers;
    };

    // —— 挖 120 秒，每 20 秒快照 ——
    D.setMine(true);
    out.timeline = [];
    for (let f = 0; f < 120 * 60; f++) {
      pin();          // 钉住站位+视角（玩家现实中会站稳低头挖）
      update(1 / 60);
      if ((f + 1) % (20 * 60) === 0) {
        out.timeline.push({
          t: Math.round((f + 1) / 60) + 's',
          playerY: +P.pos.y.toFixed(2),
          dropped: +(P.pos.y - py).toFixed(2),
          stam: Math.round(P.stam),
          pit: pitProfile()
        });
      }
    }
    D.setMine(false);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
