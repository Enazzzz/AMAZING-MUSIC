# Amazon Music Desktop — Reverse Engineering Documentation

## Overview

Amazon Music Desktop is a **CEF (Chromium Embedded Framework)** application wrapping a **Vue.js + Vuex** web app
served from `https://www.amazon.com/morpho/webapp/index.html`. The entire UI state is accessible via the
Chrome DevTools Protocol (CDP), which can be activated at launch with a single flag.

---

## 1. Launching with Debug Access

### Command
```
"C:\Users\<USER>\AppData\Local\Amazon Music\Amazon Music.exe" --remote-debugging-port=9222
```

### Hiding the Window (Windows)
Use `pywin32` to find and hide the window after launch:
```python
import win32gui, win32con
hwnd = win32gui.FindWindow(None, 'Amazon Music')
win32gui.ShowWindow(hwnd, win32con.SW_HIDE)
```

Window title is exactly: `Amazon Music`

---

## 2. Connecting via CDP

### Discover Targets
```
GET http://localhost:9222/json
```

Returns a JSON array of targets. The main app target has:
```json
{
  "url": "https://www.amazon.com/morpho/webapp/index.html#/...",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/<ID>"
}
```

Filter for targets where `url` contains `amazon.com/morpho`.

### WebSocket Connection
Connect to `webSocketDebuggerUrl` using any WebSocket client.

All messages follow the CDP format:
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "<JS string>",
    "returnByValue": true
  }
}
```

Response:
```json
{
  "id": 1,
  "result": {
    "result": {
      "type": "string",
      "value": "<returned value>"
    }
  }
}
```

---

## 3. App Architecture

- **Framework:** Vue.js (not React)
- **State management:** Vuex store at `window.App.$store`
- **Router:** Vue Router at `window.App.$route`
- **Internal codename:** Morpho
- **CEF version:** Old (does not support optional chaining `?.` in injected JS — use `&&` guards instead)

---

## 4. Reading State

### Full State Extraction (safe, null-guarded)
```javascript
(function() {
  try {
    const s = window.App.$store.state;
    const p = s.player;
    if (!p.model.currentPlayable) return null;
    return JSON.stringify({
      // Current track
      title:      p.model.currentPlayable.track.title,
      artist:     p.model.currentPlayable.track.artist.name,
      album:      p.model.currentPlayable.track.album.name,
      art:        p.model.currentPlayable.track.album.image,
      asin:       p.model.currentPlayable.track.asin,
      trackId:    p.model.currentPlayable.track.trackUniqueId,
      duration:   p.model.duration,         // milliseconds
      hasLyrics:  p.model.currentPlayable.track.hasLyrics,

      // Playback
      currentTime: p.progress.currentTime,  // milliseconds
      isPlaying:   p.model.state === 'PLAYING',
      shuffle:     p.settings.shuffle,
      repeat:      p.settings.repeatSettings, // 'NONE' | 'ALL' | 'ONE'
      volume:      p.settings.volume,        // 0.0 - 1.0
      muted:       p.settings.muted,
      tempo:       p.settings.tempo,         // 1 = normal speed

      // Quality
      quality:    p.settings.audioQualitySetting, // 'STANDARD' | 'HD' | 'ULTRA_HD'
      bitrate:    p.model.audioAttributes && p.model.audioAttributes.bitrate,
      bitDepth:   p.model.audioAttributes && p.model.audioAttributes.bitDepth,
      sampleRate: p.model.audioAttributes && p.model.audioAttributes.sampleRate,

      // Output device
      device: p.model.outputDeviceAttributes &&
              p.model.outputDeviceAttributes.currentDevice &&
              p.model.outputDeviceAttributes.currentDevice.displayName,

      // Queue
      nextTitle:  p.model.nextPlayable && p.model.nextPlayable.track.title,
      nextArtist: p.model.nextPlayable && p.model.nextPlayable.track.artist.name,
      nextArt:    p.model.nextPlayable && p.model.nextPlayable.track.album.image,

      // Playlist context
      playlistName: p.model.currentPlayable.containerInfo.containerName,
      playlistId:   p.model.currentPlayable.containerInfo.id,
      playlistType: p.model.currentPlayable.containerInfo.type,

      // Lyrics (timestamped, from LyricFind via Amazon)
      lyrics: p.model.currentPlayable.track.lyricsData || null
    });
  } catch(e) {
    return null;
  }
})()
```

### Lyrics Format
`lyricsData.lyrics.lines` is an array of:
```json
{
  "startTime": 51639,
  "endTime":   54328,
  "text":      "I'm floating down a river"
}
```
Times are in **milliseconds**. Lines with `text === "..."` are instrumental sections.

### Individual State Paths
```javascript
window.App.$store.state.player.model.state                          // 'PLAYING' | 'PAUSED' | 'STOPPED'
window.App.$store.state.player.model.currentPlayable.track.title    // current track title
window.App.$store.state.player.progress.currentTime                 // ms elapsed
window.App.$store.state.player.model.duration                       // ms total
window.App.$store.state.player.settings.volume                      // 0.0-1.0
window.App.$store.state.player.model.audioAttributes.bitrate        // bits/sec
window.App.$store.state.player.model.outputDeviceAttributes.devices // all audio devices
```

---

## 5. Sending Commands — Direct Internal Function Calls (Proven Working)

Amazon Music uses an internal **Command pattern** and a **Player module** (webpack module `"0903"`)
that wraps a native bridge (`s["a"].execute("Player.*")`). Vuex `dispatch("player/*")` actions
update state but **do not drive the audio engine**. To actually control playback, you must call
the internal Player module's methods directly.

### Accessing the Internal Player Module via CDP

The Player module is not exposed on `window` directly. To reach it, inject a webpack require
resolver via CDP, then load module `"0903"`:

```javascript
// Step 1: Resolve webpack require (run once per session)
(function() {
    if (typeof window.__amazon_require__ === "function") return;
    if (!window.webpackJsonp || !window.webpackJsonp.push) return;
    window.webpackJsonp.push([
        ["__am_req_chunk__"],
        {
            "__am_req_module__": function(module, exports, req) {
                window.__amazon_require__ = req;
            }
        },
        [["__am_req_module__"]]
    ]);
})()

