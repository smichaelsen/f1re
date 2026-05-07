import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  server: { port: 5273, strictPort: true, open: true },
  build: { target: "es2022" },
  base: command === "build" ? "/f1re/" : "/",
}));
