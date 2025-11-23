
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

/* UI refs */
const ui = {
    connectionStatus: document.getElementById('connectionStatus'),
    deviceInfo: document.getElementById('deviceInfo'),
    connectButton: document.getElementById('connectButton'),
    disconnectButton: document.getElementById('disconnectButton'),

    totalCount: document.getElementById('totalCount'),
    powderLevel: document.getElementById('powderLevel'),
    systemStatusText: document.getElementById('systemStatusText'),

    primerTile: document.getElementById('primerTile'),
    primerStatusText: document.getElementById('primerStatusText'),
    caseTile: document.getElementById('caseTile'),
    caseStatusText: document.getElementById('caseStatusText'),
    bulletTile: document.getElementById('bulletTile'),
    bulletStatusText: document.getElementById('bulletStatusText'),
    motorTile: document.getElementById('motorTile'),
    motorStatusText: document.getElementById('motorStatusText'),

    // Tab controls
    commandFeedback: document.getElementById('commandFeedback'),
    resetCountBtn: document.getElementById('resetCountBtn'),
    calHighBtn: document.getElementById('calHighBtn'),
    calLowBtn: document.getElementById('calLowBtn'),

    // Settings controls
    muteToggle: document.getElementById('muteToggle'),
    dwellActiveToggle: document.getElementById('dwellActiveToggle'),
    dwellDuration: document.getElementById('dwellDuration'),
    dwellDurationValue: document.getElementById('dwellDurationValue'),
    motorEnToggle: document.getElementById('motorEnToggle'),

    // Motor display
    motorDisplay: document.getElementById('motorDisplay'),
};

/* Helper: parse incoming BLE data string into object
   Expected format produced by firmware:
   "Pri=%d,Cas=%d,Bul=%d,Cnt=%d,Powder=%d,Mot=%d,Mute=%d,DwellDur=%d,DwellAct=%d,MotorEn=%d"
*/
function parseData(valueString) {
    const obj = {};
    try {
        valueString.split(',').forEach(pair => {
            const [k, v] = pair.split('=');
            if (!k) return;
            // parseInt safe fallback
            const n = parseInt((v||'').trim(), 10);
            obj[k.trim()] = Number.isNaN(n) ? (v||'').trim() : n;
        });
    } catch (e) {
        console.error("parseData error:", e);
    }
    return obj;
}

