import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // v2.2 起 public/art 有 413 个文件，读 PNG 头的几条测试（art / unitArt / space / docs
    // 遍历目录）在 29 个 worker 并行抢磁盘时偶尔超过默认 5s；给到 15s 不是放宽断言，
    // 只是让「读盘」这类 IO 不再被误判成逻辑失败。
    testTimeout: 15_000,
    // 29 个测试文件各起一个 worker 时，Windows 上一次 spawn 29 个 Node 进程会互相抢 CPU，
    // 冷缓存那一轮常把 IO 测试拖到超时。限到 8 个并发更稳，总耗时反而更短。
    maxWorkers: 8,
  },
});