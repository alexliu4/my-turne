import { describe, it, expect } from "bun:test";
import { WindowsVolume } from "./WindowsVolume";

describe("WindowsVolume component", () => {
  it("exports WindowsVolume component function", () => {
    expect(typeof WindowsVolume).toBe("function");
  });
});
