import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://tdyplxixwuwxcsacreiv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeZpLP-uFkWVUCRgnCOFnw_jOcf4JQS";
const QR_LIB = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
const PAGE_SIZE = 25;
const CAM_READY = '<i class="app-dot"></i> Kamera aktif. Menunggu QR code...';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
});

const page = document.getElementById("page");
const $ = id => document.getElementById(id);

let session = null, profile = null, recovering = false, flash = null, navId = 0;
let scanner = null, cameraRunning = false, torchOn = false, scanBusy = false, scanMsgTimer = null;
let currentTicket = null, scanPicker = null, openPicker = null, editing = null;
let students = [], studentsReq = null;
const badCodes = new Map();
const rec = { search: "", range: "all", page: 0, total: 0, rows: [], req: 0 };
let qrLibReq = null, toastTimer = null;

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isAdmin = () => profile?.role === "admin";
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const num = v => Number(v || 0).toLocaleString("id-ID");

class UserError extends Error {}

function errText(error, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
    if (error instanceof UserError) return error.message;
    if (error?.code === "P0001" && error.message) return error.message;
    if (/failed to fetch|networkerror|load failed/i.test(error?.message || "")) return "Tidak ada koneksi internet. Periksa jaringan Anda.";
    return fallback;
}

function showMessage(id, text, type = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = `app-message ${type}`.trim();
    el.hidden = !text;
}

function toast(text, type = "") {
    const el = $("toast");
    el.textContent = text;
    el.className = `toast ${type}`.trim();
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function formatDateTime(v) {
    return v ? new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "—";
}

function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.textContent = label; }
    else button.textContent = button.dataset.label || button.textContent;
    button.disabled = busy;
}

function msgBox(id, m) {
    return `<div id="${id}" class="app-message ${m?.type || ""}" role="alert" ${m ? "" : "hidden"}>${esc(m?.text)}</div>`;
}

function renderLogin(m) {
    return `
    <main class="app-page app-page-center"><div class="app-card"><div class="app-card-body">
        <h1 class="app-title">Masuk</h1><div class="app-double-line"></div>
        <p class="app-description">Silakan masuk untuk mengakses sistem piket keterlambatan OSIS SMA Maitreyawira Palembang.</p>
        ${msgBox("login-message", m)}
        <form id="login-form">
            <div class="app-form-group"><label for="login-email">Email <span class="app-required">*</span></label>
                <input type="email" id="login-email" name="email" placeholder="Masukkan email" required autocomplete="username"></div>
            <div class="app-form-group"><label for="login-password">Password <span class="app-required">*</span></label>
                <input type="password" id="login-password" name="password" placeholder="Masukkan password" required autocomplete="current-password"></div>
            <div class="app-form-options"><span class="app-muted">Gunakan akun yang dibuat oleh admin.</span><a href="#forgot">Lupa password?</a></div>
            <button type="submit" class="app-button app-button-primary app-button-full">Masuk</button>
        </form>
    </div></div></main>`;
}

function renderForgot(m) {
    return `
    <main class="app-page app-page-center"><div class="app-card"><div class="app-card-body">
        <h1 class="app-title">Lupa Password</h1><div class="app-double-line"></div>
        <p class="app-description">Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat password baru.</p>
        ${msgBox("forgot-message", m)}
        <form id="forgot-form">
            <div class="app-form-group"><label for="forgot-email">Email <span class="app-required">*</span></label>
                <input type="email" id="forgot-email" name="email" placeholder="Masukkan email" required autocomplete="username"></div>
            <button type="submit" class="app-button app-button-primary app-button-full">Kirim Tautan</button>
            <p class="app-form-options" style="margin:16px 0 0"><a href="#login">&larr; Kembali ke halaman masuk</a></p>
        </form>
    </div></div></main>`;
}

function renderReset() {
    return `
    <main class="app-page app-page-center"><div class="app-card"><div class="app-card-body">
        <h1 class="app-title">Password Baru</h1><div class="app-double-line"></div>
        <p class="app-description">Buat password baru untuk akun Anda. Minimal 8 karakter.</p>
        ${msgBox("reset-message")}
        <form id="reset-form">
            <div class="app-form-group"><label for="new-password">Password baru <span class="app-required">*</span></label>
                <input type="password" id="new-password" name="password" minlength="8" required autocomplete="new-password"></div>
            <div class="app-form-group"><label for="confirm-password">Ulangi password <span class="app-required">*</span></label>
                <input type="password" id="confirm-password" name="confirm" minlength="8" required autocomplete="new-password"></div>
            <button type="submit" class="app-button app-button-primary app-button-full">Simpan Password</button>
        </form>
    </div></div></main>`;
}

