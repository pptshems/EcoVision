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
const btnSound = $("btnSound"), btnFull = $("btnFull");
const modeAuto = $("modeAuto"), modeManual = $("modeManual"), btnCalib = $("btnCalib");
const modeStatusText = $("modeStatusText");
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
let soundOn = true, idleTimer = null;
/* scanMode: "auto" scans by itself, "manual" waits for Scan now / Space.
   triggerSource (what starts an auto scan):
     "sensor" = Arduino connected, HC-SR04 ultrasonic sensor
     "camera" = no Arduino, the camera watches for an object
     "manual" = nothing starts a scan except the person */
let scanMode = "auto", triggerSource = "camera";
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
    const m = localStorage.getItem("ev_mode");
    if (m === "auto" || m === "manual") scanMode = m;
  } catch (e) { /* ignore */ }
}
function save() {
  try {
    localStorage.setItem("ev_stats", JSON.stringify(stats));
    localStorage.setItem("ev_history", JSON.stringify(history.slice(0, 30)));
    localStorage.setItem("ev_mode", scanMode);
  } catch (e) { /* ignore */ }
}

/* ---------- sound ---------- */
let audioCtx = null;
function getAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
/* Phones keep audio locked until the first touch. Unlock on the first tap anywhere,
   so the beeps and voice of an automatic scan can play later without another tap. */
function unlockAudio() {
  try {
    const c = getAudio();
    const o = c.createOscillator(), g = c.createGain();
    g.gain.value = 0.0001; o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.02);
    window.speechSynthesis?.cancel();
  } catch (e) { /* ignore */ }
  ["pointerdown", "touchend", "click", "keydown"].forEach((ev) => document.removeEventListener(ev, unlockAudio, true));
}
["pointerdown", "touchend", "click", "keydown"].forEach((ev) => document.addEventListener(ev, unlockAudio, true));

