import { describe, expect, it } from "vitest";
import { createInitialState, setDirection, step, type GameState } from "../game-logic.ts";

// crit-5 "A game" spec --- https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/
//
// Most of this week's spec is judged at the crit, not tested: the no-tutorial
// rule ("no instructions anywhere, on screen or off"), the five-minute
// pickup-and-play test, and the process/reflection evidence in PROCESS.md and
// reflections/crit-5.md. This file covers the one line that's mechanically
// checkable: "it can be lost: a wrong move is possible, and play ends
// somewhere --- a win, a loss or a finish."
//
// These are CONTRACT tests: they assert that a wrong move ends play, not how
// the simulation is written. A rewrite that kept the rules would keep them
// green. They retire with this brief.

/** Steps until play ends or the budget runs out, so a bug can't hang the run. */
function playOut(state: GameState, maxTicks = 500): GameState {
  let current = state;
  for (let i = 0; i < maxTicks && current.status === "playing"; i += 1) current = step(current);
  return current;
}

describe("crit-5: the game can be lost", () => {
  it("has a reachable ending --- a win, a loss, or a finish", () => {
    // The snake opens facing the right-hand wall and nothing steers it away.
    // Doing nothing is itself the wrong move, which is the point.
    const ended = playOut(createInitialState({ seed: 7 }));

    expect(ended.status).not.toBe("playing");
    expect(ended.status).toBe("lost");
  });

  it("ends on the wall in the other direction too, so it isn't one hard-coded edge", () => {
    const ended = playOut(setDirection(createInitialState({ seed: 7 }), "up"));

    expect(ended.status).toBe("lost");
  });

  it("ends when the snake runs into itself, not only into the wall", () => {
    // A snake curled back on its own body, well inside the board. The cell
    // below the head is not the tail, so nothing vacates it in time.
    const state: GameState = {
      ...createInitialState({ seed: 7 }),
      snake: [
        { x: 8, y: 8 },
        { x: 7, y: 8 },
        { x: 6, y: 8 },
        { x: 6, y: 9 },
        { x: 7, y: 9 },
        { x: 8, y: 9 },
        { x: 9, y: 9 },
        { x: 10, y: 9 },
      ],
      direction: "right",
      pendingDirection: "right",
      food: { x: 1, y: 1 },
    };

    const ended = step(setDirection(state, "down"));

    expect(ended.status).toBe("lost");
    expect(ended.direction).toBe("down");
    // The head was at (8, 8) on a 17x17 board, seven cells clear of every
    // edge: whatever ended this run, it was not a wall.
    expect(ended.snake[0]).toEqual({ x: 8, y: 8 });
  });

  it("stays ended once it has ended --- play concludes somewhere", () => {
    const ended = playOut(createInitialState({ seed: 7 }));
    const after = step(step(ended));

    expect(after).toEqual(ended);
  });
});
