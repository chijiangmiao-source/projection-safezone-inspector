import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { evaluateScene, validateScene } from './geometry';
import type { Scene, SceneResult, VerdictStatus } from './geometry';
import StageView from './StageView';
import './styles.css';

interface RectFormState {
  name: string;
  x: string;
  y: string;
  width: string;
  height: string;
}

interface ObstructionFormState extends RectFormState {
  id: number;
}

const STATUS_LABEL: Record<VerdictStatus, string> = {
  safe: '安全',
  touching: '接触边界',
  occluding: '真实遮挡',
};

let nextObstructionId = 1;

function createObstruction(partial: Partial<RectFormState> = {}): ObstructionFormState {
  return {
    id: nextObstructionId++,
    name: partial.name ?? '',
    x: partial.x ?? '',
    y: partial.y ?? '',
    width: partial.width ?? '',
    height: partial.height ?? '',
  };
}

/** 空串视为非法（NaN），交给校验层统一拒绝。 */
const toNumber = (raw: string): number => (raw.trim() === '' ? Number.NaN : Number(raw));

function parseRect(form: RectFormState) {
  return {
    name: form.name.trim(),
    x: toNumber(form.x),
    y: toNumber(form.y),
    width: toNumber(form.width),
    height: toNumber(form.height),
  };
}

interface RectInputsProps {
  prefix: string;
  value: RectFormState;
  onChange: (next: RectFormState) => void;
}

function RectInputs({ prefix, value, onChange }: RectInputsProps) {
  const bind = (key: keyof RectFormState) => ({
    value: value[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value }),
  });
  return (
    <div className="rect-inputs">
      <label>
        名称
        <input data-testid={`${prefix}-name`} type="text" placeholder="如：升降台" {...bind('name')} />
      </label>
      <label>
        X
        <input data-testid={`${prefix}-x`} type="text" inputMode="numeric" {...bind('x')} />
      </label>
      <label>
        Y
        <input data-testid={`${prefix}-y`} type="text" inputMode="numeric" {...bind('y')} />
      </label>
      <label>
        宽
        <input data-testid={`${prefix}-width`} type="text" inputMode="numeric" {...bind('width')} />
      </label>
      <label>
        高
        <input data-testid={`${prefix}-height`} type="text" inputMode="numeric" {...bind('height')} />
      </label>
    </div>
  );
}

export default function App() {
  const [canvasWidth, setCanvasWidth] = useState('1920');
  const [canvasHeight, setCanvasHeight] = useState('1080');
  const [safeZone, setSafeZone] = useState<RectFormState>({
    name: '字幕安全区',
    x: '480',
    y: '270',
    width: '960',
    height: '540',
  });
  const [obstructions, setObstructions] = useState<ObstructionFormState[]>([
    createObstruction({ name: '升降台', x: '1200', y: '700', width: '300', height: '200' }),
  ]);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<SceneResult | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const scene: Scene = {
      canvas: { width: toNumber(canvasWidth), height: toNumber(canvasHeight) },
      safeZone: parseRect(safeZone),
      obstructions: obstructions.map(parseRect),
    };
    const problems = validateScene(scene);
    if (problems.length > 0) {
      // 整次拒绝，并清除上一次的有效结论
      setErrors(problems);
      setResult(null);
      return;
    }
    setErrors([]);
    setResult(evaluateScene(scene));
  };

  const updateObstruction = (id: number, next: RectFormState) => {
    setObstructions((list) => list.map((o) => (o.id === id ? { ...o, ...next } : o)));
  };

  const removeObstruction = (id: number) => {
    setObstructions((list) => list.filter((o) => o.id !== id));
  };

  const handleDownload = () => {
    if (!result) return;
    const payload = {
      canvas: result.scene.canvas,
      safeZone: result.scene.safeZone,
      obstructions: result.scene.obstructions,
      verdicts: result.verdicts.map((v) => ({
        name: v.name,
        status: v.status,
        overlapWidth: v.overlapWidth,
        overlapHeight: v.overlapHeight,
        rect: v.rect,
      })),
      hasOcclusion: result.hasOcclusion,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'safe-zone-verdicts.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const occludingCount = result?.verdicts.filter((v) => v.status === 'occluding').length ?? 0;
  const touchingCount = result?.verdicts.filter((v) => v.status === 'touching').length ?? 0;

  return (
    <main className="app">
      <h1>字幕安全区核验器</h1>
      <p className="hint">
        坐标以画布左上角为原点、单位为整数像素。两矩形仅共边或共点不算遮挡，
        只有横向与纵向交叠长度都大于 0 才判定为真实遮挡。
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend>画布</legend>
          <div className="rect-inputs">
            <label>
              宽
              <input
                data-testid="canvas-width"
                type="text"
                inputMode="numeric"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(e.target.value)}
              />
            </label>
            <label>
              高
              <input
                data-testid="canvas-height"
                type="text"
                inputMode="numeric"
                value={canvasHeight}
                onChange={(e) => setCanvasHeight(e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>安全区</legend>
          <RectInputs prefix="safe-zone" value={safeZone} onChange={setSafeZone} />
        </fieldset>

        <fieldset>
          <legend>遮挡矩形</legend>
          {obstructions.map((obstruction, index) => (
            <div className="obstruction-row" key={obstruction.id}>
              <RectInputs
                prefix={`obstruction-${index}`}
                value={obstruction}
                onChange={(next) => updateObstruction(obstruction.id, next)}
              />
              <button
                type="button"
                className="btn btn-danger"
                data-testid={`obstruction-remove-${index}`}
                onClick={() => removeObstruction(obstruction.id)}
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            data-testid="add-obstruction"
            onClick={() => setObstructions((list) => [...list, createObstruction()])}
          >
            + 添加遮挡矩形
          </button>
        </fieldset>

        <button type="submit" className="btn btn-primary" data-testid="submit">
          核验
        </button>
      </form>

      {errors.length > 0 && (
        <section className="errors" aria-live="polite">
          <h2>输入被拒绝</h2>
          <ul data-testid="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      )}

      {result && (
        <section className="result" data-testid="result-panel">
          <div
            data-testid="overall-banner"
            className={`banner ${occludingCount > 0 ? 'banner-fail' : 'banner-pass'}`}
          >
            {occludingCount > 0
              ? `核验未通过：存在 ${occludingCount} 处真实遮挡`
              : touchingCount > 0
                ? `核验通过：无真实遮挡，${touchingCount} 处与安全区边界接触`
                : '核验通过：全部遮挡物均在安全区外'}
          </div>

          <StageView result={result} />

          <h2>逐项判定</h2>
          {result.verdicts.length === 0 ? (
            <p>未录入任何遮挡矩形。</p>
          ) : (
            <ul className="verdicts">
              {result.verdicts.map((verdict, index) => (
                <li
                  key={verdict.name}
                  data-testid={`verdict-${index}`}
                  className={`verdict verdict-${verdict.status}`}
                >
                  <span className="verdict-name">{verdict.name}</span>
                  <span className={`badge badge-${verdict.status}`}>
                    {STATUS_LABEL[verdict.status]}
                  </span>
                  <span className="overlap">
                    交叠 {verdict.overlapWidth} × {verdict.overlapHeight}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn" data-testid="download-json" onClick={handleDownload}>
            下载判定结果 JSON
          </button>
        </section>
      )}
    </main>
  );
}
