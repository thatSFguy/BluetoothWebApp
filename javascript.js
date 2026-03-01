
/* =========================
   BLE UUIDs (match firmware)
   ========================= */
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const COMMAND_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const DATA_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/* ================
   BLE Globals
   ================ */
let bleDevice = null;
let gattServer = null;
let commandCharacteristic = null;
let dataCharacteristic = null;

/* ================
   Device Profile & Capability Maps
   ================ */
let deviceProfile = { maker: null, api: null, identified: false, capabilities: {} };
let dynamicUIBuilt = false;

const SENSOR_TILES = {
    Pri: { label: 'Primers', id: 'primer' },
    Cas: { label: 'Cases', id: 'case' },
    Bul: { label: 'Bullets', id: 'bullet' },
    CaseObs: { label: 'Case Obstruction', id: 'caseobs' },
    PdAlign: { label: 'Primer Disk', id: 'pdalign' },
    PowChk: { label: 'Powder Check', id: 'powchk' }
};

const SETTINGS_MAP = {
    DwellAct: { label: 'Dwell Beep Active', desc: 'Plays dwell beep on each counted cycle', type: 'toggle', cmd: 'DWELL_ACTIVE', inputId: 'dwellActiveToggle' },
    DwellDur: { label: 'Dwell Duration (ms)', desc: null, type: 'range', cmd: 'DWELL_DUR', inputId: 'dwellDuration', min: 50, max: 5000, step: 50 },
    MotorEn: { label: 'Motor Control Enabled', desc: 'Allow the web dashboard + firmware to run the motor', type: 'toggle', cmd: 'MOTOR_EN', inputId: 'motorEnToggle' }
};

/* ================
   Recipe Load Globals
   ================ */
let activeRecipeId = null;
const SESSION_LOG_KEY = 'reloading_session_log_v1';
let sessionLog = JSON.parse(localStorage.getItem(SESSION_LOG_KEY)) || [];
let lastCount = null;
const expandedRecipes = new Set();
let recipeViewMode = localStorage.getItem('recipe_view_mode') || 'cards';

/* ================
   Theme Toggle
   ================ */
function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = isLight ? '\u2600' : '\u263E';
}

function applyStoredTheme() {
    const stored = localStorage.getItem('theme');
    if (stored === 'light') {
        document.body.classList.add('light');
        const btn = document.getElementById('themeToggleBtn');
        if (btn) btn.textContent = '\u2600';
    }
}

/* ================
   Recipe View Toggle
   ================ */
function setRecipeView(mode) {
    recipeViewMode = mode;
    localStorage.setItem('recipe_view_mode', mode);
    document.getElementById('viewCardsBtn').classList.toggle('active', mode === 'cards');
    document.getElementById('viewTableBtn').classList.toggle('active', mode === 'table');
    renderRecipes(currentFilter);
}

/* ================
   Web Alert Sound
   ================ */
let audioCtx = null;
let alertPlaying = false;
const criticalState = {};

function playAlertTone() {
    if (isMuted || alertPlaying) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    alertPlaying = true;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.3;

    // Pulse the frequency for urgency
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.3);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.6);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.9);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 1.2);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 1.5);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 1.8);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 2.1);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 2.4);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 2.7);

    // Fade out at the end
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime + 2.5);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 3);
    osc.onended = () => { alertPlaying = false; };
}

function checkCriticalAlerts(data) {
    const checks = {
        Pri: data.Pri, Cas: data.Cas, Bul: data.Bul,
        CaseObs: data.CaseObs, PdAlign: data.PdAlign, PowChk: data.PowChk
    };

    // Powder critical at <= 5%
    if (data.Powder !== undefined) {
        checks.PowderCritical = data.Powder <= 5 ? 0 : 1;
    }

    for (const [key, val] of Object.entries(checks)) {
        if (val === undefined) continue;
        const wasCritical = criticalState[key] === true;
        const isCritical = val === 0;

        if (isCritical && !wasCritical) {
            playAlertTone();
        }
        criticalState[key] = isCritical;
    }
}

/* ================
   Mute Toggle (header button)
   ================ */
let isMuted = false;

function toggleMute() {
    isMuted = !isMuted;
    sendCommand(`CMD=SET_MUTE_${isMuted ? 1 : 0}`);
    updateMuteButton();
}

function updateMuteButton() {
    const btn = document.getElementById('muteToggleBtn');
    if (!btn) return;
    btn.textContent = isMuted ? '\uD83D\uDD07' : '\uD83D\uDD08';
    btn.title = isMuted ? 'Unmute alerts' : 'Mute alerts';
}

/* UI refs — populated on load + rebindUIRefs() after dynamic build */
const ui = {
    connectionStatus: null,
    deviceInfo: null,
    connectButton: null,
    disconnectButton: null,
    totalCount: null,
    powderLevel: null,
    systemStatusText: null,
    commandFeedback: null,
};

function bindStaticUI() {
    ui.connectionStatus = document.getElementById('connectionStatus');
    ui.deviceInfo = document.getElementById('deviceInfo');
    ui.connectButton = document.getElementById('connectButton');
    ui.disconnectButton = document.getElementById('disconnectButton');
    ui.commandFeedback = document.getElementById('commandFeedback');
    ui.systemStatusText = document.getElementById('systemStatusText');
}

/* Parse incoming BLE data string into object */
function parseData(valueString) {
    const obj = {};
    try {
        valueString.split(',').forEach(pair => {
            const [k, v] = pair.split('=');
            if (!k) return;
            const n = parseInt((v||'').trim(), 10);
            obj[k.trim()] = Number.isNaN(n) ? (v||'').trim() : n;
        });
    } catch (e) {
        console.error("parseData error:", e);
    }
    return obj;
}

/* ================
   Device Identification
   ================ */
function identifyDevice(parsed) {
    if (parsed.Maker) {
        deviceProfile.maker = parsed.Maker;
        deviceProfile.api = parsed.API || null;
        deviceProfile.identified = true;
        console.log(`Device identified: ${deviceProfile.maker} (API ${deviceProfile.api})`);
        return true;
    }
    return false;
}

