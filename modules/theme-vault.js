/**
 * modules/theme-vault.js
 * 超大容量美化冷仓库 (Theme Vault) 模块
 * 基于原生 IndexedDB 驱动，专为拥有几百上千乃至上万美化的重度用户设计。
 * 彻底解决 SillyTavern 原生 settings/get 接口全量加载导致的手机端内存溢出 (OOM) 与闪退问题。
 */

const DB_NAME = 'ThemeManager_VaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'vault_themes';

let dbPromise = null;

/**
 * 获取或初始化 IndexedDB 数据库连接
 */
export function getVaultDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('当前环境不支持 IndexedDB'));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'name' });
                store.createIndex('mtime', 'mtime', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            console.error('[Theme Vault] 打开 IndexedDB 失败:', event.target.error);
            reject(event.target.error);
        };
    });

    return dbPromise;
}

/**
 * 批量将美化存入仓库 (冷存储)
 * @param {Array<Object>|Object} themes
 */
export async function saveThemesToVault(themes) {
    const list = Array.isArray(themes) ? themes : [themes];
    if (list.length === 0) return 0;

    const db = await getVaultDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        list.forEach(item => {
            if (item && item.name) {
                const clean = { ...item };
                if (!clean.mtime) clean.mtime = Date.now();
                store.put(clean);
            }
        });

        tx.oncomplete = () => resolve(list.length);
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 从仓库获取单个美化的完整数据
 * @param {string} name
 */
export async function getThemeFromVault(name) {
    if (!name) return null;
    const db = await getVaultDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(String(name).trim());

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 从仓库删除单个美化
 * @param {string} name
 */
export async function deleteThemeFromVault(name) {
    if (!name) return false;
    const db = await getVaultDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(String(name).trim());

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取仓库中所有美化的轻量级元数据概览 (不包含大体积 custom_css，极度省内存)
 */
export async function getAllVaultThemesSummary() {
    const db = await getVaultDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.openCursor();
        const summaries = [];

        req.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const val = cursor.value;
                summaries.push({
                    name: val.name,
                    value: val.name,
                    display: val.name,
                    mtime: val.mtime || Date.now(),
                    isVault: true
                });
                cursor.continue();
            } else {
                resolve(summaries);
            }
        };

        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取仓库中美化总数
 */
export async function getVaultThemeCount() {
    try {
        const db = await getVaultDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.count();

            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (_) {
        return 0;
    }
}

/**
 * 初始化冷仓库控制模块工厂
 */
export function initThemeVault(config = {}) {
    const {
        toastr,
        showLoader,
        hideLoader,
        callGenericPopup,
        escapeHtml,
        saveTheme,
        deleteTheme,
        applyThemeDirect,
        getAllThemeObjects = () => [],
        getFavorites = () => [],
        updateActiveState = () => {},
        softRefreshUI = () => {},
        originalSelect
    } = config;

    /**
     * 一键将仓库中的美化激活并写入酒馆原生目录
     */
    async function activateAndApplyVaultTheme(themeName) {
        if (!themeName) return false;
        try {
            const fullObj = await getThemeFromVault(themeName);
            if (!fullObj) {
                if (toastr) toastr.error(`未在美化仓库中找到「${themeName}」的数据`);
                return false;
            }

            // 1. 瞬时应用
            if (typeof applyThemeDirect === 'function') {
                applyThemeDirect(themeName);
            }

            // 2. 将该主题热写入原生目录，确保酒馆原生刷新和切聊时受原生认可
            if (typeof saveTheme === 'function') {
                await saveTheme(fullObj, { isBatch: true });
            }

            if (toastr) toastr.success(`已从大仓库调出并激活美化: ${themeName}`);
            return true;
        } catch (err) {
            console.error('[Theme Vault] 激活仓库主题失败:', err);
            if (toastr) toastr.error(`激活仓库美化失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 一键归档闲置主题并为酒馆原生目录瘦身 (彻底根治手机端因原生 settings/get 庞大导致的闪退)
     */
    async function archiveIdleThemesToVault(options = {}) {
        const { keepCount = 30 } = options;
        if (showLoader) showLoader();

        try {
            const allInstalled = typeof getAllThemeObjects === 'function' ? getAllThemeObjects() : [];
            const favs = new Set(typeof getFavorites === 'function' ? getFavorites() : []);
            const currentActive = originalSelect?.value || localStorage.getItem('themeManager_lastActiveTheme') || '';

            if (allInstalled.length <= keepCount) {
                if (hideLoader) hideLoader();
                if (toastr) toastr.info(`当前已安装主题仅 ${allInstalled.length} 个，无需进行仓库归档瘦身。`);
                return;
            }

            // 区分热主题与待归档冷主题
            const hotThemes = [];
            const coldThemes = [];

            allInstalled.forEach(t => {
                const name = t.name || t.value;
                if (!name) return;
                // 当前正在使用的、或者已收藏的主题，保留在热美化池中
                if (name === currentActive || favs.has(name)) {
                    hotThemes.push(t);
                } else {
                    coldThemes.push(t);
                }
            });

            // 确保热主题池有一定数量
            while (hotThemes.length < keepCount && coldThemes.length > 0) {
                hotThemes.push(coldThemes.shift());
            }

            console.log(`[Theme Vault] 开始归档: 待转存入仓库冷美化 ${coldThemes.length} 个，保留热美化 ${hotThemes.length} 个...`);

            // 1. 转存入 IndexedDB
            await saveThemesToVault(coldThemes);

            // 2. 从原生磁盘删除冷主题文件
            let deletedCount = 0;
            for (const t of coldThemes) {
                const name = t.name || t.value;
                try {
                    await deleteTheme(name, t);
                    deletedCount++;
                } catch (e) {
                    console.warn(`[Theme Vault] 卸载原生主题 "${name}" 失败:`, e);
                }
            }

            if (hideLoader) hideLoader();
            const msg = `仓库归档与瘦身成功！已将 ${coldThemes.length} 个闲置美化转存入大仓库（酒馆原生目录减负 ${deletedCount} 个，保留热美化 ${hotThemes.length} 个）。手机端将彻底恢复极速不闪退！`;
            if (toastr) toastr.success(msg);
            console.log(`[Theme Vault] ${msg}`);

            if (typeof softRefreshUI === 'function') softRefreshUI();
            if (typeof updateActiveState === 'function') updateActiveState();

        } catch (err) {
            if (hideLoader) hideLoader();
            console.error('[Theme Vault Error] 归档过程发生异常:', err);
            if (toastr) toastr.error(`归档瘦身失败: ${err.message}`);
        }
    }

    return {
        saveThemesToVault,
        getThemeFromVault,
        deleteThemeFromVault,
        getAllVaultThemesSummary,
        getVaultThemeCount,
        activateAndApplyVaultTheme,
        archiveIdleThemesToVault
    };
}