/* Update UI based on parsed data */
function updateUI(data) {
    // Rounds
    if (data.Cnt !== undefined) ui.totalCount.textContent = data.Cnt;
    else ui.totalCount.textContent = '--';

    // Powder percentage
    if (data.Powder !== undefined) {
        ui.powderLevel.textContent = `${data.Powder}%`;
        if (data.Powder <= 5) {
            ui.powderLevel.className = 'text-4xl font-extrabold text-red-400';
        } else if (data.Powder < 20) {
            ui.powderLevel.className = 'text-4xl font-extrabold text-yellow-400';
        } else {
            ui.powderLevel.className = 'text-4xl font-extrabold text-green-400';
        }
    } else {
        ui.powderLevel.textContent = '--%';
        ui.powderLevel.className = 'text-4xl font-extrabold text-white';
    }

    // Components (1 = OK, 0 = LOW)
    function applyStatus(tileEl, textEl, val) {
        const displayVal = (val === 1) ? 'OK' : (val === 0 ? 'LOW!' : '--');
        const cls = (val === 1) ? 'status-tile status-tile-ok p-4 rounded-xl' : (val === 0 ? 'status-tile status-tile-low p-4 rounded-xl' : 'status-tile status-tile-unknown p-4 rounded-xl');
        tileEl.className = cls;
        textEl.textContent = displayVal;
    }
    applyStatus(ui.primerTile, ui.primerStatusText, data.Pri);
    applyStatus(ui.caseTile, ui.caseStatusText, data.Cas);
    applyStatus(ui.bulletTile, ui.bulletStatusText, data.Bul);

    // System status: simple logic (critical if any component low OR powder <= 5)
    let systemText = '--', systemClass = 'text-white';
    const powderCritical = (data.Powder !== undefined && data.Powder <= 5);
    const componentCritical = (data.Pri === 0 || data.Cas === 0 || data.Bul === 0);
    if (!componentCritical && !powderCritical && data.Pri !== undefined) {
        systemText = 'OK';
        systemClass = 'text-green-400';
    } else if (componentCritical || powderCritical) {
        systemText = 'CRITICAL';
        systemClass = 'text-red-400';
    } else {
        systemText = '--';
        systemClass = 'text-white';
    }
    ui.systemStatusText.textContent = systemText;
    ui.systemStatusText.className = `text-4xl font-extrabold ${systemClass}`;

    // Motor (Mot: 0 stop, 1 FWD, 2 REV)
    if (data.Mot !== undefined) {
        if (data.Mot === 1) {
            ui.motorStatusText.textContent = 'RUNNING (FWD)';
            ui.motorTile.className = 'status-tile status-tile-ok p-4 rounded-xl';
            ui.motorDisplay.textContent = 'RUNNING →';
        } else if (data.Mot === 2) {
            ui.motorStatusText.textContent = 'RUNNING (REV)';
            ui.motorTile.className = 'status-tile status-tile-low p-4 rounded-xl';
            ui.motorDisplay.textContent = 'RUNNING ←';
        } else {
            ui.motorStatusText.textContent = 'IDLE';
            ui.motorTile.className = 'status-tile status-tile-unknown p-4 rounded-xl';
            ui.motorDisplay.textContent = 'IDLE';
        }
    } else {
        ui.motorStatusText.textContent = '--';
        ui.motorTile.className = 'status-tile status-tile-unknown p-4 rounded-xl';
        ui.motorDisplay.textContent = '--';
    }

    // Settings reflected from firmware:
    const now = Date.now();
    const debounce = 300;
    
    if (data.Mute !== undefined && (now - lastUserSettingChange > debounce || ui.muteToggle.checked !== !!data.Mute)) {
        ui.muteToggle.checked = !!data.Mute;
    }
    if (data.DwellAct !== undefined && (now - lastUserSettingChange > debounce || ui.dwellActiveToggle.checked !== !!data.DwellAct)) {
        ui.dwellActiveToggle.checked = !!data.DwellAct;
    }
    if (data.MotorEn !== undefined && (now - lastUserSettingChange > debounce || ui.motorEnToggle.checked !== !!data.MotorEn)) {
        ui.motorEnToggle.checked = !!data.MotorEn;
    }
    if (data.DwellDur !== undefined && (now - lastUserSettingChange > debounce || ui.dwellDuration.value != data.DwellDur)) {
        ui.dwellDuration.value = data.DwellDur;
        ui.dwellDurationValue.textContent = data.DwellDur;
    }
}

/* Show feedback message temporarily */
let feedbackTimer = null;
function showMessage(msg, type='info') {
    ui.commandFeedback.textContent = msg;
    ui.commandFeedback.style.opacity = 1;
    ui.commandFeedback.className = (type === 'error') ? 'text-red-400 small-muted' : 'text-green-400 small-muted';
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(()=> {
        ui.commandFeedback.style.opacity = 0;
    }, 2500);
}

/* Enable/disable command buttons when not connected */
function setCommandButtonsEnabled(enabled) {
    ui.resetCountBtn.disabled = !enabled;
    ui.calHighBtn.disabled   = !enabled;
    ui.calLowBtn.disabled    = !enabled;
    ui.resetCountBtn.classList.toggle('opacity-50', !enabled);
    ui.calHighBtn.classList.toggle('opacity-50', !enabled);
    ui.calLowBtn.classList.toggle('opacity-50', !enabled);
}

