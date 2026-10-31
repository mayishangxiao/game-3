/**
 * Phaser 的加载器 —— 先 CDN，失败或超时再退本地副本。
 *
 * 为什么不在 bundle 里：phaser.min.js 有 1.17 MB。打进去的话，手机经隧道首屏要等一分钟以上
 * （实测 70 s），用户看到的就是「点了没反应」。放到 CDN 后应用自身只剩 100 KB 左右。
 *
 * 为什么要先加载再动态 import 应用：场景类在模块求值时就 `extends Phaser.Scene`，
 * 引擎没到位的话整个包会直接抛错，表现是黑屏 + 一句 TypeError。所以入口必须先 await 这个函数。
 */
const SOURCES = [
  // 实测（本机到各 CDN 拉 1.17 MB）：360 ≈ 1.0 MB/s、unpkg ≈ 0.85 MB/s、bootcdn ≈ 0.12 MB/s。
  // 所以按快的排在前面；单个源超时就换下一个，最后才用同目录副本。
  'https://lib.baomitu.com/phaser/3.90.0/phaser.min.js',
  'https://unpkg.com/phaser@3.90.0/dist/phaser.min.js',
  'https://cdn.bootcdn.net/ajax/libs/phaser/3.90.0/phaser.min.js',
];
const LOCAL = './phaser.min.js';
/** 单个 CDN 的等待上限：再久就不值得等，直接换源（本地副本兜底，慢但确定能成） */
const SOURCE_TIMEOUT_MS = 9000;

type GlobalScope = { Phaser?: unknown };

function hasPhaser(): boolean {
  return Boolean((globalThis as GlobalScope).Phaser);
}

function inject(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载失败: ${src}`));
    document.head.appendChild(script);
  });
}

function withTimeout(task: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('超时')), ms);
    task.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** 保证 `globalThis.Phaser` 可用；失败时抛错，由调用方给用户看提示。 */
export async function loadPhaser(): Promise<void> {
  if (hasPhaser()) return;

  const sources: Array<{ src: string; timeout: number }> = [
    ...SOURCES.map((src) => ({ src, timeout: SOURCE_TIMEOUT_MS })),
    { src: LOCAL, timeout: 0 },
  ];

  for (const { src, timeout } of sources) {
    try {
      const task = inject(src);
      await (timeout > 0 ? withTimeout(task, timeout) : task);
      if (hasPhaser()) return;
    } catch {
      // 换下一个源；两个都失败时下面统一抛错
    }
  }

  throw new Error('Phaser 加载失败：CDN 与本地副本都不可用');
}