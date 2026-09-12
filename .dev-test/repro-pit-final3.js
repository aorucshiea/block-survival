// 最终验证 v3：挖井 → 走到"井锚正中心"（读 mining.wellAz）→ 验证下落
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
    out.layers = [];
    for (let y = spot.t; y > spot.t - 4; y--) out.layers.push({ y, id: world[idx(spot.x, y, spot.z)] });

    const pitX = spot.x + 0.5, pitZ = spot.z + 0.5;
    const yawToPit = (px, pz) => Math.atan2(-(pitX - px), -(pitZ - pz));

    // 阶段 1：坑后 0.8m 低头挖 25s
    let px = pitX, pz = pitZ - 0.8;
    P.pos.set(px, spot.t + 1.02, pz); P.vel.set(0, 0, 0);
    D.setMine(true);
    for (let f = 0; f < 25 * 60; f++) {
      P.pos.x = px; P.pos.z = pz; P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, pz); P.pitch = -0.95;
      update(1 / 60);
    }
    D.setMine(false);
    out.wellAnchor = { x: +mining.wellAx.toFixed(2), z: +mining.wellAz.toFixed(2) };

    // 井区剖面：锚点周围 60cm 内每层空格率
    const prof = [];
    for (let y = spot.t; y > spot.t - 4 && y > 0; y--) {
      const gx = Math.floor(out.wellAnchor.x), gz = Math.floor(out.wellAnchor.z);
      const sx0 = Math.max(0, Math.floor((out.wellAnchor.x - 0.3 - gx) * 10)), sx1 = Math.min(9, Math.floor((out.wellAnchor.x + 0.3 - gx) * 10));
      const sz0 = Math.max(0, Math.floor((out.wellAnchor.z - 0.3 - gz) * 10)), sz1 = Math.min(9, Math.floor((out.wellAnchor.z + 0.3 - gz) * 10));
      const c = carved.get(idx(gx, y, gz));
      if (!c) { prof.push({ y, pct: 0 }); continue; }
      let empty = 0, total = 0;
      for (let sy = 0; sy < 10; sy++) for (let sx = sx0; sx <= sx1; sx++) for (let sz = sz0; sz <= sz1; sz++) { total++; if (c.bits[subIdx(sx, sy, sz)]) empty++; }
      prof.push({ y, pct: Math.round(empty / total * 100) });
    }
    out.pitProfile = prof;

    // 阶段 2：走到井锚正中心
    const tz = out.wellAnchor.z;
    let steps = 0;
    while (pz < tz - 0.01 && steps < 240) {
      steps++;
      P.pos.x = px;
      P.pos.z = Math.min(tz, pz + 0.02);
      P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, P.pos.z); P.pitch = -0.95;
      update(1 / 60);
      pz = P.pos.z;
    }
    out.walkedTo = { z: +pz.toFixed(2) };

    // 阶段 3：站在井中心不挖，纯物理 2 秒——该掉就掉
    let droppedAt = null;
    for (let f = 0; f < 2 * 60; f++) {
      P.vel.x = 0; P.vel.z = 0;
      update(1 / 60);
      if (P.pos.y < spot.t + 0.4 && droppedAt === null) droppedAt = +(f / 60).toFixed(2);
    }
    out.droppedAt = droppedAt;
    out.afterStand = { y: +P.pos.y.toFixed(2) };

    // 阶段 4：掉进去后继续挖（沉井加深）
    if (droppedAt !== null) {
      D.setMine(true);
      let frames = 0;
      while (frames < 20 * 60) {
        P.vel.x = 0; P.vel.z = 0;
        P.yaw = yawToPit(P.pos.x, P.pos.z); P.pitch = -0.95;
        update(1 / 60); frames++;
      }
      D.setMine(false);
      out.afterSink = { y: +P.pos.y.toFixed(2), depthFromStart: +(spot.t + 1 - P.pos.y).toFixed(2), stam: Math.round(P.stam) };
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
