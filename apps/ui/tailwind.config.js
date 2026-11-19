/** 디자인 토큰: Warm Deep Dark 팔레트 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Pretendard Variable", "Pretendard", "system-ui", "sans-serif"] },
      colors: {
        app: "#131F24", card: "#1B2B32", cardb: "#2A3F48", surface: "#20323A", surfb: "#37464F",
        t1: "#FFFFFF", t2: "#E2E8F0", t3: "#8B9EB0",
        green: { DEFAULT: "#58CC02", d: "#46A302" }, sky: { DEFAULT: "#1CB0F6", d: "#1899D6" },
        purple: { DEFAULT: "#CE82FF", d: "#A55EEA", bg: "#2D1F3D" }, gold: { DEFAULT: "#FFC800", d: "#E5A500" },
        red: { DEFAULT: "#FF4B4B", d: "#EA2B2B" }, orange: { DEFAULT: "#FF9600" }, pink: { DEFAULT: "#FF86D0" },
      },
    },
  },
  plugins: [],
};