function detectCapabilities(parsed) {
    for (const key of Object.keys(parsed)) {
        deviceProfile.capabilities[key] = true;
    }
    if (!deviceProfile.identified) {
        deviceProfile.maker = 'Dillon';
        deviceProfile.identified = true;
        console.log("No device ID message — defaulting to Dillon 1050");
    }
}

/* ================
   Tile Action Panels
   ================ */
function toggleTileActions(panelId) {
    const panel = document.getElementById(panelId + 'Actions');
    if (panel) panel.classList.toggle('hidden');
}

/* ================
   Device Settings Toggle
   ================ */
function toggleDeviceSettings() {
    const panel = document.getElementById('deviceSettingsPanel');
    if (panel) panel.classList.toggle('hidden');
}

/* ================
   Dynamic UI Building
   ================ */
function buildDynamicUI() {
    const caps = deviceProfile.capabilities;
    const maker = deviceProfile.maker;
    const isAmmoload = (maker === 'Ammoload');

    // --- Data Tiles (own row) + Sensor Tiles (rows below) ---
    const tilesContainer = document.getElementById('componentTilesContainer');
    let dataHTML = '';
    let sensorHTML = '';

    // Total Rounds (clickable with actions — +/- always shown)
    dataHTML += `
        <div class="data-tile" onclick="toggleTileActions('rounds')">
            <div class="font-medium text-gray-400">Total Rounds</div>
            <div id="totalCount" class="data-tile-value text-indigo-400 mt-1">--</div>
            <div class="small-muted mt-1">Tap to adjust</div>
            <div id="roundsActions" class="tile-actions hidden" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-red" onclick="event.stopPropagation(); sendCommand('CMD=RESET_COUNT')">Reset</button>
                <button class="btn btn-sm btn-green" onclick="event.stopPropagation(); sendCommand('CMD=COUNT_UP')">+1</button>
                <button class="btn btn-sm btn-yellow" onclick="event.stopPropagation(); sendCommand('CMD=COUNT_DOWN')">-1</button>
            </div>
        </div>`;

    // Powder Level (clickable with calibration)
    if (caps.Powder) {
        dataHTML += `
        <div class="data-tile" onclick="toggleTileActions('powder')">
            <div class="font-medium text-gray-400">Powder Level</div>
            <div id="powderLevel" class="data-tile-value text-green-400 mt-1">--%</div>
            <div class="small-muted mt-1">Tap to calibrate</div>
            <div id="powderActions" class="tile-actions hidden" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-blue" onclick="event.stopPropagation(); sendCommand('CMD=CAL_HIGH')">Cal Full</button>
                <button class="btn btn-sm btn-yellow" onclick="event.stopPropagation(); sendCommand('CMD=CAL_LOW')">Cal Empty</button>
            </div>
        </div>`;
    }

    // Motor Status (data tile, next to powder)
    if (caps.Mot) {
        dataHTML += `
        <div class="data-tile" id="motorTile">
            <div class="font-medium text-gray-400">Motor</div>
            <div id="motorStatusText" class="data-tile-value text-gray-400 mt-1">--</div>
        </div>`;
    }

    // Sensor tiles (binary OK/LOW indicators)
    for (const [field, info] of Object.entries(SENSOR_TILES)) {
        if (caps[field]) {
            sensorHTML += `
            <div id="${info.id}Tile" class="status-tile status-tile-unknown">
                <div class="font-medium">${info.label}</div>
                <div id="${info.id}StatusText" class="text-2xl font-bold mt-2">--</div>
            </div>`;
        }
    }

    tilesContainer.innerHTML =
        `<div class="grid-data-tiles">${dataHTML}</div>` +
        (sensorHTML ? `<div class="grid-sensor-tiles">${sensorHTML}</div>` : '');

    // Show component section
    const componentSection = document.getElementById('componentSection');
    if (componentSection) componentSection.classList.remove('hidden');

    // --- Device Settings (in connection card) ---
    const settingsContainer = document.getElementById('settingsContainer');
    let settingsHTML = '';
    for (const [field, info] of Object.entries(SETTINGS_MAP)) {
        if (!caps[field]) continue;
        if (info.type === 'toggle') {
            settingsHTML += `
            <div class="setting-row">
                <div>
                    <div class="font-semibold">${info.label}</div>
                    ${info.desc ? `<div class="small-muted">${info.desc}</div>` : ''}
                </div>
                <input id="${info.inputId}" type="checkbox" class="checkbox-lg" onchange="updateSetting('${info.cmd}', this.checked ? 1 : 0)">
            </div>`;
        } else if (info.type === 'range') {
            settingsHTML += `
            <div>
                <label class="font-semibold">${info.label}</label>
                <input id="${info.inputId}" type="range" min="${info.min}" max="${info.max}" step="${info.step}" class="range-full" oninput="document.getElementById('dwellDurationValue').textContent = this.value" onchange="updateSetting('${info.cmd}', this.value)">
                <div id="dwellDurationValue" class="small-muted mt-1">--</div>
            </div>`;
        }
    }
    settingsContainer.innerHTML = settingsHTML || '<p class="text-gray-500">No configurable settings for this device.</p>';

    // Show settings toggle if there are settings
    const settingsToggle = document.getElementById('deviceSettingsToggle');
    if (settingsToggle && settingsHTML !== '') {
        settingsToggle.classList.remove('hidden');
    }

    // Show mute button in header if device supports it
    const muteBtn = document.getElementById('muteToggleBtn');
    if (muteBtn && caps.Mute) muteBtn.classList.remove('hidden');

    dynamicUIBuilt = true;
}

