import { describe, expect, it } from 'vitest';
import {
  classifyOverlap,
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
