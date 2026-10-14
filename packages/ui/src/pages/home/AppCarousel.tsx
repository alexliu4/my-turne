import type { ActiveSection } from "../../types";
import React from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import { useWindowsConnector } from "../../hooks/useWindowsConnector";

export interface AppDefinition {
  id: string;
  title: string;
  category: string;
  targetSection: ActiveSection;
  isWindowsDependent: boolean;
  iconSvg: React.ReactNode;
}

interface AppsSectionProps {
  items: AppDefinition[];
  activeSection: ActiveSection;
  onSelectApp: (section: ActiveSection) => void;
}

const CARD_SIZE_STYLE = { width: 280, height: 280 };

function AppCarousel({ items, activeSection, onSelectApp }: AppsSectionProps) {
  const { isWindowsActive } = useWindowsConnector();

  const selectApp = (app: AppDefinition) => {
    if (app.isWindowsDependent && !isWindowsActive) return;
    onSelectApp(app.targetSection);
  };

  const handleItemSelect = (index: number) => {
    if (index !== -1 && items[index]) {
      const app = items[index];
      selectApp(app);
    }
  };

  return (
    <SwiperCarousel
      items={items}
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

export default React.memo(AppCarousel);
