// The whole game, as a pure function. No DOM, no canvas, no `Math.random`,
// no `Date.now` --- every field of the next state is derived from the
// previous one and the seed it carries, so a vitest assertion and a browser
// frame run the identical game. main.ts owns the clock, the canvas and the
// initial seed; nothing in here reaches back out to any of them.

export interface Point {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";

/** "won" is the board-full finish --- see the note in `step`. */
export type GameStatus = "playing" | "lost" | "won";

export interface GameState {
  /** Head first: `snake[0]` is the cell the player is steering. */
  snake: Point[];
  /** The direction the head last actually moved. */
  direction: Direction;
  /** The buffered turn, applied by the next `step`. */
  pendingDirection: Direction;
  food: Point;
  score: number;
  status: GameStatus;
  gridSize: number;
  /** Advanced internally on every food spawn, so a seed replays a whole run. */
  seed: number;
}

export const DEFAULT_GRID_SIZE = 17;
const START_LENGTH = 3;

// A run opens at 180ms per cell and tightens by 3ms a point, bottoming out at
// 80ms. The floor is set by the slowest input the game has to respect: a
// swipe on a phone needs longer to land than a keypress does, and a game that
// stops accepting the phone's controls has stopped being playable at one of
// the two marking viewports. The difficulty past that point comes from the
// snake's own length, which is unbounded.
export const START_INTERVAL_MS = 180;
export const MIN_INTERVAL_MS = 80;
const INTERVAL_STEP_MS = 3;

/** Exported so the renderer and the tests share one difficulty curve. */
export function tickIntervalMs(score: number): number {
  return Math.max(MIN_INTERVAL_MS, START_INTERVAL_MS - score * INTERVAL_STEP_MS);
}

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// mulberry32, threaded through the state instead of closed over, so the
// generator is as pure as everything else here.
function nextRandom(seed: number): [value: number, nextSeed: number] {
  const nextSeed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(nextSeed ^ (nextSeed >>> 15), 1 | nextSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, nextSeed];
}

export function createInitialState(options: { gridSize?: number; seed?: number } = {}): GameState {
  const gridSize = Math.max(START_LENGTH + 4, Math.floor(options.gridSize ?? DEFAULT_GRID_SIZE));
  const row = Math.floor(gridSize / 2);

  // Three segments, hard against the left wall, already pointed right and
  // already moving. There is no start button and no words anywhere, so the
  // opening frame's only affordance is the motion itself.
  const snake: Point[] = [];
  for (let i = 0; i < START_LENGTH; i += 1) snake.push({ x: START_LENGTH - 1 - i, y: row });

  // The first food is placed in the snake's path rather than at random. It
  // means the first thing that happens --- before the player has touched
  // anything --- is the snake reaching food, growing a segment and scoring.
  // That eat is the tutorial: the second food lands somewhere off the line
  // and asks for the first steer, and the wall past it collects anyone who
  // didn't. Randomising this one would make the opening ten seconds a coin
  // flip on whether the game explains itself at all.
  const food: Point = { x: START_LENGTH + 3, y: row };

  return {
    snake,
    direction: "right",
    pendingDirection: "right",
    food,
    score: 0,
    status: "playing",
    gridSize,
    seed: (options.seed ?? 1) | 0,
  };
}

/**
 * Buffer a turn. At most one lands per tick, so a fast double-tap can't be
 * composed into a move the rules don't allow.
 */
export function setDirection(state: GameState, direction: Direction): GameState {
  if (state.status !== "playing") return state;
  // A 180deg turn drives the head into its own neck, which reads as the game
  // killing you for a fumbled keypress rather than for a bad move. It is
  // checked against the direction last *applied*, not the buffered one ---
  // otherwise right, then up, then left inside a single tick would leave
  // "left" buffered against a head still travelling right.
  if (state.snake.length > 1 && direction === OPPOSITE[state.direction]) return state;
  return { ...state, pendingDirection: direction };
}

/** One tick of the world. A no-op once play has ended. */
export function step(state: GameState): GameState {
  if (state.status !== "playing") return state;

  const direction = state.pendingDirection;
  const delta = DELTA[direction];
  const head: Point = { x: state.snake[0].x + delta.x, y: state.snake[0].y + delta.y };

  if (head.x < 0 || head.y < 0 || head.x >= state.gridSize || head.y >= state.gridSize) {
    return { ...state, direction, status: "lost" };
  }

  const eating = head.x === state.food.x && head.y === state.food.y;
  // The tail cell only counts as occupied when the snake is growing this
  // tick. Otherwise it has already moved on by the time the head arrives, and
  // chasing your own tail is legal play rather than a death.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((part) => part.x === head.x && part.y === head.y)) {
    return { ...state, direction, status: "lost" };
  }

  const snake = [head, ...body];
  if (!eating) return { ...state, snake, direction };

  const [food, seed] = spawnFood(snake, state.gridSize, state.seed);
  return {
    ...state,
    snake,
    direction,
    score: state.score + 1,
    // A full board leaves nowhere to put the next food. Nobody is filling 289
    // cells by hand, but a total function needs the branch, and "the board is
    // full" is a finish rather than a crash.
    status: food ? "playing" : "won",
    food: food ?? state.food,
    seed,
  };
}

function spawnFood(snake: Point[], gridSize: number, seed: number): [Point | null, number] {
  const taken = new Set(snake.map((part) => part.y * gridSize + part.x));
  const free: Point[] = [];
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      if (!taken.has(y * gridSize + x)) free.push({ x, y });
    }
  }
  if (free.length === 0) return [null, seed];
  const [value, nextSeed] = nextRandom(seed);
  return [free[Math.floor(value * free.length)], nextSeed];
}
