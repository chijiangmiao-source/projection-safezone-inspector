import { describe, expect, it } from 'vitest';
import {
  classifyOverlap,
  clampRectToCanvas,
  clientToView,
  evaluateObstruction,
  evaluateScene,
  overlapLengths,
  validateScene,
  type NamedRect,
  type Scene,
} from './geometry';

const safeZone: NamedRect = { name: '字幕安全区', x: 100, y: 100, width: 200, height: 100 };

const ob = (partial: Partial<NamedRect>): NamedRect => ({
  name: '遮挡物',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...partial,
});

describe('overlapLengths', () => {
  it('部分交叠时返回正的交叠宽高', () => {
    expect(overlapLengths(safeZone, ob({ x: 250, y: 150, width: 100, height: 100 }))).toEqual({
      width: 50,
      height: 50,
    });
  });

  it('横向分离时交叠宽为负', () => {
    expect(overlapLengths(safeZone, ob({ x: 350, y: 100 })).width).toBeLessThan(0);
  });

  it('纵向分离时交叠高为负', () => {
    expect(overlapLengths(safeZone, ob({ x: 100, y: 500 })).height).toBeLessThan(0);
  });

  it('结果与参数顺序无关（对称性）', () => {
    const other = ob({ x: 250, y: 150, width: 100, height: 100 });
    expect(overlapLengths(safeZone, other)).toEqual(overlapLengths(other, safeZone));
  });
});

describe('classifyOverlap', () => {
  it('仅横纵交叠都大于 0 才算真实遮挡', () => {
    expect(classifyOverlap(1, 1)).toBe('occluding');
    expect(classifyOverlap(0, 100)).toBe('touching');
    expect(classifyOverlap(100, 0)).toBe('touching');
    expect(classifyOverlap(0, 0)).toBe('touching');
    expect(classifyOverlap(-1, 100)).toBe('safe');
    expect(classifyOverlap(100, -1)).toBe('safe');
  });
});

describe('evaluateObstruction', () => {
  it('1 像素交叠也构成真实遮挡', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 299, y: 199, width: 10, height: 10 }));
    expect(v).toMatchObject({ status: 'occluding', overlapWidth: 1, overlapHeight: 1 });
  });

  it('仅共边不算遮挡（贴安全区右边）', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 300, y: 100, width: 50, height: 50 }));
    expect(v).toMatchObject({ status: 'touching', overlapWidth: 0, overlapHeight: 50 });
  });

  it('仅共边不算遮挡（贴安全区下边）', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 100, y: 200, width: 50, height: 50 }));
    expect(v).toMatchObject({ status: 'touching', overlapWidth: 50, overlapHeight: 0 });
  });

  it('仅共点不算遮挡（角对角）', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 300, y: 200, width: 50, height: 50 }));
    expect(v).toMatchObject({ status: 'touching', overlapWidth: 0, overlapHeight: 0 });
  });

  it('完全分离为安全，交叠宽高归零', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 400, y: 400, width: 10, height: 10 }));
    expect(v).toMatchObject({ status: 'safe', overlapWidth: 0, overlapHeight: 0 });
  });

  it('遮挡物完全覆盖安全区时，交叠为安全区尺寸', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 0, y: 0, width: 1000, height: 1000 }));
    expect(v).toMatchObject({ status: 'occluding', overlapWidth: 200, overlapHeight: 100 });
  });

  it('遮挡物被安全区包含时，交叠为遮挡物自身尺寸', () => {
    const v = evaluateObstruction(safeZone, ob({ x: 150, y: 120, width: 20, height: 30 }));
    expect(v).toMatchObject({ status: 'occluding', overlapWidth: 20, overlapHeight: 30 });
  });
});

const baseScene = (): Scene => ({
  canvas: { width: 1920, height: 1080 },
  safeZone: { name: '字幕安全区', x: 480, y: 270, width: 960, height: 540 },
  obstructions: [{ name: '升降台', x: 1200, y: 700, width: 300, height: 200 }],
});

describe('validateScene', () => {
  it('合法场景无错误', () => {
    expect(validateScene(baseScene())).toEqual([]);
  });

  it('拒绝非整数画布尺寸', () => {
    const scene = baseScene();
    scene.canvas.width = 1920.5;
    expect(validateScene(scene).join()).toContain('画布宽度');
  });

  it('拒绝非有限数值（Infinity / NaN）', () => {
    const inf = baseScene();
    inf.obstructions[0].x = Number.POSITIVE_INFINITY;
    expect(validateScene(inf).join()).toContain('整数');

    const nan = baseScene();
    nan.obstructions[0].y = Number.NaN;
    expect(validateScene(nan).join()).toContain('整数');
  });

  it('拒绝小于 1 的矩形宽高', () => {
    const zeroWidth = baseScene();
    zeroWidth.obstructions[0].width = 0;
    expect(validateScene(zeroWidth).join()).toContain('宽度必须 ≥ 1');

    const negativeHeight = baseScene();
    negativeHeight.obstructions[0].height = -5;
    expect(validateScene(negativeHeight).join()).toContain('高度必须 ≥ 1');
  });

  it('拒绝负坐标', () => {
    const scene = baseScene();
    scene.obstructions[0].x = -1;
    expect(validateScene(scene).join()).toContain('不能为负');
  });

  it('拒绝越出画布右边界的矩形', () => {
    const scene = baseScene();
    scene.obstructions[0].x = 1700; // 1700 + 300 = 2000 > 1920
    expect(validateScene(scene).join()).toContain('右边界');
  });

  it('拒绝越出画布下边界的矩形（含安全区）', () => {
    const scene = baseScene();
    scene.safeZone.y = 600; // 600 + 540 = 1140 > 1080
    expect(validateScene(scene).join()).toContain('下边界');
  });

  it('允许矩形贴齐画布边缘', () => {
    const scene = baseScene();
    scene.obstructions[0] = { name: '贴边', x: 1820, y: 980, width: 100, height: 100 };
    expect(validateScene(scene)).toEqual([]);
  });

  it('拒绝重复名称（遮挡物之间）', () => {
    const scene = baseScene();
    scene.obstructions.push({ name: '升降台', x: 0, y: 0, width: 10, height: 10 });
    expect(validateScene(scene).join()).toContain('重复');
  });

  it('拒绝与安全区重名', () => {
    const scene = baseScene();
    scene.obstructions[0].name = '字幕安全区';
    expect(validateScene(scene).join()).toContain('重复');
  });

  it('拒绝空名称', () => {
    const scene = baseScene();
    scene.obstructions[0].name = '   ';
    expect(validateScene(scene).join()).toContain('名称不能为空');
  });
});

