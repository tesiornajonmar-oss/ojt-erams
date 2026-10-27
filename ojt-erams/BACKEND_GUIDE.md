# OJT-ERAMS — Backend & Database Guide

This front end is finished and **talks to the server only through `API.<group>.<method>()`**. The demo data lives in `js/mock/` (browser-only). To go live you build a server that implements the 81 endpoints below, then:

1. In `js/config.js` set `USE_MOCK: false` and `API_BASE` to your server (default `/api`).
2. **Delete the `js/mock/` folder.** Nothing else imports it (`js/boot.js` only loads it when `USE_MOCK` is true).
3. Delete the demo-only bits: the `data-demo` blocks on the four `login.html` pages (they remove themselves when `USE_MOCK` is false, but delete the markup anyway), the "reset demo data / backup / restore" buttons in `superadmin/system.html` and the three `admin.resetDemo`, `admin.exportBackup`, `admin.importBackup` calls.
4. `js/api-contract.js` is the contract: `[name, METHOD, path, roles, description]`. `js/http-api.js` already turns every row into a `fetch()` call, so you do **not** edit page code.

Suggested stack: Node.js + Express (or NestJS) + PostgreSQL/MySQL, or Supabase/Firebase if you prefer managed. Any stack works.

## HTTP rules the front end expects

- JSON in / JSON out. Success = `200` + JSON. Failure = `4xx` + `{"error":"Readable message"}` (the message is shown to the user as-is).
- `401` = not signed in → the page goes to the login screen. `403` = wrong role.
- Auth: `POST /api/auth/login` returns `{token, user}`; the front end sends `Authorization: Bearer <token>`. Prefer short-lived JWT or server sessions; hash passwords with **bcrypt/argon2** (the demo stores plain text — never copy that).
- `":x"` in a path is filled from the call's argument `x`. For `GET`, other arguments are the query string; for other methods they are the JSON body.
- **Every endpoint must check the role and the ownership on the server** (a student may only see own data; an adviser only own caseload; a supervisor only trainees placed in their company; super admin everything). Never trust the page to hide buttons.

## Roles

| Role | Portal | Folder |
|---|---|---|
| `EDUC_INTERN` (student) | `/` | project root |
| `ADVISER` (faculty) | `/admin/` | `admin/` |
| `SUPERVISOR` (company) | `/supervisor/` | `supervisor/` |
| `SUPER_ADMIN` | `/superadmin/` | `superadmin/` |

## Endpoints

### auth

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.auth.login` | `POST /api/auth/login` | public | Body {portal, username, password}. portal = student / faculty / supervisor / superadmin. Returns {token, user}. |
| `API.auth.logout` | `POST /api/auth/logout` | any | Invalidate the token. |
| `API.auth.me` | `GET /api/auth/me` | any | Profile of the signed-in user + sidebar badges {approvals, messages}. |
| `API.auth.changePassword` | `POST /api/auth/change-password` | any | Body {old_password, new_password}. |
| `API.auth.setTheme` | `PUT /api/auth/theme` | any | Body {theme: "light"/"dark"}. |

### notifications

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.notifications.list` | `GET /api/notifications` | any | Returns {items:[{id,text,link,at,read}], unread}. |
| `API.notifications.markRead` | `POST /api/notifications/read` | any | Body {id?}. No id = mark all read. |

### messages

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.messages.trainees` | `GET /api/messages/trainees` | ADVISER,SUPER_ADMIN,SUPERVISOR | Trainees the caller may start a conversation about. |
| `API.messages.threads` | `GET /api/messages/threads` | ADVISER,SUPER_ADMIN,SUPERVISOR | Conversation list (one thread is about one trainee). |
| `API.messages.get` | `GET /api/messages/threads/:id` | ADVISER,SUPER_ADMIN,SUPERVISOR | Thread + messages. Marks the thread read for the caller. |
| `API.messages.start` | `POST /api/messages/threads` | ADVISER,SUPER_ADMIN,SUPERVISOR | Body {student_id, subject, body}. Notifies the other people responsible for that trainee. |
| `API.messages.send` | `POST /api/messages/threads/:id/messages` | ADVISER,SUPER_ADMIN,SUPERVISOR | Body {body}. |

### student

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.student.dashboard` | `GET /api/student/dashboard` | EDUC_INTERN | Hours, active/today shift, recent feed, announcements, Face ID state, policy flags. |
| `API.student.placement` | `GET /api/student/placement` | EDUC_INTERN | Company, schedule, adviser(s) and company supervisor(s). |
| `API.student.shifts` | `GET /api/student/shifts` | EDUC_INTERN | Own attendance history (no photos). |
| `API.student.clockIn` | `POST /api/student/attendance/clock-in` | EDUC_INTERN | Body {coords:{lat,lng}/null, photo:dataURL/null, face:{descriptor,liveness}/null}. Server decides GPS + face status. |
| `API.student.clockOut` | `POST /api/student/attendance/clock-out` | EDUC_INTERN | Body {photo, face}. Server computes hours, runs the approval rules, returns {shift, outcome, flags}. |
| `API.student.reports` | `GET /api/student/reports` | EDUC_INTERN | Own narrative reports. |
| `API.student.saveReport` | `POST /api/student/reports` | EDUC_INTERN | Body {id?, title, body, date, submit}. |
| `API.student.deleteReport` | `DELETE /api/student/reports/:id` | EDUC_INTERN | Only drafts. |
| `API.student.faceStatus` | `GET /api/student/face` | EDUC_INTERN | {enrolled, enrolled_at, shots}. |
| `API.student.enrollFace` | `POST /api/student/face` | EDUC_INTERN | Body {descriptors:[[128 numbers]…], photo, consent:true}. Biometric data — see BACKEND_GUIDE.md. |
| `API.student.removeFace` | `DELETE /api/student/face` | EDUC_INTERN | Delete own face data (right to erasure). |