/* Re-query DOM elements after dynamic HTML is inserted */
function rebindUIRefs() {
    ui.totalCount = document.getElementById('totalCount');
    ui.powderLevel = document.getElementById('powderLevel');

    // Motor (data tile, not in SENSOR_TILES)
    ui.motorTile = document.getElementById('motorTile');
    ui.motorStatusText = document.getElementById('motorStatusText');

    // Sensor tiles
    for (const [field, info] of Object.entries(SENSOR_TILES)) {
        ui[info.id + 'Tile'] = document.getElementById(info.id + 'Tile');
        ui[info.id + 'StatusText'] = document.getElementById(info.id + 'StatusText');
    }

    // Settings
    // Mute is now handled by header button, not settings panel
    ui.dwellActiveToggle = document.getElementById('dwellActiveToggle');
    ui.dwellDuration = document.getElementById('dwellDuration');
    ui.dwellDurationValue = document.getElementById('dwellDurationValue');
    ui.motorEnToggle = document.getElementById('motorEnToggle');
}

/* ================
   Update UI based on parsed data (null-safe)
   ================ */
function updateUI(data) {
    // Check for new critical alerts
    checkCriticalAlerts(data);

    // Rounds
    if (ui.totalCount) {
        if (data.Cnt !== undefined) {
            ui.totalCount.textContent = data.Cnt;
            if (activeRecipeId !== null && lastCount !== null && data.Cnt > lastCount) {
                logCompletedRound(data.Cnt);
            }
            lastCount = data.Cnt;
        } else {
            ui.totalCount.textContent = '--';
        }
    }

    // Powder percentage
    if (ui.powderLevel) {
        if (data.Powder !== undefined) {
            ui.powderLevel.textContent = `${data.Powder}%`;
            if (data.Powder <= 5) {
                ui.powderLevel.className = 'data-tile-value text-red-400 mt-1';
            } else if (data.Powder < 20) {
                ui.powderLevel.className = 'data-tile-value text-yellow-400 mt-1';
            } else {
                ui.powderLevel.className = 'data-tile-value text-green-400 mt-1';
            }
        } else {
            ui.powderLevel.textContent = '--%';
            ui.powderLevel.className = 'data-tile-value text-gray-400 mt-1';
        }
    }

    // Generic sensor tile status
    function applyStatus(tileEl, textEl, val) {
        if (!tileEl || !textEl) return;
        const displayVal = (val === 1) ? 'OK' : (val === 0 ? 'LOW!' : '--');
        const cls = (val === 1) ? 'status-tile status-tile-ok' : (val === 0 ? 'status-tile status-tile-low' : 'status-tile status-tile-unknown');
        tileEl.className = cls;
        textEl.textContent = displayVal;
    }

    applyStatus(ui.primerTile, ui.primerStatusText, data.Pri);
    applyStatus(ui.caseTile, ui.caseStatusText, data.Cas);
    applyStatus(ui.bulletTile, ui.bulletStatusText, data.Bul);
    applyStatus(ui.caseobsTile, ui.caseobsStatusText, data.CaseObs);
    applyStatus(ui.pdalignTile, ui.pdalignStatusText, data.PdAlign);
    applyStatus(ui.powchkTile, ui.powchkStatusText, data.PowChk);

    // Motor special handling (data tile)
    if (ui.motorTile && ui.motorStatusText) {
        if (data.Mot !== undefined) {
            if (data.Mot === 1) {
                ui.motorStatusText.textContent = 'FWD';
                ui.motorStatusText.className = 'data-tile-value text-green-400 mt-1';
            } else if (data.Mot === 2) {
                ui.motorStatusText.textContent = 'REV';
                ui.motorStatusText.className = 'data-tile-value text-red-400 mt-1';
            } else {
                ui.motorStatusText.textContent = 'IDLE';
                ui.motorStatusText.className = 'data-tile-value text-gray-400 mt-1';
            }
        } else {
            ui.motorStatusText.textContent = '--';
            ui.motorStatusText.className = 'data-tile-value text-gray-400 mt-1';
        }
    }

    // System status
    if (ui.systemStatusText) {
        let systemText = '--', systemClass = 'text-white';
        const powderCritical = (data.Powder !== undefined && data.Powder <= 5);
        const componentCritical = (data.Pri === 0 || data.Cas === 0 || data.Bul === 0);
        const extraCritical = (data.CaseObs === 0 || data.PdAlign === 0 || data.PowChk === 0);
        if (!componentCritical && !powderCritical && !extraCritical && data.Pri !== undefined) {
            systemText = 'OK';
            systemClass = 'text-green-400';
        } else if (componentCritical || powderCritical || extraCritical) {
            systemText = 'CRITICAL';
            systemClass = 'text-red-400';
        }
        ui.systemStatusText.textContent = systemText;
        ui.systemStatusText.className = `system-status-value ${systemClass}`;
    }

    // Settings reflected from firmware
    const now = Date.now();
    const debounce = 300;
    if (data.Mute !== undefined && (now - lastUserSettingChange > debounce)) {
        isMuted = !!data.Mute;
        updateMuteButton();
    }
    if (ui.dwellActiveToggle && data.DwellAct !== undefined && (now - lastUserSettingChange > debounce || ui.dwellActiveToggle.checked !== !!data.DwellAct)) {
        ui.dwellActiveToggle.checked = !!data.DwellAct;
    }
    if (ui.motorEnToggle && data.MotorEn !== undefined && (now - lastUserSettingChange > debounce || ui.motorEnToggle.checked !== !!data.MotorEn)) {
        ui.motorEnToggle.checked = !!data.MotorEn;
    }
    if (ui.dwellDuration && ui.dwellDurationValue && data.DwellDur !== undefined && (now - lastUserSettingChange > debounce || ui.dwellDuration.value != data.DwellDur)) {
        ui.dwellDuration.value = data.DwellDur;
        ui.dwellDurationValue.textContent = data.DwellDur;
    }
}

/* Show feedback message temporarily */
let feedbackTimer = null;
function showMessage(msg, type='info') {
    if (!ui.commandFeedback) return;
    ui.commandFeedback.textContent = msg;
    ui.commandFeedback.style.opacity = 1;
    ui.commandFeedback.className = (type === 'error') ? 'text-red-400 small-muted' : 'text-green-400 small-muted';
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(()=> {
        ui.commandFeedback.style.opacity = 0;
    }, 2500);
}

