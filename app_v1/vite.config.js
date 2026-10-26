// React の「島」をビルドして public/js/ に出す設定。
// 既存の EJS・Express はそのまま。EJS の中の <div id="..."> に React を差し込む形で、
// 画面を1つずつ移していく（ADR-0023）。
//
//   npm run build   … 1回ビルドする
//   npm run dev     … 変更を監視して作り直す（別の端末で npm start と並べて使う）
//
// 出力先は public/ なので、Express の express.static がそのまま配信する。
// ファイル名は固定（js/app.js）。EJS から決め打ちで読み込むため、ハッシュを付けない。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // public/ は Express が配信する場所であって Vite の「そのままコピーする置き場」ではない。
  // 既定のままだと outDir と同じになって警告が出るので切っておく
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: false, // public/ には css や favicon があるので消さない
    rollupOptions: {
      input: "src/main.jsx",
      output: {
        entryFileNames: "js/app.js",
        chunkFileNames: "js/[name].js",
        assetFileNames: "js/[name][extname]",
      },
    },
  },
});
