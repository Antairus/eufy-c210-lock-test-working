# Known issues & gotchas

Everything here was hit for real while getting a Smart Lock C210 (T8502) to lock and
unlock on 2026-08-02. Each one cost time, and none of them announced itself.

---

## 1. "This functionality is not implemented or supported by this device" is ambiguous

**Symptom:** you can read battery and lock state, but any lock/unlock command throws
this. Most threads conclude the lock is unsupported.

**Cause:** `Station.lockDevice()` throws that *identical string* from **two different
places**:

| # | Guard | Real meaning |
|---|---|---|
| 1 | `!device.hasProperty(PropertyName.DeviceLocked)` | the device has no lock property — often because its `device_type` isn't in the library's table at all |
| 2 | the final `else` after the device-type branches | no lock command is implemented for this device type |

Everyone reads it as #2. For the T8502 that's provably wrong: we extracted the published
tarballs for **3.2.0, 3.5.0, 3.7.2, 3.8.0, 4.0.0, 4.1.1, 4.2.0** and `isLockWifiT8502()`
appears in `lockDevice()`'s branch list in **every one**, including 3.2.0 — the version
cited in most failure reports.

**So check #1.** `hasProperty()` → `getPropertiesMetadata()` →
`DeviceProperties[getDeviceType()]`. An unmapped `device_type` returns an **empty**
property table, `DeviceLocked` is absent, and you get the message that looks like
"unsupported device."

**Diagnostic:** run `node c210-lock-test.js` (read-only). It prints `deviceType`,
whether that type is mapped, `hasProperty(locked)`, and the property count. Our working
unit: **`deviceType 180` (LOCK_8502), 27 properties**. An empty property table is the
smoking gun.

**Status:** open. We own one lock and it works, so we cannot test a failing unit. If
yours reports a type other than 180, that's a mapping gap worth reporting upstream.

**Suggested upstream fix:** make the two messages distinguishable, e.g.
`"device has no DeviceLocked property (device type NNN may be unmapped)"` vs
`"no lock command implemented for device type NNN"`.

---

## 2. `persistentDir` must already exist, or you get captcha'd

**Symptom:** after a handful of runs, login starts failing with a captcha challenge.

**Cause:** if the directory passed as `persistentDir` doesn't exist, the session cache is
**silently not written** — no error, no warning. Every run then performs a full fresh
login, and eufy's anti-abuse eventually challenges you. We hit it after six logins in
about half an hour.

**Fix:** create the directory before initializing (the scripts here do it with
`fs.mkdirSync(dir, { recursive: true })`). Then `persistent.json` is written once and
reused, and you stop re-authenticating.

**If you're already captcha'd:** the script writes `captcha.html` next to itself — open
it, read the code, and put the code in `code.txt`. It picks it up automatically. Or wait
it out.

---

## 3. `persistent.json` contains live account credentials — never publish it

The library writes **`persistent.json`** beside the script (or in your `persistentDir`).
It contains:

- your account **email**
- **cloud session tokens** (and their expiry)
- your **user id**
- a **client private key** and shared keys

That is working access to your eufy account, and therefore to your door. It is in the
`.gitignore` here, but **check for it by hand before zipping a folder, attaching a log,
or pushing a repo.** Nothing announces that it exists.

Same for `creds.json`. And if you ever paste console output publicly, redact device
serials — they are account-adjacent identifiers.

---

## 4. An absolute lock/unlock command that matches the current state is a silent no-op

**Symptom:** you send `unlock`, nothing happens, and you conclude the command is being
ignored.

**Cause:** if the lock is *already* unlocked, a correct, successfully-delivered command
produces no observable change. A no-op and a rejected command look identical from
outside. Our first two actuation tests failed this way — a human at the door kept
changing the state between runs.

**Fix:** use `node c210-lock-test.js toggle`. It reads the live state and commands the
**opposite**, so a working command always produces a visible change.

---

## 5. `npm install` doesn't give you the newest version

`latest` currently resolves to **4.1.1-1**, even though **4.2.0** exists on npm
(untagged). Our lock/unlock proof ran on a `main` build reporting **4.1.1**; the
read/diagnostic path was re-verified on the npm-installed **4.1.1-1**. If you need a
specific one, ask for it explicitly:

```bash
npm install eufy-security-client@4.2.0
```

---

## 6. Going through `eufy-security-ws` / Home Assistant? Different error, check separately

In `eufy-security-ws`, the `device.lock_device` command is gated on
`client.schemaVersion <= 12`; above that it raises `UnknownCommandError` — which is *not*
the error discussed in issue #1 above. If your failure message differs, rule this out
before assuming a device-support problem.

---

## 7. This is cloud control, not local control

Commands authenticate through eufy's servers. Fine for convenience and dashboards. We
would not make it the only actuator in the trust path of a front door — a Z-Wave or
Zigbee deadbolt keeps the whole chain inside your house. Also, this is an unofficial
client: eufy can change something and break it at any time.
