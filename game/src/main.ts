/**
 * 页面入口 —— 只干一件事：先把 Phaser 取来，再动态载入应用。
 *
 * 为什么要拆两层：`src/vendor/phaser-global.ts` 在模块求值时就读取 `globalThis.Phaser`，
 * 场景类也在这时 `extends Phaser.Scene`。若引擎还没到，整包会抛错、页面全黑。
 * 所以这里必须 await 加载完成，再 `import('./boot')`。
 */

import { loadPhaser } from './vendor/loadPhaser';

loadPhaser()
  .then(() => import('./boot'))
  .then((mod) => {
    mod.boot();
  })
  .catch((err: unknown) => {
    const hint = document.getElementById('boot-hint');
    if (hint) hint.textContent = '引 擎 加 载 失 败 ，请 刷 新 重 试';
    // eslint-disable-next-line no-console
    console.error('[boot]', err);
  });