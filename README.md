# Morpho (AMAZING-MUSIC)

Morpho is an Electron + CDP toolkit that injects a custom extension panel into the Amazon Music Desktop app.

Current repo focus:

- run Amazon Music with remote debugging
- inject a right-side extension UI into Amazon's own webapp
- control playback through internal bridge/module calls
- run a built-in Group Listening WebSocket server

This is no longer primarily a standalone replacement renderer UI project.

## What It Is Right Now

Amazon Music Desktop is a CEF app running `amazon.com/morpho`. Morpho connects through CDP and injects an in-page extension panel that currently includes:

- Group Listening controls (host/listener join, room code, chat)
- listener sync (pause/resume/seek)
- tempo controls wired to native `Player.setTempo`

Important architecture notes:

- The injected extension runs in Amazon's page context.
- Playback control uses internal webpack modules (`"0903"` player and `"6586"` native bridge).
- The Electron process can run in `server-only` mode (Group Listening backend only).

## High-Level Flow

```text
Morpho (Electron/Node)
  ├─ Launch Amazon with --remote-debugging-port=9222 (optional in server-only workflows)
  ├─ Discover CDP target via http://localhost:<port>/json
  ├─ Connect CDP websocket
  ├─ Inject webpack require resolver (window.__amazon_require__)
  ├─ Inject Morpho extension panel into Amazon DOM
  └─ (Optional) run GroupListeningServer (ws://host:port)
```

## Prerequisites

- Windows 10/11
- Amazon Music Desktop installed
- Node.js 18+

## Setup

```bash
git clone https://github.com/Enazzzz/AMAZING-MUSIC.git
cd AMAZING-MUSIC
npm install
```

## Common Commands

### Build / dev

```bash
npm run build
npm run build:main
npm run dev
npm run test
npm run typecheck
```

### Runtime helpers

```bash
# Run only the Group Listening websocket server (no Amazon launcher)
npm run server:only

# One-shot CDP extension injector
npm run inject:extension

# Fake host generator for local listener sync testing
npm run fake:host
```

PowerShell helpers in `scripts/`:

- `scripts/inject-extension.ps1`
- `scripts/run-amazon-and-inject.ps1`
- `scripts/run-local-two-amazon-and-inject.ps1`
- `scripts/run-fake-host.ps1`

## Repo Layout (Current)

```text
src/
  main/
    main.ts                        # app bootstrap, server-only mode, lifecycle
    amazonLauncher.ts              # host process <-> worker bridge
    configStore.ts                 # persistent config
    cdp/
      cdpClient.ts                 # minimal CDP websocket client
      amazonBridge.ts              # injected JS expression builders (core extension logic)
      discovery.ts                 # static bridge discovery helper
      bridgeDiscoveryLogger.ts     # runtime discovery logging
    groupListening/
      syncServer.ts                # host/listener room websocket server
  launcher/
    worker.ts                      # isolated launcher runtime
    injectExtension.ts             # standalone injector entrypoint
    fakeGroupHost.ts               # fake host for one-machine listener testing
  shared/
    types.ts                       # shared command/state types
scripts/
  *.ps1                            # convenience wrappers
docs/
  amazon-music-reverse-engineering.md  # mirror pointer
  bridge-api-map.md                    # static execute() command map
```

## Reverse Engineering References

- Canonical deep-dive: [amazon-music-reverse-engineering.md](amazon-music-reverse-engineering.md)
- Static bridge list: [docs/bridge-api-map.md](docs/bridge-api-map.md)

Recent findings now reflected in code:

- `Player.setTempo` is a real native bridge call and can be executed via module `"6586"` `execute("Player.setTempo", value)`.
- Tempo state is readable from `window.App.$store.state.player.settings.tempo`.
- No clear separate native pitch-shift API surfaced in static bundle strings; pitch-preserving behavior appears tied to Amazon's tempo/playback-speed path.

## Known Constraints

- Amazon Music is effectively single-instance on many setups.
- Sandbox networking can block host loopback access, which affects Group Listening tests.
- CDP injection timing matters; injecting too early can fail while modules are still booting.
- Internal module IDs and bridge contracts can change with Amazon app updates.

## Disclaimer

For personal, non-commercial, educational use only. This project does not decrypt or redistribute audio streams and only interacts with app metadata/control surfaces via internal APIs.

Amazon Music and related marks are trademarks of Amazon.com, Inc. This project is not affiliated with or endorsed by Amazon.

## License

[MIT](LICENSE)
