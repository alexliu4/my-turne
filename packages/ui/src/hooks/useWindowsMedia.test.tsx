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
import {
  clearWindowsMediaSnapshot,
  updateWindowsMediaSnapshot,
} from "./windowsMediaState";
import Settings from "../components/settings/Settings";

let ready: daemon.AppReadyState;
let routeGeneration = 0;
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
  clearWindowsMediaSnapshot();
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
    generation: ++routeGeneration,
  };
  spyOn(daemon, "getAppReadyState").mockImplementation(() => ready);
  spyOn(daemon, "getWindowsMediaEventGeneration").mockImplementation(
    () => ready.generation,
  );
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
  test.each(["stopped", "closed"])(
    "%s clears retained metadata and timeline; paused survives",
    async (status) => {
      await mount();
      const attributes = {
        media_generation: 8,
        media_item_attributes: {
          MediaItemTitle: "Retained",
          MediaItemArtist: "Artist",
          MediaItemPlaybackDurationInMilliseconds: 9000,
        },
        playback_attributes: {
          PlaybackStatus: "paused",
          PlaybackElapsedTimeInMilliseconds: 1000,
        },
      };
      await event(attributes);
      expect(hook.hasActiveSession).toBe(true);
      await event(
        { media_generation: 8, data: "cover" },
        "media.now_playing.artwork",
      );
      await event({
        ...attributes,
        playback_attributes: {
          ...attributes.playback_attributes,
          PlaybackStatus: status,
        },
      });
      expect(hook.hasActiveSession).toBe(false);
      expect(hook.title).toBeNull();
      expect(hook.artist).toBeNull();
      expect(hook.artworkUrl).toBeNull();
      expect(hook.durationMs).toBeNull();
      expect(hook.elapsedTimeMs).toBeNull();
      await event({ ...attributes, media_generation: 7 });
      expect(hook.hasActiveSession).toBe(false);
    },
  );

  test("reopening reads current paused cache including events while the screen was closed", async () => {
    await mount();
    await event({
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Old" },
      playback_attributes: { PlaybackStatus: "playing" },
    });
    await act(async () => root.render(null));
    updateWindowsMediaSnapshot(
      "media.now_playing.update",
      {
        media_generation: 2,
        media_item_attributes: { MediaItemTitle: "Paused" },
        playback_attributes: {
          PlaybackStatus: "paused",
          PlaybackElapsedTimeInMilliseconds: 4200,
        },
      },
      ready.generation,
    );
    updateWindowsMediaSnapshot(
      "media.now_playing.artwork",
      { media_generation: 2, data: "cover" },
      ready.generation,
    );
    await mount();
    expect(hook.title).toBe("Paused");
    expect(hook.playbackStatus).toBe("paused");
    expect(hook.elapsedTimeMs).toBe(4200);
    expect(hook.artworkUrl).toContain("cover");
    expect(calls).toHaveLength(0);
    await route("macos");
    await route("windows");
    expect(hook.hasActiveSession).toBe(false);
  });

  test("rejects older metadata, invalid generations, malformed envelopes and mixed artwork tags", async () => {
    await mount();
    const metadata = {
      media_generation: 10,
      media_item_attributes: { MediaItemTitle: "New" },
      playback_attributes: { PlaybackStatus: "paused" },
    };
    await event(metadata);
    for (const value of [
      null,
      [],
      {},
      { ...metadata, media_generation: -1 },
      { ...metadata, media_generation: "11" },
      { ...metadata, media_generation: 9 },
      { ...metadata, media_generation: undefined },
      { ...metadata, playback_attributes: [] },
    ]) {
      await event(value);
      expect(hook.title).toBe("New");
      expect(hook.mediaGeneration).toBe(10);
    }
    for (const gen of [undefined, 9, 11, "10", -1]) {
      await event(
        { media_generation: gen, data: "wrong" },
        "media.now_playing.artwork",
      );
      expect(hook.artworkUrl).toBeNull();
    }
    await event(
      { media_generation: 10, data: "correct" },
      "media.now_playing.artwork",
    );
    expect(hook.artworkUrl).toContain("correct");
    await route("windows");
    await event({
      media_item_attributes: { MediaItemTitle: "Legacy" },
      playback_attributes: { PlaybackStatus: "paused" },
    });
    await event(
      { media_generation: 10, data: "wrong" },
      "media.now_playing.artwork",
    );
    expect(hook.artworkUrl).toBeNull();
    await event({ data: "legacy" }, "media.now_playing.artwork");
    expect(hook.artworkUrl).toContain("legacy");
  });

  test("blocks overlapping controls and disables only the confirmed unsupported action until session changes", async () => {
    await mount(<WindowsMedia />);
    const metadata = {
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "paused" },
    };
    await event(metadata);
    await act(async () => {
      button("Next Track").click();
      button("Previous Track").click();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ windows_only: true });
    await event({
      ...metadata,
      playback_attributes: { PlaybackStatus: "playing" },
    });
    await respond({ status: "unsupported" });
    expect(button("Next Track").disabled).toBe(true);
    expect(button("Previous Track").disabled).toBe(false);
    await event(metadata);
    expect(button("Next Track").disabled).toBe(true);
    await act(async () => button("Next Track").click());
    expect(calls).toHaveLength(1);
    await event({ ...metadata, media_generation: 2 });
    expect(button("Next Track").disabled).toBe(false);
  });

  test("an in-flight control stays serialized when its screen is closed and reopened", async () => {
    await mount();
    await event({
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "paused" },
    });
    await act(async () => {
      void hook.nextTrack();
    });
    expect(hook.isLoading).toBe(true);
    await act(async () => root.render(null));
    await mount();
    expect(hook.isLoading).toBe(true);
    await act(async () => {
      void hook.previousTrack();
    });
    expect(calls).toHaveLength(1);
    await respond({ status: "ok" });
    expect(hook.isLoading).toBe(false);
    await act(async () => {
      void hook.previousTrack();
    });
    expect(calls).toHaveLength(2);
    await respond({ status: "ok" });
  });

  test("loading state recovers properly on RPC rejection, timeout, and route change", async () => {
    await mount();
    await event({
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    // Rejection recovery
    await act(async () => {
      void hook.nextTrack();
    });
    expect(hook.isLoading).toBe(true);
    await act(async () => calls[0].reject(new Error("RPC Failed")));
    expect(hook.isLoading).toBe(false);
    expect(hook.error).toBe("RPC Failed");

    // Timeout / error recovery
    await act(async () => {
      void hook.previousTrack();
    });
    expect(hook.isLoading).toBe(true);
    await act(async () => calls[1].reject(new Error("Request timeout")));
    expect(hook.isLoading).toBe(false);
    expect(hook.error).toBe("Request timeout");

    // Route change recovery
    await act(async () => {
      void hook.nextTrack();
    });
    expect(hook.isLoading).toBe(true);
    await route("windows"); // changes generation
    expect(hook.isLoading).toBe(false);
  });

  test("unrelated WebSocket events do not cause React re-renders or update state", async () => {
    let renderCount = 0;
    function RenderTracker() {
      hook = useWindowsMedia();
      renderCount++;
      return null;
    }

    await mount(<RenderTracker />);
    await event({
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Initial Track" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    const initialRenders = renderCount;

    // Unrelated events
    await act(async () => {
      eventListener?.onMessage?.({
        type: "event",
        topic: "volume.update",
        data: { level: 50 },
      });
      eventListener?.onMessage?.({
        type: "event",
        topic: "notification.show",
        data: { message: "Call" },
      });
      eventListener?.onMessage?.({
        type: "event",
        topic: "phone.status",
        data: { status: "connected" },
      });
    });

    expect(renderCount).toBe(initialRenders);
    expect(hook.title).toBe("Initial Track");

    // Valid media event updates UI normally
    await event({
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Updated Track" },
      playback_attributes: { PlaybackStatus: "playing" },
    });

    expect(renderCount).toBeGreaterThan(initialRenders);
    expect(hook.title).toBe("Updated Track");
  });

  test("late unsupported replies cannot disable a replacement session; malformed responses release busy state", async () => {
    await mount();
    const metadata = {
      media_generation: 1,
      media_item_attributes: { MediaItemTitle: "Song" },
      playback_attributes: { PlaybackStatus: "playing" },
    };
    await event(metadata);
    await act(async () => {
      void hook.nextTrack();
      void hook.previousTrack();
    });
    expect(calls).toHaveLength(1);
    await event({ ...metadata, media_generation: 2 });
    await respond({ status: "unsupported" });
    expect(hook.supportedControls.next).toBe(true);
    await act(async () => {
      void hook.nextTrack();
    });
    await respond(null);
    expect(hook.error).toContain("Invalid");
    expect(hook.isLoading).toBe(false);
    await route("macos");
    await act(async () => {
      void hook.nextTrack();
    });
    expect(calls).toHaveLength(2);
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
