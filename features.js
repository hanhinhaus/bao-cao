/* INHAUS Báo cáo ngày — Tải việc, Dự án (giai đoạn + ngân sách giờ), Duyệt hồ sơ, Báo cáo tuần */
'use strict';

const CAP_HOURS = 44;                       // giờ làm chuẩn một tuần
const STD_PHASES = [                          // giai đoạn chuẩn + tỷ lệ thời gian/giờ tham khảo
  ['Khảo sát & mặt bằng công năng', 0.20],
  ['Phương án 3D & chốt vật liệu', 0.25],
  ['Hồ sơ kỹ thuật thi công', 0.40],
  ['Bàn giao & giám sát tác giả', 0.15]
];
const mondayOf = s => { const d = parse(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); };
const weekDays = mon => Array.from({ length: 7 }, (_, i) => addDays(mon, i));
const WDS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const fmtShort = s => s.slice(8, 10) + '/' + s.slice(5, 7);
const inWeek = (d, mon) => d && d >= mon && d <= addDays(mon, 6);

async function loadWeek(force) {
  if (!S.week) S.week = mondayOf(todayISO());
  const key = S.week;
  if (!force && S.weekKey === key && S.weekReports) return;
  try {
    const [rows, st] = await Promise.all([
      q(sb.from('reports').select('*').gte('date', key).lte('date', addDays(key, 6))),
      isAdmin() && !S.settings ? q(sb.from('settings').select('*')) : Promise.resolve(null)
    ]);
    S.weekReports = rows; S.weekKey = key;
    if (st) S.settings = st[0] || null;
  } catch (e) { toast(errMsg(e)); S.weekReports = S.weekReports || []; }
}
function weekNav() {
  const mon = S.week, sun = addDays(mon, 6), cur = mondayOf(todayISO());
  return `<div class="datebar"><button class="btn" data-wk="-1" aria-label="Tuần trước">‹</button>
    <span class="wkl num">${fmtShort(mon)} – ${fmt(sun)}</span>
    <button class="btn" data-wk="1" aria-label="Tuần sau" ${mon >= cur ? 'disabled' : ''}>›</button>
    ${mon !== cur ? '<button class="btn small ghost" data-wk="0">Tuần này</button>' : ''}</div>`;
}
const workdays = () => (S.settings && S.settings.remind_days) || [1, 2, 3, 4, 5, 6];