// Step 2: Load the Player module and call methods
(function() {
    var req = window.__amazon_require__;
    var playerModule = req("0903");
    var player = playerModule.a;  // the exported controller object
    player.playNext();            // actually skips the track
})()
```

**Status:** Tested and confirmed working via CDP `Runtime.evaluate` from a Node script.
`player.playNext()` successfully skips tracks in real time.

### Player Module API (webpack module `"0903"`)

All methods below are on the exported object (`playerModule.a`). Each delegates to
the native bridge via `s["a"].execute("Player.<method>")`.

| Method | Args | Description |
|---|---|---|
| `playNext()` | none | Skip to next track (respects skip limits for free-tier) |
| `playPrevious()` | none | Go to previous track |
| `setPaused(paused)` | `boolean` | `true` = pause, `false` = resume |
| `setVolume(vol)` | `number` 0.0–1.0 | Set playback volume |
| `toggleMute()` | none | Toggle mute on/off |
| `setShuffle(on)` | `boolean` | `true` = enable shuffle, `false` = disable |
| `toggleRepeat()` | none | Cycle repeat mode (NONE → ALL → ONE → NONE) |
| `seek(posMs, type)` | `number`, optional type | Seek to position in milliseconds |
| `setAudioQuality(q)` | `string` | Set quality (`'STANDARD'`, `'HD'`, `'ULTRA_HD'`) |
| `setOutputDevice(id)` | `string` | Switch audio output device by device ID |
| `startPlayback(e, t, a, i, n, r)` | complex | Start playing a specific track/collection |
| `startCollectionPlayback(e, t, a)` | complex | Start playing a collection |
| `stopPlayback(reason)` | `string` | Stop playback entirely |
| `insertNext(tracks, t, a)` | array | Insert tracks to play next in queue |
| `appendTracks(tracks, t, a)` | array | Append tracks to end of queue |
| `reorderPlayables(e, t)` | complex | Reorder items in play queue |
| `removeFromPlayQueue(ids)` | `string[]` | Remove tracks from queue by ID |
| `toggleLoudnessNormalization()` | none | Toggle loudness normalization |
| `setExclusiveMode(on)` | `boolean` | Toggle exclusive audio device mode |
| `toggleAutoplay()` | none | Toggle autoplay |

### Player Module Architecture

The module uses a **strategy pattern**. The exported object (`t["a"]`) delegates each method
to `this.getStrategy(methodName)`, which walks an array of strategy objects and calls the first
one that implements the method. The default strategy (internal `_` object) calls the native
bridge directly:

```
t["a"].playNext()
  → getStrategy("playNext")
    → _.playNext()
      → s["a"].execute("Player.playNext")   // native CEF bridge call
