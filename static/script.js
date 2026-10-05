const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

const scanButton = document.getElementById("scanButton");
const resetButton = document.getElementById("resetButton");
const arduinoButton = document.getElementById("arduinoButton");
const portSelect = document.getElementById("portSelect");
const refreshPortsButton = document.getElementById("refreshPortsButton");
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

// Device mode: PC keeps the full Arduino workflow; mobile uses camera + AI only.
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const arduinoControls = document.getElementById("arduinoControls");
const connectionArea = document.getElementById("connectionArea");

document.body.dataset.mode = isMobileDevice ? "mobile" : "pc";

let cameraStream = null;
let scanning = false;
let lastSensorEventId = 0;
let objectPresent = false;
let awaitingRemoval = false;
let sensorPolling = false;

function setDot(dot, state) {
    dot.className = "dot";
    if (state === "online") dot.classList.add("online");
    else if (state === "warning") dot.classList.add("warning");
    else dot.classList.add("offline");
}

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: isMobileDevice ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: { ideal: "environment" }
            } : {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = cameraStream;
        cameraMessage.classList.add("hidden");
        cameraBadge.textContent = "READY";
        cameraStatus.textContent = "Ready";
        setDot(cameraDot, "online");
    } catch (error) {
        console.error(error);
        cameraMessage.classList.remove("hidden");
        cameraMessage.innerHTML = `<div class="camera-icon">⚠</div><div>Camera access denied or unavailable</div>`;
        cameraBadge.textContent = "ERROR";
        cameraStatus.textContent = "Error";
        setDot(cameraDot, "offline");
        footerMessage.textContent = "Camera unavailable • Please allow camera permission";
    }
}

async function checkStatus() {
    try {
        const response = await fetch("/api/status");
        const data = await response.json();

        if (data.model_ready) {
            modelStatus.textContent = "Ready";
            setDot(modelDot, "online");
        } else {
            modelStatus.textContent = "Error";
            setDot(modelDot, "offline");
        }

        if (!isMobileDevice) {
            updatePortList(data.ports || [], data.serial_port);
            updateArduinoStatus(data.arduino_connected);

            if (data.sensor) {
                handleSensorData(data.sensor);
            }
        }
    } catch (error) {
        console.error(error);
        modelStatus.textContent = "Offline";
        setDot(modelDot, "offline");
        connectionText.textContent = "Server Offline";
        setDot(connectionDot, "offline");
    }
}

async function pollSensor() {
    if (isMobileDevice) return;
    if (sensorPolling) return;
    sensorPolling = true;

    try {
        const response = await fetch("/api/sensor/status", { cache: "no-store" });
        const data = await response.json();
        handleSensorData(data);
    } catch (error) {
        console.error("Sensor polling error:", error);
    } finally {
        sensorPolling = false;
    }
}

function handleSensorData(data) {
    if (typeof data.event_id === "number" && data.event_id > lastSensorEventId) {
        lastSensorEventId = data.event_id;

        if (data.event === "detected") {
            objectPresent = true;
            objectStatus.textContent = "Object detected";
            setDot(objectDot, "warning");

            if (!scanning && !awaitingRemoval) {
                footerMessage.textContent = "Object detected • Starting automatic scan...";
                autoScan();
            }
        } else if (data.event === "removed") {
            objectPresent = false;
            awaitingRemoval = false;
            objectStatus.textContent = "Waiting for object";
            setDot(objectDot, "online");
            footerMessage.textContent = "Ready • Place an item in front of the sensor";
        }
    }

    if (data.object_present) {
        objectPresent = true;
        if (!scanning && awaitingRemoval) {
            objectStatus.textContent = "Remove object";
            setDot(objectDot, "warning");
        }
    }
}

async function refreshPorts() {
    if (isMobileDevice) return;
    try {
        refreshPortsButton.disabled = true;
        refreshPortsButton.textContent = "…";
        const response = await fetch("/api/ports");
        const data = await response.json();
        updatePortList(data.ports || [], portSelect.value);
        footerMessage.textContent = data.ports?.length
            ? `${data.ports.length} serial port(s) detected.`
            : "No COM ports detected. Connect the Arduino and refresh.";
    } catch (error) {
        footerMessage.textContent = "Could not refresh COM ports.";
    } finally {
        refreshPortsButton.disabled = false;
        refreshPortsButton.textContent = "↻";
    }
}

function updatePortList(ports, preferredPort) {
    const current = portSelect.value;
    portSelect.innerHTML = "";

    if (!ports.length) {
        const option = document.createElement("option");
        option.value = preferredPort || "COM7";
        option.textContent = `${preferredPort || "COM7"} — not detected`;
        portSelect.appendChild(option);
        portSelect.value = preferredPort || "COM7";
        portText.textContent = `${portSelect.value} • 9600 baud`;
        return;
    }

    ports.forEach(port => {
        const option = document.createElement("option");
        option.value = port.device;
        option.textContent = port.description ? `${port.device} — ${port.description}` : port.device;
        portSelect.appendChild(option);
    });

    const target = preferredPort || current;
    if ([...portSelect.options].some(o => o.value === target)) portSelect.value = target;
    portText.textContent = `${portSelect.value} • 9600 baud`;
}

