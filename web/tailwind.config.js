/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0058bc",
        "primary-container": "#0070eb",
        surface: "#f8f9fa",
        "surface-low": "#f3f4f5",
        "surface-high": "#e1e3e4",
        "on-surface": "#191c1d",
        "on-variant": "#414755",
        "outline-variant": "#c1c6d7",
        secondary: "#006e28",
        error: "#ba1a1a",
      },
      fontFamily: {
        headline: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
