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
        // Base colors using CSS variables
        "base-100": "var(--base-100)",
        "base-200": "var(--base-200)",
        "base-300": "var(--base-300)",
        "base-content": "var(--base-content)",
        // Primary colors
        primary: "var(--primary-color)",
        "primary-hover": "var(--primary-hover)",
        secondary: "var(--secondary-color)",
        accent: "var(--accent-color)",
        neutral: "var(--neutral-color)",
        // Status colors
        info: "var(--info-color)",
        success: "var(--success-color)",
        warning: "var(--warning-color)",
        error: "var(--error-color)",
      },
      borderColor: {
        custom: "var(--border-color)",
      },
      backgroundColor: {
        "note-hover": "var(--note-hover-color)",
      },
      textColor: {
        "base-content": "var(--base-content)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
  safelist: ["border-custom overflow-y-scroll"],
}
