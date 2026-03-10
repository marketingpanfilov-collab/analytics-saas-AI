/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./app/**/*.{js,ts,jsx,tsx,mdx}",
      "./components/**/*.{js,ts,jsx,tsx,mdx}",
      "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
      extend: {
        colors: {
          // основной mint-акцент
          accent: "rgba(150,255,200,0.95)",
  
          // вариации, чтобы интерфейс не был “плоским”
          accentSoft: "rgba(150,255,200,0.22)",
          accentMid: "rgba(90,255,190,0.55)",
          accentDeep: "rgba(90,255,190,0.85)",
  
          // холодный контраст (как у тебя в фоне)
          blueSoft: "rgba(90,120,255,0.22)",
          blueMid: "rgba(90,120,255,0.35)",
  
          stroke: "rgba(255,255,255,0.08)",
        },
        boxShadow: {
          soft: "0 20px 70px rgba(0,0,0,0.55)",
          glow: "0 0 48px rgba(150, 255, 200, 0.22)",
          glowStrong: "0 0 72px rgba(150, 255, 200, 0.28)",
        },
        borderRadius: {
          xl2: "1.25rem",
        },
      },
    },
    plugins: [],
  };