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

    async fetchGearDashboard(limit = 10000) {
      return fetchJson(`/api/gear/dashboard?limit=${limit}`);
    },

    async fetchDaily(limit = 60) {
      return fetchJson(`/api/daily?limit=${limit}`);
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

    async fetchYearly() {
      return fetchJson("/api/yearly");
    },

    async saveWeeklyComment(weekStart, payload) {
      const response = await fetch(`/api/weekly/commentary/${encodeURIComponent(weekStart)}`, {
        method: "POST",
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
  };

  window.api = api;
})();
