import React from "react";
import AppCarousel, { type AppDefinition } from "./AppCarousel";
import type { ActiveSection } from "../../types";
const COMPUTER_CATALOG: AppDefinition[] = [
  {
    id: "windows-media",
    title: "Windows Media",
    category: "Windows App",
    targetSection: "windowsMedia",
    isWindowsDependent: true,
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
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
        />
      </svg>
    ),
  },
  {
    id: "windows-controls",
    title: "Windows Control",
    category: "Windows App",
    targetSection: "windowsVolume",
    isWindowsDependent: true,
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
          d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
        />
      </svg>
    ),
  },
  {
    id: "discord",
    title: "Discord",
    category: "Windows App",
    targetSection: "discord",
    isWindowsDependent: true,
    iconSvg: (
      <svg
        className="w-20 h-20 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M16 10h.01M7 17l-3 3V7a3 3 0 013-3h10a3 3 0 013 3v7a3 3 0 01-3 3H7z"
        />
      </svg>
    ),
  },
  {
    id: "host-status",
    title: "Host Status",
    category: "Computer Diagnostics",
    targetSection: "hostStatus",
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
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
];
export default function ComputerControlSection(props: {
  activeSection: ActiveSection;
  onSelectApp: (section: ActiveSection) => void;
}) {
  return <AppCarousel items={COMPUTER_CATALOG} {...props} />;
}
