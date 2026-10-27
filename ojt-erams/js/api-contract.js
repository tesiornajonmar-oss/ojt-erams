/* =====================================================================
   OJT-ERAMS — API CONTRACT  (the single source of truth for the backend)
   Every page talks to the server ONLY through  API.<group>.<method>(args)  → Promise.
   Each row is:  [ name, HTTP method, path, who may call it, what it does ]
     • ":x" in a path is filled from args.x (e.g. /shifts/:id → args.id).
     • GET: remaining args go in the query string.  Other methods: remaining args are the JSON body.
     • Success: HTTP 200 + JSON.   Failure: HTTP 4xx + {"error":"human readable message"}.
     • HTTP 401 means "not signed in" → the page sends the user to the login screen.
   BACKEND_GUIDE.md is generated from this file; the demo backend (js/mock) implements the same names.
   ===================================================================== */
window.API_CONTRACT = [
  /* ---- auth ---- */
  ['auth.login',            'POST',   '/api/auth/login',                        'public',   'Body {portal, username, password}. portal = student | faculty | supervisor | superadmin. Returns {token, user}.'],
  ['auth.logout',           'POST',   '/api/auth/logout',                       'any',      'Invalidate the token.'],
  ['auth.me',               'GET',    '/api/auth/me',                           'any',      'Profile of the signed-in user + sidebar badges {approvals, messages}.'],
  ['auth.changePassword',   'POST',   '/api/auth/change-password',              'any',      'Body {old_password, new_password}.'],
  ['auth.setTheme',         'PUT',    '/api/auth/theme',                        'any',      'Body {theme: "light"|"dark"}.'],

  /* ---- notifications & messages ---- */
  ['notifications.list',    'GET',    '/api/notifications',                     'any',      'Returns {items:[{id,text,link,at,read}], unread}.'],
  ['notifications.markRead','POST',   '/api/notifications/read',                'any',      'Body {id?}. No id = mark all read.'],
  ['messages.trainees',     'GET',    '/api/messages/trainees',                 'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Trainees the caller may start a conversation about.'],
  ['messages.threads',      'GET',    '/api/messages/threads',                  'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Conversation list (one thread is about one trainee).'],
  ['messages.get',          'GET',    '/api/messages/threads/:id',              'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Thread + messages. Marks the thread read for the caller.'],
  ['messages.start',        'POST',   '/api/messages/threads',                  'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Body {student_id, subject, body}. Notifies the other people responsible for that trainee.'],
  ['messages.send',         'POST',   '/api/messages/threads/:id/messages',     'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Body {body}.'],

  /* ---- student ---- */
  ['student.dashboard',     'GET',    '/api/student/dashboard',                 'EDUC_INTERN', 'Hours, active/today shift, recent feed, announcements, Face ID state, policy flags.'],
  ['student.placement',     'GET',    '/api/student/placement',                 'EDUC_INTERN', 'Company, schedule, adviser(s) and company supervisor(s).'],
  ['student.shifts',        'GET',    '/api/student/shifts',                    'EDUC_INTERN', 'Own attendance history (no photos).'],
  ['student.clockIn',       'POST',   '/api/student/attendance/clock-in',       'EDUC_INTERN', 'Body {coords:{lat,lng}|null, photo:dataURL|null, face:{descriptor,liveness}|null}. Server decides GPS + face status.'],
  ['student.clockOut',      'POST',   '/api/student/attendance/clock-out',      'EDUC_INTERN', 'Body {photo, face}. Server computes hours, runs the approval rules, returns {shift, outcome, flags}.'],
  ['student.reports',       'GET',    '/api/student/reports',                   'EDUC_INTERN', 'Own narrative reports.'],
  ['student.saveReport',    'POST',   '/api/student/reports',                   'EDUC_INTERN', 'Body {id?, title, body, date, submit}.'],
  ['student.deleteReport',  'DELETE', '/api/student/reports/:id',               'EDUC_INTERN', 'Only drafts.'],
  ['student.faceStatus',    'GET',    '/api/student/face',                      'EDUC_INTERN', '{enrolled, enrolled_at, shots}.'],
  ['student.enrollFace',    'POST',   '/api/student/face',                      'EDUC_INTERN', 'Body {descriptors:[[128 numbers]…], photo, consent:true}. Biometric data — see BACKEND_GUIDE.md.'],
  ['student.removeFace',    'DELETE', '/api/student/face',                      'EDUC_INTERN', 'Delete own face data (right to erasure).'],

  /* ---- company supervisor ---- */
  ['supervisor.dashboard',  'GET',    '/api/supervisor/dashboard',              'SUPERVISOR', 'Counts, trainees on duty today, oldest waiting items.'],
  ['supervisor.trainees',   'GET',    '/api/supervisor/trainees',               'SUPERVISOR', 'Trainees placed at the supervisor\'s company, with progress + today\'s state.'],
  ['supervisor.trainee',    'GET',    '/api/supervisor/trainees/:sid',          'SUPERVISOR', 'Summary, attendance (no photos), reports (read-only), evaluation.'],
  ['supervisor.queue',      'GET',    '/api/supervisor/attendance/queue',       'SUPERVISOR', 'Returns {pending:[…risk-sorted, with photos], spot:[…], total}.'],
  ['supervisor.approveShift','POST',  '/api/supervisor/attendance/:id/approve', 'SUPERVISOR', 'Body {hours?}.'],
  ['supervisor.rejectShift','POST',   '/api/supervisor/attendance/:id/reject',  'SUPERVISOR', 'Body {note}.'],
  ['supervisor.escalateShift','POST', '/api/supervisor/attendance/:id/escalate','SUPERVISOR', 'Body {note}. Sends the item to the trainee\'s faculty adviser.'],
  ['supervisor.bulkApprove','POST',   '/api/supervisor/attendance/bulk-approve','SUPERVISOR', 'Body {ids:[…]}. HIGH-risk items are always skipped. Returns {approved, skipped}.'],
  ['supervisor.confirmSpot','POST',   '/api/supervisor/attendance/:id/spot-confirm','SUPERVISOR', 'Confirm an auto-approved shift that was picked for a random spot-check.'],
  ['supervisor.disputeSpot','POST',   '/api/supervisor/attendance/:id/spot-dispute','SUPERVISOR', 'Body {note}. Reverts the shift to pending and sends it to the adviser.'],
  ['supervisor.evaluations','GET',    '/api/supervisor/evaluations',            'SUPERVISOR', 'Each trainee with evaluation status.'],
  ['supervisor.saveEvaluation','PUT', '/api/supervisor/evaluations/:sid',       'SUPERVISOR', 'Body {ratings:{…1-5}, comments, recommend:"YES"|"NO", submit}.'],

  /* ---- faculty adviser (SUPER_ADMIN may use these too: scope = everyone) ---- */
  ['faculty.dashboard',     'GET',    '/api/faculty/dashboard',                 'ADVISER,SUPER_ADMIN', 'Counts + oldest waiting items + flagged trainees.'],
  ['faculty.roster',        'GET',    '/api/faculty/trainees',                  'ADVISER,SUPER_ADMIN', 'Trainee summaries in scope.'],
  ['faculty.trainee',       'GET',    '/api/faculty/trainees/:sid',             'ADVISER,SUPER_ADMIN', 'Summary, attendance (no photos), reports, evaluation, face state, supervisors.'],
  ['faculty.queue',         'GET',    '/api/faculty/queue',                     'ADVISER,SUPER_ADMIN', '{needsYou:[…], awaitingSupervisor:[…], reports:[…], total}. Slips are risk-sorted and include photos.'],
  ['faculty.approveShift',  'POST',   '/api/faculty/attendance/:id/approve',    'ADVISER,SUPER_ADMIN', 'Body {hours?}.'],
  ['faculty.rejectShift',   'POST',   '/api/faculty/attendance/:id/reject',     'ADVISER,SUPER_ADMIN', 'Body {note}.'],
  ['faculty.bulkApprove',   'POST',   '/api/faculty/attendance/bulk-approve',   'ADVISER,SUPER_ADMIN', 'Body {ids}. HIGH-risk skipped. Returns {approved, skipped}.'],
  ['faculty.approveReport', 'POST',   '/api/faculty/reports/:id/approve',       'ADVISER,SUPER_ADMIN', ''],
  ['faculty.reviseReport',  'POST',   '/api/faculty/reports/:id/revise',        'ADVISER,SUPER_ADMIN', 'Body {feedback}.'],
  ['faculty.updateTrainee', 'PUT',    '/api/faculty/trainees/:sid',             'ADVISER,SUPER_ADMIN', 'Body {user:{…}, ojt:{…}}.'],
  ['faculty.addTrainee',    'POST',   '/api/faculty/trainees',                  'ADVISER,SUPER_ADMIN', 'Body {first_name,last_name,student_id,program,username,password,email,company_id,target_hours,start_date}.'],

  /* ---- shared by faculty + super admin ---- */
  ['staff.shiftPhotos',     'GET',    '/api/staff/attendance/:id/photos',       'ADVISER,SUPER_ADMIN,SUPERVISOR', 'Clock-in / clock-out photos and face results of one shift.'],
  ['staff.resetTraineePassword','POST','/api/staff/trainees/:sid/reset-password','ADVISER,SUPER_ADMIN', 'Returns {temporary_password}.'],
  ['staff.resetFace',       'DELETE', '/api/staff/trainees/:sid/face',          'ADVISER,SUPER_ADMIN', 'Remove a trainee\'s enrolled face so they can enroll again.'],
  ['staff.companies',       'GET',    '/api/staff/companies',                   'ADVISER,SUPER_ADMIN', 'Companies with MOA state, trainee count and their supervisors.'],
  ['staff.createCompany',   'POST',   '/api/staff/companies',                   'ADVISER,SUPER_ADMIN', ''],
  ['staff.updateCompany',   'PUT',    '/api/staff/companies/:id',               'ADVISER,SUPER_ADMIN', 'Name, address, GPS, geofence, contact. (MOA is Super Admin only.)'],
  ['staff.supervisors',     'GET',    '/api/staff/supervisors',                 'ADVISER,SUPER_ADMIN', 'Company supervisor accounts with workload.'],
  ['staff.createSupervisor','POST',   '/api/staff/supervisors',                 'ADVISER,SUPER_ADMIN', 'Body {first_name,last_name,email,phone,position,company_id,username,password}.'],
  ['staff.updateSupervisor','PUT',    '/api/staff/supervisors/:supervisor_id',  'ADVISER,SUPER_ADMIN', ''],
  ['staff.resetSupervisorPassword','POST','/api/staff/supervisors/:supervisor_id/reset-password','ADVISER,SUPER_ADMIN', 'Returns {temporary_password}.'],
  ['staff.deleteSupervisor','DELETE', '/api/staff/supervisors/:supervisor_id',  'ADVISER,SUPER_ADMIN', ''],

  /* ---- super admin ---- */
  ['admin.counts',          'GET',    '/api/admin/counts',                      'SUPER_ADMIN', '{students, companies, supervisors}.'],
  ['admin.roster',          'GET',    '/api/admin/trainees',                    'SUPER_ADMIN', 'Every trainee with adviser id.'],
  ['admin.advisers',        'GET',    '/api/admin/advisers',                    'SUPER_ADMIN', 'Advisers with caseload, workload and oldest waiting item.'],
  ['admin.createAdviser',   'POST',   '/api/admin/advisers',                    'SUPER_ADMIN', ''],
  ['admin.updateAdviser',   'PUT',    '/api/admin/advisers/:id',                'SUPER_ADMIN', ''],
  ['admin.resetAdviserPassword','POST','/api/admin/advisers/:id/reset-password','SUPER_ADMIN', 'Returns {temporary_password}.'],
  ['admin.deleteAdviser',   'DELETE', '/api/admin/advisers/:id',                'SUPER_ADMIN', 'Only when the adviser has no trainees.'],
  ['admin.transferCaseload','POST',   '/api/admin/advisers/:id/transfer',       'SUPER_ADMIN', 'Body {to}.'],
  ['admin.assign',          'POST',   '/api/admin/assign',                      'SUPER_ADMIN', 'Body {sids:[…], adviser_id|null}.'],
  ['admin.setHold',         'POST',   '/api/admin/trainees/:sid/hold',          'SUPER_ADMIN', 'Body {hold:boolean}.'],
  ['admin.saveMoa',         'PUT',    '/api/admin/companies/:id/moa',           'SUPER_ADMIN', 'Body {is_partner, moa_status, moa_expiry}.'],
  ['admin.renewMoa',        'POST',   '/api/admin/companies/:id/renew',         'SUPER_ADMIN', 'Extend the MOA by one year.'],
  ['admin.announcements',   'GET',    '/api/admin/announcements',               'SUPER_ADMIN', 'With "reach" (number of trainees) per item.'],
  ['admin.postAnnouncement','POST',   '/api/admin/announcements',               'SUPER_ADMIN', 'Body {title,message,audience,priority,expires}. audience = "ALL" or an adviser id.'],
  ['admin.toggleAnnouncement','POST', '/api/admin/announcements/:id/toggle',    'SUPER_ADMIN', ''],
  ['admin.removeAnnouncement','DELETE','/api/admin/announcements/:id',          'SUPER_ADMIN', ''],
  ['admin.settings',        'GET',    '/api/admin/settings',                    'SUPER_ADMIN', 'Program + approval policy.'],
  ['admin.applyProgram',    'PUT',    '/api/admin/settings/program',            'SUPER_ADMIN', 'Body {required_hours, shift_start, shift_end, work_days}. Applied to all trainees.'],
  ['admin.applyRadius',     'PUT',    '/api/admin/settings/geofence',           'SUPER_ADMIN', 'Body {radius}. Applied to all companies.'],
  ['admin.saveApprovalPolicy','PUT',  '/api/admin/settings/approval',           'SUPER_ADMIN', 'Body {auto_approve, spot_check_pct, face_required, face_threshold, escalate_days}.'],
  ['admin.audit',           'GET',    '/api/admin/audit',                       'SUPER_ADMIN', 'Audit trail (newest first).'],
  ['admin.exportBackup',    'GET',    '/api/admin/backup',                      'SUPER_ADMIN', 'DEMO ONLY in the mock. In production use database backups instead.'],
  ['admin.importBackup',    'POST',   '/api/admin/restore',                     'SUPER_ADMIN', 'DEMO ONLY.'],
  ['admin.resetDemo',       'POST',   '/api/admin/reset-demo',                  'SUPER_ADMIN', 'DEMO ONLY — remove from the real backend.']
];
