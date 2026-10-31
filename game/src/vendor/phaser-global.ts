/**
 * Phaser 的「全局变量 → ESM 默认导出」适配层。
 *
 * 为什么不做进 bundle：phaser.min.js 有 1.17 MB，走手机网络（尤其是经隧道）要几十秒。
 * 现在改由 index.html 用一段阻塞 <script> 从国内 CDN 先取；CDN 挂了再取同目录的本地副本。
 * 这样应用自身的 bundle 只剩 100 KB 左右，首屏时间从「分钟」降到「秒」。
 *
 * 代价是 Phaser 必须在应用模块执行前就绪 —— 索引页里的 <script> 是阻塞的、模块是延迟的，
 * 顺序天然满足；拿不到时这里会是 undefined，main.ts 会在启动前报错而不是白屏。
 */
import type PhaserNS from 'phaser';

const globalScope = globalThis as unknown as { Phaser?: typeof PhaserNS };

const Phaser = globalScope.Phaser;

export default Phaser;