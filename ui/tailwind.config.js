/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./preview.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sakura: {
          50: "#FFF3F7",
          100: "#FFE4EE",
          200: "#FFC9DC",
          300: "#FFA6C4",
          400: "#FB80A9",
          500: "#F55F8E",
          600: "#E0447A",
          700: "#C23362",
        },
        mint: {
          50: "#F0FBF5",
          100: "#DCF5E8",
          200: "#B4EAD1",
          300: "#82D8B4",
          400: "#4BBF92",
          500: "#27A97B",
          600: "#1D8A66",
          700: "#176D51",
        },
        ink: {
          DEFAULT: "#2b2724",
          soft: "#7a746d",
        },
        paper: "#faf7f2",
        sketch: "#e7e1d8",
        pencil: "#4a453f",
        accent: "#3b6ea5",
      },
      fontFamily: {
        round: [
          '"Nunito"',
          '"Baloo 2"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        doodle: "1.125rem 1.375rem 1rem 1.375rem / 1.375rem 1rem 1.375rem 1.125rem",
      },
      boxShadow: {
        doodle: "4px 4px 0 0 rgba(43, 39, 36, 0.10)",
        "doodle-sm": "2.5px 2.5px 0 0 rgba(43, 39, 36, 0.08)",
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fadeIn': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slideIn': {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'bling': {
          '0%, 100%': {
            opacity: '1',
            boxShadow: '0 0 0 rgba(43, 39, 36, 0)',
          },
          '50%': {
            opacity: '0.85',
            boxShadow: '0 0 8px rgba(43, 39, 36, 0.25)',
          },
        },
        'shimmer': {
          '0%': {
            opacity: '0.7',
            textShadow: '0 0 4px rgba(43, 39, 36, 0.3)',
          },
          '50%': {
            opacity: '1',
            textShadow: '0 0 8px rgba(43, 39, 36, 0.5), 0 0 12px rgba(43, 39, 36, 0.3)',
          },
          '100%': {
            opacity: '0.7',
            textShadow: '0 0 4px rgba(43, 39, 36, 0.3)',
          },
        },
        'pop-in': {
          '0%': { opacity: '0', translate: '0 8px', scale: '0.97' },
          '60%': { opacity: '1', translate: '0 -2px', scale: '1.01' },
          '100%': { opacity: '1', translate: '0 0', scale: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'fadeIn': 'fadeIn 0.3s ease-out',
        'slideIn': 'slideIn 0.4s ease-out',
        'spin-slow': 'spin-slow 2s linear infinite',
        'bling': 'bling 1.5s ease-in-out infinite',
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'pop-in': 'pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },
    },
  },
  plugins: [],
};
