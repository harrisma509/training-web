(function () {
    let weightChart = null;
    let fitnessFatigueChart = null;
    let fitnessFatigueRequestId = 0;
    let fitnessFatigueTrendRequestId = 0;
    let fitnessFatigueLoaded = false;
    let fitnessFatigueTrendPayload = null;
    const fitnessFatigueTrendCache = new Map();
    const WEIGHT_YEAR_KEY = "trainingWeightChartYear";
    const WEIGHT_MODE_KEY = "trainingWeightChartMode";
    const FITNESS_FATIGUE_RANGE_KEY = "trainingFitnessFatigueChartRange";
    const FITNESS_FATIGUE_LEGEND_KEY = "trainingFitnessFatigueLegendState";
    const FITNESS_FATIGUE_RANGES = ["3m", "6m", "1y", "2025"];

    function getElements() {
        return {
            canvas: document.getElementById("weightChartCanvas"),
            canvasWrap: document.getElementById("weightChartCanvasWrap"),
            status: document.getElementById("weightChartStatus"),
            meta: document.getElementById("weightChartMeta"),
            latest: document.getElementById("weightChartLatest"),
            legend: document.getElementById("weightChartLegend"),
            yearSelect: document.getElementById("weightChartYearSelect"),
            monthlyControls: document.getElementById("weightChartMonthlyControls"),
            monthlyModeButton: document.getElementById("weightChartMonthlyMode"),
            annualModeButton: document.getElementById("weightChartAnnualMode"),
            fitnessFatigueStatus: document.getElementById("fitnessFatigueStatus"),
            fitnessFatigueContent: document.getElementById("fitnessFatigueContent"),
            fitnessFatigueFitness: document.getElementById("fitnessFatigueFitness"),
            fitnessFatigueFatigue: document.getElementById("fitnessFatigueFatigue"),
            fitnessFatigueForm: document.getElementById("fitnessFatigueForm"),
            fitnessFatigueChange7: document.getElementById("fitnessFatigueChange7"),
            fitnessFatigueChange28: document.getElementById("fitnessFatigueChange28"),
            fitnessFatigueChange90: document.getElementById("fitnessFatigueChange90"),
            fitnessFatigueDirection7: document.getElementById("fitnessFatigueDirection7"),
            fitnessFatigueDirection28: document.getElementById("fitnessFatigueDirection28"),
            fitnessFatigueDirection90: document.getElementById("fitnessFatigueDirection90"),
            fitnessFatigueChartCanvas: document.getElementById("fitnessFatigueChartCanvas"),
            fitnessFatigueChartCanvasWrap: document.getElementById("fitnessFatigueChartCanvasWrap"),
            fitnessFatigueChartStatus: document.getElementById("fitnessFatigueChartStatus"),
            fitnessFatigueChartLegend: document.getElementById("fitnessFatigueChartLegend"),
            fitnessFatigueRangeButtons: document.querySelectorAll("[data-fitness-fatigue-range]"),
        };
    }

    function formatWholeValue(value, signed = false) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return "Not available";
        }
        const rounded = Math.round(numeric);
        return signed && rounded > 0 ? `+${rounded}` : String(rounded);
    }

    function setFitnessFatigueDirection(element, value) {
        element.classList.remove("is-up", "is-down", "is-flat");
        element.textContent = "";
        if (!Number.isFinite(value)) {
            return;
        }
        if (value > 0) {
            element.textContent = "▲";
            element.classList.add("is-up");
        } else if (value < 0) {
            element.textContent = "▼";
            element.classList.add("is-down");
        } else {
            element.textContent = "━";
            element.classList.add("is-flat");
        }
    }

    function setFitnessFatigueStatus(message, state = "") {
        const { fitnessFatigueStatus, fitnessFatigueContent } = getElements();
        fitnessFatigueContent.classList.add("hidden");
        fitnessFatigueStatus.textContent = message;
        fitnessFatigueStatus.className = `fitness-fatigue-status ${state}`.trim();
        fitnessFatigueStatus.classList.remove("hidden");
    }

    function renderFitnessFatigueSummary(payload) {
        const { fitnessFatigueStatus, fitnessFatigueContent,
            fitnessFatigueFitness, fitnessFatigueFatigue, fitnessFatigueForm,
            fitnessFatigueChange7, fitnessFatigueChange28, fitnessFatigueChange90,
            fitnessFatigueDirection7, fitnessFatigueDirection28, fitnessFatigueDirection90 } = getElements();

        if (!payload || !payload.current || !payload.model || !payload.coverage) {
            setFitnessFatigueStatus("Fitness and freshness data are not available yet.", "is-empty");
            return;
        }

        const current = payload.current;
        const change = payload.fitness_change || {};
        fitnessFatigueFitness.textContent = formatWholeValue(current.fitness);
        fitnessFatigueFitness.title = `Fitness ${current.fitness}`;
        fitnessFatigueFatigue.textContent = formatWholeValue(current.fatigue);
        fitnessFatigueFatigue.title = `Fatigue ${current.fatigue}`;
        fitnessFatigueForm.textContent = formatWholeValue(current.form, true);
        fitnessFatigueForm.title = `Form ${current.form}`;
        fitnessFatigueChange7.textContent = formatWholeValue(change.days_7, true);
        fitnessFatigueChange28.textContent = formatWholeValue(change.days_28, true);
        fitnessFatigueChange90.textContent = formatWholeValue(change.days_90, true);
        setFitnessFatigueDirection(fitnessFatigueDirection7, change.days_7);
        setFitnessFatigueDirection(fitnessFatigueDirection28, change.days_28);
        setFitnessFatigueDirection(fitnessFatigueDirection90, change.days_90);
        fitnessFatigueChange7.title = change.days_7 === null ? "7-day Fitness change not available" : `7-day Fitness change ${change.days_7}`;
        fitnessFatigueChange28.title = change.days_28 === null ? "28-day Fitness change not available" : `28-day Fitness change ${change.days_28}`;
        fitnessFatigueChange90.title = change.days_90 === null ? "90-day Fitness change not available" : `90-day Fitness change ${change.days_90}`;
        fitnessFatigueStatus.classList.add("hidden");
        fitnessFatigueContent.classList.remove("hidden");
    }

    async function loadFitnessFatigue() {
        if (!fitnessFatigueLoaded) {
            const requestId = ++fitnessFatigueRequestId;
            setFitnessFatigueStatus("Loading fitness and freshness...", "is-loading");
            try {
                const payload = await window.api.getFitnessFatigueSummary();
                if (requestId !== fitnessFatigueRequestId) {
                    return;
                }
                renderFitnessFatigueSummary(payload);
                fitnessFatigueLoaded = true;
            } catch (error) {
                if (requestId !== fitnessFatigueRequestId) {
                    return;
                }
                setFitnessFatigueStatus("Fitness and freshness are currently unavailable.", "is-error");
            }
        }
        loadFitnessFatigueTrend();
    }

    function getFitnessFatigueRange() {
        const savedRange = sessionStorage.getItem(FITNESS_FATIGUE_RANGE_KEY);
        return FITNESS_FATIGUE_RANGES.includes(savedRange) ? savedRange : "6m";
    }

    function setFitnessFatigueRange(range) {
        const selectedRange = FITNESS_FATIGUE_RANGES.includes(range) ? range : "6m";
        const { fitnessFatigueRangeButtons } = getElements();
        sessionStorage.setItem(FITNESS_FATIGUE_RANGE_KEY, selectedRange);
        fitnessFatigueRangeButtons.forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.fitnessFatigueRange === selectedRange));
        });
        return selectedRange;
    }

    function destroyFitnessFatigueChart() {
        const { fitnessFatigueChartCanvas } = getElements();
        const activeChart = window.Chart?.getChart(fitnessFatigueChartCanvas);
        if (activeChart) {
            activeChart.destroy();
        }
        fitnessFatigueChart = null;
    }

    function setFitnessFatigueTrendStatus(message, state = "") {
        const { fitnessFatigueChartCanvasWrap, fitnessFatigueChartStatus, fitnessFatigueChartLegend } = getElements();
        destroyFitnessFatigueChart();
        fitnessFatigueChartStatus.textContent = message;
        fitnessFatigueChartStatus.className = `fitness-fatigue-chart-status ${state}`.trim();
        fitnessFatigueChartStatus.classList.remove("hidden");
        fitnessFatigueChartCanvasWrap.classList.add("hidden");
        if (fitnessFatigueChartLegend) {
            fitnessFatigueChartLegend.innerHTML = "";
        }
    }

    function getFitnessFatigueLegendState() {
        try {
            return JSON.parse(sessionStorage.getItem(FITNESS_FATIGUE_LEGEND_KEY) || "{}");
        } catch (error) {
            return {};
        }
    }

    function applyFitnessFatigueLegendState(chart) {
        const state = getFitnessFatigueLegendState();
        chart.data.datasets.forEach((dataset, index) => {
            if (Object.prototype.hasOwnProperty.call(state, dataset.label)) {
                chart.getDatasetMeta(index).hidden = Boolean(state[dataset.label]);
            }
        });
    }

    function updateFitnessFatigueLegend(chart) {
        const { fitnessFatigueChartLegend } = getElements();
        if (!chart || !fitnessFatigueChartLegend) {
            return;
        }
        fitnessFatigueChartLegend.innerHTML = "";
        chart.data.datasets.forEach((dataset, index) => {
            const hidden = Boolean(chart.getDatasetMeta(index).hidden);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "fitness-fatigue-chart-legend-item";
            button.setAttribute("aria-label", `Toggle ${dataset.label}`);
            button.setAttribute("aria-pressed", String(!hidden));
            button.title = dataset.label;
            if (hidden) {
                button.classList.add("is-hidden");
            }
            const swatch = document.createElement("span");
            swatch.className = "fitness-fatigue-chart-legend-swatch";
            swatch.style.color = dataset.legendColor;
            const label = document.createElement("span");
            label.textContent = dataset.label;
            button.append(swatch, label);
            button.addEventListener("click", () => {
                const meta = chart.getDatasetMeta(index);
                meta.hidden = !meta.hidden;
                const state = {};
                chart.data.datasets.forEach((item, itemIndex) => {
                    state[item.label] = Boolean(chart.getDatasetMeta(itemIndex).hidden);
                });
                sessionStorage.setItem(FITNESS_FATIGUE_LEGEND_KEY, JSON.stringify(state));
                chart.update();
                updateFitnessFatigueLegend(chart);
            });
            fitnessFatigueChartLegend.appendChild(button);
        });
    }

    function formatTrendDate(value) {
        const parsed = new Date(`${value}T12:00:00`);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric",
        });
    }

    function renderFitnessFatigueTrend(payload) {
        const { fitnessFatigueChartCanvas, fitnessFatigueChartCanvasWrap, fitnessFatigueChartStatus } = getElements();
        if (!window.Chart) {
            setFitnessFatigueTrendStatus("Fitness, Fatigue, and Form trend is currently unavailable.", "is-error");
            return;
        }
        const series = Array.isArray(payload?.series) ? payload.series.filter(row => (
            typeof row?.date === "string" && Number.isFinite(Number(row.fitness)) &&
            Number.isFinite(Number(row.fatigue)) && Number.isFinite(Number(row.form))
        )) : [];
        if (!series.length) {
            setFitnessFatigueTrendStatus("No Fitness, Fatigue, and Form history is available for this period.", "is-empty");
            return;
        }

        destroyFitnessFatigueChart();
        const colors = getThemeColors();
        const labels = series.map(row => row.date);
        const chartMeta = payload.chart || {};
        const monthStarts = new Set(labels.filter(value => value.slice(-2) === "01"));
        const zeroReference = {
            id: "fitnessFatigueZeroReference",
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const zeroY = scales.model.getPixelForValue(0);
                if (zeroY < chartArea.top || zeroY > chartArea.bottom) {
                    return;
                }
                ctx.save();
                ctx.strokeStyle = colors.muted;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, zeroY);
                ctx.lineTo(chartArea.right, zeroY);
                ctx.stroke();
                ctx.restore();
            },
        };
        const warmupShade = {
            id: "fitnessFatigueWarmupShade",
            beforeDatasetsDraw(chart) {
                if (!chartMeta.is_warmup_visible) {
                    return;
                }
                const firstIndex = labels.findIndex(value => value >= chartMeta.warmup_first_date);
                const lastIndex = labels.findLastIndex(value => value <= chartMeta.warmup_last_date);
                if (firstIndex < 0 || lastIndex < firstIndex) {
                    return;
                }
                const { ctx, chartArea, scales } = chart;
                const firstX = Math.max(chartArea.left, scales.x.getPixelForValue(firstIndex) - 4);
                const lastX = Math.min(chartArea.right, scales.x.getPixelForValue(lastIndex) + 4);
                ctx.save();
                ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
                ctx.fillRect(firstX, chartArea.top, lastX - firstX, chartArea.bottom - chartArea.top);
                ctx.fillStyle = colors.muted;
                ctx.font = "11px sans-serif";
                ctx.fillText("Model warm-up", firstX + 5, chartArea.top + 14);
                ctx.restore();
            },
        };

        fitnessFatigueChartStatus.classList.add("hidden");
        fitnessFatigueChartCanvasWrap.classList.remove("hidden");
        fitnessFatigueChart = new window.Chart(fitnessFatigueChartCanvas, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    { label: "Daily Load", data: series.map(row => Number(row.daily_load) || 0), yAxisID: "load", backgroundColor: "rgba(148, 163, 184, 0.32)", borderWidth: 0, legendColor: "#94a3b8", order: 4 },
                    { label: "Fitness", type: "line", data: series.map(row => Number(row.fitness)), yAxisID: "model", borderColor: colors.blue, backgroundColor: colors.blue, borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, legendColor: colors.blue, order: 1 },
                    { label: "Fatigue", type: "line", data: series.map(row => Number(row.fatigue)), yAxisID: "model", borderColor: "#f59e0b", backgroundColor: "#f59e0b", borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.22, legendColor: "#f59e0b", order: 2 },
                    { label: "Form", type: "line", data: series.map(row => Number(row.form)), yAxisID: "model", borderColor: "#2dd4bf", backgroundColor: "#2dd4bf", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.18, legendColor: "#2dd4bf", order: 3 },
                ],
            },
            plugins: [warmupShade, zeroReference],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title(items) { return formatTrendDate(labels[items[0].dataIndex]); },
                            label(context) {
                                const value = Number(context.parsed.y);
                                return context.dataset.label === "Daily Load"
                                    ? `Daily Load: ${Math.round(value)}`
                                    : `${context.dataset.label}: ${value.toFixed(2)}`;
                            },
                            afterBody() { return "Form is start-of-day; Fitness and Fatigue include that day’s load."; },
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            color: colors.muted, maxRotation: 0, autoSkip: false, callback(value) {
                                const label = this.getLabelForValue(value);
                                if (typeof label !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(label)) {
                                    return "";
                                }
                                if (payload.range === "3m") {
                                    return Number(value) % 14 === 0
                                        ? new Date(`${label}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
                                }
                                return Number(value) === 0 || label.slice(-2) === "01"
                                    ? new Date(`${label}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: Number(value) === 0 ? "numeric" : undefined }) : "";
                            }
                        },
                        grid: { color(context) { const label = context.tick ? context.scale.getLabelForValue(context.tick.value) : ""; return monthStarts.has(label) ? colors.line : "rgba(0, 0, 0, 0)"; }, drawBorder: false, drawTicks: false },
                    },
                    model: { position: "left", title: { display: true, text: "Fitness / Fatigue / Form", color: colors.text }, ticks: { color: colors.muted, precision: 0 }, grid: { color: colors.line } },
                    load: { position: "right", beginAtZero: true, title: { display: true, text: "Daily Load", color: colors.text }, ticks: { color: colors.muted, precision: 0 }, grid: { drawOnChartArea: false, drawBorder: false } },
                },
            },
        });
        applyFitnessFatigueLegendState(fitnessFatigueChart);
        fitnessFatigueChart.update();
        updateFitnessFatigueLegend(fitnessFatigueChart);
    }

    async function loadFitnessFatigueTrend(force = false) {
        const selectedRange = getFitnessFatigueRange();
        if (!force && fitnessFatigueTrendCache.has(selectedRange)) {
            fitnessFatigueTrendPayload = fitnessFatigueTrendCache.get(selectedRange);
            renderFitnessFatigueTrend(fitnessFatigueTrendPayload);
            return;
        }
        const requestId = ++fitnessFatigueTrendRequestId;
        setFitnessFatigueTrendStatus("Loading Fitness, Fatigue & Form trend...", "is-loading");
        try {
            const payload = await window.api.getFitnessFatigueTrend(selectedRange);
            if (requestId !== fitnessFatigueTrendRequestId || getFitnessFatigueRange() !== selectedRange) {
                return;
            }
            fitnessFatigueTrendCache.set(selectedRange, payload);
            fitnessFatigueTrendPayload = payload;
            renderFitnessFatigueTrend(payload);
        } catch (error) {
            if (requestId === fitnessFatigueTrendRequestId) {
                setFitnessFatigueTrendStatus("Fitness, Fatigue, and Form trend is currently unavailable.", "is-error");
            }
        }
    }

    function destroyWeightChart() {
        if (weightChart) {
            weightChart.destroy();
            weightChart = null;
        }
    }

    function setStatus(message, state = "") {
        const { canvasWrap, status } = getElements();
        destroyWeightChart();
        status.textContent = message;
        status.className = `weight-chart-status ${state}`.trim();
        status.classList.remove("hidden");
        canvasWrap.classList.add("hidden");
    }

    function formatWeight(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? `${numeric.toFixed(1)} lb` : "n/a";
    }

    function formatTarget(target) {
        const low = Number(target.low_lb);
        const high = Number(target.high_lb);
        return `Target ${low.toFixed(0)}–${high.toFixed(0)} lb`;
    }

    function formatLatestDate(value) {
        const parsed = new Date(`${value}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function formatMonth(value) {
        const parsed = new Date(`${value}-01T12:00:00`);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }

    function getCalendarDatesForMonths(monthly) {
        const monthKeys = monthly
            .map(row => row.month)
            .filter(month => typeof month === "string" && /^\d{4}-\d{2}$/.test(month))
            .sort();
        if (!monthKeys.length) {
            return [];
        }

        const [firstYear, firstMonth] = monthKeys[0].split("-").map(Number);
        const [lastYear, lastMonth] = monthKeys[monthKeys.length - 1].split("-").map(Number);
        const current = new Date(firstYear, firstMonth - 1, 1);
        const end = new Date(lastYear, lastMonth, 0);
        const dates = [];

        while (current <= end) {
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, "0");
            const day = String(current.getDate()).padStart(2, "0");
            dates.push(`${year}-${month}-${day}`);
            current.setDate(current.getDate() + 1);
        }

        return dates;
    }

    function getThemeColors() {
        const styles = getComputedStyle(document.documentElement);
        return {
            text: styles.getPropertyValue("--text").trim(),
            muted: styles.getPropertyValue("--muted").trim(),
            line: styles.getPropertyValue("--line").trim(),
            blue: styles.getPropertyValue("--blue").trim(),
        };
    }

    function isValidPayload(payload) {
        return payload && typeof payload === "object" && payload.target &&
            Number.isFinite(Number(payload.target.low_lb)) && Number.isFinite(Number(payload.target.high_lb)) &&
            Array.isArray(payload.daily) && Array.isArray(payload.monthly);
    }

    function isValidAnnualPayload(payload) {
        return payload && typeof payload === "object" && payload.target &&
            Number.isFinite(Number(payload.target.low_lb)) && Number.isFinite(Number(payload.target.high_lb)) &&
            Array.isArray(payload.annual);
    }

    function getWeightChartMode() {
        return sessionStorage.getItem(WEIGHT_MODE_KEY) === "annual" ? "annual" : "monthly";
    }

    function setWeightChartMode(mode) {
        const resolvedMode = mode === "annual" ? "annual" : "monthly";
        const { annualModeButton, monthlyControls, monthlyModeButton } = getElements();
        sessionStorage.setItem(WEIGHT_MODE_KEY, resolvedMode);
        if (monthlyControls) {
            monthlyControls.classList.toggle("hidden", resolvedMode === "annual");
        }
        if (monthlyModeButton) {
            monthlyModeButton.setAttribute("aria-pressed", String(resolvedMode === "monthly"));
        }
        if (annualModeButton) {
            annualModeButton.setAttribute("aria-pressed", String(resolvedMode === "annual"));
        }
    }

    function getLegendVisibilityState() {
        try {
            return JSON.parse(sessionStorage.getItem("trainingWeightChartLegendState") || "{}");
        } catch (error) {
            return {};
        }
    }

    function setLegendVisibilityState(chart) {
        const state = {};
        chart.data.datasets.forEach((dataset, index) => {
            state[dataset.label] = Boolean(chart.getDatasetMeta(index).hidden);
        });
        sessionStorage.setItem("trainingWeightChartLegendState", JSON.stringify(state));
    }

    function applyLegendVisibilityState(chart) {
        const state = getLegendVisibilityState();
        if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) {
            return;
        }

        chart.data.datasets.forEach((dataset, index) => {
            const meta = chart.getDatasetMeta(index);
            if (Object.prototype.hasOwnProperty.call(state, dataset.label)) {
                meta.hidden = Boolean(state[dataset.label]);
            }
        });
    }

    function updateWeightLegend(chart) {
        const { legend } = getElements();
        if (!legend || !chart) {
            return;
        }

        legend.innerHTML = "";
        chart.data.datasets.forEach((dataset, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "weight-chart-legend-item";
            button.setAttribute("aria-label", `Toggle ${dataset.label}`);
            button.setAttribute("aria-pressed", String(!chart.getDatasetMeta(index).hidden));
            button.title = dataset.label;

            const swatch = document.createElement("span");
            swatch.className = "weight-chart-legend-swatch";
            swatch.style.backgroundColor = dataset.borderColor || dataset.pointBackgroundColor || "currentColor";
            swatch.style.borderColor = dataset.borderColor || dataset.pointBackgroundColor || "currentColor";
            swatch.style.boxShadow = dataset.showLine === false ? "none" : "0 0 0 2px rgba(255,255,255,0.08)";

            const label = document.createElement("span");
            label.textContent = dataset.label;

            if (chart.getDatasetMeta(index).hidden) {
                button.classList.add("is-hidden");
            }

            button.appendChild(swatch);
            button.appendChild(label);
            button.addEventListener("click", () => {
                const meta = chart.getDatasetMeta(index);
                meta.hidden = !meta.hidden;
                setLegendVisibilityState(chart);
                chart.update();
                updateWeightLegend(chart);
            });
            legend.appendChild(button);
        });
    }

    function populateYearSelector(availableYears, selectedYear) {
        const { yearSelect } = getElements();
        if (!yearSelect) {
            return;
        }

        const normalizedYears = [...new Set((availableYears || []).filter(Number.isFinite))].sort((a, b) => b - a);
        const fallbackYear = normalizedYears.length ? normalizedYears[0] : Number.isFinite(selectedYear) ? selectedYear : new Date().getFullYear();
        const resolvedYear = normalizedYears.includes(Number(selectedYear)) ? Number(selectedYear) : fallbackYear;

        yearSelect.innerHTML = "";
        normalizedYears.forEach((year) => {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = String(year);
            if (year === resolvedYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        });

        if (!normalizedYears.length) {
            yearSelect.disabled = true;
            yearSelect.setAttribute("aria-label", "No weight chart years available");
            return;
        }

        yearSelect.disabled = false;
        yearSelect.setAttribute("aria-label", "Weight chart year");
        yearSelect.value = String(resolvedYear);
    }

    function renderWeightChart(payload) {
        const { canvas, canvasWrap, status, meta, latest, legend, yearSelect } = getElements();
        if (!window.Chart) {
            setStatus("Weight chart is unavailable because its local chart library did not load.", "is-error");
            return;
        }

        const daily = payload.daily.filter(row => typeof row?.date === "string" && Number.isFinite(Number(row.weight_lb)));
        const monthly = payload.monthly.filter(row => typeof row?.month === "string" && Number.isFinite(Number(row.average_lb)));
        const availableYears = Array.isArray(payload.available_years) ? payload.available_years.map(Number).filter(Number.isFinite).sort((a, b) => b - a) : [];
        const activeYear = Number.isInteger(payload.year) ? Number(payload.year) : new Date().getFullYear();
        const selectedYear = Number.isFinite(activeYear) ? activeYear : new Date().getFullYear();
        const resolvedYears = availableYears.length ? availableYears : [selectedYear];
        populateYearSelector(resolvedYears, selectedYear);
        meta.textContent = formatTarget(payload.target);

        if (!daily.length || !monthly.length) {
            latest.textContent = "";
            setStatus("No weight data available for this year", "is-empty");
            return;
        }

        destroyWeightChart();
        const colors = getThemeColors();
        const target = payload.target;
        const latestPoint = payload.latest && Number.isFinite(Number(payload.latest.weight_lb)) ? payload.latest : null;

        const endpointByMonth = new Map();
        daily.forEach(row => {
            const monthKey = row.date.slice(0, 7);
            endpointByMonth.set(monthKey, row.date);
        });

        const monthlyAverageRows = monthly.map(row => {
            const monthKey = row.month;
            return {
                ...row,
                endpointDate: endpointByMonth.get(monthKey) || row.month_start || row.month,
            };
        });

        const firstRepresentedMonth = monthly.map(row => row.month).sort()[0];
        const januaryMonth = `${selectedYear}-01`;
        const previousDecember = payload.previous_december;
        const hasPreviousDecember = previousDecember && previousDecember.month === `${selectedYear - 1}-12` &&
            Number.isFinite(Number(previousDecember.average_lb)) && Number.isFinite(Number(previousDecember.minimum_lb)) &&
            Number.isFinite(Number(previousDecember.maximum_lb)) && Number.isFinite(Number(previousDecember.measurement_count));
        const shouldShowCarryIn = firstRepresentedMonth === januaryMonth && monthly.some(row => row.month === januaryMonth) && hasPreviousDecember;
        const carryInCategory = shouldShowCarryIn ? `carry-in-${previousDecember.month}` : null;
        const monthlyAverageData = monthlyAverageRows.map(row => ({ x: row.endpointDate, y: Number(row.average_lb), details: row }));
        if (shouldShowCarryIn) {
            monthlyAverageData.unshift({
                x: carryInCategory,
                y: Number(previousDecember.average_lb),
                details: previousDecember,
                is_carry_in: true,
            });
        }

        const monthStartSet = new Set(monthly.map(row => (
            typeof row.month_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.month_start)
                ? row.month_start
                : `${row.month}-01`
        )));

        const labels = shouldShowCarryIn ? [carryInCategory, ...getCalendarDatesForMonths(monthly)] : getCalendarDatesForMonths(monthly);

        const weights = daily.map(row => Number(row.weight_lb)).concat(monthlyAverageRows.map(row => Number(row.average_lb)), shouldShowCarryIn ? Number(previousDecember.average_lb) : [], Number(target.low_lb), Number(target.high_lb));
        const minimum = Math.min(...weights);
        const maximum = Math.max(...weights);
        const padding = Math.max(2, Math.ceil((maximum - minimum) * 0.15));

        latest.textContent = latestPoint ? `Latest ${formatWeight(latestPoint.weight_lb)} · ${formatLatestDate(latestPoint.date)}` : "";
        latest.title = latestPoint ? `${formatWeight(latestPoint.weight_lb)} on ${latestPoint.date}` : "";
        status.classList.add("hidden");
        canvasWrap.classList.remove("hidden");
        if (legend) {
            legend.innerHTML = "";
        }
        if (yearSelect) {
            yearSelect.value = String(selectedYear);
            sessionStorage.setItem(WEIGHT_YEAR_KEY, String(selectedYear));
        }

        const targetBand = {
            id: "weightTargetBand",
            beforeDatasetsDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const upper = scales.y.getPixelForValue(target.high_lb);
                const lower = scales.y.getPixelForValue(target.low_lb);
                ctx.save();
                ctx.fillStyle = "rgba(34, 197, 94, 0.16)";
                ctx.fillRect(chartArea.left, upper, chartArea.right - chartArea.left, lower - upper);
                ctx.restore();
            },
        };

        const monthLabelFromDate = (value) => {
            if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return "";
            }
            const parsed = new Date(`${value}T12:00:00`);
            return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString(undefined, { month: "short" });
        };

        const monthLabelByDate = new Map(monthly.map(row => {
            const midpointDate = `${row.month}-15`;
            return [midpointDate, monthLabelFromDate(midpointDate)];
        }));

        weightChart = new window.Chart(canvas, {
            type: "scatter",
            data: {
                labels,
                datasets: [
                    {
                        label: "Measurements",
                        data: daily.map(row => ({ x: row.date, y: Number(row.weight_lb) })),
                        pointRadius: 2.5,
                        pointHoverRadius: 4,
                        pointBackgroundColor: "rgba(148, 163, 184, 0.55)",
                        pointBorderWidth: 0,
                        showLine: false,
                        order: 2,
                    },
                    {
                        label: "Monthly average",
                        data: monthlyAverageData,
                        borderColor: colors.blue,
                        backgroundColor: colors.blue,
                        borderWidth: 3,
                        pointRadius: context => context.raw.is_carry_in ? 3 : 4,
                        pointHoverRadius: context => context.raw.is_carry_in ? 4 : 5,
                        pointBorderColor: colors.blue,
                        pointBackgroundColor: context => context.raw.is_carry_in ? "rgba(59, 130, 246, 0.55)" : colors.text,
                        showLine: true,
                        tension: 0.25,
                        order: 1,
                    },
                ],
            },
            plugins: [targetBand],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                const item = items[0];
                                if (item.dataset.label === "Monthly average" && item.raw.is_carry_in) {
                                    return `December ${item.raw.details.year} carry-in`;
                                }
                                return item.dataset.label === "Monthly average" ? formatMonth(item.raw.details.month) : item.raw.x;
                            },
                            label(context) {
                                if (context.dataset.label === "Measurements") {
                                    const latestLabel = latestPoint && context.raw.x === latestPoint.date ? " (latest)" : "";
                                    return `Daily weight: ${formatWeight(context.raw.y)}${latestLabel}`;
                                }
                                const details = context.raw.details;
                                if (context.raw.is_carry_in) {
                                    return [
                                        `Monthly average: ${formatWeight(context.raw.y)}`,
                                        `Range: ${formatWeight(details.minimum_lb)}-${formatWeight(details.maximum_lb)}`,
                                        `Measurements: ${details.measurement_count}`,
                                    ];
                                }
                                return [
                                    `Monthly average: ${formatWeight(context.raw.y)}`,
                                    `Range: ${formatWeight(details.minimum_lb)}-${formatWeight(details.maximum_lb)}`,
                                    `Measurements: ${details.measurement_count}`,
                                    details.is_partial ? "Partial month" : "Complete month",
                                ];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: "category",
                        ticks: {
                            color: colors.muted,
                            maxRotation: 0,
                            autoSkip: false,
                            callback(value) {
                                const label = this.getLabelForValue(value);
                                return typeof label === "string" ? monthLabelByDate.get(label) || "" : "";
                            },
                        },
                        grid: {
                            color(context) {
                                const label = context.scale.getLabelForValue(context.tick.value);
                                return typeof label === "string" && monthStartSet.has(label) ? colors.line : "rgba(0, 0, 0, 0)";
                            },
                            drawBorder: false,
                            drawTicks: false,
                            tickLength: 0,
                        },
                    },
                    y: {
                        title: { display: true, text: "Weight (lb)", color: colors.text },
                        min: Math.floor(minimum - padding),
                        max: Math.ceil(maximum + padding),
                        ticks: { color: colors.muted, stepSize: 2, precision: 0 },
                        grid: { color: colors.line },
                    },
                },
            },
        });

        updateWeightLegend(weightChart);
    }

    function renderAnnualWeightChart(payload) {
        const { canvas, canvasWrap, status, meta, latest, legend } = getElements();
        if (!window.Chart) {
            setStatus("Weight chart is unavailable because its local chart library did not load.", "is-error");
            return;
        }

        const annual = payload.annual.filter(row => Number.isInteger(Number(row?.year)) && Number.isFinite(Number(row.average_weight_lb)) &&
            Number.isFinite(Number(row.minimum_weight_lb)) && Number.isFinite(Number(row.maximum_weight_lb)));
        meta.textContent = formatTarget(payload.target);
        if (!annual.length) {
            latest.textContent = "";
            setStatus("No annual weight data available", "is-empty");
            return;
        }

        destroyWeightChart();
        const colors = getThemeColors();
        const target = payload.target;
        const latestAnnual = annual[annual.length - 1];
        const latestYear = Number(latestAnnual.year);
        const latestPrefix = latestYear === new Date().getFullYear() ? "YTD" : latestAnnual.is_partial ? "Partial year" : "";
        const rangeWeights = annual.flatMap(row => [Number(row.minimum_weight_lb), Number(row.maximum_weight_lb)]);
        const minimum = Math.min(...rangeWeights, Number(target.low_lb));
        const maximum = Math.max(...rangeWeights, Number(target.high_lb));
        const padding = Math.max(3, Math.ceil((maximum - minimum) * 0.1));
        const tickStep = maximum - minimum > 30 ? 5 : 2;

        latest.textContent = `Latest year ${latestYear}${latestPrefix ? ` ${latestPrefix}` : ""} · ${formatWeight(latestAnnual.average_weight_lb)} avg`;
        latest.title = latest.textContent;
        status.classList.add("hidden");
        canvasWrap.classList.remove("hidden");
        if (legend) {
            legend.innerHTML = "";
        }

        const targetBand = {
            id: "weightTargetBand",
            beforeDatasetsDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const upper = scales.y.getPixelForValue(target.high_lb);
                const lower = scales.y.getPixelForValue(target.low_lb);
                ctx.save();
                ctx.fillStyle = "rgba(34, 197, 94, 0.16)";
                ctx.fillRect(chartArea.left, upper, chartArea.right - chartArea.left, lower - upper);
                ctx.restore();
            },
        };

        weightChart = new window.Chart(canvas, {
            type: "line",
            data: {
                labels: annual.map(row => String(row.year)),
                datasets: [{
                    label: "Annual average",
                    data: annual.map(row => ({ x: String(row.year), y: Number(row.average_weight_lb), details: row })),
                    borderColor: colors.blue,
                    backgroundColor: colors.blue,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointHoverRadius: 5,
                    pointBorderColor: colors.blue,
                    pointBackgroundColor: colors.text,
                    tension: 0.15,
                }],
            },
            plugins: [targetBand],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                return items[0].raw.details.year;
                            },
                            label(context) {
                                const details = context.raw.details;
                                const partialLabel = Number(details.year) === new Date().getFullYear() ? "YTD" : details.is_partial ? "Partial year" : "";
                                return [
                                    `Annual average: ${formatWeight(context.raw.y)}`,
                                    `Range: ${formatWeight(details.minimum_weight_lb)}-${formatWeight(details.maximum_weight_lb)}`,
                                    `Measurements: ${details.measurement_count}`,
                                    `Coverage: ${formatLatestDate(details.first_date)}-${formatLatestDate(details.last_date)}`,
                                    partialLabel,
                                ].filter(Boolean);
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: "category",
                        ticks: { color: colors.muted, maxRotation: 0, autoSkip: true },
                        grid: { color: "rgba(0, 0, 0, 0)", drawBorder: false, drawTicks: false },
                    },
                    y: {
                        title: { display: true, text: "Weight (lb)", color: colors.text },
                        min: Math.floor(minimum - padding),
                        max: Math.ceil(maximum + padding),
                        ticks: { color: colors.muted, stepSize: tickStep, precision: 0 },
                        grid: { color: colors.line },
                    },
                },
            },
        });

        updateWeightLegend(weightChart);
    }

    let weightChartRequestId = 0;

    async function loadCharts() {
        const { yearSelect } = getElements();
        const mode = getWeightChartMode();
        const rawSavedYear = sessionStorage.getItem(WEIGHT_YEAR_KEY);
        const savedYear = rawSavedYear !== null && rawSavedYear !== "" ? Number.parseInt(rawSavedYear, 10) : NaN;
        const currentYear = new Date().getFullYear();
        const yearValue = Number.isInteger(savedYear) && savedYear >= 2000 ? savedYear : currentYear;
        const rawSelectValue = yearSelect && yearSelect.value !== undefined ? String(yearSelect.value).trim() : "";
        const currentSelectValue = rawSelectValue !== "" ? Number.parseInt(rawSelectValue, 10) : null;
        const selectedYear = Number.isInteger(currentSelectValue) && currentSelectValue >= 2000 ? currentSelectValue : yearValue;
        const requestId = ++weightChartRequestId;

        setWeightChartMode(mode);
        setStatus(mode === "annual" ? "Loading annual weight trend..." : "Loading weight trend...");
        try {
            if (mode === "annual") {
                const payload = await window.api.fetchAnnualWeightChart();
                if (!isValidAnnualPayload(payload)) {
                    throw new Error("Unexpected annual weight chart response.");
                }
                if (requestId !== weightChartRequestId || getWeightChartMode() !== "annual") {
                    return;
                }
                renderAnnualWeightChart(payload);
                return;
            }

            const payload = await window.api.fetchWeightChart(selectedYear);
            if (!isValidPayload(payload)) {
                throw new Error("Unexpected weight chart response.");
            }
            if (requestId !== weightChartRequestId) {
                return;
            }

            const availableYears = Array.isArray(payload.available_years) ? payload.available_years.map(Number).filter(Number.isFinite).sort((a, b) => b - a) : [];
            const defaultYear = availableYears.includes(selectedYear) ? selectedYear : (availableYears.includes(currentYear) ? currentYear : availableYears[0] || selectedYear);
            sessionStorage.setItem(WEIGHT_YEAR_KEY, String(defaultYear));
            if (yearSelect) {
                populateYearSelector(availableYears, defaultYear);
            }
            renderWeightChart({ ...payload, year: defaultYear, available_years: availableYears });
        } catch (error) {
            if (requestId !== weightChartRequestId || getWeightChartMode() !== mode) {
                return;
            }
            setStatus(mode === "annual" ? "Annual weight trend is currently unavailable" : "Weight trend is currently unavailable.", "is-error");
        }
    }

    const { yearSelect } = getElements();
    if (yearSelect) {
        yearSelect.addEventListener("change", () => {
            const nextYear = Number.parseInt(yearSelect.value, 10);
            if (Number.isInteger(nextYear) && nextYear >= 2000) {
                sessionStorage.setItem(WEIGHT_YEAR_KEY, String(nextYear));
                loadCharts();
            }
        });
    }

    const { annualModeButton, monthlyModeButton } = getElements();
    if (monthlyModeButton) {
        monthlyModeButton.addEventListener("click", () => {
            if (getWeightChartMode() !== "monthly") {
                setWeightChartMode("monthly");
                loadCharts();
            }
        });
    }
    if (annualModeButton) {
        annualModeButton.addEventListener("click", () => {
            if (getWeightChartMode() !== "annual") {
                setWeightChartMode("annual");
                loadCharts();
            }
        });
    }

    const { fitnessFatigueRangeButtons } = getElements();
    fitnessFatigueRangeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const nextRange = button.dataset.fitnessFatigueRange;
            if (FITNESS_FATIGUE_RANGES.includes(nextRange) && nextRange !== getFitnessFatigueRange()) {
                setFitnessFatigueRange(nextRange);
                loadFitnessFatigueTrend();
            }
        });
    });

    setWeightChartMode(getWeightChartMode());
    setFitnessFatigueRange(getFitnessFatigueRange());
    window.ChartsController = {
        load: loadCharts,
        loadFitnessFatigue,
        render: renderWeightChart,
    };

    new MutationObserver(() => {
        if (weightChart) {
            loadCharts();
        }
        if (fitnessFatigueChart && fitnessFatigueTrendPayload) {
            renderFitnessFatigueTrend(fitnessFatigueTrendPayload);
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