function renderScan() {
    return `
    <section class="app-hero"><div class="app-container">
        <h1 class="app-title">Scan Tiket</h1><div class="app-double-line"></div>
        <p class="app-hero-description">Scan QR code pada tiket keterlambatan untuk mencatat data siswa.</p>
    </div></section>
    <main class="app-container app-narrow app-scan-main">
        <section class="app-panel" id="scan-panel">
            <h2 class="app-panel-title">Langkah 1 — Scan QR Code</h2><div class="app-double-line"></div>
            <div class="app-viewfinder">
                <div id="reader"></div>
                <div class="app-frame">
                    <span class="app-corner tl"></span><span class="app-corner tr"></span><span class="app-corner bl"></span><span class="app-corner br"></span>
                    <span class="app-scan-line"></span>
                </div>
                <p class="app-cam-status" id="camera-status"><i class="app-dot"></i> Menyiapkan kamera...</p>
            </div>
            <p class="app-scan-hint">Arahkan kamera ke QR code pada tiket. Pastikan QR code berada di dalam kotak dan pencahayaan cukup.</p>
            <div class="app-button-row">
                <button type="button" class="app-button app-button-outline" id="btn-switch">Ganti Kamera</button>
                <button type="button" class="app-button app-button-outline" id="btn-torch" hidden>Senter</button>
            </div>
            <div id="scan-message" class="app-message" role="status" hidden style="margin-top:16px"></div>
        </section>
        <section class="app-panel" id="record-panel" hidden>
            <h2 class="app-panel-title">Langkah 2 — Data Keterlambatan</h2><div class="app-double-line"></div>
            <div class="app-ticket-badge"><span class="app-ticket-check">&#10003;</span>
                <div><small>Tiket terdeteksi dan valid</small><b id="ticket-label">TIKET-000</b></div></div>
            <form id="record-form">
                <div class="app-form-group"><label for="student-class">Filter kelas</label>
                    <select id="student-class"><option value="">Semua kelas</option></select></div>
                <div class="app-form-group"><label>Nama Siswa <span class="app-required">*</span></label>
                    <div id="student-picker"></div></div>
                <div class="app-form-group"><label for="late-reason">Alasan Terlambat <span class="app-required">*</span></label>
                    <textarea id="late-reason" name="reason" rows="4" minlength="3" maxlength="1000" placeholder="Contoh: Macet di jalan, kendaraan mogok..." required></textarea></div>
                <div id="record-message" class="app-message" role="status" hidden></div>
                <div class="app-button-row">
                    <button type="button" class="app-button app-button-outline" id="rescan-button">Scan Ulang</button>
                    <button type="submit" class="app-button app-button-primary" id="save-record-button">Simpan Data</button>
                </div>
            </form>
        </section>
        <section class="app-panel" id="scan-success" hidden>
            <div class="app-success"><span class="app-success-icon">&#10003;</span>
                <h2>Data Berhasil Disimpan</h2><p id="success-detail"></p></div>
            <div class="app-button-row" style="margin-top:18px">
                <button type="button" class="app-button app-button-outline" id="next-scan-button">Scan Tiket Berikutnya</button>
                <a href="#overview" class="app-button app-button-primary">Lihat Dashboard</a>
            </div>
        </section>
    </main>`;
}

function renderOverview() {
    const admin = isAdmin();
    return `
    <section class="app-hero"><div class="app-container">
        <h1 class="app-title">${admin ? "Dashboard Admin Piket" : "Dashboard Piket"}</h1><div class="app-double-line"></div>
        <p class="app-hero-description">${admin ? "Ringkasan dan statistik data keterlambatan siswa." : "Statistik keterlambatan dan data yang Anda catat."}</p>
    </div></section>
    <main class="app-container app-page" style="min-height:0;padding-top:0">
        <section class="app-cta">
            <div><h2>Catat keterlambatan</h2><p>Scan QR code pada tiket untuk mencatat siswa yang terlambat.</p></div>
            <a href="#scan" class="app-button app-button-primary">Scan Tiket</a>
        </section>
        <div id="overview-message" class="app-message" role="status" hidden></div>
        <section class="app-stats-grid">
            <article class="app-stat-card"><span class="app-stat-label">Hari Ini</span><strong class="app-stat-value" id="stat-today">—</strong></article>
            <article class="app-stat-card"><span class="app-stat-label">Minggu Ini</span><strong class="app-stat-value" id="stat-week">—</strong></article>
            <article class="app-stat-card"><span class="app-stat-label">Bulan Ini</span><strong class="app-stat-value" id="stat-month">—</strong></article>
            <article class="app-stat-card"><span class="app-stat-label">Total Data</span><strong class="app-stat-value" id="stat-total">—</strong></article>
        </section>
        ${admin ? `
        <div class="app-dashboard-grid">
            <section class="app-panel"><h2 class="app-panel-title">7 Hari Terakhir</h2><div class="app-double-line"></div>
                <div class="app-chart" id="weekly-chart"><p class="app-empty">Memuat...</p></div></section>
            <section class="app-panel"><h2 class="app-panel-title">Kelas Terbanyak (30 Hari)</h2><div class="app-double-line"></div>
                <div id="class-chart"><p class="app-empty">Memuat...</p></div></section>
            <section class="app-panel">
                <div class="app-section-heading"><h2>Paling Sering Terlambat</h2>
                    <select id="lb-period" class="mini-select" aria-label="Periode"><option value="month">Bulan ini</option><option value="all">Semua waktu</option></select></div>
                <div id="leaderboard"><p class="app-empty">Memuat...</p></div>
            </section>
        </div>` : ""}
        <section class="app-panel">
            <div class="app-section-heading">
                <h2>${admin ? "Data Keterlambatan" : "Data yang Saya Catat"}</h2>
                <button type="button" class="app-button app-button-outline" id="refresh-overview">Perbarui</button>
            </div>
            <div class="toolbar">
                <input type="search" id="rec-search" placeholder="Cari nama, kelas, atau alasan..." aria-label="Cari data" autocomplete="off">
                <select id="rec-range" aria-label="Periode">
                    <option value="all">Semua waktu</option><option value="today">Hari ini</option>
                    <option value="week">Minggu ini</option><option value="month">Bulan ini</option>
                </select>
            </div>
            <div class="app-table-wrap"><table class="app-table">
                <thead><tr><th>Waktu</th><th>Tiket</th><th>Nama Siswa</th><th>Kelas</th><th>Alasan</th>${admin ? "<th>Petugas</th>" : ""}<th></th></tr></thead>
                <tbody id="recent-records"><tr><td colspan="${admin ? 7 : 6}" class="app-empty">Memuat data...</td></tr></tbody>
            </table></div>
            <div class="pager">
                <span class="app-muted" id="pager-info"></span>
                <div class="pager-btns">
                    <button type="button" class="app-button app-button-outline app-button-small" id="pg-prev" disabled>Sebelumnya</button>
                    <span class="app-muted" id="pager-page"></span>
                    <button type="button" class="app-button app-button-outline app-button-small" id="pg-next" disabled>Berikutnya</button>
                </div>
            </div>
        </section>
    </main>`;
}

