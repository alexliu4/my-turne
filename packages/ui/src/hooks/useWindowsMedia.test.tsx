import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  mock,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import * as daemon from "./useNocturned";
import * as settingsContext from "../contexts/SettingsContext";
import { useWindowsMedia } from "./useWindowsMedia";
import { WindowsMedia } from "../components/windows/WindowsMedia";
import Settings from "../components/settings/Settings";

let ready: daemon.AppReadyState;
let readinessListener: ((state: daemon.AppReadyState) => void) | undefined;
let eventListener: Parameters<typeof daemon.addGlobalWsListener>[1] | undefined;
let calls: {
  method: string;
  params: object;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}[];
let root: Root;
let container: HTMLDivElement;
let hook: ReturnType<typeof useWindowsMedia>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsMedia();
  return null;
}

beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  calls = [];
  ready = {
    ready: true,
    platform: "web",
    connectorPlatform: "windows",
    generation: 1,
  };
  spyOn(daemon, "getAppReadyState").mockImplementation(() => ready);
  spyOn(daemon, "subscribeAppReadyState").mockImplementation((listener) => {
    readinessListener = listener;
    listener(ready);
    return () => {
      readinessListener = undefined;
    };
  });
  spyOn(daemon, "addGlobalWsListener").mockImplementation((_id, listener) => {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  });
  spyOn(daemon, "sendNocturneWsRequest").mockImplementation(
    <T,>(method: string, params: object = {}) => {
      const promise = new Promise<unknown>((resolve, reject) =>
        calls.push({ method, params, resolve, reject }),
      );
      return promise as Promise<T>;
    },
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  mock.restore();
  await dom.happyDOM.cancelAsync();
  for (const [key, original] of originals) {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

async function mount(element: React.ReactElement = <Probe />) {
  await act(async () => root.render(element));
}
async function respond(value: unknown, index = calls.length - 1) {
  await act(async () => calls[index].resolve(value));
}
async function event(data: unknown, topic = "media.now_playing.update") {
  await act(async () =>
    eventListener?.onMessage?.({ type: "event", topic, data }),
  );
}
async function route(connectorPlatform: string | null, active = true) {
  await act(async () => {
    ready = {
      ...ready,
      ready: active,
      connectorPlatform,
      generation: ready.generation + 1,
    };
    readinessListener?.(ready);
  });
}
function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("Windows Media hook RPC and event lifecycle", () => {
  test("initial state is cleared when inactive or connected without media", async () => {
    await mount();
    expect(hook.isWindowsActive).toBe(true);
    expect(hook.hasActiveSession).toBe(false);
    expect(hook.title).toBeNull();
    expect(hook.artist).toBeNull();
    expect(hook.artworkUrl).toBeNull();
  });

  test("accepts media.now_playing.update and normalizes metadata and playback state", async () => {
    await mount();
    await event({
      media_generation: 1,
      media_item_attributes: {
        MediaItemTitle: "Midnight Signals",
        MediaItemArtist: "Nocturne",
        MediaItemAlbumName: "Night Drive",
        MediaItemPlaybackDurationInMilliseconds: 180000,
      },
      playback_attributes: {
        PlaybackAppName: "Spotify",
        PlaybackStatus: "playing",
        PlaybackRate: 1,
        PlaybackElapsedTimeInMilliseconds: 45000,
      },
    });

    expect(hook.hasActiveSession).toBe(true);
    expect(hook.title).toBe("Midnight Signals");
    expect(hook.artist).toBe("Nocturne");
    expect(hook.album).toBe("Night Drive");
    expect(hook.appName).toBe("Spotify");
    expect(hook.playbackStatus).toBe("playing");
    expect(hook.durationMs).toBe(180000);
    expect(hook.elapsedTimeMs).toBe(45000);
    expect(hook.mediaGeneration).toBe(1);
  });

  test("accepts artwork matching media_generation and rejects mismatched generation", async () => {
    await mount();
    await event({
      media_generation: 5,
      media_item_attributes: {
        MediaItemTitle: "Track A",
        MediaItemArtist: "Artist A",
      },
      playback_attributes: {
        PlaybackStatus: "playing",
      },
    });

    expect(hook.mediaGeneration).toBe(5);

    // Mismatched generation (e.g. 4) must be rejected
    await event(
      {
        media_generation: 4,
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        content_type: "image/png",
      },
      "media.now_playing.artwork",
    );

    expect(hook.artworkUrl).toBeNull();

    // Matching generation (5) is accepted
    await event(
      {
        media_generation: 5,
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        content_type: "image/png",
      },
      "media.now_playing.artwork",
    );

    expect(hook.artworkUrl).toContain("data:image/png;base64,");
  });

  test("clears artwork and metadata when media session closes or becomes stopped", async () => {
    await mount();
    await event({
      media_generation: 2,
      media_item_attributes: {
        MediaItemTitle: "Track A",
        MediaItemArtist: "Artist A",
      },
      playback_attributes: {
        PlaybackStatus: "playing",
      },
    });

    await event(
      {
        media_generation: 2,
        data: "artworkdata",
      },
      "media.now_playing.artwork",
    );

    expect(hook.hasActiveSession).toBe(true);

    // Empty or stopped update without track info clears session
    await event({
      media_generation: 3,
      media_item_attributes: {},
      playback_attributes: {
        PlaybackStatus: "stopped",
      },
    });

    expect(hook.hasActiveSession).toBe(false);
    expect(hook.title).toBeNull();
    expect(hook.artworkUrl).toBeNull();
  });

  test("dispatches media controls strictly when Windows is active", async () => {
    await mount();
    await event({
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    await act(async () => {
      void hook.togglePlayPause();
    });
    expect(calls[0].method).toBe("media.control.toggle");
    await respond({ status: "ok" });

    await act(async () => {
      void hook.nextTrack();
    });
    expect(calls[1].method).toBe("media.control.next");
    await respond({ status: "ok" });

    await act(async () => {
      void hook.previousTrack();
    });
    expect(calls[2].method).toBe("media.control.previous");
    await respond({ status: "ok" });

    // When Windows is inactive, controls do not trigger RPCs
    await route("macos");
    await act(async () => {
      void hook.nextTrack();
    });
    expect(calls).toHaveLength(3);
  });

  test("disconnection clears metadata and artwork", async () => {
    await mount();
    await event({
      media_item_attributes: { MediaItemTitle: "Active Track" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    expect(hook.hasActiveSession).toBe(true);

    await route(null, false);

    expect(hook.isWindowsActive).toBe(false);
    expect(hook.hasActiveSession).toBe(false);
    expect(hook.title).toBeNull();
  });

  test("late RPC responses after disconnect or generation changes are ignored", async () => {
    await mount();
    await event({
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    await act(async () => {
      void hook.nextTrack();
    });

    await route("windows"); // generation incremented
    await respond({ status: "ok" }, 0);

    expect(hook.isLoading).toBe(false);
  });
});

describe("rendered WindowsMedia screen", () => {
  test("renders PC unavailable when Windows is offline", async () => {
    await route(null, false);
    await mount(<WindowsMedia />);
    expect(container.textContent).toContain("PC unavailable");
    expect(container.textContent).toContain("Offline");
  });

  test("renders No media playing when connected with no active session", async () => {
    await mount(<WindowsMedia />);
    expect(container.textContent).toContain("No media playing");
    expect(container.textContent).toContain("Connected");
  });

  test("renders track metadata, progress, and controls during active media session", async () => {
    let closed = false;
    await mount(
      <WindowsMedia
        onClose={() => {
          closed = true;
        }}
      />,
    );

    await event({
      media_generation: 1,
      media_item_attributes: {
        MediaItemTitle: "Night Drive",
        MediaItemArtist: "Nocturne Synth",
        MediaItemAlbumName: "Cyberpunk 2088",
        MediaItemPlaybackDurationInMilliseconds: 180000,
      },
      playback_attributes: {
        PlaybackAppName: "Google Chrome",
        PlaybackStatus: "playing",
        PlaybackElapsedTimeInMilliseconds: 60000,
      },
    });

    expect(container.textContent).toContain("Night Drive");
    expect(container.textContent).toContain("Nocturne Synth");
    expect(container.textContent).toContain("Cyberpunk 2088");
    expect(container.textContent).toContain("Google Chrome");
    expect(container.textContent).toContain("1:00");
    expect(container.textContent).toContain("3:00");

    await act(async () => button("Pause").click());
    expect(calls[0].method).toBe("media.control.toggle");
    await respond({ status: "ok" });

    await act(async () => button("Next Track").click());
    expect(calls[1].method).toBe("media.control.next");
    await respond({ status: "ok" });

    await act(async () => button("Previous Track").click());
    expect(calls[2].method).toBe("media.control.previous");
    await respond({ status: "ok" });

    await act(async () => button("Go Back").click());
    expect(closed).toBe(true);
  });

  test("Settings General entry opens the Windows Media screen", async () => {
    spyOn(settingsContext, "useSettings").mockReturnValue({
      settings: {},
      updateSetting: () => {},
      isAppLaunchSettingReady: false,
      isAppLaunchSettingSaving: false,
      appLaunchSettingError: null,
      isMicLocked: true,
      appPlatform: "web",
      isNativePhonePresentationLocked: true,
      nativePhonePresentationLockMessage: null,
      showNativePhoneCalls: false,
      showNativeNotifications: false,
    });
    let selected: unknown;
    await mount(
      <Settings
        onOpenDonationModal={() => {}}
        setActiveSection={(section) => {
          selected = section;
        }}
      />,
    );
    const general = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("General"),
    );
    if (!general) throw new Error("General settings entry missing");
    await act(async () => {
      general.click();
      await Bun.sleep(350);
    });
    const media = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("Windows Media"),
    );
    if (!media) throw new Error("Windows Media settings entry missing");
    await act(async () => media.click());
    expect(selected).toBe("windowsMedia");
  });
});
