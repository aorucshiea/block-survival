// 最终验证 v2：低头挖面前井 25s → 前移到坑上方（模拟真实走位）→ 应掉下去并继续沉井
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
    out.layers = [];
    for (let y = spot.t; y > spot.t - 4; y--) out.layers.push({ y, id: world[idx(spot.x, y, spot.z)] });

    const pitX = spot.x + 0.5, pitZ = spot.z + 0.5;
    const yawToPit = (px, pz) => Math.atan2(-(pitX - px), -(pitZ - pz));

    // 阶段 1：站在坑后 0.8m 挖 25s（低头 55°，只钉平面，y 自由）
    let px = pitX, pz = pitZ - 0.8;
    P.pos.set(px, spot.t + 1.02, pz); P.vel.set(0, 0, 0);
    const phase1 = () => { P.pos.x = px; P.pos.z = pz; P.vel.x = 0; P.vel.z = 0; P.yaw = yawToPit(px, pz); P.pitch = -0.95; };

    D.setMine(true);
    for (let f = 0; f < 25 * 60; f++) { phase1(); update(1 / 60); }
    const afterDig = { y: +P.pos.y.toFixed(2), stam: Math.round(P.stam) };
    out.afterDig = afterDig;

    // 阶段 2：松开挖掘，前移 0.8m 走到坑正上方（保持低头）
    D.setMine(false);
    const targetPz = pitZ - 0.05;
    let steps = 0;
    while (pz < targetPz - 0.02 && steps < 240) {
      steps++;
      P.pos.x = px;
      P.pos.z = Math.min(targetPz, pz + 0.02);   // 每帧 2cm 前移（1.2m/s 走速）
      P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, P.pos.z); P.pitch = -0.95;
      update(1 / 60);
      pz = P.pos.z;
    }
    out.walkedTo = { x: +px.toFixed(2), z: +pz.toFixed(2) };

    // 阶段 3：站在坑上方继续挖（沉井模式）——脚下的坑应该让人掉下去，或 smartFootChip 继续掏
    D.setMine(true);
    let droppedAt = null;
    for (let f = 0; f < 30 * 60; f++) {
      P.pos.x = px; P.vel.x = 0; P.vel.z = 0;    // 只钉 x，z 和 y 都自由（人掉下去可能挪位）
      P.yaw = yawToPit(P.pos.x, P.pos.z); P.pitch = -0.95;
      update(1 / 60);
      if (P.pos.y < spot.t + 0.5 && droppedAt === null) droppedAt = +(f / 60).toFixed(1);
      if ((f + 1) % (5 * 60) === 0) out.timeline.push({ t: Math.round((f + 1) / 60) + 's', x: +P.pos.x.toFixed(1), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(1), stam: Math.round(P.stam) });
    }
    D.setMine(false);
    out.droppedAt = droppedAt;
    out.final = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2) };
    out.startY = spot.t + 1;
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
