// 沉井诊断：掉进坑后 dump 玩家 pos / 脚下层空格分布 / smartFootChip 结果
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

    const pitX = spot.x + 0.5, pitZ = spot.z + 0.5;
    const yawToPit = (px, pz) => Math.atan2(-(pitX - px), -(pitZ - pz));

    let px = pitX, pz = pitZ - 0.8;
    P.pos.set(px, spot.t + 1.02, pz); P.vel.set(0, 0, 0);
    D.setMine(true);
    for (let f = 0; f < 25 * 60; f++) {
      P.pos.x = px; P.pos.z = pz; P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, pz); P.pitch = -0.95;
      update(1 / 60);
    }
    D.setMine(false);
    while (pz < mining.wellAz - 0.01) {
      P.pos.x = px; P.pos.z = Math.min(mining.wellAz, pz + 0.02); P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(px, P.pos.z); P.pitch = -0.95;
      update(1 / 60); pz = P.pos.z;
    }
    for (let f = 0; f < 120; f++) { P.vel.x = 0; P.vel.z = 0; update(1 / 60); }
    out.anchor = { x: +mining.wellAx.toFixed(2), z: +mining.wellAz.toFixed(2) };
    out.afterDrop = { pos: [+P.pos.x.toFixed(3), +P.pos.y.toFixed(3), +P.pos.z.toFixed(3)], onGround: P.onGround, vel: [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)] };

    // 脚下层身体区空格分布
    const footProfile = () => {
      const gy = Math.max(0, Math.floor(P.pos.y - 0.01));
      const rows = [];
      const gx0 = Math.floor(P.pos.x - HALF), gx1 = Math.floor(P.pos.x + HALF - 1e-9);
      const gz0 = Math.floor(P.pos.z - HALF), gz1 = Math.floor(P.pos.z + HALF - 1e-9);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const c = carved.get(idx(gx, gy, gz));
        if (!c) { rows.push({ gx, gz, gy, bitten: 0 }); continue; }
        rows.push({ gx, gz, gy, bitten: c.n, id: world[idx(gx, gy, gz)] });
      }
      return { gy, rows, footChip: smartFootChip() };
    };
    out.footAfterDrop = footProfile();

    // 蹲下挖 10s 后再看
    P.stance = 1; applyStance();
    D.setMine(true);
    for (let f = 0; f < 10 * 60; f++) {
      P.pos.x = px; P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit(P.pos.x, P.pos.z); P.pitch = -0.95;
      update(1 / 60);
    }
    D.setMine(false);
    out.afterCrouchDig = { pos: [+P.pos.x.toFixed(3), +P.pos.y.toFixed(3), +P.pos.z.toFixed(3)], onGround: P.onGround, profile: footProfile(), climbing: P.climbing, wallFric: P.wallFric };
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
