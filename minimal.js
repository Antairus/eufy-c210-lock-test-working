// The whole thing, minus diagnostics. `node minimal.js lock` / `node minimal.js unlock`.
// The command itself is ONE line - station.lockDevice(device, true/false). The rest is login.
const { EufySecurity } = require("eufy-security-client");

(async () => {
  const api = await EufySecurity.initialize({
    username: process.env.EUFY_USER,
    password: process.env.EUFY_PASS,
    country: "US",
    language: "en",
    persistentDir: __dirname,
  });

  await new Promise(async (done) => { api.on("connect", done); await api.connect(); });
  await new Promise((r) => setTimeout(r, 5000)); // let devices populate

  const device = (await api.getDevices())[0];
  const station = await api.getStation(device.getStationSerial());

  station.lockDevice(device, process.argv[2] !== "unlock"); // <-- the one line

  await new Promise((r) => setTimeout(r, 8000));
  await api.close();
  process.exit(0);
})();
