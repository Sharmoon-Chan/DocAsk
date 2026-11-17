/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0f172a",
          soft: "#475569",
          muted: "#64748b",
        },
        paper: "#f8fafc",
        sketch: "#e2e8f0",
        pencil: "#334155",
        accent: {
          DEFAULT: "#0f766e",
          hover: "#115e59",
          soft: "#f0fdfa",
          border: "#99f6e4",
        },
        verified: {
          DEFAULT: "#059669",
          soft: "#ecfdf5",
          border: "#a7f3d0",
        },
      },
      fontFamily: {
        sans: [
          '"Inter"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"Cascadia Code"',
          '"SFMono-Regular"',
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.03)",
        "card-hover": "0 6px 18px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 118, 110, 0.08)",
        doodle: "0 1px 3px rgba(15, 23, 42, 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "pop-in": "pop-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
