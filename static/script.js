const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const isMobile = window.matchMedia("(max-width: 700px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const scanButton = document.getElementById("scanButton");
const resetButton = document.getElementById("resetButton");
const arduinoButton = document.getElementById("arduinoButton");
const portText = document.getElementById("portText");

const scanOverlay = document.getElementById("scanOverlay");
const scanCountdown = document.getElementById("scanCountdown");
const cameraMessage = document.getElementById("cameraMessage");
const cameraBadge = document.getElementById("cameraBadge");

const resultIcon = document.getElementById("resultIcon");
const resultLabel = document.getElementById("resultLabel");
const resultConfidence = document.getElementById("resultConfidence");
const progressBar = document.getElementById("progressBar");
const originalLabel = document.getElementById("originalLabel");

const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const cameraDot = document.getElementById("cameraDot");
const cameraStatus = document.getElementById("cameraStatus");
const arduinoDot = document.getElementById("arduinoDot");
const arduinoStatus = document.getElementById("arduinoStatus");
const modelDot = document.getElementById("modelDot");
const modelStatus = document.getElementById("modelStatus");
const objectDot = document.getElementById("objectDot");
const objectStatus = document.getElementById("objectStatus");
const footerMessage = document.getElementById("footerMessage");

let cameraStream = null;
let scanning = false;
let objectPresent = false;
let awaitingRemoval = false;
let serialPort = null;
let serialReader = null;
let serialKeepReading = false;
let serialBuffer = "";
let autoScanEnabled = false;

function setDot(dot, state) {
    if (!dot) return;
    dot.className = "dot";
    if (state === "online") dot.classList.add("online");
    else if (state === "warning") dot.classList.add("warning");
    else dot.classList.add("offline");
}

function webSerialSupported() {
    return "serial" in navigator;
}

function updateArduinoUI(connected, message = "") {
    if (isMobile) return;

    if (connected) {
        const info = serialPort?.getInfo ? serialPort.getInfo() : {};
        const usbText = info.usbVendorId ? "USB Arduino" : "Serial device";
        connectionText.textContent = "Arduino Connected";
        setDot(connectionDot, "online");
        arduinoStatus.textContent = "Connected";
        setDot(arduinoDot, "online");
        arduinoButton.textContent = "Disconnect Arduino";
        portText.textContent = `${usbText} • 9600 baud`;
    } else {
        connectionText.textContent = "Arduino Not Connected";
        setDot(connectionDot, "offline");
        arduinoStatus.textContent = webSerialSupported() ? "Disconnected" : "Unsupported";
        setDot(arduinoDot, "offline");
        arduinoButton.textContent = "Connect Arduino";
        portText.textContent = webSerialSupported()
            ? "Click Connect to choose USB Arduino"
            : "Use Chrome or Edge on a PC";
    }

    if (message) footerMessage.textContent = message;
}

async function startCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera API is unavailable. Open EcoVision using HTTPS.");
        }

        const constraints = isMobile
            ? { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
            : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } }, audio: false };

        try {
            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (firstError) {
            if (isMobile) cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            else throw firstError;
        }

        video.srcObject = cameraStream;
        cameraMessage.classList.add("hidden");
        cameraBadge.textContent = isMobile ? "PHONE CAMERA" : "READY";
        if (cameraStatus) cameraStatus.textContent = "Ready";
        setDot(cameraDot, "online");
    } catch (error) {
        console.error(error);
        cameraMessage.classList.remove("hidden");
        cameraMessage.innerHTML = `<div class="camera-icon">⚠</div><div>Camera access denied or unavailable</div>`;
        cameraBadge.textContent = "ERROR";
        if (cameraStatus) cameraStatus.textContent = "Error";
        setDot(cameraDot, "offline");
        footerMessage.textContent = "Camera unavailable • Please allow camera permission";
    }
}

async function checkStatus() {
    try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const data = await response.json();
        if (data.model_ready) {
            if (modelStatus) modelStatus.textContent = "Ready";
            setDot(modelDot, "online");
        } else {
            if (modelStatus) modelStatus.textContent = "Error";
            setDot(modelDot, "offline");
        }
        if (!isMobile) updateArduinoUI(Boolean(serialPort), "");
    } catch (error) {
        console.error(error);
        if (!isMobile) {
            if (modelStatus) modelStatus.textContent = "Offline";
            setDot(modelDot, "offline");
            connectionText.textContent = "Server Offline";
            setDot(connectionDot, "offline");
        }
    }
}

async function connectArduino() {
    if (!webSerialSupported()) {
        footerMessage.textContent = "Arduino connection requires Chrome or Edge on a computer.";
        return;
    }

    try {
        arduinoButton.disabled = true;
        arduinoButton.textContent = "Select Arduino...";
        footerMessage.textContent = "Choose your Arduino USB/serial device in the browser dialog.";

        // requestPort MUST happen after a user click. The browser does not
        // allow a website to silently access arbitrary USB serial devices.
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 9600 });
        autoScanEnabled = true;
        updateArduinoUI(true, "Arduino connected • HC-SR04 monitoring is active");
        await startSerialReader();
    } catch (error) {
        console.error("Arduino connection error:", error);
        serialPort = null;
        autoScanEnabled = false;
        updateArduinoUI(false, error.name === "NotFoundError"
            ? "Arduino selection cancelled."
            : `Arduino connection failed: ${error.message}`);
    } finally {
        arduinoButton.disabled = false;
    }
}

