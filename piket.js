import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://tdyplxixwuwxcsacreiv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeZpLP-uFkWVUCRgnCOFnw_jOcf4JQS";
const isConfigured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_PROJECT_ID") && SUPABASE_ANON_KEY.length > 30 && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");
const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const page = document.getElementById("page");
let session = null;
let profile = null;
let scanner = null;
let cameras = [];
let cameraIndex = 0;
let cameraRunning = false;
let torchOn = false;
let scanBusy = false;
let currentTicket = null;
let students = [];
let navigationId = 0;

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderLogin(message = "") {
    return `
    <main class="app-page app-page-center">
        <div class="app-card">
            <div class="app-card-body">
                <h1 class="app-title">Masuk</h1>
                <div class="app-double-line"></div>
                <p class="app-description">Silakan masuk untuk mengakses sistem piket keterlambatan OSIS SMA Maitreyawira Palembang.</p>
                ${message ? `<div class="app-message ${message.type || ""}" role="alert">${escapeHTML(message.text)}</div>` : ""}
                ${!isConfigured ? `<div class="app-message error" role="alert">Konfigurasi Supabase belum diisi. Masukkan Project URL dan anon key pada bagian atas piket.js.</div>` : ""}
                <form id="login-form">
                    <div class="app-form-group">
                        <label for="login-email">Email <span class="app-required">*</span></label>
                        <input type="email" id="login-email" name="email" placeholder="Masukkan email" required autocomplete="username" ${!isConfigured ? "disabled" : ""}>
                    </div>
                    <div class="app-form-group">
                        <label for="login-password">Password <span class="app-required">*</span></label>
                        <input type="password" id="login-password" name="password" placeholder="Masukkan password" required autocomplete="current-password" ${!isConfigured ? "disabled" : ""}>
                    </div>
                    <div class="app-form-options">
                        <span class="app-muted">Gunakan akun yang dibuat oleh admin.</span>
                        <a href="#" id="forgot-password">Lupa password?</a>
                    </div>
                    <button type="submit" class="app-button app-button-primary app-button-full" ${!isConfigured ? "disabled" : ""}>Masuk</button>
                </form>
            </div>
        </div>
    </main>`;
}

function renderScan() {
    return `
    <section class="app-hero">
        <div class="app-container">
            <h1 class="app-title">Scan Tiket</h1>
            <div class="app-double-line"></div>
            <p class="app-hero-description">Scan QR code pada tiket keterlambatan untuk mencatat data siswa.</p>
        </div>
    </section>
    <main class="app-container app-narrow app-scan-main">
        <section class="app-panel" id="scan-panel">
            <h2 class="app-panel-title">Langkah 1 — Scan QR Code</h2>
            <div class="app-double-line"></div>
            <div class="app-viewfinder">
                <div id="reader"></div>
                <div class="app-frame">
                    <span class="app-corner tl"></span>
                    <span class="app-corner tr"></span>
                    <span class="app-corner bl"></span>
                    <span class="app-corner br"></span>
                    <span class="app-scan-line"></span>
                </div>
                <p class="app-cam-status" id="camera-status"><i class="app-dot"></i> Menyiapkan kamera...</p>
            </div>
            <p class="app-scan-hint">Arahkan kamera ke QR code pada tiket. Pastikan QR code berada di dalam kotak dan pencahayaan cukup.</p>
            <div class="app-button-row">
                <button type="button" class="app-button app-button-outline" id="btn-switch">Ganti Kamera</button>
                <button type="button" class="app-button app-button-outline" id="btn-torch">Senter</button>
            </div>
            <div id="scan-message" class="app-message" role="status" hidden></div>
        </section>
        <section class="app-panel" id="record-panel" hidden>
            <h2 class="app-panel-title">Langkah 2 — Data Keterlambatan</h2>
            <div class="app-double-line"></div>
            <div class="app-ticket-badge">
                <span class="app-ticket-check">&#10003;</span>
                <div><small>Tiket terdeteksi dan valid</small><b id="ticket-label">TIKET-000</b></div>
            </div>
            <form id="record-form">
                <div class="app-form-group">
                    <label for="student-class">Kelas <span class="app-required">*</span></label>
                    <select id="student-class" name="student_class" required>
                        <option value="">Pilih kelas</option>
                    </select>
                </div>
                <div class="app-form-group">
                    <label for="student-search">Cari Nama Siswa</label>
                    <input type="search" id="student-search" placeholder="Cari nama atau NIS..." autocomplete="off">
                </div>
                <div class="app-form-group">
                    <label for="student-id">Nama Siswa <span class="app-required">*</span></label>
                    <select id="student-id" name="student_id" required>
                        <option value="">Pilih siswa</option>
                    </select>
                </div>
                <div class="app-form-group">
                    <label for="late-reason">Alasan Terlambat <span class="app-required">*</span></label>
                    <textarea id="late-reason" name="reason" rows="4" minlength="3" maxlength="1000" placeholder="Contoh: Macet di jalan, kendaraan mogok..." required></textarea>
                </div>
                <div id="record-message" class="app-message" role="status" hidden></div>
                <div class="app-button-row">
                    <button type="button" class="app-button app-button-outline" id="rescan-button">Scan Ulang</button>
                    <button type="submit" class="app-button app-button-primary" id="save-record-button">Simpan Data</button>
                </div>
            </form>
        </section>
        <section class="app-panel" id="scan-success" hidden>
            <div class="app-success">
                <span class="app-success-icon">&#10003;</span>
                <h2>Data Berhasil Disimpan</h2>
                <p id="success-detail"></p>
            </div>
            <div class="app-button-row" style="margin-top:18px">
                <button type="button" class="app-button app-button-outline" id="next-scan-button">Scan Tiket Berikutnya</button>
                <a href="#overview" class="app-button app-button-primary">Lihat Dashboard</a>
            </div>
        </section>
    </main>`;
}

