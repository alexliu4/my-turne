import React from "react";
import AppCarousel, { type AppDefinition } from "./AppCarousel";
import type { ActiveSection } from "../../types";
const APPS_CATALOG: AppDefinition[] = [
  {
    id: "timer",
    title: "Timer",
    category: "Device App",
    targetSection: "timer",
    isWindowsDependent: false,
    iconSvg: (
      <svg
        className="w-20 h-20 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v6l4 2s.5-1.5 0-3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    id: "weather",
    title: "Weather",
    category: "Device App",
    targetSection: "weather",
    isWindowsDependent: false,
    iconSvg: (
      <svg
        className="w-20 h-20 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
        />
      </svg>
    ),
  },
];

export default function AppsSection(props: {
  activeSection: ActiveSection;
  onSelectApp: (section: ActiveSection) => void;
}) {
  return <AppCarousel items={APPS_CATALOG} {...props} />;
}
