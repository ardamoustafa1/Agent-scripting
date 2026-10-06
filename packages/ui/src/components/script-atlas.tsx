import { useId } from 'react';
import { useTranslation } from 'react-i18next';

/** Vector script atlas: deterministic, GPU-independent and controlled by the entry motion switch. */
export function ScriptAtlas({ paused }: { readonly paused: boolean }) {
  const { t } = useTranslation();
  const id = useId().replaceAll(':', '');
  const flowId = `entry-flow-${id}`,
    haloId = `entry-halo-${id}`;
  const branches = [
    'M 90 220 C 200 220 220 92 350 92 S 500 220 610 220',
    'M 90 220 C 230 220 225 220 350 220 S 480 220 610 220',
    'M 90 220 C 200 220 220 348 350 348 S 500 220 610 220',
  ];
  return (
    <div
      className="vb-script-atlas dw-sculpture"
      aria-hidden="true"
      data-motion={paused ? 'paused' : 'running'}
    >
      <div className="vb-script-atlas-fallback dw-sculpture-fallback">
        <svg viewBox="0 0 700 440" fill="none">
          <defs>
            <linearGradient
              id={flowId}
              x1="90"
              y1="220"
              x2="610"
              y2="220"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--vb-entry-metal)" />
              <stop offset="0.5" stopColor="var(--vb-entry-white)" />
              <stop offset="1" stopColor="var(--vb-entry-signal)" />
            </linearGradient>
            <radialGradient id={haloId}>
              <stop stopColor="var(--vb-entry-metal)" stopOpacity="0.13" />
              <stop offset="1" stopColor="var(--vb-entry-metal)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="350" cy="220" rx="300" ry="215" fill={`url(#${haloId})`} />
          <g className="dw-atlas-grid" stroke="var(--vb-entry-night-line)" strokeOpacity="0.4">
            {[92, 156, 220, 284, 348].map((y) => (
              <path key={y} d={`M 25 ${y} H 675`} />
            ))}
            {[90, 220, 350, 480, 610].map((x) => (
              <path key={x} d={`M ${x} 40 V 400`} />
            ))}
          </g>
          {branches.map((d, index) => (
            <g key={d}>
              {Array.from({ length: 13 }, (_, line) => (
                <path
                  key={line}
                  d={d}
                  transform={`translate(0,${(line - 6) * 2.8})`}
                  stroke={`url(#${flowId})`}
                  strokeOpacity={0.12 + (6 - Math.abs(line - 6)) * 0.035}
                  strokeWidth="0.8"
                />
              ))}
              <path
                d={d}
                className="vb-atlas-packet dw-atlas-packet"
                style={{ animationDelay: `${index * -3}s` }}
                stroke={`url(#${flowId})`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="34 700"
              />
            </g>
          ))}
          <g className="dw-atlas-start">
            <rect
              x="61"
              y="191"
              width="58"
              height="58"
              rx="18"
              fill="var(--vb-entry-panel)"
              stroke="var(--vb-entry-metal)"
              strokeOpacity="0.65"
            />
            <path
              d="M 78 212 L 90 205 L 102 212 L 90 219 Z M 78 221 L 90 228 L 102 221 M 78 229 L 90 236 L 102 229"
              stroke="var(--vb-entry-paper)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </g>
          {[92, 220, 348].map((y, index) => (
            <g key={y}>
              <rect
                x="329"
                y={y - 21}
                width="42"
                height="42"
                rx={index === 1 ? 12 : 21}
                fill="var(--vb-entry-panel)"
                stroke="var(--vb-entry-metal)"
                strokeOpacity="0.6"
              />
              {index === 1 ? (
                <path
                  d="M 350 209 L 361 220 L 350 231 L 339 220 Z"
                  stroke="var(--vb-entry-paper)"
                />
              ) : (
                <circle cx="350" cy={y} r="5" fill="var(--vb-entry-signal)" />
              )}
            </g>
          ))}
          <rect
            x="581"
            y="191"
            width="58"
            height="58"
            rx="18"
            fill="var(--vb-entry-panel)"
            stroke="var(--vb-entry-signal)"
            strokeOpacity="0.75"
          />
          <path
            d="M 598 220 L 607 229 L 623 212"
            stroke="var(--vb-entry-signal)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g fill="var(--vb-entry-soft)" fontSize="12" fontFamily="inherit" textAnchor="middle">
            <text x="90" y="278">
              {t('common.access.loginFlowWelcome')}
            </text>
            <text x="350" y="58">
              {t('common.access.loginCapabilityFlow')}
            </text>
            <text x="350" y="265">
              {t('common.access.loginFlowDecision')}
            </text>
            <text x="350" y="398">
              {t('common.access.loginFlowPersonal')}
            </text>
            <text x="610" y="278">
              {t('common.access.loginFlowResolution')}
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
