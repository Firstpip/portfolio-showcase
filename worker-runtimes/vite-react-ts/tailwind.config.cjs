/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#0F172A", foreground: "#FFFFFF" },
        secondary: { DEFAULT: "#64748B", foreground: "#FFFFFF" },
        surface: "#FFFFFF",
        text: "#0F172A",
      },
      borderRadius: {
        DEFAULT: "12px",
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