function renderSettings() {
    const u = session.user;
    return `
    <section class="app-hero"><div class="app-container">
        <h1 class="app-title">Pengaturan</h1><div class="app-double-line"></div>
        <p class="app-hero-description">Informasi akun dan keamanan.</p>
    </div></section>
    <main class="app-container app-narrow app-scan-main">
        <section class="app-panel">
            <h2 class="app-panel-title">Akun</h2><div class="app-double-line"></div>
            <div class="app-table-wrap"><table class="app-table"><tbody>
                <tr><th>Nama</th><td>${esc(profile?.name || "—")}</td></tr>
                <tr><th>Email</th><td>${esc(u.email || "—")}</td></tr>
                <tr><th>Peran</th><td>${isAdmin() ? "Admin" : "Petugas"}</td></tr>
            </tbody></table></div>
        </section>
        <section class="app-panel">
            <h2 class="app-panel-title">Ganti Password</h2><div class="app-double-line"></div>
            ${msgBox("password-message")}
            <form id="password-form">
                <div class="app-form-group"><label for="pw-new">Password baru <span class="app-required">*</span></label>
                    <input type="password" id="pw-new" name="password" minlength="8" required autocomplete="new-password"></div>
                <div class="app-form-group"><label for="pw-confirm">Ulangi password <span class="app-required">*</span></label>
                    <input type="password" id="pw-confirm" name="confirm" minlength="8" required autocomplete="new-password"></div>
                <button type="submit" class="app-button app-button-primary app-button-full">Simpan Password</button>
            </form>
        </section>
    </main>`;
}

function closeAccountMenu() {
    $("account-menu").hidden = true;
    $("account-toggle").setAttribute("aria-expanded", "false");
}

function setHeader() {
    document.querySelectorAll(".auth-link").forEach(el => { el.hidden = !session; });
    document.querySelectorAll(".guest-link").forEach(el => { el.hidden = !!session; });
    $("header-account").hidden = !session;
    const user = session?.user;
    const name = profile?.name || user?.email || "Petugas";
    const url = profile?.picture || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
    $("account-name").textContent = name;
    $("account-email").textContent = user?.email || "";
    const av = $("account-avatar");
    av.innerHTML = url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : esc(initials(name));
    av.querySelector("img")?.addEventListener("error", () => { av.textContent = initials(name); }, { once: true });
    closeAccountMenu();
    $("menu-toggle").checked = false;
}

const PUBLIC_ROUTES = ["login", "forgot"];
const ROUTES = ["login", "forgot", "reset", "scan", "overview", "settings"];
const setHash = r => { if (location.hash !== `#${r}`) history.replaceState(null, "", `#${r}`); };

async function getProfile() {
    if (profile && profile.id === session.user.id) return profile; // cached: no DB hit on every page change
    const { data, error } = await supabase.from("accounts").select("id,name,role,active").eq("id", session.user.id).single();
    if (error || !data) throw new UserError("Akun tidak memiliki akses ke sistem.");
    if (!data.active) throw new UserError("Akun ini dinonaktifkan. Hubungi administrator.");
    return data;
}

async function navigate() {
    const run = ++navId;
    let route = location.hash.slice(1);
    if (!ROUTES.includes(route)) route = session ? "overview" : "login";

    if (!session) {
        profile = null;
        if (!PUBLIC_ROUTES.includes(route)) route = "login";
    } else {
        try {
            profile = await getProfile();
        } catch (error) {
            profile = null;
            flash = { text: errText(error, "Akun tidak memiliki akses ke sistem."), type: "error" };
            await supabase.auth.signOut();
            return;
        }
        if (run !== navId) return;
        if (recovering) route = "reset";
        else if (PUBLIC_ROUTES.includes(route)) route = "overview";
    }
    setHash(route);

    if (route !== "scan") await stopScanner();
    if (run !== navId) return;
    setHeader();

    const m = flash; flash = null;
    if (route === "login") page.innerHTML = renderLogin(m);
    else if (route === "forgot") page.innerHTML = renderForgot(m);
    else if (route === "reset") page.innerHTML = renderReset();
    else if (route === "overview") {
        Object.assign(rec, { search: "", range: "all", page: 0, total: 0, rows: [] });
        page.innerHTML = renderOverview();
        loadOverview();
    }
    else if (route === "settings") page.innerHTML = renderSettings();
    else {
        currentTicket = null;
        scanPicker = null;
        page.innerHTML = renderScan();
        startScanner();
        loadStudents().catch(() => {});
    }
}

