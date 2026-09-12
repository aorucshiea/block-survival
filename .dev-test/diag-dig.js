// 诊断：挖井时 updateMining 每一步的状态
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const diag = await page.evaluate(() => {
    setState('playing');
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    for (let r = 0; r < 40 && !spot; r++) for (let x = cx - r; x <= cx + r && !spot; x++) for (let z = cz - r; z <= cz + r && !spot; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      let flat = true;
      for (let ddx = -2; ddx <= 2 && flat; ddx++) for (let ddz = -2; ddz <= 2; ddz++)
        if (topAt(x + ddx, z + ddz) !== t) { flat = false; break; }
      if (flat) spot = { x, z, t };
    }
    const wellX = spot.x + 0.5, wellZ = spot.z + 0.5 - 1.5;
    P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0);
    P.stance = 0; applyStance(); hands.L = null; hands.R = null;
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const dx = wellX - ex, dy = (spot.t + 0.5) - ey, dz = wellZ - ez, len = Math.hypot(dx, dy, dz);
    P.yaw = Math.atan2(-dx / len, -dz / len); P.pitch = Math.asin(dy / len);
    const out = { spot, viewDirY: +viewDir().y.toFixed(3), pos: [P.pos.x, P.pos.y, P.pos.z] };
    _rayReady = false;
    const t = frameRay();
    out.ray = t ? { type: t.type, x: t.x, y: t.y, z: t.z } : null;
    if (t && t.type === 'vox') {
      const chip = findChip(t);
      out.chip = chip ? { ...chip } : null;
      if (chip) {
        out.chipTop = chip.y + (chip.sy + 1) / SUB;
        out.diggingDown = viewDir().y < -0.35 && (chip.y + (chip.sy + 1) / SUB) <= P.pos.y + 0.01;
        const ax = chip.x + (chip.sx + 0.5) / SUB, az = chip.z + (chip.sz + 0.5) / SUB;
        out.aim = [ax, az];
        out.underMe = Math.abs(ax - P.pos.x) <= 0.35 && Math.abs(az - P.pos.z) <= 0.35;
        const fc = smartAimChip(ax, az, chip.y, chip.sy);
        out.smartAimResult = fc ? { ...fc } : null;
        out.aimBlockId = world[idx(chip.x, chip.y, chip.z)];
      }
    }
    // 挖 3 秒看有没有 bite
    mining.active = true;
    for (let i = 0; i < 180; i++) { _rayReady = false; updateMining(1 / 60); stepPhysics(1 / 60); }
    out.after3s = { carved: carved.size, hasTarget: mining.hasTarget, chipT: +(mining.chipT || 0).toFixed(3), target: [mining.x, mining.y, mining.z], stam: +P.stam.toFixed(0), exhausted: P.exhausted };
    const entries = [];
    for (const [vi, c] of carved) entries.push({ vi, n: c.n, id: world[vi] });
    out.carvedEntries = entries.slice(0, 6);
    mining.active = false; resetMining();
    // aimTip 的 DOM 文本
    out.aimTipText = (document.getElementById('aimTip') || {}).textContent || '(no el)';
    return out;
  });
  console.log(JSON.stringify(diag, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