### supervisor

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.supervisor.dashboard` | `GET /api/supervisor/dashboard` | SUPERVISOR | Counts, trainees on duty today, oldest waiting items. |
| `API.supervisor.trainees` | `GET /api/supervisor/trainees` | SUPERVISOR | Trainees placed at the supervisor's company, with progress + today's state. |
| `API.supervisor.trainee` | `GET /api/supervisor/trainees/:sid` | SUPERVISOR | Summary, attendance (no photos), reports (read-only), evaluation. |
| `API.supervisor.queue` | `GET /api/supervisor/attendance/queue` | SUPERVISOR | Returns {pending:[…risk-sorted, with photos], spot:[…], total}. |
| `API.supervisor.approveShift` | `POST /api/supervisor/attendance/:id/approve` | SUPERVISOR | Body {hours?}. |
| `API.supervisor.rejectShift` | `POST /api/supervisor/attendance/:id/reject` | SUPERVISOR | Body {note}. |
| `API.supervisor.escalateShift` | `POST /api/supervisor/attendance/:id/escalate` | SUPERVISOR | Body {note}. Sends the item to the trainee's faculty adviser. |
| `API.supervisor.bulkApprove` | `POST /api/supervisor/attendance/bulk-approve` | SUPERVISOR | Body {ids:[…]}. HIGH-risk items are always skipped. Returns {approved, skipped}. |
| `API.supervisor.confirmSpot` | `POST /api/supervisor/attendance/:id/spot-confirm` | SUPERVISOR | Confirm an auto-approved shift that was picked for a random spot-check. |
| `API.supervisor.disputeSpot` | `POST /api/supervisor/attendance/:id/spot-dispute` | SUPERVISOR | Body {note}. Reverts the shift to pending and sends it to the adviser. |
| `API.supervisor.evaluations` | `GET /api/supervisor/evaluations` | SUPERVISOR | Each trainee with evaluation status. |
| `API.supervisor.saveEvaluation` | `PUT /api/supervisor/evaluations/:sid` | SUPERVISOR | Body {ratings:{…1-5}, comments, recommend:"YES"/"NO", submit}. |

### faculty

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.faculty.dashboard` | `GET /api/faculty/dashboard` | ADVISER,SUPER_ADMIN | Counts + oldest waiting items + flagged trainees. |
| `API.faculty.roster` | `GET /api/faculty/trainees` | ADVISER,SUPER_ADMIN | Trainee summaries in scope. |
| `API.faculty.trainee` | `GET /api/faculty/trainees/:sid` | ADVISER,SUPER_ADMIN | Summary, attendance (no photos), reports, evaluation, face state, supervisors. |
| `API.faculty.queue` | `GET /api/faculty/queue` | ADVISER,SUPER_ADMIN | {needsYou:[…], awaitingSupervisor:[…], reports:[…], total}. Slips are risk-sorted and include photos. |
| `API.faculty.approveShift` | `POST /api/faculty/attendance/:id/approve` | ADVISER,SUPER_ADMIN | Body {hours?}. |
| `API.faculty.rejectShift` | `POST /api/faculty/attendance/:id/reject` | ADVISER,SUPER_ADMIN | Body {note}. |
| `API.faculty.bulkApprove` | `POST /api/faculty/attendance/bulk-approve` | ADVISER,SUPER_ADMIN | Body {ids}. HIGH-risk skipped. Returns {approved, skipped}. |
| `API.faculty.approveReport` | `POST /api/faculty/reports/:id/approve` | ADVISER,SUPER_ADMIN |  |
| `API.faculty.reviseReport` | `POST /api/faculty/reports/:id/revise` | ADVISER,SUPER_ADMIN | Body {feedback}. |
| `API.faculty.updateTrainee` | `PUT /api/faculty/trainees/:sid` | ADVISER,SUPER_ADMIN | Body {user:{…}, ojt:{…}}. |
| `API.faculty.addTrainee` | `POST /api/faculty/trainees` | ADVISER,SUPER_ADMIN | Body {first_name,last_name,student_id,program,username,password,email,company_id,target_hours,start_date}. |

