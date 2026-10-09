# My-Turne Deployment & Hardware Testing Guide

**Scope:** `alexliu4/my-turne` (Car Thing daemon/UI) + `alexliu4/my-turne-connector` (native Windows Connector)  
**Updated:** October 9, 2026  
**Status:** My-Turne Sprint 1 and Connector Sprints 1–3 merged; My-Turne Sprint 2 is physical integration validation.

> **Use this guide instead of the old Windows Companion sections in `nocturne_ui_deployment_guide.md`.** The old `VITE_WINDOWS_HOST_URL`, port `8893`, authentication-token, and Windows LAN WebSocket workflow belongs to a retired architecture. It must **not** be used for My-Turne's Windows integration.

## 1. What is deployed where?

```text
Windows PC                              Spotify Car Thing
┌──────────────────────────┐            ┌─────────────────────────────┐
│ my-turne-connector       │            │ Existing My-Turne React UI   │
│ (your fork, native app)  │◀─ Bluetooth│       ↕ local WebSocket      │
│       ↕ native Windows   │   RFCOMM ─▶│ Updated nocturned daemon    │
│  media / volume APIs     │            └─────────────────────────────┘
└──────────────────────────┘
                                               ▲
                                       USB development/SSH
                                               │
                                             Mac mini
                                         (build/deployment)
```

When Windows is healthy, the Car Thing daemon prefers the Windows Connector. If Windows disconnects, it can use a surviving Mac/legacy Connector. This preference is a **daemon change**, not a new UI screen.

| Changed component | Deploy to | Requires full firmware image? | Typical action |
| --- | --- | --- | --- |
| `my-turne-connector` Windows Rust/TypeScript | Windows PC | No | Build/run your forked Windows app |
| `my-turne` Rust daemon (`crates/daemon`) | Car Thing | No | `just daemon-deploy-cross` or `just daemon-deploy` |
| `my-turne` React UI (`packages/ui`) | Car Thing | No | Build `dist`, then `tar \| ssh` |
| Yocto/kernel/base OS | Car Thing | **Sometimes** | Firmware/bandaid release process; **not needed for Sprint 1** |

**The minimum for the current integration test is:** update the Windows Connector and the Car Thing daemon. Rebuild the UI only when you have UI changes to deploy.

**USB distinction:** A USB data cable may be used **temporarily** for installing/debugging the Car Thing over SSH. The finished runtime uses **Bluetooth**, not the USB data cable or a direct LAN connection.

## 2. Quick path — first hardware test

1. Update the **Windows Connector fork** and build/run it using **Section 3**.
2. Update the **Car Thing daemon** from your Mac mini using **Section 4**.
3. Disconnect the USB development cable, connect Car Thing to your forked Windows Connector, and play a YouTube video in Chrome/Edge.
4. Open the existing **Now Playing** screen on Car Thing. Look for video title, artwork where available, playback state, or progress.
5. Verify Windows → Mac → Windows fallback using **Section 6**.

**Not expected yet:** a dedicated Windows Volume screen, Windows Media app, host status dashboard, Discord controls, PC stats, or configurable hardware-button mappings. Those require later **My-Turne** UI/daemon sprints, even though the Windows Connector already exposes several of the underlying RPCs/events.

---

## 3. Windows PC — build and run the forked Connector

### 3.1 First-time prerequisites

On the **Windows PC**, install/configure:

