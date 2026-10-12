import type { ActiveSection } from "../../types";
import React from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import { useWindowsConnector } from "../../hooks/useWindowsConnector";

interface AppDefinition {
  id: string;
  title: string;
  category: string;
  targetSection: ActiveSection;
  isWindowsDependent: boolean;
  iconSvg: React.ReactNode;
}

interface AppsSectionProps {
  activeSection: ActiveSection;
  onSelectApp: (section: ActiveSection) => void;
}

const CARD_SIZE_STYLE = { width: 280, height: 280 };

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
    title: "Windows Controls",
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
    id: "host-status",
    title: "Host Status",
    category: "Windows App",
    targetSection: "hostStatus",
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
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
];

function AppsSection({ activeSection, onSelectApp }: AppsSectionProps) {
  const { isWindowsActive } = useWindowsConnector();

  const selectApp = (app: AppDefinition) => {
    if (app.isWindowsDependent && !isWindowsActive) return;
    onSelectApp(app.targetSection);
  };

  const handleItemSelect = (index: number) => {
    if (index !== -1 && APPS_CATALOG[index]) {
      const app = APPS_CATALOG[index];
      selectApp(app);
    }
  };

  return (
    <SwiperCarousel
      items={APPS_CATALOG}
      renderItem={(app, index, isActive) => {
        const isOffline = app.isWindowsDependent && !isWindowsActive;

        return (
          <div
            data-id={app.id}
            className={`pl-2 transition-transform duration-200 ease-out ${
              isActive ? "scale-105" : ""
            }`}
          >
            <div
              style={CARD_SIZE_STYLE}
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 border border-white/15 flex flex-col items-center justify-center relative overflow-hidden"
              onClick={() => selectApp(app)}
              aria-disabled={isOffline}
            >
              {app.iconSvg}
              {app.isWindowsDependent && (
                <div
                  className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    isWindowsActive
                      ? "bg-green-500/30 text-green-300 border border-green-500/40"
                      : "bg-amber-500/30 text-amber-300 border border-amber-500/40"
                  }`}
                >
                  {isWindowsActive ? "Connected" : "PC Offline"}
                </div>
              )}
            </div>

            <h4
              className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
              onClick={() => selectApp(app)}
              aria-disabled={isOffline}
            >
              {app.title}
            </h4>
            <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
              {app.isWindowsDependent && isOffline
                ? "PC Unavailable"
                : app.category}
            </h4>
          </div>
        );
      }}
      keyExtractor={(app) => app.id}
      getItemId={(app) => app.id}
      activeSection={activeSection}
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(AppsSection);
