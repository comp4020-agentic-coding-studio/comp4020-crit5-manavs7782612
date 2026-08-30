import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// SENSORS --- not this week's contract. These assert standards I want held
// whatever the brief is, so they travel to the next repo with CLAUDE.md
// rather than retiring with crit 5. Like the shipped invariants they run
// against the BUILT site, because what ships is what gets marked.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const pages = files()
  .map((path) => relative(DIST, path).split(sep).join("/"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({
    name,
    html: readFileSync(join(DIST, name), "utf8"),
    doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
  }));

// The template ships with copy whose whole job is to be replaced. Shipping it
// is silent: the page renders, every invariant stays green, and the only
// place it shows up is a marker's screen. Cheaper to catch here, once.
const PLACEHOLDERS = [
  "Replace this with",
  "Replace it and the",
  "COMP4020 prototype",
  "Your starter repo",
  "TEMPLATE:",
  "lorem ipsum",
];

describe("sensor: no template placeholder copy ships", () => {
  for (const { name, html, doc } of pages) {
    describe(name, () => {
      it("has none of the template's fill-me-in strings", () => {
        const found = PLACEHOLDERS.filter((phrase) =>
          html.toLowerCase().includes(phrase.toLowerCase()),
        );
        expect(found, `still carrying template copy: ${found.join(", ")}`).toEqual([]);
      });

      it("has a title and a description written for this site", () => {
        const description = doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content")
          ?.trim();
        expect(doc.title.trim().length).toBeGreaterThan(2);
        expect(description?.length ?? 0).toBeGreaterThan(20);
      });
    });
  }
});

// The shipped invariant checks the card is *named*, and says so: "whether the
// path resolves shows up in the gallery, not as a red check". That gap is
// real --- `./card.png` is correct from the root and wrong from any page one
// directory down, and nothing renders differently either way. Resolving it
// against the page that names it closes the gap without leaving the repo.
describe("sensor: the link-preview card resolves", () => {
  for (const { name, doc } of pages) {
    it(`${name}'s og:image points at a file that shipped`, () => {
      const card = doc.querySelector('meta[property="og:image"]')?.getAttribute("content")?.trim();
      expect(card, "no og:image to resolve").toBeTruthy();
      if (!card) return;
      if (/^(https?:)?\/\//i.test(card)) return; // absolute: only a fetch could check it

      const target = resolve(dirname(join(DIST, name)), card.split(/[?#]/)[0]);
      expect(
        target.startsWith(DIST) && existsSync(target),
        `${name} names ${card}, which resolves to ${relative(DIST, target)} --- not in dist/`,
      ).toBe(true);
    });
  }
});
