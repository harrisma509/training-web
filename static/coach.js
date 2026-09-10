/* Coach workspace controller. Keeps persisted conversations server-backed and model output DOM-safe. */
(function () {
    function chooseSessionMenuPlacement(triggerRect, menuRect, visibleRailRect, viewportHeight) {
        const visibleTop = Math.max(visibleRailRect.top, 0);
        const visibleBottom = Math.min(visibleRailRect.bottom, viewportHeight);
        const menuHeight = menuRect.height;
        const downwardSpace = visibleBottom - triggerRect.bottom;
        const upwardSpace = triggerRect.top - visibleTop;
        if (downwardSpace >= menuHeight) return "down";
        if (upwardSpace >= menuHeight) return "up";
        return downwardSpace >= upwardSpace ? "down" : "up";
    }

    function hasNewPersistedUserMessage(messages, message, existingMessageIds) {
        return messages.some(item => {
            const messageId = item && item.coach_message_id;
            return item
                && item.role === "user"
                && item.message_text === message
                && messageId !== null
                && messageId !== undefined
                && String(messageId).trim() !== ""
                && !existingMessageIds.has(String(messageId));
        });
    }

    if (typeof document === "undefined" && typeof module !== "undefined") {
        module.exports = { chooseSessionMenuPlacement, hasNewPersistedUserMessage };
        return;
    }

    const MAX_MESSAGE_LENGTH = 12000;
    const SELECTED_SESSION_KEY = "coachSessionId";
    const STAGES = [
        "Loading your training context",
        "Reviewing training and recovery",
        "Preparing your coaching recommendation",
    ];
    const state = {
        sessions: [],
        selectedSessionId: "",
        session: null,
        usage: null,
        initialized: false,
        sessionsLoading: false,
        conversationLoading: false,
        creating: false,
        responsePending: false,
        pendingMessage: "",
        error: "",
        sessionsError: "",
        drawerOpen: false,
        loadToken: 0,
        stageTimer: null,
        stageIndex: 0,
        previousFocus: null,
        editingSessionId: "",
        renamePending: false,
        renameError: "",
        renameDraft: "",
        renameOriginalTitle: "",
        renameRevision: 0,
        sessionMenuId: "",
        deleteSessionId: "",
        deletePending: false,
        deleteError: "",
        deletePreviousFocus: null,
        sessionStatusMessage: "",
    };

    const refs = {
        tab: document.getElementById("coachTab"),
        pane: document.getElementById("coachPane"),
        sessions: document.getElementById("coachSessions"),
        sessionStatus: document.getElementById("coachSessionStatus"),
        newChat: document.getElementById("coachNewChat"),
        sessionRail: document.getElementById("coachSessionRail"),
        drawerOpen: document.getElementById("coachDrawerOpen"),
        drawerClose: document.getElementById("coachDrawerClose"),
        drawerBackdrop: document.getElementById("coachDrawerBackdrop"),
        title: document.getElementById("coachSessionTitle"),
        meta: document.getElementById("coachSessionMeta"),
        usageToggle: document.getElementById("coachUsageToggle"),
        usagePanel: document.getElementById("coachUsagePanel"),
        conversation: document.getElementById("coachConversation"),
        error: document.getElementById("coachError"),
        loading: document.getElementById("coachLoadingStatus"),
        composer: document.getElementById("coachComposer"),
        input: document.getElementById("coachMessageInput"),
        send: document.getElementById("coachSend"),
        characterCount: document.getElementById("coachCharacterCount"),
        deleteDialog: document.getElementById("coachDeleteDialog"),
        deleteCancel: document.getElementById("coachDeleteCancel"),
        deleteConfirm: document.getElementById("coachDeleteConfirm"),
        deleteDialogError: document.getElementById("coachDeleteDialogError"),
    };

    function text(value, fallback = "") {
        return value === null || value === undefined ? fallback : String(value);
    }

    function validSessionId(value) {
        return /^\d+$/.test(text(value).trim()) && Number(value) > 0;
    }

    function sessionId(session) {
        return text(session && (session.coach_session_id || session.session_id));
    }

    function formatTime(value) {
        if (!value) return "No recent activity";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Recent activity";
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" });
    }

    function groupName(value) {
        if (!value) return "Older";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Older";
        const now = new Date();
        const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "numeric", day: "numeric" }).format(now);
        const current = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "numeric", day: "numeric" }).format(date);
        if (today === current) return "Today";
        const age = (Date.now() - date.getTime()) / 86400000;
        return age <= 7 ? "Previous 7 days" : "Older";
    }

    function formatTokens(value) {
        if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "Unavailable";
        const amount = Number(value);
        return amount >= 1000 ? `${(amount / 1000).toFixed(1).replace(/\.0$/, "")}K` : amount.toLocaleString("en-US");
    }

    function formatCost(value) {
        if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "Cost unavailable";
        return `$${Number(value).toFixed(4)}`;
    }

    function formatLatency(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Latency unavailable";
        return `${(Number(value) / 1000).toFixed(1)} sec`;
    }

    function humanModel(value) {
        const model = text(value);
        if (!model) return "Model unavailable";
        return model.toLowerCase().includes("gpt-5.6") ? "GPT-5.6 Luna" : model;
    }

    function clearNode(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    function makeElement(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function showError(message) {
        state.error = message || "";
        refs.error.textContent = state.error;
        refs.error.classList.toggle("hidden", !state.error);
    }

    function mapError(error) {
        const status = Number(error && error.status);
        const detail = safeServerDetail(error && error.detail);
        if (status === 409) return "A coaching response is already being prepared for this session.";
        if (status === 429) return detail || "The AI Coach is temporarily unable to accept another request.";
        if (status === 502) return detail && /context|training data/i.test(detail) ? detail : "The Coach could not generate a response.";
        if (status === 503) return detail && /context|training data/i.test(detail) ? detail : "The Coach is temporarily unavailable.";
        if (status === 504) return "The Coach took too long to respond. The turn was recorded as timed out.";
        return "The Coach could not complete this response.";
    }

    function safeServerDetail(detail) {
        const value = text(detail).trim();
        if (!value || value.length > 240 || /[\r\n\u0000-\u001f]/.test(value)) return "";
        if (/(traceback|stack trace|exception|https?:\/\/|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|secret|provider body)/i.test(value)) return "";
        return value;
    }

    function sortSessions(sessions) {
        return sessions.map((session, index) => ({ session, index, timestamp: Date.parse(session.last_activity_at || "") }))
            .sort((left, right) => {
                const leftValid = Number.isFinite(left.timestamp);
                const rightValid = Number.isFinite(right.timestamp);
                if (leftValid !== rightValid) return leftValid ? -1 : 1;
                if (leftValid && left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
                return left.index - right.index;
            })
            .map(entry => entry.session);
    }

    function sessionSummaryUsage(usage) {
        return usage || {};
    }

    function renderUsage() {
        clearNode(refs.usagePanel);
        const usage = sessionSummaryUsage(state.usage);
        const items = [
            ["Model", humanModel(usage.default_model || usage.model)],
            ["Messages", usage.message_count == null ? "Unavailable" : text(usage.message_count)],
            ["Turns", usage.turn_count == null ? "Unavailable" : text(usage.turn_count)],
            ["Tokens", formatTokens(usage.total_tokens)],
            ["Estimated cost", formatCost(usage.estimated_cost_usd)],
        ];
        items.forEach(([label, value]) => {
            const item = makeElement("div", "coach-usage-item");
            item.append(makeElement("span", "coach-usage-label", label), makeElement("span", "coach-usage-value", value));
            refs.usagePanel.appendChild(item);
        });
    }

    function renderSessions() {
        clearNode(refs.sessions);
        if (state.sessionsLoading) {
            refs.sessionStatus.textContent = "Loading conversations...";
        } else if (state.sessionsError) {
            refs.sessionStatus.textContent = "Could not load conversations.";
            refs.sessions.appendChild(makeElement("p", "coach-empty-sessions", state.sessionsError));
            const retry = makeElement("button", "coach-copy-button", "Retry");
            retry.type = "button";
            retry.addEventListener("click", () => loadSessions());
            refs.sessions.appendChild(retry);
        }
        if (!state.sessions.length && state.sessionsError) return;
        if (!state.sessions.length && !state.sessionsLoading) {
            refs.sessionStatus.textContent = state.sessionStatusMessage || "No conversations yet.";
            refs.sessions.appendChild(makeElement("p", "coach-empty-sessions", "Start a new chat to begin."));
            return;
        }
        if (!state.sessionsError && !state.sessionsLoading) refs.sessionStatus.textContent = state.sessionStatusMessage;
        const groups = ["Today", "Previous 7 days", "Older"];
        groups.forEach(group => {
            const sessions = state.sessions.filter(session => groupName(session.last_activity_at) === group);
            if (!sessions.length) return;
            refs.sessions.appendChild(makeElement("div", "coach-session-group", group));
            sessions.forEach(session => {
                const id = sessionId(session);
                const title = text(session.title, "New coaching session");
                const row = makeElement("div", `coach-session-row${id === state.selectedSessionId ? " is-active" : ""}`);
                row.setAttribute("role", "listitem");
                if (state.editingSessionId === id) {
                    const form = makeElement("form", "coach-session-edit-form");
                    const input = makeElement("input", "coach-session-edit-input");
                    input.type = "text";
                    input.value = state.renameDraft || title;
                    input.maxLength = 200;
                    input.dataset.coachRenameInput = id;
                    input.setAttribute("aria-label", `Rename ${title}`);
                    input.setAttribute("aria-describedby", `coach-rename-error-${id}`);
                    input.setAttribute("aria-busy", String(state.renamePending));
                    input.disabled = state.renamePending;
                    const error = makeElement("span", "coach-session-rename-error", state.renameError);
                    error.id = `coach-rename-error-${id}`;
                    error.setAttribute("role", "status");
                    error.setAttribute("aria-live", "polite");
                    error.hidden = !state.renameError;
                    form.append(input, error);
                    form.addEventListener("submit", event => {
                        event.preventDefault();
                        saveRename(id, input.value);
                    });
                    input.addEventListener("keydown", event => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename(true);
                        }
                    });
                    input.addEventListener("blur", () => saveRename(id, input.value));
                    row.appendChild(form);
                    refs.sessions.appendChild(row);
                    input.focus();
                    input.select();
                    return;
                }
                const select = makeElement("button", "coach-session-select");
                select.type = "button";
                select.setAttribute("aria-current", id === state.selectedSessionId ? "true" : "false");
                select.disabled = state.responsePending;
                select.append(
                    makeElement("span", "coach-session-title", title),
                    makeElement("span", "coach-session-time", formatTime(session.last_activity_at)),
                );
                select.addEventListener("click", () => selectSession(id));
                const actions = makeElement("div", "coach-session-actions");
                const actionButton = makeElement("button", "coach-session-actions-button", "⋯");
                actionButton.type = "button";
                actionButton.setAttribute("aria-label", `Chat actions for ${title}`);
                actionButton.setAttribute("aria-haspopup", "menu");
                actionButton.setAttribute("aria-expanded", String(state.sessionMenuId === id));
                actionButton.setAttribute("aria-controls", `coach-session-menu-${id}`);
                actionButton.dataset.coachSessionActions = id;
                actionButton.addEventListener("click", event => {
                    event.stopPropagation();
                    toggleSessionMenu(id);
                });
                actions.appendChild(actionButton);
                if (state.sessionMenuId === id) {
                    const menu = makeElement("div", "coach-session-menu");
                    menu.id = `coach-session-menu-${id}`;
                    menu.setAttribute("role", "menu");
                    const rename = makeElement("button", "", "Rename");
                    rename.type = "button";
                    rename.setAttribute("role", "menuitem");
                    rename.addEventListener("click", event => {
                        event.stopPropagation();
                        startRename(id);
                    });
                    const deleteButton = makeElement("button", "is-destructive", "Delete chat");
                    deleteButton.type = "button";
                    deleteButton.setAttribute("role", "menuitem");
                    deleteButton.disabled = isSessionGenerating(id);
                    deleteButton.addEventListener("click", event => {
                        event.stopPropagation();
                        openDeleteDialog(id);
                    });
                    menu.append(rename, deleteButton);
                    menu.addEventListener("keydown", handleSessionMenuKeydown);
                    actions.appendChild(menu);
                }
                row.append(select, actions);
                refs.sessions.appendChild(row);
            });
        });
    }

    function startRename(id) {
        if (state.responsePending || state.renamePending || !validSessionId(id)) return;
        const session = state.sessions.find(item => sessionId(item) === id);
        if (!session) return;
        state.sessionMenuId = "";
        state.editingSessionId = id;
        state.renameError = "";
        state.renameDraft = text(session.title, "New coaching session");
        state.renameOriginalTitle = state.renameDraft.trim();
        state.renameRevision += 1;
        renderSessions();
    }

    function cancelRename(restoreFocus) {
        const editingId = state.editingSessionId;
        state.renameRevision += 1;
        state.editingSessionId = "";
        state.renameError = "";
        state.renameDraft = "";
        state.renameOriginalTitle = "";
        renderSessions();
        if (restoreFocus && editingId) {
            focusSessionActions(editingId);
        }
    }

    async function saveRename(id, value) {
        if (state.editingSessionId !== id || state.renamePending) return;
        const title = text(value).trim();
        state.renameDraft = text(value);
        if (!title) {
            state.renameError = "Title cannot be blank.";
            renderSessions();
            return;
        }
        if (title === state.renameOriginalTitle) {
            cancelRename(false);
            return;
        }
        const revision = state.renameRevision;
        state.renamePending = true;
        state.renameError = "";
        renderSessions();
        try {
            const payload = await window.api.updateCoachSession(id, { title });
            const updated = payload && payload.session;
            state.sessions = state.sessions.map(session => sessionId(session) === id
                ? { ...session, ...(updated || {}), title }
                : session);
            if (state.session && sessionId(state.session.session) === id) {
                state.session.session = { ...state.session.session, ...(updated || {}), title };
            }
            state.editingSessionId = "";
            state.renameError = "";
            state.renameDraft = "";
            state.renameOriginalTitle = "";
            updateHeader();
        } catch (error) {
            state.renameError = safeServerDetail(error && error.detail) || "Could not rename this conversation.";
        } finally {
            state.renamePending = false;
            renderSessions();
            if (state.renameRevision === revision && state.editingSessionId === id && state.renameError) {
                const input = refs.sessions.querySelector(`[data-coach-rename-input="${id}"]`);
                if (input) {
                    input.focus();
                    input.select();
                }
            } else if (state.editingSessionId !== id) {
                focusSessionActions(id);
            }
        }
    }

    function focusSessionActions(id) {
        const button = refs.sessions.querySelector(`[data-coach-session-actions="${id}"]`);
        if (button) button.focus();
    }

    function isSessionGenerating(id) {
        if (state.responsePending && state.selectedSessionId === id) return true;
        if (state.selectedSessionId !== id || !state.session || !Array.isArray(state.session.turns)) return false;
        return state.session.turns.some(turn => turn && turn.status === "started");
    }

    function toggleSessionMenu(id) {
        if (state.renamePending || state.deletePending) return;
        state.sessionMenuId = state.sessionMenuId === id ? "" : id;
        renderSessions();
        if (state.sessionMenuId === id) {
            placeSessionMenu(id);
            const item = refs.sessions.querySelector(`#coach-session-menu-${id} [role="menuitem"]`);
            if (item) item.focus();
        }
    }

    function placeSessionMenu(id) {
        const trigger = refs.sessions.querySelector(`[data-coach-session-actions="${id}"]`);
        const menu = refs.sessions.querySelector(`#coach-session-menu-${id}`);
        if (!trigger || !menu) return;
        const triggerRect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const railRect = refs.sessionRail.getBoundingClientRect();
        const sessionsRect = refs.sessions.getBoundingClientRect();
        const visibleRailRect = {
            top: Math.max(railRect.top, sessionsRect.top),
            bottom: Math.min(railRect.bottom, sessionsRect.bottom),
        };
        menu.classList.toggle(
            "is-upward",
            chooseSessionMenuPlacement(triggerRect, menuRect, visibleRailRect, window.innerHeight) === "up",
        );
    }

    function handleSessionMenuKeydown(event) {
        const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
        if (!items.length) return;
        const current = items.indexOf(document.activeElement);
        if (event.key === "Escape") {
            event.preventDefault();
            const id = state.sessionMenuId;
            state.sessionMenuId = "";
            renderSessions();
            focusSessionActions(id);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const next = event.key === "Home" ? 0
                : event.key === "End" ? items.length - 1
                    : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next].focus();
        }
    }

    function renderDeleteDialog() {
        if (!refs.deleteDialog) return;
        refs.deleteDialog.classList.toggle("hidden", !state.deleteSessionId);
        refs.deleteDialogError.textContent = state.deleteError;
        refs.deleteDialog.setAttribute("aria-busy", String(state.deletePending));
        refs.deleteCancel.disabled = state.deletePending;
        refs.deleteConfirm.disabled = state.deletePending;
    }

    async function openDeleteDialog(id) {
        if (!validSessionId(id) || state.deletePending || isSessionGenerating(id)) return;
        if (state.editingSessionId === id) {
            await saveRename(id, state.renameDraft);
            if (state.editingSessionId === id || state.renamePending) return;
        }
        state.sessionMenuId = "";
        state.deleteSessionId = id;
        state.deleteError = "";
        state.deletePreviousFocus = refs.sessions.querySelector(`[data-coach-session-actions="${id}"]`) || document.activeElement;
        renderSessions();
        renderDeleteDialog();
        refs.deleteCancel.focus();
    }

    function closeDeleteDialog(restoreFocus = true) {
        const previousFocus = state.deletePreviousFocus;
        state.deleteSessionId = "";
        state.deleteError = "";
        state.deletePending = false;
        state.deletePreviousFocus = null;
        renderDeleteDialog();
        if (restoreFocus && previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    }

    async function confirmDelete() {
        const id = state.deleteSessionId;
        if (!id || state.deletePending || isSessionGenerating(id)) return;
        state.deletePending = true;
        state.deleteError = "";
        renderDeleteDialog();
        try {
            await window.api.deleteCoachSession(id);
            const deletedIndex = state.sessions.findIndex(session => sessionId(session) === id);
            const remaining = state.sessions.filter(session => sessionId(session) !== id);
            const next = deletedIndex >= 0 ? (remaining[deletedIndex] || remaining[deletedIndex - 1]) : remaining[0];
            closeDeleteDialog(false);
            state.sessionMenuId = "";
            state.editingSessionId = "";
            state.renameDraft = "";
            state.renameOriginalTitle = "";
            state.sessions = remaining;
            state.selectedSessionId = "";
            state.session = null;
            state.usage = null;
            state.loadToken += 1;
            state.sessionStatusMessage = "Chat permanently deleted.";
            window.AppState.coachSessionId = next ? sessionId(next) : "";
            window.persistPreferences();
            closeDrawer();
            if (next) await selectSession(sessionId(next), true);
            else {
                renderSessions();
                renderConversation();
                renderUsage();
                updateHeader();
            }
        } catch (error) {
            state.deleteError = safeServerDetail(error && error.detail) || "Could not delete this chat. Try again.";
            state.deletePending = false;
            renderDeleteDialog();
        }
    }

    function renderWelcome() {
        clearNode(refs.conversation);
        const welcome = makeElement("div", "coach-welcome");
        const mark = makeElement("div", "coach-welcome-mark", "✦");
        mark.setAttribute("aria-hidden", "true");
        welcome.append(
            mark,
            makeElement("h3", "", "Training Coach"),
            makeElement("p", "", "Ask about your current training, recovery, recent workload, or what to do next."),
            makeElement("p", "coach-context-note", "Your Coach uses Training Intelligence data such as Weekly Audit, Load, recovery, recent activities, and athlete commentary."),
        );
        const prompts = makeElement("div", "coach-prompts");
        ["How am I doing this week?", "What should I do next?", "How does this week compare with last week?", "Should I ride hard tomorrow?"].forEach(prompt => {
            const button = makeElement("button", "coach-prompt-button", prompt);
            button.type = "button";
            button.disabled = state.responsePending || !state.selectedSessionId;
            button.addEventListener("click", () => {
                refs.input.value = prompt;
                resizeComposer();
                refs.input.focus();
            });
            prompts.appendChild(button);
        });
        welcome.appendChild(prompts);
        refs.conversation.appendChild(welcome);
    }

    function appendInline(parent, value) {
        let index = 0;
        while (index < value.length) {
            if (value.startsWith("**", index)) {
                const end = value.indexOf("**", index + 2);
                if (end > index + 2) {
                    const strong = document.createElement("strong");
                    appendInline(strong, value.slice(index + 2, end));
                    parent.appendChild(strong);
                    index = end + 2;
                    continue;
                }
            }
            if (value[index] === "*") {
                const end = value.indexOf("*", index + 1);
                if (end > index + 1) {
                    const emphasis = document.createElement("em");
                    appendInline(emphasis, value.slice(index + 1, end));
                    parent.appendChild(emphasis);
                    index = end + 1;
                    continue;
                }
            }
            if (value[index] === "`") {
                const end = value.indexOf("`", index + 1);
                if (end > index + 1) {
                    parent.appendChild(makeElement("code", "", value.slice(index + 1, end)));
                    index = end + 1;
                    continue;
                }
            }
            if (value[index] === "[") {
                const close = value.indexOf("](", index + 1);
                const end = close >= 0 ? value.indexOf(")", close + 2) : -1;
                const href = end > close ? value.slice(close + 2, end).trim() : "";
                if (close > index + 1 && end > close && /^https?:\/\//i.test(href)) {
                    const link = document.createElement("a");
                    link.href = href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer nofollow";
                    appendInline(link, value.slice(index + 1, close));
                    parent.appendChild(link);
                    index = end + 1;
                    continue;
                }
            }
            let next = index + 1;
            while (next < value.length && !["*", "`", "["].includes(value[next])) next += 1;
            parent.appendChild(document.createTextNode(value.slice(index, next)));
            index = next;
        }
    }

    function renderMarkdown(markdown) {
        const root = makeElement("div", "coach-markdown");
        const lines = text(markdown).replace(/\r\n?/g, "\n").split("\n");
        let paragraph = [];
        let list = null;
        let riskSection = null;

        const currentParent = () => riskSection || root;
        const flushParagraph = () => {
            if (!paragraph.length) return;
            const node = makeElement("p");
            paragraph.forEach((line, index) => {
                if (index) node.appendChild(document.createElement("br"));
                appendInline(node, line);
            });
            currentParent().appendChild(node);
            paragraph = [];
        };
        const closeList = () => { list = null; };
        const closeRisk = () => { riskSection = null; };

        lines.forEach(line => {
            const trimmed = line.trim();
            const headingMatch = /^(#{2,3})\s+(.+)$/.exec(trimmed);
            if (headingMatch) {
                flushParagraph();
                closeList();
                const level = headingMatch[1].length;
                const headingText = headingMatch[2].trim();
                if (headingText.toLowerCase() === "risk" && level === 2) {
                    closeRisk();
                    riskSection = makeElement("section", "coach-risk-section");
                    riskSection.setAttribute("aria-label", "Risk");
                    const label = makeElement("div", "coach-risk-label", "⚠ Risk");
                    label.setAttribute("role", "heading");
                    label.setAttribute("aria-level", "2");
                    riskSection.appendChild(label);
                    root.appendChild(riskSection);
                    return;
                }
                if (level <= 2) closeRisk();
                const heading = makeElement(level === 2 ? "h2" : "h3");
                appendInline(heading, headingText);
                currentParent().appendChild(heading);
                return;
            }
            if (!trimmed) {
                flushParagraph();
                closeList();
                return;
            }
            if (/^\s*([-*])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
                flushParagraph();
                const ordered = /^\s*\d+[.)]\s+/.test(line);
                if (!list || list.tagName.toLowerCase() !== (ordered ? "ol" : "ul")) {
                    list = document.createElement(ordered ? "ol" : "ul");
                    currentParent().appendChild(list);
                }
                const itemText = line.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, "");
                const item = makeElement("li");
                appendInline(item, itemText);
                list.appendChild(item);
                return;
            }
            if (/^\s*>\s?/.test(line)) {
                flushParagraph();
                closeList();
                const quote = makeElement("blockquote");
                appendInline(quote, line.replace(/^\s*>\s?/, ""));
                currentParent().appendChild(quote);
                return;
            }
            if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
                flushParagraph();
                closeList();
                currentParent().appendChild(document.createElement("hr"));
                return;
            }
            closeList();
            paragraph.push(line);
        });
        flushParagraph();
        return root;
    }

    function appendContextRow(list, name, value) {
        list.appendChild(makeElement("dt", "", name));
        list.appendChild(makeElement("dd", "", value));
    }

    function renderContextReceipt(receipt) {
        const root = makeElement("div", "coach-context-panel");
        const data = receipt?.receipt_json || {};
        root.appendChild(makeElement("h4", "", "Context used for this response"));
        const details = makeElement("dl", "");
        appendContextRow(details, "Scopes", Array.isArray(data.active_scopes) && data.active_scopes.length
            ? data.active_scopes.join(", ") : "None reported");
        appendContextRow(details, "Recent messages", Number.isInteger(data.recent_message_count)
            ? String(data.recent_message_count) : "Not reported");
        appendContextRow(details, "Custom Instructions", data.custom_instructions_included ? "Included" : "Not included");
        const coverage = data.context_coverage || {};
        appendContextRow(details, "Data through", coverage.data_through_date || "Not reported");
        appendContextRow(details, "Coverage", `${coverage.detailed_activity_days || 0} activity days, ${coverage.weekly_rows || 0} weekly rows, ${coverage.recovery_days || 0} recovery days`);
        appendContextRow(details, "Additional data", Array.isArray(data.additional_data_requested) && data.additional_data_requested.length
            ? data.additional_data_requested.join(", ") : "None");
        root.appendChild(details);
        const memories = Array.isArray(data.selected_memories) ? data.selected_memories : [];
        if (memories.length) {
            root.appendChild(makeElement("div", "", "Selected Durable Memories"));
            const list = makeElement("ul", "coach-context-memory-list");
            memories.forEach(memory => {
                const item = makeElement("li", "");
                item.appendChild(makeElement("strong", "", text(memory.title || "Untitled memory")));
                const reasons = Array.isArray(memory.selection_reasons) && memory.selection_reasons.length
                    ? ` - ${memory.selection_reasons.join(", ")}` : "";
                item.appendChild(document.createTextNode(` (${text(memory.memory_type || "memory")}, ${text(memory.priority || "normal")})${reasons}`));
                list.appendChild(item);
            });
            root.appendChild(list);
        }
        return root;
    }

    async function toggleContextReceipt(button, turn, item) {
        const existing = item.querySelector(".coach-context-panel");
        if (existing) {
            existing.remove();
            button.textContent = "Context";
            return;
        }
        button.disabled = true;
        button.textContent = "Loading...";
        try {
            const receipt = await window.api.fetchCoachContextReceipt(turn.coach_turn_id);
            item.appendChild(renderContextReceipt(receipt));
            button.textContent = "Hide context";
        } catch (error) {
            const panel = makeElement("div", "coach-context-panel", error.status === 404
                ? "Context receipt is not available for this response."
                : "Context receipt is currently unavailable.");
            item.appendChild(panel);
            button.textContent = "Context unavailable";
        } finally {
            button.disabled = false;
        }
    }

    function renderConversation() {
        if (state.conversationLoading) {
            clearNode(refs.conversation);
            refs.conversation.appendChild(makeElement("p", "coach-inline-status", "Loading conversation..."));
            return;
        }
        if (!state.session || !Array.isArray(state.session.messages) || !state.session.messages.length) {
            renderWelcome();
            return;
        }
        clearNode(refs.conversation);
        state.session.messages.forEach(message => {
            const role = message.role === "assistant" ? "assistant" : "user";
            const item = makeElement("article", `coach-message ${role}`);
            item.setAttribute("aria-label", role === "assistant" ? "Coach response" : "Your message");
            const bubble = makeElement("div", "coach-message-bubble");
            if (role === "assistant") bubble.appendChild(renderMarkdown(message.message_text));
            else bubble.textContent = text(message.message_text);
            item.appendChild(bubble);
            if (message.created_at) item.appendChild(makeElement("time", "coach-message-time", formatTime(message.created_at)));
            if (role === "assistant") {
                const actions = makeElement("div", "coach-message-actions");
                const copy = makeElement("button", "coach-copy-button", "Copy");
                copy.type = "button";
                copy.addEventListener("click", () => copyResponse(message.message_text, copy));
                actions.appendChild(copy);
                const turn = findTurnForMessage(message);
                if (turn && turn.status === "completed") {
                    const context = makeElement("button", "coach-context-button", "Context");
                    context.type = "button";
                    context.addEventListener("click", () => toggleContextReceipt(context, turn, item));
                    actions.appendChild(context);
                    actions.appendChild(makeElement("span", "", `${humanModel(turn.model)} • ${formatLatency(turn.elapsed_ms)} • ${formatTokens(turn.total_tokens)} tokens • ${formatCost(turn.estimated_cost_usd)}`));
                }
                item.appendChild(actions);
            }
            refs.conversation.appendChild(item);
        });
        if (state.responsePending) {
            if (state.pendingMessage) {
                const optimistic = makeElement("article", "coach-message user");
                optimistic.setAttribute("aria-label", "Your message");
                optimistic.appendChild(makeElement("div", "coach-message-bubble", state.pendingMessage));
                refs.conversation.appendChild(optimistic);
            }
            const pending = makeElement("article", "coach-message assistant");
            pending.appendChild(makeElement("div", "coach-message-bubble coach-pending", "Coach is reviewing your training context..."));
            refs.conversation.appendChild(pending);
        } else if (state.pendingMessage) {
            const optimistic = makeElement("article", "coach-message user");
            optimistic.setAttribute("aria-label", "Your message");
            optimistic.appendChild(makeElement("div", "coach-message-bubble", state.pendingMessage));
            refs.conversation.appendChild(optimistic);
        }
        refs.conversation.scrollTop = refs.conversation.scrollHeight;
    }

    function findTurnForMessage(message) {
        const id = message.coach_message_id;
        return (state.session && Array.isArray(state.session.turns) ? state.session.turns : []).find(turn => text(turn.assistant_message_id) === text(id)) || null;
    }

    async function reconcileFailedResponse(sessionIdValue, message, existingMessageIds, composerValueAtRequest) {
        if (sessionIdValue !== state.selectedSessionId) return false;
        try {
            const payload = await window.api.fetchCoachSession(sessionIdValue);
            if (sessionIdValue !== state.selectedSessionId) return false;
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            const persisted = hasNewPersistedUserMessage(messages, message, existingMessageIds);
            if (persisted) {
                state.session = payload;
                state.usage = payload.usage || state.usage;
                state.pendingMessage = "";
                return true;
            }
        } catch (error) {
            // The original message remains retryable when reconciliation is unavailable.
        }
        state.pendingMessage = "";
        if (refs.input.value === composerValueAtRequest) {
            refs.input.value = message;
            resizeComposer();
        }
        return false;
    }

    async function copyResponse(value, button) {
        const readable = text(value);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(readable);
            else {
                const area = document.createElement("textarea");
                area.value = readable;
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                area.remove();
            }
            const original = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = original; }, 1400);
        } catch (error) {
            button.textContent = "Copy unavailable";
            setTimeout(() => { button.textContent = "Copy"; }, 1400);
        }
    }

    function updateHeader() {
        const current = state.session && state.session.session;
        refs.title.textContent = current ? text(current.title, "Training Coach") : "Training Coach";
        refs.meta.textContent = current ? "A grounded conversation about your training" : "Grounded in your current Training Intelligence";
    }

    function resizeComposer() {
        refs.input.style.height = "auto";
        refs.input.style.height = `${Math.min(refs.input.scrollHeight, 150)}px`;
        const length = refs.input.value.length;
        refs.characterCount.textContent = length > MAX_MESSAGE_LENGTH - 300 ? `${length.toLocaleString()} / ${MAX_MESSAGE_LENGTH.toLocaleString()}` : "";
    }

    function setPending(value) {
        state.responsePending = value;
        refs.input.disabled = value;
        refs.send.disabled = value;
        refs.newChat.disabled = value || state.creating;
        renderSessions();
    }

    function startLoadingStages() {
        state.stageIndex = 0;
        refs.loading.textContent = STAGES[0];
        refs.loading.classList.remove("hidden");
        state.stageTimer = window.setInterval(() => {
            state.stageIndex = (state.stageIndex + 1) % STAGES.length;
            refs.loading.textContent = STAGES[state.stageIndex];
        }, 3200);
    }

    function stopLoadingStages() {
        if (state.stageTimer) window.clearInterval(state.stageTimer);
        state.stageTimer = null;
        refs.loading.classList.add("hidden");
    }

    async function loadSessions(preferredId = "") {
        state.sessionsError = "";
        state.sessionsLoading = true;
        renderSessions();
        try {
            const payload = await window.api.fetchCoachSessions();
            state.sessions = sortSessions(Array.isArray(payload) ? payload : (payload.sessions || []));
            const stored = preferredId || window.AppState.coachSessionId || "";
            const selected = state.sessions.find(session => sessionId(session) === text(stored)) || state.sessions[0];
            if (selected) await selectSession(sessionId(selected), true);
            else {
                state.selectedSessionId = "";
                state.session = null;
                state.usage = null;
                renderSessions();
                renderConversation();
                updateHeader();
            }
        } catch (error) {
            state.sessionsError = "Unable to load conversations. Try again.";
        } finally {
            state.sessionsLoading = false;
            renderSessions();
        }
    }

    async function selectSession(id, silent = false) {
        if (!validSessionId(id) || (state.responsePending && !silent) || (!silent && id === state.selectedSessionId)) return;
        const requestToken = ++state.loadToken;
        state.selectedSessionId = text(id);
        window.AppState.coachSessionId = state.selectedSessionId;
        window.persistPreferences();
        closeDrawer();
        state.conversationLoading = true;
        if (!silent) showError("");
        renderSessions();
        renderConversation();
        try {
            const [session, usage] = await Promise.all([
                window.api.fetchCoachSession(id),
                window.api.fetchCoachUsage(id),
            ]);
            if (requestToken !== state.loadToken || state.selectedSessionId !== text(id)) return;
            state.session = session;
            state.usage = usage;
            renderConversation();
            renderUsage();
            updateHeader();
        } catch (error) {
            if (requestToken !== state.loadToken) return;
            state.session = null;
            state.usage = null;
            showError("Could not load this conversation. Choose another session or try again.");
            renderConversation();
        } finally {
            if (requestToken === state.loadToken) {
                state.conversationLoading = false;
                renderConversation();
            }
        }
    }

    async function createSession() {
        if (state.creating || state.responsePending) return;
        state.creating = true;
        refs.newChat.disabled = true;
        showError("");
        try {
            const payload = await window.api.createCoachSession();
            const created = payload.session;
            state.sessions = sortSessions([created, ...state.sessions.filter(session => sessionId(session) !== sessionId(created))]);
            await selectSession(sessionId(created), true);
            refs.input.focus();
        } catch (error) {
            showError("Could not create a new coaching session.");
        } finally {
            state.creating = false;
            refs.newChat.disabled = state.responsePending;
            renderSessions();
        }
    }

    async function submitMessage(event) {
        event.preventDefault();
        const message = refs.input.value.trim();
        if (!message || message.length > MAX_MESSAGE_LENGTH || state.responsePending || !state.selectedSessionId) return;
        refs.input.value = "";
        state.pendingMessage = message;
        resizeComposer();
        showError("");
        setPending(true);
        startLoadingStages();
        renderConversation();
        const activeId = state.selectedSessionId;
        const existingMessageIds = new Set(
            (state.session && Array.isArray(state.session.messages) ? state.session.messages : [])
                .map(item => String(item.coach_message_id))
        );
        const composerValueAtRequest = refs.input.value;
        try {
            const response = await window.api.respondToCoach(activeId, message);
            if (activeId !== state.selectedSessionId) return;
            state.usage = response.usage || state.usage;
            state.pendingMessage = "";
            await selectSession(activeId, true);
            const refreshedSession = state.session && state.session.session;
            state.sessions = state.sessions.map(session => sessionId(session) === activeId
                ? {
                    ...session,
                    ...(refreshedSession || {}),
                    last_activity_at: new Date().toISOString(),
                }
                : session);
            state.sessions = sortSessions(state.sessions);
            renderSessions();
        } catch (error) {
            if (activeId === state.selectedSessionId) {
                showError(mapError(error));
                await reconcileFailedResponse(activeId, message, existingMessageIds, composerValueAtRequest);
            } else if (state.pendingMessage === message) {
                state.pendingMessage = "";
            }
        } finally {
            stopLoadingStages();
            setPending(false);
            renderConversation();
            renderUsage();
            updateHeader();
            refs.input.focus();
        }
    }

    function openDrawer() {
        state.previousFocus = document.activeElement;
        state.drawerOpen = true;
        refs.sessionRail.classList.add("is-open");
        refs.drawerBackdrop.classList.remove("hidden");
        refs.drawerOpen.setAttribute("aria-expanded", "true");
        refs.drawerClose.focus();
    }

    function closeDrawer() {
        if (!state.drawerOpen) return;
        state.drawerOpen = false;
        refs.sessionRail.classList.remove("is-open");
        refs.drawerBackdrop.classList.add("hidden");
        refs.drawerOpen.setAttribute("aria-expanded", "false");
        if (state.previousFocus && typeof state.previousFocus.focus === "function") state.previousFocus.focus();
    }

    function activate() {
        if (state.initialized) return;
        state.initialized = true;
        loadSessions();
    }

    refs.newChat.addEventListener("click", createSession);
    refs.composer.addEventListener("submit", submitMessage);
    refs.input.addEventListener("input", resizeComposer);
    refs.input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            refs.composer.requestSubmit();
        }
    });
    refs.usageToggle.addEventListener("click", () => {
        const expanded = refs.usageToggle.getAttribute("aria-expanded") === "true";
        refs.usageToggle.setAttribute("aria-expanded", String(!expanded));
        refs.usagePanel.classList.toggle("hidden", expanded);
    });
    refs.drawerOpen.addEventListener("click", openDrawer);
    refs.drawerClose.addEventListener("click", closeDrawer);
    refs.drawerBackdrop.addEventListener("click", closeDrawer);
    refs.deleteCancel.addEventListener("click", () => closeDeleteDialog(true));
    refs.deleteConfirm.addEventListener("click", confirmDelete);
    refs.deleteDialog.addEventListener("click", event => {
        if (event.target.dataset.coachDeleteCancel === "true" && !state.deletePending) closeDeleteDialog(true);
    });
    refs.deleteDialog.addEventListener("keydown", event => {
        if (event.key !== "Tab" || state.deletePending) return;
        const focusable = [refs.deleteCancel, refs.deleteConfirm].filter(button => !button.disabled);
        if (!focusable.length) return;
        const current = focusable.indexOf(document.activeElement);
        const next = event.shiftKey
            ? (current <= 0 ? focusable.length - 1 : current - 1)
            : (current === focusable.length - 1 ? 0 : current + 1);
        event.preventDefault();
        focusable[next].focus();
    });
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        if (state.deleteSessionId) {
            if (!state.deletePending) closeDeleteDialog(true);
            return;
        }
        if (state.sessionMenuId) {
            const id = state.sessionMenuId;
            state.sessionMenuId = "";
            renderSessions();
            focusSessionActions(id);
            return;
        }
        if (state.drawerOpen) closeDrawer();
    });
    document.addEventListener("click", event => {
        if (state.sessionMenuId && !event.target.closest(".coach-session-actions")) {
            state.sessionMenuId = "";
            renderSessions();
        }
    });

    window.addEventListener("beforeunload", stopLoadingStages);
    window.CoachController = { activate, renderMarkdown };
})();
