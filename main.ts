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

// Blue-green against orange, and rounded squares against a circle: hue and
// shape both separate the two things on the board, so no common colour-vision
// deficiency can collapse the pair. Lightness had to be measured to be true
// of it --- the first pass put body and food at 1.01:1 against each other,
// identical to a greyscale eye, while the comment claimed otherwise. Against
// the board they now rank body 4.6 : food 8.0 : head 13.0, which is 1.7:1
// body-to-food and 1.6:1 food-to-head. The wall went up too: it is the only
// thing that kills you, and at 1.6:1 it was the faintest mark on the board.
const BOARD = "#0f1620";
const CHECKER = "#141d29";
const WALL = "#43586f";
const BODY = "#1b8f88";
const HEAD = "#68efe4";
const HEAD_DEAD = "#ff5c6c";
const FOOD = "#f79433";
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

// The snake the *rules* see moves in whole-cell jumps every tick; the snake
// the *player* sees is interpolated from this toward `state.snake` each
// frame, which is what turns an 80ms-at-top-speed jump into a glide.
// `prevSnake` is a snapshot from immediately before the most recent tick, and
// `grewLastTick` records whether that tick ate --- the one case where the
// interpolated array needs an extra, stationary segment (see
// `interpolatedSnake`).
let prevSnake: Point[] = state.snake;
let grewLastTick = false;

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
  prevSnake = state.snake;
  grewLastTick = false;
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
    // Tab and Shift still have to move focus, and Enter and Space still
    // belong to whatever holds it --- hijack those and the page's only
    // keyboard-reachable control goes inert the moment a run ends.
    if (event.key === "Tab" || event.key === "Shift") return;
    if ((event.key === "Enter" || event.key === " ") && focusIsInteractive()) return;
    event.preventDefault();
    tryRestart();
  },
  { passive: false },
);

// Pointer events cover mouse, pen and touch in one path, and they listen on
// the window rather than the canvas so a swipe that starts in the margin
// beside the board still steers --- on a 390px-wide phone that margin is a
// good part of the screen.
function focusIsInteractive(): boolean {
  const active = document.activeElement;
  return (
    active instanceof Element &&
    active !== document.body &&
    active.closest("a[href], button, input, select, textarea") !== null
  );
}

// Every pointer keeps its own origin. A single shared one measured whichever
// finger lifted against whichever finger pressed last, so a thumb resting on
// the glass --- the normal grip on a 390px phone --- turned the next lift into
// a swipe nobody made. Owning the gesture with the first finger instead would
// fix that but wedge all input if a release ever went missing; a map per
// pointer id does neither.
const gestures = new Map<number, Point>();

window.addEventListener("pointerdown", (event) => {
  gestures.set(event.pointerId, { x: event.clientX, y: event.clientY });
});

window.addEventListener("pointercancel", (event) => {
  gestures.delete(event.pointerId);
});

window.addEventListener("pointerup", (event) => {
  const start = gestures.get(event.pointerId);
  gestures.delete(event.pointerId);
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
      const beforeSnake = state.snake;
      state = step(state);
      prevSnake = beforeSnake;
      grewLastTick = state.score !== before;
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
  // Reduced motion snaps straight to the ruleset's own positions; otherwise
  // draw the point in the current tick that `accumulated` has reached.
  const t =
    state.status === "playing" && !reduceMotion
      ? Math.min(1, accumulated / tickIntervalMs(state.score))
      : 1;
  drawSnake(cell, interpolatedSnake(t));

  if (state.status !== "playing") drawEnding(cell);
}

/**
 * Where the snake is `t` of the way from the last tick to the next one.
 * Every body segment slides toward the cell the segment ahead of it
 * occupied before this tick --- follow-the-leader, the same rule that keeps
 * the grid-snapped snake's segments adjacent --- and the head slides toward
 * wherever `step` actually moved it. A tick that ate leaves the old tail
 * segment cloned in place (it doesn't move this tick, so no interpolation is
 * needed) rather than dropped, which is what growth looks like.
 */
function interpolatedSnake(t: number): Point[] {
  if (t >= 1) return state.snake;
  const out: Point[] = new Array(prevSnake.length);
  for (let i = 0; i < prevSnake.length; i += 1) {
    const from = prevSnake[i];
    const to = i === 0 ? state.snake[0] : prevSnake[i - 1];
    out[i] = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  if (grewLastTick) out.push(state.snake[state.snake.length - 1]);
  return out;
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

function drawSnake(cell: number, snake: Point[]): void {
  const inset = Math.max(1, cell * 0.1);
  const radius = cell * 0.26;
  const thick = cell - inset * 2;

  ctx.fillStyle = BODY;
  for (const part of snake) {
    ctx.beginPath();
    ctx.roundRect(part.x * cell + inset, part.y * cell + inset, thick, thick, radius);
    ctx.fill();
  }
  // The gaps between segments are bridged so the body reads as one animal
  // rather than a queue of tiles. A round-capped stroke between segment
  // centres does that at any angle, not just axis-aligned ones: while two
  // segments are mid-slide around a corner they're briefly closer than a
  // full cell apart, and a straight-line bridge still meets both of them
  // with no seam, where the old fixed-orientation rect would gap.
  ctx.strokeStyle = BODY;
  ctx.lineCap = "round";
  ctx.lineWidth = thick;
  for (let i = 1; i < snake.length; i += 1) {
    const a = snake[i - 1];
    const b = snake[i];
    ctx.beginPath();
    ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
    ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
    ctx.stroke();
  }

  drawHead(cell, snake);
}

function drawHead(cell: number, snake: Point[]): void {
  const inset = Math.max(1, cell * 0.1);
  const radius = cell * 0.26;
  const head = snake[0];

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
  drawHead(cell, state.snake);

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