### staff

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.staff.shiftPhotos` | `GET /api/staff/attendance/:id/photos` | ADVISER,SUPER_ADMIN,SUPERVISOR | Clock-in / clock-out photos and face results of one shift. |
| `API.staff.resetTraineePassword` | `POST /api/staff/trainees/:sid/reset-password` | ADVISER,SUPER_ADMIN | Returns {temporary_password}. |
| `API.staff.resetFace` | `DELETE /api/staff/trainees/:sid/face` | ADVISER,SUPER_ADMIN | Remove a trainee's enrolled face so they can enroll again. |
| `API.staff.companies` | `GET /api/staff/companies` | ADVISER,SUPER_ADMIN | Companies with MOA state, trainee count and their supervisors. |
| `API.staff.createCompany` | `POST /api/staff/companies` | ADVISER,SUPER_ADMIN |  |
| `API.staff.updateCompany` | `PUT /api/staff/companies/:id` | ADVISER,SUPER_ADMIN | Name, address, GPS, geofence, contact. (MOA is Super Admin only.) |
| `API.staff.supervisors` | `GET /api/staff/supervisors` | ADVISER,SUPER_ADMIN | Company supervisor accounts with workload. |
| `API.staff.createSupervisor` | `POST /api/staff/supervisors` | ADVISER,SUPER_ADMIN | Body {first_name,last_name,email,phone,position,company_id,username,password}. |
| `API.staff.updateSupervisor` | `PUT /api/staff/supervisors/:supervisor_id` | ADVISER,SUPER_ADMIN |  |
| `API.staff.resetSupervisorPassword` | `POST /api/staff/supervisors/:supervisor_id/reset-password` | ADVISER,SUPER_ADMIN | Returns {temporary_password}. |
| `API.staff.deleteSupervisor` | `DELETE /api/staff/supervisors/:supervisor_id` | ADVISER,SUPER_ADMIN |  |

### admin

| Client call | Method & path | Who | What it does |
|---|---|---|---|
| `API.admin.counts` | `GET /api/admin/counts` | SUPER_ADMIN | {students, companies, supervisors}. |
| `API.admin.roster` | `GET /api/admin/trainees` | SUPER_ADMIN | Every trainee with adviser id. |
| `API.admin.advisers` | `GET /api/admin/advisers` | SUPER_ADMIN | Advisers with caseload, workload and oldest waiting item. |
| `API.admin.createAdviser` | `POST /api/admin/advisers` | SUPER_ADMIN |  |
| `API.admin.updateAdviser` | `PUT /api/admin/advisers/:id` | SUPER_ADMIN |  |
| `API.admin.resetAdviserPassword` | `POST /api/admin/advisers/:id/reset-password` | SUPER_ADMIN | Returns {temporary_password}. |
| `API.admin.deleteAdviser` | `DELETE /api/admin/advisers/:id` | SUPER_ADMIN | Only when the adviser has no trainees. |
| `API.admin.transferCaseload` | `POST /api/admin/advisers/:id/transfer` | SUPER_ADMIN | Body {to}. |
| `API.admin.assign` | `POST /api/admin/assign` | SUPER_ADMIN | Body {sids:[…], adviser_id/null}. |
| `API.admin.setHold` | `POST /api/admin/trainees/:sid/hold` | SUPER_ADMIN | Body {hold:boolean}. |
| `API.admin.saveMoa` | `PUT /api/admin/companies/:id/moa` | SUPER_ADMIN | Body {is_partner, moa_status, moa_expiry}. |
| `API.admin.renewMoa` | `POST /api/admin/companies/:id/renew` | SUPER_ADMIN | Extend the MOA by one year. |
| `API.admin.announcements` | `GET /api/admin/announcements` | SUPER_ADMIN | With "reach" (number of trainees) per item. |
| `API.admin.postAnnouncement` | `POST /api/admin/announcements` | SUPER_ADMIN | Body {title,message,audience,priority,expires}. audience = "ALL" or an adviser id. |
| `API.admin.toggleAnnouncement` | `POST /api/admin/announcements/:id/toggle` | SUPER_ADMIN |  |
| `API.admin.removeAnnouncement` | `DELETE /api/admin/announcements/:id` | SUPER_ADMIN |  |
| `API.admin.settings` | `GET /api/admin/settings` | SUPER_ADMIN | Program + approval policy. |
| `API.admin.applyProgram` | `PUT /api/admin/settings/program` | SUPER_ADMIN | Body {required_hours, shift_start, shift_end, work_days}. Applied to all trainees. |
| `API.admin.applyRadius` | `PUT /api/admin/settings/geofence` | SUPER_ADMIN | Body {radius}. Applied to all companies. |
| `API.admin.saveApprovalPolicy` | `PUT /api/admin/settings/approval` | SUPER_ADMIN | Body {auto_approve, spot_check_pct, face_required, face_threshold, escalate_days}. |
| `API.admin.audit` | `GET /api/admin/audit` | SUPER_ADMIN | Audit trail (newest first). |
| `API.admin.exportBackup` | `GET /api/admin/backup` | SUPER_ADMIN | DEMO ONLY in the mock. In production use database backups instead. |
| `API.admin.importBackup` | `POST /api/admin/restore` | SUPER_ADMIN | DEMO ONLY. |
| `API.admin.resetDemo` | `POST /api/admin/reset-demo` | SUPER_ADMIN | DEMO ONLY — remove from the real backend. |


Exact request/response shapes are the easiest to read from `js/mock/mock-api.js` (each `S['group.name']` function is the reference behaviour) and from the page scripts that call them.

## Attendance approval rules (**must be reproduced on the server**)

When the student clocks out the server builds a record and decides who verifies it — the browser never decides.

1. **GPS**: compute the distance to the company with the haversine formula. `In-Range` if ≤ company `geofence_radius`, else `Manual` (flag `MANUAL_GPS`).
2. **Face**: compare the 128-number descriptor sent by the browser to the stored enrolled descriptors using Euclidean distance. `distance ≤ face_threshold` (default 0.5) → match. Flags: `FACE_LOW` (no match), `FACE_NONE` (no face sent), `FACE_NOT_ENROLLED`, `NO_LIVENESS` (blink check not passed).
3. **Photo**: no live photo → `NO_PHOTO`.
4. **Shift length**: shorter than `min_shift_hours` → `SHORT_SHIFT`; longer than `max_shift_hours` → `LONG_SHIFT`.
5. **Risk**: any of `FACE_LOW, NO_LIVENESS, NO_PHOTO, SHORT_SHIFT, LONG_SHIFT, DISPUTED` = **HIGH**; other flags = MEDIUM; none = LOW.
6. **Decision**: no flags and `auto_approve` on → `APPROVED` automatically (`approval_method = AUTO`). A random `spot_check_pct`% of those are put in the supervisor's *spot-check* list (they can confirm or dispute; dispute turns the record back to pending/HIGH). Otherwise `PENDING_VERIFICATION` with `review_level = SUPERVISOR` if the company has an active supervisor, else `ADVISER`.
7. **Escalation**: a pending item older than `escalate_days` becomes visible to the adviser too ("needs you"); the supervisor can also escalate manually.
8. **Bulk approve** must never approve HIGH-risk records (re-check on the server).
9. Hours counted toward the total are only `APPROVED` records.

Run a nightly job for: escalation, MOA expiry flags, closing forgotten clock-ins (mark `LONG_SHIFT`).

## Face verification, security and privacy checklist

- The browser sends only descriptors (128 floats) and a small JPEG — **do not accept uploaded files** on the clock-in endpoints; they must only come from `Camera.capture()`.
- Always compare descriptors **on the server**; ignore any `match`/`liveness` flags the browser claims.
- Store enrolled descriptors in a separate `face_profiles` table, encrypted at rest; delete on request (`student.removeFace`, `staff.resetFace`).
- Face data is sensitive personal information (Philippines **Data Privacy Act, RA 10173**): keep the consent checkbox, record `consented_at`, state the purpose and retention period, restrict access by role, and log every view.
- The blink check reduces photo-of-a-photo spoofing but is not unbeatable. For stronger protection add server-side checks: reject images with no/stale timestamp, rate-limit clock-ins per device/IP, record the user-agent/IP, and keep the supervisor spot-check.
- Serve everything over **HTTPS** (the camera and GPS only work on https or 127.0.0.1).
- Enforce password rules, lock out after repeated failures, set CORS to your own domain only, validate every field length, escape output (the front end already escapes), and keep an audit log.

## What to delete / replace when going live

| Item | Action |
|---|---|
| `js/mock/` | delete |
| `USE_MOCK` in `js/config.js` | `false` |
| `data-demo` blocks on login pages, demo banner | delete (banner is automatic) |
| `admin.resetDemo / exportBackup / importBackup` buttons | delete |
| Plain-text demo passwords | replace with hashed passwords |
| `vendor/face-api/` | keep (needed offline); or host on your CDN and change `FACE` paths in `config.js` |

See `docs/DATA_MODEL.md` for the tables.
