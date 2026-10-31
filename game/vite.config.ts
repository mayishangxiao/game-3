import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * GitHub Pages 友好：相对 base，放到任意子路径都能跑。
 *
 * `phaser` 被别名到 src/vendor/phaser-global.ts —— 即「把 index.html 用 <script> 从 CDN
 * 加载的全局 Phaser 重新导出成模块」。源码里 18 处 `import Phaser from 'phaser'` 一行不用改，
 * 而打包体积从 1.2 MB 掉到 100 KB 量级（手机首屏能不能开，差的就是这个）。
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      {
        find: /^phaser$/,
        replacement: fileURLToPath(new URL('./src/vendor/phaser-global.ts', import.meta.url)),
      },
    ],
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 400,
  },
  server: {
    host: true,
    port: 5173,
  },
});