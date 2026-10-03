import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import SubmenuHeader from "../Submenu/SubmenuHeader";
import SubmenuItem from "../Submenu/SubmenuItem";
import styles from "./SpotifyLaunch.module.scss";

const SpotifyLaunch = () => {
  const { settingsStore } = useCarThingStore();
  const item = settingsStore.spotifyLaunchView.rows?.[0];

  return (
    <>
      <SubmenuHeader icon={null} name="Launch Spotify" />
      <div className={styles.scrollContainer}>
        {item ? <SubmenuItem item={item} active /> : null}
        <div className={styles.text}>
          Open Spotify after connection, and automatically resume playback.
          {settingsStore.isAppLaunchSettingSaving ? (
            <p role="status">Saving...</p>
          ) : settingsStore.appLaunchSettingError ? (
            <p role="alert">{settingsStore.appLaunchSettingError}</p>
          ) : !settingsStore.isAppLaunchSettingReady ? (
            <p role="status">Waiting for the device connection...</p>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default observer(SpotifyLaunch);
