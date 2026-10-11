import { expect, test, describe } from "bun:test";
import { WeatherApp } from "./WeatherApp";

describe("WeatherApp component", () => {
  test("exports WeatherApp component", () => {
    expect(WeatherApp).toBeDefined();
  });
});
