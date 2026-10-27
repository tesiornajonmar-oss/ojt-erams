# OJT-ERAMS — Suggested data model

Types are PostgreSQL-flavoured; adapt freely. `id` = UUID or serial.

| Table | Important columns |
|---|---|
| **users** | id, role (`EDUC_INTERN`/`ADVISER`/`SUPERVISOR`/`SUPER_ADMIN`), username (unique), password_hash, first_name, last_name, title, email, phone, theme, active, created_at |
| **student_profiles** | user_id → users, student_no (unique), program, year_section, adviser_id → users, status (`NOT_STARTED`/`ACTIVE`/`COMPLETED`/`ON_HOLD`) |
| **companies** | id, name, industry, address, lat, lng, geofence_radius, moa_status, moa_signed_at, moa_expires_at, active |
| **supervisor_profiles** | user_id → users, company_id → companies, position |
| **ojt_placements** | id, student_id, company_id, required_hours, shift_start, shift_end, work_days, started_at |
| **shifts** (attendance) | id, student_id, company_id, date, time_in, time_out, computed_hours, lat_in, lng_in, distance_m, gps_status, photo_in, photo_out (file path/object-store key), face_in (`MATCH`/`LOW`/`NONE`/`NOT_ENROLLED`), face_out, liveness_in, liveness_out, flags (text[]), risk, status (`ACTIVE`/`PENDING_VERIFICATION`/`APPROVED`/`REJECTED`), review_level (`SUPERVISOR`/`ADVISER`), approval_method (`AUTO`/`MANUAL`), verified_by, verified_at, note, spot_status (`NONE`/`SAMPLED`/`CONFIRMED`/`DISPUTED`) |
| **reports** (narrative) | id, student_id, date, title, body, status (`DRAFT`/`PENDING`/`APPROVED`/`REVISION`), feedback, submitted_at |
| **evaluations** | id, student_id, supervisor_id, ratings (jsonb: attendance, quality, initiative, teamwork, communication, technical, professionalism = 1–5), comments, recommend (`YES`/`NO`), status (`DRAFT`/`SUBMITTED`), updated_at |
| **face_profiles** | student_id (pk), descriptors (encrypted, 3 × 128 floats), photo, consented_at, enrolled_at |
| **message_threads** | id, student_id, subject, created_by, created_at, last_at |
| **messages** | id, thread_id, sender_id, body, at |
| **thread_reads** | thread_id, user_id, last_read_at |
| **notifications** | id, user_id, text, link, at, read |
| **announcements** | id, title, body, audience, active, created_by, created_at |
| **audit_log** | id, at, user_id, action, subject, detail, ip |
| **settings** | key, value — required_hours, shift_start, shift_end, work_days, auto_approve, spot_check_pct, face_required, face_threshold, escalate_days, min_shift_hours, max_shift_hours |

Indexes: `shifts(student_id, date)`, `shifts(status, review_level)`, `messages(thread_id, at)`, `notifications(user_id, read)`, `users(username)`.

Store photos in object storage (or a protected folder), keep only the key in `shifts`, and serve them through `staff.shiftPhotos` after a permission check. Delete old photos after your retention period.
