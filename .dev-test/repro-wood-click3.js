// 复现 v3：暴力搜索瞄准角度确保命中目标块，再测单击/按住
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

    // —— 找树干列（取一段连续 id=4）——
    let tree = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 2; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      for (let y = 10; y < 24; y++) {
        if (world[idx(x, y, z)] === 4 && world[idx(x, y + 1, z)] === 4) { tree = { x, y: y + 1, z }; break outer; }
      }
    }
    if (!tree) return { error: '找不到树' };

    // —— 玩家站树旁，物理稳定 ——
    const px = tree.x + 0.5 + 1.5, pz = tree.z + 0.5;
    const gy = topAt(Math.floor(px), Math.floor(pz));
    D.setPos(px, gy + 1.05, pz); P.vel.set(0, 0, 0);
    for (let i = 0; i < 30; i++) update(1 / 60);

    // —— 暴力搜瞄准：找到能命中 (tree.x, tree.y, tree.z) 的 yaw/pitch ——
    const e0 = () => ({ x: P.pos.x, y: P.pos.y + P.eyeH, z: P.pos.z });
    let aim = null;
    const cYaw = Math.atan2(-(tree.x + 0.5 - P.pos.x), -(tree.z + 0.5 - P.pos.z));
    for (let dyaw = -0.35; dyaw <= 0.35 && !aim; dyaw += 0.05)
      for (let dpitch = -0.5; dpitch <= 0.5 && !aim; dpitch += 0.05) {
        D.look(cYaw + dyaw, dpitch);
        const r = raycastVoxel();
        if (r && r.x === tree.x && r.y === tree.y && r.z === tree.z) aim = { yaw: cYaw + dyaw, pitch: dpitch };
      }
    if (!aim) return { error: '搜不到能命中树干的视角', playerPos: D.pos() };
    D.look(aim.yaw, aim.pitch);
    const ray0 = raycastVoxel();
    out.setup = { tree, player: D.pos(), ray: [ray0.x, ray0.y, ray0.z], id: world[idx(ray0.x, ray0.y, ray0.z)] };

    // —— A1: 单击 0.15s ——
    D.setMine(true); for (let i = 0; i < 9; i++) update(1 / 60); D.setMine(false); update(1 / 60);
    out.click1 = { block: world[idx(tree.x, tree.y, tree.z)], carved: D.carvedInfo(tree.x, tree.y, tree.z) };

    // —— A2: 按住 5s ——
    D.setMine(true);
    out.hold = [];
    for (let i = 0; i < 300; i++) {
      update(1 / 60);
      if (i % 60 === 59) out.hold.push({ t: +((i + 1) / 60).toFixed(0), block: world[idx(tree.x, tree.y, tree.z)], carved: D.carvedInfo(tree.x, tree.y, tree.z) });
    }
    D.setMine(false);
    out.afterHold = { block: world[idx(tree.x, tree.y, tree.z)], carved: D.carvedInfo(tree.x, tree.y, tree.z), stam: Math.round(P.stam) };
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
