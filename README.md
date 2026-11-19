# Bun Chess

A complete chess game that runs from **one JavaScript file** on [Bun](https://bun.sh). Start it and it opens in your browser. Play the computer, play a friend on the same board, or play over your Wi-Fi or the internet. It has no npm packages, no build step and no account.

The server, the chess engine, the AI, the web page and even the QR-code generator are all in `BUN-CHESS-WIDE.js`.

---

## Features

**Game modes**
* **vs Computer:** three levels (Easy, Medium, Hard) and your choice of White, Black or random.
* **Local 2-player:** two people on one screen, with an optional auto-flip after each move.
* **Online / LAN multiplayer:** make a room, share the link or scan the QR code, and a friend joins from their own device. Extra people can watch as spectators.

**Chess rules**
* Full legal-move generation: castling, en passant, promotion (you choose the piece), check, checkmate.
* Draws by stalemate, threefold repetition, the 50-move rule and insufficient material.
* Resign, offer or accept a draw (multiplayer), rematch, and undo (computer and local games).
* Start from any position by pasting a **FEN**. Copy the game as **PGN**.

**Clocks**
* Unlimited, 1+0, 3+2, 5+0, 10+0 and 15+10 (minutes + increment in seconds).

**Interface**
* Works in any modern browser, including phones and tablets.
* Four board themes (Tournament Green, Classic Wood, Ocean Blue, Modern Slate), optional sound effects, captured pieces and material count.
* Browse the move history with `←` `→` `Home` `End`. Press `F` to flip the board.
* In-game chat for multiplayer rooms.

**Connecting players**
* **LAN:** the server lists your local addresses, and the page shows a QR code for each.
* **Internet:** a free [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) gives you a public link. No sign-in, no port forwarding. See [Going online](#going-online-and-what-it-exposes) for what this means.
* **Your own address:** use `--public-url` if you already have a domain or tunnel.
* **PIN protection:** multiplayer rooms get a 4-digit PIN that the host shows to friends. Five wrong guesses lock that player out for 15 seconds.

## The computer opponent

The AI is a classic search engine written from scratch: negamax with alpha-beta pruning, iterative deepening, move ordering, a capture search at the leaves, and a repetition penalty. It runs inside the server with a time limit per move.

| Level | Search depth | Thinking time (max) | Notes |
|---|---|---|---|
| Easy (Casual) | 2 | 0.18 s | Adds random noise and sometimes picks a weaker move |
| Medium (Balanced) | 3 | 0.45 s | Small amount of noise |
| Hard (Tactical) | 4 | 1.2 s | No noise |

It is a hobby engine, not Stockfish. Strong players will beat Hard, but it should still make beginners and club players think.

---

## Quick start

### Option A: download a ready-made program

Go to the [Releases](https://github.com/aliplayz24-arch/bun-chess/releases) page and download the file for your system. Nothing else needs to be installed. See [Which download do I need?](#which-download-do-i-need).

### Option B: run the script with Bun

1. Install [Bun](https://bun.sh).
2. Download `BUN-CHESS-WIDE.js` (or clone the repository).
3. Run it:

```bash
bun BUN-CHESS-WIDE.js
```

Your browser opens at `http://localhost:3000`.

```bash
git clone https://github.com/aliplayz24-arch/bun-chess.git
cd bun-chess
bun BUN-CHESS-WIDE.js
```

## Which download do I need?

| Your system | Download |
|---|---|
| Windows 10 or 11, normal PC (Intel/AMD) | `bun-chess-windows-x64.zip` |
| Windows 11 on an ARM PC (Snapdragon, etc.) | `bun-chess-windows-arm64.zip` |
| Mac with Apple Silicon (M1, M2, M3, M4…) | `bun-chess-macos-arm64.tar.gz` |
| Mac with an Intel chip | `bun-chess-macos-x64.tar.gz` |
| Linux (Arch, Ubuntu, Fedora, Debian…), normal PC | `bun-chess-linux-x64.tar.gz` |
| Linux on ARM (Raspberry Pi 4/5, ARM servers) | `bun-chess-linux-arm64.tar.gz` |
| Alpine Linux or other **musl** distros, PC | `bun-chess-linux-x64-musl.tar.gz` |
| Alpine Linux or other **musl** distros, ARM | `bun-chess-linux-arm64-musl.tar.gz` |

Not sure about Linux? Run `ldd --version`. If it says "musl", pick a `-musl` file. Otherwise pick the plain one. Not sure about your CPU? Run `uname -m`: `x86_64` means x64, `aarch64` or `arm64` means arm64.

### Running a downloaded program

**Windows:** unzip, then double-click `bun-chess-windows-x64.exe` (or run it from a terminal). A black console window stays open while the game is running. Closing it stops the server. If Windows SmartScreen warns about an unknown publisher, choose **More info → Run anyway**. The program is not code-signed.

**macOS:**
```bash
tar -xzf bun-chess-macos-arm64.tar.gz
chmod +x bun-chess-macos-arm64
xattr -d com.apple.quarantine bun-chess-macos-arm64   # only if macOS blocks it
./bun-chess-macos-arm64
```

**Linux:**
```bash
tar -xzf bun-chess-linux-x64.tar.gz
chmod +x bun-chess-linux-x64
./bun-chess-linux-x64
```

---

## Command-line options

| Option | What it does |
|---|---|
| `--port 8080` or `--port=8080` | Use this port. Default is `3000`. If you don't pass `--port` and the port is busy, the next 10 ports are tried. With `--port`, only that one is tried. |
| `--no-open` | Don't open the browser automatically. |
| `--lan-only` | Don't start the internet tunnel. Only your local network can connect. |
| `--public-url https://chess.example.com` | You already have a public address, so use it instead of starting a tunnel. |

Environment variables: `PORT` (default port) and `PUBLIC_URL` (same as `--public-url`).

```bash
bun BUN-CHESS-WIDE.js --port 8080 --lan-only --no-open
```

## How to play

**Against the computer.** Choose **vs Computer**, pick a level, colour and clock, then start. Click a piece, then click where it goes.

**Two players on one screen.** Choose **Local**, then start. Turn on auto-flip if you are sharing a tablet.

**With a friend.**
1. Choose the multiplayer mode and create a room. You get a 4-letter room code and a 4-digit PIN.
2. Share the link or show the QR code. Use **LAN** if you are on the same Wi-Fi, or the **Online Link** for friends elsewhere.
3. Your friend opens the link, enters the room code and the PIN you show on screen, and the game begins.
4. Anyone else who joins can watch, and can take an empty seat if one is free.

## Going online, and what it exposes

By default the game starts a Cloudflare Quick Tunnel so friends outside your network can join. Please read this part before you leave it running.

* **First run downloads a helper.** Bun Chess uses a program called `cloudflared`. If it isn't installed, it is downloaded once from Cloudflare's official GitHub releases into `~/.bun-chess/bin`. If you already have `cloudflared` on your `PATH`, that copy is used. The downloaded file is the "latest" release and is not checked against a checksum. If you would rather not do this, run with `--lan-only`.
* **The whole server becomes reachable.** Anyone who has the `trycloudflare.com` link can open the game page. Only multiplayer rooms are PIN-protected. Computer and local games are not. Share the link only with people you trust, and stop the program when you are done.
* **The server listens on all network interfaces** (`0.0.0.0`) so that other devices on your network can connect. On a public or shared Wi-Fi, use `--lan-only` carefully or run it on a network you trust.
* **Nothing is saved.** Games, rooms and chat live in memory and disappear when the program stops.

## Building your own executable

Bun can turn the script into a single program that runs without Bun installed:

```bash
bun build --compile ./BUN-CHESS-WIDE.js --outfile bun-chess
```

For other systems, add `--target`. For example, `bun build --compile --target=bun-windows-x64 ./BUN-CHESS-WIDE.js --outfile bun-chess-windows-x64`. The full list of targets and a ready-made release script are in [RELEASES.md](RELEASES.md).

## How it is built

Everything lives in `BUN-CHESS-WIDE.js`, in three parts:

1. **Chess engine and AI** (`createChessEngine`). The same code runs on the server and is served to the browser as `/engine.js`, so both sides agree on the rules. The server checks every move again before accepting it.
2. **Web interface** (`HTML_PAGE`). One HTML page with its own CSS and JavaScript, including a built-in QR-code generator, so nothing is loaded from the internet.
3. **Server** (`Bun.serve`). Serves the page and communicates through WebSockets. It manages rooms, clocks, PINs, chat, the AI's moves and the Cloudflare tunnel.

Only Bun and Node's built-in modules (`os`, `path`, `fs`, `crypto`) are used.

## Troubleshooting

| Problem | What to try |
|---|---|
| The browser doesn't open | Open `http://localhost:3000` yourself (use the port shown in the console), or check that you didn't pass `--no-open`. |
| "Port in use" | Use `--port 8080`, or close the other program. |
| A friend on Wi-Fi can't connect | Make sure you are on the same network, use the LAN address shown in the console, and allow the program through your firewall. |
| "Could not reach Cloudflare" | Check your internet connection. Some networks block the tunnel. Use `--lan-only`, or `--public-url` with your own address. |
| macOS says the app is damaged or from an unidentified developer | Run `xattr -d com.apple.quarantine <file>`, or right-click → Open. |
| Linux says "No such file or directory" when running a binary that exists | You probably downloaded the wrong libc build. Try the `-musl` file (Alpine) or the plain one (most others). |

## Contributing

Bug reports and ideas are welcome. If you find a position where the engine plays an illegal move or gets a rule wrong, please open an issue with the FEN or the PGN.

## License

See `LICENSE`.