```

### Player Module State (read-only)

The module also exposes reactive state objects:

```javascript
var player = req("0903").a;
player.model              // playerModel — current track, state, audio attributes, queue
player.settings           // playerSettings — volume, shuffle, repeat, quality, tempo
player.playbackProgress   // playbackProgress — currentTime, buffered (ms)
```

These are the same objects backing `window.App.$store.state.player.*`.

### Vuex Dispatch (State-Only — Does NOT Drive Audio)

> **WARNING:** `window.App.$store.dispatch("player/next")` and similar Vuex actions
> update the Vuex store state but **do not actually control the audio engine**.
> They are useful only for reading state reactively. For actual playback control,
> use the Player module methods above.

Vuex dispatches that fire during navigation (confirmed via hook):

```javascript
window.App.$store.dispatch("history/addParamsToRoute", { index: N, params: {...} })
window.App.$store.dispatch("history/add", { name: "findLanding", path: "/find", ... })
window.App.$store.dispatch("history/modifyCurrentRoute", { ... })
```

### Search (Vuex Commits)

Search uses Vuex **commits** (mutations), not dispatches:

```javascript
this.$store.commit("search/searchForKeyword", { keyword: "query", ... })
this.$store.commit("search/changeKeyword", { keyword: "query" })
```

### All Known Command Classes (from app.js)

These are the internal Command pattern classes. Each has a `commandName` and an
`operation(callback)` method. They are instantiated and called via `new Cmd().execute()`.

| Command Name | Webpack Module ID | Description |
|---|---|---|
| `PlayNextTrack` | `4e8c` | Skip to next track |
| `PlayPreviousTrack` | `37c0` | Go to previous track |
| `PausePlayback` | `516f` | Pause playback |
| `ResumePlayback` | `a034` | Resume playback |
| `TogglePlayPause` | `e135` | Toggle play/pause |
| `SetVolume` | `64c8` | Set volume (constructor takes 0.0–1.0) |
| `ToggleShuffle` | `8fd3` | Toggle shuffle |
| `ToggleRepeat` | `e95e` | Toggle repeat mode |
| `ToggleMute` | `52519` area | Toggle mute |
| `StartPlayback` | `57456` area | Start playing a track |
| `StopPlayback` | `47152` area | Stop playback |
| `IncreaseVolume` | `58681` area | Increase volume by step |
| `DecreaseVolume` | `48119` area | Decrease volume by step |
| `AddToLibrary` | `4380` area | Add track to library |
| `FollowArtist` | `11765` area | Follow an artist |
| `DeletePlaylist` | `34009` area | Delete a playlist |
| `StartDownload` | `7379` area | Start offline download |
| `ShowSettings` | `42445` area | Open settings view |
| `ShowAddToPlaylistDialog` | `35758` area | Open add-to-playlist dialog |
| `GetLibraryPlaylists` | `35735` area | Fetch library playlists |

### Enumerate All Actions / Mutations

```javascript
JSON.stringify(Object.keys(window.App.$store._actions))
JSON.stringify(Object.keys(window.App.$store._mutations))
```

---

## 6. CDP Helpers

### Python

```python
import websocket, json, urllib.request

def get_ws_url(port=9222):
    with urllib.request.urlopen(f'http://localhost:{port}/json') as r:
        targets = json.loads(r.read())
    for t in targets:
        if 'amazon.com/morpho' in t.get('url', ''):
            return t['webSocketDebuggerUrl']
    return None

