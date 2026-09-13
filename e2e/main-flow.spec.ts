import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface RectInput {
  name?: string;
  x: string;
  y: string;
  width: string;
  height: string;
}

async function fillRect(page: Page, prefix: string, rect: RectInput) {
  if (rect.name !== undefined) await page.getByTestId(`${prefix}-name`).fill(rect.name);
  await page.getByTestId(`${prefix}-x`).fill(rect.x);
  await page.getByTestId(`${prefix}-y`).fill(rect.y);
  await page.getByTestId(`${prefix}-width`).fill(rect.width);
  await page.getByTestId(`${prefix}-height`).fill(rect.height);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('主链路：录入画布、安全区与遮挡物后得到逐项判定', async ({ page }) => {
  await page.getByTestId('canvas-width').fill('1920');
  await page.getByTestId('canvas-height').fill('1080');
  await fillRect(page, 'safe-zone', {
    name: '字幕安全区',
    x: '480',
    y: '270',
    width: '960',
    height: '540',
  });
  await fillRect(page, 'obstruction-0', {
    name: '升降台',
    x: '1200',
    y: '700',
    width: '300',
    height: '200',
  });
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('overall-banner')).toContainText('真实遮挡');
  const verdict = page.getByTestId('verdict-0');
  await expect(verdict).toContainText('升降台');
  await expect(verdict).toContainText('真实遮挡');
  await expect(verdict).toContainText('交叠 240 × 110');
  await expect(page.getByTestId('stage')).toBeVisible();
});

test('共边只算接触边界，不算遮挡', async ({ page }) => {
  // 安全区右边界 x = 480 + 960 = 1440，遮挡矩形左边缘贴齐
  await fillRect(page, 'obstruction-0', {
    name: '侧幕',
    x: '1440',
    y: '270',
    width: '100',
    height: '540',
  });
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('overall-banner')).toContainText('核验通过');
  await expect(page.getByTestId('verdict-0')).toContainText('接触边界');
  await expect(page.getByTestId('verdict-0')).toContainText('交叠 0 × 540');
});

test('非法输入整次拒绝并清除旧结论', async ({ page }) => {
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('result-panel')).toBeVisible();

  await page.getByTestId('canvas-width').fill('1920.5');
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('error-list')).toContainText('画布宽度');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
});

test('矩形名称重复时整次拒绝', async ({ page }) => {
  await page.getByTestId('add-obstruction').click();
  await fillRect(page, 'obstruction-1', {
    name: '升降台',
    x: '10',
    y: '10',
    width: '20',
    height: '20',
  });
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('error-list')).toContainText('重复');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
});

test('合法结果可下载为含画布、矩形与逐项判定的 JSON', async ({ page }) => {
  await page.getByTestId('submit').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-json').click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const payload = JSON.parse(readFileSync(path as string, 'utf-8'));

  expect(payload.canvas).toEqual({ width: 1920, height: 1080 });
  expect(payload.safeZone).toMatchObject({ name: '字幕安全区', x: 480, y: 270 });
  expect(payload.obstructions).toHaveLength(1);
  expect(payload.verdicts).toHaveLength(1);
  expect(payload.verdicts[0]).toMatchObject({
    name: '升降台',
    status: 'occluding',
    overlapWidth: 240,
    overlapHeight: 110,
  });
  expect(payload.hasOcclusion).toBe(true);
});
