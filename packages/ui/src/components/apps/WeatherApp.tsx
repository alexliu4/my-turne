import React from "react";
import { BackIcon } from "../common/icons";

interface ForecastDay {
  day: string;
  condition: string;
  high: number;
  low: number;
  icon: string;
}

export function WeatherApp({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  const currentTemp = 72;
  const condition = "Partly Cloudy";
  const location = "Local Device";
  const high = 76;
  const low = 62;

  const forecastData: ForecastDay[] = [
    { day: "Today", condition: "Partly Cloudy", high: 76, low: 62, icon: "⛅" },
    { day: "Mon", condition: "Sunny", high: 78, low: 64, icon: "☀️" },
    { day: "Tue", condition: "Rain", high: 68, low: 58, icon: "🌧️" },
    { day: "Wed", condition: "Cloudy", high: 71, low: 60, icon: "☁️" },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 relative overflow-hidden rounded-2xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-4 z-10 border-b border-zinc-800 pb-4">
        <div className="flex items-center space-x-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition"
              aria-label="Go Back"
            >
              <BackIcon className="w-6 h-6 text-zinc-300" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              Weather
            </h1>
            <p className="text-sm font-semibold text-zinc-400">Device App</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
          <span className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Offline Ready
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between overflow-y-auto">
        {/* Current Weather Banner */}
        <div className="flex items-center justify-between p-6 bg-zinc-900/80 rounded-2xl border border-zinc-800/80">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {location}
            </span>
            <div className="text-6xl font-bold text-zinc-100 my-1">
              {currentTemp}°F
            </div>
            <div className="text-lg font-medium text-zinc-300">{condition}</div>
            <div className="text-xs text-zinc-500 mt-1">
              H: {high}° L: {low}°
            </div>
          </div>
          <div className="text-7xl">⛅</div>
        </div>

        {/* Forecast List */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {forecastData.map((item) => (
            <div
              key={item.day}
              className="flex flex-col items-center justify-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50"
            >
              <span className="text-sm font-semibold text-zinc-300">
                {item.day}
              </span>
              <span className="text-3xl my-2">{item.icon}</span>
              <span className="text-xs font-medium text-zinc-400">
                {item.high}° / {item.low}°
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
