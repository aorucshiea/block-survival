// 沉井验证：掉进坑后蹲下（stance=1）继续挖——应持续下沉
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
    const out = { timeline: [] };

    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      const id = world[idx(x, t, z)];
      if (id !== 1 && id !== 2) continue;
      let flat = true;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (topAt(x + dx, z + dz) !== t) flat = false;
      if (flat) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: 'no spot' };
    out.spot = spot;

    const pitX = spot.x + 0.5, pitZ = spot.z + 0.5;
    const yawToPit = (px, pz) => Math.atan2(-(pitX - px), -(pitZ - pz));

    // 挖 25s
    let px = pitX, pz = pitZ - 0.8;
    P.pos.set(px, spot.t + 1.02, pz); P.vel.set(0, 0, 0);
    D.setMine(true);
    for (let f = 0; f < 25 * 60; f++) {
      P.pos.x = px; P.pos.z = pz; P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, pz); P.pitch = -0.95;
      update(1 / 60);
    }
    D.setMine(false);
    // 走到井中心 + 掉落
    while (pz < mining.wellAz - 0.01) {
      P.pos.x = px; P.pos.z = Math.min(mining.wellAz, pz + 0.02); P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, P.pos.z); P.pitch = -0.95;
      update(1 / 60); pz = P.pos.z;
    }
    for (let f = 0; f < 120; f++) { P.vel.x = 0; P.vel.z = 0; update(1 / 60); }
    out.dropped = { y: +P.pos.y.toFixed(2) };

    // 蹲下继续挖 40s：沉井应持续下沉
    P.stance = 1; applyStance();
    D.setMine(true);
    for (let f = 0; f < 40 * 60; f++) {
      P.pos.x = px; P.vel.x = 0; P.vel.z = 0;   // x 钉住（别横向漂走），y/z 自由
      P.yaw = yawToPit(P.pos.x, P.pos.z); P.pitch = -0.95;
      update(1 / 60);
      if ((f + 1) % (8 * 60) === 0) out.timeline.push({ t: Math.round((f + 1) / 60) + 's', y: +P.pos.y.toFixed(2), depth: +(spot.t + 1 - P.pos.y).toFixed(2), stam: Math.round(P.stam), tip: document.getElementById('aimTip').textContent.slice(0, 24) });
    }
    D.setMine(false);
    P.stance = 0; applyStance();
    out.finalDepth = +(spot.t + 1 - P.pos.y).toFixed(2);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
