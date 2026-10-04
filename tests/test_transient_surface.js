const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("static/transient-surface.js", "utf8");
const createTransientSurface = vm.runInNewContext(`(() => {
  const window = { TrainingApp: {} };
  vmSource;
  return window.TrainingApp.TransientSurface.create;
})()`.replace("vmSource", source));

function opener(overrides = {}) {
    const state = { focusCalls: 0 };
    return {
        isConnected: true,
        disabled: false,
        hidden: false,
        tabIndex: 0,
        getClientRects: () => [{}],
        getAttribute: name => (name === "aria-hidden" ? null : null),
        closest: () => null,
        focus: () => { state.focusCalls += 1; },
        state,
        ...overrides,
    };
}

function createSurface(overrides = {}) {
    const state = { hidden: false, closeReasons: [], errors: [] };
    const surface = { state };
    const controller = createTransientSurface({
        getSurface: () => surface,
        onBeforeClose: reason => {
            state.hidden = true;
            state.closeReasons.push(reason);
        },
        reportError: error => state.errors.push(error),
        ...overrides,
    });
    return { controller, state };
}

async function main() {
    const firstOpener = opener();
    const { controller, state } = createSurface();
    controller.open({ opener: firstOpener });
    assert.equal(controller.isOpen(), true);
    assert.equal(await controller.requestClose("close-button"), true);
    assert.equal(state.hidden, true);
    assert.deepEqual(state.closeReasons, ["close-button"]);
    assert.equal(firstOpener.state.focusCalls, 1);
    assert.equal(await controller.requestClose("backdrop"), false, "close must be idempotent");
    assert.equal(firstOpener.state.focusCalls, 1);

    const reasons = [];
    const guarded = createSurface({ canClose: reason => { reasons.push(reason); return true; } });
    const guardedOpener = opener();
    guarded.controller.open({ opener: guardedOpener });
    assert.equal(await guarded.controller.requestClose("backdrop"), true);
    assert.deepEqual(reasons, ["backdrop"]);
    guarded.controller.open({ opener: guardedOpener });
    assert.equal(await guarded.controller.requestClose("escape"), true);
    assert.deepEqual(reasons, ["backdrop", "escape"]);

    let syncCalls = 0;
    const vetoed = createSurface({ canClose: () => { syncCalls += 1; return false; } });
    const vetoOpener = opener();
    vetoed.controller.open({ opener: vetoOpener });
    assert.equal(await vetoed.controller.requestClose("close-button"), false);
    assert.equal(syncCalls, 1);
    assert.equal(vetoed.controller.isOpen(), true);
    assert.equal(vetoOpener.state.focusCalls, 0);
    assert.equal(vetoed.state.hidden, false);

    let asyncCalls = 0;
    const asyncGuard = createSurface({ canClose: async () => { asyncCalls += 1; return true; } });
    const asyncOpener = opener();
    asyncGuard.controller.open({ opener: asyncOpener });
    assert.equal(await asyncGuard.controller.requestClose("escape"), true);
    assert.equal(asyncCalls, 1);
    assert.equal(asyncOpener.state.focusCalls, 1);

    const rejected = createSurface({ canClose: async () => { throw new Error("guard failed"); } });
    const rejectedOpener = opener();
    rejected.controller.open({ opener: rejectedOpener });
    assert.equal(await rejected.controller.requestClose("escape"), false);
    assert.equal(rejected.controller.isOpen(), true);
    assert.equal(rejectedOpener.state.focusCalls, 0);
    assert.equal(rejected.state.errors[0].message, "guard failed");

    const detached = createSurface();
    const detachedOpener = opener({ isConnected: false });
    detached.controller.open({ opener: detachedOpener });
    assert.equal(await detached.controller.requestClose("close-button"), true);
    assert.equal(detachedOpener.state.focusCalls, 0);

    const hidden = createSurface();
    const hiddenOpener = opener({ hidden: true });
    hidden.controller.open({ opener: hiddenOpener });
    assert.equal(await hidden.controller.requestClose("backdrop"), true);
    assert.equal(hiddenOpener.state.focusCalls, 0);

    const disabled = createSurface();
    const disabledOpener = opener({ disabled: true });
    disabled.controller.open({ opener: disabledOpener });
    assert.equal(await disabled.controller.requestClose("escape"), true);
    assert.equal(disabledOpener.state.focusCalls, 0);

    const replaced = createSurface();
    const oldOpener = opener();
    const newOpener = opener();
    replaced.controller.open({ opener: oldOpener });
    replaced.controller.open({ opener: newOpener });
    assert.equal(await replaced.controller.requestClose("close-button"), true);
    assert.equal(oldOpener.state.focusCalls, 0);
    assert.equal(newOpener.state.focusCalls, 1);

    const staleAsync = createSurface({ canClose: () => new Promise(resolve => setTimeout(() => resolve(true), 0)) });
    const staleFirst = opener();
    const staleSecond = opener();
    staleAsync.controller.open({ opener: staleFirst });
    const pending = staleAsync.controller.requestClose("escape");
    staleAsync.controller.open({ opener: staleSecond });
    assert.equal(await pending, false);
    assert.equal(staleAsync.controller.isOpen(), true);
    assert.equal(staleFirst.state.focusCalls, 0);
    assert.equal(staleSecond.state.focusCalls, 0);

    assert.equal(Object.keys(createSurface().controller).includes("storage"), false, "primitive stores no durable data");
    console.log("Transient surface contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
