/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // "Civic ink" — deep petrol-teal instead of default corporate blue
        primary: "#0d5c63",
        "primary-container": "#12868f",
        // warm paper surfaces, not cold grey
        surface: "#f5f4f0",
        "surface-low": "#efeee8",
        "surface-high": "#e2e0d6",
        "on-surface": "#1a1c1a",
        "on-variant": "#565750",
        "outline-variant": "#d6d3c7",
        secondary: "#1f7a4d",
        error: "#c0362c",
        accent: "#c2703d",
      },
      fontFamily: {
        headline: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1.15rem",
        "3xl": "1.6rem",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(26,28,26,0.04), 0 1px 8px rgba(26,28,26,0.03)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
