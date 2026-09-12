// 复现：空手"点一下"木头（单击 ~0.15s）——块是否瞬间消失？挖掘时间是否生效？
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
    // 找一棵树：从出生点附近螺旋找树干（id=4）
    let tree = null; const cx = WX >> 1, cz = WZ >> 1;
    for (let r = 2; r < 40 && !tree; r++) for (let x = cx - r; x <= cx + r && !tree; x++) for (let z = cz - r; z <= cz + r && !tree; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      for (let y = 1; y < WY - 1; y++) if (world[idx(x, y, z)] === 4) { tree = { x, y, z }; break; }
    }
    if (!tree) return { error: '找不到树' };
    // 站在树旁 1.6m，眼睛平视树干中段
    const dx = tree.x + 0.5 - (P.pos.x), dz = tree.z + 0.5 - (P.pos.z);
    const len = Math.hypot(dx, dz);
    // 把玩家放在树旁 1.8m 处（沿 x 方向），面朝树
    const px = tree.x + 0.5 + 1.8, pz = tree.z + 0.5;
    D.setPos(px, topAt(Math.floor(px), Math.floor(pz)) + 1, pz);
    P.vel.set(0, 0, 0);
    const ty = tree.y + 0.5;
    const ey = P.pos.y + P.eyeH;
    const ddx = (tree.x + 0.5) - px, ddy = ty - ey, ddz = (tree.z + 0.5) - pz;
    const dd = Math.hypot(ddx, ddy, ddz);
    const yaw = Math.atan2(-ddx / dd, -ddz / dd);
    const pitch = Math.asin(ddy / dd);
    D.look(yaw, pitch);
    const vi = idx(tree.x, tree.y, tree.z);
    const before = { block: world[vi], carved: D.carvedInfo(tree.x, tree.y, tree.z), ray: D.ray(), pos: D.pos() };

    // —— 场景 1：单击（按住 0.15s ≈ 9 帧）——
    D.setMine(true);
    for (let i = 0; i < 9; i++) update(1 / 60);
    D.setMine(false);
    update(1 / 60);
    const afterClick = { block: world[vi], carved: D.carvedInfo(tree.x, tree.y, tree.z) };

    // —— 场景 2：按住 3 秒，看进度节奏 ——
    D.setMine(true);
    const snaps = [];
    for (let i = 0; i < 180; i++) {
      update(1 / 60);
      if (i % 30 === 29) snaps.push({ t: (i + 1) / 60, block: world[vi], carved: D.carvedInfo(tree.x, tree.y, tree.z) });
    }
    D.setMine(false);
    const afterHold = { block: world[vi], carved: D.carvedInfo(tree.x, tree.y, tree.z), snaps };

    // —— 场景 3：小木板方块（30cm）单击 ——
    // 放一块 30cm 木板在面前地上
    const bx = Math.floor(P.pos.x - 1.5), bz = Math.floor(P.pos.z);
    const by = topAt(bx, bz) + 1;
    addSmallBlock(bx, by, bz, 0.3, 6);
    // 重新瞄准它中心
    const tx2 = bx + 0.15, ty2 = by + 0.15, tz2 = bz + 0.15;
    const e2 = { x: P.pos.x, y: P.pos.y + P.eyeH, z: P.pos.z };
    const d2 = { x: tx2 - e2.x, y: ty2 - e2.y, z: tz2 - e2.z };
    const l2 = Math.hypot(d2.x, d2.y, d2.z);
    D.look(Math.atan2(-d2.x / l2, -d2.z / l2), Math.asin(d2.y / l2));
    const subBefore = D.sub();
    D.setMine(true);
    let subSnap = [];
    for (let i = 0; i < 120; i++) {
      update(1 / 60);
      if (i % 20 === 19) subSnap.push({ t: +((i + 1) / 60).toFixed(1), subCount: D.sub().count, mine: D.mineState() });
    }
    D.setMine(false);
    const subAfter = D.sub();

    return { tree, before, afterClick, afterHold, subBefore, subSnap, subAfter, stam: Math.round(P.stam) };
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
