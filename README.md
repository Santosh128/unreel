# Unreel — daily reel counter

Tap to count each reel you watch, set a daily limit, and see your history.

- `server/` — Node.js (Express) API, MySQL via MAMP
- `app/` — Angular 19 app, packaged for Android with Capacitor

## 1. Database + API

Start MySQL in MAMP (port 8889, user `root` / `root` — change in `server/.env`).

```bash
cd server
npm install
npm run db:init   # creates the `unreel` database and tables
npm run dev       # API on http://0.0.0.0:3000/api
```

## 2. Web app (for testing on the computer)

```bash
cd app
npm install
npx ng serve --host 0.0.0.0
```

## 3. Android

The phone and computer must be on the same Wi-Fi. Set your computer's LAN IP in
`app/src/environments/environment.ts` (it can also be changed in the app via ⚙ Settings).

```bash
cd app
npm run android   # builds, syncs to android/, opens Android Studio
```

In Android Studio, press Run with the phone connected (USB debugging on), or
use Build → Build APK(s) to get an installable APK.

## Automatic counting (Android)

An Accessibility Service ([ReelAccessibilityService.java](app/android/app/src/main/java/com/unreel/app/ReelAccessibilityService.java))
counts a reel each time you swipe to a new one in a full-screen reel player. It covers Instagram, Facebook,
YouTube Shorts, TikTok, Snapchat Spotlight, Moj, Josh, ShareChat, and any other app whose screen mentions
"reel", "clips" or "shorts". Counts are queued on the phone and uploaded when the server can be reached,
tagged with the app's name.

To turn it on: open the app → **Open settings** → Accessibility → **Unreel reel counter** → On.
On Android 13+ with a sideloaded APK, first go to App info → ⋮ → **Allow restricted settings**.

## YouTube ad skipping (Android)

The same accessibility service ([AdSkipper.java](app/android/app/src/main/java/com/unreel/app/AdSkipper.java))
taps YouTube's **Skip** button as soon as it appears and mutes media while an ad plays, restoring the sound
when the ad ends. Ads still load and unskippable ads still play (silently); only YouTube Premium removes ads.
It never unmutes media you muted yourself. Skipped ads show as "N YouTube ads skipped today" in the app.

It finds ads by YouTube's view ids (`skip_ad_button`, `ad_progress_text`, `player_learn_more_button`), so a
YouTube update that renames them can stop it working until the ids are updated. Turn it off in the app under
⚙ Settings → **Skip & mute YouTube ads**.

## Deploying to a server

The Node server hosts both the API (`/api`) and the built web app, so one process runs everything.
Needs Node 20+ and MySQL 5.7+/8.

```bash
git clone https://github.com/Santosh128/unreel.git && cd unreel

# Web app (optional, for using Unreel in a browser)
cd app && npm ci && npx ng build && cd ..

# API
cd server
npm ci --omit=dev
cp .env.example .env      # set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, HOST=127.0.0.1
npm run db:init           # creates tables (and the database, if the user may)
npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Put nginx (or Apache) in front with HTTPS and proxy to the Node port:

```nginx
server {
    server_name unreel.genautix.in;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then `sudo certbot --nginx -d unreel.genautix.in` for HTTPS. Check it with
`curl https://unreel.genautix.in/health` → `{"ok":true}`.

**Updating:** `git pull`, rebuild the app if it changed, `cd server && npm ci --omit=dev && npm run db:init && pm2 restart unreel`.

### Android build for the server

Set `apiUrl` in [environment.prod.ts](app/src/environments/environment.prod.ts) to `https://<your-domain>/api`, then:

```bash
cd app
npm run android       # production build → Android Studio (Build → Generate Signed APK for release)
npm run android:dev   # uses environment.ts (your computer's LAN IP) for local testing
```

The server URL can also be changed inside the app under ⚙ Settings.

## API

All requests send an `X-Device-Id` header (the app generates one per install).
`day` is the phone's local date, `YYYY-MM-DD`.

| Method | Path                     | Body / query         |
| ------ | ------------------------ | -------------------- |
| GET    | `/api/today?day=`        |                      |
| POST   | `/api/reels`             | `{ day, amount?, source? }` |
| POST   | `/api/reels/undo`        | `{ day }`            |
| POST   | `/api/reels/reset`       | `{ day }`            |
| POST   | `/api/ads/skipped`       | `{ day, amount? }`   |
| GET    | `/api/history?days=30`   |                      |
| PUT    | `/api/settings`          | `{ limit }`          |
| GET    | `/health`                | (no device header)   |