/* SEND COMMAND string to Command Characteristic
   Uses writeValueWithoutResponse for responsiveness (firmware expects WRITE or WRITE_NR)
*/
async function sendCommand(commandString) {
    if (!commandCharacteristic) {
        showMessage("Not connected", "error");
        console.error("Command char missing");
        return;
    }
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(commandString);
        // Prefer writeValueWithoutResponse if supported
        if (commandCharacteristic.properties.writeWithoutResponse) {
            await commandCharacteristic.writeValueWithoutResponse(data);
        } else {
            await commandCharacteristic.writeValue(data);
        }
        showMessage(`Sent: ${commandString}`);
        console.log("Sent command:", commandString);
    } catch (err) {
        console.error("sendCommand error:", err);
        showMessage("Send failed", "error");
    }
}

/* Convenience wrapper for setting named configuration via BLE.
   Firmware expects: CMD=SET_<SETTINGNAME>_<VALUE>
   Example: CMD=SET_MUTE_1
*/
let lastUserSettingChange = 0;

function updateSetting(name, value) {
    const v = parseInt(value, 10);
    if (Number.isNaN(v)) return;
    sendCommand(`CMD=SET_${name}_${v}`);

    // Optimistic update
    if (name === 'MUTE') ui.muteToggle.checked = !!v;
    if (name === 'DWELL_ACTIVE') ui.dwellActiveToggle.checked = !!v;
    if (name === 'MOTOR_EN') ui.motorEnToggle.checked = !!v;
    if (name === 'DWELL_DUR') {
        ui.dwellDuration.value = v;
        ui.dwellDurationValue.textContent = v;
    }

    lastUserSettingChange = Date.now();
}

/* BLE connect/disconnect logic */
async function connectBLE() {
    if (!navigator.bluetooth) {
        showMessage("Web Bluetooth not supported", "error");
        ui.connectionStatus.textContent = "Status: Web Bluetooth not supported in this browser.";
        return;
    }

    try {
        ui.connectionStatus.textContent = "Status: Scanning...";
        ui.connectionStatus.classList.remove('text-red-400');
        ui.connectionStatus.classList.add('text-yellow-400');
        setCommandButtonsEnabled(false);

        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        ui.deviceInfo.textContent = `BLE Device: ${bleDevice.name || 'Unknown'}`;
        ui.connectionStatus.textContent = "Status: Connecting...";

        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        gattServer = await bleDevice.gatt.connect();
        const service = await gattServer.getPrimaryService(SERVICE_UUID);

        // Characteristics
        commandCharacteristic = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);
        dataCharacteristic = await service.getCharacteristic(DATA_CHARACTERISTIC_UUID);

        // Subscribe to notifications
        if (dataCharacteristic.properties.notify) {
            await dataCharacteristic.startNotifications();
            dataCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicUpdates);
        }

        ui.connectionStatus.textContent = "Status: Connected";
        ui.connectionStatus.classList.remove('text-yellow-400');
        ui.connectionStatus.classList.remove('text-red-400');
        ui.connectionStatus.classList.add('text-green-400');

        ui.connectButton.classList.add('hidden');
        ui.disconnectButton.classList.remove('hidden');

        setCommandButtonsEnabled(true);
        showMessage("Connected", "info");
    } catch (err) {
        console.error("connectBLE error:", err);
        ui.connectionStatus.textContent = `Status: Conn failed (${err && err.name ? err.name : 'error'})`;
        ui.connectionStatus.classList.remove('text-yellow-400');
        ui.connectionStatus.classList.add('text-red-400');
        ui.deviceInfo.textContent = 'BLE Device: N/A';
        setCommandButtonsEnabled(false);
        showMessage("Connection failed", "error");
    }
}

function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
        bleDevice.gatt.disconnect();
    } else {
        console.log("No device connected");
    }
}

/* On disconnect */
function onDisconnected() {
    console.log("Device disconnected");
    ui.connectionStatus.textContent = "Status: Disconnected";
    ui.connectionStatus.classList.remove('text-green-400');
    ui.connectionStatus.classList.add('text-red-400');

    ui.connectButton.classList.remove('hidden');
    ui.disconnectButton.classList.add('hidden');
    setCommandButtonsEnabled(false);

    // Reset UI placeholders
    ui.totalCount.textContent = '--';
    ui.powderLevel.textContent = '--%';
    ui.systemStatusText.textContent = '--';
    ui.primerStatusText.textContent = '--';
    ui.caseStatusText.textContent = '--';
    ui.bulletStatusText.textContent = '--';
    ui.motorStatusText.textContent = '--';
    ui.motorDisplay.textContent = '--';
}

