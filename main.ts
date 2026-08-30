// Snake: the canvas, the clock and the controls. Every rule the game has
// lives in game-logic.ts; this file only measures time, reads input and
// draws. It is also where the no-tutorial rule is kept honest --- there is no
// start screen, no control legend and no text of any kind on the board. The
// snake is already moving when the page loads, the first food is already in
// front of it, and the wall is thirteen cells away.
import {
  createInitialState,
  setDirection,
  step,
  tickIntervalMs,
  type Direction,
  type GameState,
  type Point,
} from "./game-logic.ts";

function need<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const wrap = need<HTMLDivElement>("#board");
const canvas = need<HTMLCanvasElement>("#canvas");
const scoreEl = need<HTMLElement>("#score");
const context = canvas.getContext("2d");
if (!context) throw new Error("2d canvas context unavailable");
const ctx: CanvasRenderingContext2D = context;

// Blue-green against orange, and rounded squares against a circle: the two
// things on the board are told apart by hue, by lightness and by shape, so
// none of the common colour-vision deficiencies can collapse the pair.
const BOARD = "#0f1620";
const CHECKER = "#141d29";
const WALL = "#2b3a4d";
const BODY = "#28c8bd";
const HEAD = "#68efe4";
const HEAD_DEAD = "#ff5c6c";
const FOOD = "#ff9d3c";
const TEXT = "#e7edf5";
const MUTED = "#7c8798";

// Long enough that the final score registers before a mashed key skips it,
// short enough that it never reads as the game being stuck.
const RESTART_DELAY_MS = 550;
const SWIPE_MIN_PX = 18;
const MAX_FRAME_MS = 250; // a backgrounded tab must not bank a hundred ticks

const DIRECTION_KEYS: Record<string, Direction> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
};

const DIRECTION_VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const BEST_KEY = "snake-best-score";

// localStorage throws outright in some storage-blocked configurations, and
// this runs at module load: an uncaught throw here would kill the script
// before a single frame is drawn. Losing the best score is a fair trade;
// losing the game is not.
function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // storage unavailable --- the best score just won't outlive this tab
  }
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let state: GameState = createInitialState({ seed: Date.now() >>> 0 });
let best = readBest();
let endedAt: number | null = null;

// --- sizing -------------------------------------------------------------
// The grid is fixed; the pixels are not. The canvas is re-measured against
// its wrapper whenever the wrapper changes, which is what keeps a window
// dragged from 1920 to something narrower mid-run from tearing the board.

let side = 0;
let dpr = 1;

function measure(): void {
  const rect = wrap.getBoundingClientRect();
  const next = Math.max(160, Math.floor(Math.min(rect.width, rect.height)));
  const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
  if (next === side && nextDpr === dpr) return;
  side = next;
  dpr = nextDpr;
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);
}

new ResizeObserver(measure).observe(wrap);
window.addEventListener("resize", measure);
measure();

// --- input --------------------------------------------------------------

function restart(): void {
  state = createInitialState({ seed: Date.now() >>> 0 });
  endedAt = null;
  scoreEl.textContent = "0";
}

/** After an ending, the next input starts a new run --- but not instantly. */
function tryRestart(): void {
  if (endedAt === null || performance.now() - endedAt < RESTART_DELAY_MS) return;
  restart();
}

window.addEventListener(
  "keydown",
  (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const direction = DIRECTION_KEYS[event.key.toLowerCase()];
    if (state.status === "playing") {
      if (!direction) return;
      event.preventDefault(); // arrows and WASD steer; they never scroll
      state = setDirection(state, direction);
      return;
    }
    // Tab and Shift still have to move focus, or the page stops being
    // keyboard-navigable the moment a run ends.
    if (event.key === "Tab" || event.key === "Shift") return;
    event.preventDefault();
    tryRestart();
  },
  { passive: false },
);

// Pointer events cover mouse, pen and touch in one path, and they listen on
// the window rather than the canvas so a swipe that starts in the margin
// beside the board still steers --- on a 390px-wide phone that margin is a
// good part of the screen.
let pressed: Point | null = null;

window.addEventListener("pointerdown", (event) => {
  pressed = { x: event.clientX, y: event.clientY };
});

window.addEventListener("pointercancel", () => {
  pressed = null;
});

window.addEventListener("pointerup", (event) => {
  const start = pressed;
  pressed = null;
  if (!start) return;
  if (state.status !== "playing") {
    tryRestart();
    return;
  }
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return;
  const direction: Direction =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  state = setDirection(state, direction);
});

// --- loop ---------------------------------------------------------------