function buzz(pattern) {                         // vibration (Android; iPhone ignores it)
  if (soundOn && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}
function speak(text) {                           // spoken result, short and clear
  if (!soundOn || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function beep(freqs, dur = 0.12) {
  if (!soundOn) return;
  try {
    audioCtx = getAudio();
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
  detect: () => { beep([660]); buzz(40); },
  bio: () => { beep([523, 659, 784]); buzz([60, 40, 60]); },
  non: () => { beep([392, 294]); buzz([180]); },
  error: () => { beep([220, 196], 0.18); buzz([90, 60, 90, 60, 90]); },
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
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    if (det.timer) detReset();               // new stream: learn the empty view again
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
  while (serialLog.children.length > 80) serialLog.firstChild.remove();
  serialLog.scrollTop = serialLog.scrollHeight;
}

function arduinoUI(connected, message = "") {
  if (!connected) { objectPresent = false; awaitingRemoval = false; }
  refreshTrigger();                          // sensor when connected, camera when not
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

  if (msg === "ECOVISION_READY") {
    arduinoUI(true, scanMode === "auto" ? "Arduino ready. Place an object near the sensor." : "Arduino ready. Manual mode: press Scan now.");
    sendArduinoMode();                       // the UNO reboots when the port opens, so tell it the mode now
    return;
  }

  if (msg === "OBJECT_DETECTED" || msg === "TRIGGER_SCAN") {
    objectPresent = true;
    $("txtObj").textContent = "Object found"; setDot("dotObj", "warn");
    SND.detect();
    renderMode();
    if (scanMode === "auto" && !scanning && !awaitingRemoval) { say("Object detected. Scanning automatically…"); performScan(true); }
    else if (scanMode === "manual") say("Object detected. Manual mode is on, press Scan now.");
    return;
  }
  if (msg === "OBJECT_REMOVED") {
    objectPresent = false; awaitingRemoval = false;
    $("txtObj").textContent = "Waiting"; setDot("dotObj", "on");
    say("Ready. Place an item in front of the sensor.");
    renderMode();
  }
}

function updateDistance(d) {
  const hit = d <= DETECT_CM;
  distText.textContent = `${d.toFixed(1)} cm`;
  gaugeVal.textContent = `${d.toFixed(1)} cm`;
  gaugeFill.style.width = `${Math.max(2, Math.min(100, (1 - d / GAUGE_MAX_CM) * 100))}%`;
  gaugeFill.classList.toggle("hit", hit);
}

let txChain = Promise.resolve();
function sendArduino(cmd) {                  // commands are queued so two writes never collide
  txChain = txChain.then(() => sendArduinoNow(cmd));
  return txChain;
}
async function sendArduinoNow(cmd) {
  if (!serialPort?.writable) return false;
  let w = null;
  try {
    w = serialPort.writable.getWriter();
    await w.write(new TextEncoder().encode(cmd + "\n"));
    logLine(`> ${cmd}`, "tx");
    return true;
  } catch (e) {
    console.error(e); arduinoUI(false, "Could not send the result to the Arduino."); return false;
  } finally { try { w?.releaseLock(); } catch (e) {} }
}
function sendArduinoMode() {
  if (serialPort) sendArduino(scanMode === "auto" ? "MODE_AUTO" : "MODE_MANUAL");
}

/* =========================================================
   AUTO / MANUAL SCAN MODE
   ---------------------------------------------------------
   Auto + Arduino connected  -> the HC-SR04 ultrasonic sensor starts the scan
   Auto + no Arduino         -> the camera detects the item and starts the scan
   Manual                    -> only Scan now / Space bar starts a scan
   Works the same on PC and mobile (mobile has no Arduino, so it uses the camera).
   ========================================================= */
function setModeStatus(text, tone = "") {
  modeStatusText.textContent = text;
  setDot("dotMode", tone);
}

function renderMode() {
  const auto = scanMode === "auto";
  modeAuto.classList.toggle("active", auto);   modeAuto.setAttribute("aria-pressed", auto);
  modeManual.classList.toggle("active", !auto); modeManual.setAttribute("aria-pressed", !auto);
  btnCalib.hidden = triggerSource !== "camera";
  if (triggerSource === "manual") setModeStatus("Manual · press Scan now or Space", "");
  else if (triggerSource === "sensor") setModeStatus(objectPresent ? "Auto · object in sensor range" : "Auto · ultrasonic sensor is watching", objectPresent ? "warn" : "on");
  /* camera status text is written by the detector below */
}

function refreshTrigger() {
  triggerSource = scanMode === "manual" ? "manual" : (serialPort ? "sensor" : "camera");
  if (triggerSource === "camera") detStart(); else detStop();
  renderMode();
}

function setMode(mode) {
  if (mode === scanMode) return;
  scanMode = mode; save();
  refreshTrigger();
  sendArduinoMode();
  if (mode === "manual") say("Manual mode. Press Scan now when an item is ready.");
  else if (serialPort) {
    say("Auto mode. The ultrasonic sensor will start each scan.");
    if (objectPresent && !awaitingRemoval && !scanning) performScan(true);   // item already in range
  } else say("Auto mode. Place an item in front of the camera.");
}

/* ---------- camera object detection (used when no Arduino is connected) ----------
   No extra library or model: the camera learns what the empty view looks like, then
   watches the central frame (the square the AI classifies). When enough of it changes
   and the item stops moving, a scan starts. The scan is locked until the item is removed. */
const DET = {
  INTERVAL: 150,      // ms between frame checks
  PIXEL: 32,          // colour change (0-255) for a pixel to count as "different from empty"
  MOVE_PIXEL: 24,     // colour change between two frames for a pixel to count as "moving"
  ENTER: 0.07,        // share of the centre that must differ to call it an item
  EXIT: 0.035,        // below this the item counts as removed (lower than ENTER on purpose)
  MOTION: 0.05,       // share of the centre allowed to move while "steady"
  STEADY_MS: 700,     // item must stay still this long before scanning
  GIVEUP_MS: 6000,    // scan anyway if it never fully settles (hand-held items)
  ENTER_HITS: 3,      // consecutive checks that must see an item
  REMOVE_HITS: 8,     // consecutive checks that must see it gone
  LEARN_MS: 900,      // how long the empty view must stay still to be learned
  GLOBAL: 0.8,        // if this much of the whole frame changes, the camera moved or the light changed
  GLOBAL_MS: 1500,
  ADAPT: 0.05,        // how fast the empty view follows slow light changes
};
const det = { timer: null, state: "off", bg: null, prev: null, w: 0, h: 0,
              steadySince: 0, settleStart: 0, hits: 0, gone: 0, globalSince: 0, roi: 0 };
const detCanvas = document.createElement("canvas");
const detCtx = detCanvas.getContext("2d", { willReadFrequently: true });

function detStart() { if (det.timer) return; detReset(); det.timer = setInterval(detTick, DET.INTERVAL); }
function detStop()  { clearInterval(det.timer); det.timer = null; det.state = "off"; det.bg = null; det.prev = null; }
function detReset() {
  det.state = "learning"; det.bg = null; det.prev = null; det.w = det.h = 0;
  det.steadySince = det.hits = det.gone = det.globalSince = 0; det.roi = 0;
  setModeStatus("Learning the empty view · keep the frame clear", "warn");
}

function sampleFrame() {
  if (!cameraStream || !video.videoWidth || video.readyState < 2) return null;
  const w = 64, h = Math.max(24, Math.round((64 * video.videoHeight) / video.videoWidth));
  if (detCanvas.width !== w || detCanvas.height !== h) { detCanvas.width = w; detCanvas.height = h; }
  detCtx.drawImage(video, 0, 0, w, h);
  return { data: detCtx.getImageData(0, 0, w, h).data, w, h };
}

/* share of pixels that differ from `ref`: inside the centre square (roi) and over the whole frame (all) */
function diffStats(cur, ref, w, h, thr) {
  const s = Math.round(Math.min(w, h) * 0.8);
  const x0 = Math.floor((w - s) / 2), y0 = Math.floor((h - s) / 2);
  let roiN = 0, roiHit = 0, allHit = 0;
  for (let y = 0; y < h; y++) {
    const inY = y >= y0 && y < y0 + s;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = (Math.abs(cur[i] - ref[i]) + Math.abs(cur[i + 1] - ref[i + 1]) + Math.abs(cur[i + 2] - ref[i + 2])) / 3;
      const hit = d > thr;
      if (hit) allHit++;
      if (inY && x >= x0 && x < x0 + s) { roiN++; if (hit) roiHit++; }
    }
  }
  return { roi: roiHit / roiN, all: allHit / (w * h) };
}

function detTick() {
  if (document.hidden) return;
  const f = sampleFrame();
  if (!f) return;
  const t = performance.now();

  if (f.w !== det.w || f.h !== det.h) { detReset(); det.w = f.w; det.h = f.h; }   // camera switched
  const prev = det.prev; det.prev = f.data;
  if (!prev) return;

  const steady = diffStats(f.data, prev, f.w, f.h, DET.MOVE_PIXEL).roi < DET.MOTION;

  if (det.state === "learning") {
    if (!steady) { det.steadySince = 0; return; }
    if (!det.steadySince) det.steadySince = t;
    if (t - det.steadySince >= DET.LEARN_MS) {
      det.bg = Float32Array.from(f.data);
      det.state = "empty"; det.hits = 0;
      setModeStatus("Auto · camera is watching for an item", "on");
    }
    return;
  }

  const d = diffStats(f.data, det.bg, f.w, f.h, DET.PIXEL);
  det.roi = d.roi;

  /* nearly everything changed: the camera moved or the light changed, so learn the view again */
  if (d.all > DET.GLOBAL) {
    if (!det.globalSince) det.globalSince = t;
    if (steady && t - det.globalSince > DET.GLOBAL_MS) detReset();
    return;
  }
  det.globalSince = 0;

  if (det.state === "empty") {
    if (d.roi >= DET.ENTER) {
      if (++det.hits >= DET.ENTER_HITS) {
        det.state = "settling"; det.settleStart = t; det.steadySince = 0;
        setModeStatus("Item detected · hold it steady", "warn");
        SND.detect();
      }
    } else {
      det.hits = 0;
      if (steady && d.roi < DET.EXIT) {                     // follow slow lighting changes
        for (let i = 0; i < det.bg.length; i++) det.bg[i] += (f.data[i] - det.bg[i]) * DET.ADAPT;
      }
    }
  } else if (det.state === "settling") {
    if (d.roi < DET.EXIT) {                                  // it was only a hand passing through
      det.state = "empty"; det.hits = 0;
      setModeStatus("Auto · camera is watching for an item", "on");
      return;
    }
    if (steady) { if (!det.steadySince) det.steadySince = t; } else det.steadySince = 0;
    if ((det.steadySince && t - det.steadySince >= DET.STEADY_MS) || t - det.settleStart > DET.GIVEUP_MS) detTrigger();
  } else if (det.state === "locked") {
    if (d.roi < DET.EXIT) {
      if (++det.gone >= DET.REMOVE_HITS) {
        det.state = "empty"; det.hits = det.gone = 0;
        say("Ready. Place the next item in front of the camera.");
        setModeStatus("Auto · camera is watching for an item", "on");
      }
    } else det.gone = 0;
  }
}

function detTrigger() {
  det.state = "locked"; det.gone = 0;                        // one scan per item
  if (scanning) return;                                      // a manual scan is already handling it
  setModeStatus("Scanning…", "warn");
  say("Item detected. Scanning automatically…");
  performScan(true);
}

/* called after every scan: a manual scan of an item the camera already sees must lock too */
function afterScan() {
  if (!det.timer) return;
  if (det.state === "settling" || (det.state === "empty" && det.roi >= DET.ENTER)) { det.state = "locked"; det.gone = 0; }
  if (det.state === "locked") setModeStatus("Remove the item to scan again", "warn");
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
             : triggerSource === "camera" ? "Classified. Remove the item to scan the next one."
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
    afterScan();
  }
}

function showResult(d, thumb) {
  const bio = d.result === "BIODEGRADABLE";
  setState(bio ? "bio" : "non");
  (bio ? SND.bio : SND.non)();
  setTimeout(() => speak(bio ? "Biodegradable" : "Non biodegradable"), 450);

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
  history = history.slice(0, 30);
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
  history.forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = `<img alt="" src="${h.img || ""}">
      <div class="h-main"><b>${esc(h.label)}</b><small>${h.t} · ${Number(h.c).toFixed(0)}% sure</small></div>
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

modeAuto.addEventListener("click", () => setMode("auto"));
modeManual.addEventListener("click", () => setMode("manual"));
btnCalib.addEventListener("click", () => { detReset(); say("Re-learning the empty view. Keep the frame clear for a moment."); });
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

/* phone: History / Guide open as a sheet over the camera */
const btnInfo = $("btnInfo"), btnSheetClose = $("btnSheetClose");
function toggleSheet(open) {
  const o = open ?? !app.classList.contains("sheet-open");
  app.classList.toggle("sheet-open", o);
  btnInfo?.setAttribute("aria-expanded", o);
}
btnInfo?.addEventListener("click", () => toggleSheet());
btnSheetClose?.addEventListener("click", () => toggleSheet(false));

/* keep the phone screen awake so camera auto-scan keeps running */
let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } } catch (e) { /* ignore */ }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) keepAwake(); });
document.addEventListener("pointerdown", keepAwake, { once: true });

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
  keepAwake();
  refreshTrigger();
  if (isMobile) { say(scanMode === "auto" ? "Auto mode. Place an item in front of the camera." : "Manual mode. Point at an item and press Scan now."); }
  else { arduinoUI(false, webSerialSupported() ? "Connect an Arduino for sensor scanning, or just place an item in front of the camera." : "Use Chrome or Edge to connect an Arduino."); }
  await checkStatus();
  setInterval(checkStatus, 15000);
})();
