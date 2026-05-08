import { TRACK_KEYS, type TrackKey } from "./scenes/MenuScene";

export interface CameraState {
  z: number;
  x: number;
  y: number;
}

export type Route =
  | { kind: "menu" }
  | { kind: "inspect"; trackKey: TrackKey; camera?: CameraState };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) return pathname.slice(BASE.length);
  return pathname;
}

export function parseLocation(): Route {
  const path = stripBase(window.location.pathname).replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "inspect" && parts[1]) {
    const key = parts[1];
    if ((TRACK_KEYS as readonly string[]).includes(key)) {
      return { kind: "inspect", trackKey: key as TrackKey, camera: parseCamera() };
    }
  }
  return { kind: "menu" };
}

function parseCamera(): CameraState | undefined {
  const q = new URLSearchParams(window.location.search);
  const z = parseFloat(q.get("z") ?? "");
  const x = parseFloat(q.get("x") ?? "");
  const y = parseFloat(q.get("y") ?? "");
  if (!isFinite(z) || !isFinite(x) || !isFinite(y)) return undefined;
  return { z, x, y };
}

function inspectUrl(trackKey: TrackKey, cam?: CameraState): string {
  let url = `${BASE}/inspect/${trackKey}`;
  if (cam) {
    const q = new URLSearchParams({
      z: cam.z.toFixed(3),
      x: Math.round(cam.x).toString(),
      y: Math.round(cam.y).toString(),
    });
    url += `?${q.toString()}`;
  }
  return url;
}

export function writeInspect(trackKey: TrackKey, cam?: CameraState, replace = false): void {
  const url = inspectUrl(trackKey, cam);
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function writeMenu(replace = false): void {
  const url = `${BASE}/`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function onPopState(handler: (route: Route) => void): () => void {
  const fn = () => handler(parseLocation());
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}
