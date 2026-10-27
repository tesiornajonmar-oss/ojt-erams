/* =====================================================================
   MOCK BACKEND (2/2) — implements every call of js/api-contract.js in the browser.
   DEMO ONLY: it has the same rules your real backend must enforce (scope, approval
   rules, face matching…) so the screens behave realistically, but anyone can edit
   localStorage — a real backend must do all of this on the server.
   To go live: set USE_MOCK:false in js/config.js and delete the js/mock folder.
   ===================================================================== */
(function () {
  const META = {};
  window.API_CONTRACT.forEach(r => { META[r[0]] = { method: r[1], roles: r[3] }; });
  const S = {};                                           // name → function(ctx, args)

  /* ------------------------------------------------------------ basics */
  const DEFAULTS = {
    required_hours: 370, shift_start: '8:00 AM', shift_end: '5:00 PM', work_days: 'Monday – Friday',
    auto_approve: true, spot_check_pct: 10, face_required: true, face_threshold: 0.5, escalate_days: 3,
    min_shift_hours: 0, max_shift_hours: 12
  };
  const HIGH_FLAGS = ['FACE_LOW', 'NO_LIVENESS', 'NO_PHOTO', 'SHORT_SHIFT', 'LONG_SHIFT', 'DISPUTED'];
  const nowIso = () => new Date().toISOString();
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const label = u => `${u.title ? u.title + ' ' : ''}${u.first_name} ${u.last_name}`;
  const uidOf = u => u.student_id || u.supervisor_id || u.adviser_id;
  const fail = (m, status) => { const e = new Error(m); e.status = status || 400; throw e; };
  const settingsOf = db => ({ ...DEFAULTS, ...(db.settings || {}) });
  const studentOf = (db, sid) => db.users.find(u => u.role === 'EDUC_INTERN' && u.student_id === sid);
  const ojtOf = (db, sid) => db.ojt_records.find(o => o.student_id === sid);
  const companyOf = (db, id) => db.companies.find(c => c.id === id);
  const adviserOf = (db, aid) => db.users.find(u => u.role === 'ADVISER' && u.adviser_id === aid);
  const supervisorsOf = (db, cid) => db.users.filter(u => u.role === 'SUPERVISOR' && u.company_id === cid);
  const ageDays = s => Math.max(0, Math.floor((Date.now() - new Date(s.time_out || s.time_in || Date.now())) / 864e5));
  const riskOf = flags => !flags.length ? 'LOW' : flags.some(f => HIGH_FLAGS.includes(f)) ? 'HIGH' : 'MEDIUM';
  const RISK_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  function moaEffective(c) {
    if (c.moa_status === 'APPROVED' && c.moa_expiry && c.moa_expiry < U.dateStr()) return 'EXPIRED';
    return c.moa_status || 'PENDING';
  }
  function log(ctx, action, target, detail) {
    const d = ctx.db;
    d.audit.unshift({ id: MockDB.id('a'), at: nowIso(), actor: ctx.user ? label(ctx.user) : 'System', action, target, detail: detail || '' });
    d.audit = d.audit.slice(0, 1000);
  }
  function notify(db, uids, text, link) {
    const at = nowIso();
    [...new Set(uids)].filter(Boolean).forEach(uid => db.notifications.push({ id: MockDB.id('n'), uid, text, link: link || '', at, read: false }));
    if (db.notifications.length > 3000) db.notifications = db.notifications.slice(-2000);
  }
  const responsibleUids = (db, sid) => {
    const u = studentOf(db, sid), o = ojtOf(db, sid);
    return [u && u.adviser_id, ...(o ? supervisorsOf(db, o.company_id).map(s => s.supervisor_id) : [])].filter(Boolean);
  };

  /* ------------------------------------------------------------ scope (who may see whom) */
  function scopeStudents(ctx) {
    const { db, user } = ctx;
    const all = db.users.filter(u => u.role === 'EDUC_INTERN');
    if (user.role === 'SUPER_ADMIN') return all;
    if (user.role === 'ADVISER') return all.filter(u => u.adviser_id === user.adviser_id);
    if (user.role === 'SUPERVISOR') return all.filter(u => { const o = ojtOf(db, u.student_id); return o && o.company_id === user.company_id; });
    return [];
  }
  const scopeIds = ctx => new Set(scopeStudents(ctx).map(u => u.student_id));
  function assertScope(ctx, sid) {
    if (!scopeIds(ctx).has(sid)) fail('That trainee is not assigned to you.', 403);
  }

  /* ------------------------------------------------------------ summaries */
  function syncStatus(db, sid) {
    const o = ojtOf(db, sid);
    if (!o || o.status === 'ON_HOLD') return;
    const sh = db.shifts.filter(s => s.student_id === sid);
    const ap = sum(sh.filter(s => s.status === 'APPROVED'), s => s.computed_hours);
    o.status = !sh.length ? 'NOT_STARTED' : ap >= (o.target_hours || DEFAULTS.required_hours) ? 'COMPLETED' : 'ACTIVE';
  }

  function summarize(db, sid) {
    const user = studentOf(db, sid);
    if (!user) return null;
    const st = settingsOf(db);
    const o = ojtOf(db, sid) || null;
    const comp = o ? companyOf(db, o.company_id) || null : null;
    const shifts = db.shifts.filter(s => s.student_id === sid);
    const reports = db.reports.filter(r => r.student_id === sid);
    const approved = sum(shifts.filter(s => s.status === 'APPROVED'), s => s.computed_hours);
    const pending = sum(shifts.filter(s => s.status === 'PENDING_VERIFICATION'), s => s.computed_hours);
    const target = (o && o.target_hours) || st.required_hours;
    const pct = Math.min(100, Math.round(approved / target * 100));
    const dates = shifts.map(s => s.date).sort();
    const last = dates.length ? dates[dates.length - 1] : null;
    const status = o && o.status === 'ON_HOLD' ? 'ON_HOLD' : !shifts.length ? 'NOT_STARTED' : approved >= target ? 'COMPLETED' : 'ACTIVE';
    const moa = comp ? moaEffective(comp) : 'PENDING';
    const enrolled = db.face_profiles.some(f => f.student_id === sid);

    const flags = [];
    if (status === 'ACTIVE' && last) { const idle = U.daysBetween(last, U.dateStr()); if (idle >= 5) flags.push(`No activity for ${idle} days`); }
    if (shifts.some(s => s.status === 'PENDING_VERIFICATION' && s.flags.includes('FACE_LOW'))) flags.push('Face mismatch awaiting review');
    if (shifts.some(s => s.status === 'PENDING_VERIFICATION' && s.flags.includes('MANUAL_GPS'))) flags.push('Manual-GPS record awaiting review');
    if (reports.some(r => r.status === 'REVISION')) flags.push('Narrative needs revision');
    if (status !== 'COMPLETED' && moa !== 'APPROVED' && moa !== 'NOT_REQUIRED') flags.push(`Company MOA ${String(moa).toLowerCase()}`);
    if (st.face_required && !enrolled && (status === 'ACTIVE' || status === 'NOT_STARTED')) flags.push('Face ID not set up');

    const advValid = db.users.some(a => a.role === 'ADVISER' && a.adviser_id === user.adviser_id);
    return {
      sid, user, name: `${user.first_name} ${user.last_name}`, ojt: o ? { ...o, moa_status: moa } : null, company: comp,
      approved, pending, remaining: Math.max(0, target - approved), target, pct, status, last, flags,
      adviserId: advValid ? user.adviser_id : null, face_enrolled: enrolled,
      on_duty: shifts.some(s => s.status === 'TIMED_IN'), today_done: shifts.some(s => s.date === U.dateStr() && s.status !== 'TIMED_IN')
    };
  }

  function decorate(db, s, withPhotos) {
    const u = studentOf(db, s.student_id), c = companyOf(db, s.company_id);
    const out = { ...s, studentName: u ? `${u.first_name} ${u.last_name}` : s.student_id, companyName: c ? c.name : s.company,
      radius: c ? c.geofence_radius : null, risk: riskOf(s.flags || []), age_days: ageDays(s), has_photo_in: !!s.photo_in, has_photo_out: !!s.photo_out };
    if (!withPhotos) { delete out.photo_in; delete out.photo_out; }
    return out;
  }
  const byRiskThenAge = (a, b) => (RISK_RANK[a.risk] - RISK_RANK[b.risk]) || (b.age_days - a.age_days);
  const needsAdviser = (s, st) => s.status === 'PENDING_VERIFICATION' && (s.review_level === 'ADVISER' || (s.review_level === 'SUPERVISOR' && ageDays(s) >= st.escalate_days));

  /* ------------------------------------------------------------ face + attendance rules */
  const euclid = (a, b) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0));
  const validDescriptor = d => Array.isArray(d) && d.length === 128 && d.every(n => typeof n === 'number' && isFinite(n));
  function checkPhoto(p) {
    if (p == null) return null;
    if (typeof p !== 'string' || !/^data:image\//.test(p) || p.length > 600000) fail('That photo is not valid or is too large.');
    return p;
  }
  function faceCheck(db, sid, face) {
    const st = settingsOf(db);
    if (!face || face.descriptor == null) return { status: 'NONE', score: null, liveness: false };
    if (!validDescriptor(face.descriptor)) fail('Invalid face data.');
    const prof = db.face_profiles.find(f => f.student_id === sid);
    if (!prof) return { status: 'NOT_ENROLLED', score: null, liveness: !!face.liveness };
    const d = Math.min(...prof.descriptors.map(p => euclid(p, face.descriptor)));
    return { status: d <= st.face_threshold ? 'MATCH' : 'LOW', score: +d.toFixed(3), liveness: !!face.liveness };
  }

  // Decides whether a finished shift is auto-approved or which human must look at it.
  function evaluateShift(db, s) {
    const st = settingsOf(db), flags = [];
    if (s.gps_status !== 'In-Range') flags.push('MANUAL_GPS');
    const fs = [s.face_in, s.face_out].filter(Boolean);
    if (fs.some(f => f.status === 'LOW')) flags.push('FACE_LOW');
    else if (st.face_required) {
      if (fs.length < 2 || fs.some(f => f.status === 'NONE')) flags.push('FACE_NONE');
      else if (fs.some(f => f.status === 'NOT_ENROLLED')) flags.push('FACE_NOT_ENROLLED');
    }
    if (fs.some(f => (f.status === 'MATCH' || f.status === 'LOW') && !f.liveness)) flags.push('NO_LIVENESS');
    if (!s.photo_in || !s.photo_out) flags.push('NO_PHOTO');
    if (s.computed_hours < st.min_shift_hours) flags.push('SHORT_SHIFT');
    if (s.computed_hours > st.max_shift_hours) flags.push('LONG_SHIFT');
    s.flags = flags;

    if (st.auto_approve && !flags.length) {
      s.status = 'APPROVED'; s.approval_method = 'AUTO'; s.verified_by = 'Auto-verified'; s.verified_at = nowIso(); s.review_level = null;
      s.spot_check = Math.random() * 100 < st.spot_check_pct; s.spot_status = null;
      return 'AUTO_APPROVED';
    }
    s.status = 'PENDING_VERIFICATION';
    s.review_level = supervisorsOf(db, s.company_id).length ? 'SUPERVISOR' : 'ADVISER';
    return s.review_level === 'SUPERVISOR' ? 'PENDING_SUPERVISOR' : 'PENDING_ADVISER';
  }

  /* ------------------------------------------------------------ auth */
  const PORTAL_ROLES = { student: ['EDUC_INTERN'], faculty: ['ADVISER', 'SUPER_ADMIN'], supervisor: ['SUPERVISOR'], superadmin: ['SUPER_ADMIN'] };
  const PORTAL_HOME = { EDUC_INTERN: 'the Student portal (login.html)', ADVISER: 'the Faculty portal (admin/login.html)', SUPERVISOR: 'the Company Supervisor portal (supervisor/login.html)', SUPER_ADMIN: 'the Super Admin portal (superadmin/login.html)' };

  S['auth.login'] = (ctx, a) => {
    const u = ctx.db.users.find(x => x.username.toLowerCase() === String(a.username || '').toLowerCase() && x.password === a.password);
    if (!u) fail('Invalid username or password.', 401);
    if (!(PORTAL_ROLES[a.portal] || []).includes(u.role)) fail(`This account signs in at ${PORTAL_HOME[u.role]}.`, 403);
    const token = btoa(JSON.stringify({ sub: uidOf(u), role: u.role, iat: Date.now() }));   // demo token — NOT secure
    return { token, user: { username: u.username, role: u.role, id: uidOf(u), name: label(u) } };
  };
  S['auth.logout'] = () => ({ ok: true });
  S['auth.me'] = ctx => {
    const u = ctx.user, out = { ...u, id: uidOf(u), name: label(u), badges: badgesOf(ctx) };
    if (u.role === 'SUPERVISOR') { const c = companyOf(ctx.db, u.company_id); out.company_name = c ? c.name : ''; }
    return out;
  };
  S['auth.changePassword'] = (ctx, a) => {
    if (ctx.user.password !== a.old_password) fail('Current password is incorrect.');
    if (String(a.new_password || '').length < 6) fail('New password must be at least 6 characters.');
    ctx.user.password = a.new_password;
    log(ctx, 'Changed own password', label(ctx.user), '');
    return { ok: true };
  };
  S['auth.setTheme'] = (ctx, a) => { ctx.user.theme = a.theme === 'dark' ? 'dark' : 'light'; return { ok: true }; };

  function badgesOf(ctx) {
    const { db, user } = ctx, st = settingsOf(db), b = { approvals: 0, messages: unreadThreads(ctx) };
    if (user.role === 'SUPERVISOR') {
      const ids = scopeIds(ctx);
      b.approvals = db.shifts.filter(s => s.status === 'PENDING_VERIFICATION' && s.review_level === 'SUPERVISOR' && ids.has(s.student_id)).length;
    } else if (user.role === 'ADVISER' || (user.role === 'SUPER_ADMIN' && ctx.portal === 'faculty')) {
      const ids = scopeIds(ctx);
      b.approvals = db.shifts.filter(s => ids.has(s.student_id) && needsAdviser(s, st)).length + db.reports.filter(r => r.status === 'PENDING' && ids.has(r.student_id)).length;
    }
    return b;
  }

  /* ------------------------------------------------------------ notifications */
  S['notifications.list'] = ctx => {
    const mine = ctx.db.notifications.filter(n => n.uid === uidOf(ctx.user)).sort((a, b) => b.at.localeCompare(a.at));
    return { items: mine.slice(0, 30), unread: mine.filter(n => !n.read).length };
  };
  S['notifications.markRead'] = (ctx, a) => {
    ctx.db.notifications.forEach(n => { if (n.uid === uidOf(ctx.user) && (!a.id || n.id === a.id)) n.read = true; });
    return { ok: true };
  };

  /* ------------------------------------------------------------ messages */
  const visibleThreads = ctx => { const ids = scopeIds(ctx); return ctx.db.threads.filter(t => ids.has(t.student_id)); };
  const isUnread = (t, uid, msgs) => {
    const last = msgs.filter(m => m.thread_id === t.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    return !!last && last.sender !== uid && (!t.reads[uid] || t.reads[uid] < last.at);
  };
  function unreadThreads(ctx) {
    if (!ctx.user || !['ADVISER', 'SUPER_ADMIN', 'SUPERVISOR'].includes(ctx.user.role)) return 0;
    const uid = uidOf(ctx.user);
    return visibleThreads(ctx).filter(t => isUnread(t, uid, ctx.db.messages)).length;
  }
  function threadView(ctx, t) {
    const db = ctx.db, u = studentOf(db, t.student_id), o = ojtOf(db, t.student_id), c = o ? companyOf(db, o.company_id) : null;
    const msgs = db.messages.filter(m => m.thread_id === t.id).sort((a, b) => a.at.localeCompare(b.at));
    const last = msgs[msgs.length - 1];
    return { id: t.id, student_id: t.student_id, student_name: u ? `${u.first_name} ${u.last_name}` : t.student_id, company: c ? c.name : '',
      subject: t.subject, last_at: t.last_at, last_snippet: last ? last.body.slice(0, 90) : '', last_sender: last ? last.sender_name : '',
      unread: isUnread(t, uidOf(ctx.user), db.messages) };
  }
  S['messages.trainees'] = ctx => scopeStudents(ctx).map(u => { const o = ojtOf(ctx.db, u.student_id), c = o && companyOf(ctx.db, o.company_id); return { sid: u.student_id, name: `${u.first_name} ${u.last_name}`, company: c ? c.name : '' }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  S['messages.threads'] = ctx => visibleThreads(ctx).sort((a, b) => b.last_at.localeCompare(a.last_at)).map(t => threadView(ctx, t));
  S['messages.get'] = (ctx, a) => {
    const t = visibleThreads(ctx).find(x => x.id === a.id);
    if (!t) fail('Conversation not found.', 404);
    t.reads[uidOf(ctx.user)] = nowIso();
    return { thread: threadView(ctx, t), messages: ctx.db.messages.filter(m => m.thread_id === t.id).sort((x, y) => x.at.localeCompare(y.at)),
      me: uidOf(ctx.user) };
  };
  function addMessage(ctx, t, body) {
    const db = ctx.db, text = String(body || '').trim();
    if (!text) fail('Please write a message.');
    if (text.length > 2000) fail('Message is too long (2000 characters max).');
    const u = ctx.user, at = nowIso();
    db.messages.push({ id: MockDB.id('m'), thread_id: t.id, sender: uidOf(u), sender_name: label(u), sender_role: u.role, at, body: text });
    t.last_at = at; t.reads[uidOf(u)] = at;
    const stu = studentOf(db, t.student_id);
    notify(db, responsibleUids(db, t.student_id).filter(x => x !== uidOf(u)), `${label(u)} sent a message about ${stu ? stu.first_name + ' ' + stu.last_name : t.student_id}.`, 'messages.html?thread=' + t.id);
  }
  S['messages.start'] = (ctx, a) => {
    assertScope(ctx, a.student_id);
    const subject = String(a.subject || '').trim();
    if (!subject) fail('Please add a subject.');
    const t = { id: MockDB.id('t'), student_id: a.student_id, subject: subject.slice(0, 120), created_by: uidOf(ctx.user), created_at: nowIso(), last_at: nowIso(), reads: {} };
    ctx.db.threads.push(t);
    addMessage(ctx, t, a.body);
    return { id: t.id };
  };
  S['messages.send'] = (ctx, a) => {
    const t = visibleThreads(ctx).find(x => x.id === a.id);
    if (!t) fail('Conversation not found.', 404);
    addMessage(ctx, t, a.body);
    return { ok: true };
  };

  /* ------------------------------------------------------------ student */
  const myShifts = ctx => ctx.db.shifts.filter(s => s.student_id === ctx.user.student_id)
    .sort((a, b) => (b.date + (b.time_in || '')).localeCompare(a.date + (a.time_in || '')));
  const lite = s => { const { photo_in, photo_out, ...rest } = s; return { ...rest, has_photo_in: !!photo_in, has_photo_out: !!photo_out }; };

  S['student.dashboard'] = ctx => {
    const { db, user } = ctx, sm = summarize(db, user.student_id), st = settingsOf(db), today = U.dateStr();
    const shifts = myShifts(ctx), active = shifts.find(s => s.status === 'TIMED_IN') || null;
    const doneToday = shifts.find(s => s.date === today && s.status !== 'TIMED_IN') || null;
    const feed = [];
    shifts.filter(s => s.status !== 'TIMED_IN').forEach(s => feed.push({ at: s.time_out || s.time_in, label: `Attendance — ${U.fmtShortDate(s.date)} (${s.computed_hours || 0} h)`, status: s.status }));
    db.reports.filter(r => r.student_id === user.student_id && r.status !== 'DRAFT').forEach(r =>
      feed.push({ at: r.submitted_at || r.date, label: `Narrative — ${r.title}`, status: r.status === 'PENDING' ? 'PENDING_VERIFICATION' : r.status }));
    feed.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      user: { first_name: user.first_name, last_name: user.last_name, student_id: user.student_id },
      hours: { total: sm.approved, target: sm.target, pct: sm.pct, remaining: sm.remaining, pending: sm.pending },
      active: active && lite(active), today: doneToday && lite(doneToday), feed: feed.slice(0, 5),
      announcements: db.announcements.filter(a => a.active && (!a.expires || a.expires >= today) && (a.audience === 'ALL' || a.audience === user.adviser_id))
        .sort((a, b) => (b.created || '').localeCompare(a.created || '')),
      face: { enrolled: sm.face_enrolled }, policy: { face_required: st.face_required }, status: sm.status
    };
  };

  S['student.placement'] = ctx => {
    const { db, user } = ctx, sm = summarize(db, user.student_id), o = sm.ojt, c = sm.company;
    return {
      user: { first_name: user.first_name, last_name: user.last_name, student_id: user.student_id, program: user.program, email: user.email },
      ojt: o, company: c && { ...c, moa_effective: moaEffective(c) }, status: sm.status, hours: { total: sm.approved, target: sm.target },
      advisers: db.users.filter(a => a.role === 'ADVISER' && a.adviser_id === user.adviser_id).map(a => ({ name: label(a), email: a.email, department: a.department })),
      supervisors: c ? supervisorsOf(db, c.id).map(s => ({ name: label(s), email: s.email, phone: s.phone, position: s.position })) : [],
      face_required: settingsOf(db).face_required
    };
  };
  S['student.shifts'] = ctx => myShifts(ctx).map(lite);

  S['student.clockIn'] = (ctx, a) => {
    const { db, user } = ctx, o = ojtOf(db, user.student_id);
    if (!o) fail('No OJT record found for your account.');
    if (o.status === 'ON_HOLD') fail('Your OJT is on hold. Please contact your adviser.');
    const shifts = myShifts(ctx);
    if (shifts.some(s => s.status === 'TIMED_IN')) fail('You are already clocked in.');
    if (shifts.some(s => s.date === U.dateStr())) fail("Today's shift is already submitted.");
    const comp = companyOf(db, o.company_id);
    let gps = 'Manual', dist = null, lat = null, lng = null;
    const c = a.coords;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number' && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180) {
      lat = c.lat; lng = c.lng;
      if (comp && comp.lat != null && comp.lng != null) {
        dist = Math.round(U.haversine(lat, lng, comp.lat, comp.lng));
        gps = dist <= (comp.geofence_radius || 300) ? 'In-Range' : 'Manual';
      }
    }
    const shift = { id: MockDB.id('s'), student_id: user.student_id, company_id: o.company_id, company: comp ? comp.name : '—', date: U.dateStr(),
      time_in: nowIso(), time_out: null, computed_hours: 0, status: 'TIMED_IN', gps_status: gps, distance_m: dist, lat, lng,
      photo_in: checkPhoto(a.photo), photo_out: null, face_in: faceCheck(db, user.student_id, a.face), face_out: null, flags: [], review_level: null,
      approval_method: null, verified_by: null, verified_at: null, spot_check: false, spot_status: null, note: '' };
    db.shifts.push(shift);
    return { shift: lite(shift) };
  };

  S['student.clockOut'] = (ctx, a) => {
    const { db, user } = ctx;
    const s = db.shifts.find(x => x.student_id === user.student_id && x.status === 'TIMED_IN');
    if (!s) fail('You are not clocked in.');
    s.time_out = nowIso();
    s.photo_out = checkPhoto(a.photo);
    s.face_out = faceCheck(db, user.student_id, a.face);
    const raw = (new Date(s.time_out) - new Date(s.time_in)) / 36e5;
    s.computed_hours = Math.max(0, +((raw >= 5 ? raw - 1 : raw)).toFixed(2));          // 1-hour lunch deducted on long shifts
    const outcome = evaluateShift(db, s);
    syncStatus(db, user.student_id);
    const stu = `${user.first_name} ${user.last_name}`;
    if (outcome === 'AUTO_APPROVED') notify(db, [user.student_id], `Your shift on ${U.fmtShortDate(s.date)} was verified automatically (${s.computed_hours} h).`, 'logs.html');
    else {
      const why = s.flags.map(f => FLAG_LABEL[f] || f).join('; ');
      if (outcome === 'PENDING_SUPERVISOR') notify(db, supervisorsOf(db, s.company_id).map(x => x.supervisor_id), `${stu} submitted a shift that needs your review (${why}).`, 'approvals.html');
      else notify(db, [user.adviser_id], `${stu} submitted a shift that needs your review (${why}).`, 'approvals.html');
    }
    return { shift: lite(s), outcome, flags: s.flags };
  };

  S['student.reports'] = ctx => ctx.db.reports.filter(r => r.student_id === ctx.user.student_id).sort((a, b) => b.date.localeCompare(a.date));
  S['student.saveReport'] = (ctx, a) => {
    const { db, user } = ctx;
    const title = String(a.title || '').trim(), body = String(a.body || '').trim();
    if (!title) fail('Please add a title.');
    if (a.submit && body.length < 50) fail('Please write at least a short paragraph (50+ characters) before submitting.');
    let r = a.id ? db.reports.find(x => x.id === a.id && x.student_id === user.student_id) : null;
    if (r && !['DRAFT', 'REVISION'].includes(r.status)) fail('This report can no longer be edited.');
    if (!r) { r = { id: MockDB.id('r'), student_id: user.student_id, feedback: '', submitted_at: null, status: 'DRAFT' }; db.reports.push(r); }
    Object.assign(r, { title, body, date: a.date || U.dateStr() });
    if (a.submit) {
      r.status = 'PENDING'; r.submitted_at = nowIso();
      notify(db, [user.adviser_id], `${user.first_name} ${user.last_name} submitted a narrative report: ${title}.`, 'approvals.html');
    }
    return r;
  };
  S['student.deleteReport'] = (ctx, a) => {
    const r = ctx.db.reports.find(x => x.id === a.id && x.student_id === ctx.user.student_id);
    if (!r || r.status !== 'DRAFT') fail('Only drafts can be deleted.');
    ctx.db.reports = ctx.db.reports.filter(x => x !== r);
    return { ok: true };
  };

  S['student.faceStatus'] = ctx => {
    const p = ctx.db.face_profiles.find(f => f.student_id === ctx.user.student_id);
    return { enrolled: !!p, enrolled_at: p ? p.enrolled_at : null, shots: p ? p.descriptors.length : 0, face_required: settingsOf(ctx.db).face_required };
  };
  S['student.enrollFace'] = (ctx, a) => {
    if (a.consent !== true) fail('You must agree to the Face ID consent first.');
    const ds = a.descriptors;
    if (!Array.isArray(ds) || ds.length < 1 || ds.length > 5 || !ds.every(validDescriptor)) fail('Invalid face data. Please try again.');
    const db = ctx.db, sid = ctx.user.student_id;
    db.face_profiles = db.face_profiles.filter(f => f.student_id !== sid);
    db.face_profiles.push({ student_id: sid, descriptors: ds, photo: checkPhoto(a.photo), enrolled_at: nowIso(), consent_at: nowIso() });
    log(ctx, 'Enrolled Face ID', label(ctx.user), sid);
    return { enrolled: true };
  };
  S['student.removeFace'] = ctx => {
    ctx.db.face_profiles = ctx.db.face_profiles.filter(f => f.student_id !== ctx.user.student_id);
    log(ctx, 'Deleted own Face ID', label(ctx.user), ctx.user.student_id);
    return { enrolled: false };
  };

  /* ------------------------------------------------------------ approvals (shared by supervisor + faculty) */
  function loadPending(ctx, id) {
    const s = ctx.db.shifts.find(x => x.id === id);
    if (!s) fail('Attendance record not found.', 404);
    assertScope(ctx, s.student_id);
    if (s.status !== 'PENDING_VERIFICATION') fail('This record is no longer waiting for review.');
    if (ctx.user.role === 'SUPERVISOR' && s.review_level !== 'SUPERVISOR') fail('This item was escalated to the faculty adviser.');
    return s;
  }
  const methodOf = ctx => ctx.user.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'ADVISER';
  function approveCore(ctx, id, hours) {
    const s = loadPending(ctx, id), db = ctx.db;
    const h = hours == null || hours === '' ? s.computed_hours : +hours;
    if (!(h >= 0 && h <= 24)) fail('Hours must be between 0 and 24.');
    s.computed_hours = +h.toFixed(2); s.status = 'APPROVED'; s.approval_method = methodOf(ctx);
    s.verified_by = label(ctx.user); s.verified_at = nowIso(); s.review_level = null;
    syncStatus(db, s.student_id);
    const u = studentOf(db, s.student_id);
    notify(db, [s.student_id], `Your attendance on ${U.fmtShortDate(s.date)} was approved by ${label(ctx.user)} (${s.computed_hours} h).`, 'logs.html');
    log(ctx, 'Approved attendance', `${u.first_name} ${u.last_name}`, `${U.fmtShortDate(s.date)} • ${s.computed_hours} h`);
    return { ok: true };
  }
  function rejectCore(ctx, id, note) {
    const s = loadPending(ctx, id), db = ctx.db;
    s.status = 'REJECTED'; s.note = String(note || ''); s.verified_by = label(ctx.user); s.verified_at = nowIso(); s.approval_method = methodOf(ctx); s.review_level = null;
    syncStatus(db, s.student_id);
    const u = studentOf(db, s.student_id);
    notify(db, [s.student_id], `Your attendance on ${U.fmtShortDate(s.date)} was rejected${s.note ? ': ' + s.note : '.'}`, 'logs.html');
    log(ctx, 'Rejected attendance', `${u.first_name} ${u.last_name}`, `${U.fmtShortDate(s.date)}${s.note ? ' • ' + s.note : ''}`);
    return { ok: true };
  }
  function bulkCore(ctx, ids) {
    let approved = 0, skipped = 0;
    (Array.isArray(ids) ? ids : []).forEach(id => {
      const s = ctx.db.shifts.find(x => x.id === id);
      if (!s || s.status !== 'PENDING_VERIFICATION' || riskOf(s.flags) === 'HIGH') { skipped++; return; }
      try { approveCore(ctx, id, null); approved++; } catch (e) { skipped++; }
    });
    if (approved) log(ctx, 'Bulk approved attendance', `${approved} record(s)`, 'High-risk records are never bulk-approved');
    return { approved, skipped };
  }

  /* ------------------------------------------------------------ supervisor */
  const supPending = ctx => { const ids = scopeIds(ctx); return ctx.db.shifts.filter(s => s.status === 'PENDING_VERIFICATION' && s.review_level === 'SUPERVISOR' && ids.has(s.student_id)); };
  const supSpot = ctx => { const ids = scopeIds(ctx); return ctx.db.shifts.filter(s => s.status === 'APPROVED' && s.approval_method === 'AUTO' && s.spot_check && !s.spot_status && ids.has(s.student_id)); };

  S['supervisor.dashboard'] = ctx => {
    const { db, user } = ctx, roster = scopeStudents(ctx).map(u => summarize(db, u.student_id)), pend = supPending(ctx), spot = supSpot(ctx), st = settingsOf(db);
    const comp = companyOf(db, user.company_id);
    return {
      company: comp ? { ...comp, moa_effective: moaEffective(comp) } : null,
      counts: { trainees: roster.length, pending: pend.length, spot: spot.length, on_duty: roster.filter(r => r.on_duty).length,
        flagged: roster.filter(r => r.flags.length).length, avg: roster.length ? Math.round(roster.reduce((a, r) => a + r.pct, 0) / roster.length) : 0 },
      onDuty: roster.filter(r => r.on_duty).map(r => ({ sid: r.sid, name: r.name })),
      oldest: pend.map(s => decorate(db, s, false)).sort(byRiskThenAge).slice(0, 5),
      attention: roster.filter(r => r.flags.length).slice(0, 6).map(r => ({ sid: r.sid, name: r.name, flags: r.flags })),
      escalate_days: st.escalate_days
    };
  };
  S['supervisor.trainees'] = ctx => scopeStudents(ctx).map(u => summarize(ctx.db, u.student_id));
  S['supervisor.trainee'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const db = ctx.db;
    return {
      summary: summarize(db, a.sid),
      shifts: db.shifts.filter(s => s.student_id === a.sid).sort((x, y) => (y.date + (y.time_in || '')).localeCompare(x.date + (x.time_in || ''))).slice(0, 60).map(s => decorate(db, s, false)),
      reports: db.reports.filter(r => r.student_id === a.sid && r.status !== 'DRAFT').sort((x, y) => y.date.localeCompare(x.date)),
      evaluation: db.evaluations.find(e => e.student_id === a.sid) || null
    };
  };
  S['supervisor.queue'] = ctx => {
    const db = ctx.db, pend = supPending(ctx).map(s => decorate(db, s, true)).sort(byRiskThenAge);
    const spot = supSpot(ctx).map(s => decorate(db, s, true)).sort((a, b) => b.date.localeCompare(a.date));
    return { pending: pend.slice(0, 100), spot: spot.slice(0, 50), total: pend.length };
  };
  S['supervisor.approveShift'] = (ctx, a) => approveCore(ctx, a.id, a.hours);
  S['supervisor.rejectShift'] = (ctx, a) => rejectCore(ctx, a.id, a.note);
  S['supervisor.bulkApprove'] = (ctx, a) => bulkCore(ctx, a.ids);
  S['supervisor.escalateShift'] = (ctx, a) => {
    const s = loadPending(ctx, a.id), db = ctx.db, u = studentOf(db, s.student_id);
    s.review_level = 'ADVISER'; s.note = String(a.note || '');
    notify(db, [u.adviser_id], `${label(ctx.user)} escalated ${u.first_name} ${u.last_name}'s attendance on ${U.fmtShortDate(s.date)} to you${s.note ? ': ' + s.note : '.'}`, 'approvals.html');
    log(ctx, 'Escalated attendance to adviser', `${u.first_name} ${u.last_name}`, U.fmtShortDate(s.date));
    return { ok: true };
  };
  function loadSpot(ctx, id) {
    const s = ctx.db.shifts.find(x => x.id === id);
    if (!s) fail('Attendance record not found.', 404);
    assertScope(ctx, s.student_id);
    if (!(s.status === 'APPROVED' && s.approval_method === 'AUTO' && s.spot_check && !s.spot_status)) fail('This record is not waiting for a spot-check.');
    return s;
  }
  S['supervisor.confirmSpot'] = (ctx, a) => {
    const s = loadSpot(ctx, a.id); s.spot_status = 'CONFIRMED';
    log(ctx, 'Confirmed spot-check', studentOf(ctx.db, s.student_id).first_name, U.fmtShortDate(s.date));
    return { ok: true };
  };
  S['supervisor.disputeSpot'] = (ctx, a) => {
    const s = loadSpot(ctx, a.id), db = ctx.db, u = studentOf(db, s.student_id);
    s.spot_status = 'DISPUTED'; s.status = 'PENDING_VERIFICATION'; s.review_level = 'ADVISER'; s.approval_method = null; s.verified_by = null;
    s.flags = [...new Set([...(s.flags || []), 'DISPUTED'])]; s.note = String(a.note || '');
    syncStatus(db, s.student_id);
    notify(db, [u.adviser_id], `${label(ctx.user)} disputed an auto-approved shift of ${u.first_name} ${u.last_name} (${U.fmtShortDate(s.date)})${s.note ? ': ' + s.note : '.'}`, 'approvals.html');
    notify(db, [s.student_id], `Your shift on ${U.fmtShortDate(s.date)} was sent back for review.`, 'logs.html');
    log(ctx, 'Disputed spot-check', `${u.first_name} ${u.last_name}`, U.fmtShortDate(s.date));
    return { ok: true };
  };

  S['supervisor.evaluations'] = ctx => scopeStudents(ctx).map(u => {
    const sm = summarize(ctx.db, u.student_id);
    return { sid: sm.sid, name: sm.name, program: u.program, approved: sm.approved, target: sm.target, pct: sm.pct, status: sm.status,
      evaluation: ctx.db.evaluations.find(e => e.student_id === u.student_id) || null };
  });
  const EVAL_KEYS = ['attendance', 'quality', 'initiative', 'teamwork', 'communication', 'technical', 'professionalism'];
  S['supervisor.saveEvaluation'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const db = ctx.db, r = a.ratings || {};
    EVAL_KEYS.forEach(k => { if (r[k] != null && !(Number.isInteger(+r[k]) && +r[k] >= 1 && +r[k] <= 5)) fail('Ratings must be from 1 to 5.'); });
    if (a.submit) {
      if (!EVAL_KEYS.every(k => r[k])) fail('Please rate every criterion before submitting.');
      if (!['YES', 'NO'].includes(a.recommend)) fail('Please choose whether you recommend this trainee.');
    }
    let ev = db.evaluations.find(e => e.student_id === a.sid);
    if (!ev) { ev = { id: MockDB.id('ev'), student_id: a.sid, supervisor_id: ctx.user.supervisor_id, company_id: ctx.user.company_id }; db.evaluations.push(ev); }
    ev.supervisor_id = ctx.user.supervisor_id; ev.supervisor_name = label(ctx.user);
    ev.ratings = {}; EVAL_KEYS.forEach(k => { if (r[k]) ev.ratings[k] = +r[k]; });
    ev.comments = String(a.comments || '').slice(0, 2000); ev.recommend = a.recommend || null; ev.updated_at = nowIso();
    ev.status = a.submit ? 'SUBMITTED' : (ev.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT');
    if (a.submit) {
      ev.submitted_at = nowIso();
      const u = studentOf(db, a.sid);
      notify(db, [u.adviser_id], `${label(ctx.user)} submitted the OJT evaluation of ${u.first_name} ${u.last_name}.`, 'students.html?sid=' + a.sid);
      log(ctx, 'Submitted evaluation', `${u.first_name} ${u.last_name}`, a.recommend === 'YES' ? 'Recommended' : 'Not recommended');
    }
    return ev;
  };

  /* ------------------------------------------------------------ faculty */
  S['faculty.roster'] = ctx => scopeStudents(ctx).map(u => summarize(ctx.db, u.student_id));
  S['faculty.trainee'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const db = ctx.db, o = ojtOf(db, a.sid), prof = db.face_profiles.find(f => f.student_id === a.sid);
    return {
      summary: summarize(db, a.sid),
      shifts: db.shifts.filter(s => s.student_id === a.sid).sort((x, y) => (y.date + (y.time_in || '')).localeCompare(x.date + (x.time_in || ''))).slice(0, 60).map(s => decorate(db, s, false)),
      reports: db.reports.filter(r => r.student_id === a.sid && r.status !== 'DRAFT').sort((x, y) => y.date.localeCompare(x.date)),
      evaluation: db.evaluations.find(e => e.student_id === a.sid) || null,
      face: { enrolled: !!prof, enrolled_at: prof ? prof.enrolled_at : null },
      supervisors: o ? supervisorsOf(db, o.company_id).map(s => ({ name: label(s), email: s.email, phone: s.phone })) : []
    };
  };
  S['faculty.queue'] = ctx => {
    const db = ctx.db, ids = scopeIds(ctx), st = settingsOf(db);
    const pend = db.shifts.filter(s => s.status === 'PENDING_VERIFICATION' && ids.has(s.student_id));
    const mine = pend.filter(s => needsAdviser(s, st)).map(s => decorate(db, s, true)).sort(byRiskThenAge);
    const wait = pend.filter(s => !needsAdviser(s, st)).map(s => decorate(db, s, true)).sort(byRiskThenAge);
    const reports = db.reports.filter(r => r.status === 'PENDING' && ids.has(r.student_id))
      .sort((a, b) => (a.submitted_at || a.date).localeCompare(b.submitted_at || b.date)).map(r => { const u = studentOf(db, r.student_id); return { ...r, studentName: `${u.first_name} ${u.last_name}` }; });
    return { needsYou: mine.slice(0, 100), awaitingSupervisor: wait.slice(0, 100), reports, total: mine.length + reports.length, escalate_days: st.escalate_days };
  };
  S['faculty.dashboard'] = ctx => {
    const q = S['faculty.queue'](ctx), roster = S['faculty.roster'](ctx);
    return { roster, needsYou: q.needsYou.slice(0, 6), awaiting: q.awaitingSupervisor.length, reports: q.reports.slice(0, 6),
      counts: { needsYou: q.needsYou.length, reports: q.reports.length, awaiting: q.awaitingSupervisor.length } };
  };
  S['faculty.approveShift'] = (ctx, a) => approveCore(ctx, a.id, a.hours);
  S['faculty.rejectShift'] = (ctx, a) => rejectCore(ctx, a.id, a.note);
  S['faculty.bulkApprove'] = (ctx, a) => bulkCore(ctx, a.ids);
  function loadReport(ctx, id) {
    const r = ctx.db.reports.find(x => x.id === id);
    if (!r) fail('Report not found.', 404);
    assertScope(ctx, r.student_id);
    return r;
  }
  S['faculty.approveReport'] = (ctx, a) => {
    const r = loadReport(ctx, a.id); r.status = 'APPROVED'; r.feedback = '';
    const u = studentOf(ctx.db, r.student_id);
    notify(ctx.db, [r.student_id], `Your narrative report "${r.title}" was approved.`, 'narrative.html');
    log(ctx, 'Approved narrative', `${u.first_name} ${u.last_name}`, r.title);
    return { ok: true };
  };
  S['faculty.reviseReport'] = (ctx, a) => {
    const r = loadReport(ctx, a.id);
    if (!String(a.feedback || '').trim()) fail('Please write feedback for the student.');
    r.status = 'REVISION'; r.feedback = String(a.feedback).trim();
    const u = studentOf(ctx.db, r.student_id);
    notify(ctx.db, [r.student_id], `Your adviser asked for a revision of "${r.title}".`, 'narrative.html');
    log(ctx, 'Requested revision', `${u.first_name} ${u.last_name}`, r.title);
    return { ok: true };
  };
  S['faculty.updateTrainee'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const db = ctx.db, u = studentOf(db, a.sid), o = ojtOf(db, a.sid);
    if (!u || !o) fail('Trainee not found.', 404);
    const usr = a.user || {}, ojt = a.ojt || {};
    ['first_name', 'last_name', 'program', 'email'].forEach(k => { if (usr[k] != null) u[k] = usr[k]; });
    if (!u.first_name || !u.last_name) fail('First and last name are required.');
    const { status, company_id, ...rest } = ojt;
    ['target_hours', 'start_date', 'end_date', 'shift_start', 'shift_end', 'work_days'].forEach(k => { if (rest[k] != null) o[k] = rest[k]; });
    o.target_hours = +o.target_hours;
    if (!(o.target_hours >= 1 && o.target_hours <= 2000)) fail('Target hours must be between 1 and 2000.');
    if (company_id && company_id !== o.company_id) { if (!companyOf(db, company_id)) fail('Company not found.'); o.company_id = company_id; }
    if (rest.shift_start || rest.shift_end) u.schedule = { start: o.shift_start, end: o.shift_end };
    if (status === 'ON_HOLD') o.status = 'ON_HOLD'; else { if (o.status === 'ON_HOLD') o.status = 'ACTIVE'; syncStatus(db, a.sid); }
    log(ctx, 'Updated trainee', `${u.first_name} ${u.last_name}`, a.sid);
    return { ok: true };
  };
  S['faculty.addTrainee'] = (ctx, a) => {
    const db = ctx.db, st = settingsOf(db);
    ['first_name', 'last_name', 'student_id', 'username', 'password'].forEach(k => { if (!String(a[k] || '').trim()) fail('Please fill in all required fields.'); });
    if (a.password.length < 6) fail('Password must be at least 6 characters.');
    if (db.users.some(u => u.username.toLowerCase() === a.username.toLowerCase())) fail('That username is already taken.');
    if (db.users.some(u => u.student_id === a.student_id)) fail('That student ID already exists.');
    const comp = companyOf(db, a.company_id);
    if (!comp) fail('Please choose a company.');
    const adviserId = ctx.user.role === 'ADVISER' ? ctx.user.adviser_id : null;
    db.users.push({ username: a.username, password: a.password, role: 'EDUC_INTERN', student_id: a.student_id, adviser_id: adviserId, first_name: a.first_name, last_name: a.last_name,
      program: a.program || '', email: a.email || '', theme: 'light', schedule: { start: st.shift_start, end: st.shift_end } });
    db.ojt_records.push({ student_id: a.student_id, company_id: comp.id, target_hours: +a.target_hours || st.required_hours, status: 'NOT_STARTED',
      start_date: a.start_date || U.dateStr(), end_date: '', shift_start: st.shift_start, shift_end: st.shift_end, work_days: st.work_days });
    log(ctx, 'Added trainee', `${a.first_name} ${a.last_name}`, a.student_id);
    return { ok: true };
  };

  /* ------------------------------------------------------------ staff (faculty + super admin) */
  S['staff.shiftPhotos'] = (ctx, a) => {
    const s = ctx.db.shifts.find(x => x.id === a.id);
    if (!s) fail('Attendance record not found.', 404);
    assertScope(ctx, s.student_id);
    const d = decorate(ctx.db, s, true);
    return { id: s.id, studentName: d.studentName, date: s.date, time_in: s.time_in, time_out: s.time_out, gps_status: s.gps_status, distance_m: s.distance_m,
      photo_in: s.photo_in, photo_out: s.photo_out, face_in: s.face_in, face_out: s.face_out, flags: s.flags || [] };
  };
  S['staff.resetTraineePassword'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const u = studentOf(ctx.db, a.sid); u.password = 'intern123';
    log(ctx, 'Reset trainee password', `${u.first_name} ${u.last_name}`, a.sid);
    return { temporary_password: 'intern123' };
  };
  S['staff.resetFace'] = (ctx, a) => {
    assertScope(ctx, a.sid);
    const u = studentOf(ctx.db, a.sid);
    ctx.db.face_profiles = ctx.db.face_profiles.filter(f => f.student_id !== a.sid);
    log(ctx, 'Removed trainee Face ID', `${u.first_name} ${u.last_name}`, a.sid);
    return { ok: true };
  };

  function companyList(db) {
    const today = U.dateStr();
    return db.companies.map(c => ({
      ...c, moa_effective: moaEffective(c), daysLeft: c.moa_expiry ? Math.round((U.parseDate(c.moa_expiry) - U.parseDate(today)) / 864e5) : null,
      placed: db.ojt_records.filter(o => o.company_id === c.id).length,
      supervisors: supervisorsOf(db, c.id).map(s => ({ supervisor_id: s.supervisor_id, name: label(s), email: s.email, phone: s.phone, position: s.position }))
    }));
  }
  S['staff.companies'] = ctx => companyList(ctx.db);
  function companyFields(a) {
    const name = String(a.name || '').trim(), address = String(a.address || '').trim();
    if (!name || !address) fail('Company name and address are required.');
    const rad = parseInt(a.geofence_radius, 10);
    if (!(rad >= 50 && rad <= 5000)) fail('Radius must be between 50 and 5000 meters.');
    const hasLat = a.lat != null && a.lat !== '', hasLng = a.lng != null && a.lng !== '';
    if (hasLat !== hasLng) fail('Enter both latitude and longitude, or leave both empty.');
    if (hasLat && (Math.abs(+a.lat) > 90 || Math.abs(+a.lng) > 180)) fail('Those coordinates are not valid.');
    return { name, address, industry: a.industry || '', lat: hasLat ? +a.lat : null, lng: hasLng ? +a.lng : null, geofence_radius: rad,
      contact_person: a.contact_person || '', contact_email: a.contact_email || '', contact_phone: a.contact_phone || '' };
  }
  S['staff.createCompany'] = (ctx, a) => {
    const c = { id: MockDB.id('c'), is_partner: false, moa_status: 'PENDING', moa_expiry: null, ...companyFields(a) };
    ctx.db.companies.push(c); log(ctx, 'Added company', c.name, '');
    return { id: c.id };
  };
  S['staff.updateCompany'] = (ctx, a) => {
    const c = companyOf(ctx.db, a.id); if (!c) fail('Company not found.', 404);
    Object.assign(c, companyFields(a)); log(ctx, 'Updated company', c.name, `${c.lat != null ? c.lat + ', ' + c.lng : 'no coordinates'} • ${c.geofence_radius} m`);
    return { id: c.id };
  };

  const supView = (db, u) => {
    const ids = new Set(db.ojt_records.filter(o => o.company_id === u.company_id).map(o => o.student_id));
    const pend = db.shifts.filter(s => s.status === 'PENDING_VERIFICATION' && s.review_level === 'SUPERVISOR' && ids.has(s.student_id));
    const c = companyOf(db, u.company_id);
    return { ...u, name: label(u), company_name: c ? c.name : '—', trainees: ids.size, pending: pend.length, oldest_days: pend.length ? Math.max(...pend.map(ageDays)) : 0 };
  };
  S['staff.supervisors'] = ctx => ctx.db.users.filter(u => u.role === 'SUPERVISOR').map(u => supView(ctx.db, u))
    .sort((a, b) => a.last_name.localeCompare(b.last_name));
  function supFields(a, isNew) {
    ['first_name', 'last_name', 'email', 'company_id'].forEach(k => { if (!String(a[k] || '').trim()) fail('Please fill in all required fields.'); });
    if (!emailRe.test(a.email)) fail('Please enter a valid email address.');
    return { title: a.title || '', first_name: a.first_name.trim(), last_name: a.last_name.trim(), email: a.email.trim(), phone: a.phone || '', position: a.position || '', company_id: a.company_id };
  }
  S['staff.createSupervisor'] = (ctx, a) => {
    const db = ctx.db, f = supFields(a, true);
    if (!companyOf(db, f.company_id)) fail('Company not found.');
    if (!String(a.username || '').trim() || String(a.password || '').length < 6) fail('A username and a password of at least 6 characters are required.');
    if (db.users.some(u => u.username.toLowerCase() === a.username.toLowerCase())) fail('That username is already taken.');
    const nums = db.users.filter(u => u.role === 'SUPERVISOR').map(u => parseInt(String(u.supervisor_id).replace(/\D/g, ''), 10) || 0);
    const id = 'SUP-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    db.users.push({ supervisor_id: id, username: a.username.trim(), password: a.password, role: 'SUPERVISOR', theme: 'light', ...f });
    // trainees' waiting items at this company that had no supervisor now go to the new supervisor
    db.shifts.forEach(s => { if (s.status === 'PENDING_VERIFICATION' && s.company_id === f.company_id && s.review_level === 'ADVISER' && !s.note) s.review_level = 'SUPERVISOR'; });
    log(ctx, 'Added company supervisor', `${f.first_name} ${f.last_name}`, id);
    return { id };
  };
  S['staff.updateSupervisor'] = (ctx, a) => {
    const u = ctx.db.users.find(x => x.role === 'SUPERVISOR' && x.supervisor_id === a.supervisor_id);
    if (!u) fail('Supervisor not found.', 404);
    const f = supFields(a); if (!companyOf(ctx.db, f.company_id)) fail('Company not found.');
    Object.assign(u, f); log(ctx, 'Updated company supervisor', label(u), u.supervisor_id);
    return { ok: true };
  };
  S['staff.resetSupervisorPassword'] = (ctx, a) => {
    const u = ctx.db.users.find(x => x.role === 'SUPERVISOR' && x.supervisor_id === a.supervisor_id);
    if (!u) fail('Supervisor not found.', 404);
    u.password = 'supervisor123'; log(ctx, 'Reset supervisor password', label(u), u.supervisor_id);
    return { temporary_password: 'supervisor123' };
  };
  S['staff.deleteSupervisor'] = (ctx, a) => {
    const db = ctx.db, u = db.users.find(x => x.role === 'SUPERVISOR' && x.supervisor_id === a.supervisor_id);
    if (!u) fail('Supervisor not found.', 404);
    db.users = db.users.filter(x => x !== u);
    if (!supervisorsOf(db, u.company_id).length) db.shifts.forEach(s => { if (s.status === 'PENDING_VERIFICATION' && s.company_id === u.company_id && s.review_level === 'SUPERVISOR') s.review_level = 'ADVISER'; });
    log(ctx, 'Deleted company supervisor', label(u), u.supervisor_id);
    return { ok: true };
  };

  /* ------------------------------------------------------------ super admin */
  const requireAdviserId = (db, id) => { const u = adviserOf(db, id); if (!u) fail('Adviser not found.', 404); return u; };
  S['admin.counts'] = ctx => ({ students: ctx.db.users.filter(u => u.role === 'EDUC_INTERN').length, companies: ctx.db.companies.length, supervisors: ctx.db.users.filter(u => u.role === 'SUPERVISOR').length });
  S['admin.roster'] = ctx => ctx.db.users.filter(u => u.role === 'EDUC_INTERN').map(u => summarize(ctx.db, u.student_id));
  S['admin.advisers'] = ctx => {
    const db = ctx.db, st = settingsOf(db), roster = S['admin.roster'](ctx);
    return db.users.filter(u => u.role === 'ADVISER').map(u => {
      const mine = roster.filter(r => r.adviserId === u.adviser_id), ids = new Set(mine.map(r => r.sid));
      const pend = db.shifts.filter(s => s.status === 'PENDING_VERIFICATION' && ids.has(s.student_id));
      const slipsList = pend.filter(s => needsAdviser(s, st));
      const reps = db.reports.filter(r => r.status === 'PENDING' && ids.has(r.student_id));
      const oldest = [...slipsList.map(s => s.time_out || s.date), ...reps.map(r => r.submitted_at || r.date)].sort()[0];
      return { user: u, id: u.adviser_id, name: label(u), students: mine, count: mine.length, slips: slipsList.length, reports: reps.length, pending: slipsList.length + reps.length,
        awaitingSupervisor: pend.length - slipsList.length, oldestDays: oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest)) / 864e5)) : 0,
        avg: mine.length ? Math.round(mine.reduce((a, r) => a + r.pct, 0) / mine.length) : 0, flagged: mine.filter(r => r.flags.length).length };
    }).sort((a, b) => a.user.last_name.localeCompare(b.user.last_name));
  };
  S['admin.createAdviser'] = (ctx, a) => {
    const db = ctx.db;
    ['first_name', 'last_name', 'email', 'username', 'password'].forEach(k => { if (!String(a[k] || '').trim()) fail('Please fill in all required fields.'); });
    if (!emailRe.test(a.email)) fail('Please enter a valid email address.');
    if (a.password.length < 6) fail('Password must be at least 6 characters.');
    if (db.users.some(u => u.username.toLowerCase() === a.username.toLowerCase())) fail('That username is already taken.');
    const nums = db.users.filter(u => u.role === 'ADVISER').map(u => parseInt(String(u.adviser_id).replace(/\D/g, ''), 10) || 0);
    const id = 'ADV-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    db.users.push({ adviser_id: id, username: a.username, password: a.password, role: 'ADVISER', title: a.title, first_name: a.first_name, last_name: a.last_name, department: a.department, email: a.email, theme: 'light' });
    log(ctx, 'Added adviser', `${a.first_name} ${a.last_name}`, id);
    return { id };
  };
  S['admin.updateAdviser'] = (ctx, a) => {
    const u = requireAdviserId(ctx.db, a.id);
    if (!String(a.first_name || '').trim() || !String(a.last_name || '').trim()) fail('First and last name are required.');
    if (!emailRe.test(a.email || '')) fail('Please enter a valid email address.');
    ['title', 'first_name', 'last_name', 'department', 'email'].forEach(k => { if (a[k] != null) u[k] = a[k]; });
    log(ctx, 'Updated adviser', label(u), a.id);
    return { ok: true };
  };
  S['admin.resetAdviserPassword'] = (ctx, a) => { const u = requireAdviserId(ctx.db, a.id); u.password = 'adviser123'; log(ctx, 'Reset adviser password', label(u), a.id); return { temporary_password: 'adviser123' }; };
  S['admin.deleteAdviser'] = (ctx, a) => {
    const db = ctx.db;
    if (db.users.some(u => u.role === 'EDUC_INTERN' && u.adviser_id === a.id)) fail('This adviser still has trainees. Transfer them first.');
    const u = requireAdviserId(db, a.id);
    db.users = db.users.filter(x => x !== u); log(ctx, 'Deleted adviser', label(u), a.id);
    return { ok: true };
  };
  S['admin.transferCaseload'] = (ctx, a) => {
    const db = ctx.db, from = requireAdviserId(db, a.id), to = adviserOf(db, a.to);
    if (!to || to === from) fail('Choose a different adviser to transfer to.');
    let n = 0;
    db.users.filter(u => u.role === 'EDUC_INTERN' && u.adviser_id === a.id).forEach(u => { u.adviser_id = a.to; n++; });
    log(ctx, 'Transferred caseload', `${label(from)} → ${label(to)}`, `${n} trainee(s)`);
    return { moved: n };
  };
  S['admin.assign'] = (ctx, a) => {
    const db = ctx.db, adv = a.adviser_id ? adviserOf(db, a.adviser_id) : null;
    if (a.adviser_id && !adv) fail('Adviser not found.', 404);
    let n = 0;
    (a.sids || []).forEach(sid => { const u = studentOf(db, sid); if (u) { u.adviser_id = a.adviser_id || null; n++; } });
    log(ctx, adv ? 'Reassigned trainees' : 'Unassigned trainees', adv ? label(adv) : `${n} trainee(s)`, `${n} trainee(s)`);
    return { moved: n };
  };
  S['admin.setHold'] = (ctx, a) => {
    const db = ctx.db, o = ojtOf(db, a.sid), u = studentOf(db, a.sid);
    if (!o || !u) fail('Trainee not found.', 404);
    o.status = a.hold ? 'ON_HOLD' : 'ACTIVE'; syncStatus(db, a.sid);
    log(ctx, a.hold ? 'Put trainee on hold' : 'Resumed trainee', `${u.first_name} ${u.last_name}`, a.sid);
    return { ok: true };
  };
  S['admin.saveMoa'] = (ctx, a) => {
    const c = companyOf(ctx.db, a.id); if (!c) fail('Company not found.', 404);
    c.is_partner = !!a.is_partner; c.moa_status = a.moa_status; c.moa_expiry = a.moa_expiry || null;
    log(ctx, 'Updated MOA', c.name, `${c.moa_status}${c.moa_expiry ? ' until ' + c.moa_expiry : ''}${c.is_partner ? '' : ' • non-partner'}`);
    return { ok: true };
  };
  S['admin.renewMoa'] = (ctx, a) => {
    const c = companyOf(ctx.db, a.id); if (!c) fail('Company not found.', 404);
    const today = U.dateStr(), base = c.moa_expiry && c.moa_expiry > today ? c.moa_expiry : today, [y, m, d] = base.split('-');
    c.moa_status = 'APPROVED'; c.moa_expiry = `${+y + 1}-${m}-${d}`; c.is_partner = true;
    log(ctx, 'Updated MOA', c.name, `APPROVED until ${c.moa_expiry}`);
    return { ok: true };
  };
  S['admin.announcements'] = ctx => {
    const db = ctx.db, studs = db.users.filter(u => u.role === 'EDUC_INTERN');
    return db.announcements.slice().sort((a, b) => (b.created || '').localeCompare(a.created || ''))
      .map(a => ({ ...a, reach: a.audience === 'ALL' ? studs.length : studs.filter(u => u.adviser_id === a.audience).length }));
  };
  S['admin.postAnnouncement'] = (ctx, a) => {
    if (!String(a.title || '').trim()) fail('Please add a title.');
    if (String(a.message || '').trim().length < 5) fail('Please write a short message.');
    ctx.db.announcements.push({ id: MockDB.id('an'), title: a.title.trim(), message: a.message.trim(), audience: a.audience || 'ALL', priority: a.priority || 'normal',
      expires: a.expires || null, active: true, created: nowIso(), author: label(ctx.user) });
    log(ctx, 'Posted announcement', a.title, a.audience === 'ALL' ? 'All trainees' : a.audience);
    return { ok: true };
  };
  S['admin.toggleAnnouncement'] = (ctx, a) => { const x = ctx.db.announcements.find(y => y.id === a.id); if (x) { x.active = !x.active; log(ctx, x.active ? 'Showed announcement' : 'Hid announcement', x.title, ''); } return { ok: true }; };
  S['admin.removeAnnouncement'] = (ctx, a) => {
    const x = ctx.db.announcements.find(y => y.id === a.id);
    ctx.db.announcements = ctx.db.announcements.filter(y => y.id !== a.id);
    if (x) log(ctx, 'Deleted announcement', x.title, '');
    return { ok: true };
  };
  S['admin.settings'] = ctx => settingsOf(ctx.db);
  S['admin.applyProgram'] = (ctx, a) => {
    const db = ctx.db, hrs = parseInt(a.required_hours, 10);
    if (!(hrs >= 1 && hrs <= 2000)) fail('Required hours must be between 1 and 2000.');
    db.settings = { ...settingsOf(db), required_hours: hrs, shift_start: a.shift_start, shift_end: a.shift_end, work_days: a.work_days };
    db.ojt_records.forEach(o => { o.target_hours = hrs; o.shift_start = a.shift_start; o.shift_end = a.shift_end; o.work_days = a.work_days; });
    db.users.forEach(u => { if (u.role === 'EDUC_INTERN') u.schedule = { start: a.shift_start, end: a.shift_end }; });
    db.ojt_records.forEach(o => syncStatus(db, o.student_id));
    log(ctx, 'Applied program policy', 'All trainees', `${hrs} h • ${a.shift_start} – ${a.shift_end}`);
    return { updated: db.ojt_records.length };
  };
  S['admin.applyRadius'] = (ctx, a) => {
    const r = parseInt(a.radius, 10);
    if (!(r >= 50 && r <= 5000)) fail('Radius must be between 50 and 5000 meters.');
    ctx.db.companies.forEach(c => { c.geofence_radius = r; });
    log(ctx, 'Applied geofence radius', 'All companies', `${r} m`);
    return { updated: ctx.db.companies.length };
  };
  S['admin.saveApprovalPolicy'] = (ctx, a) => {
    const spot = +a.spot_check_pct, thr = +a.face_threshold, esc_ = +a.escalate_days, mn = +a.min_shift_hours, mx = +a.max_shift_hours;
    if (!(spot >= 0 && spot <= 100)) fail('Spot-check percentage must be between 0 and 100.');
    if (!(thr >= 0.3 && thr <= 0.8)) fail('Face match threshold must be between 0.30 and 0.80.');
    if (!(esc_ >= 1 && esc_ <= 30)) fail('Escalation days must be between 1 and 30.');
    if (!(mn >= 0 && mn <= 8)) fail('Minimum shift length must be between 0 and 8 hours.');
    if (!(mx >= 8 && mx <= 24)) fail('Maximum shift length must be between 8 and 24 hours.');
    ctx.db.settings = { ...settingsOf(ctx.db), auto_approve: !!a.auto_approve, spot_check_pct: spot, face_required: !!a.face_required, face_threshold: thr,
      escalate_days: esc_, min_shift_hours: mn, max_shift_hours: mx };
    log(ctx, 'Changed approval rules', `Auto-approve ${a.auto_approve ? 'on' : 'off'}`, `spot-check ${spot}% • face ≤ ${thr} • escalate after ${esc_} d`);
    return { ok: true };
  };
  S['admin.audit'] = ctx => ctx.db.audit;
  S['admin.exportBackup'] = ctx => ({ json: JSON.stringify(ctx.db) });
  S['admin.importBackup'] = (ctx, a) => {
    let o; try { o = JSON.parse(a.text); } catch (e) { fail('That file is not valid JSON.'); }
    if (!['users', 'companies', 'ojt_records', 'shifts', 'reports'].every(k => Array.isArray(o[k]))) fail('This does not look like an OJT-ERAMS backup file.');
    if (o.version !== MockDB.VERSION) fail('This backup was made by a different version of the system.');
    MockDB.save(o);
    return { ok: true };
  };
  S['admin.resetDemo'] = () => { MockDB.reset(); return { ok: true }; };

  /* ------------------------------------------------------------ dispatcher */
  const NO_AUTOSAVE = new Set(['admin.importBackup', 'admin.resetDemo']);
  const SAVE_ON_GET = new Set(['messages.get']);

  window.ApiBackend = {
    async call(name, args, session, portal) {
      const fn = S[name], meta = META[name];
      if (!fn || !meta) fail('Unknown API call: ' + name, 404);
      await delay(name === 'auth.login' ? 350 : 25);
      const db = MockDB.load();
      let user = null;
      if (session && session.user) user = db.users.find(u => u.username === session.user.username) || null;
      const ctx = { db, user, portal };
      if (meta.roles !== 'public') {
        if (!user) fail('Please sign in.', 401);
        if (meta.roles !== 'any' && !meta.roles.split(',').includes(user.role)) fail('You do not have permission to do that.', 403);
      }
      const out = fn(ctx, JSON.parse(JSON.stringify(args || {})));
      if (!NO_AUTOSAVE.has(name) && (meta.method !== 'GET' || SAVE_ON_GET.has(name))) MockDB.save(db);
      // Never leak passwords to the page (a real API would never send them either).
      return out === undefined ? undefined : JSON.parse(JSON.stringify(out, (k, v) => (k === 'password' ? undefined : v)));
    }
  };
})();
