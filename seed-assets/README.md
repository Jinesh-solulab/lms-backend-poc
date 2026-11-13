# Seed assets

Optional demo files. `npm run seed` / `npm run seed:reset -- --yes` uploads them into MongoDB GridFS and attaches them to the module when the module has no video / PDF yet.

| File | Module |
|---|---|
| `food-safety.mp4` | Food Safety Basics (video) |
| `food-safety.pdf` | Food Safety Basics (PDF) |
| `road-safety.mp4` | Road Safety for Riders (video) |
| `road-safety.pdf` | Road Safety for Riders (PDF) |

Missing files are skipped; upload them in the admin panel instead. Keep videos small (low-end Android demo).