/* ---------- Tải việc ---------- */
function workloadOf(s, mon) {
  const days = weekDays(mon), reps = (S.weekReports || []).filter(r => r.staff_id === s.id);
  const perDay = days.map(d => reps.filter(r => r.date === d).reduce((a, r) => a + (Number(r.hours) || 0), 0));
  const total = perDay.reduce((a, b) => a + b, 0);
  const mine = S.tasks.filter(t => t.staff_id === s.id && t.status !== 'done');
  const dueWeek = mine.filter(t => inWeek(t.due, mon)).length;
  const overdue = mine.filter(isOverdue).length;
  const projects = new Set(S.members.filter(m => m.staff_id === s.id).map(m => m.project_id)).size;
  const level = (dueWeek >= 3 || overdue >= 2 || total > CAP_HOURS + 4) ? 'over' : mine.length === 0 ? 'free' : 'ok';
  return { perDay, total, open: mine.length, dueWeek, overdue, projects, level };
}
function viewWorkload() {
  if (!S.weekReports) { view('<div class="empty">Đang tải dữ liệu tuần…</div>'); loadWeek().then(renderView); return; }
  const mon = S.week, staff = S.staff.filter(s => s.role === 'staff' && s.active);
  const rows = staff.map(s => ({ s, w: workloadOf(s, mon) }));
  const order = { over: 0, ok: 1, free: 2 };
  rows.sort((a, b) => order[a.w.level] - order[b.w.level] || b.w.total - a.w.total);
  const maxDay = Math.max(10, ...rows.flatMap(r => r.w.perDay));
  const nOver = rows.filter(r => r.w.level === 'over').length, nFree = rows.filter(r => r.w.level === 'free').length;
  const chip = l => l === 'over' ? '<span class="chip bad">Quá tải</span>' : l === 'free' ? '<span class="chip info">Còn trống</span>' : '<span class="chip ok">Ổn</span>';
  view(`<section class="spread"><h2>Tải công việc theo người</h2>${weekNav()}</section>
  <section class="kpis">
    <div class="kpi ${nOver ? 'alert' : ''}"><span class="v">${nOver}</span><span class="l">Người quá tải</span></div>
    <div class="kpi"><span class="v">${nFree}</span><span class="l">Người còn trống việc</span></div>
    <div class="kpi"><span class="v">${hrs(rows.reduce((a, r) => a + r.w.total, 0))}</span><span class="l">Tổng giờ báo cáo trong tuần</span></div>
    <div class="kpi"><span class="v">${rows.reduce((a, r) => a + r.w.dueWeek, 0)}</span><span class="l">Việc đến hạn trong tuần</span></div>
  </section>
  <section class="panel stack" style="padding-block:6px">
    <div class="wl-head"><span>Nhân sự</span><span>Giờ theo ngày (${WDS.slice(0, 6).join(' ')})</span><span>Giờ / ${CAP_HOURS}</span><span>Việc mở</span><span>Đến hạn tuần</span><span>Quá hạn</span></div>
    ${rows.map(({ s, w }) => `<div class="wl-row">
      <div class="wl-name"><b>${esc(s.name)}</b>${chip(w.level)}<small class="muted">${w.projects} dự án</small></div>
      <div class="minibars" aria-label="Giờ theo ngày">${w.perDay.slice(0, 6).map((h, i) => `<i title="${WDS[i]} ${fmtShort(addDays(mon, i))}: ${hrs(h)} giờ" style="height:${Math.max(2, h / maxDay * 100)}%" class="${h > 9 ? 'hi' : h === 0 ? 'zero' : ''}"></i>`).join('')}</div>
      <div class="wl-num" data-l="Giờ trong tuần"><span class="num">${hrs(w.total)}</span><div class="bar ${w.total > CAP_HOURS ? 'over' : ''}"><span style="width:${Math.min(100, w.total / CAP_HOURS * 100)}%"></span></div></div>
      <div class="wl-num num" data-l="Việc mở">${w.open}</div>
      <div class="wl-num num ${w.dueWeek >= 3 ? 'overdue' : ''}" data-l="Đến hạn tuần">${w.dueWeek}</div>
      <div class="wl-num num ${w.overdue ? 'overdue' : ''}" data-l="Quá hạn">${w.overdue}</div>
    </div>`).join('') || '<div class="empty">Chưa có nhân sự.</div>'}
  </section>
  <p class="muted" style="font-size:13px">Quá tải: từ 3 việc đến hạn trong tuần, hoặc từ 2 việc quá hạn, hoặc báo cáo trên ${CAP_HOURS + 4} giờ/tuần. Còn trống: không có việc nào đang mở. Dùng bảng này khi phân việc sáng thứ Hai.</p>`);
}

