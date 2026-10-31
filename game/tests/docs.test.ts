/**
 * 文档对齐测试 —— 对应「目录级 README」这条工程纪律。
 *
 * 为什么要测文档：换 agent、隔几天回来改代码时，最大的浪费是「遍历文件找位置」。
 * 每个目录放一份说明能省掉这部分，但**过期或残缺的说明比没有说明更糟**——
 * 它会让人照着旧地图走，然后花更多时间去发现地图是错的。
 *
 * 所以这里只锁两条最硬的规矩：
 *   1. 每个源文件 / 数据文件 / 测试 / 脚本，都必须在它所在目录的 README.md 里出现；
 *   2. README 里写的相对链接必须真的存在（不许指向不存在的文件）。
 * 断言失败时的提示语直接告诉你该改哪一行文档。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** 构建产物、依赖、验证缓存：这些不进文档索引 */
const SKIP = /^(node_modules|dist|\.git|__pycache__|_cdp|_cdp2|_cdp3|_smoke|profile)/;

function walkFiles(relDir: string, keep: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel)).sort()) {
      if (SKIP.test(name)) continue;
      const child = `${rel}/${name}`;
      if (statSync(join(ROOT, child)).isDirectory()) visit(child);
      else if (keep(child)) out.push(child);
    }
  };
  visit(relDir);
  return out;
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '');

/** 目录 → 它的说明文件 → 该目录下必须被提到的文件 */
interface DocGroup {
  dir: string;
  readme: string;
  keep: (rel: string) => boolean;
  label: string;
}

const GROUPS: DocGroup[] = [
  { dir: 'src', readme: 'src/README.md', label: '源文件', keep: (p) => p.endsWith('.ts') },
  { dir: 'public/data', readme: 'public/data/README.md', label: '数据文件', keep: (p) => p.endsWith('.json') },
  { dir: 'tests', readme: 'tests/README.md', label: '测试', keep: (p) => p.endsWith('.test.ts') },
  { dir: 'tools', readme: 'tools/README.md', label: '脚本', keep: (p) => /\.(mjs|py)$/.test(p) },
];

describe('目录说明必须覆盖该目录的全部文件', () => {
  for (const group of GROUPS) {
    it(`${group.readme} 提到了 ${group.dir}/ 下每个${group.label}`, () => {
      expect(existsSync(join(ROOT, group.readme)), `缺少 ${group.readme}`).toBe(true);
      const doc = read(group.readme);
      const files = walkFiles(group.dir, group.keep);
      expect(files.length, `${group.dir}/ 下没有找到任何${group.label}，检查路径`).toBeGreaterThan(0);

      const missing = files
        .map((f) => f.slice(group.dir.length + 1)) // 文档里用「相对该目录」的写法
        .filter((rel) => !doc.includes(rel));

      expect(
        missing,
        `以下文件没有写进 ${group.readme}（新增文件时请同步补一行说明）：\n  ${missing.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});

describe('README 里的相对链接必须指向真实文件', () => {
  const DOCS = [
    'README.md',
    'src/README.md',
    'public/data/README.md',
    'tests/README.md',
    'tools/README.md',
    '../README.md',
    '../design/README.md',
  ];

  for (const doc of DOCS) {
    it(`${doc} 的链接都可解析`, () => {
      if (!existsSync(join(ROOT, doc))) return; // 工作区级文档可能不存在（只跑子目录时）
      const text = read(doc);
      const baseDir = dirname(join(ROOT, doc));
      const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g)]
        .map((m) => m[1])
        .filter((t) => !/^(https?:|mailto:|#)/.test(t))
        .filter((t) => !t.includes('*'));

      const broken = targets.filter((t) => {
        const clean = t.split('#')[0];
        return clean.length > 0 && !existsSync(join(baseDir, clean));
      });

      expect(broken, `${doc} 里有指向不存在文件的链接：\n  ${broken.join('\n  ')}`).toEqual([]);
    });
  }
});