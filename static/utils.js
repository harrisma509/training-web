(function () {
  function safe(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    return value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function truncateText(value, maxLength = 100) {
    if (value == null) {
      return "";
    }
    const stringValue = String(value);
    return stringValue.length <= maxLength
      ? stringValue
      : `${stringValue.slice(0, maxLength)}…`;
  }

  function formatDisplayTimestamp(value) {
    if (!value) {
      return "n/a";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatRequestDuration(value) {
    if (value == null || value === "" || Number.isNaN(Number(value))) {
      return "n/a";
    }

    const totalSeconds = Number(value);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
      return "n/a";
    }

    const wholeSeconds = Math.floor(totalSeconds);
    if (wholeSeconds < 60) {
      return `${wholeSeconds} sec`;
    }

    const minutes = Math.floor(wholeSeconds / 60);
    const seconds = wholeSeconds % 60;
    return `${minutes} min ${seconds} sec`;
  }

  window.safe = safe;
  window.escapeHtml = escapeHtml;
  window.truncateText = truncateText;
  window.formatDisplayTimestamp = formatDisplayTimestamp;
  window.formatRequestDuration = formatRequestDuration;
})();
