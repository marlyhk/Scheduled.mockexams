/* Scheduled Mock Exams v1.3
   Separate static website using the same Firebase project and visual system as Scheduled.
*/

window.addEventListener("error", (event) => {
  try {
    document.getElementById("splash")?.classList.add("hidden");
    document.getElementById("app")?.classList.remove("hidden");
    const target = document.getElementById("authShell") || document.body;
    if (!target.innerHTML.trim()) {
      target.innerHTML = `<div class="auth-card"><h2>Website error</h2><p class="muted">${escapeHtml(event.message || "Unknown error")}</p><button onclick="location.reload()">Reload</button></div>`;
    }
  } catch (_) {}
});

const firebaseConfig = {
  apiKey: "AIzaSyBK-Iu_TKXq7-PjIDOxXvwp2MDYXikQV8Y",
  authDomain: "scheduled-ed.firebaseapp.com",
  databaseURL: "https://scheduled-ed-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "scheduled-ed",
  storageBucket: "scheduled-ed.firebasestorage.app",
  messagingSenderId: "1057147687553",
  appId: "1:1057147687553:web:2c76219c0b97e2e9b3f380",
  measurementId: "G-QF774WZ4ER"
};

firebase.initializeApp(firebaseConfig);
const secondaryApp = firebase.initializeApp(firebaseConfig, "MockExamSecondary");
const auth = firebase.auth();
const secondaryAuth = secondaryApp.auth();
const db = firebase.database();

const ROOT = "mockExamAppV1";
const ADMIN_PHONE = "96176174738";
const DEFAULT_WHATSAPP = "96176174738";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const FILE_CHUNK_CHARS = 450000;
const APP_VERSION = "1.3.0";

let currentRole = null;
let currentUser = null;
let currentAccess = null;
let currentExam = null;
let currentAttempt = null;
let serverOffset = 0;
let timerHandle = null;
let submissionHandle = null;
let accessWatchRef = null;
let attemptWatchRef = null;
let adminDataRef = null;
let adminData = { exams: {}, students: {}, enrollments: {}, access: {}, attempts: {}, settings: {} };
let adminTab = "overview";
let adminExamFilter = "";
let pdfRenderToken = 0;
let authFlowBusy = false;
let examStartBusy = false;
let studentSettings = {};
let lastSeenWriteAt = 0;
let preparedExamPdf = null;
let examPreparePromise = null;

const $ = (id) => document.getElementById(id);
const now = () => Date.now() + serverOffset;
const rootRef = (path = "") => db.ref(`${ROOT}${path ? "/" + path : ""}`);

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

setTimeout(() => {
  $("splash")?.classList.add("hidden");
  $("app")?.classList.remove("hidden");
}, 1250);