function renderOverview() {
    return `
    <section class="app-hero">
        <div class="app-container">
            <h1 class="app-title">Dashboard Piket</h1>
            <div class="app-double-line"></div>
            <p class="app-hero-description">Ringkasan dan statistik data keterlambatan siswa.</p>
        </div>
    </section>
    <main class="app-container app-page" style="min-height:0;padding-top:0">
        <div id="overview-message" class="app-message" role="status" hidden></div>
        <section class="app-stats-grid">
            <article class="app-stat-card"><span class="app-stat-label">Keterlambatan Hari Ini</span><strong class="app-stat-value" id="stat-today">—</strong></article>
            <article class="app-stat-card"><span class="app-stat-label">Bulan Ini</span><strong class="app-stat-value" id="stat-month">—</strong></article>
            <article class="app-stat-card"><span class="app-stat-label">Total Data</span><strong class="app-stat-value" id="stat-total">—</strong></article>
        </section>
        <div class="app-dashboard-grid">
            <section class="app-panel">
                <h2 class="app-panel-title">Statistik 7 Hari Terakhir</h2>
                <div class="app-double-line"></div>
                <div class="app-chart" id="weekly-chart"><p class="app-empty">Memuat statistik...</p></div>
            </section>
            <section class="app-panel">
                <h2 class="app-panel-title">Informasi</h2>
                <div class="app-double-line"></div>
                <p>Gunakan menu <b>Scan Tiket</b> untuk memindai QR code dan mencatat keterlambatan siswa.</p>
                <p class="app-muted" style="margin-top:12px">Data pada dashboard diperbarui dari database saat halaman dibuka atau tombol perbarui ditekan.</p>
                <a href="#scan" class="app-button app-button-primary" style="margin-top:18px">Mulai Scan</a>
            </section>
        </div>
        <section class="app-panel">
            <div class="app-section-heading">
                <h2>Data Keterlambatan Terbaru</h2>
                <button type="button" class="app-button app-button-outline" id="refresh-overview">Perbarui</button>
            </div>
            <div class="app-table-wrap">
                <table class="app-table">
                    <thead><tr><th>Waktu</th><th>Tiket</th><th>Nama Siswa</th><th>Kelas</th><th>Alasan</th><th>Petugas</th></tr></thead>
                    <tbody id="recent-records"><tr><td colspan="6" class="app-empty">Memuat data...</td></tr></tbody>
                </table>
            </div>
        </section>
    </main>`;
}

function setHeader() {
    document.querySelectorAll(".auth-link").forEach(element => element.hidden = !session);
    document.querySelectorAll(".guest-link").forEach(element => element.hidden = !!session);
    const account = document.getElementById("header-account");
    account.hidden = !session;
    document.getElementById("account-name").textContent = profile?.full_name || session?.user?.email || "Petugas";
    document.getElementById("menu-toggle").checked = false;
}

function showMessage(elementId, message, type = "") {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = message;
    element.className = `app-message ${type}`.trim();
    element.hidden = !message;
}

function jakartaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

