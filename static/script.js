/* =========================================================
   EcoVision · browser logic
   Web Serial (Arduino) + camera + Flask /api/predict
   ========================================================= */
const $ = (id) => document.getElementById(id);

const isMobile = window.matchMedia("(max-width: 820px)").matches ||
                 /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const app = $("app");
if (isMobile) app.classList.add("mobile");

/* ---------- elements ---------- */
const video = $("video"), canvas = $("canvas");
const btnScan = $("btnScan"), btnReset = $("btnReset"), btnFlip = $("btnFlip");
const btnArduino = $("btnArduino"), btnArduinoText = $("btnArduinoText");
const btnAuto = $("btnAuto"), btnSound = $("btnSound"), btnFull = $("btnFull");
const camMsg = $("camMsg"), liveBox = document.querySelector(".live"), liveText = $("liveText");
const scanSub = $("scanSub");
const resIcon = $("resIcon"), resLabel = $("resLabel"), resSub = $("resSub"), resKicker = $("resKicker");
const confArc = $("confArc"), confNum = $("confNum"), resTip = $("resTip");
const toastIco = $("toastIco"), toastTitle = $("toastTitle"), toastSub = $("toastSub");
const distText = $("distText"), gaugeVal = $("gaugeVal"), gaugeFill = $("gaugeFill");
const footMsg = $("footMsg");
const serialState = $("serialState"), serialLog = $("serialLog");
const testBio = $("testBio"), testNon = $("testNon");
const historyList = $("historyList"), historyEmpty = $("historyEmpty");

const DETECT_CM = 20;      // must match DETECT_DISTANCE in the Arduino sketch
const GAUGE_MAX_CM = 40;
const ICON = (id) => `<svg><use href="#${id}"/></svg>`;

/* ---------- state ---------- */
let cameraStream = null, cameraDevices = [], cameraIndex = 0, facing = "environment";
let scanning = false, objectPresent = false, awaitingRemoval = false;
let serialPort = null, serialReader = null, serialKeepReading = false, serialBuffer = "";
let autoOn = true, soundOn = true, idleTimer = null;
let stats = { total: 0, bio: 0, non: 0 };
let history = [];

/* ---------- small helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const webSerialSupported = () => "serial" in navigator;
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function setDot(id, mode) {
  const el = $(id); if (!el) return;
  el.className = "dot" + (mode ? " " + mode : "");
}
function say(msg) { footMsg.textContent = msg; }
function setState(s) { app.dataset.state = s; }

/* ---------- persistence (guarded: storage can be blocked) ---------- */
function load() {
  try {
    stats = JSON.parse(localStorage.getItem("ev_stats")) || stats;
    history = JSON.parse(localStorage.getItem("ev_history")) || [];
  } catch (e) { /* ignore */ }
}
function save() {
  try {
    localStorage.setItem("ev_stats", JSON.stringify(stats));
    localStorage.setItem("ev_history", JSON.stringify(history.slice(0, 12)));
  } catch (e) { /* ignore */ }
}

/* ---------- sound ---------- */
let audioCtx = null;
function beep(freqs, dur = 0.12) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    let t = audioCtx.currentTime;
    freqs.forEach((f) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
      t += dur * 0.85;
    });
  } catch (e) { /* ignore */ }
}
const SND = {
  detect: () => beep([660]),
  bio: () => beep([523, 659, 784]),
  non: () => beep([392, 294]),
  error: () => beep([220, 196], 0.18),
};

/* ---------- eco tips ---------- */
const TIPS = {
  BIODEGRADABLE: [
    "Compost it: food scraps and leaves become rich soil in weeks.",
    "Keep biodegradable waste separate and dry waste stays recyclable.",
    "Home composting can cut household waste by up to a third.",
  ],
  "NON-BIODEGRADABLE": [
    "Rinse and recycle plastics, metals and glass where possible.",
    "Plastic can take hundreds of years to break down. Reuse first.",
    "Never burn plastic. Send it to a proper recycling point.",
  ],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- camera ---------- */
async function startCamera(deviceId = null) {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable. Open EcoVision over HTTPS.");
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());

    const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const video_c = deviceId ? { ...base, deviceId: { exact: deviceId } }
                             : { ...base, facingMode: { ideal: facing } };
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
    } catch (e) {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    video.srcObject = cameraStream;
    try { cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); } catch (e) {}

    camMsg.classList.add("hidden");
    liveBox.classList.add("ready"); liveBox.classList.remove("off"); liveText.textContent = "LIVE";
    $("txtCam").textContent = "Ready"; setDot("dotCam", "on");
  } catch (err) {
    console.error(err);
    camMsg.classList.remove("hidden");
    camMsg.innerHTML = `${ICON("i-cam")}<p>Camera unavailable</p><small>Allow camera permission, then press Flip to retry</small>`;
    liveBox.classList.add("off"); liveBox.classList.remove("ready"); liveText.textContent = "OFFLINE";
    $("txtCam").textContent = "Error"; setDot("dotCam", "off");
    say("Camera unavailable. Please allow camera permission.");
  }
}
async function flipCamera() {
  if (cameraDevices.length > 1) {
    cameraIndex = (cameraIndex + 1) % cameraDevices.length;
    await startCamera(cameraDevices[cameraIndex].deviceId);
  } else {
    facing = facing === "environment" ? "user" : "environment";
    await startCamera();
  }
}