let previous: number | null = null;
let accumulated = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = previous === null ? 0 : Math.min(now - previous, MAX_FRAME_MS);
  previous = now;

  if (state.status === "playing") {
    accumulated += elapsed;
    // The interval is re-read every tick, because eating inside this loop is
    // what shortens it.
    while (state.status === "playing" && accumulated >= tickIntervalMs(state.score)) {
      accumulated -= tickIntervalMs(state.score);
      const before = state.score;
      state = step(state);
      if (state.score !== before) scoreEl.textContent = String(state.score);
      if (state.status !== "playing") {
        endedAt = now;
        accumulated = 0;
        if (state.score > best) {
          best = state.score;
          writeBest(best);
        }
      }
    }
  }

  render(now);
}

requestAnimationFrame(frame);

// --- drawing ------------------------------------------------------------

function render(now: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cell = side / state.gridSize;

  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, side, side);

  // A quiet checkerboard: enough to read distance across the board at a
  // glance, not enough to compete with the snake or the food.
  ctx.fillStyle = CHECKER;
  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = (y % 2 === 0 ? 0 : 1); x < state.gridSize; x += 2) {
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // The wall is the thing that kills you, so it gets drawn as a thing.
  ctx.strokeStyle = WALL;
  ctx.lineWidth = Math.max(2, cell * 0.08);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, side - ctx.lineWidth, side - ctx.lineWidth);

  drawFood(now, cell);
  drawSnake(cell);

  if (state.status !== "playing") drawEnding(cell);
}

function drawFood(now: number, cell: number): void {
  const pulse = reduceMotion ? 1 : 1 + 0.06 * Math.sin(now / 260);
  const radius = cell * 0.3 * pulse;
  const cx = (state.food.x + 0.5) * cell;
  const cy = (state.food.y + 0.5) * cell;
  ctx.fillStyle = FOOD;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnake(cell: number): void {
  const inset = Math.max(1, cell * 0.1);
  const radius = cell * 0.26;

  ctx.fillStyle = BODY;
  for (const part of state.snake) {
    ctx.beginPath();
    ctx.roundRect(part.x * cell + inset, part.y * cell + inset, cell - inset * 2, cell - inset * 2, radius);
    ctx.fill();
  }
  // The gaps between segments are bridged so the body reads as one animal
  // rather than a queue of tiles.
  for (let i = 1; i < state.snake.length; i += 1) {
    const a = state.snake[i - 1];
    const b = state.snake[i];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
    const midX = ((a.x + b.x) / 2 + 0.5) * cell;
    const midY = ((a.y + b.y) / 2 + 0.5) * cell;
    const thick = cell - inset * 2;
    // Wide enough to swallow both segments' corner radii. Anything narrower
    // leaves a waist at every joint, and the body reads as a row of separate
    // creatures rather than one snake --- which is exactly what the first
    // screenshot at 1920x1080 showed.
    const span = (inset + radius) * 2;
    if (a.y === b.y) ctx.fillRect(midX - span / 2, midY - thick / 2, span, thick);
    else ctx.fillRect(midX - thick / 2, midY - span / 2, thick, span);
  }

  drawHead(cell);
}

function drawHead(cell: number): void {
  const inset = Math.max(1, cell * 0.1);
  const radius = cell * 0.26;
  const head = state.snake[0];

  ctx.fillStyle = state.status === "playing" ? HEAD : HEAD_DEAD;
  ctx.beginPath();
  ctx.roundRect(head.x * cell + inset, head.y * cell + inset, cell - inset * 2, cell - inset * 2, radius);
  ctx.fill();

  // Eyes. Eight lines, and the difference between a moving square and
  // something a stranger reads as a snake inside the first second.
  const facing = DIRECTION_VECTOR[state.direction];
  const cx = (head.x + 0.5) * cell;
  const cy = (head.y + 0.5) * cell;
  ctx.fillStyle = BOARD;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      cx + facing.x * cell * 0.13 - facing.y * sign * cell * 0.16,
      cy + facing.y * cell * 0.13 + facing.x * sign * cell * 0.16,
      Math.max(1, cell * 0.085),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

// The ending is the score and nothing else. Anything that told the player how
// to start again would be the instruction this brief rules out --- and a
// player who has just been steering does not need telling.
function drawEnding(cell: number): void {
  // 0.86 buried the board so completely that the crash site was unreadable
  // --- the one thing a player wants from the frame after a death is to see
  // where it happened. Lighter, and the head is redrawn on top of it.
  ctx.fillStyle = "rgba(15, 22, 32, 0.7)";
  ctx.fillRect(0, 0, side, side);
  drawHead(cell);

  ctx.textAlign = "center";
  ctx.fillStyle = TEXT;
  ctx.font = `600 ${Math.round(cell * 2.6)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(state.score), side / 2, side / 2 + cell * 0.9);

  if (best > 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${Math.round(cell * 0.62)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(`best ${best}`, side / 2, side / 2 + cell * 2.3);
  }
}
