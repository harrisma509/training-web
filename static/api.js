/*
 * api.js
 * Shared API contract for the app shell and feature modules.
 * Owns fetch boilerplate, JSON handling, and endpoint wrappers; feature files should call window.api.*
 * instead of embedding raw fetch calls. The rendering/state code stays in each feature module, not here.
 */
(function () {
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText || "Request failed"}`);
    }

    return response.json();
  }

  const api = {
    fetchJson,

    async fetchCoachSessions() {
      return fetchJson("/api/coach/sessions");
    },

    async fetchCoachSession(sessionId) {
      return fetchJson(`/api/coach/sessions/${encodeURIComponent(sessionId)}`);
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

    async fetchDaily(limit = 60, q = "") {
      const trimmedQuery = typeof q === "string" ? q.trim() : "";
      const effectiveLimit = trimmedQuery ? 1000 : Math.max(1, Number(limit) || 60);
      const params = new URLSearchParams({ limit: String(effectiveLimit) });
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      const payload = await fetchJson(`/api/daily?${params.toString()}`);
      if (trimmedQuery && payload && typeof payload === "object" && Array.isArray(payload.rows)) {
        return payload;
      }
      return payload;
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

    async requestSync() {
      return fetchJson("/api/sync-request", {
        method: "POST",
      });
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
