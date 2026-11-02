# UNDERSEEN

An interactive 3D experience for UNDERSEEN, an underwater robot service that cleans yacht hulls, 3D-scans them every month and keeps the record.

Each visitor types their name and gets their own yacht (size, style, colours, berth, growth level and problems all come from the name). They dive under it, steer the robot to clean the hull, switch to the cavitation jet for barnacles, run a 3D scan, and receive the report in the owner app.

## Pages

| URL | What it shows |
| --- | --- |
| `/` | The experience: name, dive, clean, scan, owner app |
| `/?view=qr` | A large QR code pointing at the site, for slides or a printed card |
| `/?view=board` | Live visitor board for a screen at the event (needs the free database) |
| `/?name=Youssef` | Opens the experience with the name already filled in |

## Run locally

```bash
npm install
npm run dev
```

## Deploy on Vercel (free Hobby plan)

1. In Vercel, choose **Add New → Project** and import this GitHub repository.
2. Vercel detects **Vite**. Keep the defaults (build command `npm run build`, output `dist`) and press **Deploy**.
3. Open `https://<your-project>.vercel.app/?view=qr` and take a screenshot of the QR code for your slides.

### Optional: save visitors for free

The site works without a database. To count visitors and show a leaderboard:

1. In the Vercel project, open **Storage → Create Database → Upstash for Redis** (from the Marketplace) and pick the **Free** plan.
2. Connect it to this project. Vercel adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
3. Redeploy. Visitors are now saved by `/api/session` and shown on `/?view=board`.

Only the name typed in, the generated yacht name and the dive results are stored. The free Upstash plan is far beyond what an event needs.

## How it is built

- React + TypeScript + Vite, three.js for the 3D, no external 3D models: the yacht, marina, robot, water, caustics and barnacles are all generated in code.
- `src/lib/yacht.ts` turns a name into a yacht and its findings (same name, same yacht).
- `src/three/` holds the 3D: hull geometry, yacht model, water and underwater effects, the fouling texture the robot cleans, barnacles, the robot and the scan.
- `src/ui/app/` is the owner app.
- `api/session.ts` is the only server code: a Vercel function that talks to Upstash over its REST API.

## Photos in the owner app

The owner app uses real photos, loaded straight from the Pexels and Unsplash image servers (free to use under the [Pexels License](https://www.pexels.com/license/) and the [Unsplash License](https://unsplash.com/license)). Credits are shown on each photo. The list lives in `src/lib/photos.ts`; swap any URL there to change a photo.

| Where | Photo |
| --- | --- |
| Report header (one per yacht) | Matteo Roman, Diego F. Parra, Saksham Vikram (Pexels); Alina Kacharho, Damian Barczak (Unsplash) |
| Berth tab | Hurghada Marina by Bassel Zaki (Pexels) |
| Lock screen | Red Sea coast by Mo Ismail (Pexels) |
| Repair quotes | Repair yard in Hurghada (Pexels) |
| Findings | Barney Goodman, Vadim Yefremov (Unsplash); Stuart Reece, Jan van der Wolf, Mark Henry Rood (Pexels) |
| Annual review | NOAA (Unsplash) |

The 3D is only in the dive itself. The owner app shows photos and a flat hull map.

## About the cleaning

The two tools follow how hulls are actually cleaned:

- **Brush**: soft nylon bristles remove slime and weed. Suction holds the robot on the hull and pulls the growth into a filter. A soft brush cannot lift barnacles, because they cement themselves to the hull.
- **Cavitation jet**: collapsing bubbles hit the barnacle shell with high local pressure and crack it off, with less damage to the paint than high-pressure jets when used at the right distance.
- **Prevention**: monthly gentle cleaning ("grooming") stops barnacles from settling in the first place, which is why UNDERSEEN visits every month.

The simulation runs faster than real life so a visitor can clean a whole hull in a minute or two. Boats, findings, partners and history in the app are examples.
