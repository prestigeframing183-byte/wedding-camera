# Wedding Camera

A disposable camera for every guest. Hosts create an event and share a QR code. Guests open a camera in their phone browser with nothing to install and shoot a limited roll with film looks. Nobody sees the photos until they "develop" at the reveal time.

## Features
- **Events**: name, subtitle, date, shots per guest (1–100) and reveal time (next morning, custom, manual or instant).
- **Guest camera**: live viewfinder, shot counter and five film looks (Classic, Golden, B&W, Faded, Natural) with grain, vignette and an orange date stamp. Also includes flash (torch or screen flash), front/back camera switch and a file-picker fallback when camera access is blocked.
- **Offline-safe uploads**: shots are queued in IndexedDB and retried when the venue Wi-Fi comes back.
- **Reveal**: the gallery shows a "developing" countdown, then the full roll. It has Timeline, Favourites and My shots views, a lightbox with swipe, double-tap to like, and per-photo and zip download.
- **Host dashboard** (private link): QR code, copy/share link and a printable table card. Hosts can edit settings, reveal now or hide photos, close or reopen the camera, see photos before guests and delete photos. Also shows the guest list with shot counts and offers zip download.
- Roll limits, reveal timing and host-only actions are enforced on the server.

## Run
```bash
npm install
npm start          # http://localhost:3000
npm test
```
Env: `PORT`, `DATA_DIR` (default `./data`: JSON store and uploaded images).

Camera access requires HTTPS (or localhost). Deploy behind a TLS proxy on any Node host with a persistent disk.