async function disconnectArduino() {
    autoScanEnabled = false;
    serialKeepReading = false;

    try {
        if (serialReader) {
            await serialReader.cancel();
        }
    } catch (error) {
        console.debug("Serial reader cancel:", error);
    }

    try {
        if (serialPort && serialPort.readable) {
            // The reader loop releases the lock after cancellation.
        }
    } catch (error) {
        console.debug(error);
    }

    try {
        if (serialPort) await serialPort.close();
    } catch (error) {
        console.debug("Serial close:", error);
    }

    serialReader = null;
    serialPort = null;
    serialBuffer = "";
    objectPresent = false;
    awaitingRemoval = false;
    updateArduinoUI(false, "Arduino disconnected.");
    if (objectStatus) objectStatus.textContent = "Waiting for object";
    setDot(objectDot, "online");
}

async function startSerialReader() {
    if (!serialPort || !serialPort.readable || serialKeepReading) return;

    serialKeepReading = true;
    serialBuffer = "";

    try {
        serialReader = serialPort.readable.getReader();

        while (serialKeepReading) {
            const { value, done } = await serialReader.read();
            if (done) break;
            if (!value) continue;

            serialBuffer += new TextDecoder().decode(value, { stream: true });
            const lines = serialBuffer.split(/\r?\n/);
            serialBuffer = lines.pop() || "";

            for (const line of lines) {
                handleArduinoMessage(line.trim());
            }
        }
    } catch (error) {
        if (serialKeepReading) {
            console.error("Serial reader stopped:", error);
            updateArduinoUI(false, "Arduino was disconnected or the serial connection stopped.");
            serialPort = null;
            autoScanEnabled = false;
        }
    } finally {
        serialKeepReading = false;
        try { serialReader?.releaseLock(); } catch (error) { console.debug(error); }
        serialReader = null;
    }
}

function handleArduinoMessage(message) {
    if (!message) return;

    if (message === "ECOVISION_READY") {
        updateArduinoUI(true, "Arduino ready • Place an object near the HC-SR04");
        return;
    }

    if (message.startsWith("DISTANCE:")) {
        const distance = Number.parseFloat(message.split(":")[1]);
        if (Number.isFinite(distance) && distance <= 20) {
            objectPresent = true;
        }
        return;
    }

    if (message === "OBJECT_DETECTED" || message === "TRIGGER_SCAN") {
        objectPresent = true;
        if (objectStatus) objectStatus.textContent = "Object detected";
        setDot(objectDot, "warning");

        if (autoScanEnabled && !scanning && !awaitingRemoval) {
            footerMessage.textContent = "Object detected • Starting automatic scan...";
            autoScan();
        }
        return;
    }

    if (message === "OBJECT_REMOVED") {
        objectPresent = false;
        awaitingRemoval = false;
        if (objectStatus) objectStatus.textContent = "Waiting for object";
        setDot(objectDot, "online");
        footerMessage.textContent = "Ready • Place an item in front of the sensor";
        return;
    }
}

async function sendArduinoCommand(command) {
    if (!serialPort || !serialPort.writable) {
        return false;
    }

    const writer = serialPort.writable.getWriter();
    try {
        await writer.write(new TextEncoder().encode(`${command}\n`));
        return true;
    } catch (error) {
        console.error("Arduino write failed:", error);
        updateArduinoUI(false, "Could not send the result to the Arduino.");
        return false;
    } finally {
        writer.releaseLock();
    }
}

function showScanningAnimation() {
    scanOverlay.classList.remove("hidden");
    scanCountdown.textContent = "Analyzing object...";
    let seconds = 2;

    const timer = setInterval(() => {
        if (!scanning) {
            clearInterval(timer);
            return;
        }
        if (seconds > 0) {
            scanCountdown.textContent = `Analyzing object... ${seconds}`;
            seconds--;
        } else {
            scanCountdown.textContent = "Finalizing AI result...";
        }
    }, 700);

    return timer;
}

function hideScanningAnimation() {
    scanOverlay.classList.add("hidden");
}

function captureFrame() {
    if (!video.videoWidth || !video.videoHeight) {
        throw new Error("Camera is not ready.");
    }

    canvas.width = 224;
    canvas.height = 224;
    const context = canvas.getContext("2d");
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const size = Math.min(sourceWidth, sourceHeight);
    const sourceX = (sourceWidth - size) / 2;
    const sourceY = (sourceHeight - size) / 2;
    context.drawImage(video, sourceX, sourceY, size, size, 0, 0, 224, 224);

    return new Promise((resolve) => {
        canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.92);
    });
}

async function autoScan() {
    await performScan(true);
}

