(function () {
  let syncInitialized = false;
  let syncStatusRequest = null;
  let syncRequestGeneration = 0;
  let syncStatusInterval = null;
  let syncButtonResetTimer = null;

  function getSyncElements() {
    return {
      syncStatus: document.getElementById("syncStatus"),
      syncNowBtn: document.getElementById("syncNowBtn"),
    };
  }

  function renderSyncStatusPlaceholder() {
    const { syncStatus } = getSyncElements();
    if (!syncStatus) {
      return;
    }
    syncStatus.className = "sync-pill sync-muted";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync status not wired</span>
    `;
  }

  function formatSyncTime(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function renderSyncStatus(data) {
    const { syncStatus } = getSyncElements();
    if (!syncStatus) {
      return;
    }
    const health = data.health || "unknown";

    const statusClass = health === "healthy"
      ? "sync-healthy"
      : health === "stale"
        ? "sync-stale"
        : health === "failed"
          ? "sync-failed"
          : health === "pending" || health === "running"
            ? "sync-running"
            : "sync-muted";

    const label = data.label || "Sync status unknown";
    const syncTime = formatSyncTime(data.last_sync_time_utc);
    const requestTime = formatSyncTime(data.sync_request_time_utc);
    const hours = data.hours_since_good_sync;

    let detail = label;

    if (health === "pending") {
      detail = requestTime
        ? `Sync requested · ${requestTime}`
        : "Sync requested";
    } else if (health === "running") {
      detail = requestTime
        ? `Sync running · requested ${requestTime}`
        : "Sync running";
    } else {
      if (syncTime) {
        detail = `${detail} · ${syncTime}`;
      }

      if (hours !== null && hours !== undefined) {
        detail = `${detail} · ${hours}h ago`;
      }

      if ((data.warning_count ?? 0) > 0) {
        detail = `${detail} · ${data.warning_count} warn`;
      }
    }

    syncStatus.className = `sync-pill ${statusClass}`;
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>${detail}</span>
    `;
  }

  function renderSyncStatusError(message) {
    const { syncStatus } = getSyncElements();
    if (!syncStatus) {
      return;
    }
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>${message}</span>
    `;
  }

  function loadSyncStatus() {
    if (syncStatusRequest) {
      return syncStatusRequest;
    }

    const requestGeneration = syncRequestGeneration + 1;
    syncRequestGeneration = requestGeneration;
    syncStatusRequest = Promise.resolve()
      .then(() => window.api && typeof window.api.fetchSyncStatus === "function"
        ? window.api.fetchSyncStatus()
        : fetch("/api/sync-status").then(response => response.json()))
      .then(data => {
        if (requestGeneration === syncRequestGeneration) {
          renderSyncStatus(data);
        }
        return data;
      })
      .catch(error => {
        if (requestGeneration === syncRequestGeneration) {
          renderSyncStatusError("Sync status error");
        }
        return null;
      })
      .finally(() => {
        if (syncStatusRequest) {
          syncStatusRequest = null;
        }
      });

    return syncStatusRequest;
  }

  async function handleSyncNow() {
    const { syncNowBtn } = getSyncElements();
    const syncStatus = getSyncElements().syncStatus;
    if (!syncNowBtn) {
      return;
    }

    syncNowBtn.disabled = true;
    syncNowBtn.textContent = "Requesting...";

    try {
      const result = window.api && typeof window.api.requestSync === "function"
        ? await window.api.requestSync()
        : await fetch("/api/sync-request", {
            method: "POST"
          }).then(async response => {
            if (!response.ok) {
              throw new Error("Sync request failed");
            }
            return response.json();
          });

      syncNowBtn.textContent = result.created ? "Requested" : "Already Queued";

      await loadSyncStatus();

      if (syncButtonResetTimer) {
        window.clearTimeout(syncButtonResetTimer);
      }
      syncButtonResetTimer = window.setTimeout(() => {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = "Sync Now";
        syncButtonResetTimer = null;
      }, 4000);
    } catch (error) {
      if (syncStatus) {
        renderSyncStatusError("Sync request failed");
      }

      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync Now";
    }
  }

  function cleanupSync() {
    if (syncStatusInterval) {
      window.clearInterval(syncStatusInterval);
      syncStatusInterval = null;
    }
    if (syncButtonResetTimer) {
      window.clearTimeout(syncButtonResetTimer);
      syncButtonResetTimer = null;
    }
    syncRequestGeneration += 1;
  }

  function initializeSync() {
    if (syncInitialized) {
      return true;
    }

    syncInitialized = true;
    const { syncNowBtn } = getSyncElements();
    syncNowBtn?.addEventListener("click", handleSyncNow);
    syncStatusInterval = window.setInterval(loadSyncStatus, 60000);
    window.addEventListener("beforeunload", cleanupSync);
    return true;
  }

  const syncController = {
    init: initializeSync,
    loadStatus: loadSyncStatus,
    refresh: loadSyncStatus,
    runSync: handleSyncNow,
    cleanup: cleanupSync,
  };

  window.TrainingApp = window.TrainingApp || { features: {} };
  window.TrainingApp.features = window.TrainingApp.features || {};
  window.TrainingApp.registerFeature = window.TrainingApp.registerFeature || function (name, feature) {
    if (!feature || typeof feature !== "object") return;
    if (!Object.prototype.hasOwnProperty.call(window.TrainingApp.features, name)) {
      window.TrainingApp.features[name] = feature;
    }
  };
  window.TrainingApp.registerFeature("sync", syncController);

  window.SyncController = syncController;
  window.loadSyncStatus = loadSyncStatus;
  window.handleSyncNow = handleSyncNow;
  initializeSync();
})();
