# Goose Pursuit

A browser port of the original Goose Pursuit Android game I made in 2013. Catch geese before they fly off screen — don't let too many escape!

## How to Play

- **Click or tap** a goose to catch it
- You have **5 lives** — each goose that escapes costs one life
- The game ends when all lives are gone
- Speed increases at **20**, **50**, and **100** caught geese
- Your high score is saved in your browser

## Controls

| Action | Input |
|---|---|
| Catch a goose | Click / tap |
| Pause | `Escape` key or the on-screen **⏸ Pause** button |
| Resume | "Resume" button |

## Device Support

- Fully playable on **mobile** (iOS & Android) — tap to catch geese
- Canvas scales to fill any screen size in portrait or landscape
- On-screen pause button for devices without a keyboard

## Running Locally

Because the game loads audio, it must be served over HTTP (not opened directly as a file):

```bash
cd goose-hunter-web
python3 -m http.server 8765
```

Then open `http://localhost:8765` in your browser.
