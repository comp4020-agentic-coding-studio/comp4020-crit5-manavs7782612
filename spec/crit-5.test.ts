import { describe, expect, it } from "vitest";

// crit-5 "A game" spec — https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/
//
// Most of this week's spec is judged at the crit, not tested: the no-tutorial
// rule ("no instructions anywhere, on screen or off"), the five-minute
// pickup-and-play test, and the process/reflection evidence in PROCESS.md and
// reflections/crit-5.md. This file covers the one line that's mechanically
// checkable: "it can be lost: a wrong move is possible, and play ends
// somewhere — a win, a loss or a finish."
//
// This is a contract test, not an implementation test: it asserts that SOME
// reachable sequence of play ends the game, however the game represents that
// state internally. Import your game's own module below once it exists.

describe("crit-5: the game can be lost", () => {
  it("has a reachable ending — a win, a loss, or a finish", async () => {
    // Replace this with an import from your own game logic module, and drive
    // it through whatever sequence of moves reaches a losing/winning state in
    // your design. Keep the assertion about the CONTRACT (an ending is
    // reachable), not about how you represent it internally.
    expect.fail(
      "no game module wired up yet — import your game logic and assert a losing/winning move ends play",
    );
  });
});