/* ---------- AI status ---------- */
async function checkStatus() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    const d = await r.json();
    $("txtAi").textContent = d.model_ready ? "Ready" : "Error";
    setDot("dotAi", d.model_ready ? "on" : "off");
  } catch (e) {
    $("txtAi").textContent = "Offline"; setDot("dotAi", "off");
  }
}

/* ---------- Arduino UI ---------- */
function logLine(text, cls = "") {
  const li = document.createElement("li");
  li.textContent = `${now()}  ${text}`;
  if (cls) li.className = cls;
  serialLog.appendChild(li);
  while (serialLog.children.length > 8) serialLog.firstChild.remove();
}

function arduinoUI(connected, message = "") {
  if (isMobile) return;
  $("txtArd").textContent = connected ? "Connected" : (webSerialSupported() ? "Offline" : "Unsupported");
  setDot("dotArd", connected ? "on" : "off");
  btnArduinoText.textContent = connected ? "Disconnect" : "Connect Arduino";
  btnArduino.classList.toggle("connected", connected);
  serialState.classList.toggle("on", connected);
  serialState.innerHTML = connected
    ? `${ICON("i-plug")}<div><b>Arduino connected</b><small>Listening to the ultrasonic sensor</small></div>`
    : `${ICON("i-plug")}<div><b>${webSerialSupported() ? "Not connected" : "Browser not supported"}</b><small>${webSerialSupported() ? "USB · 9600 baud · Chrome or Edge" : "Use Chrome or Edge on a computer"}</small></div>`;
  testBio.disabled = testNon.disabled = !connected;
  if (!connected) {
    setDot("dotObj", ""); $("txtObj").textContent = "Idle";
    distText.textContent = "-- cm"; gaugeVal.textContent = "--"; gaugeFill.style.width = "0";
  } else {
    setDot("dotObj", "on"); $("txtObj").textContent = "Waiting";
  }
  if (message) say(message);
}

/* ---------- Web Serial ---------- */
async function connectArduino() {
  if (!webSerialSupported()) { say("Arduino needs Chrome or Edge on a computer."); return; }
  try {
    btnArduino.disabled = true; btnArduinoText.textContent = "Choose device…";
    say("Pick your Arduino in the browser dialog.");
    serialPort = await navigator.serial.requestPort();   // must follow a user click
    await serialPort.open({ baudRate: 9600 });
    arduinoUI(true, "Arduino connected. Sensor is watching for objects.");
    logLine("Port opened · 9600 baud", "ev");
    startSerialReader();
  } catch (err) {
    console.error(err);
    serialPort = null;
    arduinoUI(false, err.name === "NotFoundError" ? "No device selected." : `Connection failed: ${err.message}`);
  } finally { btnArduino.disabled = false; }
}

async function disconnectArduino() {
  serialKeepReading = false;
  try { await serialReader?.cancel(); } catch (e) {}
  try { await serialPort?.close(); } catch (e) {}
  serialReader = null; serialPort = null; serialBuffer = "";
  objectPresent = false; awaitingRemoval = false;
  logLine("Port closed", "ev");
  arduinoUI(false, "Arduino disconnected.");
}

async function startSerialReader() {
  if (!serialPort?.readable || serialKeepReading) return;
  serialKeepReading = true; serialBuffer = "";
  const decoder = new TextDecoder();
  try {
    serialReader = serialPort.readable.getReader();
    while (serialKeepReading) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (!value) continue;
      serialBuffer += decoder.decode(value, { stream: true });
      const lines = serialBuffer.split(/\r?\n/);
      serialBuffer = lines.pop() || "";
      lines.forEach((l) => onArduino(l.trim()));
    }
  } catch (err) {
    if (serialKeepReading) {
      console.error(err);
      serialPort = null;
      arduinoUI(false, "Arduino connection stopped. Reconnect to continue.");
    }
  } finally {
    serialKeepReading = false;
    try { serialReader?.releaseLock(); } catch (e) {}
    serialReader = null;
  }
}