- Git
- [Bun](https://bun.sh/) (`bun --version`)
- [Rust + Cargo](https://rustup.rs/) with a **Windows MSVC** toolchain (`cargo --version`)
- Visual Studio Build Tools / MSVC C++ workload and an appropriate Windows SDK for native Windows Rust dependencies
- A working Bluetooth adapter and the normal Windows Bluetooth pairing path
- `just` is **optional**; the core developer commands below do not require it

Check tools in **PowerShell**:

```powershell
bun --version
cargo --version
rustup show active-toolchain
git --version
```

> A preinstalled upstream **Nocturne Connector** is *not* automatically your fork. **Completely quit the stock Connector from the system tray** before running your custom one. The native app uses single-instance behavior; running two copies can produce misleading results.

### 3.2 Update sources

```powershell
# If not already cloned:
git clone https://github.com/alexliu4/my-turne-connector.git
cd my-turne-connector

# On subsequent updates, from the repo root:
git switch main
git pull --ff-only
git rev-parse --short HEAD
```

Record the commit hash so you know which Connector build was tested. Only merged `main` features are included; an **open** Connector PR is not included unless you deliberately check out its branch.

### 3.3 Build the TypeScript server and embedded web client

Run from the **connector repo root**:

```powershell
cd src
bun install
cd ..

bun windows/scripts/generate-bridge-types.ts

cd src
bun run check
bun run build
cd ..

bun windows/scripts/build-server.ts
```

The last step produces the packaged Windows server sidecar, including:

```text
windows/binaries/nocturne-connector-server-x64.exe
windows/binaries/nocturne-connector-server-arm64.exe
windows/binaries/client/
```

### 3.4 Run the native Windows host (fastest dev option)

Still from the **repo root** in PowerShell, on a normal Intel/AMD x64 Windows PC:

```powershell
$env:NOCTURNE_SERVER_EXECUTABLE = (Resolve-Path ".\windows\binaries\nocturne-connector-server-x64.exe").Path
cargo run --release --manifest-path .\windows\Cargo.toml
```

This compiles and launches the native Tauri/tray host from your checkout. The host starts/supervises the server sidecar, which handles Connector services and Bluetooth. Open the Connector interface via the launched window or tray icon and pair/configure Car Thing as you normally would.

**On Windows ARM64:** don't point the native host at the x64 sidecar; use the matching ARM64 build/toolchain instead.

**Important:** This is a *developer-run* build, not an installed release or update to the stock Connector. Run it again whenever you want to test new source changes; rebuilding server code without restarting the native host/sidecar doesn't replace an already running process.

### 3.5 Optional: build the installable Windows app

Your fork's `Justfile` defines:

```powershell
just windows-check
just windows-test
just windows-universal
```

`just windows-universal` builds **both x64 and ARM64 native hosts**, their sidecars, and an NSIS installer. Besides Rust/Bun, this requires the relevant ARM64 toolchain and [NSIS](https://nsis.sourceforge.io/). Its installer goes under:

```text
windows/bundles/nocturne-connector_<version>_windows_setup.exe
```

**For Sprint 2, prefer Section 3.4.** The universal build is more demanding and the installer deliberately terminates/replaces the existing **Nocturne Connector** install under your Windows user profile. Keep a stock installer available before trying the custom installer if you want an easy return path.

### 3.6 Connector verification

- The custom Connector launches and remains available from the Windows tray.
- Car Thing can pair/connect over **Bluetooth** (no USB runtime data cable).
- Normal Nocturne / Spotify behavior is intact where supported.
- The Connector sends `app.ready` with `platform: "web"` **and** `connectorPlatform: "windows"`.
- System Media is enabled in Connector settings (on by default unless disabled previously).
- With browser video/audio playing, system-media metadata should be available from Windows' **GSMTC** media session API. An application must expose a usable media session to GSMTC; not every browser page does.

You can inspect Connector system-media service state through its local API (when the server is running), e.g. `/api/media/status` on the Connector's *actual localhost server port*. Do **not** confuse this internal Windows-only localhost service with the **retired Car Thing → Windows LAN WebSocket** design. The service port is dynamic for the bundled native host; don't assume `8893`.

---

## 4. Mac mini — build and deploy the Car Thing daemon

**Sprint 1 changed the daemon.** Updating only the UI will not install Windows preference, Mac fallback, or phone-readiness handling.

### 4.1 First-time prerequisites

On the **Mac mini**:

- An updated `my-turne` clone
- `just`
- Either an existing functional **Cross + Docker** build setup, **or** this repo's existing **Yocto** build environment
- A data-capable USB development connection from Mac to Car Thing, giving you SSH access at `root@nocturne.local`

Check the device connection:

```bash
ssh root@nocturne.local 'hostname; systemctl is-active nocturned || true'
```

If this fails, resolve USB networking / device SSH first. **Do not flash a new image just because `nocturne.local` isn't reachable.** This hostname in your setup is typically reached over the temporary USB development network, not over Windows Bluetooth.

### 4.2 Update My-Turne sources

```bash
# If not already cloned:
git clone https://github.com/alexliu4/my-turne.git
cd my-turne

# Otherwise, from the existing repo root:
git switch main
git pull --ff-only
git rev-parse --short HEAD
```

My-Turne PR #10 (Windows preference + phone coexistence) is merged into `main` as of this guide's date. Record the current commit for your deployment log.

### 4.3 Preferred option when Cross is already configured

From the **My-Turne repo root**:

```bash
just daemon-deploy-cross
```

The recipe runs the equivalent of:

```bash
cross build -p nocturned --target=aarch64-unknown-linux-gnu --release --features device
just daemon-install nocturne.local target/aarch64-unknown-linux-gnu/release/nocturned
```

The `device` feature and ARM64 Linux target matter. **Do not** deploy the binary produced by `just daemon-host`: that binary is intended for your development machine, not Car Thing.

`daemon-install` uploads the binary to the existing bandaid daemon overlay, preserves the previous daemon binary, activates the new binary, restarts device services, and prints hashes to help verify the running executable.

If `cross` is missing, install/configure it together with Docker and your project's required target setup, **or choose the existing Yocto workflow below**. Do not substitute a host-only `cargo build` binary.

### 4.4 Alternative: build with Yocto

If your existing Yocto environment is already functional, from **My-Turne repo root**:

```bash
just daemon-deploy
```

The `Justfile` builds `nocturned` under `image/` and installs the resulting Car Thing binary using the same `daemon-install` operation. This may be much heavier than the Cross build, and depends on your established Yocto setup.

If you've **already** built a suitable new ARM64 **device-feature** binary, you can install it without rebuilding:

```bash
just daemon-install nocturne.local /absolute/path/to/your/nocturned
```

Only do this if you know the binary is for the correct Car Thing target and source revision.

### 4.5 Verify daemon deployment

```bash
ssh root@nocturne.local '
  systemctl is-active nocturned;
  sha256sum /opt/nocturne/daemon/nocturned.current;
  pidof nocturned.current || true
'
```

To inspect logs after a failure:

```bash
ssh root@nocturne.local 'journalctl -u nocturned -n 100 --no-pager'
```

After successful deployment, **disconnect the USB development cable** and test normal Bluetooth operation. The runtime must not depend on that cable.

> **When is a full image needed?** Only if you intentionally change low-level firmware/Yocto/base OS components or the overlay-based upgrade mechanism isn't suitable. It is **not** required just to deploy PR #10.

---

## 5. Optional — deploy React UI changes only

You **do not need this for the basic Sprint 1 Windows route-preference test** if the deployed UI already handles the existing `media.now_playing.update`/`media.now_playing.artwork` events. Use it when your fork's UI changes (for example, future Windows Volume/Media screens) or when you specifically need updated UI behavior.

### 5.1 Build UI on Mac mini

From `my-turne` repo root:

```bash
cd packages/ui
bun install
bun run build
cd ../..
```

Or, if `just` is installed:

```bash
just ui-build
```

The generated site is `packages/ui/dist/`.

### 5.2 If UI was built on Windows, transfer `dist` to Mac

From the **My-Turne repo root** in **Windows PowerShell** (replace the placeholders with your real Mac username/address/repo path):

```powershell
cd packages\ui
bun install
bun run build
cd ..\..

ssh <MAC_USER>@<MAC_IP> 'rm -rf ~/my-turne/packages/ui/dist'
scp -r .\packages\ui\dist <MAC_USER>@<MAC_IP>:~/my-turne/packages/ui/
```

If your Mac clone isn't in `~/my-turne`, adjust the destination appropriately. Building directly on Mac is simpler when available.

### 5.3 Deploy the static UI via `tar | ssh`

On the **Mac mini**, from `my-turne` repo root, with USB development SSH available:

```bash
test -f packages/ui/dist/index.html || { echo 'Missing UI build'; exit 1; }

tar -C packages/ui/dist -cf - . | \
ssh root@nocturne.local '
  set -e
  rm -rf /opt/nocturne/webapps/ui.next
  mkdir -p /opt/nocturne/webapps/ui.next
  tar -C /opt/nocturne/webapps/ui.next -xf -
  rm -rf /opt/nocturne/webapps/ui.previous
  mv /opt/nocturne/webapps/ui /opt/nocturne/webapps/ui.previous
  mv /opt/nocturne/webapps/ui.next /opt/nocturne/webapps/ui
  systemctl restart chromium-kiosk.service
'
```

This avoids `rsync`, which is **not installed on your production Car Thing**. The remote `ui.previous` directory provides a basic rollback option.

Verify the UI build matches:

```bash
shasum -a 256 packages/ui/dist/index.html
ssh root@nocturne.local 'sha256sum /opt/nocturne/webapps/ui/index.html'
```

The two hashes should match.

**Important:** Old guide sections describing `VITE_WINDOWS_HOST_URL`, `VITE_WINDOWS_TOKEN`, a Windows LAN port (`8893`), or running `nocturne-windows-companion` are **obsolete**. Do not set these variables to make the Bluetooth Connector work.

---

## 6. Sprint 2 — real hardware acceptance checklist

Before testing: the latest daemon is running on Car Thing, your **forked** Windows Connector is running on Windows, and Mac Connector is available as fallback. Perform these tests with **no USB runtime data connection**.

### A. Connection and priority

- [ ] **Windows alone:** Pair/connect Car Thing with the forked Windows Connector. Verify normal Nocturne functions remain usable.
- [ ] **Mac first, then Windows:** With Mac working, start/connect Windows. Windows should be selected as the preferred desktop route.
- [ ] **Mac reconnects:** Reconnect/restart Mac while Windows is healthy. Mac must **not** steal desktop route ownership.
- [ ] **Windows disconnects:** Exit/disconnect Windows Connector. Mac should become the active surviving route.
- [ ] **Windows returns:** Start/reconnect Windows Connector. Windows should become preferred again.
- [ ] **Sleep/wake:** Put the Windows PC to sleep and wake it. Check stale-route cleanup and eventual recovery.

Expected ownership sequence:

```text
Mac  →  Windows  →  Mac (Windows offline)  →  Windows (reconnected)
```

**Interpretation:** Sprint 1 implemented registry selection rules; this is where you prove those rules work on actual connections. Current My-Turne UI has **no dedicated Windows-active status panel**, so judge the route with logs and Windows-specific behavior rather than waiting for a new status screen.

### B. Windows YouTube / native media

- [ ] **YouTube:** Play video/audio in Chrome or Edge. Look at the *existing* Car Thing Now Playing screen for title, source application, playback status/progress, and available artwork.
- [ ] **Controls:** Try play/pause and, where a media session supports them, next/previous. Record whether the existing UI routes each action correctly.
- [ ] **Another app:** Repeat with a Windows media player to distinguish Connector/GSMTC issues from browser-specific ones.
- [ ] **Reconnect playback:** Disconnect/reconnect Windows Bluetooth; inspect whether cached now-playing metadata/artwork return.
- [ ] **Spotify policy:** If Spotify is linked, direct Spotify integration normally wins over Windows GSMTC Spotify metadata to avoid duplicates. If Spotify is skipped/unlinked, Windows system media can supply Spotify desktop metadata.

**What is not guaranteed yet:** dedicated Windows Media UI, physical-knob mapping to Windows master volume, complete mute indicator, or every transport action. The Connector implements underlying APIs, but My-Turne's dedicated UI/control integration comes in later sprints.

**Optional phone-coexistence check:** with Windows still preferred, reconnect an Android/iOS companion. The daemon should emit `phone.session.ready` with its transport-observed Bluetooth peer without switching desktop ownership; the UI can then refresh that phone's call snapshot.

### C. Windows RPC capabilities (advanced smoke test)

The merged Windows Connector implements these native-side methods:

| Method | Parameters | Expected purpose |
| --- | --- | --- |
| `volume.get` | `{}` | Read Windows master volume and mute state |
| `volume.set` | `{ "volume_percent": 35 }` | Set Windows master volume to 35% |
| `volume.adjust` | `{ "delta": 5 }` | Adjust master volume by +5 percentage points |
| `volume.toggleMute` | `{}` | Toggle master mute |
| `media.control.toggle` | `{}` | Play/pause current Windows system-media session |
| `media.control.next` | `{}` | Skip to next item, if supported |
| `media.control.previous` | `{}` | Skip to previous item, if supported |

These are **Connector-facing RPCs**, **not** URLs to paste into a Windows browser. To exercise them end-to-end, a Car Thing UI/request client must forward them through the daemon's existing RPC path. A dedicated Windows controls UI/test surface is planned for subsequent My-Turne sprints. **Do not assume existing physical controls have already been remapped to these methods.**

### D. Record results

| Test | Result (Pass / Fail / Untested) | Notes |
| --- | --- | --- |
| Windows paired without USB | | |
| Windows preferred over connected Mac | | |
| Mac fallback on Windows exit | | |
| Windows regains ownership on restart | | |
| Mac reconnect cannot steal Windows ownership | | |
| YouTube title/playback metadata | | |
| Artwork and media progress | | |
| Media controls | | |
| Windows sleep/wake recovery | | |

Record which exact builds you used:

```text
Test date:
Car Thing my-turne commit:
Windows Connector commit:
Mac Connector version:
Windows version:
Car Thing daemon active hash:
Summary / reproducible failures:
```

---

## 7. Troubleshooting

### Windows app starts but Car Thing still behaves like ordinary Nocturne

1. Verify you're actually running **your forked Connector** rather than the stock installed app. Completely quit old tray processes.
2. Check that Windows and Car Thing are paired over Bluetooth and the Connector reports a real connection.
3. Verify the Car Thing is running the **updated** `nocturned` executable (Section 4.5). A GitHub merge is not a device deployment.
4. Check Windows' `app.ready` identity: it must keep `platform: "web"` and add `connectorPlatform: "windows"`.
5. Do not troubleshoot LAN IP addresses or port `8893`. Those aren't used by this architecture.

### YouTube plays on PC but Car Thing shows nothing

1. Verify Windows Connector connectivity and that the **System Media** option is enabled.
2. Check that Chrome/Edge actually exposes the playing media through Windows GSMTC; test another video or native media player.
3. Check whether Spotify-linked filtering is intentionally suppressing Spotify system-media events (that should not suppress unrelated YouTube playback).
4. Check that the **My-Turne daemon** is current and passing `media.now_playing.update`/artwork to its local UI WebSocket.
5. If event delivery works but the screen doesn't show it, debug current UI presentation/Spotify-priority behavior. Don't assume the dedicated Windows Media app has been built.

### `just: command not found`

Install `just` or run the equivalent commands shown in this guide. `just` is a task runner; it isn't needed in the Windows program at runtime.

### `cross: command not found` or cross-compilation fails

`just daemon-deploy-cross` requires a working `cross` and Docker setup. You can use `just daemon-deploy` **only if your Yocto build environment is already configured**, or install/setup the required cross-build dependencies. Do not install a binary compiled for macOS onto the Car Thing.

### `ssh: Could not resolve hostname nocturne.local` / connection refused

Confirm that the temporary USB development network is working, the Car Thing is booted, and SSH is reachable. The Windows Bluetooth Connector does **not** provide that SSH network route. An SSH failure alone doesn't imply the Bluetooth runtime is broken.

### `rsync: command not found` during UI deployment

Use **Section 5.3** (`tar | ssh`) instead of `image/scripts/nocturne-push-webapp`, which expects `rsync` on the device.

### Windows volume doesn't show the mute state

Connector RPCs return both volume and mute. The current Car Thing daemon's volume UI event path does not fully propagate `muted` for presentation. That is later **My-Turne** integration work; it doesn't mean `volume.toggleMute` is missing from the Windows Connector.

### Windows local build fails with a Tauri/Windows toolchain error

Confirm you're using the Windows MSVC Rust toolchain and that Visual Studio C++ build tools and Windows SDK are installed. The optional `just windows-universal` build also needs NSIS and a functional ARM64 toolchain; you don't need it for the local x64 dev run.

---

## 8. Rollback (development deployments)

### 8.1 Revert the Car Thing daemon to the previous binary

The repo's `daemon-install` recipe saves `nocturned.previous`. With USB SSH available, from your Mac:

```bash
ssh root@nocturne.local '
  set -eu
  base=/var/lib/bandaid/nocturne/daemon
  test -f "$base/nocturned.previous"
  systemctl stop nocturned || true
  cp "$base/nocturned.previous" "$base/nocturned.rollback"
  chmod 0755 "$base/nocturned.rollback"
  mv "$base/nocturned.rollback" "$base/nocturned.current"
  systemctl restart superbird-weston
  systemctl restart nocturned
  systemctl is-active nocturned
'
```

Only do this when a valid `.previous` backup exists. This is a **developer rollback**, not a published OTA downgrade. Recheck Car Thing operation afterward.

### 8.2 Revert the React UI to the previous build

```bash
ssh root@nocturne.local '
  set -eu
  base=/opt/nocturne/webapps
  test -d "$base/ui.previous"
  rm -rf "$base/ui.failed"
  mv "$base/ui" "$base/ui.failed"
  mv "$base/ui.previous" "$base/ui"
  systemctl restart chromium-kiosk.service
'
```

### 8.3 Revert Windows Connector

For the **development run**, quit the fork's tray process and reopen your previously installed stock Connector (or rebuild/check out the previously tested fork revision). For an **installer replacement**, reinstall your saved previous/stock installer if necessary. The universal installer uses the standard Nocturne Connector install location and may replace an existing version.

---

## 9. Repeatable everyday development loop

| You changed... | Run/build | Deploy/restart |
| --- | --- | --- |
| Windows Connector TypeScript or Rust | Section 3.3 + 3.4 | Restart local forked Windows app |
| Car Thing daemon Rust | Section 4.3 or 4.4 | Deploy updated daemon over USB SSH |
| React UI only | Section 5.1 or 5.2 | Section 5.3 `tar \| ssh` + restart kiosk |
| Both daemon and UI | Both build paths | Deploy daemon, then UI; test together |
| Base OS/kernel/Yocto image | Repo image/OTA workflow | Separate firmware operation, not normal iteration |

### Copy/paste quick reference

**Windows PowerShell — after pulling Connector changes:**

```powershell
cd src
bun install
cd ..
bun windows/scripts/generate-bridge-types.ts
cd src
bun run check
bun run build
cd ..
bun windows/scripts/build-server.ts
$env:NOCTURNE_SERVER_EXECUTABLE = (Resolve-Path ".\windows\binaries\nocturne-connector-server-x64.exe").Path
cargo run --release --manifest-path .\windows\Cargo.toml
```

**Mac terminal — after pulling My-Turne daemon changes:**

```bash
ssh root@nocturne.local 'hostname'
just daemon-deploy-cross  # if cross/Docker is configured
# OR:
# just daemon-deploy  # if your Yocto environment is configured
```

**Mac terminal — when React UI source changes:**

```bash
just ui-build
tar -C packages/ui/dist -cf - . | ssh root@nocturne.local '
  set -e
  rm -rf /opt/nocturne/webapps/ui.next
  mkdir -p /opt/nocturne/webapps/ui.next
  tar -C /opt/nocturne/webapps/ui.next -xf -
  rm -rf /opt/nocturne/webapps/ui.previous
  mv /opt/nocturne/webapps/ui /opt/nocturne/webapps/ui.previous
  mv /opt/nocturne/webapps/ui.next /opt/nocturne/webapps/ui
  systemctl restart chromium-kiosk.service
'
```

> **Decision rule:** For today's YouTube test, run the first two blocks, not the UI block. Later dedicated Windows UI changes will require the third block as well.

---

## 10. Canonical project references

- My-Turne repo: https://github.com/alexliu4/my-turne
- My-Turne sprint plan: https://github.com/alexliu4/my-turne/blob/main/jules_my_turne_windows_sprints.md
- My-Turne daemon build/deploy recipes: https://github.com/alexliu4/my-turne/blob/main/Justfile
- Native Windows Connector repo: https://github.com/alexliu4/my-turne-connector
- Native Windows Connector sprint plan: https://github.com/alexliu4/my-turne-connector/blob/main/jules_my_turne_native_windows_connector_sprints.md
- Windows Connector build recipes: https://github.com/alexliu4/my-turne-connector/blob/main/Justfile
- Windows media architecture, RPCs, and tests: https://github.com/alexliu4/my-turne-connector/blob/main/docs/windows-media-architecture.md

**Suggested placement in your repository:** `my_turne_deployment_guide.md` at the root of `my-turne`, or `docs/deployment/my-turne-bluetooth-development.md` if you later add a docs directory. This file is a standalone guide and does **not** modify either repository automatically.
