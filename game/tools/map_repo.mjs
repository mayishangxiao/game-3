/**
 * 仓库地图生成器：把一个目录下所有文件的「头部说明注释 + 导出符号 / JSON 顶层键」
 * 压缩成一行一条的清单，供人（和 AI agent）在不逐个打开文件的情况下掌握全貌。
 *
 * 为什么需要它：换 agent、或者隔几天回来改代码时，最大的浪费是「遍历文件找位置」。
 * 目录级 README 解决这件事，但 README 会过期——所以定稿手段是这个脚本：
 * 把它打印出来的骨架对照 `src/README.md` 等文档，缺漏会被 `tests/docs.test.ts` 抓出来。
 *
 * 用法: node tools/map_repo.mjs [根目录] [--full]
 *   --full  连私有成员与全部顶层键都打印（默认只打印导出符号）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(here, '..'));
const full = process.argv.includes('--full');

/** 跳过的目录：构建产物、依赖、缓存、二进制 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '_cache', 'temp']);
const SKIP_PREFIX = ['_cdp', 'profile'];
const isSkipped = (name) => SKIP_DIRS.has(name) || SKIP_PREFIX.some((p) => name.startsWith(p));

const TEXT_EXT = ['.ts', '.mjs', '.js', '.py', '.json', '.md', '.html', '.css'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (isSkipped(name)) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/** 取文件最前面的说明注释（块注释或连续行注释），压成单行 */
function headerComment(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return '';
  const first = lines[i].trim();
  const buf = [];
  if (first.startsWith('/*')) {
    let done = false;
    for (; i < lines.length; i++) {
      let l = lines[i];
      l = l.replace(/^\/\*\*?\s?/, '').replace(/\*\/\s*$/, '');
      l = l.replace(/^\s*\*\s?/, '');
      if (l.trim()) buf.push(l.trim());
      if (lines[i].includes('*/')) { done = true; i++; break; }
    }
    if (!done) buf.length = 0;
  } else if (first.startsWith('//') || first.startsWith('#')) {
    const mark = first.startsWith('#') ? '#' : '//';
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l.startsWith(mark)) break;
      buf.push(l.slice(mark.length).trim());
    }
  }
  return buf.join(' ').replace(/\s+/g, ' ').trim();
}

/** 列出显式导出：export class/function/const/interface/type/async function */
function exportsOf(text) {
  const names = [];
  const re = /^export\s+(?:default\s+)?(?:abstract\s+)?(class|function|async function|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = re.exec(text))) names.push(m[1].startsWith('async') ? `async ${m[2]}()` : m[2]);
  // export { a, b }
  const reBrace = /^export\s*\{([^}]*)\}/gm;
  while ((m = reBrace.exec(text))) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

/** 类内 public 方法名（默认模式也打印，方便知道怎么调用） */
function classMembers(text) {
  const names = [];
  const re = /^\s{2}(?!private|protected|#)(?:public\s+)?(?:override\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/gm;
  let m;
  while ((m = re.exec(text))) {
    if (['if', 'for', 'while', 'switch', 'return', 'catch'].includes(m[1])) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

function jsonSummary(abs) {
  try {
    const data = JSON.parse(readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
    if (Array.isArray(data)) return `array[${data.length}]`;
    const keys = Object.keys(data);
    const parts = keys.map((k) => {
      const v = data[k];
      if (Array.isArray(v)) return `${k}[${v.length}]`;
      return k;
    });
    return parts.join(', ');
  } catch (e) {
    return `<无法解析: ${e.message}>`;
  }
}

const files = walk(root);
const rows = [];
for (const abs of files) {
  const rel = relative(root, abs).split(sep).join('/');
  if (!TEXT_EXT.some((e) => rel.endsWith(e))) continue;
  const ext = rel.slice(rel.lastIndexOf('.'));
  const text = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  if (ext === '.json') {
    rows.push({ rel, note: jsonSummary(abs), sym: '' });
    continue;
  }
  if (rel.endsWith('.md')) {
    const title = text.split(/\r?\n/).find((l) => l.trim().startsWith('#')) ?? '';
    rows.push({ rel, note: title.replace(/^#+\s*/, '').trim(), sym: '' });
    continue;
  }
  const note = headerComment(text);
  const sym = ext === '.ts' || ext === '.mjs' || ext === '.js' ? exportsOf(text) : [];
  const mem = full && (ext === '.ts') ? classMembers(text) : [];
  rows.push({ rel, note, sym, mem });
}

// 按目录分组输出
let lastDir = '';
for (const r of rows) {
  const dir = r.rel.includes('/') ? r.rel.slice(0, r.rel.lastIndexOf('/')) : '(根)';
  if (dir !== lastDir) { console.log(`\n## ${dir}/`); lastDir = dir; }
  const sym = r.sym.length ? `  ⟶ ${r.sym.join(', ')}` : '';
  const mem = r.mem && r.mem.length ? `  ⋯ ${r.mem.slice(0, 24).join(', ')}` : '';
  console.log(`- ${r.rel}  — ${r.note}${sym}${mem}`);
}
console.log(`\n共 ${rows.length} 个文本文件。`);