/**
 * 核心几何模块：轴对齐矩形的遮挡判定。
 *
 * 坐标系：左上角为原点，x 向右、y 向下，单位为整数像素。
 * 判定规则：两个矩形仅在横向与纵向的交叠长度都大于 0 时才构成真实遮挡；
 * 仅共边（某一方向交叠为 0、另一方向大于 0）或共点（两方向交叠均为 0）
 * 不算遮挡，记为「接触边界」；任一方向交叠为负则完全分离，记为「安全」。
 */

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NamedRect extends Rect {
  name: string;
}

export interface Scene {
  canvas: CanvasSize;
  safeZone: NamedRect;
  obstructions: NamedRect[];
}

export type VerdictStatus = 'safe' | 'touching' | 'occluding';

export interface Verdict {
  name: string;
  rect: NamedRect;
  status: VerdictStatus;
  /** 横向交叠长度，非真实遮挡时为 0 */
  overlapWidth: number;
  /** 纵向交叠长度，非真实遮挡时为 0 */
  overlapHeight: number;
}

export interface SceneResult {
  scene: Scene;
  verdicts: Verdict[];
  hasOcclusion: boolean;
}

/**
 * 计算两个轴对齐矩形在 x、y 方向上的交叠长度。
 * 结果为负表示该方向上两矩形分离，为 0 表示该方向上仅边界相接。
 */
export function overlapLengths(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/** 根据横纵交叠长度分类：两者均大于 0 才为真实遮挡。 */
export function classifyOverlap(overlapWidth: number, overlapHeight: number): VerdictStatus {
  if (overlapWidth > 0 && overlapHeight > 0) return 'occluding';
  if (overlapWidth >= 0 && overlapHeight >= 0) return 'touching';
  return 'safe';
}

/** 判定单个遮挡矩形与安全区的关系。 */
export function evaluateObstruction(safeZone: Rect, rect: NamedRect): Verdict {
  const { width, height } = overlapLengths(safeZone, rect);
  return {
    name: rect.name,
    rect,
    status: classifyOverlap(width, height),
    overlapWidth: Math.max(0, width),
    overlapHeight: Math.max(0, height),
  };
}

/** 对场景中的全部遮挡矩形逐项判定。 */
export function evaluateScene(scene: Scene): SceneResult {
  const verdicts = scene.obstructions.map((obstruction) =>
    evaluateObstruction(scene.safeZone, obstruction),
  );
  return {
    scene,
    verdicts,
    hasOcclusion: verdicts.some((v) => v.status === 'occluding'),
  };
}

/** 整数必然有限，Number.isInteger 同时拒绝 NaN 与 Infinity。 */
const isInt = (n: number): boolean => Number.isInteger(n);

const show = (n: number): string => (Number.isNaN(n) ? '空或非数值' : String(n));

/**
 * 校验整个场景。任一数值非整数、非有限、越界，或矩形名称为空、重复时，
 * 返回全部错误信息（非空数组即表示整次拒绝）。
 */
export function validateScene(scene: Scene): string[] {
  const errors: string[] = [];
  const { width: canvasWidth, height: canvasHeight } = scene.canvas;
  const canvasValid =
    isInt(canvasWidth) && canvasWidth >= 1 && isInt(canvasHeight) && canvasHeight >= 1;

  if (!isInt(canvasWidth) || canvasWidth < 1) {
    errors.push(`画布宽度必须是 ≥ 1 的整数（当前：${show(canvasWidth)}）`);
  }
  if (!isInt(canvasHeight) || canvasHeight < 1) {
    errors.push(`画布高度必须是 ≥ 1 的整数（当前：${show(canvasHeight)}）`);
  }

  const entries: Array<{ tag: string; rect: NamedRect }> = [
    { tag: '安全区', rect: scene.safeZone },
    ...scene.obstructions.map((rect, i) => ({ tag: `遮挡矩形 #${i + 1}`, rect })),
  ];

  const nameCounts = new Map<string, number>();
  for (const { rect } of entries) {
    const name = rect.name.trim();
    if (name.length > 0) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) errors.push(`矩形名称「${name}」重复出现 ${count} 次`);
  }

  for (const { tag, rect } of entries) {
    const trimmed = rect.name.trim();
    const label = trimmed ? `${tag}「${trimmed}」` : tag;
    if (!trimmed) errors.push(`${tag}的名称不能为空`);

    if (!isInt(rect.x)) errors.push(`${label}的 x 必须是整数（当前：${show(rect.x)}）`);
    if (!isInt(rect.y)) errors.push(`${label}的 y 必须是整数（当前：${show(rect.y)}）`);
    if (!isInt(rect.width)) {
      errors.push(`${label}的宽度必须是整数（当前：${show(rect.width)}）`);
    } else if (rect.width < 1) {
      errors.push(`${label}的宽度必须 ≥ 1（当前：${rect.width}）`);
    }
    if (!isInt(rect.height)) {
      errors.push(`${label}的高度必须是整数（当前：${show(rect.height)}）`);
    } else if (rect.height < 1) {
      errors.push(`${label}的高度必须 ≥ 1（当前：${rect.height}）`);
    }

    if (isInt(rect.x) && rect.x < 0) errors.push(`${label}的 x 不能为负（当前：${rect.x}）`);
    if (isInt(rect.y) && rect.y < 0) errors.push(`${label}的 y 不能为负（当前：${rect.y}）`);

    if (canvasValid && isInt(rect.x) && isInt(rect.width) && rect.x >= 0 && rect.width >= 1) {
      if (rect.x + rect.width > canvasWidth) {
        errors.push(`${label}超出画布右边界（x + 宽 = ${rect.x + rect.width} > ${canvasWidth}）`);
      }
    }
    if (canvasValid && isInt(rect.y) && isInt(rect.height) && rect.y >= 0 && rect.height >= 1) {
      if (rect.y + rect.height > canvasHeight) {
        errors.push(`${label}超出画布下边界（y + 高 = ${rect.y + rect.height} > ${canvasHeight}）`);
      }
    }
  }

  return errors;
}