/* SEND COMMAND */
async function sendCommand(commandString) {
    if (!commandCharacteristic) {
        showMessage("Not connected", "error");
        return;
    }
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(commandString);
        if (commandCharacteristic.properties.writeWithoutResponse) {
            await commandCharacteristic.writeValueWithoutResponse(data);
        } else {
            await commandCharacteristic.writeValue(data);
        }
        showMessage(`Sent: ${commandString}`);
    } catch (err) {
        console.error("sendCommand error:", err);
        showMessage("Send failed", "error");
    }
}

/* Settings wrapper */
let lastUserSettingChange = 0;
function updateSetting(name, value) {
    const v = parseInt(value, 10);
    if (Number.isNaN(v)) return;
    sendCommand(`CMD=SET_${name}_${v}`);
    if (name === 'MUTE') { isMuted = !!v; updateMuteButton(); }
    if (name === 'DWELL_ACTIVE' && ui.dwellActiveToggle) ui.dwellActiveToggle.checked = !!v;
    if (name === 'MOTOR_EN' && ui.motorEnToggle) ui.motorEnToggle.checked = !!v;
    if (name === 'DWELL_DUR' && ui.dwellDuration && ui.dwellDurationValue) {
        ui.dwellDuration.value = v;
        ui.dwellDurationValue.textContent = v;
    }
    lastUserSettingChange = Date.now();
}

/* BLE connect */
async function connectBLE() {
    if (!navigator.bluetooth) {
        showMessage("Web Bluetooth not supported", "error");
        if (ui.connectionStatus) ui.connectionStatus.textContent = "Status: Web Bluetooth not supported in this browser.";
        return;
    }
    try {
        if (ui.connectionStatus) {
            ui.connectionStatus.textContent = "Status: Scanning...";
            ui.connectionStatus.classList.remove('text-red-400');
            ui.connectionStatus.classList.add('text-yellow-400');
        }

        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        if (ui.deviceInfo) ui.deviceInfo.textContent = `BLE Device: ${bleDevice.name || 'Unknown'}`;
        if (ui.connectionStatus) ui.connectionStatus.textContent = "Status: Connecting...";

        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        gattServer = await bleDevice.gatt.connect();
        const service = await gattServer.getPrimaryService(SERVICE_UUID);
        commandCharacteristic = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);
        dataCharacteristic = await service.getCharacteristic(DATA_CHARACTERISTIC_UUID);

        if (dataCharacteristic.properties.notify) {
            await dataCharacteristic.startNotifications();
            dataCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicUpdates);
        }

        if (ui.connectionStatus) {
            ui.connectionStatus.textContent = "Status: Connected";
            ui.connectionStatus.classList.remove('text-yellow-400', 'text-red-400');
            ui.connectionStatus.classList.add('text-green-400');
        }
        if (ui.connectButton) ui.connectButton.classList.add('hidden');
        if (ui.disconnectButton) ui.disconnectButton.classList.remove('hidden');

        showMessage("Connected", "info");
    } catch (err) {
        console.error("connectBLE error:", err);
        if (ui.connectionStatus) {
            ui.connectionStatus.textContent = `Status: Conn failed (${err && err.name ? err.name : 'error'})`;
            ui.connectionStatus.classList.remove('text-yellow-400');
            ui.connectionStatus.classList.add('text-red-400');
        }
        if (ui.deviceInfo) ui.deviceInfo.textContent = 'BLE Device: N/A';
        showMessage("Connection failed", "error");
    }
}

function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
        bleDevice.gatt.disconnect();
    }
}

/* On disconnect */
function onDisconnected() {
    console.log("Device disconnected");
    if (ui.connectionStatus) {
        ui.connectionStatus.textContent = "Status: Disconnected";
        ui.connectionStatus.classList.remove('text-green-400');
        ui.connectionStatus.classList.add('text-red-400');
    }
    if (ui.connectButton) ui.connectButton.classList.remove('hidden');
    if (ui.disconnectButton) ui.disconnectButton.classList.add('hidden');

    // Reset system status
    if (ui.systemStatusText) {
        ui.systemStatusText.textContent = '--';
        ui.systemStatusText.className = 'system-status-value text-white';
    }

    // Reset device profile
    deviceProfile = { maker: null, api: null, identified: false, capabilities: {} };
    dynamicUIBuilt = false;

    // Clear dynamic containers
    const tiles = document.getElementById('componentTilesContainer');
    const settings = document.getElementById('settingsContainer');
    if (tiles) tiles.innerHTML = '';
    if (settings) settings.innerHTML = '';

    // Hide mute button
    const muteBtn = document.getElementById('muteToggleBtn');
    if (muteBtn) muteBtn.classList.add('hidden');
    isMuted = false;

    // Hide sections
    const componentSection = document.getElementById('componentSection');
    if (componentSection) componentSection.classList.add('hidden');
    const settingsToggle = document.getElementById('deviceSettingsToggle');
    const settingsPanel = document.getElementById('deviceSettingsPanel');
    if (settingsToggle) settingsToggle.classList.add('hidden');
    if (settingsPanel) settingsPanel.classList.add('hidden');
}

/* Handle incoming notifications */
function handleCharacteristicUpdates(event) {
    try {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const raw = decoder.decode(value);
        const parsed = parseData(raw);

        if (!deviceProfile.identified && identifyDevice(parsed)) return;

        if (!dynamicUIBuilt) {
            detectCapabilities(parsed);
            buildDynamicUI();
            rebindUIRefs();
        }

        updateUI(parsed);
    } catch (e) {
        console.error("characteristic update error:", e);
    }
}

