# eufy C210 (T8502): lock/unlock works — and why so many people think it doesn't

**TL;DR — a Smart Lock C210 (T8502) locks and unlocks fine through
`eufy-security-client`.** Verified 2026-08-02, both directions, bolt physically
observed, `locked` and `lockStatus` property-change events received about two seconds
after each command.

Versions, precisely: the lock/unlock run was against a **build of `main` reporting
4.1.1**. The read-only diagnostic path was additionally re-run against what
`npm install eufy-security-client` actually gives you today — **4.1.1-1**, which is
what the `latest` dist-tag points at (note: a 4.2.0 exists on npm but is not tagged
`latest`). Both see the lock correctly: `deviceType 180`, `hasProperty(locked) = true`,
27 properties.

That contradicts a lot of reports, so this repo contains a minimal standalone
reproduction plus the diagnostic that we think explains most of those reports.

```
19:09:32 toggle: currently locked=true -> commanding UNLOCK
19:09:32 sending UNLOCK to T8502xxxxxxxxxxxx via station T8502xxxxxxxxxxxx
19:09:32 EVENT T8502xxxxxxxxxxxx locked -> false
19:09:34 EVENT T8502xxxxxxxxxxxx lockStatus -> 3
```

## The thing worth knowing: one error message, two different causes

`Station.lockDevice()` throws the string
**"This functionality is not implemented or supported by this device"** from **two
separate places**:

1. **early** — `if (!device.hasProperty(PropertyName.DeviceLocked))`
2. **late** — the final `else`, when the device type matches no command branch

Cause 2 is what everyone assumes when they read the message: *the library has no
support for my lock.* For the T8502 specifically, **that assumption is wrong.** We
checked published versions **3.2.0, 3.5.0, 3.7.2, 3.8.0, 4.0.0, 4.1.1 and 4.2.0** — the
`isLockWifiT8502()` branch is present in `lockDevice()` in **every one of them**,
including 3.2.0, the version most failure reports cite. Support has been there the
whole time.

Which leaves cause 1. And cause 1 has a mechanism worth checking:

`hasProperty()` → `getPropertiesMetadata()` → `DeviceProperties[this.getDeviceType()]`.
If your device reports a **`device_type` number that isn't in that table**, the
metadata object is **empty**, `DeviceLocked` is therefore absent, and `lockDevice()`
refuses — with the message that reads like "your lock isn't supported."

Our working C210 reports **`deviceType 180`** (`LOCK_8502`). *That* is the number to
compare against.

This is also consistent with reports of a C210 showing up as an alarm/station rather
than a lock, with no lock entity created: an unmapped device type produces no lock
properties for anything upstream to build an entity from.

**Hypothesis, stated as one:** we could only test the hardware we own, one unit that
works. We have verified the code paths and the version history; we have *not* verified
what `device_type` a failing unit reports. That is exactly the number this script
prints, and if yours is not 180, you have found something the maintainer can map.

## Instructions

**Requirements:** Node.js 18 or newer (`node --version` to check), and the email and
password for the eufy app account the lock is registered to. Works on Windows, macOS
and Linux.

**1. Get the files and install the one dependency**

```bash
git clone <this-repo>
cd eufy-c210-lock-test
npm install
```

**2. Put in your account details**

Copy `creds.example.json` to `creds.json` and edit it:

```json
{ "username": "you@example.com", "password": "your-eufy-password", "country": "US", "language": "en" }
```

Watch the quoting — the password goes on the **right** of the colon. (A misplaced quote
puts it in the key position, where diagnostics that print "just the field names" will
happily print your password.) `creds.json` is gitignored.

**3. Look before you touch — this sends nothing**

```bash
node c210-lock-test.js
```

You should see your lock listed with `deviceType`, whether that type is mapped as a
known lock, `hasProperty(locked)`, the **property count**, and current state. A working
C210 looks like this:

```
- Front Door | model T8502 | sn T8502xxxxxxxxxxxx | deviceType 180
    deviceType mapped as a known lock? yes - LOCK_8502 (C210)
    hasProperty(locked) = true
    property count: 27
    locked: true
```

**If the property count is 0**, or `hasProperty(locked) = false`, or the deviceType is
not 180 — stop here, that's your actual problem, and `KNOWN-ISSUES.md` §1 explains it.

If eufy asks for a captcha or 2FA, the script tells you: it writes `captcha.html` next
to itself, and you put the code into a file named `code.txt`. It picks it up on its own.

**4. Move the bolt**

> ⚠️ **Prop the door open and put a physical key in your pocket first.** This drives a
> real deadbolt on a real door.

```bash
node c210-lock-test.js toggle     # reads live state, commands the opposite
```

Success looks like an event within a couple of seconds:

```
toggle: currently locked=true -> commanding UNLOCK
EVENT T8502xxxxxxxxxxxx locked -> false
EVENT T8502xxxxxxxxxxxx lockStatus -> 3
```

Use `toggle` rather than `lock` / `unlock` for testing — see `KNOWN-ISSUES.md` §4 for
why an absolute command can look like a failure when it actually worked.

**5. Just want the code?**

`minimal.js` is the same thing with the diagnostics stripped out — about twenty lines,
of which the command is one:

```js
station.lockDevice(device, true);   // false = unlock
```

Run it with your credentials in the environment:

```bash
EUFY_USER=you@example.com EUFY_PASS=secret node minimal.js lock
```

---

⚠️ **Before you share anything from your own run:** the library writes a
**`persistent.json`** next to the script containing your **account email, cloud session
tokens, user id and a client private key**. It is gitignored here, but check for it by
hand before you zip a folder, attach a log, or push a repo — nothing announces that it
exists, and it is live access to your account. Same for `creds.json`. Redact device
serials from any output you paste.

## Gotchas

All seven of them, each hit for real, are written up in **[KNOWN-ISSUES.md](KNOWN-ISSUES.md)**.
The ones most likely to cost you an afternoon:

1. **The error message is ambiguous** — one string, two very different causes (§1).
2. **`persistentDir` must already exist**, or the session cache is silently skipped,
   every run re-logs in, and eufy captchas you (§2).
3. **`persistent.json` holds live account credentials** — never publish it (§3).
4. **An absolute command matching the current state is a silent no-op** and looks
   exactly like failure — use `toggle` (§4).
5. **`npm install` gives 4.1.1-1, not the newest** (§5).
6. **Via `eufy-security-ws`:** `lockDevice` is gated on `schemaVersion <= 12` and raises
   a *different* error above that — rule it out separately (§6).
7. **This is cloud control, not local** (§7).

## Scope / honesty

- Verified: one C210 (T8502), `eufy-security-client` 4.1.1, direct library calls, both
  directions, repeated.
- Not verified: any failing unit's device type; any claim about *why* another person's
  setup fails. That is the open question this script exists to answer.
- This is cloud-authenticated control. Fine for convenience; we would not put it in
  the trust path of a front door as the only actuator.

No rights reserved — use it however you like. All credit for the library to
[bropat/eufy-security-client](https://github.com/bropat/eufy-security-client).
