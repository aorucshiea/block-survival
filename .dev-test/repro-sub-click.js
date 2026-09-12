// 复现 v5：平地 + 30cm 木板小方块——验证 rayAny 命中 sub 后，单击/按住的行为
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

    // —— 找一块平地 ——
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      let flat = true;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (topAt(x + dx, z + dz) !== t) { flat = false; }
      if (flat && world[idx(x, t, z)] !== 8) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: '找不到平地' };

    // —— 玩家站位：spot 北侧，面朝南 1.5m ——
    const px = spot.x + 0.5, pz = spot.z + 0.5 - 1.5, py = spot.t + 1;
    D.setPos(px, py, pz); P.vel.set(0, 0, 0);

    // —— 在 spot 中心放 30cm 木板小方块（mat 6 木板）——
    const bx = spot.x + 0.35, bz = spot.z + 0.35, s = 0.3;
    addSmallBlock(bx, spot.t + 1, bz, s, 6);
    const target = subVox[subVox.length - 1];

    const pinAndAim = () => {
      P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
      const e = { x: px, y: py + P.eyeH, z: pz };
      const d = { x: bx + s / 2 - e.x, y: spot.t + 1 + s / 2 - e.y, z: bz + s / 2 - e.z };
      const l = Math.hypot(d.x, d.y, d.z);
      P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
    };
    pinAndAim();
    const r0 = rayAny();
    out.aim = r0 ? (r0.type === 'sub'
      ? { type: 'sub', dist: +r0.dist.toFixed(2), mat: r0.obj.mat, size: r0.obj.sx, isTarget: r0.obj === target }
      : { type: 'vox', at: [r0.x, r0.y, r0.z], id: world[idx(r0.x, r0.y, r0.z)] }) : null;
    if (!r0 || r0.type !== 'sub' || r0.obj !== target) return out;

    const step = n => { for (let i = 0; i < n; i++) { pinAndAim(); update(1 / 60); } };
    const tid = setInterval(() => {}, 1e9); // noop 保活

    // —— B1: 单击 0.15s ——
    D.setMine(true); step(9); D.setMine(false); step(1);
    out.afterClick = { stillThere: subVox.includes(target), mine: D.mineState(), subCount: D.sub().count };

    // —— B2: 按住直到碎（上限 5s），逐 0.5s 快照 ——
    D.setMine(true);
    out.hold = [];
    let frames = 0;
    while (subVox.includes(target) && frames < 300) {
      pinAndAim(); update(1 / 60); frames++;
      if (frames % 30 === 0) out.hold.push({ t: +(frames / 60).toFixed(1), stillThere: true, progress: +mining.progress.toFixed(2) });
    }
    D.setMine(false);
    out.afterHold = { broke: !subVox.includes(target), tookSec: +(frames / 60).toFixed(2), subCount: D.sub().count, fragPlank: frags[6] };
    clearInterval(tid);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