db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverOffset = Number(snap.val() || 0);
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function cleanDigits(value) { return String(value || "").replace(/\D/g, ""); }
function normalizePhone(value) {
  let digits = cleanDigits(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && !digits.startsWith("0961")) digits = "961" + digits.replace(/^0+/, "");
  return /^961\d{7,8}$/.test(digits) ? digits : "";
}
function strict961Phone(value) {
  let digits = cleanDigits(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  return /^961\d{7,8}$/.test(digits) ? digits : "";
}
function localPhone(phone) { return String(phone || "").replace(/^961/, ""); }
function adminEmail(phone) { return `mockadmin.${phone}@scheduledmock.app`; }
function accessEmail(accessId) { return `mock.${String(accessId).toLowerCase()}@scheduledmock.app`; }
function randomChars(length, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") {
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (n) => alphabet[n % alphabet.length]).join("");
}
function randomPassword(length = 28) {
  return `${randomChars(10)}${randomChars(8, "abcdefghijkmnpqrstuvwxyz")}${randomChars(6, "23456789")}${randomChars(Math.max(4, length - 24), "!@#%")}`;
}
function generateAccessCode() {
  const accessId = randomChars(8);
  const password = `MHG-${accessId}-${randomChars(6)}`;
  return { accessId, password };
}
function parseAccessId(password) {
  const match = String(password || "").trim().toUpperCase().match(/^MHG-([A-Z0-9]{8})-[A-Z0-9]{6}$/);
  return match ? match[1] : "";
}
function getExamIdFromUrl() {
  return new URLSearchParams(location.search).get("exam") || "";
}
function siteBase() { return `${location.origin}${location.pathname}`; }
function examLink(examId) { return `${siteBase()}?exam=${encodeURIComponent(examId)}`; }
function formatDateTime(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(ts)));
}
function formatDate(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(Number(ts)));
}
function toDateTimeLocal(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function durationLabel(minutes) {
  const total = Math.max(0, Number(minutes || 0));
  const h = Math.floor(total / 60), m = total % 60;
  if (h && m) return `${h} hour${h === 1 ? "" : "s"}, ${m} minute${m === 1 ? "" : "s"}`;
  if (h) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"}`;
}
function countdownLabel(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function badge(text, cls = "neutral") { return `<span class="badge ${cls}">${escapeHtml(text)}</span>`; }
function showToast(message, duration = 2800) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add("hidden"), duration);
}
function showModal(html) {
  const modal = $("globalModal");
  modal.innerHTML = `<div class="modal-box">${html}</div>`;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  const modal = $("globalModal");
  modal.classList.add("hidden");
  modal.innerHTML = "";
  modal.setAttribute("aria-hidden", "true");
}
function openWhatsApp(phone, message) {
  const p = normalizePhone(phone) || cleanDigits(phone);
  if (!p) return showToast("No valid WhatsApp number is saved.");
  window.open(`https://wa.me/${p}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}
function copyText(text, success = "Copied") {
  navigator.clipboard?.writeText(text).then(() => showToast(success)).catch(() => prompt("Copy this:", text));
}
function getDeviceId() {
  let id = localStorage.getItem("scheduledMockDeviceId");
  if (!id) {
    id = `DEV-${randomChars(16)}`;
    localStorage.setItem("scheduledMockDeviceId", id);
  }
  return id;
}
function setAuthView(html) {
  $("authShell").innerHTML = html;
  $("authShell").classList.remove("hidden");
  $("studentShell").classList.add("hidden");
  $("adminShell").classList.add("hidden");
}

function renderStudentLogin(message = "", type = "") {
  const examId = getExamIdFromUrl();
  setAuthView(`
    <div class="auth-card">
      <div class="brand">
        <img src="scheduled-icon.jpeg" alt="Scheduled">
        <h1>Scheduled</h1>
        <p class="subtitle">Mock Exams</p>
        <p class="tag">Enter the details sent to you by your tutor.</p>
      </div>
      ${message ? `<div class="notice ${type}">${escapeHtml(message)}</div>` : ""}
      ${!examId ? `<div class="notice error">Please open the complete exam link sent to you on WhatsApp.</div>` : ""}
      <label>Full Name</label>
      <input id="studentName" autocomplete="name" placeholder="Your full name">
      <label>Phone Number</label>
      <div class="phone-wrap"><span>+</span><input id="studentPhone" inputmode="numeric" autocomplete="tel" placeholder="961XXXXXXXX"></div>
      <p class="muted tiny">Use the exact phone number registered by your tutor. It must start with 961.</p>
      <label>Individual Exam Password</label>
      <input id="studentPassword" type="password" autocomplete="current-password" placeholder="MHG-XXXXXXXX-XXXXXX">
      <button class="btn-block" ${examId ? "" : "disabled"} onclick="studentLogin()">Continue</button>
      <p class="muted tiny center">System v${APP_VERSION}</p><div class="login-switch"><button onclick="renderAdminLogin()">Admin access</button></div>
    </div>
  `);
}

function renderAdminLogin(message = "", type = "") {
  setAuthView(`
    <div class="auth-card">
      <div class="brand">
        <img src="scheduled-icon.jpeg" alt="Scheduled">
        <h1>Scheduled</h1>
        <p class="subtitle">Mock Exams — Admin</p>
        <p class="tag">Only the registered admin number can access this panel.</p>
      </div>
      ${message ? `<div class="notice ${type}">${escapeHtml(message)}</div>` : ""}
      <label>Admin Phone Number</label>
      <div class="phone-wrap"><span>+</span><input id="adminPhone" inputmode="numeric" autocomplete="tel" placeholder="961XXXXXXXX" value="${escapeHtml(ADMIN_PHONE)}"></div>
      <label>Admin Password</label>
      <input id="adminPassword" type="password" autocomplete="current-password" placeholder="Your admin password">
      <button class="btn-block" onclick="adminLogin()">Open Admin Panel</button>
      <p class="muted tiny center">On the first login, the password you enter becomes your admin password. Your admin number can log in repeatedly.</p>
      <p class="muted tiny center">System v${APP_VERSION}</p><div class="login-switch"><button onclick="renderStudentLogin()">← Student login</button></div>
    </div>
  `);
}

async function adminLogin() {
  authFlowBusy = true;
  const phone = strict961Phone($("adminPhone")?.value);
  const password = $("adminPassword")?.value || "";
  if (phone !== ADMIN_PHONE) { authFlowBusy = false; return renderAdminLogin("This phone number is not authorized for admin access.", "error"); }
  if (password.length < 6) { authFlowBusy = false; return renderAdminLogin("The admin password must contain at least 6 characters.", "error"); }
  const email = adminEmail(phone);
  try {
    const credential = await auth.signInWithEmailAndPassword(email, password);
    const adminSnap = await rootRef(`admins/${credential.user.uid}`).once("value");
    if (!adminSnap.exists() || adminSnap.val()?.phone !== ADMIN_PHONE) {
      await auth.signOut();
      authFlowBusy = false;
      return renderAdminLogin("This Firebase account is not registered as the Mock Exams admin.", "error");
    }
    authFlowBusy = false;
    await enterAdmin(credential.user);
  } catch (signInError) {
    try {
      const credential = await auth.createUserWithEmailAndPassword(email, password);
      await rootRef(`admins/${credential.user.uid}`).set({ phone, role: "admin", createdAt: firebase.database.ServerValue.TIMESTAMP });
      const settingsSnap = await rootRef("settings").once("value");
      if (!settingsSnap.exists()) {
        await rootRef("settings").set({ whatsapp: DEFAULT_WHATSAPP, defaultSubmissionMinutes: 5, createdAt: firebase.database.ServerValue.TIMESTAMP });
      }
      authFlowBusy = false;
      await enterAdmin(credential.user);
      showToast("Admin access created successfully.");
    } catch (createError) {
      const wrong = String(createError.code || "").includes("email-already-in-use") || String(signInError.code || "").includes("wrong-password") || String(signInError.code || "").includes("invalid-credential");
      authFlowBusy = false;
      renderAdminLogin(wrong ? "Incorrect admin password." : (createError.message || "Could not access the admin panel."), "error");
    }
  }
}

async function studentLogin() {
  authFlowBusy = true;
  const fullName = String($("studentName")?.value || "").trim();
  const phone = strict961Phone($("studentPhone")?.value);
  const password = String($("studentPassword")?.value || "").trim().toUpperCase();
  const examIdFromLink = getExamIdFromUrl();
  const accessId = parseAccessId(password);
  if (!fullName) { authFlowBusy = false; return renderStudentLogin("Please enter your full name.", "error"); }
  if (!phone) { authFlowBusy = false; return renderStudentLogin("Enter a valid phone number starting with 961.", "error"); }
  if (!accessId) { authFlowBusy = false; return renderStudentLogin("The individual exam password format is incorrect.", "error"); }
  try {
    const credential = await auth.signInWithEmailAndPassword(accessEmail(accessId), password);
    const accessSnap = await rootRef(`access/${accessId}`).once("value");
    const access = accessSnap.val();
    if (!access || access.uid !== credential.user.uid) throw new Error("This exam access is not valid.");
    if (access.phone !== phone) throw new Error("The phone number does not match this password.");
    if (examIdFromLink && access.examId !== examIdFromLink) throw new Error("This password belongs to a different mock exam.");
    if (!access.paid) throw new Error("Access is not active. Please contact your tutor.");
    if (access.allowed === false || access.status === "revoked") throw new Error("This exam access has been removed.");
    currentUser = credential.user;
    currentRole = "student";
    currentAccess = { id: accessId, ...access, enteredName: fullName };
    authFlowBusy = false;
    await enterStudent();
  } catch (error) {
    try { await auth.signOut(); } catch (_) {}
    authFlowBusy = false;
    renderStudentLogin(error.message && !String(error.code || "").startsWith("auth/") ? error.message : "The phone number or individual password is incorrect.", "error");
  }
}

async function enterAdmin(user) {
  currentUser = user;
  currentRole = "admin";
  $("authShell").classList.add("hidden");
  $("studentShell").classList.add("hidden");
  $("adminShell").classList.remove("hidden");
  startAdminDataListener();
}

async function enterStudent() {
  const settingsSnap = await rootRef("settings").once("value").catch(() => null);
  studentSettings = settingsSnap?.val() || {};
  $("authShell").classList.add("hidden");
  $("adminShell").classList.add("hidden");
  $("studentShell").classList.remove("hidden");
  const examSnap = await rootRef(`exams/${currentAccess.examId}`).once("value");
  currentExam = examSnap.val() ? { id: currentAccess.examId, ...examSnap.val() } : null;
  if (!currentExam) return studentErrorScreen("This mock exam no longer exists.");
  const attemptSnap = await rootRef(`attempts/${currentAccess.id}`).once("value");
  currentAttempt = attemptSnap.val() ? { id: currentAccess.id, ...attemptSnap.val() } : null;
  if (currentAttempt) {
    if (currentAttempt.deviceId && currentAttempt.deviceId !== getDeviceId()) {
      await auth.signOut();
      return renderStudentLogin("This exam has already been opened on another device.", "error");
    }
    startStudentWatchers();
    if (["finishedEarly", "timeEnded", "revoked"].includes(currentAttempt.status)) return renderFinishedScreen();
    if (currentAttempt.status === "active") return renderActiveExam();
    if (currentAttempt.status === "preparing") return renderStartConfirmation();
  }
  const availabilityError = getAvailabilityError(currentExam);
  if (availabilityError) return studentErrorScreen(availabilityError, true);
  renderStartConfirmation();
}

function getAvailabilityError(exam) {
  if (!exam) return "This mock exam is not available.";
  if (exam.status !== "active") return "This mock exam is currently hidden.";
  const t = now();
  if (exam.availableFrom && t < Number(exam.availableFrom)) return `This mock exam will be available from ${formatDateTime(exam.availableFrom)}.`;
  if (exam.availableUntil && t > Number(exam.availableUntil)) return `This mock exam is no longer available.`;
  if (!exam.hasPdf) return "The exam file has not been uploaded yet.";
  return "";
}

function studentErrorScreen(message, allowBack = false) {
  $("studentShell").innerHTML = `
    <div class="finish-card card">
      <div class="finish-icon">ℹ️</div>
      <h2>${escapeHtml(message)}</h2>
      <p class="muted">Please contact your tutor if you believe this is a mistake.</p>
      ${allowBack ? `<button class="ghost" onclick="studentLogout()">Back to Login</button>` : ""}
    </div>`;
}

function renderStartConfirmation() {
  const name = currentAccess.name || currentAccess.enteredName || "Student";
  const alreadyPreparing = currentAttempt?.status === "preparing";
  $("studentShell").innerHTML = `
    <div class="confirm-card card">
      <div class="brand">
        <img src="scheduled-icon.jpeg" alt="Scheduled">
        <h1>Scheduled</h1>
        <p class="subtitle">Mock Exams</p>
      </div>
      <p class="muted center">${escapeHtml(currentExam.title || "Mock Exam")}</p>
      <h2 class="good-luck center">Good luck, ${escapeHtml(name)}!</h2>
      <div class="center"><div class="duration-hero">${escapeHtml(durationLabel(currentExam.durationMinutes || 80))}</div></div>
      <p class="center"><strong>Your timer starts only when the fully prepared exam is shown.</strong></p>
      ${currentExam.instructions ? `<div class="notice"><strong>Instructions:</strong><br>${escapeHtml(currentExam.instructions).replace(/\n/g,"<br>")}</div>` : ""}
      <div class="rules">
        <div class="rule"><span>⏱️</span><div><b>The timer cannot be paused or restarted.</b><div class="muted small">Refreshing the page will not reset your time.</div></div></div>
        <div class="rule"><span>📱</span><div><b>Use one device only.</b><div class="muted small">The password becomes unusable after the exam begins.</div></div></div>
        <div class="rule"><span>📝</span><div><b>Solve on paper.</b><div class="muted small">Prepare blank paper and any permitted calculator before starting.</div></div></div>
        <div class="rule"><span>💬</span><div><b>Send your answer photos on WhatsApp.</b><div class="muted small">A five-minute submission countdown starts when the exam ends.</div></div></div>
      </div>
      <div id="examPreparationStatus" class="notice"><strong>Preparing your exam…</strong><br><span id="examPreparationText">Loading the secure exam pages before your timer begins.</span></div>
      <button id="startExamButton" class="btn-block" onclick="startExamNow()" disabled>${alreadyPreparing ? "Continue Preparing…" : "Preparing Exam…"}</button>
      <button class="btn-block ghost" onclick="studentLogout()">Return to Login</button>
    </div>`;
  prepareExamForStart();
}

async function prepareExamForStart(force = false) {
  if (!currentExam?.id) return false;
  if (!force && preparedExamPdf?.examId === currentExam.id && preparedExamPdf.pages?.length) {
    markExamPrepared();
    return true;
  }
  if (!force && examPreparePromise) return examPreparePromise;
  const status = $("examPreparationStatus");
  const text = $("examPreparationText");
  const button = $("startExamButton");
  if (status) status.className = "notice";
  if (text) text.textContent = "Loading the secure exam pages before your timer begins.";
  if (button) { button.disabled = true; button.textContent = "Preparing Exam…"; }

  examPreparePromise = (async () => {
    try {
      const bytes = await loadExamPdfBytes(currentExam.id);
      const prepared = await renderPdfPagesToMemory(bytes, (page, total) => {
        const progressText = $("examPreparationText");
        if (progressText) progressText.textContent = `Preparing page ${page} of ${total}…`;
      });
      preparedExamPdf = { examId: currentExam.id, ...prepared };
      markExamPrepared();
      return true;
    } catch (error) {
      preparedExamPdf = null;
      const statusNow = $("examPreparationStatus");
      const textNow = $("examPreparationText");
      const buttonNow = $("startExamButton");
      if (statusNow) statusNow.className = "notice error";
      if (textNow) textNow.textContent = error.message || "The exam could not be prepared.";
      if (buttonNow) {
        buttonNow.disabled = false;
        buttonNow.textContent = "Retry Preparing Exam";
        buttonNow.onclick = () => prepareExamForStart(true);
      }
      return false;
    } finally {
      examPreparePromise = null;
    }
  })();
  return examPreparePromise;
}

function markExamPrepared() {
  const status = $("examPreparationStatus");
  const text = $("examPreparationText");
  const button = $("startExamButton");
  if (status) status.className = "notice success";
  if (text) text.textContent = "All exam pages are ready. Your timer has not started.";
  if (button) {
    button.disabled = false;
    button.textContent = "Start Now";
    button.onclick = startExamNow;
  }
}

async function renderPdfPagesToMemory(bytes, onProgress) {
  const loadingTask = pdfjsLib.getDocument({ data: bytes, disableAutoFetch: false, disableStream: false });
  const pdf = await loadingTask.promise;
  const pages = [];
  const availableCssWidth = Math.min(1050, Math.max(280, window.innerWidth - 38));
  const pixelRatio = Math.min(2.25, Math.max(1, window.devicePixelRatio || 1));
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = availableCssWidth / baseViewport.width;
    const cssViewport = page.getViewport({ scale: cssScale });
    const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    canvas.dataset.cssWidth = String(cssViewport.width);
    canvas.dataset.cssHeight = String(cssViewport.height);
    await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: renderViewport }).promise;
    pages.push({ pageNumber, canvas, cssWidth: cssViewport.width, cssHeight: cssViewport.height });
    onProgress?.(pageNumber, pdf.numPages);
  }
  return { pages, numPages: pdf.numPages };
}
async function startExamNow() {
  if (examStartBusy) return;
  if (!(preparedExamPdf?.examId === currentExam?.id && preparedExamPdf.pages?.length)) {
    const ready = await prepareExamForStart();
    if (!ready) return;
  }

  examStartBusy = true;
  const startButton = $("startExamButton");
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = "Opening Prepared Exam…";
  }

  const releaseStartButton = () => {
    examStartBusy = false;
    const button = $("startExamButton");
    if (button) {
      button.disabled = false;
      button.textContent = "Start Now";
    }
  };

  const availabilityError = getAvailabilityError(currentExam);
  if (availabilityError) {
    releaseStartButton();
    return studentErrorScreen(availabilityError, true);
  }

  const deviceId = getDeviceId();
  const durationMinutes = Number(currentExam.durationMinutes || 80);
  const accessRef = rootRef(`access/${currentAccess.id}`);
  const attemptRef = rootRef(`attempts/${currentAccess.id}`);

  try {
    const freshAccessSnap = await accessRef.once("value");
    const freshAccess = freshAccessSnap.val();
    if (!freshAccess || freshAccess.uid !== currentUser.uid) throw new Error("This exam access is not valid.");
    if (!freshAccess.paid) throw new Error("Access is not active. Please contact your tutor.");
    if (freshAccess.allowed === false || freshAccess.status === "revoked") throw new Error("This exam access has been removed.");

    const preparingAttempt = {
      accessId: currentAccess.id,
      examId: currentExam.id,
      examTitle: currentExam.title || "Mock Exam",
      examCode: currentExam.examCode || currentExam.id.slice(-6).toUpperCase(),
      uid: currentUser.uid,
      phone: currentAccess.phone,
      name: currentAccess.name || currentAccess.enteredName || "Student",
      enteredName: currentAccess.enteredName || "",
      deviceId,
      durationMinutesSnapshot: durationMinutes,
      status: "preparing",
      preparedAt: now(),
      tabSwitches: 0,
      lastSeenAt: now(),
      startLogicVersion: 4
    };

    const attemptResult = await attemptRef.transaction((existing) => {
      if (existing === null) return preparingAttempt;
      return existing;
    }, undefined, false);

    const savedAttempt = attemptResult.snapshot.val();
    if (!savedAttempt) throw new Error("The exam could not be started. Please try again.");
    if (savedAttempt.uid && savedAttempt.uid !== currentUser.uid) throw new Error("This exam access is not valid.");
    if (savedAttempt.deviceId && savedAttempt.deviceId !== deviceId) throw new Error("This exam has already been opened on another device.");

    currentAttempt = { id: currentAccess.id, ...savedAttempt };
    if (["finishedEarly", "timeEnded", "revoked"].includes(savedAttempt.status)) {
      startStudentWatchers();
      examStartBusy = false;
      return renderFinishedScreen();
    }
    if (savedAttempt.status === "active") {
      startStudentWatchers();
      examStartBusy = false;
      return renderActiveExam();
    }

    await accessRef.update({ status: "preparing", deviceId, startLogicVersion: 4 });

    // Place every already-rendered page on screen behind a short start cover.
    // No official exam time is consumed during PDF loading or Firebase setup.
    await renderActiveExam({ preparing: true });

    const startedAt = now();
    const activeFields = {
      status: "active",
      startedAt,
      endsAt: startedAt + durationMinutes * 60000,
      durationMinutesSnapshot: durationMinutes,
      activatedAt: startedAt,
      lastSeenAt: startedAt,
      startLogicVersion: 4
    };
    currentAttempt = { ...currentAttempt, ...activeFields };

    // Reveal the fully loaded pages and start the visible timer immediately.
    // Firebase persistence follows the same official timestamp.
    updateExamWatermarks();
    $("examStartOverlay")?.remove();
    startExamTimer();
    examStartBusy = false;

    const activationWrite = attemptRef.update(activeFields);
    const accessWrite = accessRef.update({
      usedAt: startedAt,
      status: "active",
      deviceId,
      startLogicVersion: 4,
      lastStartConfirmedAt: startedAt
    });

    try { await document.documentElement.requestFullscreen?.(); } catch (_) {}

    await Promise.all([activationWrite, accessWrite]);
    startStudentWatchers(true);

    if (!freshAccess.passwordConsumed) {
      currentUser.updatePassword(randomPassword()).then(() =>
        accessRef.update({ passwordConsumed: true, passwordConsumedAt: now(), passwordRotationError: null })
      ).catch((passwordError) => {
        console.warn("One-time password rotation failed:", passwordError);
        accessRef.update({ passwordConsumed: false, passwordRotationError: String(passwordError.code || passwordError.message || "unknown") }).catch(() => {});
      });
    }
  } catch (error) {
    releaseStartButton();
    studentErrorScreen(error.message || "The exam could not be started.", true);
  }
}
function startStudentWatchers(preserveTimers = false) {
  if (accessWatchRef) accessWatchRef.off();
  if (attemptWatchRef) attemptWatchRef.off();
  accessWatchRef = null;
  attemptWatchRef = null;
  if (!preserveTimers) { clearInterval(timerHandle); clearInterval(submissionHandle); }
  accessWatchRef = rootRef(`access/${currentAccess.id}`);
  accessWatchRef.on("value", (snap) => {
    const value = snap.val();
    if (!value || value.allowed === false || value.paid === false || value.status === "revoked") {
      if (currentAttempt?.status === "active") finishAttempt("revoked", true);
    }
  });
  attemptWatchRef = rootRef(`attempts/${currentAccess.id}`);
  attemptWatchRef.on("value", (snap) => {
    const value = snap.val();
    if (!value) return;
    const previousStatus = currentAttempt?.status;
    currentAttempt = { id: currentAccess.id, ...value };
    if (previousStatus === "active" && currentAttempt.status !== "active") renderFinishedScreen();
  });
}
function stopStudentWatchers() {
  if (accessWatchRef) accessWatchRef.off();
  if (attemptWatchRef) attemptWatchRef.off();
  accessWatchRef = null;
  attemptWatchRef = null;
  clearInterval(timerHandle); clearInterval(submissionHandle);
}

async function renderActiveExam(options = {}) {
  const preparing = Boolean(options.preparing);
  if (!currentAttempt || (!preparing && currentAttempt.status !== "active")) return renderFinishedScreen();
  $("studentShell").innerHTML = `
    <div class="student-header">
      <div class="top-brand"><img src="scheduled-icon.jpeg" alt="Scheduled"><div><h1>Scheduled</h1><p>Mock Exams</p></div></div>
      <button class="ghost small-btn" onclick="confirmFinishEarly()" ${preparing ? "disabled" : ""}>Finish Exam</button>
    </div>
    <div class="student-content">
      <div class="exam-sticky">
        <div><h2>${escapeHtml(currentExam.title || "Mock Exam")}</h2><div class="muted">${escapeHtml(currentAttempt.name)} • ${escapeHtml(currentAttempt.examCode || "")}</div></div>
        <div id="mainTimer" class="timer"><span>Time Remaining</span><strong>${preparing ? durationLabelClock(currentExam.durationMinutes || 80) : "--:--"}</strong></div>
      </div>
      <div id="examNotice" class="notice">${preparing ? "Your exam is fully prepared. Starting securely…" : "Loading your personalized exam…"}</div>
      <div id="examPages" class="exam-pages"></div>
      <div class="card center"><p><strong>Finished before the timer?</strong></p><p class="muted small">Pressing Finish Exam permanently hides the questions and starts the WhatsApp submission countdown.</p><button class="danger" onclick="confirmFinishEarly()" ${preparing ? "disabled" : ""}>Finish Exam</button></div>
    </div>
    ${preparing ? `<div id="examStartOverlay" class="exam-start-overlay"><div class="exam-start-overlay-card"><div class="mini-loader"></div><strong>Opening your prepared exam…</strong><span>Your timer has not started yet.</span></div></div>` : ""}`;
  await renderExamPdf();
  if (!preparing) startExamTimer();
}

function durationLabelClock(minutes) {
  const totalSeconds = Math.max(0, Math.round(Number(minutes || 0) * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return h > 0 ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function startExamTimer() {
  clearInterval(timerHandle);
  const tick = async () => {
    if (!currentAttempt || currentAttempt.status !== "active") return;
    const remaining = Number(currentAttempt.endsAt) - now();
    const timer = $("mainTimer");
    if (timer) {
      timer.querySelector("strong").textContent = countdownLabel(remaining);
      timer.classList.toggle("urgent", remaining <= 5 * 60000);
    }
    if (now() - lastSeenWriteAt > 30000) { lastSeenWriteAt = now(); rootRef(`attempts/${currentAccess.id}/lastSeenAt`).set(now()).catch(() => {}); }
    if (remaining <= 0) {
      clearInterval(timerHandle);
      await finishAttempt("timeEnded");
    }
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}

async function loadExamPdfBytes(examId) {
  const metaSnap = await rootRef(`files/${examId}/meta`).once("value");
  const meta = metaSnap.val();
  if (!meta?.chunksCount) throw new Error("The exam PDF is missing.");
  const chunksSnap = await rootRef(`files/${examId}/chunks`).once("value");
  const raw = chunksSnap.val() || {};
  const chunks = [];
  for (let i = 0; i < Number(meta.chunksCount); i++) {
    if (typeof raw[i] !== "string") throw new Error("The exam PDF is incomplete.");
    chunks.push(raw[i]);
  }
  return base64ToUint8Array(chunks.join(""));
}

function makeExamPageWrap(pageData, totalPages) {
  const wrap = document.createElement("div");
  wrap.className = "pdf-page-wrap";
  wrap.style.setProperty("--page-width", `${pageData.cssWidth}px`);
  wrap.style.setProperty("--page-ratio", String(pageData.cssWidth / pageData.cssHeight));
  wrap.oncontextmenu = (e) => e.preventDefault();
  const canvas = pageData.canvas;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const overlay = document.createElement("div");
  overlay.className = "watermark-layer";
  overlay.dataset.pageNumber = String(pageData.pageNumber);
  overlay.dataset.totalPages = String(totalPages);
  wrap.append(canvas, overlay);
  return wrap;
}

function updateExamWatermarks() {
  const wm = `${currentAttempt?.name || "Student"} • +${currentAttempt?.phone || ""} • ${currentAttempt?.examCode || ""} • ${formatDateTime(currentAttempt?.startedAt)}`;
  document.querySelectorAll(".watermark-layer").forEach((overlay) => {
    const pageNumber = overlay.dataset.pageNumber || "";
    const totalPages = overlay.dataset.totalPages || "";
    overlay.innerHTML = `<div class="watermark-text">${escapeHtml(wm)}<br>${escapeHtml(wm)}</div><div class="page-footer"><span>CONFIDENTIAL • SCHEDULED MOCK EXAMS</span><span>Page ${pageNumber}/${totalPages}</span></div>`;
  });
}

async function renderExamPdf() {
  const token = ++pdfRenderToken;
  try {
    let prepared = preparedExamPdf?.examId === currentExam.id ? preparedExamPdf : null;
    if (!prepared?.pages?.length) {
      const bytes = await loadExamPdfBytes(currentExam.id);
      if (token !== pdfRenderToken) return;
      prepared = { examId: currentExam.id, ...(await renderPdfPagesToMemory(bytes)) };
      preparedExamPdf = prepared;
    }
    if (token !== pdfRenderToken) return;
    const container = $("examPages");
    if (!container) return;
    container.innerHTML = "";
    prepared.pages.forEach((pageData) => container.appendChild(makeExamPageWrap(pageData, prepared.numPages)));
    updateExamWatermarks();
    $("examNotice")?.classList.add("hidden");
  } catch (error) {
    const notice = $("examNotice");
    if (notice) {
      notice.className = "notice error";
      notice.textContent = error.message || "Could not load the exam PDF.";
    }
    throw error;
  }
}
function confirmFinishEarly() {
  showModal(`
    <h2>Finish your exam?</h2>
    <p>Once you finish, the questions will disappear and cannot be reopened.</p>
    <p class="muted">The same five-minute WhatsApp submission countdown will begin immediately.</p>
    <div class="modal-actions"><button class="ghost" onclick="closeModal()">Continue Exam</button><button class="danger" onclick="closeModal();finishAttempt('finishedEarly')">Finish Exam</button></div>
  `);
}

async function finishAttempt(status, silent = false) {
  if (!currentAttempt || currentAttempt.status !== "active") return renderFinishedScreen();
  const finishedAt = now();
  const submissionMinutes = Number(currentExam.submissionMinutes || adminData.settings?.defaultSubmissionMinutes || 5);
  const submissionEndsAt = finishedAt + submissionMinutes * 60000;
  const attemptRef = rootRef(`attempts/${currentAccess.id}`);
  const result = await attemptRef.transaction((attempt) => {
    if (!attempt || attempt.status !== "active") return attempt;
    attempt.status = status;
    attempt.finishedAt = finishedAt;
    attempt.submissionEndsAt = submissionEndsAt;
    return attempt;
  });
  if (result.snapshot?.val()) currentAttempt = { id: currentAccess.id, ...result.snapshot.val() };
  await rootRef(`access/${currentAccess.id}`).update({ status, finishedAt });
  clearInterval(timerHandle);
  pdfRenderToken++;
  const examArea = document.querySelector(".student-content");
  if (examArea) examArea.classList.add("exam-locked");
  if (!silent) showToast(status === "finishedEarly" ? "Exam finished." : "Time is up.");
  if (examArea) await new Promise((resolve) => setTimeout(resolve, 350));
  renderFinishedScreen();
}

function renderFinishedScreen() {
  clearInterval(timerHandle); clearInterval(submissionHandle);
  const revoked = currentAttempt?.status === "revoked";
  const title = revoked ? "Exam access ended" : "The exam has ended.";
  const message = revoked ? "Please contact your tutor." : "Please send clear photos of your answer sheets on WhatsApp.";
  $("studentShell").innerHTML = `
    <div class="finish-card card">
      <div class="brand"><img src="scheduled-icon.jpeg" alt="Scheduled"><h1>Scheduled</h1><p class="subtitle">Mock Exams</p></div>
      <div class="finish-icon">${revoked ? "🔒" : "✓"}</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(message)}</p>
      ${!revoked ? `<div class="submission-label">WhatsApp submission time remaining</div><div id="submissionTimer" class="submission-count">05:00</div><button class="btn-block whatsapp" onclick="sendAnswersWhatsApp()">Send Answers on WhatsApp</button>` : ""}
      <div class="notice"><strong>${escapeHtml(currentExam?.title || currentAttempt?.examTitle || "Mock Exam")}</strong><br>${escapeHtml(currentAttempt?.name || "")} • ${escapeHtml(currentAttempt?.examCode || "")}</div>
      <button class="btn-block ghost" onclick="studentLogout()">Close</button>
    </div>`;
  if (!revoked) startSubmissionTimer();
}

function startSubmissionTimer() {
  clearInterval(submissionHandle);
  const tick = () => {
    const remaining = Number(currentAttempt?.submissionEndsAt || 0) - now();
    const el = $("submissionTimer");
    if (el) el.textContent = countdownLabel(remaining);
    if (remaining <= 0) clearInterval(submissionHandle);
  };
  tick(); submissionHandle = setInterval(tick, 1000);
}
function sendAnswersWhatsApp() {
  const settingsWa = studentSettings.whatsapp || currentExam?.whatsapp || DEFAULT_WHATSAPP;
  const examName = currentExam?.title || currentAttempt?.examTitle || "Mock Exam";
  const studentName = currentAttempt?.name || currentAccess?.name || currentAccess?.enteredName || "";
  const message = `Hello, I just took the exam.\n\nStudent name: ${studentName}\nExam: ${examName}\nStart time: ${formatDateTime(currentAttempt?.startedAt)}\nFinish time: ${formatDateTime(currentAttempt?.finishedAt)}\n\nI will send my answer sheets now.`;
  openWhatsApp(settingsWa, message);
}
async function studentLogout() {
  stopStudentWatchers();
  currentRole = null; currentUser = null; currentAccess = null; currentExam = null; currentAttempt = null; preparedExamPdf = null; examPreparePromise = null;
  try { await auth.signOut(); } catch (_) {}
  renderStudentLogin();
}

/* ---------------- ADMIN ---------------- */
function startAdminDataListener() {
  if (adminDataRef) adminDataRef.off();
  adminDataRef = rootRef();
  adminDataRef.on("value", (snap) => {
    const value = snap.val() || {};
    adminData = {
      exams: value.exams || {},
      students: value.students || {},
      enrollments: value.enrollments || {},
      access: value.access || {},
      attempts: value.attempts || {},
      settings: value.settings || {}
    };
    if (!adminExamFilter) adminExamFilter = Object.keys(adminData.exams)[0] || "";
    renderAdmin();
  }, (error) => {
    $("adminShell").innerHTML = `<div class="auth-card"><h2>Could not load Mock Exams data</h2><p class="muted">${escapeHtml(error.message)}</p><button onclick="location.reload()">Reload</button></div>`;
  });
}
function stopAdminDataListener() { if (adminDataRef) adminDataRef.off(); adminDataRef = null; }
function renderAdmin() {
  const tabs = [
    ["overview", "Overview"], ["exams", "Exams"], ["students", "Students & Access"], ["attempts", "Attempts"], ["settings", "Settings"]
  ];
  $("adminShell").innerHTML = `
    <header class="topbar">
      <div class="top-brand"><img src="scheduled-icon.jpeg" alt="Scheduled"><div><h1>Scheduled</h1><p>Mock Exams • Admin</p></div></div>
      <div class="top-actions"><button class="ghost small-btn" onclick="adminLogout()">Logout</button></div>
    </header>
    <nav class="tabs">${tabs.map(([id, label]) => `<button class="${adminTab === id ? "active" : ""}" onclick="setAdminTab('${id}')">${label}</button>`).join("")}</nav>
    <main id="adminContent" class="content"></main>`;
  if (adminTab === "overview") renderAdminOverview();
  else if (adminTab === "exams") renderAdminExams();
  else if (adminTab === "students") renderAdminStudents();
  else if (adminTab === "attempts") renderAdminAttempts();
  else renderAdminSettings();
}
function setAdminTab(tab) { adminTab = tab; renderAdmin(); }
function examEntries() { return Object.entries(adminData.exams || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)); }
function attemptEntries() { return Object.entries(adminData.attempts || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0)); }
function studentEntries() { return Object.entries(adminData.students || {}).map(([phone, value]) => ({ phone, ...value })).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))); }
function enrollmentFor(examId, phone) { return adminData.enrollments?.[examId]?.[phone] || {}; }
function selectedExam() { return adminData.exams?.[adminExamFilter] ? { id: adminExamFilter, ...adminData.exams[adminExamFilter] } : null; }
function examStatus(exam) {
  if (exam.status !== "active") return ["Hidden", "blocked"];
  const t = now();
  if (exam.availableFrom && t < Number(exam.availableFrom)) return ["Upcoming", "upcoming"];
  if (exam.availableUntil && t > Number(exam.availableUntil)) return ["Closed", "expired"];
  return ["Active", "active"];
}
function renderAdminOverview() {
  const exams = examEntries();
  const attempts = attemptEntries();
  const active = attempts.filter((a) => a.status === "active").length;
  const completed = attempts.filter((a) => ["finishedEarly", "timeEnded"].includes(a.status)).length;
  const paid = Object.values(adminData.enrollments || {}).reduce((sum, group) => sum + Object.values(group || {}).filter((e) => e.paid).length, 0);
  $("adminContent").innerHTML = `
    <div class="grid">
      <div class="metric"><div class="number">${exams.length}</div><div class="label">Mock Exams</div></div>
      <div class="metric"><div class="number">${studentEntries().length}</div><div class="label">Students</div></div>
      <div class="metric"><div class="number">${paid}</div><div class="label">Paid Exam Accesses</div></div>
      <div class="metric"><div class="number">${active}</div><div class="label">Taking an Exam Now</div></div>
      <div class="metric"><div class="number">${completed}</div><div class="label">Completed Attempts</div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Recent Attempts</h2><p class="muted">Live activity from your students.</p></div><button onclick="setAdminTab('attempts')">View All</button></div>
      ${attemptTable(attempts.slice(0, 8), false)}
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Exams</h2><p class="muted">Create a new exam or copy an existing student link.</p></div><button onclick="openExamEditor()">Create Exam</button></div>
      ${exams.length ? `<div class="exam-list">${exams.slice(0, 5).map(examItemHtml).join("")}</div>` : `<div class="empty">No mock exams yet.</div>`}
    </div>`;
}
function examItemHtml(exam) {
  const [text, cls] = examStatus(exam);
  return `<div class="exam-item"><div><h3>${escapeHtml(exam.title || "Untitled Exam")}</h3><p class="muted small">${escapeHtml(exam.course || "")} ${exam.examCode ? `• ${escapeHtml(exam.examCode)}` : ""}</p><div class="exam-meta">${badge(text, cls)}${badge(durationLabel(exam.durationMinutes || 80), "neutral")}${exam.hasPdf ? badge("PDF ready", "paid") : badge("PDF missing", "unpaid")}</div></div><div class="exam-actions"><button class="small-btn ghost" onclick="copyText('${escapeHtml(examLink(exam.id))}','Exam link copied')">Copy Link</button><button class="small-btn" onclick="openExamEditor('${exam.id}')">Edit</button></div></div>`;
}
function renderAdminExams() {
  const exams = examEntries();
  $("adminContent").innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Mock Exams</h2><p class="muted">Each exam has its own link, PDF, duration, availability period, students and attempts.</p></div><button onclick="openExamEditor()">Create Exam</button></div>
      ${exams.length ? `<div class="exam-list">${exams.map(examItemHtml).join("")}</div>` : `<div class="empty">Create your first mock exam.</div>`}
    </div>`;
}
function openExamEditor(examId = "") {
  const exam = examId ? adminData.exams?.[examId] || {} : {};
  showModal(`
    <h2>${examId ? "Edit Mock Exam" : "Create Mock Exam"}</h2>
    <div class="row"><div><label>Exam Title</label><input id="editExamTitle" value="${escapeHtml(exam.title || "")}" placeholder="PHYS213 Exam 2 Mock"></div><div><label>Course</label><input id="editExamCourse" value="${escapeHtml(exam.course || "")}" placeholder="PHYS213"></div></div>
    <div class="row"><div><label>Exam Code</label><input id="editExamCode" value="${escapeHtml(exam.examCode || "")}" placeholder="PHYS213-E2"></div><div><label>Duration (minutes)</label><input id="editExamDuration" type="number" min="1" max="600" value="${Number(exam.durationMinutes || 80)}"></div></div>
    <div class="row"><div><label>Available From</label><input id="editExamFrom" type="datetime-local" value="${toDateTimeLocal(exam.availableFrom)}"></div><div><label>Available Until</label><input id="editExamUntil" type="datetime-local" value="${toDateTimeLocal(exam.availableUntil)}"></div></div>
    <div class="row"><div><label>WhatsApp Submission Countdown (minutes)</label><input id="editExamSubmission" type="number" min="1" max="30" value="${Number(exam.submissionMinutes || adminData.settings.defaultSubmissionMinutes || 5)}"></div><div><label>Exam Status</label><select id="editExamStatus"><option value="active" ${!examId || exam.status === "active" ? "selected" : ""}>Active</option><option value="hidden" ${examId && exam.status !== "active" ? "selected" : ""}>Hidden</option></select></div></div>
    <label>Instructions (optional)</label><textarea id="editExamInstructions" placeholder="Calculator allowed, use blank paper…">${escapeHtml(exam.instructions || "")}</textarea>
    <div class="file-box"><label>Exam PDF ${exam.hasPdf ? "— current PDF is ready" : ""}</label><input id="editExamPdf" type="file" accept="application/pdf"><p class="muted tiny">Maximum 15 MB. The PDF is stored inside the same Firebase database used by Scheduled and rendered as protected canvas pages.</p><div id="pdfProgress" class="progress hidden"><span></span></div></div>
    <div class="modal-actions"><button class="ghost" onclick="closeModal()">Cancel</button>${examId ? `<button class="danger" onclick="deleteExam('${examId}')">Delete</button>` : ""}<button onclick="saveExam('${examId}')">Save Exam</button></div>
  `);
}
async function saveExam(examId = "") {
  const title = $("editExamTitle").value.trim();
  const durationMinutes = Number($("editExamDuration").value || 0);
  const fromRaw = $("editExamFrom").value;
  const untilRaw = $("editExamUntil").value;
  if (!title) return showToast("Enter an exam title.");
  if (!durationMinutes || durationMinutes < 1) return showToast("Enter a valid duration.");
  const availableFrom = fromRaw ? new Date(fromRaw).getTime() : null;
  const availableUntil = untilRaw ? new Date(untilRaw).getTime() : null;
  if (availableFrom && availableUntil && availableUntil <= availableFrom) return showToast("Available Until must be after Available From.");
  const id = examId || rootRef("exams").push().key;
  const old = adminData.exams?.[id] || {};
  const record = {
    title,
    course: $("editExamCourse").value.trim(),
    examCode: $("editExamCode").value.trim() || `EXAM-${id.slice(-5).toUpperCase()}`,
    durationMinutes,
    availableFrom,
    availableUntil,
    submissionMinutes: Number($("editExamSubmission").value || 5),
    status: $("editExamStatus").value,
    instructions: $("editExamInstructions").value.trim(),
    hasPdf: !!old.hasPdf,
    createdAt: old.createdAt || now(),
    updatedAt: now()
  };
  await rootRef(`exams/${id}`).set(record);
  const file = $("editExamPdf").files?.[0];
  if (file) await uploadExamPdf(id, file);
  closeModal();
  adminExamFilter = id;
  showToast("Mock exam saved.");
}
async function uploadExamPdf(examId, file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Please select a PDF file.");
  if (file.size > MAX_PDF_BYTES) throw new Error("The PDF is larger than 15 MB.");
  const progress = $("pdfProgress"); if (progress) progress.classList.remove("hidden");
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  const chunks = [];
  for (let i = 0; i < base64.length; i += FILE_CHUNK_CHARS) chunks.push(base64.slice(i, i + FILE_CHUNK_CHARS));
  await rootRef(`files/${examId}`).remove();
  for (let i = 0; i < chunks.length; i++) {
    await rootRef(`files/${examId}/chunks/${i}`).set(chunks[i]);
    if (progress) progress.querySelector("span").style.width = `${Math.round(((i + 1) / chunks.length) * 100)}%`;
  }
  await rootRef(`files/${examId}/meta`).set({ fileName: file.name, size: file.size, chunksCount: chunks.length, uploadedAt: now() });
  await rootRef(`exams/${examId}`).update({ hasPdf: true, pdfFileName: file.name, pdfSize: file.size, updatedAt: now() });
}
async function deleteExam(examId) {
  if (!confirm("Delete this mock exam, its PDF, student access records, and attempts?")) return;
  const enrollments = adminData.enrollments?.[examId] || {};
  const updates = {};
  Object.values(enrollments).forEach((enrollment) => { if (enrollment.activeAccessId) updates[`access/${enrollment.activeAccessId}/allowed`] = false; });
  updates[`exams/${examId}`] = null; updates[`files/${examId}`] = null; updates[`enrollments/${examId}`] = null;
  Object.entries(adminData.attempts || {}).forEach(([id, attempt]) => { if (attempt.examId === examId) updates[`attempts/${id}`] = null; });
  await rootRef().update(updates);
  closeModal();
  if (adminExamFilter === examId) adminExamFilter = Object.keys(adminData.exams).find((id) => id !== examId) || "";
  showToast("Mock exam deleted.");
}

