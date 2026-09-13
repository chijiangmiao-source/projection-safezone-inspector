# 字幕安全区核验器

首演前合成阶段使用的浏览器内核验工具：舞台视频工程师录入投影画布、字幕安全区与若干遮挡矩形（升降台、布景等），逐项判定遮挡物是否真正侵入安全区，并在画布上直观区分**安全 / 接触边界 / 真实遮挡**三种状态。

技术栈：TypeScript + React + Vite，Vitest 覆盖几何边界，Playwright 验证录入到结果的主链路，Docker Compose 运行静态 Web 与一次性验收。

## 判定规则

- **坐标系**：以画布左上角为原点，x 向右、y 向下，单位为整数像素。
- **输入约束**：
  - 画布宽、高均为 ≥ 1 的整数；
  - 每个矩形（安全区与遮挡矩形）的 x、y、宽、高均为整数，宽、高 ≥ 1；
  - 每个矩形必须完整位于画布内（x ≥ 0、y ≥ 0、x + 宽 ≤ 画布宽、y + 高 ≤ 画布高）；
  - 矩形名称不能为空，且全部矩形（含安全区）名称不得重复。
- **整次拒绝**：任一数值非整数、非有限（NaN / Infinity）、越界，或名称重复时，整次提交被拒绝，并清除上一次的有效结论。
- **遮挡判定**（轴对齐矩形）：设安全区与遮挡矩形在横向、纵向的交叠长度分别为 `ow`、`oh`：
  - `ow > 0` 且 `oh > 0` → **真实遮挡**（核验失败），展示交叠宽 × 高；
  - `ow ≥ 0` 且 `oh ≥ 0` 且不同时大于 0 → **接触边界**（仅共边或共点，不算遮挡，不判失败）；
  - 任一方向交叠 < 0 → **安全**（完全分离）。
- **结果**：总体结论横幅、逐项判定（含交叠宽高）、三色画布可视化（蓝=安全、琥珀=接触边界、红=真实遮挡，深红标出交叠区域），合法结果可下载为 JSON（含画布、矩形与逐项判定）。

## 调整安全区（拖拽改位）

出现真实遮挡后，可在结果页点击 **调整安全区** 直接进入拖拽改位，不必手算坐标重新填表：

- 开启后画布中的安全区变为可拖拽矩形；指针位置按 SVG 视图比例换算为整数像素，并始终钳制在画布内（越界拖动取最近合法整数位置）。
- 拖动期间实时重算总览横幅、逐项判定与交叠着色；入口旁同步显示候选坐标。
- 松开指针后候选坐标写回安全区表单并保留最新结论，再次点击「核验」仍走原有校验链路；浏览器取消指针事件（pointercancel）时自动回退到拖动前的位置。
- 触点落在安全区之外不会启动拖拽；场景结构与下载 JSON 格式保持不变。

## 运行（Docker Compose）

```bash
# 构建并启动静态 Web，默认宿主端口 8080
docker compose up --build web

# 用 WEB_PORT 覆盖宿主端口
WEB_PORT=9000 docker compose up --build web
```

访问 `http://localhost:${WEB_PORT:-8080}`。

## 一次性验收（verify 服务）

```bash
docker compose run --rm --build verify
```

`verify` 会在容器内先执行 Vitest 几何边界测试，再对 `web` 服务执行 Playwright 端到端测试，全部通过后以退出码 0 结束；任一失败则退出码非零。也可使用：

```bash
docker compose up --build --exit-code-from verify
```

## 本地开发

```bash
npm ci                 # 安装依赖
npm run dev            # Vite 开发服务器（默认 5173）
npm test               # Vitest：几何判定与校验的边界用例
npx playwright install chromium   # 首次运行 e2e 前安装浏览器
npm run test:e2e       # Playwright：录入 → 判定 → 下载的主链路
npm run build          # 类型检查并产出 dist/
```

## 下载 JSON 格式

```json
{
  "canvas": { "width": 1920, "height": 1080 },
  "safeZone": { "name": "字幕安全区", "x": 480, "y": 270, "width": 960, "height": 540 },
  "obstructions": [{ "name": "升降台", "x": 1200, "y": 700, "width": 300, "height": 200 }],
  "verdicts": [
    {
      "name": "升降台",
      "status": "occluding",
      "overlapWidth": 240,
      "overlapHeight": 110,
      "rect": { "name": "升降台", "x": 1200, "y": 700, "width": 300, "height": 200 }
    }
  ],
  "hasOcclusion": true
}
```

`status` 取值：`safe`（安全）、`touching`（接触边界）、`occluding`（真实遮挡）。

## 目录结构

```
src/geometry.ts        核心：交叠计算、遮挡分类、场景校验、视图坐标换算与画布钳制（纯函数，无 UI 依赖）
src/geometry.test.ts   Vitest：共边/共点/包含/1px 交叠/非法输入/坐标换算/取整/四边钳制等边界
src/App.tsx            录入表单、错误展示、逐项判定、调整安全区模式与 JSON 下载
src/StageView.tsx      SVG 画布：安全区（调整模式下可拖拽）+ 三色遮挡矩形 + 交叠区域
e2e/main-flow.spec.ts  Playwright：录入到结果的主链路
e2e/adjust-safe-zone.spec.ts Playwright：拖拽调整、取消回退、边缘钳制与兼容性
Dockerfile             多阶段构建，nginx 托管静态产物
Dockerfile.verify      一次性验收镜像（Vitest + Playwright）
docker-compose.yml     web（WEB_PORT 覆盖端口）与 verify 服务
```
