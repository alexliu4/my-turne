import type { ReactNode } from "react";
import styles from "../../styles/Views.module.scss";
import classNames from "classnames";
import { View } from "../../stores/ViewStore";
import DelayedRender from "../DelayedRender";
import { transitionDurationMs } from "../../styles/Variables";

export function ViewLayers({
  currentView,
  viewUnderCurrentView,
  views,
}: {
  currentView: string;
  viewUnderCurrentView?: string;
  views: Array<{ name: string; component: ReactNode }>;
}) {
  const tracklistOverNpv =
    currentView === View.TRACKLIST && viewUnderCurrentView === View.NPV;
  const queueOverNpv =
    currentView === View.QUEUE && viewUnderCurrentView === View.NPV;
  return (
    <div className={styles.viewArea}>
      {views.map((view) => (
        <div
          key={view.name}
          className={classNames(styles.view, {
            [styles.current]: view.name === currentView,
            [styles.underCurrent]: viewUnderCurrentView === view.name,
            [styles.forceOnTop]:
              (tracklistOverNpv && view.name === View.TRACKLIST) ||
              (queueOverNpv && view.name === View.QUEUE),
          })}
        >
          <DelayedRender
            showing={view.name === currentView}
            hideDelay={transitionDurationMs}
          >
            {view.component}
          </DelayedRender>
        </div>
      ))}
    </div>
  );
}
