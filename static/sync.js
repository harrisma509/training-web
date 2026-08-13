/*
 * sync.js
 * Synchronization status feature.
 * Owns the sync pill UI and request flow used by the header controls. It communicates through the app shell and
 * the backend API while keeping the sync status rendering local to this module.
 */
function getSyncElements() {
  return {
    syncStatus: document.getElementById("syncStatus"),
    syncNowBtn: document.getElementById("syncNowBtn"),
  };
}

function renderSyncStatusPlaceholder() {
  const { syncStatus } = getSyncElements();
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

async function loadSyncStatus() {
  const { syncStatus } = getSyncElements();

  try {
    const data = window.api && typeof window.api.fetchSyncStatus === "function"
      ? await window.api.fetchSyncStatus()
      : await fetch("/api/sync-status").then(response => response.json());
    renderSyncStatus(data);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync status error</span>
    `;
  }
}

function renderSyncStatus(data) {
  const { syncStatus } = getSyncElements();
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

async function handleSyncNow() {
  const { syncNowBtn, syncStatus } = getSyncElements();

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

    window.setTimeout(() => {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync Now";
    }, 4000);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync request failed</span>
    `;

    syncNowBtn.disabled = false;
    syncNowBtn.textContent = "Sync Now";
  }
}
