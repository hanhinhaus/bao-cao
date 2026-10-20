/* INHAUS Báo cáo ngày — web app */
'use strict';
const CFG = window.INHAUS_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const fmt = s => s ? s.split('-').reverse().join('/') : '';
const WD = ['Chủ nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
const wd = s => WD[parse(s).getDay()];
const hm = t => { const d = new Date(t); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const hrs = n => (Math.round((Number(n)||0)*10)/10).toLocaleString('vi-VN');
const STATUS = {todo:'Chưa bắt đầu', doing:'Đang làm', review:'Chờ duyệt', done:'Hoàn thành'};
const isOverdue = t => t.due && t.status !== 'done' && t.due < todayISO();
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const S = {
  session: null, me: null, tab: null, date: todayISO(), sumDate: todayISO(),
  staff: [], projects: [], members: [], tasks: [], reports: [], myReport: null, settings: null,
  phases: [], reviews: [], hours: [], checklist: [], week: null, weekReports: null, weekKey: '',
  draft: null, draftKey: '', dirty: false, armed: null, tf: {staff:'', status:'open'},
  newTask: {title:'', staff:'', project:'', phase:'', due:'', note:'', link:''}, authMode: 'login', loading: false,
  installEvt: null, pushState: 'unknown'
};

/* ---------- tiện ích giao diện ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3500); }
function view(html) { $('#view').innerHTML = html; }
function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (/bad_code/.test(m)) return 'Mã mời không đúng. Hỏi chị Hạnh mã mới nhất.';
  if (/name_taken/.test(m)) return 'Đã có dự án khác trùng tên này (kể cả dự án đã ẩn).';
  if (/name_required/.test(m)) return 'Tên dự án không được để trống.';
  if (/taken/.test(m)) return 'Tên này đã có người liên kết. Báo chị Hạnh nếu bị nhầm.';
  if (/already_linked/.test(m)) return 'Tài khoản này đã liên kết với một tên khác.';
  if (/only_status_progress/.test(m)) return 'Bạn chỉ đổi được trạng thái và tiến độ của việc.';
  if (/only_admin_done/.test(m)) return 'Việc chỉ "Hoàn thành" sau khi chủ trì hoặc trưởng team duyệt. Hãy chọn "Chờ duyệt".';
  if (/not_reviewer/.test(m)) return 'Bạn không có quyền duyệt việc của dự án này.';
  if (/self_review/.test(m)) return 'Không tự duyệt việc của chính mình. Nhờ chủ trì hoặc trưởng team khác duyệt.';
  if (/note_required/.test(m)) return 'Ghi lý do trả lại để người làm biết cần sửa gì.';
  if (/row-level security|42501|permission denied/i.test(m)) return 'Tài khoản chưa có quyền làm việc này.';
  if (/Invalid login credentials/i.test(m)) return 'Sai email hoặc mật khẩu.';
  if (/already registered|already been registered/i.test(m)) return 'Email này đã có tài khoản. Chọn "Đăng nhập".';
  if (/Password should be at least/i.test(m)) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (/rate limit|too many/i.test(m)) return 'Thao tác quá nhiều lần. Đợi vài phút rồi thử lại.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Mất kết nối mạng. Kiểm tra mạng rồi thử lại.';
  return 'Có lỗi: ' + m;
}
const staffName = id => (S.staff.find(s => s.id === id) || {}).name || '—';
const isAdmin = () => S.me && S.me.role === 'admin';
const isReviewer = () => isAdmin() || !!(S.me && S.me.is_team_lead) || S.projects.some(p => S.me && p.lead_staff_id === S.me.id);
const canReviewTask = t => isAdmin() || !!S.me.is_team_lead || S.projects.some(p => p.name === t.project && p.lead_staff_id === S.me.id);
const phaseName = id => (S.phases.find(p => p.id === Number(id)) || {}).name || '';
const phasesOf = projectName => { const p = S.projects.find(x => x.name === projectName); return p ? S.phases.filter(f => f.project_id === p.id).sort((a, b) => a.idx - b.idx) : []; };
const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

/* ---------- Supabase ---------- */
if (!window.supabase || !CFG.url || !CFG.anonKey) {
  view('<div class="empty">App chưa được cấu hình kết nối dữ liệu.</div>');
  throw new Error('missing config');
}
const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

/* ---------- khởi động ---------- */
sb.auth.onAuthStateChange((evt, session) => {
  S.session = session;
  if (evt === 'PASSWORD_RECOVERY') { S.authMode = 'recover'; renderAuth(); return; }
  if (evt === 'SIGNED_OUT') { S.me = null; renderAuth(); }
});
(async function boot() {
  registerSW();
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (location.hash.includes('type=recovery')) return;
  await enter();
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me && !S.dirty) refresh(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.me) renderView(); });

async function enter() {
  if (!S.session) return renderAuth();
  try {
    const rows = await q(sb.from('staff').select('*').eq('user_id', S.session.user.id));
    S.me = rows[0] || null;
  } catch (e) { view(`<div class="empty">${esc(errMsg(e))}</div>`); return; }
  if (!S.me) return renderLink();
  S.tab = S.tab || (location.hash.replace('#','') || (isAdmin() ? 'summary' : 'report'));
  if (!tabList().some(([k]) => k === S.tab)) S.tab = isAdmin() ? 'summary' : 'report';
  renderUser();
  await refresh();
  checkPush();
}

async function refresh() {
  if (!S.me || S.loading) return;
  S.loading = true;
  try {
    const [staff, projects, tasks, members, phases, reviews] = await Promise.all([
      q(sb.from('staff').select('id,name,role,active,sort,user_id,linked_at,is_team_lead').order('sort').order('name')),
      q(sb.from('projects').select('*').eq('active', true).order('sort').order('name')),
      q(sb.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false })),
      q(sb.from('project_members').select('project_id,staff_id')),
      q(sb.from('project_phases').select('*').order('idx')),
      q(sb.from('task_reviews').select('*').order('created_at', { ascending: false }))
    ]);
    S.staff = staff; S.projects = projects; S.tasks = tasks; S.members = members; S.phases = phases; S.reviews = reviews;
    const meNow = staff.find(x => x.id === S.me.id); if (meNow) S.me = { ...S.me, ...meNow };
    if (isReviewer()) {
      const [cl, hrsRows] = await Promise.all([q(sb.rpc('review_checklist')), q(sb.rpc('hours_by_phase'))]);
      S.checklist = Array.isArray(cl) ? cl : []; S.hours = hrsRows || [];
    }
    if (['workload', 'weekly'].includes(S.tab)) await loadWeek(true);
    if (isAdmin()) {
      const from = addDays(S.sumDate, -9);
      S.reports = await q(sb.from('reports').select('*').gte('date', from).lte('date', S.sumDate));
      if (S.tab === 'settings') S.settings = (await q(sb.from('settings').select('*')))[0] || null;
    } else {
      const r = await q(sb.from('reports').select('*').eq('staff_id', S.me.id).eq('date', S.date));
      S.myReport = r[0] || null;
    }
  } catch (e) { toast(errMsg(e)); }
  S.loading = false;
  renderTabs(); renderView();
}

