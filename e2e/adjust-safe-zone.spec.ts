import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * 「调整安全区」端到端：从遮挡结果开启调整、拖拽安全区、坐标回填、
 * 指针取消回退、边缘钳制，以及原有直接录入与 JSON 下载的兼容性。
 *
 * 画布 1920×1080，安全区默认 (480, 270, 960×540)，遮挡物「升降台」(1200, 700, 300×200)。
 */

const CANVAS_WIDTH = 1920;

interface DragSession {
  /** 拖拽终点（当前指针所在）的视口坐标 */
  endX: number;
  endY: number;
}

/** 读取画布与安全区的视口几何信息（先滚动到可见区域）。 */
async function stageGeometry(page: Page) {
  const stage = page.getByTestId('stage');
  await stage.scrollIntoViewIfNeeded();
  const svgBox = await stage.boundingBox();
  const zoneBox = await page.getByTestId('safe-zone-rect').boundingBox();
  if (!svgBox || !zoneBox) throw new Error('画布或安全区不可见');
  return { svgBox, zoneBox };
}

/**
 * 在安全区内按下指针并移动给定的视图坐标距离（不松开）。
 * 抓取点取安全区左上 20% 处，避开可能覆盖中心的遮挡矩形；
 * 终点会被限制在视口内，越界部分由被测代码钳制。
 */
async function beginDrag(page: Page, dxView: number, dyView: number): Promise<DragSession> {
  const { svgBox, zoneBox } = await stageGeometry(page);
  const scale = svgBox.width / CANVAS_WIDTH;
  const startX = zoneBox.x + zoneBox.width * 0.2;
  const startY = zoneBox.y + zoneBox.height * 0.2;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const endX = Math.min(Math.max(startX + dxView * scale, 2), viewport.width - 2);
  const endY = Math.min(Math.max(startY + dyView * scale, 2), viewport.height - 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  return { endX, endY };
}

/** 读取表单中安全区的当前坐标。 */
async function formSafeZone(page: Page) {
  return {
    x: Number(await page.getByTestId('safe-zone-x').inputValue()),
    y: Number(await page.getByTestId('safe-zone-y').inputValue()),
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('遮挡结果上开启调整，拖到无重叠位置后坐标回填并再次核验通过', async ({ page }) => {
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');

  await page.getByTestId('adjust-safe-zone').click();
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 480');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 270');

  // 把安全区从 (480, 270) 拖到 (100, 100) 附近，脱离升降台
  await beginDrag(page, -380, -170);

  // 拖动期间实时刷新：总览与逐项判定已翻转为通过
  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');
  await expect(page.getByTestId('verdict-0')).toContainText('安全');

  await page.mouse.up();

  // 候选坐标写回现有表单：整数、在画布内、落在目标附近
  const { x, y } = await formSafeZone(page);
  expect(Number.isInteger(x)).toBe(true);
  expect(Number.isInteger(y)).toBe(true);
  expect(Math.abs(x - 100)).toBeLessThanOrEqual(2);
  expect(Math.abs(y - 100)).toBeLessThanOrEqual(2);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + 960).toBeLessThanOrEqual(1920);
  expect(y + 540).toBeLessThanOrEqual(1080);

  // 入口附近显示的候选坐标与写回表单的值一致
  await expect(page.getByTestId('candidate-coords')).toContainText(`x = ${x}`);
  await expect(page.getByTestId('candidate-coords')).toContainText(`y = ${y}`);

  // 松开后保留拖动出的最新结论
  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');

  // 再次点击核验仍走原有校验链路，结论保持通过
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');
  await expect(page.getByTestId('verdict-0')).toContainText('安全');
});

test('指针事件被浏览器取消时恢复拖动前的位置', async ({ page }) => {
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  await page.getByTestId('adjust-safe-zone').click();

  await beginDrag(page, -380, -170);
  // 拖动中结论已实时翻转
  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');

  // 浏览器取消指针事件 → 丢弃候选，回退到拖动前
  await page.getByTestId('safe-zone-rect').dispatchEvent('pointercancel');
  await page.mouse.up();

  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 480');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 270');
  // 表单未被拖动污染
  expect(await formSafeZone(page)).toEqual({ x: 480, y: 270 });
});

