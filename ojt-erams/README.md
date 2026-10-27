# OJT-ERAMS (City of Malabon University)

Four portals, one demo backend that runs in the browser.

## Run
1. Open the **`ojt-erams`** folder itself in VS Code (File → Open Folder).
2. Right-click `login.html` → **Open with Live Server** (address must be `127.0.0.1` or `localhost` so the camera and GPS work).
3. Optional: put your logo at `images/cmu-logo.png`.

| Portal | Open | Username / password |
|---|---|---|
| Student | `/login.html` | presnilla / intern123 |
| Faculty | `/admin/login.html` | jdelacruz / adviser123 (also rbautista, mtorres) |
| Company supervisor | `/supervisor/login.html` | lnavarro / supervisor123 (also cdizon, huy, dflores) |
| Super Admin | `/superadmin/login.html` | sadmin / admin123 |

The login pages have a **DEMO** button that fills the account for you. Demo data is stored in the browser only (use Super Admin → System → Reset demo to start over).

## Going live
Read `BACKEND_GUIDE.md` (endpoints, approval rules, face/privacy checklist) and `docs/DATA_MODEL.md`. Short version: build the API, set `USE_MOCK: false` in `js/config.js`, delete `js/mock/`.
