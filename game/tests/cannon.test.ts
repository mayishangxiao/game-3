import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANNON_NAME_GENERIC,
  DYNASTY_MAX,
  applyDynastyDelta,
  cannonDisplayName,
  cannonReady,
  cooldownSeconds,
  planCannonShot,
  within,
  type CannonTarget,
} from '../src/core/cannon';
import type { CannonParams } from '../src/core/types';

const P: CannonParams = {
  id: 'humen_cannon',
  name: '虎门重炮',
  cooldown_ms: 12000,
  range_px: 300,
  splash_px: 52,
  kill_tiers: ['mob', 'standard'],
  elite_hp_pct: 45,
  boss_hp_pct: 3,
  misfire_chance_pct: 10,
  misfire_self_pct: 12,
  desc: '',
};

const mob: CannonTarget = { id: 'en_qing_green', tier: 'mob', hp: 45, maxHp: 45 };
const standard: CannonTarget = { id: 'en_uk_infantry', tier: 'standard', hp: 65, maxHp: 65 };
const ranged: CannonTarget = { id: 'en_uk_grenadier', tier: 'ranged', hp: 50, maxHp: 50 };
const elite: CannonTarget = { id: 'en_gough', tier: 'elite', hp: 210, maxHp: 210 };
const boss: CannonTarget = { id: 'en_boss_steamfrigate', tier: 'boss', hp: 1206, maxHp: 1206 };

describe('虎门重炮：伤害分档', () => {
  it('普通英兵 / 小兵一发秒杀', () => {
    const r = planCannonShot([mob, standard], P, 100, 0.99);
    expect(r.kind).toBe('fire');
    if (r.kind !== 'fire') return;
    expect(r.hits).toHaveLength(2);
    for (const h of r.hits) expect(h.lethal).toBe(true);
    expect(r.hits[0].damage).toBe(45);
    expect(r.hits[1].damage).toBe(65);
  });

  it('精英是高伤但不秒杀：210 血吃 45% 掉 95，还剩 115', () => {
    const r = planCannonShot([elite], P, 100, 0.99);
    if (r.kind !== 'fire') throw new Error('应该开火');
    const h = r.hits[0];
    expect(h.lethal).toBe(false);
    expect(h.damage).toBe(95);
    expect(elite.hp - h.damage).toBeGreaterThan(0);
  });

  it('精英残血时也不补死：最多打到剩 1 点', () => {
    const nearlyDead: CannonTarget = { ...elite, hp: 3 };
    const r = planCannonShot([nearlyDead], P, 100, 0.99);
    if (r.kind !== 'fire') throw new Error('应该开火');
    expect(r.hits[0].lethal).toBe(false);
    expect(r.hits[0].damage).toBe(2);
  });

  it('BOSS 英军舰船伤害偏低：1206 血只掉 36（3%）', () => {
    const r = planCannonShot([boss], P, 100, 0.99);
    if (r.kind !== 'fire') throw new Error('应该开火');
    expect(r.hits[0].lethal).toBe(false);
    expect(r.hits[0].damage).toBe(36);
    // 和精英相比：一炮打掉的比例差一个数量级，这就是「装备差距」
    expect(r.hits[0].damage / boss.maxHp).toBeLessThan(0.05);
  });

  it('远程兵不在秒杀名单里，按精英档算法（要两炮）', () => {
    const r = planCannonShot([ranged], P, 100, 0.99);
    if (r.kind !== 'fire') throw new Error('应该开火');
    expect(r.hits[0].damage).toBe(23);
    expect(r.hits[0].lethal).toBe(false);
  });

  it('溅射目标一次结算，每个目标各算一次', () => {
    const r = planCannonShot([mob, standard, elite, boss], P, 100, 0.99);
    if (r.kind !== 'fire') throw new Error('应该开火');
    expect(r.hits.map((h) => h.id)).toEqual([mob.id, standard.id, elite.id, boss.id]);
  });
});

describe('虎门重炮：炸膛', () => {
  it('随机数落在炸膛概率内就自伤，且不打敌人', () => {
    const r = planCannonShot([mob], P, 100, 0.05);
    expect(r.kind).toBe('misfire');
    if (r.kind !== 'misfire') return;
    expect(r.selfDamage).toBe(12);
  });

  it('随机数在概率外就正常开火', () => {
    expect(planCannonShot([mob], P, 100, 0.5).kind).toBe('fire');
  });

  it('炸膛概率边界：恰好等于概率时不开炸膛（0.1 属于命中区间外）', () => {
    expect(planCannonShot([mob], P, 100, 0.1).kind).toBe('fire');
    expect(planCannonShot([mob], P, 100, 0.0999).kind).toBe('misfire');
  });

  it('炸膛自伤按最大生命值算，至少 1 点', () => {
    const r = planCannonShot([], { ...P, misfire_self_pct: 0 }, 100, 0);
    if (r.kind !== 'misfire') throw new Error('应该炸膛');
    expect(r.selfDamage).toBe(1);
  });
});

describe('虎门重炮：冷却与辅助', () => {
  it('冷却期间不可用', () => {
    expect(cannonReady(0)).toBe(true);
    expect(cannonReady(-5)).toBe(true);
    expect(cannonReady(1)).toBe(false);
    expect(cannonReady(12000)).toBe(false);
  });

  it('冷却秒数向上取整，供按钮提示', () => {
    expect(cooldownSeconds(12000)).toBe(12);
    expect(cooldownSeconds(11001)).toBe(12);
    expect(cooldownSeconds(1)).toBe(1);
    expect(cooldownSeconds(0)).toBe(0);
    expect(cooldownSeconds(-100)).toBe(0);
  });

  it('半径判定是闭区间（贴边也算命中）', () => {
    expect(within(0, 0, 0, 52, 52)).toBe(true);
    expect(within(0, 0, 0, 53, 52)).toBe(false);
    expect(within(0, 0, 30, 40, 50)).toBe(true);
  });
});

