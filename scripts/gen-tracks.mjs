import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import oval from "./tracks/oval.mjs";
import stadium from "./tracks/stadium.mjs";
import templeOfSpeed from "./tracks/temple-of-speed.mjs";
import championsWall from "./tracks/champions-wall.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outDir = join(__dirname, "..", "public", "tracks");
mkdirSync(outDir, { recursive: true });

const tracks = [oval, stadium, templeOfSpeed, championsWall];

for (const t of tracks) {
  const path = join(outDir, t.file);
  writeFileSync(path, JSON.stringify(t.data, null, 2));
  console.log(`wrote ${path} (${t.data.centerline.length} points)`);
}