/* On load */
window.addEventListener('load', () => {
    bindStaticUI();
    applyStoredTheme();
    // Restore view toggle state
    const storedView = localStorage.getItem('recipe_view_mode') || 'cards';
    recipeViewMode = storedView;
    const cardsBtn = document.getElementById('viewCardsBtn');
    const tableBtn = document.getElementById('viewTableBtn');
    if (cardsBtn) cardsBtn.classList.toggle('active', storedView === 'cards');
    if (tableBtn) tableBtn.classList.toggle('active', storedView === 'table');

    if (!('bluetooth' in navigator)) {
        if (ui.connectButton) {
            ui.connectButton.disabled = true;
            ui.connectButton.textContent = "BLE Not Supported";
        }
        if (ui.connectionStatus) {
            ui.connectionStatus.textContent = "Status: BLE Not Supported";
        }
    }
});

/* Keyboard shortcut */
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') connectBLE();
});

/* ==================== LOAD RECIPES SYSTEM ==================== */
const STORAGE_KEY = 'reloading_press_recipes_v1';
const OPTIONS_KEY = 'reloading_press_options_v1';

let recipes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let options = JSON.parse(localStorage.getItem(OPTIONS_KEY)) || {
    caliber: ['9mm Luger', '40 S&W', '45 ACP', '38 Special', '357 Magnum', '223 Rem', '308 Win', '6.5 Creedmoor', 'Other'],
    mfg: ['Winchester', 'Federal', 'CCI', 'Remington', 'Hornady', 'Lapua', 'Starline', 'Speer', 'Nosler', 'Sierra', 'Other'],
    primerType: ['Small Pistol', 'Large Pistol', 'Small Rifle', 'Large Rifle'],
    bulletType: ['FMJ', 'JHP', 'LFP', 'HPBT', 'Polymer Tip', 'Soft Point', 'Other']
};
let nextId = recipes.length > 0 ? Math.max(...recipes.map(r => r.id)) + 1 : 1;
let currentFilter = '';

function saveRecipes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

function saveOptions() {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    closeOptionsModal();
    renderRecipes();
    showMessage("Options updated!", "info");
}

/* ==================== RECIPE RENDERING ==================== */
function renderRecipes(filter = '') {
    currentFilter = filter.toLowerCase();
    const container = document.getElementById('recipesContainer');
    container.innerHTML = '';

    let filtered = recipes.filter(r => JSON.stringify(r).toLowerCase().includes(currentFilter));
    filtered.sort((a, b) => a.id - b.id);

    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center mt-4">No recipes found. Click "+ Add Recipe" to create one.</p>';
        updateActiveLoadDisplay();
        renderSessionLog();
        return;
    }

    if (recipeViewMode === 'table') {
        renderRecipesTable(filtered, container);
    } else {
        renderRecipesCards(filtered, container);
    }

    updateActiveLoadDisplay();
    renderSessionLog();
}

