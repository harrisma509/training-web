const assert = require("node:assert/strict");
const fs = require("node:fs");

function read(path) {
    return fs.readFileSync(path, "utf8");
}

function exists(path) {
    return fs.existsSync(path);
}

const webPowerShell = read("deploy_training_web.ps1");
const webShell = read("deploy_to_server_from_mac.sh");
const etlPowerShell = read("../training-etl/deploy_training_etl.ps1");
const etlShell = read("../training-etl/deploy_to_server_from_mac.sh");
const webArchitecture = read("docs/FRONTEND_ARCHITECTURE.md");
const webTesting = read("docs/TESTING_GUIDE.md");
const webReadme = read("README.md");
const webGuide = read("docs/AI_DEV_GUIDE.md");
const webInstructions = read(".github/copilot-instructions.md");
const etlReadme = read("../training-etl/README.md");
const etlInstructions = read("../training-etl/.github/copilot-instructions.md");
const etlTesting = read("../training-etl/docs/TESTING_GUIDE.md");
const etlApi = read("../training-etl/docs/TRAINING_API.md");

for (const path of [
    "deploy_training_web.ps1",
    "deploy_to_server_from_mac.sh",
]) {
    assert.ok(exists(path), `missing supported web deployment script: ${path}`);
}
for (const path of [
    "../training-etl/deploy_training_etl.ps1",
    "../training-etl/deploy_to_server_from_mac.sh",
]) {
    assert.ok(exists(path), `missing supported ETL deployment script: ${path}`);
}

const webExcludes = [
    ".git",
    ".gitignore",
    ".github",
    ".vscode",
    ".env",
    ".env.*",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    "*.tar",
    "*.tar.gz",
    "*.zip",
    "tmp",
    "tests",
    "AI_DEV_GUIDE.md",
    "README.md",
    "deploy_to_server_from_mac.sh",
    "deploy_training_web.ps1",
];
for (const exclude of webExcludes) {
    assert.match(webPowerShell, new RegExp(`--exclude[= ]"${escapeRegExp(exclude)}"`));
    assert.match(webShell, new RegExp(`--exclude="${escapeRegExp(exclude)}"`));
}

for (const script of [webPowerShell, webShell, etlPowerShell, etlShell]) {
    assert.match(script, /clean Git working tree/);
    assert.match(script, /rev-parse/);
    assert.match(script, /upstream/);
    assert.doesNotMatch(script, /--force-recreate|docker compose up|docker-compose up/);
}
for (const script of [webPowerShell, webShell]) {
    assert.doesNotMatch(script, /rsync/);
    assert.match(script, /training-web-deploy\.tar\.gz/);
    assert.match(script, /training-web/);
}
for (const script of [etlPowerShell, etlShell]) {
    for (const member of ["src", "Dockerfile", "requirements.txt", "docker-compose.server.yml"]) {
        assert.match(script, new RegExp(`\\b${escapeRegExp(member)}\\b`));
    }
    assert.match(script, /No containers were rebuilt or restarted/);
}

assert.match(webArchitecture, /deploy_training_web\.ps1/);
assert.match(webArchitecture, /deploy_to_server_from_mac\.sh/);
assert.match(webArchitecture, /scoped `training-web` restart/);
assert.match(webArchitecture, /Routine source\/static changes do not require recreation or image rebuild/);
assert.match(webArchitecture, /Documentation-only changes do not require deployment or restart/);
assert.match(etlReadme, /deploy_training_etl\.ps1/);
assert.match(etlReadme, /deploy_to_server_from_mac\.sh/);
assert.match(etlReadme, /Python source change/);
assert.match(etlReadme, /Dockerfile or requirements change/);
assert.match(etlReadme, /Compose command, port, volume, or health-check change/);
assert.match(etlApi, /Environment changes require container recreation/);
assert.match(etlApi, /Dependency changes require an image rebuild/);

for (const guidance of [webReadme, webGuide, webInstructions, webArchitecture, etlReadme, etlInstructions, etlApi]) {
    assert.doesNotMatch(guidance, /Synology|DS220j|deploy_to_nas|old_deploy_to_nas|docker-compose-nas|NAS web deployment|NAS runtime/);
    assert.doesNotMatch(guidance, /FRONTEND_REFACTOR_HANDOFF/);
}
for (const retiredPath of [
    "docker-compose-nas.yml",
    "../training-etl/deploy/docker-compose-nas.yml",
    "deploy_to_nas_from_mac.sh",
    "../training-etl/old_deploy_to_nas_from_mac.sh",
]) {
    assert.equal(exists(retiredPath), false, `retired deployment path remains: ${retiredPath}`);
}

assert.match(webInstructions, /deploy_training_web\.ps1/);
assert.match(webInstructions, /deploy_to_server_from_mac\.sh/);
assert.match(etlInstructions, /deploy_training_etl\.ps1/);
assert.match(etlInstructions, /deploy_to_server_from_mac\.sh/);
assert.match(webTesting, /35 Node test files/);
assert.match(webTesting, /\.\\\.venv\\Scripts\\python\.exe -m pytest/);
assert.match(etlTesting, /\.\\\.venv\\Scripts\\python\.exe -m pytest/);
for (const guidance of [webReadme, webGuide, webInstructions, etlReadme, etlInstructions]) {
    assert.doesNotMatch(guidance, /(^|[\s`])python3? -m (pytest|py_compile)\b/m);
    assert.doesNotMatch(guidance, /activate the repository virtual environment/);
    assert.doesNotMatch(guidance, /\.deploy_training_web\.ps1/);
}

console.log("Cross-platform deployment parity and NAS retirement contract tests passed.");

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
