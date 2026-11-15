/**
 * 序章五幕的史实刻度（v2.0）—— 甲方原话：「只有到最后清王朝覆灭了才能说觉醒年代游戏结束」。
 *
 * 这里锁三件事：
 *   1. 幕的时间顺序与长廊年代标签（`year_label`）一致，别再靠代码里硬编码年份；
 *   2. 国运（清王朝血条）按史实一场比一场低，最后一幕归零；
 *   3. 终局落在「清帝退位」这个节点上，且台词里不再出现「到此收卷」这种交作业式收尾。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DYNASTY_MAX } from '../src/core/cannon';
import type { ActDef, DialogueBlock, NodeDef } from '../src/core/types';

const ROOT = process.cwd();
const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '')) as T;

interface IndexJson {
  chapters: { id: string; acts: string[]; period: string }[];
}

const index = readJson<IndexJson>('public/data/index.json');
const chapter = index.chapters[0];
const acts = chapter.acts.map((a) => readJson<ActDef>(`public/data/acts/${a}.json`));
const nodes = readJson<{ nodes: NodeDef[] }>('public/data/nodes/nodes_ch00.json').nodes;
const dlg = readJson<{ dialogues: DialogueBlock[] }>('public/data/dialogues/dlg_ch00.json');

describe('五幕年表', () => {
  it('索引声明的五幕就是全部内容（不再有占位幕）', () => {
    expect(chapter.acts).toEqual([
      'ch00_act1',
      'ch00_act2',
      'ch00_act3',
      'ch00_act4',
      'ch00_act5',
    ]);
    expect(acts.map((a) => a.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('幕名与史实对应：鸦片战争 → 太平天国 → 洋务 → 戊戌 → 辛亥', () => {
    expect(acts.map((a) => a.name)).toEqual([
      '鸦片战争',
      '太平天国运动',
      '洋务运动',
      '戊戌变法',
      '辛亥革命',
    ]);
  });

  it('每幕都写了 year_label，且年份严格递增（长廊年代石柱直接用它）', () => {
    const years = acts.map((a) => {
      expect(a.year_label, `${a.id} 缺 year_label`).toBeTruthy();
      const n = Number(a.year_label);
      expect(Number.isFinite(n), `${a.id} 的 year_label 不是年份：${a.year_label}`).toBe(true);
      return n;
    });
    for (let i = 1; i < years.length; i++) {
      expect(years[i], `${acts[i].id} 的年份没有晚于上一幕`).toBeGreaterThan(years[i - 1]);
    }
  });

  it('章节时间跨度覆盖 1840—1912', () => {
    expect(chapter.period).toContain('1840');
    expect(chapter.period).toContain('1912');
  });
});

describe('国运（清王朝血条）随每一幕下降', () => {
  it('每幕都声明了 dynasty_after，且在 0..DYNASTY_MAX 之间', () => {
    for (const a of acts) {
      expect(typeof a.dynasty_after, `${a.id} 缺 dynasty_after`).toBe('number');
      expect(a.dynasty_after!).toBeGreaterThanOrEqual(0);
      expect(a.dynasty_after!).toBeLessThanOrEqual(DYNASTY_MAX);
    }
  });

  it('刻度严格递减：长廊里一定看得出「一场比一场低」', () => {
    for (let i = 1; i < acts.length; i++) {
      expect(
        acts[i].dynasty_after!,
        `${acts[i].id} 的国运没有低于 ${acts[i - 1].id}`,
      ).toBeLessThan(acts[i - 1].dynasty_after!);
    }
  });

  it('最后一幕（辛亥革命）打完归零 = 清王朝覆灭', () => {
    expect(acts[acts.length - 1].dynasty_after).toBe(0);
  });

  it('从满格 100 一路掉到 0，单幕跌幅不超过 40（一段一段掉，不是一次清零）', () => {
    let prev = DYNASTY_MAX;
    for (const a of acts) {
      const drop = prev - a.dynasty_after!;
      expect(drop, `${a.id} 没有扣国运`).toBeGreaterThan(0);
      expect(drop, `${a.id} 一幕就掉了 ${drop}，长廊里看不出层次`).toBeLessThanOrEqual(40);
      prev = a.dynasty_after!;
    }
    expect(prev).toBe(0);
  });
});

describe('终局：清帝退位，而不是「到此收卷」', () => {
  const lastAct = acts[acts.length - 1];
  const lastNode = lastAct.nodes[lastAct.nodes.length - 1];
  const finalBlockId = (nodes.find((n) => n.id === lastNode) as NodeDef | undefined)?.outro_dialogue_ref;

  it('最后一幕的最后一个节点把收尾对白交给终局块', () => {
    expect(lastNode).toBe('nd_1912_tuwei_choice');
    expect(finalBlockId).toBe('dlg_ch00_final');
  });

  it('终局台词讲到退位与帝制终结', () => {
    const block = dlg.dialogues.find((b) => b.id === 'dlg_ch00_final');
    expect(block, '找不到终局对白 dlg_ch00_final').toBeTruthy();
    const text = block!.lines.map((l) => l.text).join('');
    expect(text).toContain('退位');
    expect(text).toContain('帝制');
  });

  it('全剧任何一段对白都不再说「觉醒年代，到此收卷」', () => {
    for (const b of dlg.dialogues) {
      for (const line of b.lines) {
        expect(line.text, `${b.id} 还在用「收卷」收尾`).not.toContain('到此收卷');
      }
    }
  });

  it('第二幕收尾改成了「后面还有戏」，不再带 end 动作', () => {
    const act2Outro = dlg.dialogues.find((b) => b.id === 'dlg_ch00_act2_limit_outro');
    expect(act2Outro).toBeTruthy();
    for (const line of act2Outro!.lines) {
      expect((line as { action?: { type?: string } }).action?.type).not.toBe('end');
    }
  });
});