function loadStudents() {
    if (students.length) return Promise.resolve(students);
    return studentsReq ||= (async () => {
        try {
            const { data, error } = await supabase.from("students").select("id,name,class,is_osis").order("name", { ascending: true });
            if (error) throw error;
            students = (data || []).map(s => ({ ...s, _q: `${s.name} ${s.class}`.toLocaleLowerCase("id") }));
            return students;
        } finally { studentsReq = null; }
    })();
}

const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

function createPicker(root, { placeholder = "Pilih siswa", getClass = () => "" } = {}) {
    root.innerHTML = `
    <div class="picker">
        <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false">
            <span class="picker-label placeholder">${esc(placeholder)}</span><i class="picker-caret"></i>
        </button>
        <div class="picker-pop" hidden>
            <input type="search" class="picker-search" placeholder="Cari nama siswa..." autocomplete="off" aria-label="Cari nama siswa">
            <ul class="picker-list" role="listbox"></ul>
        </div>
    </div>`;
    const btn = root.querySelector(".picker-btn"), label = root.querySelector(".picker-label");
    const pop = root.querySelector(".picker-pop"), search = root.querySelector(".picker-search"), list = root.querySelector(".picker-list");
    let value = null, active = 0, items = [];
    const byId = id => students.find(s => s.id === id);

    function render() {
        const cls = getClass(), q = search.value.trim().toLocaleLowerCase("id");
        items = students.filter(s => (!cls || s.class === cls) && (!q || s._q.includes(q)));
        const shown = items.slice(0, 80);
        active = Math.min(active, Math.max(shown.length - 1, 0));
        list.innerHTML = shown.length
            ? shown.map((s, i) => `<li role="option" data-id="${esc(s.id)}" aria-selected="${s.id === value}" class="${i === active ? "active" : ""}${s.id === value ? " selected" : ""}">
                <span class="picker-avatar${s.is_osis ? " osis" : ""}">${esc(initials(s.name))}</span><span class="picker-name">${esc(s.name)}</span>${s.is_osis ? '<span class="osis-pill">OSIS</span>' : ""}<span class="picker-class">${esc(s.class)}</span></li>`).join("")
              + (items.length > 80 ? `<li class="picker-more">Menampilkan 80 dari ${items.length}. Ketik untuk mempersempit.</li>` : "")
            : `<li class="picker-empty">Siswa tidak ditemukan</li>`;
    }
    function setActive(i) {
        const lis = list.querySelectorAll("li[data-id]");
        if (!lis.length) return;
        active = (i + lis.length) % lis.length;
        lis.forEach((li, k) => li.classList.toggle("active", k === active));
        lis[active].scrollIntoView({ block: "nearest" });
    }
    function pick(s) {
        if (!s) return;
        value = s.id;
        label.textContent = `${s.name} (${s.class})`;
        label.classList.remove("placeholder");
        api.close();
    }
    const api = {
        root,
        get value() { return value; },
        set(id) { const s = byId(id); if (s) pick(s); },
        clear() { value = null; label.textContent = placeholder; label.classList.add("placeholder"); },
        refresh() { if (value && getClass() && byId(value)?.class !== getClass()) api.clear(); if (!pop.hidden) render(); },
        open() {
            if (openPicker && openPicker !== api) openPicker.close();
            openPicker = api; pop.hidden = false; btn.setAttribute("aria-expanded", "true");
            search.value = ""; active = 0; render(); search.focus({ preventScroll: true });
        },
        close() { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); if (openPicker === api) openPicker = null; }
    };
    btn.addEventListener("click", () => (pop.hidden ? api.open() : api.close()));
    search.addEventListener("input", () => { active = 0; render(); });
    search.addEventListener("keydown", e => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
        else if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
        else if (e.key === "Escape") { e.stopPropagation(); api.close(); btn.focus(); }
    });
    list.addEventListener("click", e => { const li = e.target.closest("li[data-id]"); if (li) pick(byId(li.dataset.id)); });
    return api;
}

function loadQrLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    return qrLibReq ||= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = QR_LIB;
        s.onload = resolve;
        s.onerror = () => { qrLibReq = null; reject(new UserError("Pemindai QR gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.")); };
        document.head.append(s);
    });
}

const videoTrack = () => document.querySelector("#reader video")?.srcObject?.getVideoTracks?.()[0];
const setStatus = html => { const el = $("camera-status"); if (el) el.innerHTML = html; };

async function startScanner(deviceId) {
    if (!$("reader")) return;
    try {
        await loadQrLib();
        if (!$("reader")) return;
        scanner = new Html5Qrcode("reader", { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: true });
        const source = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" };
        await scanner.start(source, { fps: 10, aspectRatio: 1 }, onDecode, () => {});
        cameraRunning = true;
        setStatus(CAM_READY);
        setTimeout(setupControls, 600);
    } catch (error) {
        console.error(error);
        scanner = null; cameraRunning = false;
        setStatus("Kamera tidak aktif.");
        showMessage("scan-message", error instanceof UserError ? error.message : "Kamera tidak dapat diakses. Izinkan akses kamera pada browser, lalu muat ulang halaman.", "error");
    }
}