async function performScan(automatic = false) {
    if (scanning) return;

    if (!cameraStream || video.readyState < 2) {
        footerMessage.textContent = "Camera is not ready yet.";
        return;
    }

    scanning = true;
    scanButton.disabled = true;
    scanButton.innerHTML = "<span>⌛</span> SCANNING...";
    resultLabel.textContent = "SCANNING...";
    resultLabel.style.color = "#f59e0b";
    resultIcon.textContent = "🔎";
    resultConfidence.textContent = "Analyzing image...";
    progressBar.style.width = "0%";
    if (objectStatus) objectStatus.textContent = automatic ? "Auto scanning" : "Scanning";
    setDot(objectDot, "warning");
    footerMessage.textContent = automatic ? "Object detected • AI scanning automatically..." : "AI scanning in progress...";

    const animationTimer = showScanningAnimation();

    try {
        await sleep(1800);
        const imageBlob = await captureFrame();
        const formData = new FormData();
        formData.append("image", imageBlob, "camera.jpg");

        const response = await fetch("/api/predict", { method: "POST", body: formData });
        const data = await response.json();
        await sleep(700);
        clearInterval(animationTimer);

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Prediction failed.");
        }

        showResult(data);

        // Arduino is controlled locally by the visitor's browser.
        let sent = false;
        if (serialPort) {
            sent = await sendArduinoCommand(data.arduino_command);
        }

        // Show the physical object state rather than exposing the internal
        // Arduino command/result-transfer state in the System Status card.
        // Yellow means the object has just been classified. The status will
        // return to "Waiting for object" when the HC-SR04 reports removal.
        awaitingRemoval = Boolean(serialPort);
        if (objectStatus) objectStatus.textContent = "Object classified";
        setDot(objectDot, "warning");

        if (sent) {
            footerMessage.textContent = "Classification complete • Remove the object for the next scan";
        } else if (!isMobile && !serialPort) {
            footerMessage.textContent = "Classification complete • Connect an Arduino to use automatic scanning";
            // Without an Arduino there is no physical object sensor, so the
            // status can return to the idle state after the result is shown.
            window.setTimeout(() => {
                if (!serialPort && objectStatus) {
                    objectStatus.textContent = "Waiting for object";
                    setDot(objectDot, "online");
                }
            }, 2200);
        } else {
            footerMessage.textContent = "Classification complete • Ready for another scan";
        }
    } catch (error) {
        clearInterval(animationTimer);
        console.error(error);
        resultIcon.textContent = "⚠";
        resultLabel.textContent = "SCAN ERROR";
        resultLabel.style.color = "#ef4444";
        resultConfidence.textContent = "Please try again";
        progressBar.style.width = "0%";
        if (objectStatus) objectStatus.textContent = "Error";
        setDot(objectDot, "offline");
        footerMessage.textContent = "Scan error: " + error.message;
    } finally {
        scanning = false;
        hideScanningAnimation();
        scanButton.disabled = false;
        scanButton.innerHTML = "<span>⌕</span> SCAN NOW";
    }
}

function showResult(data) {
    const isBio = data.result === "BIODEGRADABLE";
    resultIcon.textContent = data.icon;
    resultLabel.textContent = data.result;
    resultLabel.style.color = isBio ? "#22c55e" : "#ef4444";
    resultConfidence.textContent = `Confidence: ${Number(data.confidence).toFixed(1)}%`;
    progressBar.style.width = `${data.confidence}%`;
    progressBar.style.background = isBio ? "#22c55e" : "#ef4444";
    originalLabel.textContent = `AI label: ${data.original_label}`;
}

scanButton.addEventListener("click", () => performScan(false));

resetButton.addEventListener("click", () => {
    resultIcon.textContent = "♻";
    resultLabel.textContent = "WAITING";
    resultLabel.style.color = "#f1f5f9";
    resultConfidence.textContent = "Confidence: --";
    progressBar.style.width = "0%";
    progressBar.style.background = "#22c55e";
    originalLabel.textContent = "No scan performed yet";
    footerMessage.textContent = objectPresent
        ? "Object is still present • Remove it before the next automatic scan"
        : "Ready • Point the camera at a waste item";
});

arduinoButton.addEventListener("click", async () => {
    if (serialPort) await disconnectArduino();
    else await connectArduino();
});

// Handle an Arduino being physically unplugged.
if ("serial" in navigator) {
    navigator.serial.addEventListener("disconnect", event => {
        if (serialPort === event.target) {
            serialKeepReading = false;
            serialPort = null;
            autoScanEnabled = false;
            updateArduinoUI(false, "Arduino disconnected.");
        }
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initialize() {
    startCamera();

    if (isMobile) {
        footerMessage.textContent = "Ready • Point the camera at a waste item";
        return;
    }

    if (!webSerialSupported()) {
        updateArduinoUI(false, "Use Google Chrome or Microsoft Edge to connect an Arduino.");
    } else {
        updateArduinoUI(false, "Connect your Arduino using the button above.");
    }

    await checkStatus();
    setInterval(checkStatus, 10000);
}

initialize();
