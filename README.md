# AMAZING MUSIC

A custom Electron-based launcher for Amazon Music Desktop that communicates with the app through direct internal function calls via the Chrome DevTools Protocol (CDP).

## What This Does

Amazon Music Desktop is a CEF (Chromium Embedded Framework) app wrapping a Vue.js web app. This project:

1. **Launches** Amazon Music with debug access enabled (`--remote-debugging-port=9222`)
2. **Connects** to the app's internal runtime via CDP WebSocket
3. **Injects** a webpack require resolver to access internal modules directly
4. **Controls** playback through the native Player module — no UI simulation, no fragile DOM clicks
5. **Reads** full player state (track info, lyrics, queue, audio quality, devices) via Vuex store
6. **Hides** the native Amazon Music window, presenting its own custom UI

## How It Works

```
Electron Launcher
  │
  ├── Spawns Amazon Music with --remote-debugging-port=9222
  ├── Discovers Morpho target via GET /json
  ├── Connects CDP WebSocket
  ├── Injects webpack require resolver (once per session)
  ├── Loads Player module: require("0903").a
  │
  ├── Controls:  player.playNext(), player.setPaused(true), player.setVolume(0.5), ...
  └── Reads:     window.App.$store.state.player.*
```

The key insight is that Vuex `dispatch("player/*")` actions only update state — they don't drive the audio engine. The actual playback is controlled by the internal Player module (webpack module `"0903"`), which calls through a native CEF bridge (`s["a"].execute("Player.*")`). We access this module by injecting a synthetic webpack chunk that captures the internal `require` function.

See [amazon-music-reverse-engineering.md](amazon-music-reverse-engineering.md) for the full reverse engineering documentation.

## Prerequisites

- **Windows** (tested on Windows 10/11)
- **Amazon Music Desktop** installed at the default location
- **Node.js** 18+

## Setup

```bash
git clone https://github.com/Enazzzz/AMAZING-MUSIC.git
cd AMAZING-MUSIC
npm install
```

## Usage

### Run the Electron launcher

```bash
npm start
```

### Run standalone test scripts

These connect to an already-running Amazon Music instance (launch it manually with `--remote-debugging-port=9222` first):

```bash
# Skip to next track via direct internal function call
npm run dev:direct-next

# Skip to next track via DOM button click (fallback approach)
npm run dev:next
```

### Development

```bash
npm run build       # Compile TypeScript + copy assets
npm run dev         # Build and launch
npm run test        # Run unit tests
npm run typecheck   # Type-check without emitting
```

## Project Structure

```
src/
  main/                          # Electron main process
    main.ts                      # Entry point, app lifecycle
    amazonLauncher.ts            # Amazon Music process + CDP management
    configStore.ts               # Persistent config (exe path)
    launcherConfig.ts            # Configuration defaults
    cdp/
      cdpClient.ts               # Minimal CDP WebSocket client
      amazonBridge.ts            # JS expression builders for CDP
    ipc/
      registerIpcHandlers.ts     # Electron IPC handlers
    windows/
      win32WindowHider.ts        # Native window hiding (Windows)
  preload/
    preload.ts                   # Secure renderer bridge
  renderer/
    app.ts                       # UI logic
    index.html                   # UI markup
    styles.css                   # UI styles
  shared/
    types.ts                     # Shared TypeScript interfaces
tests/
  dev-direct-next.ts             # Standalone: direct Player.playNext() via CDP
  dev-next.ts                    # Standalone: DOM button click via CDP
  amazonBridge.test.ts           # Unit tests
  cdpClient.test.ts              # Unit tests
```

## Player Module API

All methods on `require("0903").a` — the internal Player controller:

| Method | Description |
|---|---|
| `playNext()` | Skip to next track |
| `playPrevious()` | Go to previous track |
| `setPaused(bool)` | Pause (`true`) or resume (`false`) |
| `setVolume(0.0-1.0)` | Set volume |
| `toggleMute()` | Toggle mute |
| `setShuffle(bool)` | Enable/disable shuffle |
| `toggleRepeat()` | Cycle repeat (NONE → ALL → ONE) |
| `seek(ms)` | Seek to position in milliseconds |
| `setAudioQuality(q)` | `'STANDARD'`, `'HD'`, `'ULTRA_HD'` |
| `setOutputDevice(id)` | Switch audio output device |
| `insertNext(tracks)` | Add tracks to play next |
| `appendTracks(tracks)` | Add tracks to end of queue |
| `toggleLoudnessNormalization()` | Toggle loudness normalization |

## Disclaimer

This project is for **personal, non-commercial, educational use only**. It does not extract, intercept, or redistribute any audio streams (which are Widevine DRM-encrypted). It interacts solely with metadata and playback controls through the app's own internal APIs. Amazon Music is a trademark of Amazon.com, Inc.

## License

[MIT](LICENSE)
