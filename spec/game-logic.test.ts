import { describe, expect, it } from "vitest";
import {
  createInitialState,
  MIN_INTERVAL_MS,
  setDirection,
  START_INTERVAL_MS,
  step,
  tickIntervalMs,
  type Direction,
  type GameState,
  type Point,
} from "../game-logic.ts";

// More crit-5 contract tests --- cheap ones, because the simulation is pure.
// They cover the three rules the crit's "one mechanic" actually consists of:
// eating grows and scores, a reversal into your own neck is refused rather
// than fatal, and the run gets faster as it goes. Like crit-5.test.ts these
// retire with the brief; they are not sensors.

// A deterministic autoplayer, so the tests below can drive the game deep
// enough to be worth asserting on. It re-derives "would this move kill me"
// from the same rules the module implements --- fine for a *driver*, since
// every assertion below is still made against what the module actually did.
const DIRECTIONS = ["up", "right", "down", "left"] as const;
const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function survivable(state: GameState, direction: Direction): boolean {
  const head = state.snake[0];
  const next = { x: head.x + DELTA[direction].x, y: head.y + DELTA[direction].y };
  if (next.x < 0 || next.y < 0 || next.x >= state.gridSize || next.y >= state.gridSize) return false;
  const eating = next.x === state.food.x && next.y === state.food.y;
  const body = eating ? state.snake : state.snake.slice(0, -1);
  return !body.some((part) => part.x === next.x && part.y === next.y);
}

/** The surviving move that gets closest to the food; ties break in DIRECTIONS order. */
function bestMove(state: GameState): Direction {
  const head = state.snake[0];
  const options = DIRECTIONS.filter((d) => survivable(state, d));
  const ranked = (options.length > 0 ? options : DIRECTIONS).map((d) => ({
    d,
    cost:
      Math.abs(head.x + DELTA[d].x - state.food.x) + Math.abs(head.y + DELTA[d].y - state.food.y),
  }));
  ranked.sort((a, b) => a.cost - b.cost);
  return ranked[0].d;
}

describe("eating", () => {
  it("grows the snake and scores, and the opening food is already in its path", () => {
    let state = createInitialState({ seed: 3 });
    const length = state.snake.length;
    const opening = state.food;

    // Straight ahead, no input at all: the first food is placed in the
    // snake's line on purpose, so the game demonstrates its own rule before
    // the player has touched a key.
    expect(opening.y).toBe(state.snake[0].y);
    expect(opening.x).toBeGreaterThan(state.snake[0].x);

    while (state.status === "playing" && state.score === 0) state = step(state);

    expect(state.score).toBe(1);
    expect(state.snake).toHaveLength(length + 1);
    expect(state.snake[0]).toEqual(opening);
    expect(state.food).not.toEqual(opening);
  });

  it("never puts new food underneath the snake, however long it gets", () => {
    let state = createInitialState({ seed: 11 });
    for (let i = 0; i < 400 && state.status === "playing"; i += 1) {
      state = step(setDirection(state, bestMove(state)));
      expect(state.snake.some((p) => p.x === state.food.x && p.y === state.food.y)).toBe(false);
    }
    // The autoplayer has to actually have eaten for the check above to mean
    // anything, so the run's depth is asserted too.
    expect(state.score).toBeGreaterThan(20);
  });

  it("advances its seed and moves the food around, rather than replaying one spot", () => {
    let state = createInitialState({ seed: 11 });
    const seeds = new Set([state.seed]);
    const cells = new Set([`${state.food.x},${state.food.y}`]);
    let score = 0;
    for (let i = 0; i < 400 && state.status === "playing"; i += 1) {
      state = step(setDirection(state, bestMove(state)));
      if (state.score !== score) {
        score = state.score;
        seeds.add(state.seed);
        cells.add(`${state.food.x},${state.food.y}`);
      }
    }
    expect(score).toBeGreaterThan(20);
    // A seed that failed to advance would hand back the same number forever:
    // every spawn would come off the same place in the free-cell list, and
    // the food would stop being a thing you have to go and find. Mutation
    // testing found this gap --- the suite was green against that bug.
    expect(seeds.size).toBe(score + 1);
    expect(cells.size).toBeGreaterThan(score * 0.7);
  });
});

describe("steering", () => {
  it("refuses a reversal into the snake's own neck", () => {
    const state = createInitialState({ seed: 3 }); // travelling right, 3 segments
    expect(setDirection(state, "left").pendingDirection).toBe("right");
    expect(step(setDirection(state, "left")).status).toBe("playing");
  });

  it("refuses one composed out of two turns inside a single tick", () => {
    // Right, then up, then left, all before the next step: "left" is still a
    // reversal of the direction the head is actually travelling.
    let state = createInitialState({ seed: 3 });
    state = setDirection(state, "up");
    state = setDirection(state, "left");
    expect(state.pendingDirection).toBe("up");
  });

  it("applies at most one buffered turn per tick", () => {
    let state = createInitialState({ seed: 3 });
    state = setDirection(setDirection(state, "up"), "down");
    expect(step(state).direction).toBe("down");
  });
});

describe("the difficulty curve", () => {
  it("starts where it says and tightens with the score", () => {
    expect(tickIntervalMs(0)).toBe(START_INTERVAL_MS);
    expect(tickIntervalMs(5)).toBeLessThan(tickIntervalMs(0));
  });

  it("never drops below the floor a swipe can still beat", () => {
    for (const score of [0, 10, 50, 500, 10_000]) {
      expect(tickIntervalMs(score)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    }
  });
});

describe("purity", () => {
  it("replays identically from the same seed, and differently from another", () => {
    const run = (seed: number): number[] => {
      let state = createInitialState({ seed });
      const trail: number[] = [];
      for (let i = 0; i < 150 && state.status === "playing"; i += 1) {
        state = step(setDirection(state, bestMove(state)));
        trail.push(state.food.x, state.food.y, state.score, state.snake.length);
      }
      return trail;
    };

    expect(run(1234)).toEqual(run(1234));
    expect(run(1234)).not.toEqual(run(9876));
  });

  it("leaves the state it was handed untouched", () => {
    let state = createInitialState({ seed: 5 });
    for (let i = 0; i < 30 && state.status === "playing"; i += 1) {
      const snapshot = structuredClone(state);
      const next = step(setDirection(state, bestMove(state)));
      expect(state).toEqual(snapshot); // the input state, not the returned one
      state = next;
    }
  });
});
