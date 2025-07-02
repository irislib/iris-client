export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        "theme-xl": "4px 20px 40px 1px var(--shadow-color)",
      },
      colors: {
        "custom-purple": "#34216c",
        "custom-violet": "#28246b",
        "custom-accent": "#db8216",
      },
      borderColor: {
        custom: "var(--border-color)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
  safelist: ["border-custom overflow-y-scroll"],
}