describe('清王朝血条', () => {
  it('默认 100，扣减后夹在 0..100', () => {
    expect(DYNASTY_MAX).toBe(100);
    expect(applyDynastyDelta(100, -38)).toBe(62);
    expect(applyDynastyDelta(10, -38)).toBe(0);
    expect(applyDynastyDelta(95, 10)).toBe(100);
  });
});

/* ==================== 开炮提示按战场区分（4.3.10） ==================== */

const DATA = join(process.cwd(), 'public', 'data');
function read<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA, rel), 'utf8')) as T;
}

describe('开炮显示名：虎门保留原名，其它战场不含地名', () => {
  const HUMEN = { actId: 'ch00_act1', nodeId: 'nd_1841_humen_battle', dungeon: false };
  const TIANJING = { actId: 'ch00_act2', nodeId: 'nd_1864_tianjing_fall', dungeon: false };

  it('虎门炮台守卫战沿用配置里的「虎门重炮」', () => {
    expect(cannonDisplayName(HUMEN, P.name)).toBe('虎门重炮');
  });

  it('天京陷落与其它幕开炮统一叫「重炮」，不出现「虎门」', () => {
    const label = cannonDisplayName(TIANJING, P.name);
    expect(label).toBe(CANNON_NAME_GENERIC);
    expect(label).not.toContain('虎门');
    expect(`${label}！`).not.toContain('虎门');
    expect(`${label}冷却中 ${cooldownSeconds(8000)} 秒`).not.toContain('虎门');
  });

  it('副本即使解锁于第一幕也不算虎门战场', () => {
    expect(cannonDisplayName({ ...HUMEN, dungeon: true }, P.name)).toBe(CANNON_NAME_GENERIC);
    expect(cannonDisplayName({ actId: 'ch00_act1', nodeId: null, dungeon: true }, P.name)).toBe(
      CANNON_NAME_GENERIC,
    );
  });

  it('幕 / 节点缺失、名字为空，都 fail-safe 回落到通用名', () => {
    expect(cannonDisplayName({}, P.name)).toBe(CANNON_NAME_GENERIC);
    expect(cannonDisplayName({ actId: 'ch00_act1' }, P.name)).toBe(CANNON_NAME_GENERIC);
    expect(cannonDisplayName({ actId: 'ch00_act1', nodeId: 'nd_elsewhere' }, P.name)).toBe(
      CANNON_NAME_GENERIC,
    );
    expect(cannonDisplayName(HUMEN, '')).toBe(CANNON_NAME_GENERIC);
    expect(cannonDisplayName(HUMEN, null)).toBe(CANNON_NAME_GENERIC);
  });

  it('不改动传入的场景对象，也不参与伤害结算', () => {
    const scene = { ...HUMEN };
    const before = planCannonShot([mob, boss], P, 100, 0.99);
    cannonDisplayName(scene, P.name);
    expect(scene).toEqual(HUMEN);
    expect(planCannonShot([mob, boss], P, 100, 0.99)).toEqual(before);
  });

  it('真实数据：所有 combat 节点与全部副本的开炮文案都正确', () => {
    const cfg = read<{ skills: { humen_cannon: { name: string } } }>('config.json');
    const configured = cfg.skills.humen_cannon.name;
    const nodes = read<{ nodes: { id: string; params: { mode?: string } }[] }>(
      'nodes/nodes_ch00.json',
    ).nodes;
    const acts = ['ch00_act1', 'ch00_act2'].map((id) =>
      read<{ id: string; nodes: string[] }>(`acts/${id}.json`),
    );
    const dungeons = read<{ dungeons: { id: string; map_ref: string }[] }>(
      'dungeons/dungeons.json',
    ).dungeons;

    const combats: { actId: string; nodeId: string }[] = [];
    for (const act of acts) {
      for (const nodeId of act.nodes) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node?.params.mode === 'combat') combats.push({ actId: act.id, nodeId });
      }
    }
    expect(combats.length).toBeGreaterThanOrEqual(2);

    for (const c of combats) {
      const label = cannonDisplayName({ ...c, dungeon: false }, configured);
      if (c.actId === 'ch00_act1') {
        expect(label, `${c.nodeId} 应保留史实称呼`).toBe(configured);
      } else {
        expect(label, `${c.nodeId} 不是虎门战场`).toBe(CANNON_NAME_GENERIC);
        expect(label).not.toContain('虎门');
      }
    }

    expect(dungeons.length).toBeGreaterThanOrEqual(3);
    for (const d of dungeons) {
      const label = cannonDisplayName(
        { actId: 'ch00_act1', nodeId: 'nd_1841_humen_battle', dungeon: true },
        configured,
      );
      expect(label, `${d.id} 副本开炮不该出现虎门`).toBe(CANNON_NAME_GENERIC);
      expect(label).not.toContain('虎门');
    }
  });
});

describe('炮弹与敌弹的关系（史实演示点）', () => {
  it('我方炮弹只做伤害结算，返回值里没有任何「抵消敌弹」的语义', () => {
    const r = planCannonShot([mob, boss], P, 100, 0.99);
    expect(Object.keys(r).sort()).toEqual(['hits', 'kind']);
    if (r.kind !== 'fire') return;
    for (const h of r.hits) {
      expect(Object.keys(h).sort()).toEqual(['damage', 'id', 'lethal']);
    }
  });
});