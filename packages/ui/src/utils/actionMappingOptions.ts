import type { ActionDefinition, ControlTrigger } from "./actionMapping";

export const TRIGGER_LABELS: Record<ControlTrigger, string> = {
  preset_1: "Preset 1 Button",
  preset_2: "Preset 2 Button",
  preset_3: "Preset 3 Button",
  preset_4: "Preset 4 Button",
  dial_turn_left: "Dial Turn Left",
  dial_turn_right: "Dial Turn Right",
  dial_press: "Dial Press",
  dial_long_press: "Dial Long Press",
  back_press: "Back Button",
  settings_press: "Settings Button",
  settings_long_press: "Settings Button Long Press",
};

export const AVAILABLE_ACTIONS: Array<{
  label: string;
  definition: ActionDefinition;
}> = [
  {
    label: "Default (Original Physical Control)",
    definition: { kind: "default" },
  },
  {
    label: "Device: Play / Pause",
    definition: { kind: "device", action: "media.play_pause" },
  },
  {
    label: "Device: Next Track",
    definition: { kind: "device", action: "media.next" },
  },
  {
    label: "Device: Previous Track",
    definition: { kind: "device", action: "media.previous" },
  },
  {
    label: "Device: Navigate Home",
    definition: { kind: "device", action: "navigate.home" },
  },
  {
    label: "Device: Navigate Now Playing",
    definition: { kind: "device", action: "navigate.now_playing" },
  },
  {
    label: "Device: Launch Weather App",
    definition: { kind: "device", action: "app.launch", appId: "weather" },
  },
  {
    label: "Device: Launch Timer App",
    definition: { kind: "device", action: "app.launch", appId: "timer" },
  },
  {
    label: "Device: Launch Host Status",
    definition: { kind: "device", action: "app.launch", appId: "hostStatus" },
  },
  {
    label: "Device: Launch Windows Media",
    definition: { kind: "device", action: "app.launch", appId: "windowsMedia" },
  },
  {
    label: "Device: Launch Windows Volume",
    definition: {
      kind: "device",
      action: "app.launch",
      appId: "windowsVolume",
    },
  },
  {
    label: "Windows: Volume Up (+5)",
    definition: { kind: "windows", action: "volume.adjust", delta: 5 },
  },
  {
    label: "Windows: Volume Down (-5)",
    definition: { kind: "windows", action: "volume.adjust", delta: -5 },
  },
  {
    label: "Windows: Toggle Mute",
    definition: { kind: "windows", action: "volume.toggle_mute" },
  },
  {
    label: "Windows: Play / Pause",
    definition: { kind: "windows", action: "media.play_pause" },
  },
  {
    label: "Windows: Next Track",
    definition: { kind: "windows", action: "media.next" },
  },
  {
    label: "Windows: Previous Track",
    definition: { kind: "windows", action: "media.previous" },
  },
];
