// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it, vi } from "vitest";
import { Coffee, Drum, Music2 } from "lucide-react";

const hooks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
const importers = vi.hoisted(() => ({
  coffee: vi.fn(),
  guitar: vi.fn(),
  drum: vi.fn(),
}));
vi.mock("lucide-react/dynamicIconImports.js", () => ({ default: importers }));
vi.mock("react", async (original) => ({
  ...(await original<object>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.cells)) hooks.cells[index] = initial;
    return [
      hooks.cells[index],
      (value: unknown) => {
        hooks.cells[index] = value;
      },
    ];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.index++;
    const old = hooks.cells[index];
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
      hooks.effects.push(() => {
        old?.cleanup?.();
        hooks.cells[index] = { deps, cleanup: effect() };
      });
    }
  },
}));
import { PlaylistIcon } from "./PlaylistIcon";

function render(name: string) {
  hooks.index = 0;
  const result = PlaylistIcon({ name, size: 24 });
  for (const effect of hooks.effects.splice(0)) effect();
  return result;
}
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

it("loads icons, caches successes, falls back on failure, and ignores stale completions", async () => {
  importers.coffee.mockResolvedValue({ default: Coffee });
  importers.guitar.mockRejectedValue(new Error("offline"));
  let finishDrum!: (value: unknown) => void;
  importers.drum.mockReturnValue(
    new Promise((resolve) => {
      finishDrum = resolve;
    }),
  );
  const placeholder = render("coffee");
  expect(placeholder.type).toBe("span");
  expect(placeholder.props.style).toEqual({ width: 24, height: 24 });
  await settle();
  expect(render("coffee").type).toBe(Coffee);
  expect(importers.coffee).toHaveBeenCalledTimes(1);
  expect(render("guitar").type).toBe("span");
  await settle();
  expect(render("guitar").type).toBe(Music2);
  expect(render("drum").type).toBe("span");
  expect(render("music").type).toBe(Music2);
  finishDrum({ default: Drum });
  await settle();
  expect(render("music").type).toBe(Music2);
  expect(render("drum").type).toBe(Drum);
  expect(render("unknown").type).toBe(Music2);
});
