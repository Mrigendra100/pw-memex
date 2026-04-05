"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('pw-memex');
    context.subscriptions.push(vscode.commands.registerCommand('pw-memex.learn', () => runLearn()), vscode.commands.registerCommand('pw-memex.compare', () => runCompare()));
}
function deactivate() { }
// ─── Learn ────────────────────────────────────────────────────────────────────
async function runLearn() {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot)
        return;
    const specPath = await pickSpecFile(workspaceRoot);
    if (!specPath)
        return;
    const tracePath = findLatestTrace(workspaceRoot, specPath);
    if (!tracePath) {
        vscode.window.showWarningMessage('pw-memex: no trace.zip found in test-results/. ' +
            'Run your Playwright tests with use: { trace: "on" } first.');
        return;
    }
    const relSpec = path.relative(workspaceRoot, specPath);
    const cmd = `npx pw-memex learn "${tracePath}" --suite "${relSpec}" --output .pw-memory`;
    runCommand(cmd, workspaceRoot, `Learning from ${path.basename(specPath)}...`);
}
// ─── Compare ─────────────────────────────────────────────────────────────────
async function runCompare() {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot)
        return;
    const specPath = await pickSpecFile(workspaceRoot);
    if (!specPath)
        return;
    const tracePath = findLatestTrace(workspaceRoot, specPath);
    if (!tracePath) {
        vscode.window.showWarningMessage('pw-memex: no trace.zip found in test-results/.');
        return;
    }
    const memoryPath = findMemoryFile(workspaceRoot, specPath);
    if (!memoryPath) {
        vscode.window.showWarningMessage('pw-memex: no .memory.md baseline found for this spec. Run "Learn from trace" first.');
        return;
    }
    const cmd = `npx pw-memex compare "${tracePath}" "${memoryPath}"`;
    runCommand(cmd, workspaceRoot, `Comparing failure for ${path.basename(specPath)}...`);
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function getWorkspaceRoot() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('pw-memex: no workspace folder open.');
    }
    return root;
}
async function pickSpecFile(workspaceRoot) {
    // If the active editor is a spec file, use it directly
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active && /\.spec\.(ts|js)$/.test(active))
        return active;
    // Otherwise prompt the user to pick one
    const uris = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(workspaceRoot),
        canSelectMany: false,
        filters: { 'Playwright spec': ['ts', 'js'] },
        title: 'Select a Playwright spec file',
    });
    return uris?.[0]?.fsPath;
}
function findLatestTrace(workspaceRoot, specPath) {
    const resultsDir = path.join(workspaceRoot, 'test-results');
    if (!fs.existsSync(resultsDir))
        return null;
    const specSlug = path.basename(specPath).replace(/\.spec\.(ts|js)$/, '').toLowerCase();
    const allTraces = walkForFile(resultsDir, 'trace.zip');
    // Prefer a trace whose parent folder name contains the spec slug
    const matching = allTraces.filter(t => t.toLowerCase().includes(specSlug));
    const candidates = matching.length > 0 ? matching : allTraces;
    // Return the most recently modified trace
    return candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}
function findMemoryFile(workspaceRoot, specPath) {
    const memDir = path.join(workspaceRoot, '.pw-memory');
    if (!fs.existsSync(memDir))
        return null;
    const specSlug = path.basename(specPath)
        .replace(/\.spec\.(ts|js)$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-');
    const specDir = path.join(memDir, specSlug);
    if (!fs.existsSync(specDir))
        return null;
    const files = fs.readdirSync(specDir).filter(f => f.endsWith('.md'));
    if (files.length === 0)
        return null;
    // If multiple baselines, let user pick
    if (files.length === 1)
        return path.join(specDir, files[0]);
    return path.join(specDir, files[0]); // Could be improved to show quick-pick
}
function walkForFile(dir, filename) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory())
            results.push(...walkForFile(fullPath, filename));
        else if (entry.name === filename)
            results.push(fullPath);
    }
    return results;
}
function runCommand(cmd, cwd, title) {
    outputChannel.show(true);
    outputChannel.appendLine(`\n── ${title} ──`);
    outputChannel.appendLine(`$ ${cmd}\n`);
    (0, child_process_1.exec)(cmd, { cwd }, (err, stdout, stderr) => {
        if (stdout)
            outputChannel.appendLine(stdout);
        if (stderr)
            outputChannel.appendLine(stderr);
        if (err) {
            outputChannel.appendLine(`\nExited with code ${err.code}`);
        }
        else {
            outputChannel.appendLine('\nDone.');
        }
    });
}