function updateArduinoStatus(connected) {
    if (connected) {
        connectionText.textContent = `Arduino ${portSelect.value}`;
        setDot(connectionDot, "online");
        arduinoStatus.textContent = "Connected";
        setDot(arduinoDot, "online");
        arduinoButton.textContent = "Disconnect Arduino";
    } else {
        connectionText.textContent = "Arduino Offline";
        setDot(connectionDot, "offline");
        arduinoStatus.textContent = "Disconnected";
        setDot(arduinoDot, "offline");
        arduinoButton.textContent = "Connect Arduino";
    }
}

if (!isMobileDevice) arduinoButton.addEventListener("click", async () => {
    const currentlyConnected = arduinoButton.textContent.includes("Disconnect");
    arduinoButton.disabled = true;

    try {
        if (currentlyConnected) {
            await fetch("/api/arduino/disconnect", { method: "POST" });
        } else {
            const selectedPort = portSelect.value;
            arduinoStatus.textContent = "Connecting...";
            setDot(arduinoDot, "warning");
            connectionText.textContent = `Connecting to ${selectedPort}...`;

            const response = await fetch("/api/arduino/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port: selectedPort })
            });

            const data = await response.json();
            footerMessage.textContent = data.success
                ? `Arduino connected on ${data.port}. Waiting for object...`
                : `Arduino connection failed on ${selectedPort}: ${data.message}`;
        }

        await checkStatus();
    } catch (error) {
        footerMessage.textContent = "Arduino connection request failed.";
    }

    arduinoButton.disabled = false;
});

portSelect.addEventListener("change", () => {
    portText.textContent = `${portSelect.value} • 9600 baud`;
    if (!arduinoButton.textContent.includes("Disconnect")) {
        footerMessage.textContent = `Selected Arduino port: ${portSelect.value}`;
    }
});

refreshPortsButton.addEventListener("click", refreshPorts);

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
    objectStatus.textContent = automatic ? "Auto scanning" : "Scanning";
    setDot(objectDot, "warning");
    footerMessage.textContent = automatic
        ? "Object detected • AI scanning automatically..."
        : "AI scanning in progress...";

    const animationTimer = showScanningAnimation();

    try {
        await sleep(1800);
        const imageBlob = await captureFrame();
        const formData = new FormData();
        formData.append("image", imageBlob, "camera.jpg");

        const response = await fetch("/api/predict", {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        await sleep(700);
        clearInterval(animationTimer);

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Prediction failed.");
        }

        showResult(data);
        awaitingRemoval = true;
        objectStatus.textContent = "Remove object";
        setDot(objectDot, "warning");
        footerMessage.textContent = "Classification complete • Remove the object for the next scan";

    } catch (error) {
        clearInterval(animationTimer);
        console.error(error);

        resultIcon.textContent = "⚠";
        resultLabel.textContent = "SCAN ERROR";
        resultLabel.style.color = "#ef4444";
        resultConfidence.textContent = "Please try again";
        progressBar.style.width = "0%";
        objectStatus.textContent = "Error";
        setDot(objectDot, "offline");
        footerMessage.textContent = "Scan error: " + error.message;
    } finally {
        scanning = false;
        hideScanningAnimation();
        scanButton.disabled = false;
        scanButton.innerHTML = "<span>⌕</span> SCAN NOW";
    }
}

scanButton.addEventListener("click", () => performScan(false));

function showResult(data) {
    const isBio = data.result === "BIODEGRADABLE";
    resultIcon.textContent = data.icon;
    resultLabel.textContent = data.result;
    resultLabel.style.color = isBio ? "#22c55e" : "#ef4444";
    resultConfidence.textContent = `Confidence: ${data.confidence.toFixed(1)}%`;
    progressBar.style.width = `${data.confidence}%`;
    progressBar.style.background = isBio ? "#22c55e" : "#ef4444";
    originalLabel.textContent = `AI label: ${data.original_label}`;
}

resetButton.addEventListener("click", () => {
    resultIcon.textContent = "♻";
    resultLabel.textContent = "WAITING";
    resultLabel.style.color = "#f1f5f9";
    resultConfidence.textContent = "Confidence: --";
    progressBar.style.width = "0%";
    progressBar.style.background = "#22c55e";
    originalLabel.textContent = "No scan performed yet";
    footerMessage.textContent = isMobileDevice
        ? "Ready • Point the camera at an item and press SCAN NOW"
        : (objectPresent
            ? "Object is still present • Remove it before the next automatic scan"
            : "Ready • Place an item in front of the sensor");
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function configureDeviceMode() {
    if (isMobileDevice) {
        // Hide all Arduino-specific UI on phones.
        arduinoControls?.classList.add("mobile-hidden");
        connectionArea?.classList.add("mobile-hidden");
        arduinoDot?.closest(".status-row")?.classList.add("mobile-hidden");
        objectDot?.closest(".status-row")?.classList.add("mobile-hidden");

        cameraBadge.textContent = "PHONE CAMERA";
        objectStatus.textContent = "Camera scan";
        setDot(objectDot, "online");
        footerMessage.textContent = "Mobile mode • Allow camera access, then press SCAN NOW";
    }
}

configureDeviceMode();
startCamera();
checkStatus();
if (!isMobileDevice) refreshPorts();
setInterval(checkStatus, 5000);
setInterval(pollSensor, 250);