function onArduino(msg) {
  if (!msg) return;

  if (msg.startsWith("DISTANCE:")) {
    const d = parseFloat(msg.split(":")[1]);
    if (Number.isFinite(d)) updateDistance(d);
    return;                                   // too chatty to log
  }
  logLine(msg, msg.endsWith("ACCEPTED") ? "tx" : "ev");

  if (msg === "ECOVISION_READY") { arduinoUI(true, "Arduino ready. Place an object near the sensor."); return; }

  if (msg === "OBJECT_DETECTED" || msg === "TRIGGER_SCAN") {
    objectPresent = true;
    $("txtObj").textContent = "Object found"; setDot("dotObj", "warn");
    SND.detect();
    if (autoOn && !scanning && !awaitingRemoval) { say("Object detected. Scanning automatically…"); performScan(true); }
    else if (!autoOn) say("Object detected. Auto-scan is off, press Scan now.");
    return;
  }
  if (msg === "OBJECT_REMOVED") {
    objectPresent = false; awaitingRemoval = false;
    $("txtObj").textContent = "Waiting"; setDot("dotObj", "on");
    say("Ready. Place an item in front of the sensor.");
  }
}

function updateDistance(d) {
  const hit = d <= DETECT_CM;
  distText.textContent = `${d.toFixed(1)} cm`;
  gaugeVal.textContent = `${d.toFixed(1)} cm`;
  gaugeFill.style.width = `${Math.max(2, Math.min(100, (1 - d / GAUGE_MAX_CM) * 100))}%`;
  gaugeFill.classList.toggle("hit", hit);
}

async function sendArduino(cmd) {
  if (!serialPort?.writable) return false;
  const w = serialPort.writable.getWriter();
  try {
    await w.write(new TextEncoder().encode(cmd + "\n"));
    logLine(`> ${cmd}`, "tx");
    return true;
  } catch (e) {
    console.error(e); arduinoUI(false, "Could not send the result to the Arduino."); return false;
  } finally { w.releaseLock(); }
}

/* ---------- capture + scan ---------- */
function captureFrame() {
  if (!video.videoWidth) throw new Error("Camera is not ready.");
  canvas.width = 224; canvas.height = 224;
  const ctx = canvas.getContext("2d");
  const s = Math.min(video.videoWidth, video.videoHeight);
  ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, 224, 224);
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
}
function thumbnail() {
  const t = document.createElement("canvas"); t.width = t.height = 56;
  t.getContext("2d").drawImage(canvas, 0, 0, 56, 56);
  return t.toDataURL("image/jpeg", 0.6);
}

async function performScan(auto = false) {
  if (scanning) return;
  if (!cameraStream || video.readyState < 2) { say("Camera is not ready yet."); return; }

  scanning = true; clearTimeout(idleTimer);
  btnScan.disabled = true; btnScan.querySelector("span").textContent = "Scanning…";
  setState("scan");
  resIcon.innerHTML = ICON("i-scan"); resKicker.textContent = auto ? "Auto scan" : "Manual scan";
  resLabel.textContent = "Analyzing…"; resSub.textContent = "Hold the item steady";
  confNum.textContent = "--"; confArc.style.strokeDashoffset = 113.1;
  scanSub.textContent = "Hold the item steady";
  $("txtObj").textContent = "Scanning"; setDot("dotObj", "warn");

  try {
    await sleep(1500);                      // let the item settle
    scanSub.textContent = "Asking the AI model…";
    const blob = await captureFrame();
    const thumb = thumbnail();
    const fd = new FormData(); fd.append("image", blob, "camera.jpg");

    const r = await fetch("/api/predict", { method: "POST", body: fd });
    const data = await r.json();
    await sleep(400);
    if (!r.ok || !data.success) throw new Error(data.error || "Prediction failed.");

    showResult(data, thumb);

    let sent = false;
    if (serialPort) sent = await sendArduino(data.arduino_command);
    awaitingRemoval = Boolean(serialPort);

    $("txtObj").textContent = "Classified"; setDot("dotObj", "warn");
    say(sent ? "Sorted. Remove the object when ready."
             : (!isMobile && !serialPort ? "Classified. Connect an Arduino to run the sorter." : "Classification complete."));

    idleTimer = setTimeout(() => {
      if (scanning) return;
      $("txtObj").textContent = serialPort ? "Waiting" : "Idle";
      setDot("dotObj", serialPort ? "on" : "");
      if (serialPort && objectPresent) say("Object still in range. Remove it before the next scan.");
    }, 2500);
  } catch (err) {
    console.error(err);
    setState("error"); SND.error();
    resIcon.innerHTML = ICON("i-scan"); resKicker.textContent = "Something went wrong";
    resLabel.textContent = "Scan failed"; resSub.textContent = err.message;
    confNum.textContent = "--"; confArc.style.strokeDashoffset = 113.1;
    $("txtObj").textContent = "Error"; setDot("dotObj", "off");
    say("Scan error: " + err.message);
  } finally {
    scanning = false;
    btnScan.disabled = false; btnScan.querySelector("span").textContent = "Scan now";
  }
}

