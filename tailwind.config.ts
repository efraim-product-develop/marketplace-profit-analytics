import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        mist: "#f4f7f8",
        ocean: "#087f8c",
        mango: "#f0a202",
        brick: "#c84630"
      },
      boxShadow: {
        panel: "0 18px 40px rgba(23, 32, 38, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