/* Handle incoming notifications */
function handleCharacteristicUpdates(event) {
    try {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const raw = decoder.decode(value);
        // console.log("BLE RX:", raw);
        const parsed = parseData(raw);
        updateUI(parsed);
    } catch (e) {
        console.error("characteristic update error:", e);
    }
}

/* Initialize tab buttons (simple tab system) */
(function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b=> b.classList.remove('active'));
            btn.classList.add('active');

            const target = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
            const tabEl = document.getElementById(`tab-${target}`);
            if (tabEl) tabEl.classList.remove('hidden');
        });
    });
    // Activate commands tab by default
    const first = document.querySelector('.tab-btn');
    if (first) first.click();
})();

/* On load: disable buttons if no bluetooth, try to reflect initial UI */
window.addEventListener('load', () => {
    if (!('bluetooth' in navigator)) {
        ui.connectButton.disabled = true;
        ui.connectButton.textContent = "BLE Not Supported";
        ui.connectionStatus.textContent = "Status: BLE Not Supported";
    }
    setCommandButtonsEnabled(false);
    // defaults
    ui.dwellDurationValue.textContent = ui.dwellDuration.value || '--';
});

/* Optional: convenience keyboard shortcuts for debugging (ctrl+shift+c to connect) */
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        connectBLE();
    }
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
    renderRecipes(); // Refresh table with new options
    showMessage("Options updated!", "info");
}