function showResult(d, thumb) {
  const bio = d.result === "BIODEGRADABLE";
  setState(bio ? "bio" : "non");
  (bio ? SND.bio : SND.non)();

  const label = bio ? "Biodegradable" : "Non-biodegradable";
  const icon = ICON(bio ? "i-leaf" : "i-bin");
  resIcon.innerHTML = icon; toastIco.innerHTML = icon;
  resKicker.textContent = "Result";
  resLabel.textContent = label; toastTitle.textContent = label;
  resSub.textContent = `AI label: ${d.original_label}`;
  const c = Number(d.confidence);
  toastSub.textContent = `${c.toFixed(1)}% confidence`;
  confNum.textContent = `${Math.round(c)}%`;
  confArc.style.strokeDashoffset = 113.1 * (1 - c / 100);
  resTip.innerHTML = `${ICON(bio ? "i-leaf" : "i-bin")}<span>${pick(TIPS[d.result])}</span>`;

  stats.total++; bio ? stats.bio++ : stats.non++;
  history.unshift({ bio, label, c, t: now(), img: thumb });
  history = history.slice(0, 12);
  save(); renderStats(); renderHistory();
}

/* ---------- renderers ---------- */
function renderStats() {
  $("stTotal").textContent = stats.total; $("stBio").textContent = stats.bio; $("stNon").textContent = stats.non;
  const t = stats.total || 1;
  $("splitBio").style.width = stats.total ? `${(stats.bio / t) * 100}%` : "50%";
  $("splitNon").style.width = stats.total ? `${(stats.non / t) * 100}%` : "50%";
}
function renderHistory() {
  historyList.innerHTML = "";
  historyEmpty.classList.toggle("hidden", history.length > 0);
  history.slice(0, 6).forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = `<img alt="" src="${h.img || ""}">
      <div class="h-main"><b>${h.label}</b><small>${h.t} · ${Number(h.c).toFixed(0)}% sure</small></div>
      <span class="h-tag ${h.bio ? "bio" : "non"}">${h.bio ? "BIO" : "NON-BIO"}</span>`;
    historyList.appendChild(li);
  });
}

function resetResult() {
  clearTimeout(idleTimer);
  setState("idle");
  resIcon.innerHTML = ICON("i-scan"); resKicker.textContent = "Classification";
  resLabel.textContent = "Ready to scan"; resSub.textContent = "Place an item in front of the camera.";
  confNum.textContent = "--"; confArc.style.strokeDashoffset = 113.1;
  $("txtObj").textContent = serialPort ? "Waiting" : "Idle"; setDot("dotObj", serialPort ? "on" : "");
  say(objectPresent ? "Object still in range. Remove it before the next scan." : "Ready. Place an item in front of the camera.");
}

/* ---------- events ---------- */
btnScan.addEventListener("click", () => performScan(false));
btnReset.addEventListener("click", resetResult);
btnFlip.addEventListener("click", flipCamera);
btnArduino.addEventListener("click", () => (serialPort ? disconnectArduino() : connectArduino()));
testBio.addEventListener("click", () => sendArduino("BIO"));
testNon.addEventListener("click", () => sendArduino("NON_BIO"));

btnAuto.addEventListener("click", () => {
  autoOn = !autoOn;
  btnAuto.classList.toggle("on", autoOn); btnAuto.setAttribute("aria-pressed", autoOn);
  say(autoOn ? "Auto-scan on. The sensor will trigger scans." : "Auto-scan off. Use Scan now.");
});
btnSound.addEventListener("click", () => {
  soundOn = !soundOn;
  btnSound.classList.toggle("on", soundOn); btnSound.setAttribute("aria-pressed", soundOn);
  if (soundOn) SND.detect();
});
btnFull.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
$("btnClear").addEventListener("click", () => {
  history = []; stats = { total: 0, bio: 0, non: 0 }; save(); renderStats(); renderHistory();
});

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab.dataset.tab));
  })
);

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && !["BUTTON", "INPUT"].includes(document.activeElement.tagName)) {
    e.preventDefault(); performScan(false);
  }
});

if (webSerialSupported()) {
  navigator.serial.addEventListener("disconnect", (e) => {
    if (serialPort === e.target) {
      serialKeepReading = false; serialPort = null;
      arduinoUI(false, "Arduino unplugged.");
    }
  });
}

/* ---------- init ---------- */
(async function init() {
  load(); renderStats(); renderHistory();
  startCamera();
  if (isMobile) { say("Ready. Point the camera at a waste item."); }
  else { arduinoUI(false, webSerialSupported() ? "Connect your Arduino to enable automatic scanning." : "Use Chrome or Edge to connect an Arduino."); }
  await checkStatus();
  setInterval(checkStatus, 15000);
})();
