const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const syncSource = fs.readFileSync("static/sync.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const dailySource = fs.readFileSync("static/daily.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");

assert.equal(
  (syncSource.match(/registerFeature\("sync", syncController\)/g) || []).length,
  1,
  "Sync must register exactly once",
);
assert.match(syncSource, /const syncController = \{/);
for (const method of ["init", "loadStatus", "refresh", "runSync", "cleanup"]) {
  assert.match(syncSource, new RegExp(`${method}:`), method);
}
assert.match(syncSource, /syncStatusRequest/);
assert.match(syncSource, /syncRequestGeneration/);
assert.match(syncSource, /setInterval\(loadSyncStatus, 60000\)/);
assert.match(syncSource, /clearInterval\(syncStatusInterval\)/);
assert.match(syncSource, /clearTimeout\(syncButtonResetTimer\)/);
assert.match(syncSource, /addEventListener\("beforeunload", cleanupSync\)/);
assert.match(syncSource, /syncNowBtn\?\.addEventListener\("click", handleSyncNow\)/);
assert.match(syncSource, /requestGeneration === syncRequestGeneration/);
assert.match(syncSource, /window\.api\.requestSync/);
assert.doesNotMatch(appSource, /registerFeature\("sync"/);
assert.doesNotMatch(appSource, /fetchSyncStatus|loadSyncStatus\(|syncNowBtn|handleSyncNow|setInterval\(/);
assert.match(appSource, /features\?\.sync\?\.init\?\./);
assert.match(appSource, /features\?\.sync\?\.refresh\?\./);
assert.match(dailySource, /resyncDay/);
assert.match(dailySource, /fetchSyncRequestStatus/);
assert.ok(
  templateSource.indexOf("/static/sync.js?v={{ asset_version }}")
    < templateSource.indexOf("/static/app.js?v={{ asset_version }}"),
  "sync.js must load before app.js",
);

function createElement() {
  return {
    className: "sync-pill sync-muted",
    innerHTML: "",
    disabled: false,
    textContent: "Sync Now",
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = this.listeners[name] || [];
      this.listeners[name].push(listener);
    },
  };
}

async function main() {
  const elements = {
    syncStatus: createElement(),
    syncNowBtn: createElement(),
  };
  const windowListeners = {};
  const timers = [];
  const clearedIntervals = [];
  const clearedTimeouts = [];
  let nextTimerId = 1;
  let statusCalls = 0;
  let statusResolve;
  const statusPayload = { health: "healthy", label: "Sync current" };

  const window = {
    api: {
      fetchSyncStatus: () => {
        statusCalls += 1;
        return new Promise(resolve => {
          statusResolve = resolve;
        });
      },
      requestSync: async () => ({ created: true }),
    },
    setInterval(callback, delay) {
      const timer = { id: nextTimerId += 1, callback, delay };
      timers.push(timer);
      return timer.id;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
    },
    setTimeout(callback, delay) {
      const timer = { id: nextTimerId += 1, callback, delay };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      clearedTimeouts.push(id);
    },
    addEventListener(name, listener) {
      windowListeners[name] = windowListeners[name] || [];
      windowListeners[name].push(listener);
    },
    TrainingApp: undefined,
  };
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const context = { window, document, fetch: async () => ({ json: async () => statusPayload }), Promise, console };
  vm.runInNewContext(syncSource, context);

  const controller = window.TrainingApp.features.sync;
  assert.equal(controller, window.SyncController, "compatibility controller must alias registry identity");
  assert.equal(window.TrainingApp.features.sync, controller);
  assert.equal(timers.filter(timer => timer.delay === 60000).length, 1, "startup must create one status interval");
  assert.equal(elements.syncNowBtn.listeners.click.length, 1, "startup must attach one Sync listener");
  assert.equal(statusCalls, 0, "initialization must not issue a status request");

  controller.init();
  assert.equal(timers.filter(timer => timer.delay === 60000).length, 1, "repeated initialization must not duplicate timers");
  assert.equal(elements.syncNowBtn.listeners.click.length, 1, "repeated initialization must not duplicate listeners");

  const firstRefresh = controller.refresh();
  const duplicateRefresh = controller.refresh();
  await Promise.resolve();
  assert.equal(statusCalls, 1, "repeated refresh must coalesce one in-flight status request");
  statusResolve(statusPayload);
  assert.equal(await firstRefresh, statusPayload);
  assert.equal(await duplicateRefresh, statusPayload);
  assert.match(elements.syncStatus.innerHTML, /Sync current/);

  const explicitRefresh = controller.refresh();
  await Promise.resolve();
  assert.equal(statusCalls, 2, "explicit refresh must issue one new status request");
  statusResolve({ health: "running", label: "Sync running" });
  await explicitRefresh;
  assert.match(elements.syncStatus.innerHTML, /Sync running/);

  const staleRefresh = controller.refresh();
  await Promise.resolve();
  assert.equal(statusCalls, 3);
  controller.cleanup();
  statusResolve({ health: "failed", label: "stale response" });
  await staleRefresh;
  assert.doesNotMatch(elements.syncStatus.innerHTML, /stale response/);
  assert.equal(clearedIntervals.length, 1, "cleanup must clear the status interval once");
  assert.equal(windowListeners.beforeunload.length, 1, "cleanup listener must be stable");
  windowListeners.beforeunload[0]();
  assert.equal(clearedIntervals.length, 1, "repeated cleanup must not clear a timer twice");
  assert.equal(clearedTimeouts.length, 0, "no manual Sync timer exists before a Sync request");

  console.log("F34 Sync ownership contract tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});