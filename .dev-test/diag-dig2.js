// 诊断 v2：分段看 40 秒挖井过程中发生什么
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
    _rayReady = false;
    const hit = frameRay();
    const hb = hit && hit.type === 'vox' ? { x: hit.x, y: hit.y, z: hit.z } : null;
    const snap = (label) => {
      const cs = [];
      for (const [vi, c] of carved) cs.push(`${vi % 1000000}(n=${c.n},sy分布=${Array.from({length:10},(_,sy)=>{let k=0;for(let i=0;i<1000;i++)if(c.bits[subIdx(i%10,sy,(i/10|0)%10)]&&c.bits[subIdx(i%10,sy,(i/10|0)%10)])k++;return k}).join(',')})`);
      return { label, carved: carved.size, detail: cs.slice(0, 4), target: [mining.x, mining.y, mining.z], chipT: +(mining.chipT || 0).toFixed(2),
               stam: +P.stam.toFixed(0), exhausted: P.exhausted, hp: +P.hp.toFixed(0), pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], fall: P.fall };
    };
    const out = { spot, hb, seed: SEED, snaps: [] };
    mining.active = true;
    for (let i = 0; i < 2400; i++) {
      _rayReady = false;
      updateMining(1 / 60);
      stepPhysics(1 / 60);
      if (i === 300 || i === 1200 || i === 2399) out.snaps.push(snap((i / 60 + 's')));
    }
    mining.active = false;
    return out;
  });
  console.log(JSON.stringify(diag, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
