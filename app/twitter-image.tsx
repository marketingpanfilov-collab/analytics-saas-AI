import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#030303",
          color: "white",
          padding: "56px 64px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
          <div style={{ fontSize: 24, opacity: 0.8, marginBottom: 18 }}>BoardIQ</div>
          <div style={{ fontSize: 64, lineHeight: 1.08, fontWeight: 800, letterSpacing: -1 }}>
            Маркетинговая аналитика и DDA
          </div>
          <div style={{ marginTop: 24, fontSize: 30, lineHeight: 1.3, opacity: 0.85 }}>
            Прозрачные данные, атрибуция и рекомендации для роста.
          </div>
        </div>

        <div
          style={{
            width: 170,
            height: 170,
            borderRadius: 38,
            border: "1px solid rgba(255,255,255,0.24)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 58,
            fontWeight: 900,
            letterSpacing: 1,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          BIQ
        </div>
      </div>
    ),
    size
  );
}