function renderRecipesTable(filtered, container) {
    const html = `
        <div class="overflow-x-auto">
        <table class="recipe-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Caliber</th>
                    <th>Notes</th>
                    <th>Bullet</th>
                    <th>Powder</th>
                    <th>Primer</th>
                    <th>Case</th>
                    <th>FPS</th>
                    <th>PF</th>
                    <th>Loaded</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(r => {
                    const isActive = activeRecipeId === r.id;
                    const pf = calculatePF(r.bulletGrain, r.fps);
                    const bullet = [r.bulletMfg, r.bulletType, r.bulletGrain ? r.bulletGrain + 'gr' : ''].filter(Boolean).join(' ');
                    const powder = [r.powderMfg, r.powderType, r.powderGrain ? r.powderGrain + 'gr' : ''].filter(Boolean).join(' ');
                    const primer = [r.primerMfg, r.primerType].filter(Boolean).join(' ');
                    const casInfo = [r.caseMfg, r.caseLength, r.caseOal].filter(Boolean).join(' / ');
                    return `
                    <tr class="${isActive ? 'recipe-row-active' : ''}" style="cursor:pointer" onclick="toggleRecipeDetail(${r.id})">
                        <td>${r.id}</td>
                        <td class="font-semibold whitespace-nowrap">${escapeHtml(r.caliber || '')}</td>
                        <td>${escapeHtml(r.notes || '')}</td>
                        <td>${escapeHtml(bullet) || '--'}</td>
                        <td>${escapeHtml(powder) || '--'}</td>
                        <td>${escapeHtml(primer) || '--'}</td>
                        <td>${escapeHtml(casInfo) || '--'}</td>
                        <td class="text-center">${r.fps || '--'}</td>
                        <td class="text-center font-bold">${pf}</td>
                        <td class="text-center">${(r.lifetimeTotal || 0).toLocaleString()}</td>
                        <td class="whitespace-nowrap">
                            ${!isActive
                                ? `<button onclick="event.stopPropagation(); setActiveLoad(${r.id})" class="btn btn-sm btn-indigo">Active</button>`
                                : '<span class="recipe-active-badge">Active</span>'
                            }
                            <button onclick="event.stopPropagation(); deleteRecipe(${r.id})" class="btn btn-sm btn-red">Del</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>`;
    container.innerHTML = html;
}

function renderRecipesCards(filtered, container) {
    filtered.forEach(recipe => {
        const isActive = activeRecipeId === recipe.id;
        const isExpanded = expandedRecipes.has(recipe.id);
        const pf = calculatePF(recipe.bulletGrain, recipe.fps);

        const parts = [];
        if (recipe.bulletMfg || recipe.bulletType || recipe.bulletGrain) {
            parts.push([recipe.bulletMfg, recipe.bulletType, recipe.bulletGrain ? recipe.bulletGrain + 'gr' : ''].filter(Boolean).join(' '));
        }
        if (recipe.powderMfg || recipe.powderType || recipe.powderGrain) {
            parts.push([recipe.powderMfg, recipe.powderType, recipe.powderGrain ? recipe.powderGrain + 'gr' : ''].filter(Boolean).join(' '));
        }
        if (recipe.primerMfg || recipe.primerType) {
            parts.push([recipe.primerMfg, recipe.primerType].filter(Boolean).join(' '));
        }
        const quickInfo = parts.join('  &bull;  ') || 'No component data';

        const card = document.createElement('div');
        card.className = `recipe-card${isActive ? ' recipe-card-active' : ''}`;
        card.innerHTML = `
            <div class="recipe-summary" onclick="toggleRecipeDetail(${recipe.id})">
                <div>
                    <div class="recipe-header">
                        <span class="recipe-id">#${recipe.id}</span>
                        <span class="recipe-caliber">${escapeHtml(recipe.caliber || 'No caliber')}</span>
                        ${isActive ? '<span class="recipe-active-badge">Active</span>' : ''}
                    </div>
                    ${recipe.notes ? `<div class="recipe-notes">${escapeHtml(recipe.notes)}</div>` : ''}
                    <div class="recipe-quick-info">${quickInfo}</div>
                    <div class="recipe-meta">
                        ${recipe.firearm ? `<span>${escapeHtml(recipe.firearm)}</span>` : ''}
                        ${recipe.fps ? `<span>${recipe.fps} fps</span>` : ''}
                        <span class="recipe-lifetime">${(recipe.lifetimeTotal || 0).toLocaleString()} loaded</span>
                    </div>
                </div>
                <div>
                    <span class="recipe-pf" id="pf-${recipe.id}">${pf !== '--' ? 'PF ' + pf : ''}</span>
                </div>
            </div>
            <div class="recipe-detail ${isExpanded ? '' : 'hidden'}" id="recipe-detail-${recipe.id}">
                <div class="recipe-form">
                    <div class="recipe-field">
                        <label>Caliber</label>
                        <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'caliber', this.value)">${optionsHtml(options.caliber, recipe.caliber)}</select>
                    </div>
                    <div class="recipe-field">
                        <label>Notes</label>
                        <input type="text" maxlength="200" class="input-cell" value="${escapeHtml(recipe.notes || '')}" onchange="updateRecipe(${recipe.id}, 'notes', this.value)">
                    </div>
                    <div class="recipe-field">
                        <label>Case (MFG / Length / OAL)</label>
                        <div class="recipe-field-inputs">
                            <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'caseMfg', this.value)">${optionsHtml(options.mfg, recipe.caseMfg)}</select>
                            <input type="number" step="0.001" placeholder="Length" class="input-cell" value="${recipe.caseLength || ''}" onchange="updateRecipe(${recipe.id}, 'caseLength', this.value)">
                            <input type="number" step="0.001" placeholder="OAL" class="input-cell" value="${recipe.caseOal || ''}" onchange="updateRecipe(${recipe.id}, 'caseOal', this.value)">
                        </div>
                    </div>
                    <div class="recipe-field">
                        <label>Primer (MFG / Type)</label>
                        <div class="recipe-field-inputs">
                            <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'primerMfg', this.value)">${optionsHtml(options.mfg, recipe.primerMfg)}</select>
                            <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'primerType', this.value)">${optionsHtml(options.primerType, recipe.primerType)}</select>
                        </div>
                    </div>
                    <div class="recipe-field">
                        <label>Bullet (MFG / Type / Grain)</label>
                        <div class="recipe-field-inputs">
                            <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'bulletMfg', this.value)">${optionsHtml(options.mfg, recipe.bulletMfg)}</select>
                            <input type="text" maxlength="50" placeholder="Type" class="input-cell" value="${escapeHtml(recipe.bulletType || '')}" onchange="updateRecipe(${recipe.id}, 'bulletType', this.value)">
                            <input type="number" placeholder="Grain" class="input-cell" value="${recipe.bulletGrain || ''}" onchange="updateRecipe(${recipe.id}, 'bulletGrain', this.value); recalcPF(${recipe.id})">
                        </div>
                    </div>
                    <div class="recipe-field">
                        <label>Powder (MFG / Type / Grains)</label>
                        <div class="recipe-field-inputs">
                            <select class="input-cell" onchange="updateRecipe(${recipe.id}, 'powderMfg', this.value)">${optionsHtml(options.mfg, recipe.powderMfg)}</select>
                            <input type="text" maxlength="50" placeholder="Type" class="input-cell" value="${escapeHtml(recipe.powderType || '')}" onchange="updateRecipe(${recipe.id}, 'powderType', this.value)">
                            <input type="number" step="0.1" placeholder="Grains" class="input-cell" value="${recipe.powderGrain || ''}" onchange="updateRecipe(${recipe.id}, 'powderGrain', this.value)">
                        </div>
                    </div>
                    <div class="recipe-field">
                        <label>Firearm / FPS</label>
                        <div class="recipe-field-inputs">
                            <input type="text" maxlength="20" placeholder="Firearm" class="input-cell" value="${escapeHtml(recipe.firearm || '')}" onchange="updateRecipe(${recipe.id}, 'firearm', this.value)">
                            <input type="number" max="9999" placeholder="FPS" class="input-cell" value="${recipe.fps || ''}" onchange="updateRecipe(${recipe.id}, 'fps', this.value); recalcPF(${recipe.id})">
                        </div>
                    </div>
                </div>
                <div class="recipe-actions">
                    ${!isActive
                        ? `<button onclick="setActiveLoad(${recipe.id})" class="btn btn-sm btn-indigo">Set Active</button>`
                        : '<span class="text-green-400 font-bold text-sm">Currently Active</span>'
                    }
                    <button onclick="duplicateRecipe(${recipe.id})" class="btn btn-sm btn-green">Duplicate</button>
                    <button onclick="deleteRecipe(${recipe.id})" class="btn btn-sm btn-red">Delete</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function toggleRecipeDetail(id) {
    if (expandedRecipes.has(id)) {
        expandedRecipes.delete(id);
    } else {
        expandedRecipes.add(id);
    }
    renderRecipes(currentFilter);
}

function filterRecipes(query) {
    renderRecipes(query);
}

function optionsHtml(opts, selected) {
    return opts.map(opt => `<option value="${opt}" ${opt === selected ? 'selected' : ''}>${opt}</option>`).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateRecipe(id, field, value) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;
    if (['caseLength', 'caseOal', 'bulletGrain', 'powderGrain', 'fps'].includes(field)) {
        recipe[field] = value === '' ? '' : parseFloat(value);
    } else {
        recipe[field] = value;
    }
    saveRecipes();
    recalcPF(id);
}

