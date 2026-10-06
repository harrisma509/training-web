/*
 * api.js
 * Shared API contract for the app shell and feature modules.
 * Owns fetch boilerplate, JSON handling, and endpoint wrappers; feature files should call window.api.*
 * instead of embedding raw fetch calls. The rendering/state code stays in each feature module, not here.
 */
(function () {
  const SAFE_CSV_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[cC][sS][vV]$/;

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText || "Request failed"}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  function csvFilenameFromDisposition(disposition, fallbackFilename) {
    if (!SAFE_CSV_FILENAME.test(fallbackFilename || "")) {
      throw new TypeError("A safe fallback CSV filename is required.");
    }

    const header = String(disposition || "");
    const extended = header.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i);
    const ordinary = header.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
    let candidate = "";

    if (extended) {
      try {
        candidate = decodeURIComponent(extended[1].trim());
      } catch (_error) {
        candidate = "";
      }
    } else if (ordinary) {
      candidate = (ordinary[1] || ordinary[2] || "").trim();
    }

    return SAFE_CSV_FILENAME.test(candidate) ? candidate : fallbackFilename;
  }

  async function downloadCsv(url, fallbackFilename, requestOptions = {}) {
    if (!SAFE_CSV_FILENAME.test(fallbackFilename || "")) {
      throw new TypeError("A safe fallback CSV filename is required.");
    }
    if (!requestOptions || typeof requestOptions !== "object" || Array.isArray(requestOptions)) {
      throw new TypeError("CSV download request options must be an object.");
    }

    let target;
    try {
      target = new URL(url, window.location.href);
    } catch (_error) {
      throw new TypeError("A valid same-origin CSV URL is required.");
    }
    if (target.origin !== window.location.origin) {
      throw new Error("CSV downloads must use a same-origin URL.");
    }

    const fetchOptions = {
      headers: { Accept: "text/csv" },
    };
    const requestOptionKeys = Object.keys(requestOptions);
    if (requestOptionKeys.length) {
      if (
        requestOptions.method !== "POST"
        || typeof requestOptions.body !== "string"
        || requestOptionKeys.some(key => !["method", "body"].includes(key))
      ) {
        throw new TypeError("CSV downloads support only a JSON POST body.");
      }
      fetchOptions.method = "POST";
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = requestOptions.body;
    }

    const response = await fetch(target.href, fetchOptions);
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText || "CSV download failed"}`);
      error.status = response.status;
      throw error;
    }
    if (!/^text\/csv(?:\s*;|$)/i.test(response.headers?.get("Content-Type") || "")) {
      throw new Error("CSV download returned an unexpected content type.");
    }

    const blob = await response.blob();
    const filename = csvFilenameFromDisposition(
      response.headers?.get("Content-Disposition"),
      fallbackFilename,
    );
    const objectUrl = window.URL.createObjectURL(blob);
    let anchor = null;
    try {
      anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error) {
      window.URL.revokeObjectURL(objectUrl);
      throw error;
    } finally {
      anchor?.remove();
    }
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
    return filename;
  }

  const api = {
    fetchJson,
    downloadCsv,

    async fetchCoachSessions() {
      return fetchJson("/api/coach/sessions");
    },

    async fetchCoachSession(sessionId) {
      return fetchJson(`/api/coach/sessions/${encodeURIComponent(sessionId)}`);
    },

    async updateCoachSession(sessionId, payload = {}) {
      const requestPayload = {};
      if (payload && Object.prototype.hasOwnProperty.call(payload, "title")) {
        requestPayload.title = payload.title;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "mode")) {
        requestPayload.mode = payload.mode;
      }
      const response = await fetch(`/api/coach/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "Coach session update failed"}`);
        error.status = response.status;
        error.detail = typeof detail.detail === "string" ? detail.detail : "";
        throw error;
      }
      return response.json();
    },

    async deleteCoachSession(sessionId) {
      const response = await fetch(`/api/coach/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "Coach session delete failed"}`);
        error.status = response.status;
        error.detail = typeof detail.detail === "string" ? detail.detail : "";
        throw error;
      }
      return response.json();
    },

    async fetchCoachUsage(sessionId) {
      return fetchJson(`/api/coach/sessions/${encodeURIComponent(sessionId)}/usage`);
    },

    async createCoachSession() {
      return fetchJson("/api/coach/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New coaching session" }),
      });
    },

    async respondToCoach(sessionId, message) {
      const response = await fetch(`/api/coach/sessions/${encodeURIComponent(sessionId)}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "Coach request failed"}`);
        error.status = response.status;
        error.detail = typeof detail.detail === "string" ? detail.detail : "";
        throw error;
      }
      return response.json();
    },

    async fetchGearDashboard(limit = 10000) {
      return fetchJson(`/api/gear/dashboard?limit=${limit}`);
    },

    async fetchDaily(limit = 60, q = "", date = "") {
      const trimmedQuery = typeof q === "string" ? q.trim() : "";
      const effectiveLimit = trimmedQuery ? 1000 : Math.max(1, Number(limit) || 60);
      const params = new URLSearchParams({ limit: String(effectiveLimit) });
      if (date) params.set("date", String(date));
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      const payload = await fetchJson(`/api/daily?${params.toString()}`);
      if (trimmedQuery && payload && typeof payload === "object" && Array.isArray(payload.rows)) {
        return payload;
      }
      return payload;
    },

    async searchActivities(filters = {}) {
      const params = new URLSearchParams();
      Object.entries(filters || {}).forEach(([key, value]) => {
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          params.set(key, String(value).trim());
        }
      });
      return fetchJson(`/api/activities/search?${params.toString()}`);
    },

    async fetchActivitySearchTypes() {
      return fetchJson("/api/activities/search/types");
    },

    async fetchActivityNarrative(activityId) {
      return fetchJson(`/api/activities/${encodeURIComponent(activityId)}/narrative`);
    },

    async fetchDailyCheckins(startDate, endDate) {
      const params = new URLSearchParams({
        start_date: String(startDate),
        end_date: String(endDate),
      });
      return fetchJson(`/api/daily-checkins?${params.toString()}`);
    },

    async saveDailyCheckin(checkinDate, payload = {}) {
      const response = await fetch(`/api/daily-checkins/${encodeURIComponent(checkinDate)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "Save failed"}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    },

    async deleteDailyCheckin(checkinDate) {
      const response = await fetch(`/api/daily-checkins/${encodeURIComponent(checkinDate)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "Delete failed"}`);
        error.status = response.status;
        throw error;
      }
      return null;
    },

    async fetchRideSearch(query, limit = 5) {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q || q.length < 2) {
        return { rows: [], total_count: 0 };
      }

      const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);
      return fetchJson(`/api/rides/search?q=${encodeURIComponent(q)}&limit=${safeLimit}`);
    },

    async fetchWeekly(limit = 60) {
      return fetchJson(`/api/weekly?limit=${limit}`);
    },

    async fetchZones(limit = 60) {
      return fetchJson(`/api/zones?limit=${limit}`);
    },

    async fetchSystemStatus() {
      return fetchJson("/api/system-status");
    },

    async fetchComponents(selectedGearId = "") {
      const endpoint = selectedGearId
        ? `/api/gear/components?gear_id=${encodeURIComponent(selectedGearId)}`
        : "/api/gear/components";
      return fetchJson(endpoint);
    },

    async fetchComponentServices(gearComponentId) {
      return fetchJson(`/api/components/${encodeURIComponent(gearComponentId)}/services`);
    },

    async fetchComponentServiceSnapshot(gearComponentId, serviceDate) {
      const params = new URLSearchParams({ service_date: String(serviceDate || "") });
      return fetchJson(`/api/components/${encodeURIComponent(gearComponentId)}/service-snapshot?${params.toString()}`);
    },

    async createComponent(payload = {}) {
      const response = await fetch("/api/gear/components", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Create failed"}`);
      }

      return response.json();
    },

    async updateComponent(gearComponentId, payload = {}) {
      const response = await fetch(`/api/components/${encodeURIComponent(gearComponentId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Update failed"}`);
      }

      return response.json();
    },

    async archiveComponent(gearComponentId) {
      const response = await fetch(`/api/components/${encodeURIComponent(gearComponentId)}/archive`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Archive failed"}`);
      }

      return response.json();
    },

    async restoreComponent(gearComponentId) {
      const response = await fetch(`/api/components/${encodeURIComponent(gearComponentId)}/restore`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Restore failed"}`);
      }

      return response.json();
    },

    async createComponentService(gearComponentId, payload = {}) {
      const response = await fetch(`/api/components/${encodeURIComponent(gearComponentId)}/services`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Save failed"}`);
      }

      return response.json();
    },

    async updateComponentService(gearComponentId, serviceEventId, payload = {}) {
      const response = await fetch(`/api/components/${encodeURIComponent(gearComponentId)}/services/${encodeURIComponent(serviceEventId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Update failed"}`);
      }

      return response.json();
    },

    async fetchSyncStatus() {
      return fetchJson("/api/sync-status");
    },

    async fetchAppPreferences() {
      return fetchJson("/api/settings/app-preferences");
    },

    async saveAppPreferences(payload = {}) {
      const response = await fetch("/api/settings/app-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `${response.status} ${response.statusText || "Save failed"}`);
      }

      return response.json();
    },

    async fetchAiCoachSettings() {
      return fetchJson("/api/settings/ai-coach");
    },

    async saveAiCoachSettings(payload = {}) {
      const response = await fetch("/api/settings/ai-coach", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "AI Coach settings save failed"}`);
        error.status = response.status;
        error.detail = typeof detail.detail === "string" ? detail.detail : "";
        throw error;
      }

      return response.json();
    },

    async fetchAiCoachCustomInstructions() {
      return fetchJson("/api/settings/ai-coach/custom-instructions");
    },

    async saveAiCoachCustomInstructions(payload = {}) {
      const response = await fetch("/api/settings/ai-coach/custom-instructions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.detail || `${response.status} ${response.statusText || "AI Coach Custom Instructions save failed"}`);
        error.status = response.status;
        error.detail = typeof detail.detail === "string" ? detail.detail : "";
        throw error;
      }

      return response.json();
    },

    async fetchCoachMemories(status = "all") {
      const params = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
      return fetchJson(`/api/settings/ai-coach/memories${params}`);
    },

    async createCoachMemory(payload = {}) {
      return fetchJson("/api/settings/ai-coach/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    },

    async updateCoachMemory(memoryId, payload = {}) {
      return fetchJson(`/api/settings/ai-coach/memories/${encodeURIComponent(memoryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    },

    async setCoachMemoryActive(memoryId, active) {
      const action = active ? "reactivate" : "deactivate";
      return fetchJson(`/api/settings/ai-coach/memories/${encodeURIComponent(memoryId)}/${action}`, {
        method: "POST",
      });
    },

    async fetchCoachContextReceipt(turnId) {
      return fetchJson(`/api/coach/turns/${encodeURIComponent(turnId)}/context-receipt`);
    },

    async requestSync() {
      return fetchJson("/api/sync-request", {
        method: "POST",
      });
    },

    async previewDayResync(dateText) {
      return fetchJson(`/api/sync/dates/${encodeURIComponent(dateText)}/resync-preview`);
    },

    async resyncDay(dateText) {
      return fetchJson(`/api/sync/dates/${encodeURIComponent(dateText)}/resync`, {
        method: "POST",
      });
    },

    async resyncActivity(activityId) {
      return fetchJson(`/api/sync/activities/${encodeURIComponent(activityId)}/resync`, {
        method: "POST",
      });
    },

    async fetchSyncRequestStatus(requestId) {
      return fetchJson(`/api/sync-requests/${encodeURIComponent(requestId)}`);
    },

    async fetchYearly() {
      return fetchJson("/api/yearly");
    },

    async fetchWeightChart(year) {
      const params = new URLSearchParams();
      if (Number.isInteger(year)) {
        params.set("year", String(year));
      }
      const suffix = params.toString();
      return fetchJson(`/api/charts/weight${suffix ? `?${suffix}` : ""}`);
    },

    async fetchAnnualWeightChart() {
      return fetchJson("/api/charts/weight/annual");
    },

    async getFitnessFatigueSummary() {
      return fetchJson("/api/charts/load/fitness-fatigue");
    },

    async getFitnessFatigueTrend(range) {
      return fetchJson(`/api/charts/load/fitness-fatigue/trend?range=${encodeURIComponent(range)}`);
    },

    async getWeeklyLoadTrend(range, metric) {
      const params = new URLSearchParams({ range, metric });
      return fetchJson(`/api/charts/load/weekly?${params.toString()}`);
    },

    async fetchMonthlyVolume(year, metric) {
      const params = new URLSearchParams({ year: String(year), metric });
      return fetchJson(`/api/charts/volume/monthly?${params.toString()}`);
    },

    async fetchWeeklyAuditItems(weekStart) {
      return fetchJson(`/api/weekly-audit/${encodeURIComponent(weekStart)}/items`);
    },

    async fetchWeeklyCommentary(weekStart) {
      return fetchJson(`/api/weekly-commentary/${encodeURIComponent(weekStart)}`);
    },

    async saveWeeklyComment(weekStart, payload) {
      const response = await fetch(`/api/weekly-commentary/${encodeURIComponent(weekStart)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText || "Save failed"}`);
      }

      return response.json();
    },

    async saveWeeklyCommentary(weekStart, payload) {
      return this.saveWeeklyComment(weekStart, payload);
    },

    async fetchYearlyCommentary(calendarYear) {
      return fetchJson(`/api/yearly/commentary/${encodeURIComponent(calendarYear)}`);
    },

    async previewYearlyCalculation(payload = {}) {
      return fetchJson("/api/yearly/calculate/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    },

    async calculateYearly(payload = {}) {
      return fetchJson("/api/yearly/calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    },
  };

  window.api = api;
})();