/* ---------- đăng nhập / đăng ký ---------- */
function renderAuth() {
  $('#nav').hidden = true; $('#userbox').innerHTML = '';
  const m = S.authMode;
  const title = { login: 'Đăng nhập', signup: 'Tạo tài khoản', forgot: 'Lấy lại mật khẩu', recover: 'Đặt mật khẩu mới' }[m];
  view(`<section class="panel stack auth">
    <h2>${title}</h2>
    ${m === 'signup' ? '<p class="muted">Dùng email của bạn. Bước sau sẽ cần mã mời do chị Hạnh gửi.</p>' : ''}
    ${m === 'forgot' ? '<p class="muted">Nhập email đã đăng ký. Hệ thống gửi đường dẫn đặt lại mật khẩu vào email đó.</p>' : ''}
    <form id="authform" class="stack" novalidate>
      ${m !== 'recover' ? `<label class="f">Email<input id="a-email" type="email" autocomplete="email" required></label>` : ''}
      ${m !== 'forgot' ? `<label class="f">Mật khẩu${m !== 'login' ? ' (ít nhất 8 ký tự)' : ''}<input id="a-pass" type="password" autocomplete="${m === 'login' ? 'current-password' : 'new-password'}" minlength="8" required></label>` : ''}
      <button class="btn primary" type="submit" id="a-go">${{ login: 'Đăng nhập', signup: 'Tạo tài khoản', forgot: 'Gửi email', recover: 'Lưu mật khẩu' }[m]}</button>
      <p class="muted" id="a-msg" role="alert"></p>
    </form>
    <div class="row">
      ${m === 'login' ? '<button class="btn ghost" data-mode="signup">Chưa có tài khoản? Tạo mới</button><button class="btn ghost" data-mode="forgot">Quên mật khẩu</button>' : ''}
      ${m === 'signup' || m === 'forgot' ? '<button class="btn ghost" data-mode="login">Đã có tài khoản? Đăng nhập</button>' : ''}
    </div>
  </section>`);
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'authform') return;
  e.preventDefault();
  const m = S.authMode, msg = $('#a-msg'), btn = $('#a-go');
  const email = ($('#a-email') || {}).value?.trim(), pass = ($('#a-pass') || {}).value;
  if (m !== 'recover' && !/^\S+@\S+\.\S+$/.test(email || '')) { msg.textContent = 'Nhập email hợp lệ.'; return; }
  if (m !== 'forgot' && m !== 'login' && (pass || '').length < 8) { msg.textContent = 'Mật khẩu cần ít nhất 8 ký tự.'; return; }
  btn.disabled = true; msg.textContent = 'Đang xử lý…';
  try {
    if (m === 'login') { await q(sb.auth.signInWithPassword({ email, password: pass })); await waitSession(); await enter(); }
    else if (m === 'signup') {
      const d = await q(sb.auth.signUp({ email, password: pass }));
      if (!d.session) { msg.textContent = 'Đã tạo tài khoản. Mở email để xác nhận rồi quay lại đăng nhập.'; btn.disabled = false; return; }
      await waitSession(); await enter();
    }
    else if (m === 'forgot') {
      await q(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      msg.textContent = 'Đã gửi. Mở email và bấm đường dẫn để đặt mật khẩu mới.'; btn.disabled = false;
    }
    else if (m === 'recover') { await q(sb.auth.updateUser({ password: pass })); history.replaceState(null, '', location.pathname); S.authMode = 'login'; toast('Đã đổi mật khẩu'); await enter(); }
  } catch (err) { msg.textContent = errMsg(err); btn.disabled = false; }
});
async function waitSession() { const { data } = await sb.auth.getSession(); S.session = data.session; }

function renderLink() {
  $('#nav').hidden = true;
  $('#userbox').innerHTML = `<span>${esc(S.session.user.email)}</span><button class="btn small" data-act="logout">Đăng xuất</button>`;
  view(`<section class="panel stack auth">
    <h2>Bạn là ai trong đội INHAUS?</h2>
    <p class="muted">Nhập mã mời do chị Hạnh gửi, rồi chọn đúng tên của bạn. Chỉ làm một lần.</p>
    <div class="row"><input id="l-code" placeholder="Mã mời, VD: INHAUS-AB12CD" autocomplete="off" autocapitalize="characters" style="flex:1"><button class="btn" data-act="loadnames">Tiếp</button></div>
    <div id="l-names" class="stack"></div>
    <p class="muted" id="l-msg" role="alert"></p>
  </section>`);
}
async function loadNames() {
  const code = $('#l-code').value.trim().toUpperCase(), box = $('#l-names'), msg = $('#l-msg');
  if (!code) { msg.textContent = 'Nhập mã mời.'; return; }
  msg.textContent = 'Đang kiểm tra…';
  try {
    const names = await q(sb.rpc('unclaimed_staff', { p_code: code }));
    if (!names.length) { msg.textContent = 'Mã mời không đúng, hoặc mọi tên đã được liên kết.'; box.innerHTML = ''; return; }
    msg.textContent = '';
    box.innerHTML = `<label class="f">Tên của bạn<select id="l-name"><option value="">— Chọn tên —</option>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      <button class="btn primary" data-act="claim" data-code="${esc(code)}">Xác nhận</button>`;
  } catch (e) { msg.textContent = errMsg(e); }
}

/* ---------- khung chính ---------- */
function renderUser() {
  $('#userbox').innerHTML = `<span><b>${esc(S.me.name)}</b>${isAdmin() ? ' · quản lý' : ''}</span>
   <div class="menu"><button class="btn small" data-act="menu" aria-haspopup="true" aria-label="Tài khoản">☰</button><div class="menu-pop" id="menu" hidden>
     <button data-act="push-on">Bật thông báo nhắc 17h</button>
     <button data-act="push-test">Gửi thông báo thử</button>
     <button data-act="howto">Hướng dẫn cài app lên máy</button>
     <button data-act="theme">${document.documentElement.dataset.theme === 'dark' ? '☀ Chuyển nền sáng' : '☾ Chuyển nền tối'}</button>
     <button data-act="refresh">Tải lại dữ liệu</button>
     <button data-act="logout">Đăng xuất</button></div></div>`;
}
function tabList() {
  const toReview = S.tasks.filter(t => t.status === 'review' && canReviewTask(t) && (isAdmin() || t.staff_id !== S.me.id)).length;
  if (isAdmin()) return [['summary','Tổng hợp'],['workload','Tải việc'],['projects','Dự án'],['tasks','Giao việc'],['review','Duyệt hồ sơ',toReview],['weekly','Báo cáo tuần'],['settings','Cài đặt']];
  const open = S.tasks.filter(t => t.staff_id === S.me.id && t.status !== 'done').length;
  const tabs = [['report','Báo cáo ngày'],['mine','Việc của tôi',open]];
  if (isReviewer()) tabs.push(['review','Duyệt hồ sơ',toReview], ['projects','Dự án']);
  return tabs;
}
function renderTabs() {
  $('#nav').hidden = false;
  $('#tabs').innerHTML = tabList().map(([k,l,b]) => `<button data-tab="${k}" aria-current="${S.tab===k}">${l}${b ? `<span class="badge">${b}</span>` : ''}</button>`).join('');
}
$('#tabs').addEventListener('click', async e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  if (S.dirty && S.tab === 'report' && !confirmLeave()) return;
  S.tab = b.dataset.tab; S.armed = null; history.replaceState(null, '', '#' + S.tab);
  renderTabs();
  if (S.tab === 'settings' && !S.settings) await refresh();
  else if (['workload', 'weekly'].includes(S.tab)) { await loadWeek(); renderView(); }
  else renderView();
});
function confirmLeave() { S.dirty = false; return true; }

function installBanner() {
  if (standalone()) return '';
  if (S.installEvt) return `<div class="notice install"><span>Cài app lên máy để mở nhanh và nhận thông báo nhắc 17h.</span><button class="btn small primary" data-act="install">Cài app</button></div>`;
  if (isIOS) return `<div class="notice install"><span>iPhone: bấm nút Chia sẻ <b>⎋</b> → <b>Thêm vào MH chính</b> để cài app và nhận thông báo.</span><button class="btn small" data-act="howto">Xem hướng dẫn</button></div>`;
  return '';
}
function pushBanner() {
  if (!standalone() && isIOS) return '';
  if (S.pushState === 'off' && 'Notification' in window && Notification.permission !== 'denied')
    return `<div class="notice install"><span>Bật thông báo để được nhắc nộp báo cáo lúc 17h.</span><button class="btn small primary" data-act="push-on">Bật thông báo</button></div>`;
  return '';
}

function renderView() {
  if (!S.me) return;
  const fn = { report: viewReport, mine: viewMine, summary: viewSummary, tasks: viewTasks, settings: viewSettings, howto: viewHowto,
    workload: viewWorkload, projects: viewProjects, review: viewReview, weekly: viewWeekly }[S.tab] || viewReport;
  fn();
}

