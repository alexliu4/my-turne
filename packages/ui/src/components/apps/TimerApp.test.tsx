import { expect, test, describe } from "bun:test";
import { TimerApp } from "./TimerApp";

describe("TimerApp component", () => {
  test("exports TimerApp component", () => {
    expect(TimerApp).toBeDefined();
  });
});