function examSelector(onchange = "changeAdminExamFilter(this.value)") {
  const exams = examEntries();
  return `<select onchange="${onchange}">${exams.map((e) => `<option value="${e.id}" ${e.id === adminExamFilter ? "selected" : ""}>${escapeHtml(e.title)}</option>`).join("")}</select>`;
}
function changeAdminExamFilter(value) { adminExamFilter = value; renderAdmin(); }
function renderAdminStudents() {
  const exam = selectedExam();
  if (!exam) {
    $("adminContent").innerHTML = `<div class="card"><h2>Students & Access</h2><div class="empty">Create a mock exam first.</div></div>`;
    return;
  }
  const students = studentEntries().filter((student) => !!adminData.enrollments?.[exam.id]?.[student.phone]);
  $("adminContent").innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Students & Access</h2><p class="muted">Access is based on the registered number and individual password—not the name typed at login.</p></div><div style="min-width:260px">${examSelector()}</div></div>
      <div class="row"><input id="newStudentName" placeholder="Student full name"><div class="phone-wrap"><span>+</span><input id="newStudentPhone" inputmode="numeric" placeholder="961XXXXXXXX"></div><button onclick="addStudentToExam()">Add Student</button></div>
      <hr class="divider">
      ${students.length ? studentAccessTable(exam.id, students) : `<div class="empty">No students have been added yet.</div>`}
    </div>`;
}
function studentAccessTable(examId, students) {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Phone</th><th>Payment</th><th>Access</th><th>Individual Password</th><th>Attempt</th><th>Actions</th></tr></thead><tbody>${students.map((student) => {
    const e = enrollmentFor(examId, student.phone);
    const access = e.activeAccessId ? adminData.access?.[e.activeAccessId] || {} : {};
    const attempt = e.activeAccessId ? adminData.attempts?.[e.activeAccessId] || {} : {};
    const paid = !!e.paid, allowed = e.allowed !== false;
    return `<tr><td><strong>${escapeHtml(student.name || "")}</strong></td><td>+${escapeHtml(student.phone)}</td><td>${paid ? badge("Paid", "paid") : badge("Unpaid", "unpaid")}</td><td>${allowed ? badge("Allowed", "active") : badge("Blocked", "blocked")}</td><td>${e.loginPassword ? `<div class="code-box">${escapeHtml(e.loginPassword)}</div>` : `<span class="muted">Not generated</span>`}</td><td>${attempt.status ? attemptStatusBadge(attempt.status) : (access.usedAt ? badge("Used", "neutral") : badge("Not started", "neutral"))}</td><td><div class="table-actions"><button class="small-btn ${paid ? "warning" : "success"}" onclick="togglePaid('${examId}','${student.phone}')">${paid ? "Mark Unpaid" : "Mark Paid"}</button><button class="small-btn ghost" onclick="toggleStudentAllowed('${examId}','${student.phone}')">${allowed ? "Block" : "Allow"}</button><button class="small-btn" ${paid && allowed ? "" : "disabled"} onclick="generateStudentLogin('${examId}','${student.phone}')">Generate Password</button><button class="small-btn whatsapp" ${e.loginPassword && paid && allowed ? "" : "disabled"} onclick="sendStudentLoginWhatsApp('${examId}','${student.phone}')">WhatsApp</button><button class="small-btn danger" onclick="removeStudentFromExam('${examId}','${student.phone}')">Remove</button></div></td></tr>`;
  }).join("")}</tbody></table></div>`;
}
async function addStudentToExam() {
  const exam = selectedExam(); if (!exam) return;
  const name = $("newStudentName").value.trim();
  const phone = strict961Phone($("newStudentPhone").value);
  if (!name || !phone) return showToast("Enter the student's full name and a valid 961 phone number.");

  // Always create a clean enrollment. Never spread an old cached enrollment,
  // because that could restore a removed password or old access ID.
  const existingStudentSnap = await rootRef(`students/${phone}`).once("value");
  const existingStudent = existingStudentSnap.val() || {};
  await rootRef().update({
    [`students/${phone}`]: { name, phone, updatedAt: now(), createdAt: existingStudent.createdAt || now() },
    [`enrollments/${exam.id}/${phone}`]: {
      name,
      phone,
      paid: false,
      allowed: true,
      status: "notGenerated",
      addedAt: now(),
      updatedAt: now()
    }
  });
  showToast("Student added with clean access. Mark them Paid to generate a new password.");
}
async function togglePaid(examId, phone) {
  const e = enrollmentFor(examId, phone);
  const paid = !e.paid;
  const updates = { [`enrollments/${examId}/${phone}/paid`]: paid, [`enrollments/${examId}/${phone}/updatedAt`]: now() };
  if (e.activeAccessId) updates[`access/${e.activeAccessId}/paid`] = paid;
  await rootRef().update(updates);
  showToast(paid ? "Student marked as paid." : "Student marked as unpaid. Access is paused.");
}
async function toggleStudentAllowed(examId, phone) {
  const e = enrollmentFor(examId, phone);
  const allowed = e.allowed === false;
  const updates = { [`enrollments/${examId}/${phone}/allowed`]: allowed, [`enrollments/${examId}/${phone}/updatedAt`]: now() };
  if (e.activeAccessId) updates[`access/${e.activeAccessId}/allowed`] = allowed;
  await rootRef().update(updates);
  showToast(allowed ? "Student access allowed." : "Student access blocked.");
}
async function generateStudentLogin(examId, phone) {
  const enrollment = enrollmentFor(examId, phone);
  const student = adminData.students?.[phone];
  if (!enrollment.paid) return showToast("Mark the student as Paid first.");
  if (enrollment.allowed === false) return showToast("Allow the student before generating a password.");
  if (!student) return showToast("Student record not found.");
  const oldAccessId = enrollment.activeAccessId;
  const { accessId, password } = generateAccessCode();
  try {
    const credential = await secondaryAuth.createUserWithEmailAndPassword(accessEmail(accessId), password);
    await secondaryAuth.signOut();
    const record = { uid: credential.user.uid, accessId, examId, phone, name: student.name, paid: true, allowed: true, status: "issued", loginPassword: password, createdAt: now() };
    const updates = {
      [`access/${accessId}`]: record,
      [`enrollments/${examId}/${phone}`]: { ...enrollment, name: student.name, phone, paid: true, allowed: true, activeAccessId: accessId, loginPassword: password, issuedAt: now(), status: "issued", updatedAt: now() }
    };
    if (oldAccessId) {
      updates[`access/${oldAccessId}/allowed`] = false;
      updates[`access/${oldAccessId}/status`] = "revoked";
    }
    await rootRef().update(updates);
    showStudentPasswordModal(examId, phone, password);
  } catch (error) {
    try { await secondaryAuth.signOut(); } catch (_) {}
    showToast(error.message || "Could not generate the student password.", 5000);
  }
}
function studentLoginMessage(examId, phone) {
  const exam = adminData.exams?.[examId] || {};
  const student = adminData.students?.[phone] || {};
  const e = enrollmentFor(examId, phone);
  return `Hello ${student.name || ""},\n\nYour Scheduled Mock Exam access is ready.\n\nExam: ${exam.title || "Mock Exam"}\nExam link: ${examLink(examId)}\nPhone number: +${phone}\nIndividual one-time password: ${e.loginPassword || ""}\nDuration: ${durationLabel(exam.durationMinutes || 80)}\nAvailable from: ${formatDateTime(exam.availableFrom)}\nAvailable until: ${formatDateTime(exam.availableUntil)}\n\nPrepare your paper before opening the exam. Your timer begins only when you press Start Now.`;
}
function showStudentPasswordModal(examId, phone, password) {
  const student = adminData.students?.[phone] || {};
  showModal(`<h2>Individual Password Generated</h2><p><strong>${escapeHtml(student.name || "Student")}</strong> can use this password once for this exam.</p><div class="code-box">${escapeHtml(password)}</div><p class="muted small">Generating another password automatically revokes the previous one.</p><div class="modal-actions"><button class="ghost" onclick="copyText('${escapeHtml(password)}','Password copied')">Copy Password</button><button class="whatsapp" onclick="closeModal();sendFreshStudentLoginWhatsApp('${examId}','${phone}','${escapeHtml(password)}')">Send on WhatsApp</button><button onclick="closeModal()">Done</button></div>`);
}
function sendFreshStudentLoginWhatsApp(examId, phone, password) {
  const exam = adminData.exams?.[examId] || {};
  const student = adminData.students?.[phone] || {};
  const message = `Hello ${student.name || ""},

Your Scheduled Mock Exam access is ready.

Exam: ${exam.title || "Mock Exam"}
Exam link: ${examLink(examId)}
Phone number: +${phone}
Individual one-time password: ${password}
Duration: ${durationLabel(exam.durationMinutes || 80)}
Available from: ${formatDateTime(exam.availableFrom)}
Available until: ${formatDateTime(exam.availableUntil)}

Prepare your paper before opening the exam. Your timer begins only when you press Start Now.`;
  openWhatsApp(phone, message);
}
function sendStudentLoginWhatsApp(examId, phone) {
  const e = enrollmentFor(examId, phone);
  if (!e.loginPassword) return showToast("Generate the student's password first.");
  openWhatsApp(phone, studentLoginMessage(examId, phone));
}
async function removeStudentFromExam(examId, phone) {
  if (!confirm("Remove this student from this exam? Their current password will be permanently revoked. You can add the same number again later and generate a completely new password.")) return;

  // Read fresh data so every access ever issued for this student/exam is
  // revoked, not only the access ID currently visible in the cached table.
  const [accessSnap, enrollmentsSnap, attemptsSnap] = await Promise.all([
    rootRef("access").once("value"),
    rootRef("enrollments").once("value"),
    rootRef("attempts").once("value")
  ]);
  const allAccess = accessSnap.val() || {};
  const allEnrollments = enrollmentsSnap.val() || {};
  const allAttempts = attemptsSnap.val() || {};
  const updates = { [`enrollments/${examId}/${phone}`]: null };

  Object.entries(allAccess).forEach(([accessId, access]) => {
    if (access?.examId === examId && access?.phone === phone) {
      updates[`access/${accessId}/allowed`] = false;
      updates[`access/${accessId}/status`] = "revoked";
      updates[`access/${accessId}/removedAt`] = now();
      // End an active old attempt immediately, while preserving its history.
      if (allAttempts?.[accessId]?.status === "active") {
        updates[`attempts/${accessId}/status`] = "revoked";
        updates[`attempts/${accessId}/finishedAt`] = now();
      }
    }
  });

  // Remove the global student record only when this phone is not enrolled in
  // any other mock exam. Re-adding it later creates a fresh record normally.
  const hasOtherEnrollment = Object.entries(allEnrollments).some(([otherExamId, students]) =>
    otherExamId !== examId && !!students?.[phone]
  );
  if (!hasOtherEnrollment) updates[`students/${phone}`] = null;

  await rootRef().update(updates);
  showToast("Student removed. The old password is revoked; the number can be added again with a new password.", 4500);
}