test('拖出画布边缘时钳制到最近合法整数位置', async ({ page }) => {
  await page.getByTestId('submit').click();
  await page.getByTestId('adjust-safe-zone').click();

  // 向右下远远拖出画布 → 钳制到 (1920−960, 1080−540) = (960, 540)
  await beginDrag(page, 5000, 5000);
  await page.mouse.up();
  expect(await formSafeZone(page)).toEqual({ x: 960, y: 540 });
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 960');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 540');

  // 向左上远远拖出画布 → 钳制到 (0, 0)
  await beginDrag(page, -5000, -5000);
  await page.mouse.up();
  expect(await formSafeZone(page)).toEqual({ x: 0, y: 0 });
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 0');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 0');
  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');
});

test('只点击未移动不产生非法坐标', async ({ page }) => {
  await page.getByTestId('submit').click();
  await page.getByTestId('adjust-safe-zone').click();

  const { zoneBox } = await stageGeometry(page);
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  expect(await formSafeZone(page)).toEqual({ x: 480, y: 270 });
  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 480');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 270');
});

test('触点落在安全区之外不会启动拖拽', async ({ page }) => {
  await page.getByTestId('submit').click();
  await page.getByTestId('adjust-safe-zone').click();

  // 画布左上角空白处（约视图坐标 (60, 60)），在安全区与遮挡物之外
  const { svgBox } = await stageGeometry(page);
  const scale = svgBox.width / CANVAS_WIDTH;
  const startX = svgBox.x + 60 * scale;
  const startY = svgBox.y + 60 * scale;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120 * scale, startY + 120 * scale, { steps: 5 });
  await page.mouse.up();

  expect(await formSafeZone(page)).toEqual({ x: 480, y: 270 });
  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  await expect(page.getByTestId('candidate-coords')).toContainText('x = 480');
  await expect(page.getByTestId('candidate-coords')).toContainText('y = 270');
});

test('调整后 JSON 下载结构兼容，直接录入核验仍可用', async ({ page }) => {
  await page.getByTestId('submit').click();
  await page.getByTestId('adjust-safe-zone').click();

  // 拖到无重叠位置并松开，随后退出调整模式
  await beginDrag(page, -380, -170);
  await page.mouse.up();
  await page.getByTestId('adjust-safe-zone').click();
  await expect(page.getByTestId('candidate-coords')).toHaveCount(0);

  const { x, y } = await formSafeZone(page);

  // 下载内容反映拖动后的安全区，结构保持不变
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-json').click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const payload = JSON.parse(readFileSync(path as string, 'utf-8'));

  expect(Object.keys(payload).sort()).toEqual(
    ['canvas', 'hasOcclusion', 'obstructions', 'safeZone', 'verdicts'].sort(),
  );
  expect(payload.canvas).toEqual({ width: 1920, height: 1080 });
  expect(payload.safeZone).toEqual({ name: '字幕安全区', x, y, width: 960, height: 540 });
  expect(payload.obstructions).toEqual([
    { name: '升降台', x: 1200, y: 700, width: 300, height: 200 },
  ]);
  expect(payload.verdicts).toHaveLength(1);
  expect(payload.verdicts[0]).toMatchObject({ name: '升降台', status: 'safe' });
  expect(payload.hasOcclusion).toBe(false);

  // 原有直接录入核验链路不受影响：改回遮挡位置后判定为真实遮挡
  await page.getByTestId('safe-zone-x').fill('480');
  await page.getByTestId('safe-zone-y').fill('270');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  await expect(page.getByTestId('verdict-0')).toContainText('交叠 240 × 110');
});
