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

## 5. Sending Commands (Vuex Mutations/Actions)

Commands are dispatched via the Vuex store. Evaluate these via CDP `Runtime.evaluate`.

### Playback Control
```javascript
// Play
window.App.$store.dispatch('player/play')

// Pause
window.App.$store.dispatch('player/pause')

// Skip to next
window.App.$store.dispatch('player/next')

// Go to previous
window.App.$store.dispatch('player/previous')

// Seek to position (milliseconds)
window.App.$store.dispatch('player/seekTo', { position: 60000 })

// Set volume (0.0 - 1.0)
window.App.$store.dispatch('player/setVolume', { volume: 0.8 })

// Toggle mute
window.App.$store.dispatch('player/toggleMute')

// Toggle shuffle
window.App.$store.dispatch('player/toggleShuffle')

// Set repeat ('NONE' | 'ALL' | 'ONE')
window.App.$store.dispatch('player/setRepeat', { repeatSetting: 'ALL' })
```

> **Note:** Exact action names were inferred from the Vuex store structure and Vue DevTools conventions.
> If an action fails silently, inspect `window.App.$store._actions` to enumerate all registered actions:
> ```javascript
> Object.keys(window.App.$store._actions)
> ```

### Enumerate All Actions
```javascript
JSON.stringify(Object.keys(window.App.$store._actions))
```

### Enumerate All Mutations
```javascript
JSON.stringify(Object.keys(window.App.$store._mutations))
```

---

## 6. CDP Helper — Python

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

## 13. Important Caveats

- **CEF CSP blocks outbound fetch/XHR from the Morpho page to localhost.** Do not try to push data out from inside the app. Pull via CDP instead.
- **Old JS engine in CEF** — optional chaining (`?.`), nullish coalescing (`??`), and some ES2020+ features may not work in injected JS. Use `&&` guards.
- **No official API** — Amazon Music Web API is closed beta. This approach uses internal app state only.
- **DRM** — audio streams are Widevine-encrypted. This documentation covers metadata only, not audio.
- **Fragility** — Vuex action names and store shape may change with app updates. Pin your Amazon Music version if stability matters.
- **ToS** — personal/non-commercial use only. Do not redistribute audio metadata at scale or build competing services.