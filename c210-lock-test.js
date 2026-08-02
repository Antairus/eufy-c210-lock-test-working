/**
 * eufy C210 / T8502 lock-command test + diagnostic
 * ------------------------------------------------
 * Minimal standalone reproduction showing that eufy-security-client CAN lock and
 * unlock a Smart Lock C210 (T8502), and printing the one number that explains most
 * "This functionality is not implemented or supported by this device" reports.
 *
 * Verified working 2026-08-02 against eufy-security-client 4.1.1, both directions,
 * bolt observed moving, property-change events received within ~2 seconds.
 *
 * Usage:
 *   npm install eufy-security-client
 *   cp creds.example.json creds.json     # then edit it
 *   node c210-lock-test.js               # read-only: enumerate + diagnose, sends nothing
 *   node c210-lock-test.js toggle        # reads live state, commands the OPPOSITE
 *   node c210-lock-test.js lock          # absolute
 *   node c210-lock-test.js unlock        # absolute
 *
 * TEST WITH THE DOOR PROPPED OPEN and a physical key on you. This drives a real deadbolt.
 *
 * No rights reserved - do whatever you like with it.
 * All credit for the heavy lifting to bropat/eufy-security-client.
 */

const fs = require("fs");
const path = require("path");
const { EufySecurity, PropertyName } = require("eufy-security-client");

const HERE = __dirname;
const PHASE = (process.argv[2] || "read").toLowerCase();
const CODE_FILE = path.join(HERE, "code.txt");

// Device types this script knows are mapped as locks in the library's property table.
// If your lock reports a type NOT in here, that is very likely your bug - see README.
const KNOWN_LOCK_TYPES = { 180: "LOCK_8502 (C210)" };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function waitForCode(prompt) {
  log(`>>> ${prompt}`);
  log(`>>> Put the code in ${CODE_FILE} and save.`);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (fs.existsSync(CODE_FILE)) {
      const code = fs.readFileSync(CODE_FILE, "utf8").trim();
      if (code) {
        fs.unlinkSync(CODE_FILE);
        return code;
      }
    }
  }
  throw new Error("no code supplied within 5 minutes");
}

(async () => {
  const creds = JSON.parse(fs.readFileSync(path.join(HERE, "creds.json"), "utf8"));
  // Never print credential values - and never enumerate the file's keys either: a
  // misplaced quote can put a secret in the KEY position, where "names are safe to
  // print" quietly stops being true. Check only for the keys you expect.
  if (!creds.username || !creds.password) {
    throw new Error('creds.json must contain {"username": "...", "password": "..."}');
  }

  // persistentDir must EXIST. If it doesn't, the session cache silently isn't written
  // and every run does a full fresh login - which gets you a captcha from eufy after a
  // handful of runs. (Learned the hard way, 2026-08-02.) Keep persistent.json; just
  // never publish it - see the warning in the README.
  const persistDir = path.join(HERE, "persist");
  fs.mkdirSync(persistDir, { recursive: true });

  const api = await EufySecurity.initialize({
    username: creds.username,
    password: creds.password,
    country: creds.country || "US",
    language: creds.language || "en",
    persistentDir: persistDir,
    pollingIntervalMinutes: 10,
  });

  let connected = false;
  api.on("connect", () => {
    connected = true;
    log("connected to eufy cloud");
  });

  api.on("captcha request", async (captchaId, captcha) => {
    fs.writeFileSync(path.join(HERE, "captcha.html"), `<img src="${captcha}" style="zoom:3">`);
    const code = await waitForCode("CAPTCHA required - open captcha.html next to this script");
    await api.connect({ captcha: { captchaId, captchaCode: code } });
  });

  api.on("tfa request", async () => {
    const code = await waitForCode("2FA required - check your email/SMS for the eufy code");
    await api.connect({ verifyCode: code });
  });

  api.on("device property changed", (device, name, value) => {
    if (/lock|battery/i.test(name)) {
      log(`EVENT ${device.getSerial()} ${name} -> ${JSON.stringify(value)}`);
    }
  });

  await api.connect();
  for (let i = 0; i < 90 && !connected; i++) await new Promise((r) => setTimeout(r, 2000));
  if (!connected) throw new Error("never connected (3 minutes)");
  await new Promise((r) => setTimeout(r, 5000));

  const devices = await api.getDevices();
  log(`devices on account: ${devices.length}`);

  let lock = null;
  for (const d of devices) {
    const type = d.getDeviceType();
    log(`- ${d.getName()} | model ${d.getModel()} | sn ${d.getSerial()} | deviceType ${type}`);

    // THE DIAGNOSTIC. An unmapped deviceType yields an EMPTY property table, so
    // hasProperty(DeviceLocked) is false, and lockDevice() throws the very same
    // "not implemented or supported by this device" string that it throws when a
    // device type has no command branch. Two causes, one message.
    const knowsType = Object.prototype.hasOwnProperty.call(KNOWN_LOCK_TYPES, type);
    const hasLocked = d.hasProperty(PropertyName.DeviceLocked);
    log(`    deviceType mapped as a known lock? ${knowsType ? "yes - " + KNOWN_LOCK_TYPES[type] : "NO <-- suspect"}`);
    log(`    hasProperty(${PropertyName.DeviceLocked}) = ${hasLocked}${hasLocked ? "" : "  <-- lockDevice() WILL refuse"}`);
    log(`    property count: ${Object.keys(d.getPropertiesMetadata()).length}${
      Object.keys(d.getPropertiesMetadata()).length === 0 ? "  <-- empty table = unmapped device type" : ""
    }`);

    for (const p of [PropertyName.DeviceLocked, PropertyName.DeviceLockStatus, PropertyName.DeviceBattery]) {
      try {
        log(`    ${p}: ${JSON.stringify(d.getPropertyValue(p))}`);
      } catch (e) {
        log(`    ${p}: <${e.message}>`);
      }
    }
    if (hasLocked && !lock) lock = d;
  }

  if (PHASE === "read") {
    log("read phase complete - nothing was sent");
    await api.close();
    process.exit(0);
  }

  if (!lock) throw new Error("no device with a DeviceLocked property found");

  const station = await api.getStation(lock.getStationSerial());
  let target;
  if (PHASE === "toggle") {
    // Command the OPPOSITE of live state. An absolute command that matches the
    // current state is a silent no-op, and a no-op looks exactly like "ignored".
    const now = lock.getPropertyValue(PropertyName.DeviceLocked);
    target = !now;
    log(`toggle: currently locked=${now} -> commanding ${target ? "LOCK" : "UNLOCK"}`);
  } else {
    target = PHASE === "lock";
  }

  log(`sending ${target ? "LOCK" : "UNLOCK"} to ${lock.getSerial()} via station ${station.getSerial()}`);
  station.lockDevice(lock, target);
  log("sent - watching events for 30s");
  await new Promise((r) => setTimeout(r, 30000));
  try {
    log(`final locked = ${JSON.stringify(lock.getPropertyValue(PropertyName.DeviceLocked))}`);
  } catch {}
  await api.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
