# Supported Reloaders

## Dillon 1050

Standard progressive reloading press, optionally motorized.

- **Identification**: No identification message sent on connect. Default assumed device.
- **Data format**: `Pri=%d,Cas=%d,Bul=%d,Cnt=%d,Powder=%d,Mot=%d,Mute=%d,DwellDur=%d,DwellAct=%d,MotorEn=%d`
- **Commands**: `RESET_COUNT`, `CAL_HIGH`, `CAL_LOW`, `SET_MUTE_0/1`, `SET_DWELL_ACTIVE_0/1`, `SET_DWELL_DUR_<ms>`, `SET_MOTOR_EN_0/1`
- **Features**: Motor control via BLE, dwell beep settings, full calibration

## AmmoLoad Inline

Inline ammunition loading system with additional sensor capabilities.

- **Identification**: Sends `Maker=Ammoload,API=1.0` as first message on connect
- **Data format**: `Pri=%d,Cas=%d,Bul=%d,Cnt=%d,Powder=%d,Mot=%d,Mute=%d,CaseObs=%d,PdAlign=%d,PowChk=%d`
- **Commands**: `RESET_COUNT`, `COUNT_UP`, `COUNT_DOWN`, `CAL_HIGH`, `CAL_LOW`, `SET_MUTE_0/1`
- **Features**: Extra sensors (Case Obstruction, Primer Disk Alignment, Powder Check). NO motor control via BLE. No Dwell/MotorEn settings.

## Field Comparison

| Field | Dillon 1050 | AmmoLoad Inline | Description |
|-------|:-----------:|:---------------:|-------------|
| `Pri` | Y | Y | Primer presence (1=OK, 0=LOW) |
| `Cas` | Y | Y | Case presence (1=OK, 0=LOW) |
| `Bul` | Y | Y | Bullet presence (1=OK, 0=LOW) |
| `Cnt` | Y | Y | Round counter |
| `Powder` | Y | Y | Powder hopper level (%) |
| `Mot` | Y | Y | Motor state (0=IDLE, 1=FWD, 2=REV) |
| `Mute` | Y | Y | Mute alerts toggle |
| `DwellDur` | Y | - | Dwell beep duration (ms) |
| `DwellAct` | Y | - | Dwell beep active toggle |
| `MotorEn` | Y | - | Motor control enabled toggle |
| `CaseObs` | - | Y | Case obstruction sensor (1=OK, 0=BLOCKED) |
| `PdAlign` | - | Y | Primer disk alignment (1=OK, 0=MISALIGNED) |
| `PowChk` | - | Y | Powder charge check (1=OK, 0=FAIL) |

## Command Comparison

| Command | Dillon 1050 | AmmoLoad Inline | Description |
|---------|:-----------:|:---------------:|-------------|
| `CMD=RESET_COUNT` | Y | Y | Reset round counter to 0 |
| `CMD=COUNT_UP` | - | Y | Increment counter by 1 |
| `CMD=COUNT_DOWN` | - | Y | Decrement counter by 1 |
| `CMD=CAL_HIGH` | Y | Y | Calibrate powder hopper max |
| `CMD=CAL_LOW` | Y | Y | Calibrate powder hopper min |
| `CMD=SET_MUTE_0/1` | Y | Y | Toggle alert mute |
| `CMD=SET_DWELL_ACTIVE_0/1` | Y | - | Toggle dwell beep |
| `CMD=SET_DWELL_DUR_<ms>` | Y | - | Set dwell duration |
| `CMD=SET_MOTOR_EN_0/1` | Y | - | Toggle motor control |
