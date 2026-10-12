import { ViewLayers } from "./ViewLayers";
import type { PlaybackViewProps } from "../../contexts/CarThingStore";
import { View } from "../../stores/ViewStore";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import Npv from "./Npv/Npv";
import Shelf from "./Shelf/Shelf";
import Tracklist from "./Tracklist";
import Queue from "./Queue/Queue";

const Views = ({ playbackProgress, onSeek }: PlaybackViewProps) => {
  const { viewStore } = useCarThingStore();

  return (
    <ViewLayers
      currentView={viewStore.currentView}
      viewUnderCurrentView={viewStore.viewUnderCurrentView}
      views={[
        { name: View.CONTENT_SHELF, component: <Shelf /> },
        { name: View.QUEUE, component: <Queue /> },
        { name: View.TRACKLIST, component: <Tracklist /> },
        {
          name: View.NPV,
          component: (
            <Npv playbackProgress={playbackProgress} onSeek={onSeek} />
          ),
        },
      ]}
    />
  );
};

export default observer(Views);