/* ---------- Dự án: giai đoạn + ngân sách giờ ---------- */
function hoursFor(projectName, phaseId) {
  return S.hours.filter(h => h.project === projectName && (phaseId === undefined || Number(h.phase_id || 0) === Number(phaseId || 0)))
    .reduce((a, h) => a + (Number(h.hours) || 0), 0);
}
function phaseStats(p, f) {
  const ts = S.tasks.filter(t => t.phase_id === f.id);
  const progress = ts.length ? Math.round(ts.reduce((a, t) => a + (t.status === 'done' ? 100 : Number(t.progress) || 0), 0) / ts.length) : null;
  const st = sched(f.start_date, f.end_date, progress, ts.length && ts.every(t => t.status === 'done'));
  const used = hoursFor(p.name, f.id), budget = f.budget_hours == null ? null : Number(f.budget_hours);
  const ratio = budget ? used / budget : null;
  const budgetCode = ratio == null ? 'none' : ratio > 1 ? 'late' : (ratio >= 0.8 && (progress ?? 0) < 80) ? 'behind' : 'ok';
  return { ...st, progress, tasks: ts.length, used, budget, ratio, budgetCode };
}
function viewProjects() {
  const admin = isManager();
  const list = admin ? S.projects : S.projects.filter(p => p.lead_staff_id === S.me.id);
  const leads = S.staff.filter(s => s.active);
  view(`<section class="stack" style="gap:4px"><h2>Dự án · giai đoạn hồ sơ · ngân sách giờ</h2>
    <p class="muted">Giờ thực tế lấy từ báo cáo ngày (đầu việc có chọn giai đoạn). Cảnh báo khi đã dùng từ 80% ngân sách giờ mà tiến độ giai đoạn chưa tới 80%.</p></section>
  ${list.map(p => {
    const ps = phasesOf(p.name), st = projectStats(p), noPhase = hoursFor(p.name, null), total = hoursFor(p.name);
    const budgetTotal = ps.reduce((a, f) => a + (Number(f.budget_hours) || 0), 0);
    const team = S.members.filter(m => m.project_id === p.id).map(m => staffName(m.staff_id));
    return `<section class="panel stack pcard">
      <div class="spread"><div style="min-width:0"><h2 style="font-size:20px">${esc(p.name)}</h2>
        <div class="muted" style="font-size:13px">${p.deadline ? deadlineText(p.deadline) : 'Chưa đặt deadline'} · ${hrs(total)}${budgetTotal ? ' / ' + hrs(budgetTotal) : ''} giờ${team.length ? ' · ' + team.length + ' người' : ''}</div></div>
        <div class="row">${schedChip(st)}
        ${admin ? `<label class="f" style="min-width:200px">Chủ trì<select id="pl-${p.id}" data-lead="${p.id}"><option value="">— Chưa chọn —</option>${leads.map(s => `<option value="${s.id}" ${s.id === p.lead_staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`
               : `<span class="muted">Chủ trì: <b>${esc(p.lead_staff_id ? staffName(p.lead_staff_id) : '—')}</b></span>`}</div></div>
      ${admin ? `<div class="stack" style="gap:6px"><span class="muted" style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Người tham gia dự án (bấm để gắn / bỏ)</span><div class="ticks">${S.staff.filter(s => s.active && s.role === 'staff').map(s => { const on = S.members.some(m => m.project_id === p.id && m.staff_id === s.id); return `<button class="chipbtn" aria-pressed="${on}" data-assign="${p.id}:${s.id}">${on ? '✓ ' : ''}${esc(s.name)}</button>`; }).join('')}</div></div>` : ''}
      ${ps.length ? `<div class="scroll"><table class="tbl ph"><thead><tr><th>Giai đoạn</th><th>Bắt đầu</th><th>Kết thúc</th><th>Giờ dự kiến</th><th>Giờ thực tế</th><th>Tiến độ</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
        ${ps.map(f => { const s2 = phaseStats(p, f); return `<tr>
          <td>${admin ? `<input id="fn-${f.id}" value="${esc(f.name)}" aria-label="Tên giai đoạn">` : `<b>${esc(f.name)}</b>`}<div class="muted" style="font-size:12px">${s2.tasks} việc</div></td>
          <td>${admin ? `<input type="date" id="fs-${f.id}" value="${f.start_date || ''}" aria-label="Bắt đầu">` : fmt(f.start_date) || '—'}</td>
          <td>${admin ? `<input type="date" id="fe-${f.id}" value="${f.end_date || ''}" aria-label="Kết thúc">` : fmt(f.end_date) || '—'}</td>
          <td>${admin ? `<input type="number" min="0" step="1" id="fb-${f.id}" value="${f.budget_hours ?? ''}" style="width:90px" aria-label="Giờ dự kiến">` : (f.budget_hours ?? '—')}</td>
          <td><div class="bud"><span class="num">${hrs(s2.used)}h${s2.budget ? ` · ${Math.round(s2.ratio * 100)}%` : ''}</span>${s2.budget ? `<div class="bar ${s2.budgetCode}"><span style="width:${Math.min(100, s2.ratio * 100)}%"></span></div>` : ''}</div>
            ${s2.budgetCode === 'late' ? '<span class="chip bad">Vượt ngân sách giờ</span>' : s2.budgetCode === 'behind' ? '<span class="chip warn">Sắp hết giờ</span>' : ''}</td>
          <td><span class="num">${s2.progress == null ? '—' : s2.progress + '%'}</span> ${schedChip(s2)}</td>
          ${admin ? `<td class="row" style="flex-wrap:nowrap"><button class="btn small" data-savephase="${f.id}">Lưu</button><button class="btn small danger ${S.armed === 'f' + f.id ? 'armed' : ''}" data-delphase="${f.id}">${S.armed === 'f' + f.id ? 'Xác nhận xoá' : 'Xoá'}</button></td>` : ''}
        </tr>`; }).join('')}
        </tbody></table></div>
        ${noPhase ? `<p class="muted" style="font-size:13px">${hrs(noPhase)} giờ đã báo cáo chưa chọn giai đoạn.</p>` : ''}
        ${admin ? `<div><button class="btn small" data-addphase="${p.id}">+ Thêm giai đoạn</button></div>` : ''}`
      : admin ? `<div class="empty" style="padding:16px">Dự án chưa chia giai đoạn. <button class="btn small primary" data-mkphases="${p.id}">Tạo 4 giai đoạn chuẩn</button>
          <div class="muted" style="font-size:12px;margin-top:6px">Khảo sát & mặt bằng 20% · 3D & vật liệu 25% · Hồ sơ kỹ thuật 40% · Bàn giao & giám sát 15% thời gian dự án</div></div>`
      : '<p class="muted">Dự án chưa chia giai đoạn.</p>'}
    </section>`; }).join('') || '<div class="empty">Chưa có dự án nào trong phạm vi của bạn.</div>'}`);
}
async function makeStdPhases(pid, btn) {
  const p = S.projects.find(x => x.id === pid); if (!p) return;
  btn.disabled = true;
  let start = p.start_date, end = p.deadline, rows = [];
  if (start && end && start < end) {
    const total = dayDiff(start, end); let cur = start, acc = 0;
    STD_PHASES.forEach(([name, share], i) => {
      acc += share; const e = i === STD_PHASES.length - 1 ? end : addDays(start, Math.round(total * acc));
      rows.push({ project_id: pid, idx: i + 1, name, start_date: cur, end_date: e }); cur = e;
    });
  } else rows = STD_PHASES.map(([name], i) => ({ project_id: pid, idx: i + 1, name }));
  try { const res = await q(sb.from('project_phases').insert(rows).select()); S.phases.push(...res); toast('Đã tạo 4 giai đoạn cho ' + p.name); }
  catch (e) { toast(errMsg(e)); }
  viewProjects();
}

/* ---------- Duyệt hồ sơ ---------- */
function viewReview() {
  const queue = sortTasks(S.tasks.filter(t => t.status === 'review' && canReviewTask(t) && (isAdmin() || t.staff_id !== S.me.id)));
  const titleOf = id => (S.tasks.find(t => t.id === id) || {}).title || '(việc đã xoá)';
  const history = S.reviews.filter(r => S.tasks.some(t => t.id === r.task_id && canReviewTask(t))).slice(0, 20);
  const cl = S.checklist.length ? S.checklist : ['Đã kiểm tra hồ sơ theo tiêu chuẩn INHAUS'];
  view(`<section class="stack" style="gap:4px"><h2>Duyệt hồ sơ nội bộ</h2>
    <p class="muted">Việc nhân viên báo xong (100%) sẽ chờ ở đây. Tích đủ checklist rồi bấm <b>Đạt</b> để hoàn thành, hoặc <b>Trả lại</b> kèm lý do. Không tự duyệt việc của chính mình.</p></section>
  ${queue.length ? queue.map(t => {
    const past = S.reviews.filter(r => r.task_id === t.id);
    return `<section class="panel stack rv">
      <div class="spread"><div style="min-width:0"><b class="t">${esc(t.title)}</b>
        <div class="sub muted" style="font-size:13px">${esc(staffName(t.staff_id))} · ${esc(t.project || 'Việc chung')}${t.phase_id ? ' · ' + esc(phaseName(t.phase_id)) : ''}${t.due ? ' · ' + deadlineText(t.due) : ''}${t.returns ? ` · <span class="overdue">đã trả lại ${t.returns} lần</span>` : ''}</div></div>
        ${safeUrl(t.link) ? `<a class="btn small" href="${esc(safeUrl(t.link))}" target="_blank" rel="noopener">Mở bản vẽ ↗</a>` : '<span class="chip dim">Chưa gắn link bản vẽ</span>'}</div>
      ${past.length ? `<div class="muted" style="font-size:13px">Lần trước: ${past.slice(0, 2).map(r => `${r.result === 'pass' ? 'Đạt' : 'Trả lại'} (${esc(staffName(r.reviewer_id))}, ${fmt(r.created_at.slice(0, 10))})${r.note ? ': ' + esc(r.note) : ''}`).join(' · ')}</div>` : ''}
      <div class="checklist">${cl.map((c, i) => `<label class="tick"><input type="checkbox" id="rv-${t.id}-${i}" data-rvtask="${t.id}"> <span>${esc(c)}</span></label>`).join('')}</div>
      <label class="f">Nhận xét / lý do trả lại<textarea id="rvn-${t.id}" placeholder="Bắt buộc khi trả lại: ghi rõ bản vẽ nào, sửa gì"></textarea></label>
      <div class="row"><button class="btn primary" data-review="pass" data-task="${t.id}">Đạt – hoàn thành</button><button class="btn danger" data-review="return" data-task="${t.id}">Trả lại để sửa</button><span class="muted" id="rvm-${t.id}" role="alert"></span></div>
    </section>`; }).join('') : '<div class="empty">Không có hồ sơ nào đang chờ bạn duyệt.</div>'}
  <section class="panel stack"><h3>Lịch sử duyệt gần đây</h3>
    ${history.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Ngày</th><th>Việc</th><th>Kết quả</th><th>Người duyệt</th><th>Nhận xét</th></tr></thead><tbody>
      ${history.map(r => `<tr><td class="num">${fmt(r.created_at.slice(0, 10))}</td><td>${esc(titleOf(r.task_id))}</td><td>${r.result === 'pass' ? '<span class="chip ok">Đạt</span>' : '<span class="chip warn">Trả lại</span>'}</td><td>${esc(staffName(r.reviewer_id))}</td><td>${esc(r.note)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Chưa có lượt duyệt nào.</p>'}
  </section>`);
}
async function doReview(btn) {
  const id = btn.dataset.task, result = btn.dataset.review, msg = $('#rvm-' + id);
  const boxes = [...document.querySelectorAll(`[data-rvtask="${id}"]`)], checked = boxes.map((b, i) => b.checked ? i : -1).filter(i => i >= 0);
  const note = ($('#rvn-' + id).value || '').trim();
  if (result === 'pass' && checked.length < boxes.length) { msg.textContent = `Còn ${boxes.length - checked.length} mục checklist chưa tích.`; return; }
  if (result === 'return' && !note) { msg.textContent = 'Ghi lý do trả lại trước khi bấm.'; $('#rvn-' + id).focus(); return; }
  btn.disabled = true; msg.textContent = 'Đang lưu…';
  try {
    await q(sb.rpc('review_task', { p_task: id, p_result: result, p_checklist: checked, p_note: note }));
    const [tasks, reviews] = await Promise.all([q(sb.from('tasks').select('*')), q(sb.from('task_reviews').select('*').order('created_at', { ascending: false }))]);
    S.tasks = tasks; S.reviews = reviews;
    toast(result === 'pass' ? 'Đã duyệt đạt, việc chuyển sang Hoàn thành' : 'Đã trả lại hồ sơ kèm nhận xét');
    renderTabs(); viewReview();
  } catch (e) { btn.disabled = false; msg.textContent = errMsg(e); }
}

/* ---------- Báo cáo tuần ---------- */
function weekData() {
  const mon = S.week, sun = addDays(mon, 6), today = todayISO();
  const wds = workdays(), days = weekDays(mon).filter(d => wds.includes(((parse(d).getDay() + 6) % 7) + 1) && d <= today);
  const staff = S.staff.filter(s => s.role === 'staff' && s.active);
  const reps = S.weekReports || [];
  const sent = staff.map(s => ({ s, n: days.filter(d => reps.some(r => r.staff_id === s.id && r.date === d)).length, h: reps.filter(r => r.staff_id === s.id).reduce((a, r) => a + (Number(r.hours) || 0), 0), done: S.tasks.filter(t => t.staff_id === s.id && t.done_at && inWeek(t.done_at.slice(0, 10), mon)).length }));
  const expected = staff.length * days.length, got = sent.reduce((a, x) => a + x.n, 0);
  const hours = {}; reps.forEach(r => (r.items || []).forEach(i => { const k = i.project || 'Chưa chọn dự án'; hours[k] = (hours[k] || 0) + (Number(i.hours) || 0); }));
  const reviews = S.reviews.filter(r => inWeek(r.created_at.slice(0, 10), mon));
  const pst = S.projects.map(p => ({ p, st: projectStats(p) })).filter(x => ['late', 'behind', 'soon'].includes(x.st.code));
  const done = S.tasks.filter(t => t.done_at && inWeek(t.done_at.slice(0, 10), mon));
  const late = S.tasks.filter(isOverdue);
  const blockers = reps.filter(r => (r.blockers || '').trim()).sort((a, b) => b.date.localeCompare(a.date));
  return { mon, sun, days, staff, sent, expected, got, hours, reviews, pst, done, late, blockers, total: reps.reduce((a, r) => a + (Number(r.hours) || 0), 0) };
}
function viewWeekly() {
  if (!S.weekReports) { view('<div class="empty">Đang tải dữ liệu tuần…</div>'); loadWeek().then(renderView); return; }
  const W = weekData(), rate = W.expected ? Math.round(W.got / W.expected * 100) : null;
  const hp = Object.entries(W.hours).sort((a, b) => b[1] - a[1]), maxH = Math.max(1, ...hp.map(x => x[1]));
  const ret = W.reviews.filter(r => r.result === 'return').length;
  view(`<section class="spread"><h2>Báo cáo tuần</h2>${weekNav()}</section>
  <section class="kpis">
    <div class="kpi ${rate != null && rate < 95 ? 'alert' : ''}"><span class="v">${rate == null ? '—' : rate + '%'}</span><span class="l">Nộp báo cáo đúng ngày (${W.got}/${W.expected})</span></div>
    <div class="kpi"><span class="v">${hrs(W.total)}</span><span class="l">Tổng giờ làm</span></div>
    <div class="kpi"><span class="v">${W.done.length}</span><span class="l">Việc hoàn thành trong tuần</span></div>
    <div class="kpi ${ret ? 'alert' : ''}"><span class="v">${ret}<span class="muted" style="font-size:16px">/${W.reviews.length}</span></span><span class="l">Hồ sơ bị trả lại / lượt duyệt</span></div>
  </section>
  <div class="row"><button class="btn primary" data-act="copyweek">Sao chép tóm tắt để gửi nhóm</button><span class="muted" style="font-size:13px">Tự động gửi thông báo tóm tắt cho quản lý lúc 17h thứ Sáu.</span></div>
  <section class="panel stack"><h3>Dự án cần chú ý</h3>
    ${W.pst.length ? W.pst.map(({ p, st }) => `<div class="spread"><span><b>${esc(p.name)}</b> <span class="muted" style="font-size:13px">${deadlineText(p.deadline)} · ${st.progress ?? '—'}%</span></span>${schedChip(st)}</div>`).join('') : '<p class="muted">Không có dự án nào chậm hoặc trễ.</p>'}
  </section>
  <section class="panel stack"><h3>Giờ làm theo dự án trong tuần</h3>
    ${hp.length ? hp.map(([k, v]) => `<div class="projbar"><span style="min-width:0;overflow-wrap:anywhere">${esc(k)}</span><div class="track"><span style="width:${v / maxH * 100}%"></span></div><span class="num" style="text-align:right">${hrs(v)}h</span></div>`).join('') : '<p class="muted">Chưa có giờ làm.</p>'}
  </section>
  <section class="panel stack"><h3>Từng người</h3>
    <div class="scroll"><table class="tbl"><thead><tr><th>Nhân sự</th><th>Ngày đã nộp</th><th>Giờ</th><th>Việc xong</th><th>Việc quá hạn</th></tr></thead><tbody>
    ${W.sent.sort((a, b) => a.n - b.n).map(x => `<tr><td>${esc(x.s.name)}</td><td class="num ${x.n < W.days.length ? 'overdue' : ''}">${x.n}/${W.days.length}</td><td class="num">${hrs(x.h)}</td><td class="num">${x.done}</td><td class="num">${S.tasks.filter(t => t.staff_id === x.s.id && isOverdue(t)).length}</td></tr>`).join('')}
    </tbody></table></div>
  </section>
  <section class="panel stack"><h3>Việc hoàn thành trong tuần</h3>
    ${W.done.length ? W.done.map(t => `<div class="spread"><span>${esc(t.title)} <span class="muted" style="font-size:13px">· ${esc(staffName(t.staff_id))} · ${esc(t.project || 'Việc chung')}</span></span><span class="chip ok">${fmt(t.done_at.slice(0, 10))}</span></div>`).join('') : '<p class="muted">Chưa có việc nào được duyệt hoàn thành trong tuần.</p>'}
  </section>
  ${W.late.length ? `<section class="stack"><h3>Việc đang trễ hạn</h3><div class="panel">${sortTasks(W.late).map(t => taskRow(t, false, true)).join('')}</div></section>` : ''}
  <section class="stack"><h3>Vướng mắc trong tuần</h3>
    ${W.blockers.length ? W.blockers.map(r => `<div class="blocker"><b>${esc(staffName(r.staff_id))} (${fmtShort(r.date)}):</b> ${esc(r.blockers)}</div>`).join('') : '<p class="muted">Không có vướng mắc nào được báo.</p>'}
  </section>`);
}
function weekText() {
  const W = weekData(), rate = W.expected ? Math.round(W.got / W.expected * 100) : 0;
  const lines = [`BÁO CÁO TUẦN INHAUS ${fmtShort(W.mon)} – ${fmt(W.sun)}`,
    `• Nộp báo cáo: ${rate}% (${W.got}/${W.expected}) · Tổng ${hrs(W.total)} giờ`,
    `• Việc hoàn thành: ${W.done.length} · Đang trễ hạn: ${W.late.length} · Hồ sơ trả lại: ${W.reviews.filter(r => r.result === 'return').length}/${W.reviews.length}`];
  if (W.pst.length) { lines.push('• Dự án cần chú ý:'); W.pst.forEach(({ p, st }) => lines.push(`  – ${p.name}: ${st.label} (${st.progress ?? '—'}%, ${deadlineText(p.deadline)})`)); }
  const miss = W.sent.filter(x => x.n < W.days.length);
  if (miss.length) lines.push('• Thiếu báo cáo: ' + miss.map(x => `${x.s.name} (${x.n}/${W.days.length})`).join(', '));
  return lines.join('\n');
}

/* ---------- sự kiện ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !S.me) return;
  if (b.dataset.wk != null) {
    const k = Number(b.dataset.wk), cur = mondayOf(todayISO());
    S.week = k === 0 ? cur : addDays(S.week || cur, 7 * k); if (S.week > cur) S.week = cur;
    S.weekReports = null; await loadWeek(true); renderView(); return;
  }
  if (b.dataset.mkphases) return makeStdPhases(Number(b.dataset.mkphases), b);
  if (b.dataset.addphase) {
    const pid = Number(b.dataset.addphase), idx = Math.max(0, ...S.phases.filter(f => f.project_id === pid).map(f => f.idx)) + 1;
    try { const res = await q(sb.from('project_phases').insert({ project_id: pid, idx, name: 'Giai đoạn ' + idx }).select()); S.phases.push(...res); } catch (err) { toast(errMsg(err)); }
    viewProjects(); return;
  }
  if (b.dataset.savephase) {
    const id = Number(b.dataset.savephase), name = $('#fn-' + id).value.trim(), sd = $('#fs-' + id).value || null, ed = $('#fe-' + id).value || null, bud = $('#fb-' + id).value;
    if (!name) { toast('Tên giai đoạn không được để trống'); return; }
    if (sd && ed && sd > ed) { toast('Ngày bắt đầu đang sau ngày kết thúc'); return; }
    b.disabled = true;
    try { const res = await q(sb.from('project_phases').update({ name, start_date: sd, end_date: ed, budget_hours: bud === '' ? null : Math.max(0, Number(bud)) }).eq('id', id).select()); const i = S.phases.findIndex(f => f.id === id); S.phases[i] = res[0]; toast('Đã lưu giai đoạn ' + name); }
    catch (err) { toast(errMsg(err)); }
    viewProjects(); return;
  }
  if (b.dataset.delphase) {
    const id = Number(b.dataset.delphase);
    if (S.armed !== 'f' + id) { S.armed = 'f' + id; viewProjects(); return; }
    S.armed = null;
    try { await q(sb.from('project_phases').delete().eq('id', id)); S.phases = S.phases.filter(f => f.id !== id); S.tasks.forEach(t => { if (t.phase_id === id) t.phase_id = null; }); toast('Đã xoá giai đoạn. Việc thuộc giai đoạn này vẫn giữ.'); }
    catch (err) { toast(errMsg(err)); }
    viewProjects(); return;
  }
  if (b.dataset.review) return doReview(b);
  if (b.dataset.act === 'copyweek') {
    const text = weekText();
    try { await navigator.clipboard.writeText(text); toast('Đã sao chép. Dán vào Zalo/Teams để gửi nhóm.'); }
    catch { view(`<section class="panel stack"><h2>Tóm tắt tuần</h2><p class="muted">Chép đoạn dưới đây:</p><textarea rows="12" readonly>${esc(text)}</textarea><div><button class="btn" data-tab-go="weekly">Quay lại</button></div></section>`); }
    return;
  }
  if (b.dataset.act === 'savechecklist') {
    const items = $('#c-checklist').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!items.length) { toast('Checklist cần ít nhất 1 mục'); return; }
    try { await q(sb.from('settings').update({ review_checklist: items, updated_at: new Date().toISOString() }).eq('id', 1)); S.settings.review_checklist = items; S.checklist = items; toast(`Đã lưu checklist ${items.length} mục`); }
    catch (err) { toast(errMsg(err)); }
  }
});
document.addEventListener('change', async e => {
  const el = e.target; if (!S.me) return;
  if (el.dataset.lead) {
    const id = Number(el.dataset.lead), v = el.value ? Number(el.value) : null;
    try { await q(sb.rpc('set_project_lead', { p_id: id, p_staff: v })); const pr = S.projects.find(p => p.id === id); if (pr) pr.lead_staff_id = v; toast(v ? 'Đã đặt chủ trì: ' + staffName(v) : 'Đã bỏ chủ trì'); }
    catch (err) { toast(errMsg(err)); viewProjects(); }
  }
});

/* ---------- Nền sáng / tối (mặc định sáng) ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act="theme"]'); if (!b) return;
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('inhaus-theme', dark ? 'dark' : 'light'); } catch { /* trình duyệt chặn lưu */ }
  b.textContent = dark ? '☀ Chuyển nền sáng' : '☾ Chuyển nền tối';
  const m = $('#menu'); if (m) m.hidden = true;
});

/* ---------- Ô ngày luôn hiện dd/mm/yyyy (trình duyệt tiếng Anh vẫn hiện đúng) ---------- */
function dressDates(root) {
  root.querySelectorAll('input[type="date"]:not([data-dd])').forEach(inp => {
    inp.dataset.dd = '1';
    const w = document.createElement('span'); w.className = 'dwrap';
    inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    const lab = document.createElement('span'); lab.className = 'dlab num'; lab.setAttribute('aria-hidden', 'true'); w.appendChild(lab);
    const sync = () => { lab.textContent = inp.value ? fmt(inp.value) : 'dd/mm/yyyy'; lab.classList.toggle('ph', !inp.value); };
    inp.addEventListener('input', sync); inp.addEventListener('change', sync); sync();
    inp.addEventListener('click', () => { try { inp.showPicker(); } catch { /* trình duyệt cũ */ } });
  });
}
new MutationObserver(() => dressDates(document.body)).observe(document.body, { childList: true, subtree: true });
dressDates(document.body);
