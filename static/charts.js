(function () {
    let weightChart = null;
    const WEIGHT_YEAR_KEY = "trainingWeightChartYear";
    const WEIGHT_MODE_KEY = "trainingWeightChartMode";

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
        };
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

        const monthStartSet = new Set(monthly.map(row => (
            typeof row.month_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.month_start)
                ? row.month_start
                : `${row.month}-01`
        )));

        const labels = getCalendarDatesForMonths(monthly);

        const weights = daily.map(row => Number(row.weight_lb)).concat(monthlyAverageRows.map(row => Number(row.average_lb)), Number(target.low_lb), Number(target.high_lb));
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
                        data: monthlyAverageRows.map(row => ({ x: row.endpointDate, y: Number(row.average_lb), details: row })),
                        borderColor: colors.blue,
                        backgroundColor: colors.blue,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBorderColor: colors.blue,
                        pointBackgroundColor: colors.text,
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
                                return item.dataset.label === "Monthly average" ? formatMonth(item.raw.details.month) : item.raw.x;
                            },
                            label(context) {
                                if (context.dataset.label === "Measurements") {
                                    const latestLabel = latestPoint && context.raw.x === latestPoint.date ? " (latest)" : "";
                                    return `Daily weight: ${formatWeight(context.raw.y)}${latestLabel}`;
                                }
                                const details = context.raw.details;
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

    setWeightChartMode(getWeightChartMode());
    window.ChartsController = { load: loadCharts, render: renderWeightChart };

    new MutationObserver(() => {
        if (weightChart) {
            loadCharts();
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