function recalcPF(id) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;
    const pf = calculatePF(recipe.bulletGrain, recipe.fps);
    const pfEl = document.getElementById(`pf-${id}`);
    if (pfEl) pfEl.textContent = pf !== '--' ? 'PF ' + pf : '';
}

function calculatePF(grain, fps) {
    if (!grain || !fps || isNaN(grain) || isNaN(fps)) return '--';
    return (parseFloat(grain) * parseFloat(fps) / 1000).toFixed(1);
}

function addNewRecipe() {
    const newRecipe = {
        id: nextId++,
        caliber: options.caliber[0] || '',
        notes: '',
        caseMfg: '', caseLength: '', caseOal: '',
        primerMfg: '', primerType: '',
        bulletMfg: '', bulletType: '', bulletGrain: '',
        powderMfg: '', powderType: '', powderGrain: '',
        firearm: '', fps: '',
        lifetimeTotal: 0
    };
    recipes.push(newRecipe);
    expandedRecipes.add(newRecipe.id); // auto-expand new recipe
    saveRecipes();
    renderRecipes(currentFilter);
}

function duplicateRecipe(id) {
    const original = recipes.find(r => r.id === id);
    if (!original) return;
    const duplicate = { ...original, id: nextId++ };
    recipes.push(duplicate);
    saveRecipes();
    renderRecipes(currentFilter);
    showMessage(`Duplicated recipe ${id} as ${duplicate.id}`, "info");
}

function deleteRecipe(id) {
    if (confirm(`Delete recipe ID ${id}?`)) {
        recipes = recipes.filter(r => r.id !== id);
        expandedRecipes.delete(id);
        nextId = Math.max(nextId, Math.max(...recipes.map(r => r.id)) + 1, 1);
        saveRecipes();
        renderRecipes(currentFilter);
    }
}

function exportRecipes() {
    const data = JSON.stringify(recipes, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reloading_recipes_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importRecipes(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) throw new Error("Invalid format");
            recipes = imported;
            nextId = recipes.length > 0 ? Math.max(...recipes.map(r => r.id)) + 1 : 1;
            saveRecipes();
            renderRecipes(currentFilter);
            showMessage("Recipes imported successfully!", "info");
            document.getElementById('importFile').value = '';
        } catch (err) {
            alert("Import failed: " + err.message);
        }
    };
    reader.readAsText(file);
}

