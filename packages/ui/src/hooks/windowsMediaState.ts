export type SupportedControls = {
  toggle: boolean;
  play: boolean;
  pause: boolean;
  next: boolean;
  previous: boolean;
};

export type WindowsMediaState = {
  appName: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  mediaGeneration: number | null;
  playbackStatus: string | null;
  playbackRate: number;
  elapsedTimeMs: number | null;
  durationMs: number | null;
  hasActiveSession: boolean;
  supportedControls: SupportedControls;
  isLoading: boolean;
  error: string | null;
};

const defaultSupportedControls: SupportedControls = {
  toggle: true,
  play: true,
  pause: true,
  next: true,
  previous: true,
};

export const clearedMediaState: WindowsMediaState = {
  appName: null,
  title: null,
  artist: null,
  album: null,
  artworkUrl: null,
  mediaGeneration: null,
  playbackStatus: null,
  playbackRate: 1,
  elapsedTimeMs: null,
  durationMs: null,
  hasActiveSession: false,
  supportedControls: defaultSupportedControls,
  isLoading: false,
  error: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function normalizeMediaGeneration(value: unknown): number | null {
  const num = number(value);
  return num !== null && Number.isSafeInteger(num) && num >= 0 ? num : null;
}

export function isWindowsMediaTopic(topic?: string): boolean {
  return (
    topic === "media.now_playing.update" ||
    topic === "media.nowPlaying.update" ||
    topic === "media.now_playing.artwork" ||
    topic === "media.nowPlaying.artwork"
  );
}

export function formatArtworkUrl(
  data: string,
  contentType?: string | null,
): string {
  if (
    data.startsWith("data:") ||
    data.startsWith("http://") ||
    data.startsWith("https://")
  ) {
    return data;
  }
  const mime = contentType || "image/jpeg";
  return `data:${mime};base64,${data}`;
}

// This cache belongs to the WebSocket session, not the screen lifetime.
let generation = -1;
let snapshot = clearedMediaState;
export function clearWindowsMediaSnapshot() {
  generation = -1;
  snapshot = clearedMediaState;
}
export function getWindowsMediaSnapshot(
  routeGeneration: number,
): WindowsMediaState {
  if (routeGeneration < generation) return clearedMediaState;
  if (generation !== routeGeneration) {
    generation = routeGeneration;
    snapshot = clearedMediaState;
  }
  return snapshot;
}
export function updateWindowsMediaSnapshot(
  topic: string,
  data: unknown,
  routeGeneration: number,
) {
  if (!isWindowsMediaTopic(topic)) {
    return getWindowsMediaSnapshot(routeGeneration);
  }
  const prev = getWindowsMediaSnapshot(routeGeneration);
  const body = record(data);
  if (!body) return prev;
  const rawGen = body.media_generation ?? body.mediaGeneration;
  const incomingGen = normalizeMediaGeneration(rawGen);
  if (rawGen !== undefined && incomingGen === null) return prev;
  if (
    topic === "media.now_playing.update" ||
    topic === "media.nowPlaying.update"
  ) {
    const media = record(
      body.media_item_attributes ??
        body.mediaItemAttributes ??
        body.MediaItemAttributes,
    );
    const playback = record(
      body.playback_attributes ??
        body.playbackAttributes ??
        body.PlaybackAttributes,
    );
    if (!media || !playback) return prev;
    const status = text(
      playback.PlaybackStatus ?? playback.status,
    )?.toLowerCase();
    if (
      !status ||
      !["playing", "paused", "stopped", "closed", "loading"].includes(status)
    )
      return prev;
    if (
      prev.mediaGeneration !== null &&
      (incomingGen === null || incomingGen < prev.mediaGeneration)
    )
      return prev;
    const title = text(media.MediaItemTitle ?? media.title);
    const artist = text(media.MediaItemArtist ?? media.artist);
    const album = text(
      media.MediaItemAlbumName ?? media.MediaItemAlbum ?? media.album,
    );
    const appName = text(playback.PlaybackAppName ?? playback.appName);
    if (status === "stopped" || status === "closed") {
      snapshot = { ...clearedMediaState, mediaGeneration: incomingGen };
      return snapshot;
    }
    const changed =
      prev.mediaGeneration !== incomingGen ||
      prev.title !== title ||
      prev.artist !== artist ||
      prev.appName !== appName ||
      !prev.hasActiveSession;
    const duration =
      number(media.MediaItemPlaybackDurationInMilliseconds) ??
      (number(media.MediaItemDuration) === null
        ? null
        : Number(media.MediaItemDuration) * 1000);
    const elapsed =
      number(playback.PlaybackElapsedTimeInMilliseconds) ??
      (number(playback.PlaybackElapsedTime) === null
        ? null
        : Number(playback.PlaybackElapsedTime) * 1000);
    snapshot = {
      ...prev,
      appName,
      title,
      artist,
      album,
      playbackStatus: status,
      playbackRate:
        number(playback.PlaybackRate ?? playback.PlaybackSpeed) ?? 1,
      durationMs: duration !== null && duration >= 0 ? duration : null,
      elapsedTimeMs: elapsed !== null && elapsed >= 0 ? elapsed : null,
      mediaGeneration: incomingGen,
      hasActiveSession: true,
      artworkUrl: changed ? null : prev.artworkUrl,
      supportedControls: changed
        ? defaultSupportedControls
        : prev.supportedControls,
      error: null,
    };
  } else if (
    topic === "media.now_playing.artwork" ||
    topic === "media.nowPlaying.artwork"
  ) {
    const encoded = text(body.data);
    if (
      !prev.hasActiveSession ||
      incomingGen !== prev.mediaGeneration ||
      !encoded
    )
      return prev;
    snapshot = {
      ...prev,
      artworkUrl: formatArtworkUrl(
        encoded,
        text(body.content_type ?? body.contentType),
      ),
    };
  }
  return snapshot;
}
export function disableWindowsMediaControl(
  control: keyof SupportedControls,
  routeGeneration: number,
) {
  const prev = getWindowsMediaSnapshot(routeGeneration);
  snapshot = {
    ...prev,
    supportedControls: { ...prev.supportedControls, [control]: false },
  };
  return snapshot;
}
