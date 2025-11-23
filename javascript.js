
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
   Recipe Load Globals
   ================ */
let activeRecipeId = null;  // null = no active load
const SESSION_LOG_KEY = 'reloading_session_log_v1';
let sessionLog = JSON.parse(localStorage.getItem(SESSION_LOG_KEY)) || [];
let lastCount = null;  // To detect when a new round is completed

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
    //if (data.Cnt !== undefined) ui.totalCount.textContent = data.Cnt;
    //else ui.totalCount.textContent = '--';
    // Inside updateUI(), after updating totalCount
    if (data.Cnt !== undefined) {
        ui.totalCount.textContent = data.Cnt;

        // THIS IS THE KEY LINE — logs rounds when counter increases
        if (activeRecipeId !== null && lastCount !== null && data.Cnt > lastCount) {
            logCompletedRound(data.Cnt);
        }
        lastCount = data.Cnt;
    } else {
        ui.totalCount.textContent = '--';
    }
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
        const isActive = activeRecipeId === recipe.id;
        const tr = document.createElement('tr');
        tr.className = `border-t border-gray-700 hover:bg-gray-700/50 ${isActive ? 'bg-indigo-900/30 ring-2 ring-indigo-500' : ''}`;
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
        <td class="px-3 py-2 text-right text-sm">
            <span class="font-medium text-green-400">${(recipe.lifetimeTotal || 0).toLocaleString()}</span>
        </td>
        <td class="px-3 py-2 text-center whitespace-nowrap">
            ${isActive 
                ? '<span class="text-green-400 font-bold">ACTIVE</span>'
                : `<button onclick="setActiveLoad(${recipe.id})" class="text-indigo-400 hover:text-indigo-300 text-xs font-medium">Set Active</button>`
            }
            <button onclick="duplicateRecipe(${recipe.id})" class="text-green-400 hover:text-green-300 text-xs ml-3">Dup</button>
            <button onclick="deleteRecipe(${recipe.id})" class="text-red-400 hover:text-red-300 text-xs ml-3">Del</button>
        </td>
    `;
        tbody.appendChild(tr);
    });

    updateActiveLoadDisplay();
    renderSessionLog();
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

    // Handle number fields properly (convert empty string to empty, not "0")
    if (['caseLength', 'caseOal', 'bulletGrain', 'powderGrain', 'fps'].includes(field)) {
        recipe[field] = value === '' ? '' : parseFloat(value);
    } else {
        recipe[field] = value;
    }

    saveRecipes();
    recalcPF(id); // Update PF if bullet weight or FPS changed
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
        caliber: options.caliber[0] || '',
        notes: '',
        caseMfg: '', caseLength: '', caseOal: '',
        primerMfg: '', primerType: '',
        bulletMfg: '', bulletType: '', bulletGrain: '',
        powderMfg: '', powderType: '', powderGrain: '',
        firearm: '', fps: '',
        lifetimeTotal: 0  // ← important!
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

    // Sort by ID for clean printout
    const sortedRecipes = [...recipes].sort((a, b) => a.id - b.id);

    container.innerHTML = `
        <table class="w-full border-collapse border-2 border-black">
            <thead>
                <tr class="bg-gray-200 text-black">
                    <th class="border border-black px-4 py-3 text-left">ID</th>
                    <th class="border border-black px-4 py-3 text-left">Caliber</th>
                    <th class="border border-black px-4 py-3 text-left">Notes</th>
                    <th class="border border-black px-4 py-3 text-left">Case<br><small>MFG / Length / OAL</small></th>
                    <th class="border border-black px-4 py-3 text-left">Primer<br><small>MFG / Type</small></th>
                    <th class="border border-black px-4 py-3 text-left">Bullet<br><small>MFG / Type / Grain</small></th>
                    <th class="border border-black px-4 py-3 text-left">Powder<br><small>MFG / Type / Grains</small></th>
                    <th class="border border-black px-4 py-3 text-left">Firearm</th>
                    <th class="border border-black px-4 py-3 text-left">FPS</th>
                    <th class="border border-black px-4 py-3 text-left font-bold">PF</th>
                </tr>
            </thead>
            <tbody>
                ${sortedRecipes.map(r => `
                    <tr class="even:bg-gray-50">
                        <td class="border border-black px-4 py-3 align-top">${r.id}</td>
                        <td class="border border-black px-4 py-3 align-top">${escapeHtml(r.caliber || '')}</td>
                        <td class="border border-black px-4 py-3 align-top max-w-48">${escapeHtml(r.notes || '')}</td>
                        <td class="border border-black px-4 py-3 align-top text-sm">
                            ${escapeHtml(r.caseMfg || '')}<br>
                            ${r.caseLength || ''} / ${r.caseOal || ''}
                        </td>
                        <td class="border border-black px-4 py-3 align-top text-sm">
                            ${escapeHtml(r.primerMfg || '')}<br>
                            ${escapeHtml(r.primerType || '')}
                        </td>
                        <td class="border border-black px-4 py-3 align-top text-sm">
                            ${escapeHtml(r.bulletMfg || '')}<br>
                            ${escapeHtml(r.bulletType || '')} / ${r.bulletGrain || ''}
                        </td>
                        <td class="border border-black px-4 py-3 align-top text-sm">
                            ${escapeHtml(r.powderMfg || '')}<br>
                            ${escapeHtml(r.powderType || '')} / ${r.powderGrain || ''}
                        </td>
                        <td class="border border-black px-4 py-3 align-top">${escapeHtml(r.firearm || '')}</td>
                        <td class="border border-black px-4 py-3 align-top text-center">${r.fps || ''}</td>
                        <td class="border border-black px-4 py-3 align-top text-center font-bold text-lg">
                            ${calculatePF(r.bulletGrain, r.fps)}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    modal.classList.remove('hidden');

    // Optional: auto-print after a tiny delay so the modal renders first
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
function setActiveLoad(id) {
    activeRecipeId = id;
    localStorage.setItem('active_recipe_id', id);
    renderRecipes(currentFilter);
    showMessage("Active load set!", "info");
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
    if (!recipe) {
        clearActiveLoad();
        return;
    }

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

    // Find the MOST RECENT batch for this recipe (not the oldest!)
    const lastBatch = sessionLog.find(entry => 
        entry.recipeId === activeRecipeId && 
        entry.isBatch === true
    );

    let currentBatch;

    if (lastBatch && (now - new Date(lastBatch.lastUpdate).getTime()) < 60 * 60 * 1000) {
        // Within 60 minutes of the most recent batch → add to it
        currentBatch = lastBatch;
        currentBatch.rounds += roundsAdded;
        currentBatch.totalCount = currentTotal;
        currentBatch.lastUpdate = new Date().toISOString();
        currentBatch.prettyTime = new Date().toLocaleString();
    } else {
        // More than 60 min → new batch
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
        sessionLog.unshift(currentBatch); // newest first
    }

    // Update lifetime total
    recipe.lifetimeTotal = (recipe.lifetimeTotal || 0) + roundsAdded;

    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(sessionLog));
    saveRecipes();
    lastCount = currentTotal;

    renderSessionLog();           // This will now show the batch!
    renderRecipes(currentFilter); // Updates lifetime in table
}

// 2. Beautiful session log with lifetime total
function renderSessionLog() {
    const container = document.getElementById('sessionLog');
    const today = new Date().toDateString();
    const activeRecipe = activeRecipeId ? recipes.find(r => r.id === activeRecipeId) : null;

    const todaysBatches = sessionLog
        .filter(e => e.isBatch && new Date(e.date).toDateString() === today);

    if (todaysBatches.length === 0 && !activeRecipe) {
        container.innerHTML = '<p class="text-gray-500 text-center">No batches logged today</p>';
        return;
    }

    let html = '';

    if (activeRecipe) {
        const lifetime = activeRecipe.lifetimeTotal || 0;
        html += `
            <div class="mb-4 p-4 bg-indigo-900/30 rounded-lg border border-indigo-700">
                <div class="text-sm text-indigo-300">Currently Active Load</div>
                <div class="text-2xl font-bold text-white">${activeRecipe.caliber} - ${activeRecipe.notes || 'Untitled'}</div>
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
                <div class="flex justify-between items-center py-3 px-4 bg-gray-800/60 rounded-lg mb-2">
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

// === 3. Update setActiveLoad() to close old batch when switching loads ===
function setActiveLoad(id) {
    if (activeRecipeId && activeRecipeId !== id) {
        // Switching loads → forces a new batch next time
        showMessage("Switched active load — next rounds start a new batch", "info");
    }
    activeRecipeId = id;
    localStorage.setItem('active_recipe_id', id);
    renderRecipes(currentFilter);
    updateActiveLoadDisplay();
}

// === 4. Optional: Add a "New Batch" button (force split) ===

function forceNewBatch() {
    if (!activeRecipeId) return;
    // Just advance the "last update" time far into the past
    const lastBatch = sessionLog.find(e => e.recipeId === activeRecipeId && e.isBatch);
    if (lastBatch) {
        lastBatch.lastUpdate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // yesterday
    }
    showMessage("Next rounds will start a new batch", "info");
}

activeRecipeId = parseInt(localStorage.getItem('active_recipe_id')) || null;

// Auto-render when tab is opened
document.querySelector('[data-tab="recipes"]').addEventListener('click', () => {
    renderRecipes(currentFilter);
});

// Initial render on page load
renderRecipes();
