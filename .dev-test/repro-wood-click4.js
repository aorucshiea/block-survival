// 复现 v4：平地放一块原木，玩家钉在原地每帧校准视角——测 单击 / 按住 的真实挖掘行为
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

    // —— 找一块平地（3×3 顶面同高）——
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      let flat = true;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (topAt(x + dx, z + dz) !== t) { flat = false; }
      if (flat && world[idx(x, t, z)] !== 8) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: '找不到平地' };

    // —— 放一块原木在 spot 旁边 1 格的地上 ——
    const wx = spot.x + 1, wz = spot.z;
    world[idx(wx, spot.t + 1, wz)] = 4;
    rebuildChunkAround(wx, wz);
    const target = { x: wx, y: spot.t + 1, z: wz };
    out.setup = { spot, target, blockId: world[idx(target.x, target.y, target.z)] };

    // —— 玩家站位：与原木同格列，站南边 1.5m ——
    const px = wx + 0.5, pz = wz + 0.5 + 1.5;
    const py = spot.t + 1;
    const pinAndAim = () => {
      P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
      const e = { x: px, y: py + P.eyeH, z: pz };
      const d = { x: wx + 0.5 - e.x, y: target.y + 0.5 - e.y, z: wz + 0.5 - e.z };
      const l = Math.hypot(d.x, d.y, d.z);
      P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
    };
    pinAndAim();
    const r0 = raycastVoxel();
    if (!r0 || r0.x !== target.x || r0.y !== target.y || r0.z !== target.z)
      return { error: '射线没命中原木', r0, setup: out.setup };
    out.rayOk = true;

    const step = n => { for (let i = 0; i < n; i++) { pinAndAim(); update(1 / 60); } };

    // —— A1: 单击 0.15s（9 帧）——
    D.setMine(true); step(9); D.setMine(false); step(1);
    out.click1 = { block: world[idx(target.x, target.y, target.z)], carved: D.carvedInfo(target.x, target.y, target.z) };

    // —— A2: 按住 6s ——
    D.setMine(true);
    out.hold = [];
    for (let s = 0; s < 12; s++) {
      step(30);
      out.hold.push({ t: +(s * 0.5 + 0.5).toFixed(1), block: world[idx(target.x, target.y, target.z)], carved: D.carvedInfo(target.x, target.y, target.z) });
    }
    D.setMine(false);
    out.afterHold = { block: world[idx(target.x, target.y, target.z)], carved: D.carvedInfo(target.x, target.y, target.z), stam: Math.round(P.stam), mine: D.mineState() };

    // —— A3: 一直按到块碎（上限 60s），记录总时长 ——
    if (world[idx(target.x, target.y, target.z)] === 4) {
      let frames = 0;
      D.setMine(true);
      while (world[idx(target.x, target.y, target.z)] === 4 && frames < 3600) { pinAndAim(); update(1 / 60); frames++; }
      D.setMine(false);
      out.breakTime = +(frames / 60).toFixed(1);
      out.fragWood = frags[4];
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