async function setupControls() {
    const btn = $("btn-torch");
    if (!btn) return;
    btn.hidden = !videoTrack()?.getCapabilities?.().torch;
    try { cameras = await Html5Qrcode.getCameras(); } catch { cameras = []; }
}
let cameras = [];

async function stopScanner() {
    scanBusy = false; torchOn = false;
    const s = scanner;
    scanner = null; cameraRunning = false;
    if (!s) return;
    try { await s.stop(); } catch (e) { /* already stopped */ }
    try { s.clear(); } catch (e) { /* ignore */ }
}

function scanError(key, text) {
    badCodes.set(key, Date.now() + 8000);
    showMessage("scan-message", text, "error");
    clearTimeout(scanMsgTimer);
    scanMsgTimer = setTimeout(() => showMessage("scan-message", ""), 5000);
}

async function onDecode(raw) {
    if (scanBusy || !scanner) return;
    const key = String(raw || "").trim().toUpperCase();
    if ((badCodes.get(key) || 0) > Date.now()) return;
    const ticketCode = key.replace(/\D/g, "").slice(-3);
    if (!/^\d{3}$/.test(ticketCode)) return scanError(key, "QR code ini bukan tiket keterlambatan.");

    scanBusy = true;
    setStatus("Memeriksa tiket...");
    try {
        const { data, error } = await supabase.rpc("check_ticket_availability", { p_ticket_code: ticketCode });
        if (error) throw error;
        if (!data?.valid) throw new UserError(data?.message || "Tiket ini tidak tersedia.");
        await loadStudents();
        if (!students.length) throw new UserError("Data siswa belum tersedia. Hubungi administrator.");
        currentTicket = data;
        await stopScanner();
        showRecordPanel();
    } catch (error) {
        console.error(error);
        scanError(key, errText(error, "Tiket tidak dapat diperiksa. Silakan coba lagi."));
        setStatus(CAM_READY);
        scanBusy = false;
    }
}

