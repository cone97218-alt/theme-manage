import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup lightweight browser mocks
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
globalThis.document = {
    createElement: () => ({
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        appendChild: () => {},
        setAttribute: () => {},
        getAttribute: () => '',
        addEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: () => null,
        remove: () => {}
    }),
    getElementById: () => null,
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    addEventListener: () => {},
    dispatchEvent: () => true,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
};
globalThis.CustomEvent = class { constructor(type, detail) { this.type = type; this.detail = detail; } };
globalThis.toastr = { info: () => {}, success: () => {}, warning: () => {}, error: () => {} };
globalThis.confirm = () => true;
globalThis.prompt = () => '';

const modulesToTest = [
    { name: 'theme-core.js', init: 'initThemeCore', args: {} },
    { name: 'tag-manager.js', init: 'createTagManager', args: {} },
    { name: 'character-binding.js', init: 'initCharacterBinding', args: {} },
    { name: 'background-batch.js', init: 'initBackgroundEnhancements', args: {} },
    { name: 'color-transfer.js', init: 'initColorTransfer', args: {} },
    { name: 'batch-rename.js', init: 'initBatchRename', args: {} },
    { name: 'auto-group.js', init: 'initAutoGroup', args: {} },
    { name: 'auto-theme.js', init: 'initAutoTheme', args: { managerPanel: document.createElement('div') } },
    { name: 'backup-manager.js', init: 'initBackupManager', args: {} },
    { name: 'tag-ui.js', init: 'initTagUI', args: {} },
    { name: 'batch-delete.js', init: 'initBatchDelete', args: {} },
    { name: 'theme-import.js', init: 'initThemeImport', args: {} },
    { name: 'settings-manager.js', init: 'initSettingsManager', args: { settingsKeysToSync: [] } },
    { name: 'avatar-replace.js', init: 'initAvatarReplace', args: {} },
];

let allPassed = true;

for (const mod of modulesToTest) {
    try {
        const modPath = `./modules/${mod.name}`;
        const imported = await import(modPath);
        if (!imported[mod.init]) {
            throw new Error(`Export '${mod.init}' not found in ${mod.name}`);
        }
        const instance = imported[mod.init](mod.args);
        console.log(`[PASS] ${mod.name}: factory '${mod.init}' executed successfully, returned:`, Object.keys(instance || {}));
    } catch (err) {
        allPassed = false;
        console.error(`[FAIL] ${mod.name}:`, err);
    }
}

if (allPassed) {
    console.log('\n==========================================');
    console.log(' ALL 14 MODULES PASSED VERIFICATION! ');
    console.log('==========================================');
    process.exit(0);
} else {
    process.exit(1);
}
