(function () {
  const TYPES = ["medical", "safety", "training_goal", "schedule", "event", "equipment", "preference", "lesson_learned"];
  const PRIORITIES = ["critical", "high", "normal"];
  const SCOPES = ["all_training", "planning", "recovery", "strength", "weight", "mtb", "emtb", "bike_park", "gravel", "skiing"];
  const scopeLabels = { all_training: "All training", bike_park: "Bike park", emtb: "E-MTB" };
  const refs = {
    filter: document.getElementById("aiCoachMemoryStatusFilter"),
    status: document.getElementById("aiCoachMemoriesStatus"),
    error: document.getElementById("aiCoachMemoriesError"),
    list: document.getElementById("aiCoachMemoriesList"),
    form: document.getElementById("aiCoachMemoryForm"),
    formTitle: document.getElementById("aiCoachMemoryFormTitle"),
    id: document.getElementById("aiCoachMemoryId"),
    type: document.getElementById("aiCoachMemoryType"),
    priority: document.getElementById("aiCoachMemoryPriority"),
    title: document.getElementById("aiCoachMemoryTitle"),
    text: document.getElementById("aiCoachMemoryText"),
    textCount: document.getElementById("aiCoachMemoryTextCount"),
    scopes: document.getElementById("aiCoachMemoryScopes"),
    effectiveDate: document.getElementById("aiCoachMemoryEffectiveDate"),
    expiresAt: document.getElementById("aiCoachMemoryExpiresAt"),
    active: document.getElementById("aiCoachMemoryActive"),
    save: document.getElementById("aiCoachMemorySave"),
    cancel: document.getElementById("aiCoachMemoryCancel"),
  };
  let memories = [];
  let loading = false;

  function option(select, value, label) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    select.appendChild(item);
  }

  function label(value) {
    return scopeLabels[value] || value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
  }

  function setStatus(message, isError = false) {
    refs.status.textContent = message || "";
    refs.status.classList.toggle("error", isError);
  }

  function setError(message) {
    refs.error.textContent = message || "";
  }

  function formatDate(value) {
    if (!value) return "No date";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }

  function renderList() {
    refs.list.replaceChildren();
    if (!memories.length) {
      refs.list.appendChild(Object.assign(document.createElement("p"), {
        className: "settings-help-text",
        textContent: "No memories match this filter.",
      }));
      return;
    }
    memories.forEach(memory => {
      const item = document.createElement("article");
      item.className = "settings-memory-item";
      const heading = document.createElement("div");
      heading.className = "settings-memory-item-heading";
      const title = document.createElement("strong");
      title.textContent = memory.title;
      heading.appendChild(title);
      const badge = document.createElement("span");
      badge.className = `settings-memory-badge settings-memory-status-${memory.status}`;
      badge.textContent = `${label(memory.status)} / ${label(memory.priority)}`;
      heading.appendChild(badge);
      item.appendChild(heading);
      const meta = document.createElement("div");
      meta.className = "settings-memory-meta";
      meta.textContent = `${label(memory.memory_type)} • ${memory.applies_to.map(label).join(", ")} • Effective ${formatDate(memory.effective_date)}`;
      item.appendChild(meta);
      const body = document.createElement("p");
      body.textContent = memory.memory_text;
      item.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "settings-memory-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button-secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => startEdit(memory));
      actions.appendChild(edit);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "button-secondary";
      toggle.textContent = memory.is_active ? "Deactivate" : "Reactivate";
      toggle.addEventListener("click", () => toggleActive(memory));
      actions.appendChild(toggle);
      item.appendChild(actions);
      refs.list.appendChild(item);
    });
  }

  function readScopes() {
    return Array.from(refs.scopes.querySelectorAll("input:checked"), input => input.value);
  }

  function resetForm() {
    refs.form.reset();
    refs.id.value = "";
    refs.type.value = TYPES[0];
    refs.priority.value = "normal";
    refs.active.checked = true;
    refs.formTitle.textContent = "Add memory";
    refs.save.textContent = "Add memory";
    refs.cancel.classList.add("hidden");
    refs.scopes.querySelectorAll("input").forEach(input => { input.checked = input.value === "all_training"; });
    updateCount();
  }

  function startEdit(memory) {
    refs.id.value = memory.memory_id;
    refs.type.value = memory.memory_type;
    refs.priority.value = memory.priority;
    refs.title.value = memory.title;
    refs.text.value = memory.memory_text;
    refs.effectiveDate.value = memory.effective_date || "";
    refs.expiresAt.value = memory.expires_at ? memory.expires_at.slice(0, 16) : "";
    refs.active.checked = Boolean(memory.is_active);
    refs.scopes.querySelectorAll("input").forEach(input => { input.checked = memory.applies_to.includes(input.value); });
    refs.formTitle.textContent = "Edit memory";
    refs.save.textContent = "Save changes";
    refs.cancel.classList.remove("hidden");
    updateCount();
    refs.title.focus();
  }

  function updateCount() {
    refs.textCount.textContent = `${refs.text.value.length.toLocaleString()} / 1,000`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    setError("");
    setStatus("Loading memories...");
    try {
      const payload = await window.api.fetchCoachMemories(refs.filter.value);
      memories = Array.isArray(payload.memories) ? payload.memories : [];
      renderList();
      setStatus(`${memories.length} memor${memories.length === 1 ? "y" : "ies"}`);
    } catch (error) {
      memories = [];
      renderList();
      setStatus("Unable to load memories.", true);
      setError(error.message || "The server could not load Durable Memories.");
    } finally {
      loading = false;
    }
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const scopes = readScopes();
    if (!refs.title.value.trim() || !refs.text.value.trim() || !scopes.length) {
      setError("Title, memory text, and at least one applicability scope are required.");
      return;
    }
    const payload = {
      memory_type: refs.type.value,
      title: refs.title.value.trim(),
      memory_text: refs.text.value.trim(),
      applies_to: scopes,
      priority: refs.priority.value,
      effective_date: refs.effectiveDate.value || null,
      expires_at: refs.expiresAt.value ? new Date(refs.expiresAt.value).toISOString() : null,
      is_active: refs.active.checked,
    };
    refs.save.disabled = true;
    try {
      if (refs.id.value) await window.api.updateCoachMemory(refs.id.value, payload);
      else await window.api.createCoachMemory(payload);
      resetForm();
      await load();
    } catch (error) {
      setError(error.message || "Unable to save this memory.");
    } finally {
      refs.save.disabled = false;
    }
  }

  async function toggleActive(memory) {
    setError("");
    try {
      await window.api.setCoachMemoryActive(memory.memory_id, !memory.is_active);
      await load();
    } catch (error) {
      setError(error.message || "Unable to change this memory's status.");
    }
  }

  function initialize() {
    TYPES.forEach(value => option(refs.type, value, label(value)));
    PRIORITIES.forEach(value => option(refs.priority, value, label(value)));
    SCOPES.forEach(value => {
      const labelElement = document.createElement("label");
      labelElement.className = "settings-choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = value;
      labelElement.appendChild(checkbox);
      labelElement.appendChild(document.createTextNode(label(value)));
      refs.scopes.appendChild(labelElement);
    });
    refs.form.addEventListener("submit", save);
    refs.cancel.addEventListener("click", resetForm);
    refs.filter.addEventListener("change", load);
    refs.text.addEventListener("input", updateCount);
    resetForm();
  }

  initialize();
  window.CoachMemoriesController = { activate: load };
})();
