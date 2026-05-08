import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "scripts/gen-tracks.mjs");
const SCRIPTS_DIR = resolve(__dirname, "scripts");

function regenerateTracks(): Plugin {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let pending = false;

  const run = () => {
    if (running) { pending = true; return; }
    running = true;
    const t0 = Date.now();
    const p = spawn(process.execPath, [SCRIPT], { stdio: "inherit" });
    p.on("close", (code) => {
      running = false;
      if (code === 0) console.log(`[gen-tracks] regenerated in ${Date.now() - t0}ms`);
      else console.warn(`[gen-tracks] exit code ${code}`);
      if (pending) { pending = false; run(); }
    });
  };

  return {
    name: "regenerate-tracks",
    apply: "serve",
    configureServer(server) {
      const onChange = (path: string) => {
        if (!path.endsWith(".mjs")) return;
        if (!path.startsWith(SCRIPTS_DIR)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, 50);
      };
      server.watcher.add(SCRIPTS_DIR);
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
    },
  };
}

export default defineConfig(({ command }) => ({
  server: { port: 5273, strictPort: true, open: true },
  build: { target: "es2022" },
  base: command === "build" ? "/f1re/" : "/",
  plugins: [regenerateTracks()],
}));
