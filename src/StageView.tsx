import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clampRectToCanvas, clientToView } from './geometry';
import type { SceneResult, VerdictStatus } from './geometry';

const STATUS_FILL: Record<VerdictStatus, string> = {
  safe: 'rgba(56, 189, 248, 0.30)',
  touching: 'rgba(245, 158, 11, 0.40)',
  occluding: 'rgba(239, 68, 68, 0.40)',
};

const STATUS_STROKE: Record<VerdictStatus, string> = {
  safe: '#38bdf8',
  touching: '#f59e0b',
  occluding: '#ef4444',
};

const STATUS_TEXT: Record<VerdictStatus, string> = {
  safe: '安全',
  touching: '接触边界',
  occluding: '真实遮挡',
};

export interface SafeZonePosition {
  x: number;
  y: number;
}

interface StageViewProps {
  result: SceneResult;
  /** 调整模式：安全区渲染为可拖拽矩形 */
  adjusting?: boolean;
  /** 拖动过程中每次移动回调（已换算、取整并钳制在画布内） */
  onSafeZoneDrag?: (pos: SafeZonePosition) => void;
  /** 松开指针回调，携带最终候选坐标 */
  onSafeZoneDragEnd?: (pos: SafeZonePosition) => void;
  /** 浏览器取消指针事件（pointercancel）时回调，用于回退 */
  onSafeZoneDragCancel?: () => void;
}

/** 一次拖拽的上下文：指针 id 与按下点相对安全区左上角的视图偏移 */
interface DragState {
  pointerId: number;
  grabDX: number;
  grabDY: number;
}

/**
 * 画布可视化：绿色虚线为安全区；遮挡矩形按判定结果着色——
 * 蓝色=安全、琥珀色=接触边界、红色=真实遮挡，真实遮挡的交叠区域以深红标出。
 * 调整模式下安全区可拖拽：指针坐标按视图比例换算、取整并钳制在画布内。
 */
export default function StageView({
  result,
  adjusting = false,
  onSafeZoneDrag,
  onSafeZoneDragEnd,
  onSafeZoneDragCancel,
}: StageViewProps) {
  const { canvas, safeZone } = result.scene;
  const fontSize = Math.max(12, Math.round(Math.max(canvas.width, canvas.height) / 48));
  const dragRef = useRef<DragState | null>(null);

  const toView = (e: ReactPointerEvent<SVGGElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return null;
    return clientToView(e.clientX, e.clientY, svg.getBoundingClientRect(), canvas);
  };

  /** 由当前指针位置推出安全区左上角候选坐标（取整 + 四边钳制）。 */
  const dragPosition = (e: ReactPointerEvent<SVGGElement>): SafeZonePosition | null => {
    const drag = dragRef.current;
    const point = toView(e);
    if (!drag || !point) return null;
    return clampRectToCanvas(
      point.x - drag.grabDX,
      point.y - drag.grabDY,
      safeZone.width,
      safeZone.height,
      canvas,
    );
  };

  const handlePointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    if (!adjusting || !onSafeZoneDrag) return;
    const point = toView(e);
    if (!point) return;
    dragRef.current = {
      pointerId: e.pointerId,
      grabDX: point.x - safeZone.x,
      grabDY: point.y - safeZone.y,
    };
    // 捕获指针，保证移出矩形后仍能收到 move/up/cancel
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    const pos = dragPosition(e);
    if (pos) onSafeZoneDrag?.(pos);
  };

  const handlePointerUp = (e: ReactPointerEvent<SVGGElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    const pos = dragPosition(e);
    dragRef.current = null;
    // 未移动时 pos 即原位置，写回同样的合法坐标，无副作用
    if (pos) onSafeZoneDragEnd?.(pos);
  };

  const handlePointerCancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onSafeZoneDragCancel?.();
  };

  return (
    <figure className="stage">
      <svg
        data-testid="stage"
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        role="img"
        aria-label="安全区核验画布"
      >
        <rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          fill="#0b1020"
          stroke="#94a3b8"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <g
          data-testid="safe-zone-rect"
          className={adjusting ? 'safe-zone draggable' : 'safe-zone'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <rect
            x={safeZone.x}
            y={safeZone.y}
            width={safeZone.width}
            height={safeZone.height}
            fill="rgba(34, 197, 94, 0.12)"
            stroke="#22c55e"
            strokeWidth={2}
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
          />
          <text x={safeZone.x + 8} y={safeZone.y + fontSize + 6} fill="#22c55e" fontSize={fontSize}>
            {safeZone.name}
          </text>
        </g>
        {result.verdicts.map((verdict) => (
          <g key={verdict.name}>
            <rect
              x={verdict.rect.x}
              y={verdict.rect.y}
              width={verdict.rect.width}
              height={verdict.rect.height}
              fill={STATUS_FILL[verdict.status]}
              stroke={STATUS_STROKE[verdict.status]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={verdict.rect.x + 6}
              y={verdict.rect.y + fontSize + 4}
              fill={STATUS_STROKE[verdict.status]}
              fontSize={fontSize}
            >
              {verdict.name}
            </text>
          </g>
        ))}
        {result.verdicts
          .filter((verdict) => verdict.status === 'occluding')
          .map((verdict) => (
            <rect
              key={`overlap-${verdict.name}`}
              x={Math.max(safeZone.x, verdict.rect.x)}
              y={Math.max(safeZone.y, verdict.rect.y)}
              width={verdict.overlapWidth}
              height={verdict.overlapHeight}
              fill="rgba(153, 27, 27, 0.85)"
              stroke="#fecaca"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </svg>
      <figcaption className="legend">
        <span>
          <i className="chip" style={{ background: STATUS_FILL.safe, borderColor: STATUS_STROKE.safe }} />
          {STATUS_TEXT.safe}
        </span>
        <span>
          <i
            className="chip"
            style={{ background: STATUS_FILL.touching, borderColor: STATUS_STROKE.touching }}
          />
          {STATUS_TEXT.touching}
        </span>
        <span>
          <i
            className="chip"
            style={{ background: STATUS_FILL.occluding, borderColor: STATUS_STROKE.occluding }}
          />
          {STATUS_TEXT.occluding}
        </span>
        <span>
          <i className="chip chip-overlap" />
          交叠区域
        </span>
      </figcaption>
    </figure>
  );
}
