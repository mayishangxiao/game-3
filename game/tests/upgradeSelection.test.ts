/**
 * 波次强化「选中 → 确认」两步流程的状态机测试（v1.8.6）。
 *
 * 这里钉死的不是数值，而是**交互契约**：点选绝不能生效、绝不能关闭界面；
 * 只有明确按确认，才允许把当前选中项提交为最终结果。
 * 玩家「快速连点误选」的投诉就落在这几条断言上。
 */
import { describe, expect, it } from 'vitest';
import {
  canConfirm,
  cancelUpgrade,
  confirmUpgrade,
  emptySelection,
  selectUpgrade,
  skipUpgrade,
  type UpgradeSelection,
} from '../src/core/upgradeSelection';
import type { UpgradeId } from '../src/core/waveUpgrade';

const A: UpgradeId = 'volley';
const B: UpgradeId = 'haste';
const C: UpgradeId = 'pierce';

/** 模拟玩家在同一张卡/不同卡上快速连点一串 */
function rapidClicks(ids: UpgradeId[]): UpgradeSelection {
  return ids.reduce((s, id) => selectUpgrade(s, id), emptySelection());
}

describe('初始状态', () => {
  it('弹卡时未选择、界面打开、没有任何已生效结果', () => {
    expect(emptySelection()).toEqual({ selected: null, open: true, committed: null });
  });

  it('未选择时不允许确认', () => {
    expect(canConfirm(emptySelection())).toBe(false);
  });
});

describe('点选只记录，不生效 / 不结算 / 不关闭', () => {
  it('点一张卡只记下 selected，committed 仍为 null 且界面还开着', () => {
    const s = selectUpgrade(emptySelection(), A);
    expect(s).toEqual({ selected: A, open: true, committed: null });
  });

  it('快速连点同一张卡任意多次都不会完成强化', () => {
    const s = rapidClicks([A, A, A, A, A, A, A, A]);
    expect(s.committed).toBeNull();
    expect(s.open).toBe(true);
    // 偶数次连点会 toggle 成「取消」，这依然属于「没有生效」，不是误选完成
    expect(s.selected).toBeNull();
  });

  it('快速连点多张卡也不会完成强化，只留下最后一次的选中项', () => {
    const s = rapidClicks([A, B, C, B, A]);
    expect(s.committed).toBeNull();
    expect(s.open).toBe(true);
    expect(s.selected).toBe(A);
  });

  it('任意连点序列都不产生 committed（穷举长度 1..4 的三卡组合）', () => {
    const ids = [A, B, C];
    for (let len = 1; len <= 4; len++) {
      const walk = (prefix: UpgradeId[]) => {
        if (prefix.length === len) {
          const s = rapidClicks(prefix);
          expect(s.committed).toBeNull();
          expect(s.open).toBe(true);
          return;
        }
        for (const id of ids) walk([...prefix, id]);
      };
      walk([]);
    }
  });
});

describe('确认前可以切换与取消', () => {
  it('点另一张卡 = 切换，之前的选中项被替换', () => {
    const s = selectUpgrade(selectUpgrade(emptySelection(), A), B);
    expect(s.selected).toBe(B);
    expect(s.committed).toBeNull();
    expect(s.open).toBe(true);
  });

  it('再点已选中的卡 = 取消选择，界面仍开着', () => {
    const s = selectUpgrade(selectUpgrade(emptySelection(), A), A);
    expect(s).toEqual({ selected: null, open: true, committed: null });
  });

  it('cancelUpgrade 清空选中但保留界面与未生效状态', () => {
    const s = cancelUpgrade(selectUpgrade(emptySelection(), B));
    expect(s).toEqual({ selected: null, open: true, committed: null });
    expect(canConfirm(s)).toBe(false);
  });
});

describe('只有确认才生效', () => {
  it('未选中时确认无效：不提交、不关闭', () => {
    const s = confirmUpgrade(emptySelection());
    expect(s).toEqual({ selected: null, open: true, committed: null });
  });

  it('取消之后确认同样无效（不能拿上一次的选中项偷偷生效）', () => {
    const s = confirmUpgrade(cancelUpgrade(selectUpgrade(emptySelection(), C)));
    expect(s.committed).toBeNull();
    expect(s.open).toBe(true);
  });

  it('选中后确认：把当前明确选中的那一项作为唯一最终结果', () => {
    const picked = selectUpgrade(selectUpgrade(emptySelection(), A), B);
    const s = confirmUpgrade(picked);
    expect(s).toEqual({ selected: B, open: false, committed: B });
  });

  it('确认后状态冻结：再点/再确认/再取消都不会二次生效', () => {
    const once = confirmUpgrade(selectUpgrade(emptySelection(), A));
    expect(selectUpgrade(once, B)).toEqual(once);
    expect(confirmUpgrade(once)).toEqual(once);
    expect(cancelUpgrade(once)).toEqual(once);
    expect(once.committed).toBe(A);
  });
});

describe('放弃强化', () => {
  it('skip 关闭界面但不提交任何项', () => {
    const s = skipUpgrade(selectUpgrade(emptySelection(), A));
    expect(s).toEqual({ selected: A, open: false, committed: null });
  });

  it('放弃之后再确认也不能把之前选中的项补生效', () => {
    const s = confirmUpgrade(skipUpgrade(selectUpgrade(emptySelection(), A)));
    expect(s.committed).toBeNull();
    expect(s.open).toBe(false);
  });
});
