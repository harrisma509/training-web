(function initializeTransientSurface(global) {
    const app = global.TrainingApp = global.TrainingApp || {};

    function isFocusableOpener(opener) {
        if (!opener || typeof opener.focus !== "function") {
            return false;
        }
        if (opener.isConnected === false || opener.disabled === true || opener.hidden === true) {
            return false;
        }
        if (typeof opener.getAttribute === "function") {
            if (opener.getAttribute("aria-hidden") === "true") {
                return false;
            }
            const tabIndexAttribute = opener.getAttribute("tabindex");
            if (tabIndexAttribute !== null && Number(tabIndexAttribute) < 0) {
                return false;
            }
        }
        if (typeof opener.closest === "function" && opener.closest("[hidden], .hidden, [aria-hidden=\"true\"]")) {
            return false;
        }
        if (typeof opener.getClientRects === "function" && opener.getClientRects().length === 0) {
            return false;
        }

        const ownerDocument = opener.ownerDocument;
        const view = ownerDocument && ownerDocument.defaultView;
        const computedStyle = view && typeof view.getComputedStyle === "function"
            ? view.getComputedStyle(opener)
            : null;
        if (computedStyle && (computedStyle.display === "none" || computedStyle.visibility === "hidden")) {
            return false;
        }

        const tabIndex = typeof opener.tabIndex === "number" ? opener.tabIndex : null;
        if (tabIndex !== null) {
            return tabIndex >= 0;
        }
        return Boolean(opener.matches && opener.matches("button, a[href], input, select, textarea, [tabindex]"));
    }

    function createTransientSurface({
        getSurface,
        canClose,
        onBeforeClose,
        onAfterClose,
        restoreFocus = true,
        reportError,
    } = {}) {
        let open = false;
        let opener = null;
        let generation = 0;

        function report(error) {
            if (typeof reportError === "function") {
                reportError(error);
            } else {
                console.error(error);
            }
        }

        function close(reason) {
            if (!open) {
                return false;
            }

            const focusTarget = opener;
            open = false;
            opener = null;
            generation += 1;

            try {
                onBeforeClose?.(reason, getSurface?.());
            } catch (error) {
                report(error);
            }
            try {
                onAfterClose?.(reason, getSurface?.());
            } catch (error) {
                report(error);
            }

            if (restoreFocus && isFocusableOpener(focusTarget)) {
                focusTarget.focus();
            }
            return true;
        }

        function requestClose(reason) {
            if (!open) {
                return Promise.resolve(false);
            }

            const requestGeneration = generation;
            return Promise.resolve()
                .then(() => (typeof canClose === "function" ? canClose(reason) : true))
                .then(allowed => {
                    if (!allowed || !open || requestGeneration !== generation) {
                        return false;
                    }
                    return close(reason);
                })
                .catch(error => {
                    report(error);
                    return false;
                });
        }

        function openSurface({ opener: nextOpener } = {}) {
            opener = nextOpener || null;
            generation += 1;
            open = true;
            return true;
        }

        return {
            open: openSurface,
            requestClose,
            close,
            isOpen: () => open,
        };
    }

    app.TransientSurface = app.TransientSurface || { create: createTransientSurface };
})(window);
