# COMP4020 prototype

A COMP4020 prototype: a static site in HTML/CSS/TypeScript that builds to plain
HTML/CSS/JS and deploys to GitHub Pages. The deployed site is what gets marked,
not this repo.

This week it's Snake --- `game-logic.ts` is the whole game as pure functions,
`main.ts` is the canvas, the clock and the controls. Nothing week-specific
below this line.

## How to work in here

**Put the rules somewhere a test can reach without a browser.** Anything that
decides what happens --- collision, scoring, difficulty --- goes in a module
with no DOM, no `Math.random` and no `Date.now`, with the seed and the clock
passed in from the edge. It is the difference between a spec test that runs in
4ms and one that needs a headless browser, and it is what makes a "focused
automated test" on one rule a two-line assertion.

**Measure at both marking viewports; don't assert.** The site is marked live in
Chrome at 1920x1080 and 390x844, so "the arrow keys steer it" and "it fits on
a phone" are claims that need a real browser behind them, not a paragraph.
Drive the built `dist/` in headless Chromium, read the state back out of the
page, and look at the screenshots --- rendering bugs that every test misses are
visible in one frame. The keyboard path, the touch path, and a resize *during*
play are all part of what's marked, so all three get driven.

**A correction belongs in the harness, not in a retry.** When something slips
through, the move is a check that would have caught it --- a sensor in `spec/`
or a rule here --- not another prompt.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so the deployed head is the only place a broken one shows up.

## The checks

`pnpm check` runs them, and `pnpm check:evidence` is the extra gate before you
ship. CI runs the same plus links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

### Sensors (these travel; the contract tests don't)

`spec/sensors.test.ts` holds the standards that aren't about any one week's
brief, so it comes forward into the next repo along with this file:

- **no template placeholder copy ships.** The starter's fill-me-in strings
  render perfectly and pass every invariant; the only place they show up is a
  marker's screen.
- **the link-preview card resolves.** The shipped invariant checks the
  `og:image` is *named* and says outright that a path which doesn't resolve
  "shows up in the course gallery, not as a red check". This resolves it
  against the page that names it, which is the part `./card.png` gets wrong one
  directory down.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
