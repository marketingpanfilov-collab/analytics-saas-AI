"use client";

export default function DataHealthMini({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));

  // 3 зоны
  const red = "#ff5a5a";
  const yellow = "#ffb347";
  const green = "#3ddc97";

  // нейтральные цвета под dark
  const needleColor = "rgba(255,255,255,0.70)";
  const rimColor = "rgba(255,255,255,0.10)";
  const innerShade = "rgba(0,0,0,0.30)";
  const centerDot = "rgba(255,255,255,0.18)";

  // цвет процента
  const pctColor = v < 40 ? red : v < 70 ? yellow : green;

  // SVG геометрия
  const cx = 60;
  const cy = 58; // центр чуть ниже для полукруга
  const rOuter = 48;
  const thickness = 18; // на мой вкус: жирно, но не “плоско”
  const rInner = rOuter - thickness;

  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

  const polar = (angleDeg: number, radius: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const segmentPath = (startAngle: number, endAngle: number) => {
    // angles in degrees, e.g. -180..0
    const a0 = startAngle;
    const a1 = endAngle;

    const p0 = polar(a0, rOuter);
    const p1 = polar(a1, rOuter);
    const p2 = polar(a1, rInner);
    const p3 = polar(a0, rInner);

    return `
      M ${p0.x} ${p0.y}
      A ${rOuter} ${rOuter} 0 0 1 ${p1.x} ${p1.y}
      L ${p2.x} ${p2.y}
      A ${rInner} ${rInner} 0 0 0 ${p3.x} ${p3.y}
      Z
    `;
  };

  // стрелка (-180..0)
  const needleAngle = -180 + (v / 100) * 180;
  const needleLen = 38;
  const needleTip = polar(needleAngle, needleLen);

  // маленькая "тень" под секторами (приятнее в dark)
  const backdropPath = `
    M ${polar(-180, rOuter + 3).x} ${polar(-180, rOuter + 3).y}
    A ${rOuter + 3} ${rOuter + 3} 0 0 1 ${polar(0, rOuter + 3).x} ${polar(0, rOuter + 3).y}
    L ${polar(0, rInner - 6).x} ${polar(0, rInner - 6).y}
    A ${rInner - 6} ${rInner - 6} 0 0 0 ${polar(-180, rInner - 6).x} ${polar(-180, rInner - 6).y}
    Z
  `;

  // границы зон (могу менять на вкус позже)
  const aRed0 = -180;
  const aRed1 = -120;
  const aYel1 = -60;
  const aGre1 = 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 44,
        whiteSpace: "nowrap",
      }}
      title={`Качество данных: ${v}%`}
    >
      {/* текст + число */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 650,
            opacity: 0.75,
            lineHeight: "44px",
          }}
        >
          Качество данных:
        </span>

        <span
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: pctColor,
            lineHeight: "44px",
          }}
        >
          {clamp(v, 0, 100)}%
        </span>
      </div>

      {/* диаграмма */}
      <div style={{ display: "flex", alignItems: "center", height: 44 }}>
        <svg viewBox="0 0 120 80" width="70" height="40" aria-hidden="true">
          {/* подложка/тень */}
          <path d={backdropPath} fill="rgba(255,255,255,0.04)" />

          {/* внешний обод */}
          <path
            d="M 12 58 A 48 48 0 0 1 108 58"
            fill="none"
            stroke={rimColor}
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* сектора */}
          <path d={segmentPath(aRed0, aRed1)} fill={red} />
          <path d={segmentPath(aRed1, aYel1)} fill={yellow} />
          <path d={segmentPath(aYel1, aGre1)} fill={green} />

          {/* внутренний полукруг (аккуратный “провал”) */}
          <path
            d={`M ${polar(-180, rInner).x} ${polar(-180, rInner).y}
                A ${rInner} ${rInner} 0 0 1 ${polar(0, rInner).x} ${polar(0, rInner).y}`}
            fill="none"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="10"
            strokeLinecap="round"
            opacity={0.55}
          />

          {/* стрелка */}
          <line
            x1={cx}
            y1={cy}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke={needleColor}
            strokeWidth="5"
            strokeLinecap="round"
          />

          {/* центр */}
          <circle cx={cx} cy={cy} r="10" fill={innerShade} />
          <circle cx={cx} cy={cy} r="6" fill={centerDot} />

          {/* маленькое кольцо в центре (чуть “премиум”) */}
          <circle cx={cx} cy={cy} r="10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  );
}