function showRecordPanel() {
    $("ticket-label").textContent = currentTicket.code;
    $("scan-panel").hidden = true;
    $("record-panel").hidden = false;
    const classes = [...new Set(students.map(s => s.class).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id", { numeric: true }));
    $("student-class").innerHTML = `<option value="">Semua kelas</option>${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}`;
    scanPicker = createPicker($("student-picker"), { getClass: () => $("student-class").value });
}

async function switchCamera() {
    if (cameras.length < 2) return toast("Perangkat ini hanya memiliki satu kamera.");
    const current = videoTrack()?.getSettings?.().deviceId;
    const next = cameras[(Math.max(cameras.findIndex(c => c.id === current), 0) + 1) % cameras.length].id;
    await stopScanner();
    setStatus('<i class="app-dot"></i> Mengganti kamera...');
    $("btn-torch") && ($("btn-torch").hidden = true);
    await startScanner(next);
}

async function toggleTorch() {
    const track = videoTrack(), btn = $("btn-torch");
    if (!track || !btn) return;
    try {
        await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
        torchOn = !torchOn;
        btn.classList.toggle("active", torchOn);
        btn.textContent = torchOn ? "Matikan Senter" : "Senter";
    } catch {
        btn.hidden = true;
        toast("Senter tidak didukung di perangkat ini.", "error");
    }
}

async function saveRecord(form) {
    const reason = String(new FormData(form).get("reason") || "").trim();
    const button = $("save-record-button");
    try {
        if (!currentTicket) throw new UserError("Tiket tidak ditemukan. Silakan scan ulang.");
        if (!scanPicker?.value) throw new UserError("Pilih nama siswa terlebih dahulu.");
        if (reason.length < 3) throw new UserError("Isi alasan keterlambatan (minimal 3 karakter).");
        setBusy(button, true, "Menyimpan...");
        const { error } = await supabase.rpc("record_late_arrival", { p_ticket_code: currentTicket.code, p_student_id: scanPicker.value, p_reason: reason });
        if (error) throw error;
        const s = students.find(x => x.id === scanPicker.value);
        $("record-panel").hidden = true;
        $("scan-success").hidden = false;
        $("success-detail").textContent = `${s?.name || "Siswa"} — ${s?.class || ""} — ${currentTicket.code}. Tiket dapat digunakan kembali setelah pukul 00.00 WIB.`;
        currentTicket = null; scanPicker = null;
    } catch (error) {
        console.error(error);
        showMessage("record-message", errText(error, "Data gagal disimpan. Silakan coba lagi."), "error");
    } finally { setBusy(button, false); }
}

function vChart(el, items, highlightLast = false) {
    if (!el) return;
    if (!items.some(i => i.count)) { el.style.display = "block"; el.innerHTML = '<p class="app-empty">Belum ada data.</p>'; return; }
    const max = Math.max(...items.map(i => i.count));
    el.style.display = "";
    el.style.gridTemplateColumns = `repeat(${items.length},minmax(0,1fr))`;
    el.innerHTML = items.map((it, i) => {
        const h = it.count ? Math.max(5, Math.round(it.count / max * 100)) : 3;
        return `<div class="app-chart-day"><span class="app-chart-count">${it.count}</span><div class="app-chart-track"><div class="app-chart-bar${highlightLast && i === items.length - 1 ? " today" : ""}" style="height:${h}%"></div></div><span class="app-chart-label">${esc(it.label)}</span></div>`;
    }).join("");
}

function hChart(el, items) {
    if (!el) return;
    if (!items.length) { el.innerHTML = '<p class="app-empty">Belum ada data.</p>'; return; }
    const max = Math.max(...items.map(i => i.count), 1);
    el.innerHTML = items.map(it => `<div class="hbar-row"><span class="hbar-label" title="${esc(it.label)}">${esc(it.label)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(3, Math.round(it.count / max * 100))}%"></div></div><span class="hbar-count">${it.count}</span></div>`).join("");
}

async function loadStats() {
    if (isAdmin()) {
        const { data, error } = await supabase.rpc("get_dashboard_stats");
        if (!$("stat-today")) return;
        if (error || !data) {
            showMessage("overview-message", errText(error, "Statistik belum dapat dimuat."), "error");
            if ($("weekly-chart")) $("weekly-chart").innerHTML = '<p class="app-empty">Statistik belum dapat dimuat.</p>';
            if ($("class-chart")) $("class-chart").innerHTML = '<p class="app-empty">Statistik belum dapat dimuat.</p>';
            return;
        }
        $("stat-today").textContent = num(data.today);
        $("stat-week").textContent = num(data.week);
        $("stat-month").textContent = num(data.month);
        $("stat-total").textContent = num(data.total);
        vChart($("weekly-chart"), (data.daily || []).map(r => ({
            label: new Date(`${r.date}T12:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "short" }),
            count: Number(r.count)
        })), true);
        hChart($("class-chart"), (data.by_class || []).map(r => ({
            label: r.label,
            count: Number(r.count)
        })));
        return;
    }
    const ranges = ["today", "week", "month", "all"];
    const results = await Promise.all(ranges.map(p_range => supabase.rpc("list_late_records", {
        p_search: "",
        p_range,
        p_limit: 1,
        p_offset: 0
    })));
    if (!$("stat-today")) return;
    const failed = results.find(result => result.error || !result.data);
    if (failed) {
        showMessage("overview-message", errText(failed.error, "Statistik belum dapat dimuat."), "error");
        ["stat-today", "stat-week", "stat-month", "stat-total"].forEach(id => {
            if ($(id)) $(id).textContent = "—";
        });
        return;
    }
    const counts = results.map(result => Number(result.data.total || 0));
    $("stat-today").textContent = num(counts[0]);
    $("stat-week").textContent = num(counts[1]);
    $("stat-month").textContent = num(counts[2]);
    $("stat-total").textContent = num(counts[3]);
}

async function loadLeaderboard() {
    const el = $("leaderboard");
    if (!el) return;
    const { data, error } = await supabase.rpc("get_late_leaderboard", { p_period: $("lb-period")?.value || "month" });
    if (!$("leaderboard")) return;
    if (error) { el.innerHTML = `<p class="app-empty">${esc(errText(error, "Peringkat belum dapat dimuat."))}</p>`; return; }
    if (!data?.length) { el.innerHTML = '<p class="app-empty">Belum ada data.</p>'; return; }
    const max = Math.max(...data.map(r => Number(r.count)), 1);
    el.innerHTML = `<ol class="lb">${data.map((r, i) => `
        <li><span class="lb-rank r${i + 1}">${i + 1}</span>
        <div class="lb-body"><div class="lb-top"><b>${esc(r.name)}${r.is_osis ? ' <span class="osis-pill">OSIS</span>' : ""}</b><span class="app-muted">${esc(r.class || "")}</span></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(4, Math.round(Number(r.count) / max * 100))}%"></div></div></div>
        <span class="lb-count">${r.count}×</span></li>`).join("")}</ol>`;
}

async function loadRecords() {
    const req = ++rec.req;
    if (!$("recent-records")) return;
    const cols = isAdmin() ? 7 : 6;
    const { data, error } = await supabase.rpc("list_late_records", { p_search: rec.search, p_range: rec.range, p_limit: PAGE_SIZE, p_offset: rec.page * PAGE_SIZE });
    const tbody = $("recent-records");
    if (req !== rec.req || !tbody) return; // stale response
    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="${cols}" class="app-empty">${esc(errText(error, "Data belum dapat dimuat."))}</td></tr>`;
        return;
    }
    rec.rows = data.rows || [];
    rec.total = Number(data.total || 0);
    tbody.innerHTML = rec.rows.length ? rec.rows.map(r => `<tr>
        <td>${esc(formatDateTime(r.created_at))}</td><td>${esc(r.ticket_id || "—")}</td><td>${esc(r.name || "—")}${r.is_osis ? ' <span class="osis-pill">OSIS</span>' : ""}</td>
        <td>${esc(r.class || "—")}</td><td><span class="app-record-note">${esc(r.reason || "—")}</span></td>
        ${isAdmin() ? `<td>${esc(r.recorder_name || "—")}</td>` : ""}
        <td>${r.can_edit ? `<div class="row-actions">
            <button type="button" class="app-button app-button-outline app-button-small edit-btn" data-id="${esc(r.id)}">Ubah</button>
            <button type="button" class="app-button app-button-danger app-button-small delete-btn" data-id="${esc(r.id)}">Hapus</button>
        </div>` : ""}</td></tr>`).join("")
        : `<tr><td colspan="${cols}" class="app-empty">${rec.search || rec.range !== "all" ? "Tidak ada data yang cocok." : "Belum ada data keterlambatan."}</td></tr>`;
    const pages = Math.max(1, Math.ceil(rec.total / PAGE_SIZE));
    const from = rec.total ? rec.page * PAGE_SIZE + 1 : 0, to = Math.min(rec.total, (rec.page + 1) * PAGE_SIZE);
    $("pager-info").textContent = `Menampilkan ${num(from)}–${num(to)} dari ${num(rec.total)}`;
    $("pager-page").textContent = `${rec.page + 1} / ${pages}`;
    $("pg-prev").disabled = rec.page === 0;
    $("pg-next").disabled = rec.page + 1 >= pages;
}

function loadOverview() {
    return Promise.all([loadStats(), loadRecords(), isAdmin() ? loadLeaderboard() : null]);
}

async function openEdit(row) {
    try { await loadStudents(); } catch { return toast("Data siswa belum dapat dimuat.", "error"); }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <h2 id="edit-title" class="app-panel-title">Ubah Data Keterlambatan</h2><div class="app-double-line"></div>
        <p class="app-muted" style="margin:-8px 0 16px">Tiket ${esc(row.ticket_id || "—")} · ${esc(formatDateTime(row.created_at))}</p>
        <form id="edit-form">
            <div class="app-form-group"><label>Nama Siswa</label><div id="edit-picker"></div></div>
            <div class="app-form-group"><label for="edit-reason">Alasan Terlambat <span class="app-required">*</span></label>
                <textarea id="edit-reason" rows="4" minlength="3" maxlength="1000" required>${esc(row.reason)}</textarea></div>
            <div id="edit-message" class="app-message" hidden></div>
            <div class="app-button-row">
                <button type="button" class="app-button app-button-outline" data-close>Batal</button>
                <button type="submit" class="app-button app-button-primary" id="edit-save">Simpan Perubahan</button>
            </div>
        </form>
    </div>`;
    document.body.append(modal);
    document.body.style.overflow = "hidden";
    const picker = createPicker($("edit-picker"), { placeholder: `${row.name} (${row.class})` });
    if (row.student_id) picker.set(row.student_id);
    editing = { row, picker, modal };
}

function closeEdit() {
    if (!editing) return;
    openPicker?.close();
    editing.modal.remove();
    document.body.style.overflow = "";
    editing = null;
}

function openDelete(row) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="del-title">
        <h2 id="del-title" class="app-panel-title">Hapus Data?</h2><div class="app-double-line"></div>
        <p style="margin-bottom:16px">Data keterlambatan <b>${esc(row.name || "—")}</b> (${esc(row.class || "—")}) pada tiket ${esc(row.ticket_id || "—")}, ${esc(formatDateTime(row.created_at))}, akan dihapus permanen.</p>
        <div id="edit-message" class="app-message" hidden></div>
        <div class="app-button-row">
            <button type="button" class="app-button app-button-outline" data-close>Batal</button>
            <button type="button" class="app-button app-button-danger" id="delete-confirm">Ya, Hapus</button>
        </div>
    </div>`;
    document.body.append(modal);
    document.body.style.overflow = "hidden";
    editing = { row, picker: null, modal };
}

async function confirmDelete(btn) {
    if (!editing) return;
    setBusy(btn, true, "Menghapus...");
    const { error } = await supabase.rpc("delete_late_record", { p_id: String(editing.row.id) });
    if (error) {
        showMessage("edit-message", errText(error, "Data gagal dihapus. Silakan coba lagi."), "error");
        setBusy(btn, false);
        return;
    }
    closeEdit();
    toast("Data dihapus.");
    if (rec.rows.length === 1 && rec.page > 0) rec.page--;
    loadOverview();
}

async function handleSubmit(event) {
    const form = event.target;
    if (!["login-form", "forgot-form", "reset-form", "record-form", "edit-form"].includes(form.id)) return;
    event.preventDefault();
    const fd = new FormData(form);
    const button = form.querySelector('button[type="submit"]');

    if (form.id === "record-form") return saveRecord(form);

    if (form.id === "login-form") {
        setBusy(button, true, "Memeriksa...");
        const { error } = await supabase.auth.signInWithPassword({ email: String(fd.get("email")).trim(), password: String(fd.get("password")) });
        if (error) {
            showMessage("login-message", error.status === 400 ? "Email atau password salah." : errText(error, "Gagal masuk. Silakan coba lagi."), "error");
            setBusy(button, false);
        }
        return;
    }

    if (form.id === "forgot-form") {
        setBusy(button, true, "Mengirim...");
        const { error } = await supabase.auth.resetPasswordForEmail(String(fd.get("email")).trim(), { redirectTo: `${location.origin}${location.pathname}` });
        if (error) {
            showMessage("forgot-message", error.status === 429 ? "Terlalu banyak permintaan. Coba lagi beberapa menit lagi." : errText(error, "Tautan gagal dikirim. Silakan coba lagi."), "error");
            setBusy(button, false);
        } else {
            showMessage("forgot-message", "Jika email terdaftar, tautan untuk membuat password baru sudah dikirim. Periksa kotak masuk atau folder spam.", "success");
            button.textContent = "Terkirim";
        }
        return;
    }

    if (form.id === "reset-form") {
        const pw = String(fd.get("password")), confirm = String(fd.get("confirm"));
        if (pw.length < 8) return showMessage("reset-message", "Password minimal 8 karakter.", "error");
        if (pw !== confirm) return showMessage("reset-message", "Kedua password tidak sama.", "error");
        setBusy(button, true, "Menyimpan...");
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) {
            showMessage("reset-message", /different|same/i.test(error.message) ? "Password baru harus berbeda dari password lama." : errText(error, "Password gagal diubah. Minta tautan baru lalu coba lagi."), "error");
            setBusy(button, false);
            return;
        }
        recovering = false;
        flash = { text: "Password berhasil diubah. Silakan masuk dengan password baru.", type: "success" };
        await supabase.auth.signOut();
        return;
    }

    if (form.id === "password-form") {
        const pw = String(fd.get("password")), confirm = String(fd.get("confirm"));
        if (pw.length < 8) return showMessage("password-message", "Password minimal 8 karakter.", "error");
        if (pw !== confirm) return showMessage("password-message", "Kedua password tidak sama.", "error");
        setBusy(button, true, "Menyimpan...");
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(button, false);
        if (error) return showMessage("password-message", /different|same/i.test(error.message) ? "Password baru harus berbeda dari password lama." : errText(error, "Password gagal diubah. Silakan coba lagi."), "error");
        form.reset();
        showMessage("password-message", "Password berhasil diubah.", "success");
        return;
    }

    if (form.id === "edit-form" && editing) {
        const reason = $("edit-reason").value.trim();
        if (reason.length < 3) return showMessage("edit-message", "Alasan minimal 3 karakter.", "error");
        setBusy(button, true, "Menyimpan...");
        const { error } = await supabase.rpc("update_late_record", { p_id: String(editing.row.id), p_student_id: editing.picker.value, p_reason: reason });
        if (error) {
            showMessage("edit-message", errText(error, "Perubahan gagal disimpan. Silakan coba lagi."), "error");
            setBusy(button, false);
            return;
        }
        closeEdit();
        toast("Perubahan disimpan.");
        loadRecords();
        if (isAdmin()) loadLeaderboard();
    }
}

async function handleClick(event) {
    const t = event.target;
    if (!t.closest?.("#header-account")) closeAccountMenu();
    if (openPicker && !openPicker.root.contains(t)) openPicker.close();
    if (t.classList?.contains("modal")) return closeEdit();
    const el = t.closest("button, a");
    if (!el) return;
    if (el.id === "account-toggle") {
        const open = $("account-menu").hidden;
        $("account-menu").hidden = !open;
        el.setAttribute("aria-expanded", String(open));
        return;
    }
    if (el.matches(".account-menu a")) closeAccountMenu();
    if (el.id === "logout-button") { el.disabled = true; const { error } = await supabase.auth.signOut(); if (error) { el.disabled = false; toast("Gagal keluar. Silakan coba lagi.", "error"); } return; }
    if (el.matches("[data-close]")) return closeEdit();
    if (el.classList.contains("edit-btn")) { const row = rec.rows.find(r => String(r.id) === el.dataset.id); if (row) openEdit(row); return; }
    if (el.classList.contains("delete-btn")) { const row = rec.rows.find(r => String(r.id) === el.dataset.id); if (row) openDelete(row); return; }
    if (el.id === "delete-confirm") return confirmDelete(el);
    if (el.id === "btn-switch") return switchCamera();
    if (el.id === "btn-torch") return toggleTorch();
    if (el.id === "rescan-button" || el.id === "next-scan-button") { currentTicket = null; return navigate(); }
    if (el.id === "refresh-overview") { el.disabled = true; await loadOverview(); el.disabled = false; return; }
    if (el.id === "pg-prev" && rec.page > 0) { rec.page--; return loadRecords(); }
    if (el.id === "pg-next") { rec.page++; return loadRecords(); }
    if (el.matches(".menu a")) $("menu-toggle").checked = false;
}

const onSearch = debounce(v => { rec.search = v.trim(); rec.page = 0; loadRecords(); }, 300);

page.addEventListener("input", e => { if (e.target.id === "rec-search") onSearch(e.target.value); });
page.addEventListener("change", e => {
    if (e.target.id === "student-class") scanPicker?.refresh();
    if (e.target.id === "rec-range") { rec.range = e.target.value; rec.page = 0; loadRecords(); }
    if (e.target.id === "lb-period") loadLeaderboard();
});
document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);
document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (editing) closeEdit(); else closeAccountMenu();
});
window.addEventListener("hashchange", navigate);

async function initialize() {
    if (/error_code|error_description|error=access_denied/.test(location.search + location.hash)) {
        flash = { text: "Tautan pemulihan tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru.", type: "error" };
        history.replaceState(null, "", `${location.pathname}#forgot`);
    }
    supabase.auth.onAuthStateChange((event, next) => {
        const prevId = session?.user?.id;
        session = next;
        if (!next) { profile = null; recovering = false; }
        if (event === "PASSWORD_RECOVERY") {
            recovering = true;
            if (location.hash !== "#reset") { location.hash = "#reset"; return; }
        }
        if (["INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;
        if (event === "SIGNED_IN" && next?.user?.id === prevId) return;
        setTimeout(navigate, 0);
    });
    const qs = new URLSearchParams(location.search);
    const tokenHash = qs.get("token_hash");
    if (tokenHash && qs.get("type") === "recovery") {
        history.replaceState(null, "", `${location.pathname}#reset`);
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (error) {
            flash = { text: "Tautan pemulihan tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru.", type: "error" };
            history.replaceState(null, "", `${location.pathname}#forgot`);
        } else {
            recovering = true;
        }
    }
    const { data } = await supabase.auth.getSession();
    session = data?.session || null;
    await navigate();
}

initialize();