function attemptStatusBadge(status) {
  const map = { preparing: ["Preparing", "pending"], active: ["Active", "running"], finishedEarly: ["Finished Early", "finished"], timeEnded: ["Time Ended", "finished"], revoked: ["Blocked", "blocked"] };
  const [text, cls] = map[status] || [status || "Unknown", "neutral"];
  return badge(text, cls);
}
function renderAdminAttempts() {
  const exams = examEntries();
  const attempts = attemptEntries().filter((a) => !adminExamFilter || a.examId === adminExamFilter);
  $("adminContent").innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Student Attempts</h2><p class="muted">See who is taking the exam, start and finish times, device lock, status, and submission window.</p></div><div style="min-width:260px">${exams.length ? examSelector() : ""}</div></div>
      ${attemptTable(attempts, true)}
    </div>`;
}
function attemptTable(attempts, actions) {
  if (!attempts.length) return `<div class="empty">No attempts yet.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Exam</th><th>Status</th><th>Started</th><th>Ends / Finished</th><th>Device</th><th>Activity</th>${actions ? "<th>Actions</th>" : ""}</tr></thead><tbody>${attempts.map((a) => {
    const end = a.status === "active" ? `Ends ${formatDateTime(a.endsAt)}<br><span class="muted tiny">${countdownLabel(Number(a.endsAt) - now())} remaining</span>` : formatDateTime(a.finishedAt);
    return `<tr><td><strong>${escapeHtml(a.name || "")}</strong><br><span class="muted tiny">+${escapeHtml(a.phone || "")}</span></td><td>${escapeHtml(a.examTitle || adminData.exams?.[a.examId]?.title || "")}</td><td>${attemptStatusBadge(a.status)}</td><td>${formatDateTime(a.startedAt)}</td><td>${end}</td><td><span class="tiny">${escapeHtml(a.deviceId || "—")}</span></td><td>${Number(a.tabSwitches || 0)} tab switch${Number(a.tabSwitches || 0) === 1 ? "" : "es"}<br><span class="muted tiny">Seen ${formatDateTime(a.lastSeenAt)}</span></td>${actions ? `<td><div class="table-actions">${a.status === "active" ? `<button class="small-btn" onclick="adjustAttemptTime('${a.id}')">Adjust Time</button><button class="small-btn danger" onclick="revokeAttempt('${a.id}')">End Access</button>` : ""}<button class="small-btn whatsapp" onclick="messageAttemptStudent('${a.id}')">WhatsApp</button></div></td>` : ""}</tr>`;
  }).join("")}</tbody></table></div>`;
}
async function adjustAttemptTime(attemptId) {
  const attempt = adminData.attempts?.[attemptId]; if (!attempt || attempt.status !== "active") return;
  const value = prompt("Enter minutes to add. Use a negative number to remove time (example: 10 or -5):", "5");
  if (value === null) return;
  const minutes = Number(value); if (!Number.isFinite(minutes) || minutes === 0) return showToast("Enter a valid non-zero number.");
  const newEnd = Number(attempt.endsAt) + minutes * 60000;
  if (newEnd <= now()) return showToast("The new end time must be in the future.");
  await rootRef(`attempts/${attemptId}`).update({ endsAt: newEnd, lastTimeAdjustmentMinutes: minutes, timeAdjustedAt: now() });
  showToast(`${minutes > 0 ? "Added" : "Removed"} ${Math.abs(minutes)} minute${Math.abs(minutes) === 1 ? "" : "s"}.`);
}
async function revokeAttempt(attemptId) {
  const attempt = adminData.attempts?.[attemptId]; if (!attempt) return;
  if (!confirm("End this student's exam access now?")) return;
  const finishedAt = now();
  await rootRef().update({ [`attempts/${attemptId}/status`]: "revoked", [`attempts/${attemptId}/finishedAt`]: finishedAt, [`access/${attemptId}/allowed`]: false, [`access/${attemptId}/status`]: "revoked" });
  showToast("Student access ended.");
}
function messageAttemptStudent(attemptId) {
  const a = adminData.attempts?.[attemptId]; if (!a) return;
  openWhatsApp(a.phone, `Hello ${a.name || ""}, regarding your ${a.examTitle || "Scheduled Mock Exam"}:`);
}

function renderAdminSettings() {
  $("adminContent").innerHTML = `
    <div class="grid-2">
      <div class="card"><h2>General Settings</h2><label>WhatsApp Number for Answer Submissions</label><div class="phone-wrap"><span>+</span><input id="settingsWhatsApp" inputmode="numeric" value="${escapeHtml(adminData.settings.whatsapp || DEFAULT_WHATSAPP)}"></div><label>Default Submission Countdown (minutes)</label><input id="settingsSubmission" type="number" min="1" max="30" value="${Number(adminData.settings.defaultSubmissionMinutes || 5)}"><button onclick="saveGeneralSettings()">Save Settings</button></div>
      <div class="card"><h2>Admin Password</h2><p class="muted">Your admin number can log in unlimited times. Change only the password here.</p><label>New Admin Password</label><input id="newAdminPassword" type="password" placeholder="At least 6 characters"><label>Confirm Password</label><input id="confirmAdminPassword" type="password" placeholder="Repeat password"><button onclick="changeAdminPassword()">Change Password</button></div>
    </div>
    <div class="card"><h2>Website Details</h2><p class="muted">This is a separate website. It uses the same Firebase project and deployment structure as Scheduled, while all Mock Exams records are stored under a separate <strong>${ROOT}</strong> section.</p><label>Admin Number</label><div class="code-box">+${ADMIN_PHONE}</div><label>Website Link</label><div class="code-box">${escapeHtml(siteBase())}</div><label>System Version</label><div class="code-box">v${APP_VERSION}</div></div>`;
}
async function saveGeneralSettings() {
  const whatsapp = strict961Phone($("settingsWhatsApp").value);
  const defaultSubmissionMinutes = Number($("settingsSubmission").value || 5);
  if (!whatsapp) return showToast("Enter a valid WhatsApp number starting with 961.");
  await rootRef("settings").update({ whatsapp, defaultSubmissionMinutes, updatedAt: now() });
  showToast("Settings saved.");
}
async function changeAdminPassword() {
  const p1 = $("newAdminPassword").value, p2 = $("confirmAdminPassword").value;
  if (p1.length < 6) return showToast("Password must contain at least 6 characters.");
  if (p1 !== p2) return showToast("Passwords do not match.");
  try { await currentUser.updatePassword(p1); showToast("Admin password changed."); $("newAdminPassword").value = ""; $("confirmAdminPassword").value = ""; }
  catch (error) { showToast(error.message || "Could not change password.", 5000); }
}
async function adminLogout() {
  stopAdminDataListener();
  currentRole = null; currentUser = null;
  try { await auth.signOut(); } catch (_) {}
  renderAdminLogin();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  return btoa(binary);
}
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* Anti-leak / activity tracking */
document.addEventListener("contextmenu", (e) => { if (currentRole === "student" && currentAttempt?.status === "active") e.preventDefault(); });
document.addEventListener("keydown", (e) => {
  if (currentRole !== "student" || currentAttempt?.status !== "active") return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && ["p", "s", "u", "c"].includes(key)) { e.preventDefault(); showToast("This action is disabled during the exam."); }
  if (key === "printscreen") showToast("Screenshots are discouraged. Your exam is individually watermarked.");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && currentRole === "student" && currentAttempt?.status === "active" && currentAccess?.id) {
    rootRef(`attempts/${currentAccess.id}/tabSwitches`).transaction((v) => Number(v || 0) + 1);
    rootRef(`attempts/${currentAccess.id}/lastLeftPageAt`).set(now());
  }
});
window.addEventListener("beforeunload", () => {
  if (currentRole === "student" && currentAttempt?.status === "active" && currentAccess?.id) rootRef(`attempts/${currentAccess.id}/lastSeenAt`).set(now());
});

/* Initial route and persisted authentication */
auth.onAuthStateChanged(async (user) => {
  if (authFlowBusy) return;
  if (!user) {
    if (!currentRole) {
      if (location.hash === "#admin") renderAdminLogin(); else renderStudentLogin();
    }
    return;
  }
  if (currentRole) return;
  const adminSnap = await rootRef(`admins/${user.uid}`).once("value").catch(() => null);
  if (adminSnap?.exists() && adminSnap.val()?.phone === ADMIN_PHONE) return enterAdmin(user);
  const accessQuery = await rootRef("access").orderByChild("uid").equalTo(user.uid).once("value").catch(() => null);
  if (accessQuery?.exists()) {
    const entries = accessQuery.val();
    const [accessId, access] = Object.entries(entries)[0];
    currentUser = user; currentRole = "student"; currentAccess = { id: accessId, ...access, enteredName: access.name || "" };
    const linkExam = getExamIdFromUrl();
    if (linkExam && linkExam !== access.examId) { await auth.signOut(); return renderStudentLogin("This saved login belongs to a different exam link.", "error"); }
    return enterStudent();
  }
  await auth.signOut();
  renderStudentLogin();
});

window.addEventListener("hashchange", () => {
  if (currentRole) return;
  if (location.hash === "#admin") renderAdminLogin(); else renderStudentLogin();
});