function lastSevenDays() {
    const today = jakartaDateKey();
    const base = new Date(`${today}T00:00:00+07:00`);
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(base);
        date.setUTCDate(date.getUTCDate() - (6 - index));
        const key = date.toISOString().slice(0, 10);
        return { key, label: new Date(`${key}T12:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "short" }) };
    });
}

async function getProfile() {
    if (!session) return null;
    const { data, error } = await supabase.from("profiles").select("id,full_name,role,active").eq("id", session.user.id).single();
    if (error) throw error;
    if (!data.active) throw new Error("Akun ini dinonaktifkan. Hubungi administrator.");
    return data;
}

async function stopScanner() {
    scanBusy = false;
    torchOn = false;
    if (scanner) {
        try {
            if (cameraRunning) await scanner.stop();
        } catch (error) {
            console.warn(error);
        }
        try {
            await scanner.clear();
        } catch (error) {
            console.warn(error);
        }
    }
    scanner = null;
    cameraRunning = false;
}

async function navigate() {
    const runId = ++navigationId;
    const requested = location.hash.slice(1) || "login";
    let route = ["login", "scan", "overview"].includes(requested) ? requested : "login";
    if (!isConfigured) {
        await stopScanner();
        page.innerHTML = renderLogin();
        setHeader();
        return;
    }
    if (!session && route !== "login") {
        location.hash = "#login";
        route = "login";
    }
    if (session) {
        try {
            profile = await getProfile();
        } catch (error) {
            await supabase.auth.signOut();
            session = null;
            profile = null;
            route = "login";
            if (location.hash !== "#login") location.hash = "#login";
            if (runId !== navigationId) return;
            page.innerHTML = renderLogin({ text: error.message || "Akun tidak memiliki akses ke sistem.", type: "error" });
            setHeader();
            return;
        }
        if (route === "login") {
            location.hash = "#overview";
            route = "overview";
        }
    } else {
        profile = null;
    }
    if (route !== "scan") await stopScanner();
    if (runId !== navigationId) return;
    setHeader();
    if (route === "login") {
        page.innerHTML = renderLogin();
        return;
    }
    if (route === "overview") {
        page.innerHTML = renderOverview();
        loadOverview();
        return;
    }
    currentTicket = null;
    students = [];
    page.innerHTML = renderScan();
    startScanner();
}

async function startScanner() {
    const status = document.getElementById("camera-status");
    const reader = document.getElementById("reader");
    if (!status || !reader) return;
    if (!window.Html5Qrcode) {
        status.textContent = "Library pemindai QR tidak berhasil dimuat.";
        return;
    }
    try {
        cameras = await Html5Qrcode.getCameras();
        const source = cameras.length ? cameras[cameraIndex % cameras.length].id : { facingMode: "environment" };
        scanner = new Html5Qrcode("reader");
        await scanner.start(source, { fps: 10, aspectRatio: 1 }, decodedText => processTicketCode(decodedText), () => {});
        cameraRunning = true;
        status.innerHTML = '<i class="app-dot"></i> Kamera aktif. Menunggu QR code...';
    } catch (error) {
        console.error(error);
        status.textContent = "Kamera tidak dapat diakses. Izinkan akses kamera dan gunakan HTTPS.";
        showMessage("scan-message", error.message || "Periksa izin kamera pada browser.", "error");
    }
}

async function processTicketCode(rawValue) {
    if (scanBusy || !scanner) return;
    scanBusy = true;
    const code = String(rawValue || "").trim().toUpperCase();
    if (!/^OSISSMAMWPLG-TIKET-[0-9]+$/.test(code)) {
        showMessage("scan-message", "QR code tidak valid. Pastikan QR berisi kode seperti TIKET-001.", "error");
        scanBusy = false;
        return;
    }
    showMessage("scan-message", "Memeriksa tiket...", "");
    try {
        const { data, error } = await supabase.from("tickets").select("id,code,status,used_at").eq("code", code).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Tiket tidak terdaftar di database.");
        if (data.status !== "active" || data.used_at) throw new Error("Tiket ini sudah digunakan atau tidak aktif.");
        currentTicket = data;
        await stopScanner();
        const { data: studentRows, error: studentError } = await supabase.from("students").select("id,name,nis,class").eq("active", true).order("name", { ascending: true });
        if (studentError) throw studentError;
        students = studentRows || [];
        if (!students.length) throw new Error("Data siswa belum tersedia. Minta administrator mengisi tabel students.");
        document.getElementById("ticket-label").textContent = data.code;
        document.getElementById("scan-panel").hidden = true;
        document.getElementById("record-panel").hidden = false;
        fillStudentClasses();
        filterStudents();
    } catch (error) {
        console.error(error);
        showMessage("scan-message", error.message || "Tiket gagal diperiksa. Silakan coba lagi.", "error");
        scanBusy = false;
        if (!scanner && document.getElementById("scan-panel") && !document.getElementById("scan-panel").hidden) {
            currentTicket = null;
            startScanner();
        }
    }
}

function fillStudentClasses() {
    const select = document.getElementById("student-class");
    if (!select) return;
    const classes = [...new Set(students.map(student => student.class).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
    select.innerHTML = `<option value="">Pilih kelas</option>${classes.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}`;
}

function filterStudents() {
    const classValue = document.getElementById("student-class")?.value || "";
    const query = (document.getElementById("student-search")?.value || "").trim().toLocaleLowerCase("id");
    const select = document.getElementById("student-id");
    if (!select) return;
    const filtered = students.filter(student => (!classValue || student.class === classValue) && (!query || `${student.name} ${student.nis}`.toLocaleLowerCase("id").includes(query)));
    select.innerHTML = `<option value="">Pilih siswa (${filtered.length})</option>${filtered.map(student => `<option value="${escapeHTML(student.id)}">${escapeHTML(student.name)} — ${escapeHTML(student.nis)} (${escapeHTML(student.class)})</option>`).join("")}`;
}

async function switchCamera() {
    if (cameras.length < 2) {
        showMessage("scan-message", "Perangkat ini hanya menyediakan satu kamera atau kamera belum terdeteksi.");
        return;
    }
    await stopScanner();
    cameraIndex = (cameraIndex + 1) % cameras.length;
    await startScanner();
}

async function toggleTorch() {
    if (!scanner || !cameraRunning) return;
    try {
        torchOn = !torchOn;
        await scanner.applyVideoConstraints({ advanced: [{ torch: torchOn }] });
    } catch (error) {
        torchOn = false;
        showMessage("scan-message", "Senter tidak didukung oleh perangkat atau browser ini.");
    }
}

async function saveRecord(form) {
    if (!currentTicket) throw new Error("Tidak ada tiket yang sedang diproses. Silakan scan ulang.");
    const formData = new FormData(form);
    const studentId = String(formData.get("student_id") || "");
    const reason = String(formData.get("reason") || "").trim();
    if (!studentId || reason.length < 3) throw new Error("Pilih siswa dan isi alasan keterlambatan minimal 3 karakter.");
    const button = document.getElementById("save-record-button");
    button.disabled = true;
    button.textContent = "Menyimpan...";
    try {
        const { data, error } = await supabase.rpc("record_late_arrival", { p_ticket_code: currentTicket.code, p_student_id: studentId, p_reason: reason });
        if (error) throw error;
        const selectedStudent = students.find(student => student.id === studentId);
        await stopScanner();
        document.getElementById("record-panel").hidden = true;
        document.getElementById("scan-success").hidden = false;
        document.getElementById("success-detail").textContent = `${selectedStudent?.name || "Siswa"} — ${selectedStudent?.class || ""} — ${currentTicket.code}`;
        currentTicket = null;
    } catch (error) {
        showMessage("record-message", error.message || "Data gagal disimpan.", "error");
    } finally {
        button.disabled = false;
        button.textContent = "Simpan Data";
    }
}

async function loadOverview() {
    const message = document.getElementById("overview-message");
    if (!message) return;
    try {
        const [statsResult, recordsResult] = await Promise.all([
            supabase.rpc("get_late_statistics"),
            supabase.from("late_records").select("id,reason,created_at,tickets(code),students(name,nis,class),profiles(full_name)").order("created_at", { ascending: false }).limit(12)
        ]);
        if (statsResult.error) throw statsResult.error;
        if (recordsResult.error) throw recordsResult.error;
        const stats = statsResult.data || {};
        document.getElementById("stat-today").textContent = Number(stats.today || 0).toLocaleString("id-ID");
        document.getElementById("stat-month").textContent = Number(stats.month || 0).toLocaleString("id-ID");
        document.getElementById("stat-total").textContent = Number(stats.total || 0).toLocaleString("id-ID");
        renderWeeklyChart(stats.daily || []);
        renderRecentRecords(recordsResult.data || []);
    } catch (error) {
        console.error(error);
        showMessage("overview-message", error.message || "Data dashboard gagal dimuat.", "error");
        document.getElementById("weekly-chart").innerHTML = '<p class="app-empty">Statistik belum dapat dimuat.</p>';
        document.getElementById("recent-records").innerHTML = '<tr><td colspan="6" class="app-empty">Data belum dapat dimuat.</td></tr>';
    }
}

function renderWeeklyChart(rows) {
    const chart = document.getElementById("weekly-chart");
    if (!chart) return;
    const values = new Map(rows.map(row => [row.date, Number(row.count || 0)]));
    const days = lastSevenDays().map(day => ({ ...day, count: values.get(day.key) || 0 }));
    const max = Math.max(1, ...days.map(day => day.count));
    chart.innerHTML = days.map(day => {
        const height = day.count ? Math.max(5, Math.round(day.count / max * 100)) : 3;
        return `<div class="app-chart-day"><span class="app-chart-count">${day.count}</span><div class="app-chart-track"><div class="app-chart-bar" style="height:${height}%"></div></div><span class="app-chart-label">${escapeHTML(day.label)}</span></div>`;
    }).join("");
}

function renderRecentRecords(records) {
    const tbody = document.getElementById("recent-records");
    if (!tbody) return;
    if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="app-empty">Belum ada data keterlambatan.</td></tr>';
        return;
    }
    tbody.innerHTML = records.map(record => {
        const ticket = Array.isArray(record.tickets) ? record.tickets[0] : record.tickets;
        const student = Array.isArray(record.students) ? record.students[0] : record.students;
        const recorder = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
        return `<tr><td>${escapeHTML(formatDateTime(record.created_at))}</td><td>${escapeHTML(ticket?.code || "—")}</td><td>${escapeHTML(student?.name || "—")}<br><span class="app-muted">${escapeHTML(student?.nis || "")}</span></td><td>${escapeHTML(student?.class || "—")}</td><td><span class="app-record-note">${escapeHTML(record.reason || "—")}</span></td><td>${escapeHTML(recorder?.full_name || "—")}</td></tr>`;
    }).join("");
}

async function handleSubmit(event) {
    const form = event.target;
    if (form.id !== "login-form" && form.id !== "record-form") return;
    event.preventDefault();
    if (form.id === "login-form") {
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = "Memeriksa...";
        try {
            const formData = new FormData(form);
            const { data, error } = await supabase.auth.signInWithPassword({ email: String(formData.get("email") || "").trim(), password: String(formData.get("password") || "") });
            if (error) throw error;
            session = data.session;
            await navigate();
        } catch (error) {
            const oldMessage = document.getElementById("login-message");
            if (oldMessage) oldMessage.remove();
            const box = document.createElement("div");
            box.id = "login-message";
            box.className = "app-message error";
            box.setAttribute("role", "alert");
            box.textContent = error.message || "Email atau password tidak benar.";
            form.prepend(box);
            button.disabled = false;
            button.textContent = "Masuk";
        }
        return;
    }
    const button = document.getElementById("save-record-button");
    if (button.disabled) return;
    await saveRecord(form);
}

async function handleClick(event) {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.id === "logout-button") {
        target.disabled = true;
        const { error } = await supabase.auth.signOut();
        if (error) {
            target.disabled = false;
            window.alert(error.message);
        }
        return;
    }
    if (target.id === "forgot-password") {
        event.preventDefault();
        const email = document.getElementById("login-email")?.value.trim();
        if (!email) {
            const input = document.getElementById("login-email");
            input?.focus();
            input?.setCustomValidity("Masukkan email terlebih dahulu.");
            input?.reportValidity();
            input?.addEventListener("input", () => input.setCustomValidity(""), { once: true });
            return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#login` });
        if (error) window.alert(error.message);
        else window.alert("Tautan pemulihan password telah dikirim jika email terdaftar.");
        return;
    }
    if (target.id === "btn-switch") await switchCamera();
    if (target.id === "btn-torch") await toggleTorch();
    if (target.id === "rescan-button" || target.id === "next-scan-button") {
        currentTicket = null;
        location.hash = "#scan";
        if (location.hash === "#scan") await navigate();
    }
    if (target.id === "refresh-overview") {
        target.disabled = true;
        await loadOverview();
        target.disabled = false;
    }
    if (target.matches(".menu a")) document.getElementById("menu-toggle").checked = false;
}

page.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);
page.addEventListener("change", event => {
    if (event.target.id === "student-class") filterStudents();
});
page.addEventListener("input", event => {
    if (event.target.id === "student-search") filterStudents();
});
window.addEventListener("hashchange", navigate);

async function initialize() {
    if (!isConfigured) {
        await navigate();
        return;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error(error);
    session = data?.session || null;
    supabase.auth.onAuthStateChange((event, nextSession) => {
        session = nextSession;
        if (!nextSession) profile = null;
        Promise.resolve().then(() => navigate());
    });
    await navigate();
}

initialize();