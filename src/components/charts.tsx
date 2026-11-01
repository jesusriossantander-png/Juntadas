import { useState } from 'react';
import { formatMoney } from '../lib/money';

/**
 * Gráfico de columnas de una sola serie (gasto por mes).
 * Un solo color (magnitud), extremos redondeados apoyados en la base,
 * etiquetas selectivas (máximo y último) y tooltip al tocar/pasar.
 */
export function MonthlyBars({ data }: { data: { key: string; label: string; total: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="faint small">Sin datos en este período.</p>;
  const W = 340, H = 170, padB = 22, padT = 18;
  const max = Math.max(...data.map((d) => d.total), 1);
  const step = W / data.length;
  const bw = Math.min(28, step * 0.62);
  const maxIdx = data.findIndex((d) => d.total === max);
  const shown = hover ?? null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gasto total por mes">
        <line x1="0" x2={W} y1={H - padB} y2={H - padB} stroke="var(--border)" strokeWidth="1" />
        {data.map((d, i) => {
          const h = ((H - padB - padT) * d.total) / max;
          const x = i * step + (step - bw) / 2;
          const y = H - padB - h;
          const r = Math.min(4, bw / 2, h);
          const label = i === maxIdx || i === data.length - 1 || i === shown;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
              <path d={`M${x},${H - padB} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - padB} Z`}
                fill="var(--ember)" opacity={shown == null || shown === i ? 1 : 0.45} />
              {label && h > 0 && <text className="val" x={x + bw / 2} y={y - 5} textAnchor="middle">{formatMoney(d.total).replace('$ ', '$')}</text>}
              {(data.length <= 8 || i % Math.ceil(data.length / 8) === 0) && <text x={x + bw / 2} y={H - 6} textAnchor="middle">{d.label}</text>}
              <title>{`${d.label}: ${formatMoney(d.total)} en ${d.count} ${d.count === 1 ? 'juntada' : 'juntadas'}`}</title>
            </g>
          );
        })}
      </svg>
      {shown != null && <p className="small center">{data[shown].label}: <b>{formatMoney(data[shown].total)}</b> · {data[shown].count} {data[shown].count === 1 ? 'juntada' : 'juntadas'}</p>}
      <details className="small">
        <summary className="faint" style={{ cursor: 'pointer' }}>Ver como tabla</summary>
        <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 0' }}>{d.label}</td><td className="num">{d.count}</td><td className="num" style={{ textAlign: 'right' }}>{formatMoney(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Barras horizontales de una serie, con el valor como texto al lado. */
export function HBars({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} className="stack" style={{ gap: 4 }} title={`${r.label}: ${format(r.value)}`}>
          <div className="row-between small"><span className="ellipsis">{r.label}</span><span className="num bold">{format(r.value)}{r.sub ? <span className="faint"> · {r.sub}</span> : null}</span></div>
          <div className="bar"><i style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