/* ---------- NHÂN VIÊN: báo cáo ngày ---------- */
const blankItem = () => ({ project: '', task_id: '', phase_id: '', work: '', hours: '', percent: '', link: '' });
function loadDraft() {
  const r = S.myReport;
  S.draft = r ? { items: (r.items || []).map(i => ({ project: i.project || '', task_id: i.task_id || '', phase_id: i.phase_id ?? '', work: i.work || '', hours: i.hours ?? '', percent: i.percent ?? '', link: i.link || '' })), blockers: r.blockers || '', tomorrow: r.tomorrow || '' }
              : { items: [blankItem()], blockers: '', tomorrow: '' };
  if (!S.draft.items.length) S.draft.items = [blankItem()];
  S.draftKey = S.date; S.dirty = false;
}
function viewReport() {
  if (S.draftKey !== S.date || !S.dirty) loadDraft();
  const r = S.myReport, me = S.me;
  const myTasks = S.tasks.filter(t => t.staff_id === me.id && (t.status !== 'done' || S.draft.items.some(i => i.task_id === t.id)));
  const projNames = S.projects.map(p => p.name);
  const mine = myProjects(), mineNames = mine.map(p => p.name), others = projNames.filter(n => !mineNames.includes(n));
  const opt = sel => p => `<option ${p===sel?'selected':''}>${esc(p)}</option>`;
  const projOpts = sel => `<option value="">— Chọn dự án —</option>`
    + (mine.length ? `<optgroup label="Dự án của bạn">${mineNames.map(opt(sel)).join('')}</optgroup><optgroup label="Dự án khác">${others.map(opt(sel)).join('')}</optgroup>` : projNames.map(opt(sel)).join(''))
    + (sel && !projNames.includes(sel) ? `<option selected>${esc(sel)}</option>` : '');
  const used = new Set(S.draft.items.map(i => i.project).filter(Boolean));
  const taskOpts = sel => `<option value="">— Không gắn việc được giao —</option>` + myTasks.map(t => `<option value="${t.id}" ${t.id===sel?'selected':''}>${esc(t.title)}${t.due ? ' · hạn ' + fmt(t.due) : ''}</option>`).join('');
  const total = S.draft.items.reduce((a,i) => a + (Number(i.hours)||0), 0);
  view(`${installBanner()}${pushBanner()}
  <section class="spread">
    <div class="stack" style="gap:2px"><h2>Chào ${esc(me.name)}</h2><p class="muted">Ghi lại việc đã làm, tiến độ và vướng mắc trong ngày.</p></div>
    <div class="datebar">
      <button class="btn" data-act="prev" aria-label="Ngày trước">‹</button>
      <input type="date" id="r-date" value="${S.date}" max="${todayISO()}">
      <button class="btn" data-act="next" aria-label="Ngày sau" ${S.date >= todayISO() ? 'disabled' : ''}>›</button>
      <span class="wd">${wd(S.date)}</span>
    </div>
  </section>
  ${r ? `<div class="notice">Đã gửi lúc <b class="num">${hm(r.submitted_at)}</b> ngày ${fmt(iso(new Date(r.submitted_at)))}. Bạn có thể sửa rồi gửi lại.</div>` : ''}
  <section class="stack">
    ${mine.length ? `<div class="panel stack" style="padding:14px"><h3>Hôm nay bạn làm dự án nào?</h3>
      <div class="ticks">${mine.map(p => `<label class="tick"><input type="checkbox" id="pj-${p.id}" data-pjtick="${esc(p.name)}" ${used.has(p.name) ? 'checked' : ''}> <span>${esc(p.name)}${p.deadline ? `<small class="${dayDiff(todayISO(), p.deadline) < 0 ? 'overdue' : 'muted'}"> · ${deadlineText(p.deadline).replace(/^Hạn /, 'hạn ')}</small>` : ''}</span></label>`).join('')}</div>
      <p class="muted" style="font-size:13px">Tích dự án để thêm sẵn một dòng đầu việc cho dự án đó.</p></div>` : ''}
    <div class="spread"><h3>Đầu việc trong ngày</h3><span class="muted">Tổng: <b class="num" id="r-total">${hrs(total)}</b> giờ</span></div>
    ${S.draft.items.map((it, i) => `
      <div class="item-card">
        <div class="head"><h3>Việc ${i+1}</h3>${S.draft.items.length > 1 ? `<button class="btn ghost danger" data-del="${i}">Bỏ dòng</button>` : ''}</div>
        <label class="f half">Dự án<select id="it${i}-project" data-i="${i}" data-f="project">${projOpts(it.project)}</select></label>
        <label class="f half">Việc được giao<select id="it${i}-task" data-i="${i}" data-f="task_id">${taskOpts(it.task_id)}</select></label>
        ${phasesOf(it.project).length ? `<label class="f half">Giai đoạn<select id="it${i}-phase" data-i="${i}" data-f="phase_id"><option value="">— Chọn giai đoạn —</option>${phasesOf(it.project).map(f => `<option value="${f.id}" ${String(f.id) === String(it.phase_id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : ''}
        <label class="f wide">Nội dung công việc<textarea id="it${i}-work" data-i="${i}" data-f="work" placeholder="VD: Triển khai bản vẽ chi tiết tủ bếp, chỉnh mặt bằng điện tầng 2">${esc(it.work)}</textarea></label>
        <label class="f">Số giờ<input id="it${i}-hours" data-i="${i}" data-f="hours" type="number" min="0" max="24" step="0.5" inputmode="decimal" value="${esc(it.hours)}"></label>
        <label class="f">Tiến độ hạng mục (%)<input id="it${i}-percent" data-i="${i}" data-f="percent" type="number" min="0" max="100" step="5" inputmode="numeric" value="${esc(it.percent)}"></label>
        <label class="f half">Link bản vẽ (không bắt buộc)<input id="it${i}-link" data-i="${i}" data-f="link" type="url" inputmode="url" placeholder="Dán link OneDrive / Google Drive" value="${esc(it.link)}"></label>
      </div>`).join('')}
    <div><button class="btn" data-act="add">+ Thêm đầu việc</button></div>
  </section>
  <section class="grid2">
    <label class="f">Vướng mắc / cần hỗ trợ<textarea id="r-blockers" data-f="blockers" placeholder="Để trống nếu không có">${esc(S.draft.blockers)}</textarea></label>
    <label class="f">Kế hoạch ngày mai<textarea id="r-tomorrow" data-f="tomorrow">${esc(S.draft.tomorrow)}</textarea></label>
  </section>
  <div class="row"><button class="btn primary" id="r-submit" data-act="submit">${r ? 'Gửi lại báo cáo' : 'Gửi báo cáo'}</button><span class="muted" id="r-msg" role="alert"></span></div>`);
}
function myProjects() {
  const ids = new Set(S.members.filter(m => m.staff_id === S.me.id).map(m => m.project_id));
  return S.projects.filter(p => ids.has(p.id));
}
function tickProject(name, on) {
  const items = S.draft.items;
  if (on) {
    if (items.some(i => i.project === name)) return;
    const blank = items.find(i => !i.project && !i.task_id && !i.work.trim() && !String(i.hours).trim());
    if (blank) blank.project = name; else items.push({ ...blankItem(), project: name });
  } else {
    const keep = items.filter(i => i.project !== name || i.work.trim() || String(i.hours).trim());
    if (keep.some(i => i.project === name)) toast('Dòng việc của dự án này đã có nội dung. Bấm "Bỏ dòng" nếu muốn xoá.');
    S.draft.items = keep.length ? keep : [blankItem()];
  }
  S.dirty = true; viewReport();
}

async function submitReport(btn) {
  const D = S.draft, msg = $('#r-msg');
  const items = D.items.filter(i => i.work.trim()).map(i => ({
    project: i.project || '', task_id: i.task_id || '', phase_id: i.phase_id ? Number(i.phase_id) : null, work: i.work.trim(), link: safeUrl(i.link),
    hours: Math.max(0, Number(i.hours) || 0),
    percent: i.percent === '' || i.percent == null ? null : Math.max(0, Math.min(100, Math.round(Number(i.percent))))
  }));
  if (!items.length) { msg.textContent = 'Ghi ít nhất một đầu việc trước khi gửi.'; return; }
  if (items.some(i => !i.project && !i.task_id)) { msg.textContent = 'Mỗi đầu việc cần chọn dự án.'; return; }
  for (const i of items) if (!i.project && i.task_id) { const t = S.tasks.find(x => x.id === i.task_id); if (t) i.project = t.project || ''; }
  for (const i of items) if (i.phase_id && !phasesOf(i.project).some(f => f.id === i.phase_id)) i.phase_id = null;
  const total = items.reduce((a,i) => a + i.hours, 0);
  if (total > 24) { msg.textContent = 'Tổng số giờ vượt 24. Kiểm tra lại cột số giờ.'; return; }
  btn.disabled = true; msg.textContent = 'Đang gửi…';
  try {
    const row = { staff_id: S.me.id, date: S.date, items, blockers: D.blockers.trim(), tomorrow: D.tomorrow.trim() };
    const res = await q(sb.from('reports').upsert(row, { onConflict: 'staff_id,date' }).select());
    S.myReport = res[0]; S.dirty = false;
    S.tasks = await q(sb.from('tasks').select('*'));
    toast('Đã gửi báo cáo ngày ' + fmt(S.date));
    renderTabs(); viewReport();
  } catch (e) { btn.disabled = false; msg.textContent = errMsg(e); }
}
async function changeDate(d) {
  if (d > todayISO()) d = todayISO();
  S.date = d; S.dirty = false;
  try { const r = await q(sb.from('reports').select('*').eq('staff_id', S.me.id).eq('date', S.date)); S.myReport = r[0] || null; }
  catch (e) { toast(errMsg(e)); }
  viewReport();
}

/* ---------- việc ---------- */
/* ---------- tiến độ so với deadline ---------- */
const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
// start/end: 'YYYY-MM-DD'; progress 0..100 hoặc null; done: đã xong
function sched(start, end, progress, done) {
  if (done) return { code: 'done' };
  if (!end) return { code: 'none' };
  const today = todayISO(), left = dayDiff(today, end);
  if (left < 0) return { code: 'late', left, label: `Trễ ${-left} ngày` };
  let expected = null;
  if (start && start < end) expected = Math.max(0, Math.min(100, Math.round(dayDiff(start, today) / dayDiff(start, end) * 100)));
  if (progress == null && left > 2) return { code: 'none', left, expected };
  if (progress != null && expected != null && progress < expected - 10) return { code: 'behind', left, expected, label: `Chậm tiến độ (cần ~${expected}%)` };
  if (left <= 2 && (progress == null || progress < 100)) return { code: 'soon', left, expected, label: left === 0 ? 'Hạn hôm nay' : `Còn ${left} ngày` };
  return { code: 'ok', left, expected, label: 'Đúng tiến độ' };
}
const SCHED_CHIP = { late: 'bad', behind: 'warn', soon: 'soonc', ok: 'ok' };
const schedChip = r => SCHED_CHIP[r.code] ? `<span class="chip ${SCHED_CHIP[r.code]}">${r.label}</span>` : '';
const taskSched = t => sched((t.created_at || '').slice(0, 10) || null, t.due, Number(t.progress) || 0, t.status === 'done');
function projectStats(p) {
  const ts = S.tasks.filter(t => t.project === p.name);
  const progress = ts.length ? Math.round(ts.reduce((a, t) => a + (t.status === 'done' ? 100 : Number(t.progress) || 0), 0) / ts.length) : null;
  const start = p.start_date || (ts.length ? ts.map(t => (t.created_at || '').slice(0, 10)).sort()[0] : null);
  const r = sched(start, p.deadline, progress, progress === 100 && ts.every(t => t.status === 'done'));
  return { ...r, progress, tasks: ts.length };
}
const deadlineText = d => { if (!d) return ''; const left = dayDiff(todayISO(), d); return `Hạn ${fmt(d)} · ${left < 0 ? 'trễ ' + (-left) + ' ngày' : left === 0 ? 'hôm nay' : 'còn ' + left + ' ngày'}`; };

function taskRow(t, editable, showStaff) {
  const p = Math.max(0, Math.min(100, Number(t.progress) || 0)), st = t.status || 'todo';
  const chip = (st === 'done' ? '<span class="chip ok">Hoàn thành</span>' : st === 'review' ? '<span class="chip info">Chờ duyệt</span>' : st === 'doing' ? '<span class="chip dim">Đang làm</span>' : '<span class="chip dim">Chưa bắt đầu</span>')
    + (st !== 'done' ? schedChip(taskSched(t)) : '');
  const opts = Object.entries(STATUS).filter(([k]) => isAdmin() || k !== 'done' || st === 'done');
  editable = editable && (isAdmin() || t.staff_id === S.me.id);
  return `<div class="task">
   <div class="stack" style="gap:4px;min-width:0"><div class="row"><span class="t">${esc(t.title)}</span>${chip}</div>
     <div class="sub">${showStaff ? `<span>${esc(staffName(t.staff_id))}</span>` : ''}<span>${esc(t.project || 'Việc chung')}${t.phase_id ? ' · ' + esc(phaseName(t.phase_id)) : ''}</span>${safeUrl(t.link) ? `<a href="${esc(safeUrl(t.link))}" target="_blank" rel="noopener">Mở bản vẽ ↗</a>` : ''}${t.returns ? `<span class="chip warn">Trả lại ${t.returns} lần</span>` : ''}${t.due ? `<span class="${isOverdue(t) ? 'overdue' : ''}">${st === 'done' ? 'Hạn ' + fmt(t.due) : deadlineText(t.due)}</span>` : ''}${t.last_report ? `<span>Báo cáo gần nhất ${fmt(t.last_report)}</span>` : ''}</div></div>
   <div class="ctl">
     <div class="bar ${st === 'done' ? 'done' : ''}" title="${p}%"><span style="width:${p}%"></span></div><span class="num" style="font-size:13px;width:38px;text-align:right">${p}%</span>
     ${editable ? `<select id="ts-${t.id}" aria-label="Trạng thái">${opts.map(([k,v]) => `<option value="${k}" ${k===st?'selected':''}>${v}</option>`).join('')}</select>
       <input id="tp-${t.id}" type="number" min="0" max="100" step="5" value="${p}" aria-label="% tiến độ">
       <button class="btn" data-save="${t.id}">Lưu</button>` : ''}
     ${isAdmin() ? `<button class="btn danger ${S.armed === t.id ? 'armed' : ''}" data-rm="${t.id}">${S.armed === t.id ? 'Xác nhận xoá' : 'Xoá'}</button>` : ''}
   </div>
   ${t.note ? `<div class="note muted">${esc(t.note)}</div>` : ''}
   ${(() => { const r = S.reviews.find(x => x.task_id === t.id); return r && r.result === 'return' && t.status !== 'done' ? `<div class="note blocker"><b>Cần sửa (${esc(staffName(r.reviewer_id))}):</b> ${esc(r.note)}</div>` : ''; })()}</div>`;
}
const sortTasks = a => a.slice().sort((x, y) => (x.status === 'done') - (y.status === 'done') || (x.due || '9999').localeCompare(y.due || '9999'));
function viewMine() {
  const mine = sortTasks(S.tasks.filter(t => t.staff_id === S.me.id));
  const open = mine.filter(t => t.status !== 'done'), done = mine.filter(t => t.status === 'done');
  view(`${installBanner()}<section class="stack" style="gap:2px"><h2>Việc được giao cho ${esc(S.me.name)}</h2><p class="muted">Cập nhật trạng thái tại đây, hoặc gắn việc vào báo cáo ngày để tiến độ tự cập nhật. Việc báo 100% sẽ chuyển sang "Chờ duyệt".</p></section>
   <section class="panel">${open.length ? open.map(t => taskRow(t, true)).join('') : '<div class="empty">Hiện chưa có việc nào đang mở. Việc chị Hạnh giao sẽ hiện ở đây.</div>'}</section>
   ${done.length ? `<details><summary>Đã hoàn thành (${done.length})</summary><div class="panel" style="margin-top:10px">${done.map(t => taskRow(t, false)).join('')}</div></details>` : ''}`);
}

/* ---------- QUẢN LÝ: tổng hợp ---------- */
function viewSummary() {
  const d = S.sumDate, staff = S.staff.filter(s => s.role === 'staff' && s.active);
  if (!staff.length) { view('<div class="empty">Chưa có danh sách nhân sự. Vào tab <b>Cài đặt</b> để nhập.</div>'); return; }
  const byStaff = {}; S.reports.filter(r => r.date === d).forEach(r => byStaff[r.staff_id] = r);
  const sent = staff.filter(s => byStaff[s.id]).length;
  const totalH = Object.values(byStaff).reduce((a, r) => a + (Number(r.hours) || 0), 0);
  const blockers = staff.filter(s => byStaff[s.id] && (byStaff[s.id].blockers || '').trim());
  const overdue = S.tasks.filter(isOverdue);
  const behind = S.tasks.filter(t => taskSched(t).code === 'behind');
  const pstats = S.projects.map(p => ({ p, st: projectStats(p) }));
  const order = { late: 0, behind: 1, soon: 2, ok: 3, none: 4, done: 5 };
  pstats.sort((a, b) => order[a.st.code] - order[b.st.code] || (a.p.deadline || '9999').localeCompare(b.p.deadline || '9999'));
  const review = S.tasks.filter(t => t.status === 'review');
  const days = []; let x = d; while (days.length < 6) { if (parse(x).getDay() !== 0) days.unshift(x); x = addDays(x, -1); }
  const has = {}; S.reports.forEach(r => has[r.staff_id + '|' + r.date] = 1);
  const proj = {}; Object.values(byStaff).forEach(r => (r.items || []).forEach(i => { const k = i.project || 'Chưa chọn dự án'; proj[k] = (proj[k] || 0) + (Number(i.hours) || 0); }));
  const pj = Object.entries(proj).sort((a, b) => b[1] - a[1]); const maxP = Math.max(1, ...pj.map(p => p[1]));
  view(`${installBanner()}${pushBanner()}
  <section class="spread"><h2>Giao ban ngày ${fmt(d)}</h2>
    <div class="datebar"><button class="btn" data-sact="prev" aria-label="Ngày trước">‹</button><input type="date" id="s-date" value="${d}" max="${todayISO()}"><button class="btn" data-sact="next" aria-label="Ngày sau" ${d >= todayISO() ? 'disabled' : ''}>›</button><span class="wd">${wd(d)}</span></div></section>
  <section class="kpis">
    <div class="kpi"><span class="v">${sent}<span class="muted" style="font-size:16px">/${staff.length}</span></span><span class="l">Đã nộp báo cáo</span></div>
    <div class="kpi"><span class="v">${hrs(totalH)}</span><span class="l">Tổng giờ làm ghi nhận</span></div>
    <div class="kpi ${blockers.length ? 'alert' : ''}"><span class="v">${blockers.length}</span><span class="l">Người báo vướng mắc</span></div>
    <div class="kpi ${overdue.length ? 'alert' : ''}"><span class="v">${overdue.length}<span class="muted" style="font-size:16px"> · ${behind.length} chậm</span></span><span class="l">Việc trễ hạn · chậm tiến độ</span></div>
  </section>
  <section class="panel stack"><div class="spread"><h3>Tiến độ dự án so với deadline</h3><span class="muted" style="font-size:12px">Vạch đứt: mức cần đạt hôm nay</span></div>
    ${pstats.map(({ p, st }) => `<div class="prow">
      <div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="muted" style="font-size:12px">${p.deadline ? deadlineText(p.deadline) : 'Chưa đặt deadline'}${st.tasks ? ` · ${st.tasks} việc` : ''}</div></div>
      <div class="ptrack" title="${st.progress ?? '—'}% hoàn thành${st.expected != null ? ', cần ~' + st.expected + '%' : ''}"><span class="${st.code}" style="width:${st.progress ?? 0}%"></span>${st.expected != null ? `<i style="left:${st.expected}%"></i>` : ''}</div>
      <div class="pmeta"><span class="num">${st.progress == null ? '—' : st.progress + '%'}</span>${schedChip(st) || (st.code === 'done' ? '<span class="chip ok">Xong</span>' : '')}</div>
    </div>`).join('') || '<p class="muted">Chưa có dự án.</p>'}
    <p class="muted" style="font-size:12px">% dự án = trung bình tiến độ các việc đã giao thuộc dự án. Đặt deadline ở tab Cài đặt.</p>
  </section>
  ${blockers.length ? `<section class="stack"><h3>Cần chị xử lý</h3>${blockers.map(s => `<div class="blocker"><b>${esc(s.name)}:</b> ${esc(byStaff[s.id].blockers)}</div>`).join('')}</section>` : ''}
  ${review.length ? `<section class="stack"><h3>Việc chờ chị duyệt hoàn thành</h3><div class="panel">${sortTasks(review).map(t => taskRow(t, true, true)).join('')}</div></section>` : ''}
  <section class="panel" style="padding-block:4px">
    ${staff.map(s => { const r = byStaff[s.id]; return `<div class="sheet">
      <div class="who"><span class="nm">${esc(s.name)}</span>
        ${r ? `<span class="chip ok">Đã nộp ${hm(r.submitted_at)}</span>` : s.user_id ? '<span class="chip bad">Chưa nộp</span>' : '<span class="chip dim">Chưa có tài khoản</span>'}
        <div class="dots" title="6 ngày làm việc gần nhất">${days.map(dd => `<i class="${has[s.id + '|' + dd] ? 'on' : ''} ${dd === d ? 'cur' : ''}" title="${fmt(dd)}"></i>`).join('')}</div>
      </div>
      <div class="body">${r ? `
        <ul class="items">${(r.items || []).map(i => `<li><div style="min-width:0"><div class="pj">${esc(i.project || 'Chưa chọn dự án')}</div><div>${esc(i.work)}</div></div><div class="meta num">${hrs(i.hours)}h${i.percent != null && i.percent !== '' ? ` · ${i.percent}%` : ''}</div></li>`).join('')}</ul>
        ${(r.blockers || '').trim() ? `<div class="blocker"><b>Vướng mắc:</b> ${esc(r.blockers)}</div>` : ''}
        ${(r.tomorrow || '').trim() ? `<div class="plan"><b>Ngày mai:</b> ${esc(r.tomorrow)}</div>` : ''}
        <div class="plan num">Tổng ${hrs(r.hours)} giờ</div>`
        : `<span class="muted">Chưa có báo cáo cho ngày này.</span>`}</div></div>`; }).join('')}
  </section>
  <section class="panel stack"><h3>Giờ làm theo dự án · ${fmt(d)}</h3>
    ${pj.length ? pj.map(([k, v]) => `<div class="projbar"><span style="min-width:0;overflow-wrap:anywhere">${esc(k)}</span><div class="track"><span style="width:${v / maxP * 100}%"></span></div><span class="num" style="text-align:right">${hrs(v)}h</span></div>`).join('') : '<p class="muted">Chưa có giờ làm nào được ghi nhận.</p>'}
  </section>
  ${overdue.length ? `<section class="stack"><h3>Việc quá hạn</h3><div class="panel">${sortTasks(overdue).map(t => taskRow(t, false, true)).join('')}</div></section>` : ''}
  <section class="panel stack"><h3>Xuất dữ liệu tháng</h3>
    <div class="row"><input type="month" id="x-month" value="${d.slice(0, 7)}" style="width:auto"><button class="btn" data-act="export">Tải file Excel (CSV)</button></div>
    <p class="muted" style="font-size:13px">Mỗi dòng là một đầu việc: ngày, nhân sự, dự án, nội dung, số giờ, % tiến độ, vướng mắc. Dùng để đối chiếu chấm công.</p>
  </section>`);
}
async function setSumDate(d) {
  if (d > todayISO()) d = todayISO();
  S.sumDate = d;
  try { S.reports = await q(sb.from('reports').select('*').gte('date', addDays(d, -9)).lte('date', d)); } catch (e) { toast(errMsg(e)); }
  viewSummary();
}
async function exportMonth(btn) {
  const m = $('#x-month').value; if (!m) return;
  const [y, mo] = m.split('-').map(Number), last = new Date(y, mo, 0).getDate();
  btn.disabled = true;
  try {
    const rows = await q(sb.from('reports').select('*').gte('date', `${m}-01`).lte('date', `${m}-${pad(last)}`).order('date'));
    const cell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [['Ngày', 'Nhân sự', 'Dự án', 'Nội dung', 'Số giờ', '% tiến độ', 'Vướng mắc', 'Kế hoạch ngày mai', 'Giờ gửi']];
    rows.forEach(r => (r.items || []).forEach((i, k) => out.push([fmt(r.date), staffName(r.staff_id), i.project, i.work, String(i.hours ?? '').replace('.', ','), i.percent ?? '', k === 0 ? r.blockers : '', k === 0 ? r.tomorrow : '', k === 0 ? new Date(r.submitted_at).toLocaleString('vi-VN') : ''])));
    const blob = new Blob(['﻿' + out.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `INHAUS-bao-cao-${m}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Đã xuất ${out.length - 1} dòng của tháng ${pad(mo)}/${y}`);
  } catch (e) { toast(errMsg(e)); }
  btn.disabled = false;
}

/* ---------- QUẢN LÝ: giao việc ---------- */
function viewTasks() {
  const N = S.newTask, f = S.tf, staff = S.staff.filter(s => s.role === 'staff' && s.active);
  let list = S.tasks;
  if (f.staff) list = list.filter(t => String(t.staff_id) === f.staff);
  if (f.status === 'open') list = list.filter(t => t.status !== 'done');
  else if (f.status === 'overdue') list = list.filter(isOverdue);
  else if (f.status === 'review') list = list.filter(t => t.status === 'review');
  else if (f.status === 'done') list = list.filter(t => t.status === 'done');
  list = sortTasks(list);
  const so = (sel, ph) => `<option value="">${ph}</option>` + staff.map(s => `<option value="${s.id}" ${String(s.id) === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  view(`<section class="panel stack"><h2>Giao việc mới</h2>
    <label class="f">Tên công việc<input id="n-title" value="${esc(N.title)}" placeholder="VD: Hoàn thiện hồ sơ kỹ thuật tầng 1"></label>
    <div class="grid4">
      <label class="f">Người thực hiện<select id="n-staff">${so(N.staff, '— Chọn người —')}</select></label>
      <label class="f">Dự án<select id="n-project"><option value="">Việc chung</option>${S.projects.map(p => `<option ${p.name === N.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="f">Hạn chót<input id="n-due" type="date" value="${esc(N.due)}"></label>
      <label class="f">&nbsp;<button class="btn primary" id="n-add">Giao việc</button></label>
    </div>
    <div class="grid2">
      <label class="f">Giai đoạn hồ sơ<select id="n-phase" ${phasesOf(N.project).length ? '' : 'disabled'}><option value="">${phasesOf(N.project).length ? '— Chọn giai đoạn —' : N.project ? 'Dự án chưa có giai đoạn (tab Dự án)' : 'Chọn dự án trước'}</option>${phasesOf(N.project).map(f => `<option value="${f.id}" ${String(f.id) === N.phase ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="f">Link bản vẽ (không bắt buộc)<input id="n-link" type="url" inputmode="url" value="${esc(N.link)}" placeholder="Dán link OneDrive / Google Drive"></label>
    </div>
    <label class="f">Ghi chú / yêu cầu<textarea id="n-note" placeholder="Phạm vi, tiêu chuẩn bàn giao, file tham khảo…">${esc(N.note)}</textarea></label>
  </section>
  <section class="spread"><h2>Danh sách việc</h2>
    <div class="row"><select id="f-staff" style="width:auto">${so(f.staff, 'Tất cả nhân sự')}</select>
    <select id="f-status" style="width:auto">${[['open','Đang mở'],['review','Chờ duyệt'],['overdue','Quá hạn'],['done','Hoàn thành'],['all','Tất cả']].map(([k, v]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div></section>
  <section class="panel">${list.length ? list.map(t => taskRow(t, true, true)).join('') : '<div class="empty">Không có việc nào khớp bộ lọc.</div>'}</section>`);
}

/* ---------- QUẢN LÝ: cài đặt ---------- */
function viewSettings() {
  const st = S.settings, days = st ? st.remind_days : [];
  view(`<section class="panel stack"><h2>Mã mời</h2>
    <p class="muted">Gửi mã này kèm đường dẫn app cho nhân viên. Họ cần mã để chọn tên ở lần đầu đăng nhập.</p>
    <div class="row"><b class="num" style="font-size:20px">${esc(st ? st.invite_code : '…')}</b><button class="btn small" data-act="copycode">Sao chép</button><button class="btn small" data-act="newcode">Đổi mã mới</button></div>
  </section>
  <section class="panel stack"><h2>Ngày nhắc báo cáo lúc 17h</h2>
    <div class="row">${[1,2,3,4,5,6,7].map(n => `<label class="row" style="gap:6px"><input type="checkbox" id="rd-${n}" ${days.includes(n) ? 'checked' : ''}> ${['','T2','T3','T4','T5','T6','T7','CN'][n]}</label>`).join('')}</div>
    <div><button class="btn" data-act="savedays">Lưu ngày nhắc</button></div>
  </section>
  <section class="panel stack"><div class="spread"><h2>Nhân sự</h2><button class="btn small" data-act="addstaff">+ Thêm người</button></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Họ tên</th><th>Vai trò</th><th>Trưởng team</th><th>Đang làm</th><th>Tài khoản</th><th></th></tr></thead><tbody>
    ${S.staff.map(s => `<tr>
      <td><input id="sn-${s.id}" value="${esc(s.name)}" aria-label="Họ tên"></td>
      <td><select id="sr-${s.id}" aria-label="Vai trò"><option value="staff" ${s.role === 'staff' ? 'selected' : ''}>Nhân viên</option><option value="admin" ${s.role === 'admin' ? 'selected' : ''}>Quản lý</option></select></td>
      <td><input type="checkbox" id="stl-${s.id}" ${s.is_team_lead ? 'checked' : ''} aria-label="Trưởng team"></td>
      <td><input type="checkbox" id="sa-${s.id}" ${s.active ? 'checked' : ''} aria-label="Đang làm"></td>
      <td>${s.user_id ? `<span class="chip ok">Đã liên kết</span>` : '<span class="chip dim">Chưa</span>'}</td>
      <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-savestaff="${s.id}">Lưu</button>${s.user_id && s.id !== S.me.id ? `<button class="btn small danger ${S.armed === 'u' + s.id ? 'armed' : ''}" data-unlink="${s.id}">${S.armed === 'u' + s.id ? 'Xác nhận gỡ' : 'Gỡ'}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:13px">Trưởng team được duyệt hồ sơ của mọi dự án. Chủ trì dự án đặt ở tab Dự án. "Gỡ" tách tài khoản khỏi tên đó, để người đúng chọn lại. Bỏ tích "Đang làm" khi nhân sự nghỉ việc; dữ liệu cũ vẫn giữ.</p>
  </section>
  <section class="panel stack"><h2>Checklist duyệt hồ sơ nội bộ</h2>
    <label class="f">Mỗi dòng một mục kiểm tra. Người duyệt phải tích đủ các mục mới bấm "Đạt".<textarea id="c-checklist" rows="8">${esc((st && st.review_checklist || []).join('\n'))}</textarea></label>
    <div><button class="btn" data-act="savechecklist">Lưu checklist</button></div>
  </section>
  <section class="panel stack"><h2>Phân công dự án</h2>
    <p class="muted">Bấm vào tên để giao hoặc bỏ người khỏi dự án. Nhân viên sẽ thấy dự án của mình trong ô tích ở Báo cáo ngày.</p>
    ${S.projects.map(p => `<div class="stack" style="gap:6px"><b>${esc(p.name)}</b><div class="ticks">${S.staff.filter(s => s.active && s.role === 'staff').map(s => { const on = S.members.some(m => m.project_id === p.id && m.staff_id === s.id); return `<button class="chipbtn" aria-pressed="${on}" data-assign="${p.id}:${s.id}">${on ? '✓ ' : ''}${esc(s.name)}</button>`; }).join('')}</div></div>`).join('') || '<p class="muted">Chưa có dự án nào.</p>'}
  </section>
  <section class="panel stack"><h2>Dự án đang chạy và deadline</h2>
    <div class="scroll"><table class="tbl"><thead><tr><th>Tên dự án (sửa được)</th><th>Ngày bắt đầu</th><th>Deadline</th><th></th></tr></thead><tbody>
    ${S.projects.map(p => `<tr><td style="min-width:200px"><input id="pn-${p.id}" value="${esc(p.name)}" aria-label="Tên dự án"></td>
      <td><input type="date" id="ps-${p.id}" value="${p.start_date || ''}" aria-label="Ngày bắt đầu"></td>
      <td><input type="date" id="pd-${p.id}" value="${p.deadline || ''}" aria-label="Deadline"></td>
      <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-saveproj="${p.id}">Lưu</button><button class="btn small danger ${S.armed === 'p' + p.id ? 'armed' : ''}" data-hideproj="${p.id}">${S.armed === 'p' + p.id ? 'Xác nhận ẩn' : 'Ẩn'}</button></td></tr>`).join('')}
    <tr><td><input id="np-name" placeholder="Tên dự án mới"></td><td><input type="date" id="np-start" aria-label="Ngày bắt đầu"></td><td><input type="date" id="np-deadline" aria-label="Deadline"></td><td><button class="btn small primary" data-act="addproj">+ Thêm</button></td></tr>
    </tbody></table></div>
    <p class="muted" style="font-size:13px">Ngày bắt đầu dùng để tính mức tiến độ cần đạt. Để trống thì app lấy ngày giao việc đầu tiên của dự án. "Ẩn" dùng cho dự án đã xong; báo cáo cũ vẫn giữ tên dự án.</p>
  </section>`);
}

/* ---------- hướng dẫn cài ---------- */
function viewHowto() {
  view(`<section class="panel stack"><h2>Cài app lên máy</h2>
    <h3>iPhone</h3><ol><li>Mở app bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên).</li><li>Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>.</li><li>Mở app từ biểu tượng mới trên màn hình chính, đăng nhập, rồi bấm ☰ → <b>Bật thông báo nhắc 17h</b>.</li></ol>
    <p class="muted">Trên iPhone chỉ app đã thêm vào màn hình chính mới nhận được thông báo. Cần iOS 16.4 trở lên.</p>
    <h3>Android</h3><ol><li>Mở app bằng <b>Chrome</b>.</li><li>Bấm <b>Cài app</b> trên banner, hoặc dấu ⋮ → <b>Cài đặt ứng dụng</b> / <b>Thêm vào màn hình chính</b>.</li><li>Mở app, bấm ☰ → <b>Bật thông báo nhắc 17h</b> → <b>Cho phép</b>.</li></ol>
    <h3>Máy tính</h3><ol><li>Mở bằng Chrome hoặc Edge.</li><li>Bấm biểu tượng cài đặt ở cuối thanh địa chỉ, hoặc ⋮ → <b>Cài đặt INHAUS Báo cáo ngày</b>.</li></ol>
    <div><button class="btn" data-tab-go="${isAdmin() ? 'summary' : 'report'}">Quay lại</button></div></section>`);
}

/* ---------- thông báo ---------- */
function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); }
const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function checkPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { S.pushState = 'unsupported'; return; }
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); S.pushState = sub ? 'on' : 'off'; if (sub) saveSub(sub); }
  catch { S.pushState = 'unsupported'; }
  renderView();
}
async function saveSub(sub) {
  const j = sub.toJSON();
  try { await q(sb.from('push_subs').upsert({ endpoint: j.endpoint, staff_id: S.me.id, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' })); } catch (e) { /* bỏ qua */ }
}
async function pushOn() {
  if (isIOS && !standalone()) { S.tab = 'howto'; renderView(); toast('Trên iPhone, hãy thêm app vào màn hình chính trước.'); return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('Máy hoặc trình duyệt này chưa hỗ trợ thông báo.'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Bạn chưa cho phép thông báo. Mở cài đặt trình duyệt để bật lại.'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { data, error } = await sb.functions.invoke('remind', { body: { mode: 'vapid' } });
      if (error || !data || !data.publicKey) throw error || new Error('Chưa lấy được khoá thông báo');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(data.publicKey) });
    }
    await saveSub(sub); S.pushState = 'on'; toast('Đã bật thông báo trên thiết bị này'); renderView();
  } catch (e) { toast(errMsg(e)); }
}
async function pushTest() {
  try {
    const { data, error } = await sb.functions.invoke('remind', { body: { mode: 'test' } });
    if (error) throw error;
    toast(data && data.sent ? `Đã gửi thông báo thử tới ${data.sent} thiết bị` : 'Chưa có thiết bị nào bật thông báo. Bấm "Bật thông báo" trước.');
  } catch (e) { toast(errMsg(e)); }
}

/* ---------- sự kiện ---------- */
const V = $('#view');
V.addEventListener('input', e => {
  const el = e.target;
  if (S.tab === 'report' && S.draft) {
    if (el.dataset.i != null) {
      S.draft.items[+el.dataset.i][el.dataset.f] = el.value; S.dirty = true;
      if (el.dataset.f === 'hours') { const t = $('#r-total'); if (t) t.textContent = hrs(S.draft.items.reduce((a, i) => a + (Number(i.hours) || 0), 0)); }
    } else if (el.dataset.f) { S.draft[el.dataset.f] = el.value; S.dirty = true; }
  }
  if (S.tab === 'tasks') { const m = { 'n-title': 'title', 'n-note': 'note', 'n-due': 'due', 'n-link': 'link' }; if (m[el.id]) S.newTask[m[el.id]] = el.value; }
});
V.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.pjtick) return tickProject(el.dataset.pjtick, el.checked);
  if (el.id === 'r-date' && el.value) return changeDate(el.value);
  if (el.id === 's-date' && el.value) return setSumDate(el.value);
  if (S.tab === 'report' && el.dataset.f === 'task_id' && el.value) {
    const t = S.tasks.find(x => x.id === el.value), it = S.draft.items[+el.dataset.i];
    if (t) { if (t.project) it.project = t.project; if (t.phase_id) it.phase_id = t.phase_id; if (!it.link && t.link) it.link = t.link; if (it.percent === '' && t.progress != null) it.percent = t.progress; S.dirty = true; viewReport(); }
  }
  if (el.id === 'n-staff') S.newTask.staff = el.value;
  if (el.id === 'n-project') { S.newTask.project = el.value; S.newTask.phase = ''; viewTasks(); }
  if (el.id === 'n-phase') S.newTask.phase = el.value;
  if (S.tab === 'report' && el.dataset.f === 'project' && el.dataset.i != null) { S.draft.items[+el.dataset.i].phase_id = ''; viewReport(); }
  if (el.id === 'f-staff') { S.tf.staff = el.value; viewTasks(); }
  if (el.id === 'f-status') { S.tf.status = el.value; viewTasks(); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) { const m = $('#menu'); if (m && !e.target.closest('.menu')) m.hidden = true; return; }
  const a = b.dataset.act;
  if (b.dataset.mode) { S.authMode = b.dataset.mode; renderAuth(); return; }
  if (a === 'menu') { $('#menu').hidden = !$('#menu').hidden; return; }
  if (b.closest('#menu')) $('#menu').hidden = true;
  if (a === 'logout') { await sb.auth.signOut(); S.me = null; S.tab = null; S.authMode = 'login'; renderAuth(); return; }
  if (a === 'refresh') { await refresh(); toast('Đã tải lại'); return; }
  if (a === 'howto') { S.tab = 'howto'; renderView(); return; }
  if (b.dataset.tabGo) { S.tab = b.dataset.tabGo; renderTabs(); renderView(); return; }
  if (a === 'push-on') return pushOn();
  if (a === 'push-test') return pushTest();
  if (a === 'install' && S.installEvt) { S.installEvt.prompt(); const r = await S.installEvt.userChoice; S.installEvt = null; if (r.outcome === 'accepted') toast('Đã cài app'); renderView(); return; }
  if (a === 'loadnames') return loadNames();
  if (a === 'claim') {
    const name = $('#l-name').value, msg = $('#l-msg'); if (!name) { msg.textContent = 'Chọn tên của bạn.'; return; }
    b.disabled = true;
    try { await q(sb.rpc('claim_staff', { p_name: name, p_code: b.dataset.code })); toast('Đã liên kết với tên ' + name); await enter(); }
    catch (err) { msg.textContent = errMsg(err); b.disabled = false; }
    return;
  }
  const db = sb;
  if (a === 'prev') return changeDate(addDays(S.date, -1));
  if (a === 'next') return changeDate(addDays(S.date, 1));
  if (a === 'add') { S.draft.items.push(blankItem()); S.dirty = true; viewReport(); return; }
  if (b.dataset.del != null) { S.draft.items.splice(+b.dataset.del, 1); S.dirty = true; viewReport(); return; }
  if (a === 'submit') return submitReport(b);
  if (b.dataset.sact === 'prev') return setSumDate(addDays(S.sumDate, -1));
  if (b.dataset.sact === 'next') return setSumDate(addDays(S.sumDate, 1));
  if (a === 'export') return exportMonth(b);
  if (b.dataset.save) {
    const id = b.dataset.save, st = $('#ts-' + id).value; let p = Math.max(0, Math.min(100, Number($('#tp-' + id).value) || 0));
    if (st === 'done') p = 100;
    b.disabled = true;
    try { const res = await q(db.from('tasks').update({ status: st, progress: p }).eq('id', id).select()); const i = S.tasks.findIndex(t => t.id === id); if (res[0] && i >= 0) S.tasks[i] = res[0]; toast('Đã cập nhật tiến độ'); }
    catch (err) { toast(errMsg(err)); }
    renderTabs(); renderView(); return;
  }
  if (b.dataset.rm) {
    if (S.armed !== b.dataset.rm) { S.armed = b.dataset.rm; renderView(); return; }
    S.armed = null;
    try { await q(db.from('tasks').delete().eq('id', b.dataset.rm)); S.tasks = S.tasks.filter(t => t.id !== b.dataset.rm); toast('Đã xoá việc'); } catch (err) { toast(errMsg(err)); }
    renderView(); return;
  }
  if (b.id === 'n-add') {
    const N = S.newTask;
    if (!N.title.trim()) { toast('Nhập tên công việc trước khi giao'); $('#n-title').focus(); return; }
    if (!N.staff) { toast('Chọn người thực hiện'); return; }
    b.disabled = true;
    try {
      const res = await q(db.from('tasks').insert({ title: N.title.trim(), staff_id: Number(N.staff), project: N.project, phase_id: N.phase ? Number(N.phase) : null, link: safeUrl(N.link), due: N.due || null, note: N.note.trim() }).select());
      S.tasks.push(res[0]); toast('Đã giao việc cho ' + staffName(Number(N.staff)));
      S.newTask = { title: '', staff: N.staff, project: N.project, phase: N.phase, due: '', note: '', link: '' }; viewTasks();
    } catch (err) { b.disabled = false; toast(errMsg(err)); }
    return;
  }
  if (a === 'copycode') { try { await navigator.clipboard.writeText(S.settings.invite_code); toast('Đã sao chép mã mời'); } catch { toast('Không sao chép được. Hãy chép tay mã mời.'); } return; }
  if (a === 'newcode') {
    const code = 'INHAUS-' + Array.from(crypto.getRandomValues(new Uint8Array(3)), x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    try { await q(db.from('settings').update({ invite_code: code, updated_at: new Date().toISOString() }).eq('id', 1)); S.settings.invite_code = code; toast('Đã đổi mã mời. Mã cũ hết hiệu lực.'); viewSettings(); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (a === 'savedays') {
    const days = [1,2,3,4,5,6,7].filter(n => $('#rd-' + n).checked);
    try { await q(db.from('settings').update({ remind_days: days, updated_at: new Date().toISOString() }).eq('id', 1)); S.settings.remind_days = days; toast('Đã lưu ngày nhắc'); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (a === 'addstaff') {
    try { const maxSort = Math.max(0, ...S.staff.map(s => s.sort)); const res = await q(db.from('staff').insert({ name: 'Nhân sự mới ' + (S.staff.length + 1), sort: maxSort + 1 }).select()); S.staff.push(res[0]); viewSettings(); toast('Đã thêm dòng mới. Sửa họ tên rồi bấm Lưu.'); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (b.dataset.assign) {
    const [pid, sid] = b.dataset.assign.split(':').map(Number), on = b.getAttribute('aria-pressed') === 'true';
    b.disabled = true;
    try {
      if (on) { await q(db.from('project_members').delete().eq('project_id', pid).eq('staff_id', sid)); S.members = S.members.filter(m => !(m.project_id === pid && m.staff_id === sid)); }
      else { await q(db.from('project_members').insert({ project_id: pid, staff_id: sid })); S.members.push({ project_id: pid, staff_id: sid }); }
    } catch (err) { toast(errMsg(err)); }
    viewSettings(); return;
  }
  if (b.dataset.savestaff) {
    const id = Number(b.dataset.savestaff), name = $('#sn-' + id).value.trim();
    if (!name) { toast('Họ tên không được để trống'); return; }
    if (id === S.me.id && $('#sr-' + id).value !== 'admin') { toast('Không tự bỏ quyền quản lý của chính mình'); return; }
    try { const res = await q(db.from('staff').update({ name, role: $('#sr-' + id).value, active: $('#sa-' + id).checked, is_team_lead: $('#stl-' + id).checked }).eq('id', id).select()); const i = S.staff.findIndex(s => s.id === id); S.staff[i] = res[0]; toast('Đã lưu ' + name); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (b.dataset.unlink) {
    const id = Number(b.dataset.unlink);
    if (S.armed !== 'u' + id) { S.armed = 'u' + id; viewSettings(); return; }
    S.armed = null;
    try { await q(db.from('staff').update({ user_id: null, linked_at: null }).eq('id', id)); S.staff.find(s => s.id === id).user_id = null; toast('Đã gỡ liên kết'); } catch (err) { toast(errMsg(err)); }
    viewSettings(); return;
  }
  if (b.dataset.saveproj) {
    const id = Number(b.dataset.saveproj), start = $('#ps-' + id).value || null, deadline = $('#pd-' + id).value || null;
    const name = ($('#pn-' + id).value || '').trim(), cur = S.projects.find(p => p.id === id);
    if (!name) { toast('Tên dự án không được để trống'); return; }
    if (start && deadline && start > deadline) { toast('Ngày bắt đầu đang sau deadline. Kiểm tra lại.'); return; }
    b.disabled = true;
    try {
      const oldName = cur.name, renamed = name !== oldName;
      if (renamed) {
        await q(db.rpc('rename_project', { p_id: id, p_name: name }));
        S.tasks.forEach(t => { if (t.project === oldName) t.project = name; });
        (S.reports || []).forEach(r => (r.items || []).forEach(i => { if (i.project === oldName) i.project = name; }));
        S.hours.forEach(h => { if (h.project === oldName) h.project = name; });
        S.weekReports = null;
      }
      const res = await q(db.from('projects').update({ start_date: start, deadline }).eq('id', id).select());
      const i = S.projects.findIndex(p => p.id === id); S.projects[i] = res[0];
      toast(renamed ? `Đã đổi tên thành "${name}" (việc và báo cáo cũ cũng đổi theo)` : 'Đã lưu deadline ' + res[0].name);
      if (renamed) viewSettings();
    }
    catch (err) { toast(errMsg(err)); }
    b.disabled = false; return;
  }
  if (b.dataset.hideproj) {
    const id = Number(b.dataset.hideproj);
    if (S.armed !== 'p' + id) { S.armed = 'p' + id; viewSettings(); return; }
    S.armed = null;
    try { await q(db.from('projects').update({ active: false }).eq('id', id)); S.projects = S.projects.filter(p => p.id !== id); toast('Đã ẩn dự án'); } catch (err) { toast(errMsg(err)); }
    viewSettings(); return;
  }
  if (a === 'addproj') {
    const name = $('#np-name').value.trim(), start = $('#np-start').value || null, deadline = $('#np-deadline').value || null;
    if (!name) { toast('Nhập tên dự án mới'); $('#np-name').focus(); return; }
    if (start && deadline && start > deadline) { toast('Ngày bắt đầu đang sau deadline. Kiểm tra lại.'); return; }
    b.disabled = true;
    try {
      const ex = (await q(db.from('projects').select('*').eq('name', name)))[0];
      const sort = Math.max(0, ...S.projects.map(p => p.sort || 0)) + 1;
      const res = ex ? await q(db.from('projects').update({ active: true, start_date: start || ex.start_date, deadline: deadline || ex.deadline }).eq('id', ex.id).select())
                     : await q(db.from('projects').insert({ name, start_date: start, deadline, sort }).select());
      S.projects = S.projects.filter(p => p.id !== res[0].id).concat(res[0]);
      toast(ex ? 'Đã hiện lại dự án ' + name : 'Đã thêm dự án ' + name); viewSettings();
    } catch (err) { b.disabled = false; toast(errMsg(err)); }
    return;
  }
});
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
