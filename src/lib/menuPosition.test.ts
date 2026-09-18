import assert from "node:assert/strict";
import { test } from "node:test";
import { menuPosition } from "./menuPosition";

const menu = { width: 148, height: 138 };
const viewport = { width: 390, height: 844 };

test("record menu opens below its trigger with right edges aligned", () => {
  assert.deepEqual(menuPosition({ right: 370, top: 100, bottom: 132 }, menu, viewport), { left: 222, top: 136, maxHeight: 828 });
});

test("the last visible row opens upward instead of extending beyond the viewport", () => {
  assert.equal(menuPosition({ right: 370, top: 790, bottom: 822 }, menu, viewport).top, 648);
});

test("horizontal scrolling cannot place the menu outside either viewport edge", () => {
  assert.equal(menuPosition({ right: 40, top: 100, bottom: 132 }, menu, viewport).left, 8);
  assert.equal(menuPosition({ right: 900, top: 100, bottom: 132 }, menu, viewport).left, 234);
});

test("a short viewport keeps a tall menu inside the screen with scrolling", () => {
  assert.deepEqual(menuPosition({ right: 370, top: 100, bottom: 132 }, { width: 148, height: 300 }, { width: 390, height: 200 }), { left: 222, top: 8, maxHeight: 184 });
});