describe('clientToView', () => {
  // 1920×1080 的 viewBox 渲染在 left=100、top=50、760×427.5 的区域内
  const bounds = { left: 100, top: 50, width: 760, height: 427.5 };
  const view = { width: 1920, height: 1080 };

  it('元素左上角映射为视图原点', () => {
    expect(clientToView(100, 50, bounds, view)).toEqual({ x: 0, y: 0 });
  });

  it('元素右下角映射为画布右下角', () => {
    const p = clientToView(860, 477.5, bounds, view);
    expect(p.x).toBeCloseTo(1920, 10);
    expect(p.y).toBeCloseTo(1080, 10);
  });

  it('按渲染比例换算中间点', () => {
    const p = clientToView(480, 263.75, bounds, view);
    expect(p.x).toBeCloseTo(960, 10);
    expect(p.y).toBeCloseTo(540, 10);
  });

  it('非等比缩放时 x、y 各自按比例换算', () => {
    const stretched = { left: 0, top: 0, width: 500, height: 200 };
    expect(clientToView(250, 50, stretched, { width: 1000, height: 800 })).toEqual({
      x: 500,
      y: 200,
    });
  });

  it('元素外的屏幕坐标换算为视图范围外的值（交由钳制处理）', () => {
    const p = clientToView(40, 500, bounds, view);
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(1080);
  });
});

describe('clampRectToCanvas', () => {
  const canvas = { width: 1920, height: 1080 };
  // 安全区 960×540：合法范围 x ∈ [0, 960]，y ∈ [0, 540]
  const clamp = (x: number, y: number) => clampRectToCanvas(x, y, 960, 540, canvas);

  it('画布内位置四舍五入为最近整数像素', () => {
    expect(clamp(100.4, 200.4)).toEqual({ x: 100, y: 200 });
    expect(clamp(100.5, 200.6)).toEqual({ x: 101, y: 201 });
  });

  it('画布内的整数位置保持不变', () => {
    expect(clamp(480, 270)).toEqual({ x: 480, y: 270 });
  });

  it('越出左边界钳制到 x = 0', () => {
    expect(clamp(-3, 270)).toEqual({ x: 0, y: 270 });
    expect(clamp(-0.4, 270)).toEqual({ x: 0, y: 270 });
  });

  it('越出上边界钳制到 y = 0', () => {
    expect(clamp(480, -12)).toEqual({ x: 480, y: 0 });
  });

  it('越出右边界钳制到 画布宽 − 矩形宽', () => {
    expect(clamp(1500, 270)).toEqual({ x: 960, y: 270 });
    expect(clamp(960.6, 270)).toEqual({ x: 960, y: 270 });
  });

  it('越出下边界钳制到 画布高 − 矩形高', () => {
    expect(clamp(480, 999)).toEqual({ x: 480, y: 540 });
    expect(clamp(480, 540.6)).toEqual({ x: 480, y: 540 });
  });

  it('先取整再钳制：边界上的小数得到最近合法整数', () => {
    // 959.6 取整为 960，恰好是最大合法值
    expect(clamp(959.6, 539.6)).toEqual({ x: 960, y: 540 });
    // 960.4 取整为 960，不越界
    expect(clamp(960.4, 540.4)).toEqual({ x: 960, y: 540 });
  });

  it('矩形贴齐画布边缘是合法位置', () => {
    expect(clamp(0, 0)).toEqual({ x: 0, y: 0 });
    expect(clamp(960, 540)).toEqual({ x: 960, y: 540 });
  });

  it('矩形大于画布时钳制到原点（防御性）', () => {
    expect(clampRectToCanvas(50, 50, 5000, 2000, canvas)).toEqual({ x: 0, y: 0 });
  });
});

describe('evaluateScene', () => {
  it('逐项给出判定并汇总结论', () => {
    const scene = baseScene();
    scene.obstructions.push({ name: '远景布景', x: 0, y: 0, width: 10, height: 10 });
    scene.obstructions.push({ name: '侧幕', x: 1440, y: 270, width: 100, height: 540 });
    const result = evaluateScene(scene);
    expect(result.verdicts.map((v) => v.status)).toEqual(['occluding', 'safe', 'touching']);
    expect(result.hasOcclusion).toBe(true);
  });

  it('无真实遮挡时总结论为通过', () => {
    const scene = baseScene();
    scene.obstructions = [{ name: '侧幕', x: 1440, y: 270, width: 100, height: 540 }];
    const result = evaluateScene(scene);
    expect(result.hasOcclusion).toBe(false);
    expect(result.verdicts[0]).toMatchObject({ status: 'touching', overlapWidth: 0, overlapHeight: 540 });
  });
});