def cdp_eval(ws, expression, msg_id=1):
    ws.send(json.dumps({
        'id': msg_id,
        'method': 'Runtime.evaluate',
        'params': {'expression': expression, 'returnByValue': True}
    }))
    result = json.loads(ws.recv())
    return result.get('result', {}).get('result', {}).get('value')

# Usage
ws = websocket.create_connection(get_ws_url())
value = cdp_eval(ws, "window.App.$store.state.player.model.state")
print(value)  # 'PLAYING'
```

### Node.js / TypeScript

```typescript
import http from "node:http";
import WebSocket from "ws";

type CdpTarget = { url?: string; webSocketDebuggerUrl?: string };

async function getMorphoTarget(port = 9222): Promise<CdpTarget> {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/json`, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                const targets = JSON.parse(data) as CdpTarget[];
                const morpho = targets.find(t => t.url && t.url.includes("amazon.com/morpho"));
                morpho ? resolve(morpho) : reject(new Error("No Morpho target"));
            });
        }).on("error", reject);
    });
}

async function sendCdp(ws: WebSocket, msg: { id: number; method: string; params?: unknown }): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const handler = (raw: WebSocket.RawData) => {
            const parsed = JSON.parse(raw.toString()) as { id?: number };
            if (parsed.id === msg.id) { ws.off("message", handler); resolve(parsed); }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify(msg), (err) => { if (err) { ws.off("message", handler); reject(err); } });
    });
}

// Usage
const target = await getMorphoTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl!);
// ... sendCdp(ws, { id: 1, method: "Runtime.evaluate", params: { expression: "...", returnByValue: true } })
```

---

## 7. Known Store Modules

From `window.App.$store.state`:

| Module                          | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `player.model`                  | Playback state, current/next track, audio attributes |
| `player.progress`               | `currentTime` and `buffered` in ms                   |
| `player.settings`               | Volume, shuffle, repeat, quality, tempo              |
| `search`                        | Search state, instant results, history               |
| `marketplace.availableFeatures` | Feature flags (lyrics, podcasts, HD, etc.)           |
| `weblabs`                       | A/B test treatment assignments                       |
| `general`                       | UI state (overlay, queue visibility, locale)         |
| `browser`                       | Window size, online status                           |
| `selection`                     | Selected tracks, drag state                          |
| `download`                      | Download status                                      |

---

## 8. Audio Device Switching

```javascript
// List all devices
window.App.$store.state.player.model.outputDeviceAttributes.devices
// Returns: [{ id: 'default', displayName: 'Headphones (...)' }, ...]

// Switch device (dispatch with device id)
window.App.$store.dispatch('player/setOutputDevice', { deviceId: '<id>' })
```

---

## 9. Feature Flags

Useful flags from `window.App.$store.state.marketplace.availableFeatures`:

| Flag                    | Meaning                      |
| ----------------------- | ---------------------------- |
| `showLyrics`            | Lyrics feature enabled       |
| `enableSonicRush`       | HD/UHD streaming available   |
| `enablePodcasts`        | Podcasts available           |
| `downloadEnabled`       | Offline download available   |
| `sharingEnabled`        | Playlist sharing enabled     |
| `showHiDefUX`           | HD UI enabled                |
| `ghostListeningEnabled` | Background listening enabled |

---

## 10. Vue Router — Navigation

```javascript
// Current route
window.App.$route.path   // e.g. '/library/recents'
window.App.$route.name   // e.g. 'recents'

// Navigate programmatically
window.App.$router.push('/library/playlists')
window.App.$router.push('/nowplaying')
window.App.$router.push('/search')
```

---

## 11. IndexedDB Databases

Available stores (accessible from the Morpho origin):

| Database             | Purpose                        |
| -------------------- | ------------------------------ |
| `amplify-datastore`  | Main app data sync             |
| `bookmark-db`        | Saved/bookmarked tracks        |
| `playbackMetrics-db` | Local playback history/metrics |
| `save-db`            | Saved items                    |
| `follow-db`          | Followed artists/playlists     |
| `categoryfollow-db`  | Followed categories            |
| `completed-db`       | Completed content (podcasts)   |
| `UIMetrics-db`       | UI interaction metrics         |

---

## 12. File Structure Notes

Install location: `%LOCALAPPDATA%\Amazon Music\`

| File/Folder             | Notes                           |
| ----------------------- | ------------------------------- |
| `Amazon Music.exe`      | Main executable — CEF host      |
| `libcef.dll`            | Chromium Embedded Framework     |
| `QtCore4.dll`           | Qt4 native shell (very old)     |
| `dmengine.dll`          | DRM/media engine — do not touch |
| `av.dll`                | Audio/video processing          |
| `tag.dll` / `tag_c.dll` | TagLib — music metadata         |
| `Data/`                 | App data, possibly SQLite       |
| `LibraryDump/`          | Dumped library metadata         |
| `Logs/AmazonMusic.log`  | Live app log                    |
| `Logs/cef_log.txt`      | CEF/browser log                 |
| `User Data/`            | CEF user profile, crash reports |

---

## 13. Webpack Bundle Internals

Amazon Music's frontend is bundled with **webpack** into a single `app.js` file.
The bundle uses the `webpackJsonp` global to load chunks.

### Key Module IDs

| Module ID | Export | Purpose |
|---|---|---|
| `"0903"` | `.a` | **Player controller** — all playback methods, reactive state |
| `"6586"` | `.a` | **Native bridge** — `s["a"].execute("Player.*")` and `s["a"].get("Player")` |
| `"2ef0"` | lodash | Utility library (lodash) |
| `"4e8c"` | Command class | `PlayNextTrack` command |
| `"37c0"` | Command class | `PlayPreviousTrack` command |
| `"516f"` | Command class | `PausePlayback` command |
| `"a034"` | Command class | `ResumePlayback` command |
| `"e135"` | Command class | `TogglePlayPause` command |
| `"8fd3"` | Command class | `ToggleShuffle` command |
| `"e95e"` | Command class | `ToggleRepeat` command |
| `"64c8"` | Command class | `SetVolume` command |

### Resolving `require` at Runtime

Webpack does not expose its internal `require` function globally. To access it:

```javascript
// Inject a synthetic chunk that captures the require function
window.webpackJsonp.push([
    ["__am_req_chunk__"],
    {
        "__am_req_module__": function(module, exports, req) {
            window.__amazon_require__ = req;
        }
    },
    [["__am_req_module__"]]
]);

// Now use it to load any internal module
var player = window.__amazon_require__("0903").a;
```

This technique works because `webpackJsonp.push` processes the synthetic chunk's factory
function, which receives the real `require` as its third argument. The function stashes it
on `window` for later use.

**Important:** This must be injected via CDP `Runtime.evaluate` from an external process.
Running it from the DevTools console may not work reliably because the synthetic chunk
may not meet all internal conditions for execution.

### Native Bridge (`s["a"]` / module `"6586"`)

The native bridge is the lowest-level interface between the web app and the CEF host.
All Player module methods ultimately call through it:

```javascript
s["a"].execute("Player.playNext")       // fire-and-forget command
s["a"].execute("Player.setPaused", true) // command with argument
s["a"].get("Player")                     // returns { playerModel, playerSettings, playbackProgress }
```

The bridge communicates with the native C++ layer via CEF message passing.

---

## 14. UI Element Selectors (data-qaid)

Amazon Music uses `data-qaid` attributes on player control buttons. These can be used
as a fallback for DOM-based interaction, though direct function calls are preferred.

| Selector | Element |
|---|---|
| `button[data-qaid="next"]` | Next track button |
| `button[data-qaid="previous"]` | Previous track button |
| `button[data-qaid="playPause"]` | Play/Pause toggle button |
| `button[data-qaid="shuffle"]` | Shuffle toggle button |
| `button[data-qaid="repeat"]` | Repeat toggle button |

### Clicking via CDP

```javascript
document.querySelector('button[data-qaid="next"]').click()
```

> **Note:** DOM clicks work but are fragile — Amazon can change selectors at any time.
> Prefer direct Player module calls (Section 5) for all production use.

---

## 15. Proven Control Flow (End-to-End)

This is the confirmed working flow for controlling Amazon Music from an external process:

```
External Process (Node.js / Electron)
  │
  ├── 1. Launch Amazon Music with --remote-debugging-port=9222
  │
  ├── 2. GET http://localhost:9222/json → find Morpho target
  │
  ├── 3. Connect WebSocket to webSocketDebuggerUrl
  │
  ├── 4. Inject webpack require resolver (once per session):
  │       Runtime.evaluate → webpackJsonp.push([...])
  │       → window.__amazon_require__ now available
  │
  ├── 5. Load Player module:
  │       var player = window.__amazon_require__("0903").a
  │
  ├── 6. Call methods directly:
  │       player.playNext()
  │       player.setPaused(true)
  │       player.setVolume(0.5)
  │       player.toggleRepeat()
  │       player.setShuffle(true)
  │
  └── 7. Read state via Vuex:
          window.App.$store.state.player.model.*
          window.App.$store.state.player.settings.*
          window.App.$store.state.player.progress.*
```

### What Works vs. What Doesn't

| Approach | Works? | Notes |
|---|---|---|
| Direct Player module calls (`req("0903").a.*`) | **Yes** | Drives the actual audio engine. Proven. |
| DOM button clicks (`data-qaid` selectors) | **Yes** | Works but fragile. Fallback only. |
| Vuex `dispatch("player/*")` | **Partially** | Updates state/history but does NOT drive audio. |
| Vuex `commit("search/*")` | **Yes** | Triggers search. |
| Vue Router `push()` | **Yes** | Navigates between views. |
| Reading Vuex state | **Yes** | Full read access to all player/app state. |

---

## 16. Important Caveats

- **CEF CSP blocks outbound fetch/XHR from the Morpho page to localhost.** Do not try to push data out from inside the app. Pull via CDP instead.
- **Old JS engine in CEF** — optional chaining (`?.`), nullish coalescing (`??`), and some ES2020+ features may not work in injected JS. Use `&&` guards.
- **No official API** — Amazon Music Web API is closed beta. This approach uses internal app state only.
- **DRM** — audio streams are Widevine-encrypted. This documentation covers metadata only, not audio.
- **Fragility** — Webpack module IDs, Vuex action names, and store shape may change with app updates. Pin your Amazon Music version if stability matters.
- **Webpack require injection** — The `webpackJsonp.push` trick works from CDP injection but may not work from the DevTools console. Always inject via `Runtime.evaluate` from an external script.
- **Player module export** — The Player controller is on `require("0903").a` (not `.default`). If the bundle changes, check for `.a`, `.default`, or the module itself.
- **ToS** — personal/non-commercial use only. Do not redistribute audio metadata at scale or build competing services.

---

## 17. Project File Map

| Path | Purpose |
|---|---|
| `src/main/main.ts` | Electron main process entry point |
| `src/main/amazonLauncher.ts` | Amazon Music process lifecycle, CDP connection, state polling |
| `src/main/cdp/cdpClient.ts` | Minimal CDP WebSocket client |
| `src/main/cdp/amazonBridge.ts` | JS expression builders for CDP evaluate calls |
| `src/main/windows/win32WindowHider.ts` | Native window hiding via node-window-manager |
| `src/main/ipc/registerIpcHandlers.ts` | Electron IPC handler registration |
| `src/main/launcherConfig.ts` | Launcher configuration and defaults |
| `src/main/configStore.ts` | Persistent config storage (amazonExePath) |
| `src/preload/preload.ts` | Secure bridge between main and renderer |
| `src/renderer/app.ts` | Renderer UI logic |
| `src/renderer/index.html` | Renderer HTML with CSP |
| `src/renderer/styles.css` | Renderer styles |
| `src/shared/types.ts` | Shared TypeScript interfaces |
| `tests/dev-direct-next.ts` | Standalone test: direct Player.playNext() via CDP |
| `tests/dev-next.ts` | Standalone test: DOM button click via CDP |
| `exported/app.js` | Extracted Amazon Music webpack bundle (reference) |
| `exported/html.html` | Extracted Amazon Music UI HTML (reference) |