// Print View (keeps table format for printing)
function openPrintView() {
    const modal = document.getElementById('printModal');
    const container = document.getElementById('printTableContainer');
    const sortedRecipes = [...recipes].sort((a, b) => a.id - b.id);

    container.innerHTML = `
        <table class="print-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Caliber</th>
                    <th>Notes</th>
                    <th>Case<br><small>MFG / Length / OAL</small></th>
                    <th>Primer<br><small>MFG / Type</small></th>
                    <th>Bullet<br><small>MFG / Type / Grain</small></th>
                    <th>Powder<br><small>MFG / Type / Grains</small></th>
                    <th>Firearm</th>
                    <th>FPS</th>
                    <th class="font-bold">PF</th>
                </tr>
            </thead>
            <tbody>
                ${sortedRecipes.map(r => `
                    <tr>
                        <td>${r.id}</td>
                        <td>${escapeHtml(r.caliber || '')}</td>
                        <td style="max-width:12rem">${escapeHtml(r.notes || '')}</td>
                        <td class="text-sm">${escapeHtml(r.caseMfg || '')}<br>${r.caseLength || ''} / ${r.caseOal || ''}</td>
                        <td class="text-sm">${escapeHtml(r.primerMfg || '')}<br>${escapeHtml(r.primerType || '')}</td>
                        <td class="text-sm">${escapeHtml(r.bulletMfg || '')}<br>${escapeHtml(r.bulletType || '')} / ${r.bulletGrain || ''}</td>
                        <td class="text-sm">${escapeHtml(r.powderMfg || '')}<br>${escapeHtml(r.powderType || '')} / ${r.powderGrain || ''}</td>
                        <td>${escapeHtml(r.firearm || '')}</td>
                        <td class="text-center">${r.fps || ''}</td>
                        <td class="text-center font-bold text-lg">${calculatePF(r.bulletGrain, r.fps)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    modal.classList.remove('hidden');
    setTimeout(() => window.print(), 300);
}

function closePrintView() {
    document.getElementById('printModal').classList.add('hidden');
}

// Options Editor Modal
function openOptionsModal() {
    const editor = document.getElementById('optionsEditor');
    const lists = [
        { name: 'Caliber', key: 'caliber', opts: options.caliber },
        { name: 'Manufacturer (MFG)', key: 'mfg', opts: options.mfg },
        { name: 'Primer Type', key: 'primerType', opts: options.primerType },
        { name: 'Bullet Type', key: 'bulletType', opts: options.bulletType }
    ];
    editor.innerHTML = lists.map(list => `
        <div style="border:1px solid var(--border);padding:0.75rem;border-radius:0.25rem">
            <h5 class="font-semibold mb-2">${list.name}</h5>
            <div class="space-y-1 mb-2">
                ${list.opts.map(opt => `
                    <div class="flex-row-between" style="background:var(--bg-input);padding:0.25rem 0.5rem;border-radius:0.25rem">
                        <span>${escapeHtml(opt)}</span>
                        <button onclick="removeOption('${list.key}', '${opt}')" class="btn-link text-red-400 text-xs">Remove</button>
                    </div>
                `).join('')}
            </div>
            <input type="text" id="new-${list.key}" placeholder="Add new option..." class="input-dark mb-1">
            <button onclick="addOption('${list.key}')" class="btn btn-sm btn-green">Add</button>
        </div>
    `).join('');
    document.getElementById('optionsModal').classList.remove('hidden');
}

function closeOptionsModal() {
    document.getElementById('optionsModal').classList.add('hidden');
    document.querySelectorAll('#optionsModal input[type="text"]').forEach(el => el.value = '');
}

function addOption(key) {
    const input = document.getElementById(`new-${key}`);
    const value = input.value.trim();
    if (value && !options[key].includes(value)) {
        options[key].push(value);
        input.value = '';
        openOptionsModal();
    }
}

function removeOption(key, value) {
    options[key] = options[key].filter(opt => opt !== value);
    openOptionsModal();
}

function setActiveLoad(id) {
    if (activeRecipeId && activeRecipeId !== id) {
        showMessage("Switched active load — next rounds start a new batch", "info");
    }
    activeRecipeId = id;
    localStorage.setItem('active_recipe_id', id);
    renderRecipes(currentFilter);
    updateActiveLoadDisplay();
}

function clearActiveLoad() {
    activeRecipeId = null;
    localStorage.removeItem('active_recipe_id');
    renderRecipes(currentFilter);
    showMessage("Active load cleared", "info");
}

function updateActiveLoadDisplay() {
    const display = document.getElementById('activeLoadDisplay');
    const nameEl = document.getElementById('activeLoadName');
    const bulletEl = document.getElementById('activeBullet');
    const powderEl = document.getElementById('activePowder');
    const pfEl = document.getElementById('activePF');

    if (!activeRecipeId) {
        display.classList.add('hidden');
        return;
    }
    const recipe = recipes.find(r => r.id === activeRecipeId);
    if (!recipe) { clearActiveLoad(); return; }

    display.classList.remove('hidden');
    nameEl.textContent = `${recipe.caliber} - ${recipe.notes || 'Untitled'}`;
    bulletEl.textContent = `${recipe.bulletMfg || ''} ${recipe.bulletType || ''} ${recipe.bulletGrain || ''}gr`.trim() || '--';
    powderEl.textContent = `${recipe.powderMfg || ''} ${recipe.powderType || ''} ${recipe.powderGrain || ''}gr`.trim() || '--';
    pfEl.textContent = calculatePF(recipe.bulletGrain, recipe.fps);
}

function logCompletedRound(currentTotal) {
    if (!activeRecipeId || lastCount === null || currentTotal <= lastCount) return;
    const roundsAdded = currentTotal - lastCount;
    const recipe = recipes.find(r => r.id === activeRecipeId);
    if (!recipe) return;

    const now = Date.now();
    const recipeName = `${recipe.caliber} - ${recipe.notes || 'Untitled'}`;
    const lastBatch = sessionLog.find(entry => entry.recipeId === activeRecipeId && entry.isBatch === true);

    let currentBatch;
    if (lastBatch && (now - new Date(lastBatch.lastUpdate).getTime()) < 60 * 60 * 1000) {
        currentBatch = lastBatch;
        currentBatch.rounds += roundsAdded;
        currentBatch.totalCount = currentTotal;
        currentBatch.lastUpdate = new Date().toISOString();
        currentBatch.prettyTime = new Date().toLocaleString();
    } else {
        currentBatch = {
            date: new Date().toISOString(),
            prettyTime: new Date().toLocaleString(),
            recipeId: activeRecipeId,
            recipeName: recipeName,
            rounds: roundsAdded,
            totalCount: currentTotal,
            isBatch: true,
            lastUpdate: new Date().toISOString()
        };
        sessionLog.unshift(currentBatch);
    }

    recipe.lifetimeTotal = (recipe.lifetimeTotal || 0) + roundsAdded;
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(sessionLog));
    saveRecipes();
    lastCount = currentTotal;
    renderSessionLog();
    renderRecipes(currentFilter);
}

function renderSessionLog() {
    const container = document.getElementById('sessionLog');
    const today = new Date().toDateString();
    const activeRecipe = activeRecipeId ? recipes.find(r => r.id === activeRecipeId) : null;
    const todaysBatches = sessionLog.filter(e => e.isBatch && new Date(e.date).toDateString() === today);

    if (todaysBatches.length === 0 && !activeRecipe) {
        container.innerHTML = '<p class="text-gray-500 text-center">No batches logged today</p>';
        return;
    }

    let html = '';
    if (activeRecipe) {
        const lifetime = activeRecipe.lifetimeTotal || 0;
        html += `
            <div class="active-load-banner">
                <div class="text-sm text-indigo-300">Currently Active Load</div>
                <div class="text-2xl font-bold">${activeRecipe.caliber} - ${activeRecipe.notes || 'Untitled'}</div>
                <div class="text-sm text-gray-400 mt-1">
                    Lifetime loaded: <span class="font-bold text-green-400">${lifetime.toLocaleString()}</span> rounds
                </div>
            </div>
        `;
    }

    if (todaysBatches.length > 0) {
        html += '<div class="text-lg font-semibold mb-3 text-indigo-300">Today\'s Batches</div>';
        html += todaysBatches.map(batch => {
            const time = batch.prettyTime.split(',')[1].trim();
            return `
                <div class="session-batch">
                    <div>
                        <span class="text-xs text-gray-400">${time}</span>
                        <span class="ml-3 font-medium">${batch.recipeName}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-2xl font-bold text-green-400">+${batch.rounds}</span>
                        <span class="text-gray-500 text-sm ml-2">(total: ${batch.totalCount})</span>
                    </div>
                </div>
            `;
        }).join('');
    } else if (activeRecipe) {
        html += '<p class="text-gray-500 text-center mt-4">Start loading to begin logging batches</p>';
    }
    container.innerHTML = html;
}

function forceNewBatch() {
    if (!activeRecipeId) return;
    const lastBatch = sessionLog.find(e => e.recipeId === activeRecipeId && e.isBatch);
    if (lastBatch) {
        lastBatch.lastUpdate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    }
    showMessage("Next rounds will start a new batch", "info");
}

activeRecipeId = parseInt(localStorage.getItem('active_recipe_id')) || null;

// Initial render on page load
renderRecipes();