function renderRecipes(filter = '') {
    currentFilter = filter.toLowerCase();
    const tbody = document.getElementById('recipesBody');
    tbody.innerHTML = '';

    let filteredRecipes = recipes.filter(recipe => {
        const str = JSON.stringify(recipe).toLowerCase();
        return str.includes(currentFilter);
    });

    filteredRecipes.sort((a, b) => a.id - b.id);

    filteredRecipes.forEach(recipe => {
        const highlightedClass = currentFilter ? 'bg-yellow-900/20' : '';
        const tr = document.createElement('tr');
        tr.className = `border-t border-gray-700 hover:bg-gray-700/50 ${highlightedClass}`;
        tr.innerHTML = `
            <td class="px-3 py-2">${recipe.id}</td>
            <td class="px-3 py-2">
                <select class="bg-gray-800 rounded px-1 py-0.5 text-sm w-full" onchange="updateRecipe(${recipe.id}, 'caliber', this.value)">${optionsHtml(options.caliber, recipe.caliber)}</select>
            </td>
            <td class="px-3 py-2">
                <input type="text" maxlength="200" class="bg-gray-800 rounded px-1 py-0.5 text-sm w-full" value="${escapeHtml(recipe.notes || '')}" onchange="updateRecipe(${recipe.id}, 'notes', this.value)">
            </td>
            <td class="px-3 py-2 text-xs">
                <select class="bg-gray-800 rounded px-1 py-0.5 w-full" onchange="updateRecipe(${recipe.id}, 'caseMfg', this.value)">${optionsHtml(options.mfg, recipe.caseMfg)}</select><br>
                <input type="number" step="0.001" placeholder="Length" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${recipe.caseLength || ''}" onchange="updateRecipe(${recipe.id}, 'caseLength', this.value)">
                <input type="number" step="0.001" placeholder="OAL" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${recipe.caseOal || ''}" onchange="updateRecipe(${recipe.id}, 'caseOal', this.value)">
            </td>
            <td class="px-3 py-2 text-xs">
                <select class="bg-gray-800 rounded px-1 py-0.5 w-full" onchange="updateRecipe(${recipe.id}, 'primerMfg', this.value)">${optionsHtml(options.mfg, recipe.primerMfg)}</select><br>
                <select class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" onchange="updateRecipe(${recipe.id}, 'primerType', this.value)">${optionsHtml(options.primerType, recipe.primerType)}</select>
            </td>
            <td class="px-3 py-2 text-xs">
                <select class="bg-gray-800 rounded px-1 py-0.5 w-full" onchange="updateRecipe(${recipe.id}, 'bulletMfg', this.value)">${optionsHtml(options.mfg, recipe.bulletMfg)}</select><br>
                <input type="text" maxlength="50" placeholder="Type" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${escapeHtml(recipe.bulletType || '')}" onchange="updateRecipe(${recipe.id}, 'bulletType', this.value)">
                <input type="number" placeholder="Grain" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${recipe.bulletGrain || ''}" onchange="updateRecipe(${recipe.id}, 'bulletGrain', this.value); recalcPF(${recipe.id})">
            </td>
            <td class="px-3 py-2 text-xs">
                <select class="bg-gray-800 rounded px-1 py-0.5 w-full" onchange="updateRecipe(${recipe.id}, 'powderMfg', this.value)">${optionsHtml(options.mfg, recipe.powderMfg)}</select><br>
                <input type="text" maxlength="50" placeholder="Type" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${escapeHtml(recipe.powderType || '')}" onchange="updateRecipe(${recipe.id}, 'powderType', this.value)">
                <input type="number" step="0.1" placeholder="Grains" class="bg-gray-800 rounded px-1 py-0.5 mt-1 w-full" value="${recipe.powderGrain || ''}" onchange="updateRecipe(${recipe.id}, 'powderGrain', this.value)">
            </td>
            <td class="px-3 py-2">
                <input type="text" maxlength="20" class="bg-gray-800 rounded px-1 py-0.5 w-20" value="${escapeHtml(recipe.firearm || '')}" onchange="updateRecipe(${recipe.id}, 'firearm', this.value)">
            </td>
            <td class="px-3 py-2">
                <input type="number" max="9999" class="bg-gray-800 rounded px-1 py-0.5 w-20" value="${recipe.fps || ''}" onchange="updateRecipe(${recipe.id}, 'fps', this.value); recalcPF(${recipe.id})">
            </td>
            <td class="px-3 py-2 font-bold text-yellow-400" id="pf-${recipe.id}">${calculatePF(recipe.bulletGrain, recipe.fps)}</td>
            <td class="px-3 py-2 text-center">
                <button onclick="duplicateRecipe(${recipe.id})" class="text-green-400 hover:text-green-300 text-xs mr-1">Duplicate</button>
                <button onclick="deleteRecipe(${recipe.id})" class="text-red-400 hover:text-red-300 text-xs">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
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
    recipe[field] = value;
    saveRecipes();
    recalcPF(id); // Auto-recalc PF if needed
}

function recalcPF(id) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;
    const pf = calculatePF(recipe.bulletGrain, recipe.fps);
    const pfEl = document.getElementById(`pf-${id}`);
    if (pfEl) pfEl.textContent = pf;
}

function calculatePF(grain, fps) {
    if (!grain || !fps || isNaN(grain) || isNaN(fps)) return '--';
    return (parseFloat(grain) * parseFloat(fps) / 1000).toFixed(1);
}

function addNewRecipe() {
    const newRecipe = {
        id: nextId++,
        caliber: options.caliber[0] || '', // Default to first option
        notes: '',
        caseMfg: '', caseLength: '', caseOal: '',
        primerMfg: '', primerType: '',
        bulletMfg: '', bulletType: '', bulletGrain: '',
        powderMfg: '', powderType: '', powderGrain: '',
        firearm: '', fps: ''
    };
    recipes.push(newRecipe);
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
            document.getElementById('importFile').value = ''; // Reset file input
        } catch (err) {
            alert("Import failed: " + err.message);
        }
    };
    reader.readAsText(file);
}

// Print View
function openPrintView() {
    const modal = document.getElementById('printModal');
    const container = document.getElementById('printTableContainer');
    container.innerHTML = `
        <table class="w-full border-collapse border-2 border-black print-table">
            <thead>
                <tr class="bg-gray-100">
                    <th class="border border-black px-4 py-2">ID</th>
                    <th class="border border-black px-4 py-2">Caliber</th>
                    <th class="border border-black px-4 py-2">Notes</th>
                    <th class="border border-black px-4 py-2">Case MFG / Length / OAL</th>
                    <th class="border border-black px-4 py-2">Primer MFG / Type</th>
                    <th class="border border-black px-4 py-2">Bullet MFG / Type / Grain</th>
                    <th class="border border-black px-4 py-2">Powder MFG / Type / Grain</th>
                    <th class="border border-black px-4 py-2">Firearm</th>
                    <th class="border border-black px-4 py-2">FPS</th>
                    <th class="border border-black px-4 py-2 font-bold">PF</th>
                </tr>
            </thead>
            <tbody>
                ${recipes.map(recipe => `
                    <tr>
                        <td class="border border-black px-4 py-2">${recipe.id}</td>
                        <td class="border border-black px-4 py-2">${recipe.caliber || ''}</td>
                        <td class="border border-black px-4 py-2">${escapeHtml(recipe.notes || '')}</td>
                        <td class="border border-black px-4 py-2">${(recipe.caseMfg || '')} / ${recipe.caseLength || ''} / ${recipe.caseOal || ''}</td>
                        <td class="border border-black px-4 py-2">${(recipe.primerMfg || '')} / ${recipe.primerType || ''}</td>
                        <td class="border border-black px-4 py-2">${(recipe.bulletMfg || '')} / ${escapeHtml(recipe.bulletType || '')} / ${recipe.bulletGrain || ''}</td>
                        <td class="border border-black px-4 py-2">${(recipe.powderMfg || '')} / ${escapeHtml(recipe.powderType || '')} / ${recipe.powderGrain || ''}</td>
                        <td class="border border-black px-4 py-2">${escapeHtml(recipe.firearm || '')}</td>
                        <td class="border border-black px-4 py-2">${recipe.fps || ''}</td>
                        <td class="border border-black px-4 py-2 font-bold">${calculatePF(recipe.bulletGrain, recipe.fps)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    modal.classList.remove('hidden');
    // Auto-trigger print after a short delay
    setTimeout(() => window.print(), 500);
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
        <div class="border p-3 rounded">
            <h5 class="font-semibold mb-2">${list.name}</h5>
            <div id="list-${list.key}" class="space-y-1 mb-2">
                ${list.opts.map(opt => `
                    <div class="flex justify-between items-center bg-gray-700 p-1 rounded">
                        <span>${escapeHtml(opt)}</span>
                        <button onclick="removeOption('${list.key}', '${opt}')" class="text-red-400 text-xs">Remove</button>
                    </div>
                `).join('')}
            </div>
            <input type="text" id="new-${list.key}" placeholder="Add new option..." class="w-full px-2 py-1 bg-gray-700 rounded mb-1">
            <button onclick="addOption('${list.key}')" class="px-3 py-1 bg-green-600 text-sm rounded">Add</button>
        </div>
    `).join('');
    document.getElementById('optionsModal').classList.remove('hidden');
}

function closeOptionsModal() {
    document.getElementById('optionsModal').classList.add('hidden');
    // Clear inputs
    document.querySelectorAll('#optionsModal input[type="text"]').forEach(el => el.value = '');
}

function addOption(key) {
    const input = document.getElementById(`new-${key}`);
    const value = input.value.trim();
    if (value && !options[key].includes(value)) {
        options[key].push(value);
        input.value = '';
        openOptionsModal(); // Refresh modal
    }
}

function removeOption(key, value) {
    options[key] = options[key].filter(opt => opt !== value);
    openOptionsModal(); // Refresh modal
}

// Auto-render when tab is opened
document.querySelector('[data-tab="recipes"]').addEventListener('click', () => {
    renderRecipes(currentFilter);
});

// Initial render on page load
renderRecipes();
