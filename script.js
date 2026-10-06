(function () {
    'use strict';

    let currentAutoThemeState = null;
    let autoThemeApplied = false;

    // 轻量级并发限制辅助函数，保证在低端设备或超大批量操作时网络请求有序，避免过载
    async function limitConcurrency(concurrency, items, taskFn) {
        const results = [];
        const executing = new Set();

        for (const item of items) {
            const p = Promise.resolve().then(() => taskFn(item));
            results.push(p);
            executing.add(p);

            const clean = () => executing.delete(p);
            p.then(clean, clean);

            if (executing.size >= concurrency) {
                await Promise.race(executing);
            }
        }

        return Promise.allSettled(results);
    }

    // === 背景图底层模块动态加载器（免疫后台面板冻结与脱卸） ===
    let _bgModulePromise = null;
    function getBgModule() {
        if (!_bgModulePromise) {
            _bgModulePromise = import('/scripts/backgrounds.js').catch(() => {
                return import('../../../scripts/backgrounds.js');
            }).catch(err => {
                console.warn('[Theme Manager] 无法加载 backgrounds.js 模块:', err);
                return null;
            });
        }
        return _bgModulePromise;
    }

    // === 全局安全应用背景图函数（双模引擎：DOM模拟点击 + 模块状态直写，免疫面板冻结） ===
    async function applyBackgroundDirectly(bgFile) {
        if (!bgFile) return;

        // 1. 检查当前视觉背景是否已经是此背景，避免重复应用与重排
        const bg1 = document.querySelector('#bg1');
        if (bg1) {
            const currentBg = bg1.style.backgroundImage || '';
            const targetUrlPart = `backgrounds/${encodeURIComponent(bgFile)}`;
            if (currentBg && (currentBg.includes(targetUrlPart) || currentBg.includes(bgFile))) {
                console.log(`[Theme Manager] 背景图已经是 ${bgFile}，跳过应用`);
                return;
            }
        }

        // 2. 尝试通过活跃 DOM 元素点击（如果背景抽屉当前正好处于打开挂载状态）
        const escapedBg = CSS.escape(bgFile);
        const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${escapedBg}"], #bg_custom_content .bg_example[bgfile="${escapedBg}"], #Backgrounds .bg_example[bgfile="${escapedBg}"]`);
        if (bgElement) {
            try {
                bgElement.click();
                return;
            } catch (e) {}
        }

        // 3. 核心适配：当背景抽屉被后台面板冻结（或在子文件夹内未展开）时，直接通过 backgrounds.js 模块状态应用
        try {
            const bgMod = await getBgModule();
            if (bgMod) {
                if (typeof bgMod.applyGlobalBackground === 'function') {
                    try {
                        await bgMod.applyGlobalBackground(bgFile);
                        console.log(`[Theme Manager] 面板冻结模式下，成功通过 backgrounds.js applyGlobalBackground 应用背景: ${bgFile}`);
                        return;
                    } catch (e) {
                        console.warn('[Theme Manager] applyGlobalBackground 调用失败，降级到手动状态写入:', e);
                    }
                }
                const isCustom = bgMod.isCustomBackgroundUrl ? bgMod.isCustomBackgroundUrl(bgFile) : false;
                const targetUrl = isCustom
                    ? `url("${encodeURI(bgFile)}")`
                    : `url("${bgMod.getBackgroundPath ? bgMod.getBackgroundPath(bgFile) : ('backgrounds/' + encodeURIComponent(bgFile))}")`;

                if (bg1) {
                    bg1.style.backgroundImage = targetUrl;
                }

                if (bgMod.background_settings) {
                    bgMod.background_settings.name = bgFile;
                    bgMod.background_settings.url = targetUrl;
                }

                const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
                if (ctx && ctx.chatMetadata && ctx.chatMetadata['custom_background']) {
                    ctx.chatMetadata['custom_background'] = targetUrl;
                    if (ctx.saveMetadataDebounced) ctx.saveMetadataDebounced();
                }

                if (ctx && ctx.saveSettingsDebounced) {
                    ctx.saveSettingsDebounced();
                }
                console.log(`[Theme Manager] 面板冻结模式下，成功通过 backgrounds.js 模块直写应用背景: ${bgFile}`);
                return;
            }
        } catch (err) {
            console.warn('[Theme Manager] 模块直调背景失败，执行降级逻辑:', err);
        }

        // 4. 终极兜底降级方案
        try {
            const bgUrl = `url("backgrounds/${encodeURIComponent(bgFile)}")`;
            if (bg1) bg1.style.backgroundImage = bgUrl;
            const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
            if (ctx && ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
            console.log(`[Theme Manager] 降级直接应用背景图: ${bgFile}`);
        } catch (err) {
            console.error('[Theme Manager] 直接应用背景图失败:', err);
        }
    }

    // 早期极速主题切换，避免双重排版与视觉闪烁
    function applyEarlyAutoTheme(originalSelect, settings) {
        if (!settings || !settings.enabled) return;

        let newState = null;
        if (settings.mode === 'system') {
            if (window.matchMedia) {
                if (window.matchMedia('(prefers-color-scheme: dark)').matches) newState = 'night';
                else if (window.matchMedia('(prefers-color-scheme: light)').matches) newState = 'day';
            }
            if (!newState) {
                newState = document.documentElement.classList.contains('light') ? 'day' : 'night';
            }
        } else if (settings.mode === 'time') {
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const [dayH, dayM] = settings.dayStart.split(':').map(Number);
            const [nightH, nightM] = settings.nightStart.split(':').map(Number);
            const dayTime = dayH * 60 + dayM;
            const nightTime = nightH * 60 + nightM;

            if (dayTime < nightTime) {
                newState = (currentTime >= dayTime && currentTime < nightTime) ? 'day' : 'night';
            } else {
                newState = (currentTime >= nightTime && currentTime < dayTime) ? 'night' : 'day';
            }
        }

        if (!newState) return;
        currentAutoThemeState = newState;

        let target = null;
        const currentThemeVal = originalSelect.value;
        try {
            const rawPairs = JSON.parse(localStorage.getItem('themeManager_themeDayNightPairs'));
            let pair = null;
            if (Array.isArray(rawPairs)) {
                pair = rawPairs.find(p => p && (p.dayTheme === currentThemeVal || p.nightTheme === currentThemeVal));
            }
            if (pair) {
                if (newState === 'night') target = pair.nightTheme || pair.dayTheme;
                else if (newState === 'day') target = pair.dayTheme || pair.nightTheme;
            }
        } catch (e) {}

        if (!target) {
            target = newState === 'day' ? settings.dayTarget : settings.nightTarget;
        }
        if (!target) return;

        let themeToApply = null;
        if (target.startsWith('[Tag] ')) {
            const tagId = target.replace('[Tag] ', '');
            try {
                const tags = JSON.parse(localStorage.getItem('themeManager_themeTags')) || [];
                const tag = tags.find(t => t.id === tagId);
                if (tag && tag.themes && tag.themes.length > 0) {
                    const tagThemesSet = new Set(tag.themes);
                    const pool = [];
                    for (let i = 0; i < originalSelect.options.length; i++) {
                        const val = originalSelect.options[i].value;
                        if (tagThemesSet.has(val)) {
                            pool.push(val);
                        }
                    }
                    if (pool.length > 0) {
                        themeToApply = pool[Math.floor(Math.random() * pool.length)];
                    }
                }
            } catch (e) {
                console.error('[Theme Manager] 早期检测解析标签数据失败:', e);
            }
        } else {
            const cleanTarget = String(target).replace(/\s*\(\d+\)$/, '').trim();
            for (let i = 0; i < originalSelect.options.length; i++) {
                const optVal = originalSelect.options[i].value;
                if (optVal === target || optVal === cleanTarget || optVal.toLowerCase() === target.toLowerCase() || optVal.replace(/\s*\(\d+\)$/, '').trim() === cleanTarget) {
                    themeToApply = optVal;
                    break;
                }
            }
        }

        if (themeToApply) {
            const themeChanged = originalSelect.value !== themeToApply;
            if (themeChanged) {
                console.log(`[Theme Manager] 启动早期极速切换主题至: ${themeToApply}`);
                originalSelect.value = themeToApply;
                originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.jQuery) {
                    try { $(originalSelect).trigger('change'); } catch (e) {}
                }
            }

            // 延迟应用背景，避免阻塞渲染
            try {
                const bindings = JSON.parse(localStorage.getItem('themeManager_backgroundBindings')) || {};
                const boundBg = bindings[themeToApply];
                if (boundBg) {
                    setTimeout(() => {
                        applyBackgroundDirectly(boundBg);
                    }, 500);
                }
            } catch (e) {
                console.error('[Theme Manager] 早期检测应用背景图失败:', e);
            }
        }
    }

    // 早期轮询：一旦原生 select 可用且 SillyTavern 上下文已就绪，立即执行主题切换
    const earlyAutoThemeInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        if (originalSelect && window.SillyTavern?.getContext) {
            clearInterval(earlyAutoThemeInterval);
            if (!autoThemeApplied) {
                autoThemeApplied = true;
                try {
                    const settings = JSON.parse(localStorage.getItem('themeManager_autoTheme'));
                    applyEarlyAutoTheme(originalSelect, settings);
                } catch (e) {
                    console.error('[Theme Manager] 早期读取自动主题配置失败:', e);
                }
            }
        }
    }, 50);

    const initInterval = setInterval(async () => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v23.0 Final Stable): 初始化...");
            clearInterval(initInterval);
            autoThemeApplied = true; // 确保不重复触发早期检测

            try {
                const { getRequestHeaders, showLoader, hideLoader, callGenericPopup, eventSource, eventTypes } = SillyTavern.getContext();
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';
                const THEME_TAGS_KEY = 'themeManager_themeTags';
                const THEME_BACKGROUND_BINDINGS_KEY = 'themeManager_backgroundBindings';
                const CHARACTER_THEME_BINDINGS_KEY = 'themeManager_characterThemeBindings';
                const THEME_DAY_NIGHT_PAIRS_KEY = 'themeManager_themeDayNightPairs';
                const BATCH_EDIT_COLLAPSED_KEY = 'themeManager_batchEditCollapsed';
                const ACTIVE_TAGS_KEY = 'themeManager_activeTagsFilters';
                const AUTO_THEME_KEY = 'themeManager_autoTheme';
                const LIST_MODE_KEY = 'themeManager_listMode';
                const PAGE_SIZE_KEY = 'themeManager_pageSize';
                const SORT_SELECT_KEY = 'themeManager_sortSelect';
                const TAG_FILTER_MODE_KEY = 'themeManager_tagFilterMode';
                const ENABLE_SUBTAGS_KEY = 'themeManager_enableSubtags';
                const USAGE_COUNT_KEY = 'themeManager_usageCount';
                const SHOW_USAGE_COUNT_KEY = 'themeManager_showUsageCount';
                const ENABLE_AVATAR_HELPER_KEY = 'themeManager_enableAvatarHelper';
                const ENABLE_COLOR_TRANSFER_KEY = 'themeManager_enableColorTransfer';
                const ENABLE_DAYNIGHT_BINDING_KEY = 'themeManager_enableDayNightBinding';
                const ENABLE_REPLACE_AVATAR_BTN_KEY = 'themeManager_enableReplaceAvatarBtn';
                const TWO_LINE_LAYOUT_KEY = 'themeManager_twoLineLayout';
                const HIDE_TAG_PILLS_KEY = 'themeManager_hideTagPills';
                const TAG_PILL_MODE_KEY = 'themeManager_tagPillMode';

                let autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {
                    enabled: false,
                    enableManualToggle: false,
                    mode: 'system',
                    dayStart: '06:00',
                    nightStart: '18:00',
                    dayTarget: '',
                    nightTarget: ''
                };
                let isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
                let hideTagPills = localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true';
                let tagPillDisplayMode = localStorage.getItem(TAG_PILL_MODE_KEY) || (hideTagPills ? 'none' : 'all'); // 'all' | 'l1' | 'l2' | 'none'

                function closePopup(popup) {
                    if (!popup) return;
                    if (typeof popup.complete === 'function') {
                        popup.complete();
                    } else if (typeof popup.close === 'function') {
                        popup.close();
                    } else if (popup.dlg) {
                        const closeBtn = popup.dlg.querySelector('.popup-button-ok, .popup-button-cancel, .popup-close');
                        if (closeBtn) closeBtn.click();
                    }
                }

                let enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false'; // 默认开启 (true)
                let executeManualThemeToggle = () => {};
                let updateThemeItemDayNightState = () => {};
                let openDayNightPairModal = () => {};
                let applyAutoThemeLoop = () => {};
                let updateManualToggleBtnVisibility = () => {};
                let handleAutoThemeRenamed = () => {};
                let handleAutoThemeDeleted = () => {};
                let loadThemeDayNightPairs = () => [];
                let saveThemeDayNightPairs = () => {};
                let getPairForTheme = () => null;

                const THEME_MTIMES_KEY = 'theme_manager_theme_mtimes';

                function getThemeMtimes() {
                    try {
                        return JSON.parse(localStorage.getItem(THEME_MTIMES_KEY)) || {};
                    } catch (e) {
                        return {};
                    }
                }

                function saveThemeMtimes(mtimesMap) {
                    try {
                        localStorage.setItem(THEME_MTIMES_KEY, JSON.stringify(mtimesMap));
                    } catch (e) {}
                }

                function recordThemeMtime(themeName, timestamp = Date.now()) {
                    if (!themeName) return;
                    const mtimes = getThemeMtimes();
                    mtimes[themeName] = timestamp;
                    saveThemeMtimes(mtimes);
                }

                function removeThemeMtime(themeName) {
                    if (!themeName) return;
                    const mtimes = getThemeMtimes();
                    if (mtimes[themeName]) {
                        delete mtimes[themeName];
                        saveThemeMtimes(mtimes);
                    }
                }

                function renameThemeMtime(oldName, newName) {
                    if (!oldName || !newName) return;
                    const mtimes = getThemeMtimes();
                    const val = mtimes[oldName] || Date.now();
                    delete mtimes[oldName];
                    mtimes[newName] = val;
                    saveThemeMtimes(mtimes);
                }

                const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                const themeCoreModule = await import(`${baseDir}modules/theme-core.js`);
                const { getSolidRgbFromCssVar, getAdaptivePopoverBg, DEFAULT_THEME_PROPS, normalizeThemeObject } = themeCoreModule;



                function isSubtagsEnabled() {
                    return localStorage.getItem(ENABLE_SUBTAGS_KEY) === 'true';
                }


                let listMode = localStorage.getItem(LIST_MODE_KEY) || 'scroll';
                let pageSize = parseInt(localStorage.getItem(PAGE_SIZE_KEY)) || 50;
                let sortBy = localStorage.getItem(SORT_SELECT_KEY) || 'name-asc';
                let tagFilterMode = localStorage.getItem(TAG_FILTER_MODE_KEY) || 'or'; // 'or' | 'and'
                let usageCount = {};
                try {
                    const parsedUsage = JSON.parse(localStorage.getItem(USAGE_COUNT_KEY));
                    if (parsedUsage && typeof parsedUsage === 'object' && !Array.isArray(parsedUsage)) {
                        usageCount = parsedUsage;
                    }
                } catch (e) {
                    console.error('[Theme Manager] Failed to parse usageCount:', e);
                }
                let showUsageCount = localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true';
                let enableAvatarHelper = localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) !== 'false';
                let enableColorTransfer = localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true'; // 默认关闭 (false)
                let enableReplaceAvatarBtn = localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) !== 'false'; // 默认开启 (true)
                let currentPage = 1;

                let allParsedThemes = [];
                let allParsedThemesMap = new Map(); // themeName -> theme object for O(1) lookup
                let refreshNeeded = false;

                let isBindingMode = false;
                let themeNameToBind = null;
                let _bindingTimeout = null;
                let _bindingStartTime = 0;
                let themeBackgroundBindings = {};
                try {
                    themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};
                } catch (e) {
                    console.error('[Theme Manager] Failed to parse themeBackgroundBindings:', e);
                }

                let activeTagsData = [];
                try {
                    const parsedActiveTags = JSON.parse(localStorage.getItem(ACTIVE_TAGS_KEY));
                    if (Array.isArray(parsedActiveTags)) {
                        activeTagsData = parsedActiveTags;
                    } else if (parsedActiveTags && typeof parsedActiveTags === 'object') {
                        activeTagsData = Object.keys(parsedActiveTags).filter(k => parsedActiveTags[k]);
                    } else if (typeof parsedActiveTags === 'string') {
                        activeTagsData = [parsedActiveTags];
                    }
                } catch (e) {
                    console.error('[Theme Manager] Failed to parse activeTagFilters:', e);
                }
                let activeTagFilters = new Set(activeTagsData);
                let activeLevel1TagId = null;
                let editingThemeForTags = null;

                let _suspendObserver = false;
                let allThemeObjects = [];
                const themeCore = themeCoreModule.initThemeCore({
                    getRequestHeaders,
                    originalSelect,
                    recordThemeMtime,
                    allParsedThemesMap,
                    getThemeBackgroundBindings: () => themeBackgroundBindings,
                    applyBackgroundDirectly,
                    updateActiveState: () => updateActiveState(),
                    onObserverSuspendChange: (val) => { _suspendObserver = val; },
                    getAllThemeObjects: () => allThemeObjects
                });
                const {
                    getPowerUser,
                    allThemeObjectsMap,
                    stKnownThemes,
                    findThemeObject,
                    saveTheme,
                    deleteTheme,
                    apiRequest,
                    getAllThemesFromAPI,
                    getCachedThemes,
                    invalidateThemesCache,
                    triggerSelectChange,
                    deduplicateSelectOptions,
                    manualUpdateOriginalSelect,
                    syncStKnownThemes,
                    updateSTThemeMemory,
                    applyThemeDirect,
                    getValidInstalledThemeNames,
                    invalidateValidThemeNamesCache,
                    captureCurrentThemeSnapshot
                } = themeCore;

                const { createTagManager } = await import(`${baseDir}modules/tag-manager.js`);
                const tagManager = createTagManager({
                    getValidInstalledThemeNames,
                    getAllParsedThemes: () => allParsedThemes
                });
                const {
                    loadThemeTags,
                    saveThemeTags,
                    invalidateTagsCache,
                    buildThemeTagIndex,
                    invalidateThemeTagIndex,
                    getTagsForTheme,
                    refreshAllParsedThemesTags,
                    sanitizeTagsWithValidThemes,
                    sanitizeSubtagThemeAssociations
                } = tagManager;

                let applyKeywordMappings = () => false;
                let openAutoGroupWizard = () => {};
                let openAutoGroupBatchMatrix = () => {};
                let runAutoGroupReviewStep = () => {};
                let extractCandidateThemeGroups = () => [];


                // === 移动端/跨端通用确认弹窗助手 ===
                async function confirmAction(message, okText = '确认删除') {
                    if (typeof callGenericPopup === 'function') {
                        try {
                            const res = await callGenericPopup(`
                                <div style="text-align:center; padding:10px 5px;">
                                    <h3 style="margin:0 0 10px 0; color:var(--SmartThemeQuoteColor, #4a90e2);"><i class="fa-solid fa-triangle-exclamation" style="color:#ff8888; margin-right:6px;"></i>确认操作</h3>
                                    <p style="margin:0; font-size:14px; opacity:0.9;">${escapeHtml(message)}</p>
                                </div>
                            `, 2, null, {
                                okButton: okText,
                                cancelButton: '取消',
                                wide: false,
                                onOpen: (popup) => {
                                    const dlg = popup.dlg;
                                    if (dlg) {
                                        dlg.style.width = '90%';
                                        dlg.style.maxWidth = '380px';
                                    }
                                }
                            });
                            // callGenericPopup 返回 1 (POPUP_RESULT.AFFIRMATIVE) 即代表确认
                            return res === 1 || res === true || (res && res.result === 1);
                        } catch (e) {
                            console.warn('[Theme Manager] callGenericPopup 异常, 回退至 confirm:', e);
                        }
                    }
                    return confirm(message);
                }
                async function promptAction(message, defaultValue = '') {
                    if (typeof callGenericPopup === 'function') {
                        try {
                            const inputId = 'tm-prompt-input-' + Date.now();
                            let currentInputValue = defaultValue;
                            const res = await callGenericPopup(`
                                <div style="text-align:left; padding:5px;">
                                    <h3 style="margin:0 0 10px 0; color:var(--SmartThemeQuoteColor, #4a90e2); text-align:center;"><i class="fa-solid fa-pen" style="margin-right:6px;"></i>${escapeHtml(message)}</h3>
                                    <input type="text" id="${inputId}" class="text_pole wide100p" value="${escapeHtml(defaultValue)}" placeholder="请输入新名称" style="margin-top:6px; box-sizing:border-box;">
                                </div>
                            `, 2, null, {
                                okButton: '确认',
                                cancelButton: '取消',
                                wide: false,
                                onOpen: (popup) => {
                                    const dlg = popup.dlg;
                                    if (dlg) {
                                        dlg.style.width = '90%';
                                        dlg.style.maxWidth = '380px';
                                        const input = dlg.querySelector(`#${inputId}`);
                                        if (input) {
                                            input.addEventListener('input', (e) => {
                                                currentInputValue = e.target.value;
                                            });
                                            input.addEventListener('keydown', (e) => {
                                                if (e.key === 'Enter') {
                                                    currentInputValue = input.value;
                                                    const okBtn = dlg.querySelector('.popup_ok');
                                                    if (okBtn) okBtn.click();
                                                }
                                            });
                                            setTimeout(() => { input.focus(); input.select(); }, 100);
                                        }
                                    }
                                }
                            });
                            if (res === 1 || res === true || (res && res.result === 1)) {
                                return currentInputValue;
                            }
                            return null;
                        } catch (e) {
                            console.warn('[Theme Manager] callGenericPopup 异常, 回退至 prompt:', e);
                        }
                    }
                    return prompt(message, defaultValue);
                }

                // === 工具函数 ===
                function escapeHtml(str) {
                    const div = document.createElement('div');
                    div.appendChild(document.createTextNode(str));
                    return div.innerHTML;
                }

                function getScrollParent(node) {
                    if (node === null) return window;
                    if (node.scrollHeight > node.clientHeight) {
                        const overflowY = window.getComputedStyle(node).overflowY;
                        if (overflowY === 'auto' || overflowY === 'scroll') {
                            return node;
                        }
                    }
                    return getScrollParent(node.parentNode);
                }

                const _themeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
                function sortThemes(themes, sortBy) {
                    const sorted = [...themes];
                    if (sortBy === 'name-asc') {
                        sorted.sort((a, b) => _themeCollator.compare(a.display, b.display));
                    } else if (sortBy === 'name-desc') {
                        sorted.sort((a, b) => _themeCollator.compare(b.display, a.display));
                    } else if (sortBy === 'favorite-first') {
                        sorted.sort((a, b) => {
                            const aFav = favoritesSet.has(a.value);
                            const bFav = favoritesSet.has(b.value);
                            if (aFav && !bFav) return -1;
                            if (!aFav && bFav) return 1;
                            return _themeCollator.compare(a.display, b.display);
                        });
                    } else if (sortBy === 'time-desc') {
                        sorted.sort((a, b) => {
                            const diff = (b.mtime || 0) - (a.mtime || 0);
                            if (diff !== 0) return diff;
                            return _themeCollator.compare(a.display, b.display);
                        });
                    } else if (sortBy === 'time-asc') {
                        sorted.sort((a, b) => {
                            const diff = (a.mtime || 0) - (b.mtime || 0);
                            if (diff !== 0) return diff;
                            return _themeCollator.compare(a.display, b.display);
                        });
                    } else if (sortBy === 'usage-desc') {
                        sorted.sort((a, b) => {
                            const diff = (usageCount[b.value] || 0) - (usageCount[a.value] || 0);
                            if (diff !== 0) return diff;
                            return _themeCollator.compare(a.display, b.display);
                        });
                    } else if (sortBy === 'usage-asc') {
                        sorted.sort((a, b) => {
                            const diff = (usageCount[a.value] || 0) - (usageCount[b.value] || 0);
                            if (diff !== 0) return diff;
                            return _themeCollator.compare(a.display, b.display);
                        });
                    }
                    return sorted;
                }

                function findOptionByValue(selectEl, value) {
                    return Array.from(selectEl.options).find(opt => opt.value === value) || null;
                }

                // buildThemeUI 防抖
                let _buildThemeUITimer = null;
                function debouncedBuildThemeUI(delay = 200) {
                    clearTimeout(_buildThemeUITimer);
                    _buildThemeUITimer = setTimeout(() => buildThemeUI(), delay);
                }


                // 暴露出 API 供其他扩展联动使用
                window.themeManager = {
                    getTags: () => loadThemeTags(),
                    getThemeTags: (themeName) => getTagsForTheme(themeName),
                    onTagsChanged: (callback) => {
                        document.addEventListener('themeManager:tagsChanged', (event) => {
                            callback(event.detail);
                        });
                    },
                    applyBoundThemeForCharacter: (avatarName) => applyBoundThemeForCharacter(avatarName),
                    getCurrentTheme: () => originalSelect?.value || _activeThemeItem?.dataset?.value || (typeof getPowerUser === 'function' ? getPowerUser()?.theme : null) || '',
                    getCurrentThemeObject: () => {
                        const cur = originalSelect?.value || _activeThemeItem?.dataset?.value || (typeof getPowerUser === 'function' ? getPowerUser()?.theme : null) || '';
                        return cur ? allThemeObjectsMap.get(cur) : null;
                    },
                    getAllThemes: () => Array.from(allThemeObjectsMap.values()),
                    onThemeChanged: (callback) => {
                        document.addEventListener('themeManager:themeChanged', (event) => {
                            callback(event.detail);
                        });
                    }
                };

                const originalContainer = originalSelect.parentElement;
                if (!originalContainer) return;
                originalSelect.style.display = 'none';

                const managerPanel = document.createElement('div');
                managerPanel.id = 'theme-manager-panel';
                managerPanel.innerHTML = `
                    <div id="theme-manager-header">
                        <h4 style="display:flex; align-items:center; gap:6px;">
                            <span><i class="fa-solid fa-palette"></i> 主题美化管理</span>
                            <button id="tm-quick-manual-toggle-btn" style="display:none;" title="快捷切换日夜美化"><i class="fa-solid fa-circle-half-stroke"></i></button>
                        </h4>
                        <div id="native-buttons-container"></div>
                        <div id="theme-manager-toggle-icon" class="fa-solid fa-chevron-down"></div>
                    </div>
                    <div id="theme-manager-content">
                        <div id="theme-manager-refresh-notice" style="display:none; margin: 10px 0; padding: 10px; background-color: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 5px; text-align: center; color: var(--main-text-color);">
                            <i class="fa-solid fa-lightbulb"></i> <b>提示：</b>检测到文件变更（主题或背景图）。为确保所有更改完全生效，请在完成所有操作后
                            <a id="theme-manager-refresh-page-btn" style="color:var(--primary-color, #007bff); text-decoration:underline; cursor:pointer; font-weight:bold;">刷新页面</a>。
                        </div>
                        <div class="theme-manager-actions" data-mode="theme">
                            <div class="tm-button-row">
                                <input type="search" id="theme-search-box" placeholder="搜索主题... (支持 关键词A/关键词B 复合搜索)" title="支持复合搜索：&#10;• 斜杠//空格/逗号/|/分号：或匹配 (例: 播放器/玉殿春 或 黑金 白银)&#10;• + 或 AND：与匹配 (例: 黑金 + 360px)&#10;• - 或 !：排除匹配 (例: 黑金 -360px)">
                                <button id="random-theme-btn" class="menu_button" title="随机应用一个主题"><i class="fa-solid fa-dice"></i> 随机</button>
                                <button id="auto-theme-settings-btn" class="menu_button" title="自动主题切换设置"><i class="fa-solid fa-circle-half-stroke"></i> 自动</button>
                                <button id="toggle-more-actions-btn" class="menu_button" title="展开/收起更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                            </div>
                        </div>
                        <div id="more-actions-container" class="theme-manager-actions collapsed" data-mode="shared">
                            <div class="tm-button-row" style="margin-bottom: 5px; gap: 8px;">
                                <select id="tm-list-mode-select" class="text_pole" title="列表显示模式" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0;">
                                    <option value="scroll">上下滑动看全部</option>
                                    <option value="page">分页显示模式</option>
                                </select>
                                <select id="tm-page-size-select" class="text_pole" title="每页条数" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0; display: none;">
                                    <option value="30">每页 30 条</option>
                                    <option value="50">每页 50 条</option>
                                    <option value="100">每页 100 条</option>
                                    <option value="200">每页 200 条</option>
                                    <option value="500">每页 500 条</option>
                                </select>
                                <select id="tm-sort-select" class="text_pole" title="排序规则" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0;">
                                    <option value="name-asc">名称 A-Z</option>
                                    <option value="name-desc">名称 Z-A</option>
                                    <option value="favorite-first">收藏优先</option>
                                    <option value="time-desc">时间倒序</option>
                                    <option value="time-asc">时间正序</option>
                                    <option value="usage-desc">次数 多→少</option>
                                    <option value="usage-asc">次数 少→多</option>
                                </select>
                            </div>
                            <div class="tm-button-row">
                                <button id="batch-edit-btn" class="menu_button" title="进入/退出批量编辑模式"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
                                <button id="batch-import-btn" class="menu_button" title="从文件批量导入主题"><i class="fa-solid fa-folder-open"></i> 导入</button>
                                <button id="manage-tags-btn" class="menu_button" title="管理标签"><i class="fa-solid fa-tags"></i> 标签</button>
                                <button id="tm-auto-group-btn" class="menu_button" title="自动提取美化名中的共同词组并向导生成标签/分类"><i class="fa-solid fa-wand-magic-sparkles"></i> 分组</button>
                                <button id="tm-settings-btn" class="menu_button" title="插件高级设置"><i class="fa-solid fa-gear"></i> 设置</button>
                            </div>
                        </div>

                        <div id="batch-actions-bar" style="display:none;" data-mode="theme">
                            <button id="batch-select-all-btn" class="menu_button" title="全选当前列表中的所有美化"><i class="fa-solid fa-square-check"></i> 全选</button>
                            <button id="batch-select-range-btn" class="menu_button" title="连选：选中首尾勾选项之间的全部美化"><i class="fa-solid fa-list-check"></i> 连选</button>
                            <button id="batch-invert-select-btn" class="menu_button" title="反选当前列表中的美化"><i class="fa-solid fa-arrow-rotate-left"></i> 反选</button>
                            <button id="batch-add-tag-btn" class="menu_button"><i class="fa-solid fa-tags"></i> 加标签</button>
                            <button id="batch-remove-tag-btn" class="menu_button"><i class="fa-solid fa-tag"></i> 删标签</button>
                            <button id="batch-rename-btn" class="menu_button"><i class="fa-solid fa-i-cursor"></i> 重命名</button>
                            <button id="batch-delete-btn" class="menu_button"><i class="fa-solid fa-trash-can"></i> 删选中</button>
                        </div>
                        <div class="theme-tags-row" id="theme-tags-container"></div>
                        <div id="tm-pagination-bar-top" class="tm-pagination-bar" style="display:none; justify-content: center; align-items: center; gap: 8px; margin-top: 5px; margin-bottom: 5px; width: 100%;">
                            <button class="tm-first-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到最前"><i class="fa-solid fa-angles-left"></i></button>
                            <button class="tm-prev-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                            <span style="font-size: 12px; display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                                第 <input type="number" class="tm-page-input text_pole" style="width: 45px; text-align: center; height: 24px; padding: 0; margin: 0; font-size: 12px;" min="1" value="1"> 页 / 共 <span class="tm-total-pages-text">1</span> 页
                            </span>
                            <button class="tm-next-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
                            <button class="tm-last-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到最后"><i class="fa-solid fa-angles-right"></i></button>
                        </div>
                        <div class="theme-content"></div>
                        <div id="tm-pagination-bar-bottom" class="tm-pagination-bar" style="display:none; justify-content: center; align-items: center; gap: 8px; margin-top: 8px; margin-bottom: 5px; width: 100%;">
                            <button class="tm-first-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到最前"><i class="fa-solid fa-angles-left"></i></button>
                            <button class="tm-prev-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                            <span style="font-size: 12px; display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                                第 <input type="number" class="tm-page-input text_pole" style="width: 45px; text-align: center; height: 24px; padding: 0; margin: 0; font-size: 12px;" min="1" value="1"> 页 / 共 <span class="tm-total-pages-text">1</span> 页
                            </span>
                            <button class="tm-next-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
                            <button class="tm-last-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到最后"><i class="fa-solid fa-angles-right"></i></button>
                        </div>
                        <div id="auto-theme-modal" class="tm-modal" style="display:none;">
                            <div class="tm-modal-content">
                                <div class="tm-modal-header">
                                    <h3><i class="fa-solid fa-circle-half-stroke"></i> 自动主题切换</h3>
                                    <button id="close-auto-theme-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                                </div>
                                <div class="tm-modal-body">
                                    <label style="display:flex; align-items:center; gap:8px; width:100%; white-space:nowrap;">
                                        <input type="checkbox" id="auto-theme-enable" style="margin:0;"> 启用自动切换
                                    </label>
                                    <label style="display:flex; align-items:center; gap:8px; width:100%; white-space:nowrap; margin-top:6px;">
                                        <input type="checkbox" id="auto-theme-enable-manual" style="margin:0;"> 启用手动切换
                                    </label>
                                    <hr>
                                    <div>
                                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                                            <input type="radio" name="auto-theme-mode" value="system" style="margin:0;"> 跟随系统深色模式
                                        </label>
                                        <label style="display:flex; align-items:center; gap:8px;">
                                            <input type="radio" name="auto-theme-mode" value="time" style="margin:0;"> 固定时间段
                                        </label>
                                    </div>
                                    <div id="auto-theme-time-settings" class="tm-time-settings" style="display:none; margin-top:10px;">
                                        <label style="display:flex; flex-direction:column; gap:5px; margin-bottom:10px;">
                                            日间开始时间: <input type="time" id="auto-theme-day-start" value="06:00" class="text_pole">
                                        </label>
                                        <label style="display:flex; flex-direction:column; gap:5px;">
                                            夜间开始时间: <input type="time" id="auto-theme-night-start" value="18:00" class="text_pole">
                                        </label>
                                    </div>
                                    <hr>
                                    <div style="margin-top:10px;">
                                        <label><b>日间主题/标签 (全局浅色):</b></label>
                                        <select id="auto-theme-day-target" class="text_pole" style="width:100%; margin-bottom:10px;"></select>
                                        
                                        <label><b>夜间主题/标签 (全局深色):</b></label>
                                        <select id="auto-theme-night-target" class="text_pole" style="width:100%;"></select>
                                        <p style="font-size: 0.8em; opacity: 0.8; margin-top: 5px;">* 如果选择带有 <code>[Tag]</code> 的分类，将在该标签下随机挑选。</p>
                                    </div>
                                    <hr>
                                    <div style="margin-top:10px;">
                                        <label><b>按美化独立日夜组配置 (优先于全局):</b></label>
                                        <div id="tm-pairs-list-container" style="max-height: 140px; overflow-y: auto; font-size: 0.85em; margin-top: 5px; border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; padding: 6px;"></div>
                                    </div>
                                </div>
                                <div class="tm-modal-footer" style="display:flex; justify-content:center; padding-top:10px;">
                                    <button id="save-auto-theme-btn" class="menu_button" style="width:100%; justify-content:center;"><i class="fa-solid fa-check"></i> 保存设置</button>
                                </div>
                            </div>
                        </div>
                        <div id="tm-daynight-pair-modal" class="tm-modal" style="display:none;">
                            <div class="tm-modal-content">
                                <div class="tm-modal-header">
                                    <h3><i class="fa-solid fa-circle-half-stroke"></i> 美化日夜联动绑定</h3>
                                    <button id="close-tm-daynight-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                                </div>
                                <div class="tm-modal-body">
                                    <p style="margin-bottom:10px; font-weight:bold;">当前美化：<span id="tm-daynight-current-name" style="color:var(--SmartThemeEmColor);"></span></p>
                                    <label style="display:block; margin-bottom:10px;">
                                        <b>对应的夜间美化 (切换到夜间时):</b>
                                        <select id="tm-daynight-night-select" class="text_pole" style="width:100%; margin-top:4px;"></select>
                                    </label>
                                    <label style="display:block; margin-bottom:10px;">
                                        <b>对应的日间美化 (切换到日间时):</b>
                                        <select id="tm-daynight-day-select" class="text_pole" style="width:100%; margin-top:4px;"></select>
                                    </label>
                                    <p style="font-size:0.8em; opacity:0.8; margin-top:5px;">* 配置后，当在当前美化下触发日夜模式切换时，将优先切换至此处绑定的专属美化；无绑定时回退全局设置。</p>
                                </div>
                                <div class="tm-modal-footer" style="display:flex; gap:10px; justify-content:center; padding-top:10px;">
                                    <button id="save-tm-daynight-btn" class="menu_button" style="flex:1; justify-content:center;"><i class="fa-solid fa-check"></i> 保存绑定</button>
                                    <button id="clear-tm-daynight-btn" class="menu_button" style="flex:1; justify-content:center; color:#ff4d4f;"><i class="fa-solid fa-trash-can"></i> 解除绑定</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
                originalContainer.prepend(managerPanel);

                const nativeButtonsContainer = managerPanel.querySelector('#native-buttons-container');

                // === 彻底接管原生保存与另存为操作（断开原生可能并发冲突的监听器，统一走原子引擎） ===
                let cleanUpdateButton = updateButton;
                let cleanSaveAsButton = saveAsButton;
                try {
                    const clonedUpdate = updateButton.cloneNode(true);
                    const clonedSaveAs = saveAsButton.cloneNode(true);
                    if (updateButton.parentNode) updateButton.parentNode.replaceChild(clonedUpdate, updateButton);
                    if (saveAsButton.parentNode) saveAsButton.parentNode.replaceChild(clonedSaveAs, saveAsButton);
                    cleanUpdateButton = clonedUpdate;
                    cleanSaveAsButton = clonedSaveAs;
                } catch (e) {
                    console.warn('[Theme Manager] 按钮克隆隔离失败，降级直接绑定:', e);
                }

                nativeButtonsContainer.appendChild(cleanUpdateButton);
                nativeButtonsContainer.appendChild(cleanSaveAsButton);

                // 1. 深度接管“更新当前主题” (Update Theme)
                cleanUpdateButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const pu = typeof getPowerUser === 'function' ? getPowerUser() : null;
                    const currentThemeName = pu?.theme || originalSelect?.value || '';
                    if (!currentThemeName) {
                        toastr.warning('当前未选中任何主题，无法更新');
                        return;
                    }

                    showLoader();
                    try {
                        console.log(`[Theme Manager] 正在更新并固化当前主题: "${currentThemeName}"`);
                        const snapshot = captureCurrentThemeSnapshot(currentThemeName);

                        const ok = await saveTheme(snapshot);
                        if (!ok) throw new Error('保存主题写盘失败');

                        // 增量维护内存与 UI mtime
                        recordThemeMtime(currentThemeName);
                        const parsed = allParsedThemesMap.get(currentThemeName);
                        if (parsed) parsed.mtime = Date.now();

                        toastr.success(`主题「${currentThemeName}」已成功保存并更新！`);
                    } catch (err) {
                        console.error('[Theme Manager Error] 保存更新主题失败:', err);
                        toastr.error(`更新主题失败: ${err.message || err}`);
                    } finally {
                        hideLoader();
                    }
                });

                // 2. 深度接管“另存为新主题” (Save As New Theme)
                cleanSaveAsButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const pu = typeof getPowerUser === 'function' ? getPowerUser() : null;
                    const baseName = pu?.theme || originalSelect?.value || '新主题';
                    const suggestedName = `${baseName} (副本)`;

                    const inputName = await promptAction('请输入新美化主题名称：', suggestedName);
                    if (!inputName || !inputName.trim()) return;

                    const finalNewName = inputName.trim();

                    // 检查是否重名
                    if (allParsedThemesMap.has(finalNewName)) {
                        toastr.warning(`主题「${finalNewName}」已存在，请使用其他名称`);
                        return;
                    }

                    showLoader();
                    try {
                        console.log(`[Theme Manager] 正在另存为新主题: "${finalNewName}"`);
                        const snapshot = captureCurrentThemeSnapshot(finalNewName);

                        const ok = await saveTheme(snapshot);
                        if (!ok) throw new Error('保存主题写盘失败');

                        // 1. 原生 select 同步追加
                        manualUpdateOriginalSelect('add', null, finalNewName);

                        // 2. 更新内存索引
                        recordThemeMtime(finalNewName);
                        const newParsedObj = { value: finalNewName, display: finalNewName, tags: [], mtime: Date.now() };
                        allParsedThemes.push(newParsedObj);
                        allParsedThemesMap.set(finalNewName, newParsedObj);

                        // 3. 增量在 UI 列表中插入该卡片
                        const tagsMap = new Map((loadThemeTags() || []).map(t => [t.id, t]));
                        const newItem = createThemeItem(newParsedObj, tagsMap);
                        themeItemMap.set(finalNewName, newItem);
                        const listUl = contentWrapper.querySelector('.theme-list');
                        if (listUl) {
                            listUl.appendChild(newItem);
                        }

                        // 4. 立即极速应用新主题
                        applyThemeDirect(finalNewName);

                        toastr.success(`新主题「${finalNewName}」已成功创建并应用！`);
                    } catch (err) {
                        console.error('[Theme Manager Error] 另存为主题失败:', err);
                        toastr.error(`另存为主题失败: ${err.message || err}`);
                    } finally {
                        hideLoader();
                    }
                });

                const header = managerPanel.querySelector('#theme-manager-header');
                const content = managerPanel.querySelector('#theme-manager-content');
                const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');
                const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
                const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
                const contentWrapper = managerPanel.querySelector('.theme-content');
                if (contentWrapper) {
                    contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                    contentWrapper.classList.toggle('hide-tag-pills', hideTagPills);
                }
                const searchBox = managerPanel.querySelector('#theme-search-box');
                const randomBtn = managerPanel.querySelector('#random-theme-btn');
                const batchImportBtn = managerPanel.querySelector('#batch-import-btn');
                const manageTagsBtn = managerPanel.querySelector('#manage-tags-btn');
                const resetAllSystemBtn = managerPanel.querySelector('#tm-reset-all-system-btn');
                const listModeSelect = managerPanel.querySelector('#tm-list-mode-select');
                const pageSizeSelect = managerPanel.querySelector('#tm-page-size-select');
                const sortSelect = managerPanel.querySelector('#tm-sort-select');
                const paginationBars = managerPanel.querySelectorAll('.tm-pagination-bar');
                const firstPageBtns = managerPanel.querySelectorAll('.tm-first-page-btn');
                const prevPageBtns = managerPanel.querySelectorAll('.tm-prev-page-btn');
                const nextPageBtns = managerPanel.querySelectorAll('.tm-next-page-btn');
                const lastPageBtns = managerPanel.querySelectorAll('.tm-last-page-btn');
                const pageInputs = managerPanel.querySelectorAll('.tm-page-input');
                const totalPagesTexts = managerPanel.querySelectorAll('.tm-total-pages-text');



                const toggleMoreActionsBtn = managerPanel.querySelector('#toggle-more-actions-btn');
                const moreActionsContainer = managerPanel.querySelector('#more-actions-container');

                const refreshNotice = managerPanel.querySelector('#theme-manager-refresh-notice');
                const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
                refreshBtn.addEventListener('click', () => location.reload());

                function showRefreshNotification() {
                    if (!refreshNeeded) {
                        refreshNeeded = true;
                        refreshNotice.style.display = 'block';
                    }
                }

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = '.json';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);



                // VVVVVVVVVVVV 新增代码 VVVVVVVVVVVV -->
                const settingsFileInput = document.createElement('input');
                settingsFileInput.type = 'file';
                settingsFileInput.accept = '.json';
                settingsFileInput.style.display = 'none';
                document.body.appendChild(settingsFileInput);
                // ^^^^^^^^^^^^ 新增代码 ^^^^^^^^^^^^ -->

                let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                let favoritesSet = new Set(favorites);
                function updateFavorites(newFavorites) {
                    favorites = newFavorites;
                    favoritesSet = new Set(favorites);
                    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                }

                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let lastClickedThemeName = null;
                let touchTimer = null;
                let preventNextClick = false;
                let touchStartX = 0;
                let touchStartY = 0;
                themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};



                // 触摸设备检测：移动端跳过动画避免 scrollHeight 触发昂贵的同步布局
                const _isTouchDevice = window.matchMedia('(hover: none)').matches;

                function setCollapsed(isCollapsed, animate = false) {
                    // 移动端强制即时模式，避免 scrollHeight 引发 content-visibility 渲染风暴
                    if (_isTouchDevice) animate = false;

                    if (isCollapsed) {
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            requestAnimationFrame(() => {
                                content.style.maxHeight = '0px';
                                content.style.paddingTop = '0px';
                                content.style.paddingBottom = '0px';
                            });
                        } else {
                            content.style.maxHeight = '0px';
                            content.style.paddingTop = '0px';
                            content.style.paddingBottom = '0px';
                        }
                        toggleIcon.classList.add('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'true');
                    } else {
                        content.style.paddingTop = '';
                        content.style.paddingBottom = '';
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            setTimeout(() => { content.style.maxHeight = ''; }, 300);
                        } else {
                            content.style.maxHeight = '';
                        }
                        toggleIcon.classList.remove('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'false');
                    }
                }




                function isThemeListIdentical() {
                    const options = Array.from(originalSelect.options).filter(opt => opt.value);
                    if (allParsedThemes.length !== options.length) {
                        return false;
                    }
                    for (let i = 0; i < allParsedThemes.length; i++) {
                        if (allParsedThemes[i].value !== options[i].value) {
                            return false;
                        }
                    }
                    return true;
                }

                async function buildThemeUI() {
                    deduplicateSelectOptions(originalSelect);
                    const scrollTop = contentWrapper.scrollTop;

                    if (!contentWrapper.querySelector('.theme-list')) {
                        contentWrapper.innerHTML = '正在加载主题...';
                    }
                    try {
                        allThemeObjects = await getCachedThemes();
                        allThemeObjectsMap.clear();
                        allThemeObjects.forEach(t => {
                            const name = t.name || t.value;
                            if (name) allThemeObjectsMap.set(name, t);
                        });

                        // 🧹 严格以服务端 API 返回的真实磁盘文件列表为准，清理原生下拉框中已从磁盘删除的死选项节点
                        const serverThemeNames = new Set(Array.from(allThemeObjectsMap.keys()));
                        if (originalSelect && originalSelect.options) {
                            const pu = typeof getPowerUser === 'function' ? getPowerUser() : null;
                            const activeVal = pu?.theme || originalSelect.value || '';
                            const prevSuspend = _suspendObserver;
                            _suspendObserver = true;
                            try {
                                Array.from(originalSelect.options).forEach(opt => {
                                    if (opt.value && !serverThemeNames.has(opt.value)) {
                                        console.log(`[Theme Manager] 🧹 清理原生下拉框中的死选项: "${opt.value}"`);
                                        opt.remove();
                                    }
                                });
                                if (activeVal && serverThemeNames.has(activeVal) && originalSelect.value !== activeVal) {
                                    originalSelect.value = activeVal;
                                }
                            } finally {
                                _suspendObserver = prevSuspend;
                            }
                        }

                        // 如果主题列表未发生变化且现有 DOM 完好，直接更新 active 状态即可，避免昂贵的重建 DOM
                        if (allParsedThemes.length > 0 && isThemeListIdentical() && themeItemMap.size > 0 && contentWrapper.querySelector('.theme-list')) {
                            updateActiveState();
                            return;
                        }

                        contentWrapper.innerHTML = '';

                        // 缓存标签数据，避免在循环中反复 JSON.parse
                        const cachedTags = loadThemeTags();
                        // 构建反向索引，将 getTagsForTheme 从 O(tags*themes) 降为 O(1)
                        buildThemeTagIndex(cachedTags);

                        // 仅以服务器真实存在的主题数据对象构建 UI 列表，彻底隔离已被物理删除的残留项
                        const storedMtimes = getThemeMtimes();
                        let mtimesChanged = false;
                        const fallbackBaseTime = Date.now() - (allThemeObjects.length * 1000);

                        allParsedThemes = allThemeObjects.map((t, idx) => {
                            const themeName = t.name || t.value;
                            if (!themeName) return null;
                            let mtime = t.mtime || storedMtimes[themeName];
                            if (!mtime) {
                                mtime = fallbackBaseTime + (idx * 1000);
                                storedMtimes[themeName] = mtime;
                                mtimesChanged = true;
                            }
                            return { value: themeName, display: themeName, tags: [], mtime: mtime };
                        }).filter(Boolean);

                        if (mtimesChanged) {
                            saveThemeMtimes(storedMtimes);
                        }


                        // 刷新 Map 索引
                        allParsedThemesMap.clear();
                        allParsedThemes.forEach(t => allParsedThemesMap.set(t.value, t));

                        // 系统初始化时运行关键词自动映射（支持仅包含关键词的配置文件自动推导主题）
                        applyKeywordMappings();

                        // 重新加载并更新反向索引与 tag 关联
                        const updatedTags = loadThemeTags();
                        buildThemeTagIndex(updatedTags);
                        allParsedThemes.forEach(t => {
                            t.tags = getTagsForTheme(t.value, updatedTags);
                        });

                        renderTagsUI(updatedTags);
                        buildThemeListLazy(scrollTop);

                    } catch (err) {
                        contentWrapper.innerHTML = '加载主题失败，请检查浏览器控制台获取更多信息。';
                        console.error(err);
                    }
                }

                // === 强行重新对照磁盘并同步 ST 原生下拉框与全量 UI 缓存 (带同名重叠修复与自动落盘规范对齐) ===
                async function hardResyncThemes(showToast = true) {
                    console.log('[Theme Manager] 🔄 开始重新对照磁盘并全量同步...');
                    showLoader();
                    _suspendObserver = true;

                    try {
                        // 1. 清除扩展内存缓存
                        invalidateThemesCache();

                        // 2. 从后端直接全量重新拉取磁盘上的所有主题文件数据
                        let freshThemes = await getAllThemesFromAPI();

                        // 3. 规范化与同名冲突对齐（仅在发现同名冲突时才对冲突项重写落盘，避免数百次网络轰炸）
                        let fixedCount = 0;
                        const usedNames = new Set();
                        for (let i = 0; i < freshThemes.length; i++) {
                            const t = freshThemes[i];
                            if (!t || typeof t !== 'object') continue;
                            let origName = (t.name || t.value || '未命名主题').trim();

                            if (usedNames.has(origName)) {
                                let suffixIndex = 2;
                                let newUniqueName = `${origName} (${suffixIndex})`;
                                while (usedNames.has(newUniqueName)) {
                                    suffixIndex++;
                                    newUniqueName = `${origName} (${suffixIndex})`;
                                }
                                console.warn(`[Theme Manager Resync] ⚠️ 发现同名主题 "${origName}"，自动重命名对齐为 "${newUniqueName}"`);
                                t.name = newUniqueName;
                                t.value = newUniqueName;
                                origName = newUniqueName;
                                fixedCount++;

                                // 仅针对冲突重命名项执行规范化落盘
                                try {
                                    const cleanObj = normalizeThemeObject(t, origName);
                                    const { mtime: _m, ...payload } = cleanObj;
                                    await apiRequest('themes/save', 'POST', payload, true);
                                } catch (e) {
                                    console.warn('[Theme Manager Resync] 冲突项重新规范落盘提示:', e);
                                }
                            }
                            usedNames.add(origName);
                            // 纯净规范化内存对象
                            freshThemes[i] = normalizeThemeObject(t, origName);
                        }

                        if (fixedCount > 0) {
                            // 若有重名修复，再次刷新最新列表
                            invalidateThemesCache();
                            freshThemes = await getAllThemesFromAPI();
                        }

                        // 4. 全量更新 ST getContext / power_user 内存
                        const pu = typeof getPowerUser === 'function' ? getPowerUser() : null;
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx) ctx.themes = freshThemes;
                        }
                        if (pu) {
                            pu.themes = freshThemes;
                        }
                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            themes.length = 0;
                            themes.push(...freshThemes);
                        }

                        // 5. 重构原生 #themes 下拉框 (<select id="themes">)
                        const selectEl = originalSelect || document.querySelector('#themes');
                        if (selectEl) {
                            const currentVal = selectEl.value || pu?.theme || '';
                            const prevSuspend = _suspendObserver;
                            _suspendObserver = true;
                            try {
                                selectEl.innerHTML = '';
                                const existingNames = new Set();

                                freshThemes.forEach(t => {
                                    const name = t.name || t.value;
                                    if (!name || existingNames.has(name)) return;
                                    existingNames.add(name);

                                    const option = document.createElement('option');
                                    option.value = name;
                                    option.innerText = name;
                                    selectEl.appendChild(option);
                                });

                                // 还原之前的选中项，如果原选中项已被从磁盘删除，则落到第一项
                                if (currentVal && existingNames.has(currentVal)) {
                                    selectEl.value = currentVal;
                                    if (pu) pu.theme = currentVal;
                                } else if (pu?.theme && existingNames.has(pu.theme)) {
                                    selectEl.value = pu.theme;
                                } else if (freshThemes.length > 0) {
                                    const fallbackName = freshThemes[0].name || freshThemes[0].value;
                                    if (fallbackName) {
                                        applyThemeDirect(fallbackName);
                                    }
                                }
                            } finally {
                                _suspendObserver = prevSuspend;
                            }
                        }

                        // 6. 校验清理孤儿标签与收藏（剔除已被从磁盘删掉的主题名）
                        const validThemeNames = new Set(freshThemes.map(t => t.name || t.value).filter(Boolean));

                        favorites = favorites.filter(f => validThemeNames.has(f));
                        updateFavorites(favorites);

                        let tagsToUpdate = loadThemeTags();
                        let tagsChanged = false;
                        tagsToUpdate.forEach(tag => {
                            if (tag.themes && Array.isArray(tag.themes)) {
                                const beforeLen = tag.themes.length;
                                tag.themes = tag.themes.filter(t => validThemeNames.has(t));
                                if (tag.themes.length !== beforeLen) tagsChanged = true;
                            }
                        });
                        if (tagsChanged) saveThemeTags(tagsToUpdate);

                        // 7. 重建 DOM 与视口界面
                        allParsedThemes = [];
                        allParsedThemesMap.clear();
                        themeItemMap.clear();
                        if (contentWrapper) contentWrapper.innerHTML = '';

                        await buildThemeUI();

                        if (showToast) {
                            let msg = `已成功与磁盘对照同步！共读取并强制对齐 ${freshThemes.length} 个美化主题。`;
                            if (fixedCount > 0) msg += `（自动修复并重命名了 ${fixedCount} 个命名冲突）`;
                            toastr.success(msg);
                        }
                    } catch (err) {
                        console.error('[Theme Manager] 重新对照磁盘失败:', err);
                        toastr.error('对照磁盘发生异常，请查看控制台: ' + (err.message || err));
                    } finally {
                        hideLoader();
                        setTimeout(() => { _suspendObserver = false; }, 100);
                    }
                }

                // === 性能优化：主题项 DOM 缓存 ===
                // 所有主题项一次性构建并缓存到 Map 中，标签切换时只改 display 属性
                let themeItemMap = new Map(); // themeName -> HTMLElement
                let _themeItemTemplate = null;
                let _activeThemeItem = null; // O(1) 活跃项追踪，避免每次切换都 querySelectorAll 全量遍历

                // 懒加载/分块渲染相关变量和函数
                let filteredThemes = [];
                let renderedCount = 0;
                const CHUNK_SIZE = 35;

                function renderNextChunk() {
                    if (renderedCount >= filteredThemes.length) return;

                    const cachedTags = loadThemeTags();
                    const tagsMap = new Map(cachedTags.map(t => [t.id, t]));
                    const list = contentWrapper.querySelector('.theme-list');
                    if (!list) return;

                    const fragment = document.createDocumentFragment();
                    const nextIndex = Math.min(renderedCount + CHUNK_SIZE, filteredThemes.length);

                    for (let i = renderedCount; i < nextIndex; i++) {
                        const theme = filteredThemes[i];
                        const item = createThemeItem(theme, tagsMap);
                        themeItemMap.set(theme.value, item);

                        // 初始化时设置 active 类
                        if (theme.value === originalSelect.value) {
                            item.classList.add('active');
                            _activeThemeItem = item;
                        }

                        fragment.appendChild(item);
                    }

                    list.appendChild(fragment);
                    renderedCount = nextIndex;
                }

                function isTagPillVisible(tagObj, themeTagIds, tagMode, tagsById) {
                    if (tagMode === 'none') return false;
                    const isSub = !!(tagObj.parentId && tagsById.has(tagObj.parentId));
                    if (tagMode === 'l1') return !isSub;
                    if (tagMode === 'l2' || tagMode === 'sub') return isSub;
                    if (tagMode === 'leaf') {
                        return !themeTagIds.some(otherId => {
                            if (otherId === tagObj.id) return false;
                            const otherTag = tagsById.get(otherId);
                            return otherTag && otherTag.parentId === tagObj.id;
                        });
                    }
                    return true;
                }

                function checkScrollLoad() {
                    if (listMode !== 'scroll') return;
                    if (renderedCount >= filteredThemes.length) return;

                    const rect = contentWrapper.getBoundingClientRect();
                    const scrollParent = getScrollParent(contentWrapper);
                    let isNearBottom = false;

                    if (scrollParent === window) {
                        isNearBottom = rect.bottom - window.innerHeight < 150;
                    } else {
                        const parentRect = scrollParent.getBoundingClientRect();
                        isNearBottom = rect.bottom - parentRect.bottom < 150;
                    }

                    if (isNearBottom) {
                        renderNextChunk();
                        setTimeout(checkScrollLoad, 100);
                    }
                }

                let scrollListenerAttached = false;
                function initListScrollListener() {
                    if (scrollListenerAttached) return;
                    const scrollParent = getScrollParent(contentWrapper);
                    if (scrollParent) {
                        scrollParent.addEventListener('scroll', () => {
                            if (listMode !== 'scroll') return;
                            
                            // Check if the bottom of contentWrapper is near the bottom of scrollParent
                            const rect = contentWrapper.getBoundingClientRect();
                            let isNearBottom = false;
                            
                            if (scrollParent === window) {
                                isNearBottom = rect.bottom - window.innerHeight < 150;
                            } else {
                                const parentRect = scrollParent.getBoundingClientRect();
                                isNearBottom = rect.bottom - parentRect.bottom < 150;
                            }
                            
                            if (isNearBottom) {
                                renderNextChunk();
                            }
                        }, { passive: true });
                        scrollListenerAttached = true;
                    }
                }

                // 创建可复用的主题项模板（只执行一次 innerHTML 解析）
                function getThemeItemTemplate() {
                    if (_themeItemTemplate) return _themeItemTemplate;
                    const tpl = document.createElement('li');
                    tpl.className = 'theme-item';
                    tpl.innerHTML = `
                        <div class="theme-item-name">
                            <span class="theme-item-name-text"></span><span class="theme-usage-count" style="display:none;"></span>
                        </div>
                        <div class="theme-item-buttons">
                            <button class="set-tag-btn" title="分类标签"><i class="fa-solid fa-tags"></i></button>
                            <button class="link-bg-btn" title="关联背景图"><i class="fa-solid fa-link"></i></button>
                            <button class="link-daynight-btn" title="绑定日夜美化"><i class="fa-solid fa-circle-half-stroke"></i></button>
                            <button class="favorite-btn" title="收藏"><i class="fa-regular fa-star"></i></button>
                            <button class="color-transfer-btn" title="提取配色" style="display:none;"><i class="fa-solid fa-palette"></i></button>
                            <button class="rename-btn" title="重命名"><i class="fa-solid fa-pen"></i></button>
                            <button class="delete-btn" title="删除"><i class="fa-solid fa-trash-can"></i></button>
                        </div>`;
                    _themeItemTemplate = tpl;
                    return tpl;
                }

                // 用模板构建单个主题项（cloneNode 比 innerHTML 快得多，用直系子元素 children 索引消除 querySelector 开销）
                function createThemeItem(theme, tagsMap) {
                    const item = getThemeItemTemplate().cloneNode(true);
                    item.dataset.value = theme.value;

                    const nameDiv = item.children[0];
                    const nameSpan = nameDiv.children[0];
                    const usageSpan = nameDiv.children[1]; // .theme-usage-count
                    const buttonsDiv = item.children[1]; // item level: nameDiv=0, buttonsDiv=1
                    const setTagBtn = buttonsDiv.children[0];
                    const linkBgBtn = buttonsDiv.children[1];
                    const linkDaynightBtn = buttonsDiv.children[2];
                    const favoriteBtn = buttonsDiv.children[3];
                    const colorTransferBtn = buttonsDiv.children[4];
                    const renameBtn = buttonsDiv.children[5];
                    const deleteBtn = buttonsDiv.children[6];

                    if (colorTransferBtn) {
                        colorTransferBtn.style.display = enableColorTransfer ? 'inline-flex' : 'none';
                    }

                    // 设置主题名
                    nameSpan.textContent = theme.display;

                    // 设置使用次数
                    if (showUsageCount && usageCount[theme.value]) {
                        usageSpan.textContent = usageCount[theme.value];
                        usageSpan.style.display = '';
                    } else {
                        usageSpan.style.display = 'none';
                    }

                    // 设置标签药丸 (N 级显示范围支持)
                    if (theme.tags && theme.tags.length > 0 && tagPillDisplayMode !== 'none') {
                        const tagsDiv = document.createElement('div');
                        tagsDiv.className = 'theme-item-tags';
                        theme.tags.forEach(tagId => {
                            const tagObj = tagsMap.get(tagId);
                            if (tagObj && isTagPillVisible(tagObj, theme.tags, tagPillDisplayMode, tagsMap)) {
                                const pill = document.createElement('span');
                                pill.className = 'theme-item-tag-pill';
                                pill.textContent = tagObj.name;
                                tagsDiv.appendChild(pill);
                            }
                        });
                        if (tagsDiv.children.length > 0) {
                            item.insertBefore(tagsDiv, buttonsDiv);
                        }
                    }

                    // 设置收藏状态
                    const isFavorited = favoritesSet.has(theme.value);
                    if (isFavorited) {
                        favoriteBtn.children[0].className = 'fa-solid fa-star';
                    }

                    // 设置背景绑定状态
                    const isBound = !!themeBackgroundBindings[theme.value];
                    if (isBound) {
                        linkBgBtn.classList.add('linked');
                        linkBgBtn.children[0].className = 'fa-solid fa-link-slash';
                        linkBgBtn.title = '取消背景图关联';
                    }

                    if (linkDaynightBtn) {
                        linkDaynightBtn.style.display = enableDayNightBinding ? 'inline-flex' : 'none';
                    }

                    // 设置日夜美化绑定状态
                    const pair = getPairForTheme(theme.value);
                    if (pair) {
                        linkDaynightBtn.classList.add('daynight-linked');
                        const otherTheme = pair.dayTheme === theme.value ? pair.nightTheme : pair.dayTheme;
                        linkDaynightBtn.title = `已绑定日夜组合 (对应美化: ${otherTheme || '未指定'})`;
                    } else {
                        linkDaynightBtn.classList.remove('daynight-linked');
                        linkDaynightBtn.title = '绑定日夜美化';
                    }

                    // 批量选中状态
                    if (isBatchEditMode && selectedForBatch.has(theme.value)) {
                        item.classList.add('selected-for-batch');
                    }

                    return item;
                }

                // === 高性能预编译复合搜索条件（单次解析，循环内千次免正则极速比对） ===
                function compileSearchFilter(rawSearch) {
                    if (!rawSearch || typeof rawSearch !== 'string') return null;
                    const raw = rawSearch.trim();
                    if (!raw) return null;

                    const andParts = (raw.includes('+') || /\bAND\b/i.test(raw) || raw.includes('&&'))
                        ? raw.split(/\+|\bAND\b|&&/i).map(s => s.trim()).filter(Boolean)
                        : [raw];

                    const compiledGroups = andParts.map(part => {
                        const tokens = part.split(/[\s,，\|/／\\;；·]|\bOR\b/i).map(s => s.trim()).filter(Boolean);
                        const positiveTerms = [];
                        const negativeTerms = [];
                        for (let i = 0; i < tokens.length; i++) {
                            const token = tokens[i];
                            if (token.startsWith('-') && token.length > 1) {
                                negativeTerms.push(token.slice(1).toLowerCase());
                            } else if (token.startsWith('!') && token.length > 1) {
                                negativeTerms.push(token.slice(1).toLowerCase());
                            } else if (token.toLowerCase().startsWith('not ') && token.length > 4) {
                                negativeTerms.push(token.slice(4).trim().toLowerCase());
                            } else {
                                positiveTerms.push(token.toLowerCase());
                            }
                        }
                        return { positiveTerms, negativeTerms };
                    });

                    return function testTargetText(targetTextLC) {
                        for (let g = 0; g < compiledGroups.length; g++) {
                            const { positiveTerms, negativeTerms } = compiledGroups[g];
                            for (let i = 0; i < negativeTerms.length; i++) {
                                if (targetTextLC.includes(negativeTerms[i])) return false;
                            }
                            if (positiveTerms.length > 0) {
                                let anyMatched = false;
                                for (let i = 0; i < positiveTerms.length; i++) {
                                    if (targetTextLC.includes(positiveTerms[i])) {
                                        anyMatched = true;
                                        break;
                                    }
                                }
                                if (!anyMatched) return false;
                            }
                        }
                        return true;
                    };
                }

                // === 高性能预编译标签筛选器（将树遍历与 tags 扫描移出 filter 循环，O(N) 极速匹配） ===
                function compileTagFilterContext(tags) {
                    if (!activeTagFilters || activeTagFilters.size === 0) return null;
                    const tagMap = new Map(tags.map(t => [t.id, t]));
                    const isAnd = tagFilterMode === 'and';

                    const checkers = [];
                    for (const tagId of activeTagFilters) {
                        if (tagId === '__FAVORITES__') {
                            checkers.push(theme => favoritesSet.has(theme.value));
                        } else if (tagId === '__UNCATEGORIZED__') {
                            checkers.push((theme, themeTags) => !themeTags || themeTags.length === 0);
                        } else if (typeof tagId === 'string' && tagId.startsWith('__SUB_UNCATEGORIZED__:')) {
                            const l1Id = tagId.split(':')[1];
                            const l1Tag = tagMap.get(l1Id);
                            const l1ThemesSet = new Set(l1Tag && l1Tag.themes ? l1Tag.themes : []);
                            const childTagIdsSet = new Set(tags.filter(t => t.parentId === l1Id).map(t => t.id));
                            checkers.push((theme, themeTags) => {
                                const belongsToL1 = (themeTags && themeTags.includes(l1Id)) || l1ThemesSet.has(theme.value);
                                const hasChildTag = themeTags && themeTags.some(tId => childTagIdsSet.has(tId));
                                return belongsToL1 && !hasChildTag;
                            });
                        } else {
                            const allIdsSet = new Set(getAllDescendantTagIds(tagId, tags));
                            checkers.push((theme, themeTags) => {
                                if (!themeTags || themeTags.length === 0) return false;
                                for (let i = 0; i < themeTags.length; i++) {
                                    if (allIdsSet.has(themeTags[i])) return true;
                                }
                                return false;
                            });
                        }
                    }

                    return function testTheme(theme, themeTags) {
                        if (isAnd) {
                            for (let i = 0; i < checkers.length; i++) {
                                if (!checkers[i](theme, themeTags)) return false;
                            }
                            return true;
                        } else {
                            for (let i = 0; i < checkers.length; i++) {
                                if (checkers[i](theme, themeTags)) return true;
                            }
                            return false;
                        }
                    };
                }

                // 首次构建：创建所有主题 DOM 节点并缓存
                function buildThemeListLazy(scrollTop) {
                    const savedScroll = scrollTop !== undefined ? scrollTop : contentWrapper.scrollTop;

                    // 清空旧缓存和旧列表
                    themeItemMap.clear();
                    _activeThemeItem = null;
                    const oldList = contentWrapper.querySelector('.theme-list');
                    if (oldList) oldList.remove();

                    const list = document.createElement('ul');
                    list.className = 'theme-list';
                    contentWrapper.appendChild(list);

                    // 预计算筛选集合用于首次显示 (复合搜索支持与极速预编译)
                    const rawSearch = searchBox ? searchBox.value : '';
                    const cachedTags = loadThemeTags();
                    const tagsMap = new Map(cachedTags.map(t => [t.id, t]));
                    const tagFilterFn = compileTagFilterContext(cachedTags);
                    const searchFilterFn = compileSearchFilter(rawSearch);

                    const matched = allParsedThemes.filter(theme => {
                        const themeTags = (theme && theme.tags && theme.tags.length > 0)
                            ? theme.tags
                            : getTagsForTheme(theme.value, cachedTags);
                        if (tagFilterFn && !tagFilterFn(theme, themeTags)) return false;
                        if (searchFilterFn) {
                            let targetText = (theme.display || '') + ' ' + (theme.value || '');
                            if (themeTags && themeTags.length > 0) {
                                for (let i = 0; i < themeTags.length; i++) {
                                    const tagObj = tagsMap.get(themeTags[i]);
                                    if (tagObj && tagObj.name) targetText += ' ' + tagObj.name;
                                }
                            }
                            if (!searchFilterFn(targetText.toLowerCase())) return false;
                        }
                        return true;
                    });

                    // 2. 排序
                    filteredThemes = sortThemes(matched, sortBy);

                    paginationBars.forEach(bar => {
                        bar.style.display = listMode === 'page' ? 'flex' : 'none';
                    });

                    if (listMode === 'page') {
                        // 分页显示模式
                        const totalPages = Math.ceil(filteredThemes.length / pageSize) || 1;
                        if (currentPage > totalPages) currentPage = totalPages;
                        if (currentPage < 1) currentPage = 1;

                        totalPagesTexts.forEach(el => el.textContent = String(totalPages));
                        pageInputs.forEach(el => {
                            el.value = String(currentPage);
                            el.max = String(totalPages);
                        });

                        firstPageBtns.forEach(btn => btn.disabled = currentPage <= 1);
                        prevPageBtns.forEach(btn => btn.disabled = currentPage <= 1);
                        nextPageBtns.forEach(btn => btn.disabled = currentPage >= totalPages);
                        lastPageBtns.forEach(btn => btn.disabled = currentPage >= totalPages);

                        const startIndex = (currentPage - 1) * pageSize;
                        const endIndex = Math.min(startIndex + pageSize, filteredThemes.length);
                        const pageThemes = filteredThemes.slice(startIndex, endIndex);

                        const tags = loadThemeTags();
                        const tagsMap = new Map(tags.map(t => [t.id, t]));
                        const fragment = document.createDocumentFragment();

                        pageThemes.forEach(theme => {
                            const item = createThemeItem(theme, tagsMap);
                            themeItemMap.set(theme.value, item);

                            if (theme.value === originalSelect.value) {
                                item.classList.add('active');
                                _activeThemeItem = item;
                            }

                            fragment.appendChild(item);
                        });

                        list.appendChild(fragment);
                        contentWrapper.scrollTop = savedScroll;
                        updateActiveState();
                    } else {
                        // 滚动加载模式
                        renderedCount = 0;
                        renderNextChunk();

                        contentWrapper.scrollTop = savedScroll;
                        updateActiveState();

                        // 延时检测，确保如果首屏没有撑满则继续自动加载下一页
                        setTimeout(checkScrollLoad, 100);
                        initListScrollListener();
                    }
                }

                // 获取指定标签及其在 N 级体系下的所有子孙标签 ID 列表 (BFS 递归搜寻)
                function getAllDescendantTagIds(tagId, tags) {
                    if (!isSubtagsEnabled()) return [tagId];
                    const result = [tagId];
                    const queue = [tagId];
                    while (queue.length > 0) {
                        const currId = queue.shift();
                        for (let i = 0; i < tags.length; i++) {
                            if (tags[i].parentId === currId) {
                                result.push(tags[i].id);
                                queue.push(tags[i].id);
                            }
                        }
                    }
                    return result;
                }

                // 判断主题是否匹配当前标签筛选 (N 级多层级支持)
                function isThemeMatchingFilters(theme) {
                    if (activeTagFilters.size === 0) return true;
                    const tags = loadThemeTags();
                    const themeTags = (theme && theme.tags && theme.tags.length > 0)
                        ? theme.tags
                        : getTagsForTheme(theme.value, tags);

                    if (tagFilterMode === 'and') {
                        // AND 模式：主题必须同时满足所有已选标签
                        for (const tagId of activeTagFilters) {
                            let matched = false;
                            if (tagId === '__FAVORITES__' && favoritesSet.has(theme.value)) matched = true;
                            if (tagId === '__UNCATEGORIZED__' && (!themeTags || themeTags.length === 0)) matched = true;
                            if (typeof tagId === 'string' && tagId.startsWith('__SUB_UNCATEGORIZED__:')) {
                                const l1Id = tagId.split(':')[1];
                                const l1Tag = tags.find(t => t.id === l1Id);
                                const l1Themes = l1Tag && l1Tag.themes ? l1Tag.themes : [];
                                const childTagIds = tags.filter(t => t.parentId === l1Id).map(t => t.id);
                                const belongsToL1 = (themeTags && themeTags.includes(l1Id)) || l1Themes.includes(theme.value);
                                const hasChildTag = themeTags && themeTags.some(tId => childTagIds.includes(tId));
                                if (belongsToL1 && !hasChildTag) matched = true;
                            } else if (themeTags) {
                                const targetIds = getAllDescendantTagIds(tagId, tags);
                                if (themeTags.some(tId => targetIds.includes(tId))) matched = true;
                            }
                            if (!matched) return false;
                        }
                        return true;
                    }
                    // OR 模式（默认）：匹配任意标签即可
                    for (const tagId of activeTagFilters) {
                        if (tagId === '__FAVORITES__' && favoritesSet.has(theme.value)) return true;
                        if (tagId === '__UNCATEGORIZED__' && (!themeTags || themeTags.length === 0)) return true;
                        if (typeof tagId === 'string' && tagId.startsWith('__SUB_UNCATEGORIZED__:')) {
                            const l1Id = tagId.split(':')[1];
                            const l1Tag = tags.find(t => t.id === l1Id);
                            const l1Themes = l1Tag && l1Tag.themes ? l1Tag.themes : [];
                            const childTagIds = tags.filter(t => t.parentId === l1Id).map(t => t.id);
                            const belongsToL1 = (themeTags && themeTags.includes(l1Id)) || l1Themes.includes(theme.value);
                            const hasChildTag = themeTags && themeTags.some(tId => childTagIds.includes(tId));
                            if (belongsToL1 && !hasChildTag) return true;
                        } else if (themeTags) {
                            const targetIds = getAllDescendantTagIds(tagId, tags);
                            if (themeTags.some(tId => targetIds.includes(tId))) return true;
                        }
                    }
                    return false;
                }

                // 轻量级筛选：使用懒加载重新构建列表
                function filterThemeList(scrollTop) {
                    buildThemeListLazy(scrollTop);
                }

                // 快速更新标签芯片的 active 状态（纯 CSS 切换，不重建 DOM）
                function updateTagChipsActiveState() {
                    const container = managerPanel.querySelector('#theme-tags-container');
                    const subtagsContainer = managerPanel.querySelector('#theme-subtags-container');
                    const cachedTags = loadThemeTags();
                    if (!container) return;

                    container.querySelectorAll('.theme-tag-chip').forEach(chip => {
                        const tagId = chip.dataset.tagId;
                        if (tagId) {
                            const isL1 = chip.classList.contains('level1');
                            if (isL1) {
                                const childIds = isSubtagsEnabled() ? cachedTags.filter(t => t.parentId === tagId).map(t => t.id) : [];
                                const hasActiveChild = childIds.some(cId => activeTagFilters.has(cId));
                                const hasSubUncat = activeTagFilters.has(`__SUB_UNCATEGORIZED__:${tagId}`);
                                const isL1Active = activeLevel1TagId === tagId;
                                const isDirectActive = activeTagFilters.has(tagId);

                                chip.classList.toggle('active', isDirectActive || isL1Active || hasActiveChild || hasSubUncat);
                            } else {
                                chip.classList.toggle('active', activeTagFilters.has(tagId));
                            }
                        } else if (chip.dataset.special === 'favorites') {
                            chip.classList.toggle('active', activeTagFilters.has('__FAVORITES__'));
                        } else if (chip.dataset.special === 'uncategorized') {
                            chip.classList.toggle('active', activeTagFilters.has('__UNCATEGORIZED__'));
                        } else if (chip.dataset.special === 'all') {
                            chip.classList.toggle('active', activeTagFilters.size === 0);
                        }
                    });

                    if (subtagsContainer) {
                        subtagsContainer.querySelectorAll('.theme-tag-chip').forEach(chip => {
                            const tagId = chip.dataset.tagId;
                            if (tagId) {
                                chip.classList.toggle('active', activeTagFilters.has(tagId));
                            } else if (chip.dataset.special === 'sub-uncategorized') {
                                const subUncatKey = `__SUB_UNCATEGORIZED__:${activeLevel1TagId}`;
                                chip.classList.toggle('active', activeTagFilters.has(subUncatKey));
                            }
                        });
                    }

                    // 同步更新筛选模式图标
                    const modeBtn = container.querySelector('.tm-filter-mode-btn');
                    if (modeBtn) {
                        modeBtn.title = tagFilterMode === 'and' ? '当前：AND 交叉筛选（点击切换为 OR 模式）' : '当前：OR 任意筛选（点击切换为 AND 模式）';
                        modeBtn.innerHTML = tagFilterMode === 'and'
                            ? '<i class="fa-solid fa-layer-group"></i>'
                            : '<i class="fa-solid fa-circle-nodes"></i>';
                        modeBtn.classList.toggle('active', tagFilterMode === 'and');
                    }
                }

                // 标签筛选切换的轻量级处理函数
                function handleTagFilterChange() {
                    localStorage.setItem(ACTIVE_TAGS_KEY, JSON.stringify(Array.from(activeTagFilters)));
                    updateTagChipsActiveState();
                    currentPage = 1;
                    filterThemeList(0); // 筛选切换时滚动回顶部
                }

                // === 新增：轻量级更新标签和界面，不重建 DOM ===
                // changedThemeNames: 若指定，则只更新这些主题的标签 pill（精准更新 O(k)）；传 null 则更新全部（O(N)）
                function softRefreshUI(changedThemeNames = null) {
                    const cachedTags = loadThemeTags();
                    buildThemeTagIndex(cachedTags);

                    // 1. 极致性能优化：若受影响主题集合为空（如刚新建一个空标签），仅更新顶部标签栏，直接 0ms 返回！
                    if (Array.isArray(changedThemeNames) && changedThemeNames.length === 0) {
                        renderTagsUI(cachedTags);
                        updateTagChipsActiveState();
                        return;
                    }

                    const tagsById = new Map(cachedTags.map(t => [t.id, t])); // O(1) 标签查找，避免内层循环 Array.find

                    // 同步 allParsedThemes 的标签数据（精准 or 全量）
                    if (changedThemeNames) {
                        changedThemeNames.forEach(name => {
                            const theme = allParsedThemesMap.get(name);
                            if (theme) theme.tags = getTagsForTheme(name, cachedTags);
                        });
                    } else {
                        allParsedThemes.forEach(theme => {
                            theme.tags = getTagsForTheme(theme.value, cachedTags);
                        });
                    }

                    // 更新顶部的标签过滤按钮
                    renderTagsUI(cachedTags);
                    updateTagChipsActiveState();

                    // 只更新受影响的主题项内部的标签 DOM，不销毁重建每个主题项
                    const itemsToUpdate = changedThemeNames
                        ? changedThemeNames.map(n => [n, themeItemMap.get(n)]).filter(([, item]) => item)
                        : [...themeItemMap.entries()];

                    for (const [themeName, item] of itemsToUpdate) {
                        const theme = allParsedThemesMap.get(themeName);
                        if (!theme) continue;

                        // 移除旧标签
                        const oldTagsDiv = item.querySelector('.theme-item-tags');
                        if (oldTagsDiv) oldTagsDiv.remove();

                        // 添加新标签
                        if (theme.tags && theme.tags.length > 0 && tagPillDisplayMode !== 'none') {
                            const tagsDiv = document.createElement('div');
                            tagsDiv.className = 'theme-item-tags';
                            theme.tags.forEach(tagId => {
                                const tagObj = tagsById.get(tagId); // O(1) 查找
                                if (tagObj && isTagPillVisible(tagObj, theme.tags, tagPillDisplayMode, tagsById)) {
                                    const pill = document.createElement('span');
                                    pill.className = 'theme-item-tag-pill';
                                    pill.textContent = tagObj.name;
                                    tagsDiv.appendChild(pill);
                                }
                            });
                            if (tagsDiv.children.length > 0) {
                                const buttonsDiv = item.querySelector('.theme-item-buttons');
                                if (buttonsDiv) {
                                    item.insertBefore(tagsDiv, buttonsDiv);
                                } else {
                                    item.appendChild(tagsDiv);
                                }
                            }
                        }
                    }

                    filterThemeList();
                }

                // === 增量无缝更新 DOM 节点与内存 UI 助手函数 ===
                function softAddThemeUI(themeObject, cachedTags = null, parentContainer = null) {
                    if (!themeObject || !themeObject.name) return null;
                    const themeName = themeObject.name;
                    const now = Date.now();
                    recordThemeMtime(themeName, now);
                    const currentTags = cachedTags || loadThemeTags();
                    const tags = getTagsForTheme(themeName, currentTags);
                    const parsedTheme = {
                        value: themeName,
                        display: themeName,
                        tags: tags,
                        data: themeObject,
                        mtime: now
                    };

                    const existingParsedIdx = allParsedThemes.findIndex(t => t.value === themeName);
                    if (existingParsedIdx > -1) {
                        allParsedThemes[existingParsedIdx] = parsedTheme;
                    } else {
                        allParsedThemes.push(parsedTheme);
                    }
                    allParsedThemesMap.set(themeName, parsedTheme);

                    const existingObjIdx = allThemeObjects.findIndex(t => (t.name === themeName || t.value === themeName));
                    if (existingObjIdx > -1) {
                        allThemeObjects[existingObjIdx] = themeObject;
                    } else {
                        allThemeObjects.push(themeObject);
                    }
                    allThemeObjectsMap.set(themeName, themeObject);
                    stKnownThemes.add(themeName);

                    const tagsMap = new Map(currentTags.map(t => [t.id, t]));
                    const item = createThemeItem(parsedTheme, tagsMap);

                    const oldItem = themeItemMap.get(themeName);
                    if (oldItem) oldItem.remove();

                    themeItemMap.set(themeName, item);

                    if (parentContainer) {
                        parentContainer.appendChild(item);
                    } else {
                        filterThemeList(0);
                    }
                    return item;
                }


                function softDeleteThemeUI(themeName) {
                    if (!themeName) return;
                    removeThemeMtime(themeName);
                    const item = themeItemMap.get(themeName);
                    if (item) {
                        item.remove();
                        themeItemMap.delete(themeName);
                    }

                    const idx = allParsedThemes.findIndex(t => t.value === themeName);
                    if (idx > -1) {
                        allParsedThemes.splice(idx, 1);
                    }
                    allParsedThemesMap.delete(themeName);

                    const objIdx = allThemeObjects.findIndex(t => (t.name === themeName || t.value === themeName));
                    if (objIdx > -1) {
                        allThemeObjects.splice(objIdx, 1);
                    }
                    allThemeObjectsMap.delete(themeName);
                    stKnownThemes.delete(themeName);

                    if (_activeThemeItem && _activeThemeItem.dataset.value === themeName) {
                        _activeThemeItem = null;
                    }
                }

                function softRenameThemeUI(oldName, newName) {
                    if (!oldName || !newName || oldName === newName) return;
                    renameThemeMtime(oldName, newName);
                    const item = themeItemMap.get(oldName);
                    if (item) {
                        item.dataset.value = newName;
                        const nameSpan = item.querySelector('.theme-item-name-text');
                        if (nameSpan) nameSpan.textContent = newName;
                        themeItemMap.delete(oldName);
                        themeItemMap.set(newName, item);
                    }

                    const parsed = allParsedThemesMap.get(oldName);
                    if (parsed) {
                        parsed.value = newName;
                        parsed.display = newName;
                        allParsedThemesMap.delete(oldName);
                        allParsedThemesMap.set(newName, parsed);
                    }

                    const obj = allThemeObjectsMap.get(oldName);
                    if (obj) {
                        obj.name = newName;
                        allThemeObjectsMap.delete(oldName);
                        allThemeObjectsMap.set(newName, obj);
                    }

                    stKnownThemes.delete(oldName);
                    stKnownThemes.add(newName);
                }


                // N-Level 激活祖先链路径与持久化

                const ACTIVE_TAG_PATH_KEY = 'theme_manager_active_tag_path';
                let activeTagAncestryPath = JSON.parse(localStorage.getItem(ACTIVE_TAG_PATH_KEY)) || [];
                let renderAllAncestorSubtagRows = false; // 默认折叠上级子标签排，只显示最小/最深层级

                function saveActiveTagAncestryPath() {
                    localStorage.setItem(ACTIVE_TAG_PATH_KEY, JSON.stringify(activeTagAncestryPath));
                }

                function syncActiveAncestryPath(allTags) {
                    if (!isSubtagsEnabled() || activeTagFilters.size === 0) {
                        activeTagAncestryPath = [];
                        return;
                    }
                    const validPath = [];
                    for (const tagId of activeTagAncestryPath) {
                        const tag = allTags.find(t => t.id === tagId);
                        if (tag) {
                            validPath.push(tag.id);
                        } else {
                            break;
                        }
                    }
                    activeTagAncestryPath = validPath;

                    if (activeTagAncestryPath.length === 0 && activeTagFilters.size > 0) {
                        for (const filterId of activeTagFilters) {
                            let currId = typeof filterId === 'string' && filterId.startsWith('__SUB_UNCATEGORIZED__:')
                                ? filterId.split(':')[1]
                                : filterId;
                            
                            const ancestors = [];
                            const visited = new Set();
                            while (currId && !visited.has(currId)) {
                                visited.add(currId);
                                const tag = allTags.find(t => t.id === currId);
                                if (tag) {
                                    ancestors.unshift(tag.id);
                                    currId = tag.parentId;
                                } else {
                                    break;
                                }
                            }
                            if (ancestors.length > 0) {
                                activeTagAncestryPath = ancestors;
                                saveActiveTagAncestryPath();
                                break;
                            }
                        }
                    }
                }

                function renderTagsUI(cachedTags) {
                    const container = managerPanel.querySelector('#theme-tags-container');
                    if (!container) return;
                    container.innerHTML = '';

                    // 清理旧有的多级子标签排和面包屑 Bar
                    const oldSubtags = managerPanel.querySelectorAll('.theme-subtags-row, .tm-breadcrumb-bar');
                    oldSubtags.forEach(el => el.remove());

                    const subtagsEnabled = isSubtagsEnabled();

                    // 筛选模式切换图标（OR / AND），放在最前面
                    const modeBtn = document.createElement('div');
                    modeBtn.className = `tm-filter-mode-btn${tagFilterMode === 'and' ? ' active' : ''}`;
                    modeBtn.title = tagFilterMode === 'and'
                        ? '当前：AND 交叉模式（支持跨排多选交集，点击切换为 OR 同层单选）'
                        : '当前：OR 单选模式（每一层级同时只能选中一个，点击切换为 AND 交叉多选）';
                    modeBtn.innerHTML = tagFilterMode === 'and'
                        ? '<i class="fa-solid fa-layer-group"></i>'
                        : '<i class="fa-solid fa-circle-nodes"></i>';
                    modeBtn.addEventListener('click', () => {
                        tagFilterMode = tagFilterMode === 'or' ? 'and' : 'or';
                        localStorage.setItem(TAG_FILTER_MODE_KEY, tagFilterMode);
                        if (tagFilterMode === 'or') {
                            let activeTagToKeep = null;
                            if (activeTagAncestryPath.length > 0) {
                                activeTagToKeep = activeTagAncestryPath[activeTagAncestryPath.length - 1];
                            } else if (activeTagFilters.size > 0) {
                                activeTagToKeep = Array.from(activeTagFilters)[0];
                            }
                            activeTagFilters.clear();
                            if (activeTagToKeep) activeTagFilters.add(activeTagToKeep);
                            toastr.info('已切换为 OR 模式 (每一层级仅限单选一个标签)');
                        } else {
                            toastr.info('已切换为 AND 模式 (跨层多选，多标签交集筛选)');
                        }
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    container.appendChild(modeBtn);

                    // "全部" (All) Tag
                    const allChip = document.createElement('div');
                    allChip.className = `theme-tag-chip ${activeTagFilters.size === 0 && activeTagAncestryPath.length === 0 ? 'active' : ''}`;
                    allChip.dataset.special = 'all';
                    allChip.innerHTML = `全部`;
                    allChip.addEventListener('click', () => {
                        activeLevel1TagId = null;
                        activeTagAncestryPath = [];
                        saveActiveTagAncestryPath();
                        activeTagFilters.clear();
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    container.appendChild(allChip);

                    // "收藏" (Favorites) Tag
                    const favChip = document.createElement('div');
                    favChip.className = `theme-tag-chip ${activeTagFilters.has('__FAVORITES__') ? 'active' : ''}`;
                    favChip.dataset.special = 'favorites';
                    favChip.innerHTML = `收藏`;
                    favChip.addEventListener('click', () => {
                        activeLevel1TagId = null;
                        activeTagAncestryPath = [];
                        saveActiveTagAncestryPath();
                        if (activeTagFilters.has('__FAVORITES__')) {
                            activeTagFilters.delete('__FAVORITES__');
                        } else {
                            if (tagFilterMode === 'or') activeTagFilters.clear();
                            activeTagFilters.add('__FAVORITES__');
                        }
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    container.appendChild(favChip);

                    // "未分类" (Uncategorized) Tag
                    const uncatChip = document.createElement('div');
                    uncatChip.className = `theme-tag-chip ${activeTagFilters.has('__UNCATEGORIZED__') ? 'active' : ''}`;
                    uncatChip.dataset.special = 'uncategorized';
                    uncatChip.innerHTML = `未分类`;
                    uncatChip.addEventListener('click', () => {
                        activeLevel1TagId = null;
                        activeTagAncestryPath = [];
                        saveActiveTagAncestryPath();
                        if (activeTagFilters.has('__UNCATEGORIZED__')) {
                            activeTagFilters.delete('__UNCATEGORIZED__');
                        } else {
                            if (tagFilterMode === 'or') activeTagFilters.clear();
                            activeTagFilters.add('__UNCATEGORIZED__');
                        }
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    container.appendChild(uncatChip);

                    const tags = cachedTags || loadThemeTags();

                    if (!subtagsEnabled) {
                        activeTagAncestryPath = [];
                    } else {
                        syncActiveAncestryPath(tags);
                    }

                    if (tags.length > 0) {
                        const rootTags = subtagsEnabled
                            ? tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId))
                            : tags;

                        rootTags.forEach(tag => {
                            const chip = document.createElement('div');
                            const descendantIds = subtagsEnabled ? getAllDescendantTagIds(tag.id, tags) : [tag.id];
                            const isPathActive = activeTagAncestryPath.length > 0 && activeTagAncestryPath[0] === tag.id;
                            const isDirectActive = activeTagFilters.has(tag.id);
                            const hasActiveChild = descendantIds.some(dId => activeTagFilters.has(dId));

                            chip.className = `theme-tag-chip level1 ${isDirectActive || isPathActive || hasActiveChild ? 'active' : ''}`;
                            chip.dataset.tagId = tag.id;

                            let count = tag.themes ? tag.themes.length : 0;
                            if (subtagsEnabled) {
                                const allThemeNames = new Set();
                                descendantIds.forEach(dId => {
                                    const dTag = tags.find(t => t.id === dId);
                                    if (dTag && dTag.themes) {
                                        dTag.themes.forEach(th => allThemeNames.add(th));
                                    }
                                });
                                count = allThemeNames.size;
                            }

                            chip.innerHTML = `${escapeHtml(tag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${count})</span>`;
                            chip.addEventListener('click', () => {
                                if (subtagsEnabled) {
                                    if (activeTagAncestryPath[0] === tag.id) {
                                        if (tagFilterMode === 'or' && activeTagFilters.has(tag.id) && activeTagAncestryPath.length === 1) {
                                            activeTagAncestryPath = [];
                                            activeTagFilters.clear();
                                        } else {
                                            activeTagAncestryPath = [tag.id];
                                            if (tagFilterMode === 'or') {
                                                activeTagFilters.clear();
                                                activeTagFilters.add(tag.id);
                                            } else {
                                                activeTagFilters.add(tag.id);
                                            }
                                        }
                                    } else {
                                        activeTagAncestryPath = [tag.id];
                                        if (tagFilterMode === 'or') activeTagFilters.clear();
                                        activeTagFilters.add(tag.id);
                                    }
                                    saveActiveTagAncestryPath();
                                } else {
                                    if (activeTagFilters.has(tag.id)) {
                                        activeTagFilters.delete(tag.id);
                                    } else {
                                        if (tagFilterMode === 'or') activeTagFilters.clear();
                                        activeTagFilters.add(tag.id);
                                    }
                                }
                                handleTagFilterChange();
                                renderTagsUI();
                            });
                            container.appendChild(chip);
                        });

                        // 渲染面包屑导航与动态多级子标签排 (方案 A N 级渲染)
                        if (subtagsEnabled && activeTagAncestryPath.length > 0) {
                            let lastRowRef = container;

                            // 1. 渲染面包屑 Bar
                            const breadcrumbBar = document.createElement('div');
                            breadcrumbBar.className = 'tm-breadcrumb-bar';
                            
                            const rootCrumb = document.createElement('span');
                            rootCrumb.className = 'tm-breadcrumb-item';
                            rootCrumb.innerHTML = `<i class="fa-solid fa-house" style="font-size:10px;"></i> 主分类`;
                            rootCrumb.addEventListener('click', () => {
                                activeTagAncestryPath = [];
                                saveActiveTagAncestryPath();
                                activeTagFilters.clear();
                                handleTagFilterChange();
                                renderTagsUI();
                            });
                            breadcrumbBar.appendChild(rootCrumb);

                            activeTagAncestryPath.forEach((pathTagId, idx) => {
                                const pathTag = tags.find(t => t.id === pathTagId);
                                if (!pathTag) return;

                                const sep = document.createElement('span');
                                sep.className = 'tm-breadcrumb-separator';
                                sep.innerHTML = `<i class="fa-solid fa-angle-right"></i>`;
                                breadcrumbBar.appendChild(sep);

                                const item = document.createElement('span');
                                const isLast = idx === activeTagAncestryPath.length - 1;
                                item.className = `tm-breadcrumb-item${isLast ? ' active' : ''}`;
                                const descIds = getAllDescendantTagIds(pathTag.id, tags);
                                const allThemeNames = new Set();
                                descIds.forEach(dId => {
                                    const dTag = tags.find(t => t.id === dId);
                                    if (dTag && dTag.themes) dTag.themes.forEach(th => allThemeNames.add(th));
                                });
                                item.innerHTML = `${escapeHtml(pathTag.name)} <small style="opacity:0.6;">(${allThemeNames.size})</small>`;
                                item.addEventListener('click', () => {
                                    activeTagAncestryPath = activeTagAncestryPath.slice(0, idx + 1);
                                    saveActiveTagAncestryPath();
                                    if (tagFilterMode === 'or') {
                                        activeTagFilters.clear();
                                        activeTagFilters.add(pathTag.id);
                                    }
                                    handleTagFilterChange();
                                    renderTagsUI();
                                });
                                breadcrumbBar.appendChild(item);
                            });

                            if (activeTagAncestryPath.length > 1) {
                                const toggleFoldBtn = document.createElement('span');
                                toggleFoldBtn.className = 'tm-breadcrumb-item tm-toggle-fold';
                                toggleFoldBtn.style.opacity = '0.6';
                                toggleFoldBtn.style.marginLeft = 'auto';
                                toggleFoldBtn.style.fontSize = '11px';
                                toggleFoldBtn.style.padding = '0 4px';
                                toggleFoldBtn.title = renderAllAncestorSubtagRows ? '折叠上级标签胶囊 (仅显示最小层级)' : '展开所有上级标签胶囊';
                                toggleFoldBtn.innerHTML = `<i class="fa-solid ${renderAllAncestorSubtagRows ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>`;
                                toggleFoldBtn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    renderAllAncestorSubtagRows = !renderAllAncestorSubtagRows;
                                    renderTagsUI();
                                });
                                breadcrumbBar.appendChild(toggleFoldBtn);
                            }

                            container.parentNode.insertBefore(breadcrumbBar, lastRowRef.nextSibling);
                            lastRowRef = breadcrumbBar;

                            // 2. 渲染当下激活祖先链的子标签排 (默认仅显示最下级/最小层级，上级层级折叠收起)
                            const displayDepthIndices = renderAllAncestorSubtagRows
                                ? activeTagAncestryPath.map((_, idx) => idx)
                                : [activeTagAncestryPath.length - 1];

                            displayDepthIndices.forEach(depthIdx => {
                                const parentTagId = activeTagAncestryPath[depthIdx];
                                const parentTag = tags.find(t => t.id === parentTagId);
                                if (!parentTag) return;

                                const childTags = tags.filter(t => t.parentId === parentTagId);
                                const childTagIds = childTags.map(t => t.id);
                                if (childTags.length === 0) return;

                                const subRow = document.createElement('div');
                                subRow.className = `theme-tags-row theme-subtags-row level-${depthIdx + 2}`;
                                
                                const labelSpan = document.createElement('span');
                                labelSpan.className = 'tm-subtag-label';
                                labelSpan.innerHTML = `<i class="fa-solid fa-angle-right"></i> ${escapeHtml(parentTag.name)}:`;
                                subRow.appendChild(labelSpan);

                                const currentDepthSelectedId = activeTagAncestryPath[depthIdx + 1];

                                childTags.forEach(childTag => {
                                    const subChip = document.createElement('div');
                                    const isSubDirectActive = activeTagFilters.has(childTag.id);
                                    const isSubInPath = currentDepthSelectedId === childTag.id;
                                    const cDescIds = getAllDescendantTagIds(childTag.id, tags);
                                    const cThemeNames = new Set();
                                    cDescIds.forEach(dId => {
                                        const dTag = tags.find(t => t.id === dId);
                                        if (dTag && dTag.themes) dTag.themes.forEach(th => cThemeNames.add(th));
                                    });

                                    subChip.className = `theme-tag-chip level2 ${isSubDirectActive || isSubInPath ? 'active' : ''}`;
                                    subChip.dataset.tagId = childTag.id;
                                    subChip.innerHTML = `${escapeHtml(childTag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${cThemeNames.size})</span>`;
                                    subChip.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        if (tagFilterMode === 'or') {
                                            if (isSubInPath && isSubDirectActive) {
                                                // OR 模式：同层级再次点击已选中的标签 -> 取消选中该层级，回退至父级标签
                                                activeTagAncestryPath = activeTagAncestryPath.slice(0, depthIdx + 1);
                                                activeTagFilters.clear();
                                                const parentIdAtUpperLevel = activeTagAncestryPath[activeTagAncestryPath.length - 1];
                                                if (parentIdAtUpperLevel) {
                                                    activeTagFilters.add(parentIdAtUpperLevel);
                                                }
                                            } else {
                                                // OR 模式：同层级点击不同标签 -> 替换本层级选中项 (单选)
                                                activeTagAncestryPath = [...activeTagAncestryPath.slice(0, depthIdx + 1), childTag.id];
                                                activeTagFilters.clear();
                                                activeTagFilters.add(childTag.id);
                                            }
                                        } else {
                                            // AND 模式：多选 toggling
                                            activeTagAncestryPath = [...activeTagAncestryPath.slice(0, depthIdx + 1), childTag.id];
                                            if (activeTagFilters.has(childTag.id)) {
                                                activeTagFilters.delete(childTag.id);
                                            } else {
                                                activeTagFilters.add(childTag.id);
                                            }
                                        }
                                        saveActiveTagAncestryPath();
                                        handleTagFilterChange();
                                        renderTagsUI();
                                    });
                                    subRow.appendChild(subChip);
                                });

                                // 渲染次级“未分类”标签 (仅计算属于本级、且未归入任何更深子级标签的美化)
                                const lThemes = parentTag.themes || [];
                                const subUncatCount = lThemes.filter(themeName => {
                                    const themeTags = getTagsForTheme(themeName, tags);
                                    return !themeTags.some(tId => childTagIds.includes(tId));
                                }).length;

                                if (subUncatCount > 0 || childTags.length > 0) {
                                    const subUncatKey = `__SUB_UNCATEGORIZED__:${parentTagId}`;
                                    const isSubUncatActive = activeTagFilters.has(subUncatKey);
                                    const subUncatChip = document.createElement('div');
                                    subUncatChip.className = `theme-tag-chip level2 sub-uncategorized ${isSubUncatActive ? 'active' : ''}`;
                                    subUncatChip.dataset.special = 'sub-uncategorized';
                                    subUncatChip.innerHTML = `未分类 <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${subUncatCount})</span>`;
                                    subUncatChip.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        if (tagFilterMode === 'or') {
                                            if (isSubUncatActive) {
                                                // OR 模式：再次点击次级未分类 -> 回退取消
                                                activeTagAncestryPath = activeTagAncestryPath.slice(0, depthIdx + 1);
                                                activeTagFilters.clear();
                                                activeTagFilters.add(parentTagId);
                                            } else {
                                                // OR 模式：同层单选替换为次级未分类
                                                activeTagAncestryPath = activeTagAncestryPath.slice(0, depthIdx + 1);
                                                activeTagFilters.clear();
                                                activeTagFilters.add(subUncatKey);
                                            }
                                        } else {
                                            if (isSubUncatActive) {
                                                activeTagFilters.delete(subUncatKey);
                                            } else {
                                                activeTagFilters.add(subUncatKey);
                                            }
                                        }
                                        saveActiveTagAncestryPath();
                                        handleTagFilterChange();
                                        renderTagsUI();
                                    });
                                    subRow.appendChild(subUncatChip);
                                }

                                container.parentNode.insertBefore(subRow, lastRowRef.nextSibling);
                                lastRowRef = subRow;
                            });
                        }
                    }
                }
                function updateActiveState() {
                    const pu = typeof getPowerUser === 'function' ? getPowerUser() : null;
                    const currentValue = originalSelect?.value || pu?.theme || '';
                    if (!currentValue) return;

                    let currentItem = themeItemMap.get(currentValue) || null;
                    if (!currentItem) {
                        const rawClean = String(currentValue).trim();
                        currentItem = themeItemMap.get(rawClean) || null;
                    }

                    // 极致性能：如果当前项已经正确保持高亮，直接返回，0 毫秒开销
                    if (_activeThemeItem === currentItem && currentItem && currentItem.classList.contains('active')) {
                        return;
                    }

                    // 正常路径：O(1) 移除旧节点，添加新节点
                    if (_activeThemeItem) {
                        _activeThemeItem.classList.remove('active');
                    }

                    // 异常/切页兜底：若 _activeThemeItem 为空，或新项与旧项脱节，清理当前视口中可能遗留的旧 active 节点
                    if (!currentItem || !_activeThemeItem) {
                        const legacyActives = contentWrapper ? contentWrapper.querySelectorAll('.theme-item.active') : [];
                        for (let i = 0; i < legacyActives.length; i++) {
                            if (legacyActives[i] !== currentItem) {
                                legacyActives[i].classList.remove('active');
                            }
                        }
                    }

                    _activeThemeItem = currentItem;
                    if (_activeThemeItem) {
                        _activeThemeItem.classList.add('active');
                    }
                }
                let performBatchRename = () => {};
                let openBatchRenamePopup = () => {};
                try {
                    const { initBatchRename } = await import(`${baseDir}modules/batch-rename.js`);
                    const batchRenameModule = initBatchRename({
                        getSelectedForBatch: () => selectedForBatch,
                        clearSelectedForBatch: () => {
                            selectedForBatch.clear();
                            lastClickedThemeName = null;
                            managerPanel.querySelectorAll('.selected-for-batch').forEach(el => el.classList.remove('selected-for-batch'));
                        },
                        showLoader,
                        hideLoader,
                        getAllThemesFromAPI,
                        findThemeObject,
                        normalizeThemeObject,
                        apiRequest,
                        deleteTheme,
                        limitConcurrency,
                        originalSelect,
                        manualUpdateOriginalSelect,
                        updateSTThemeMemory,
                        softRenameThemeUI,
                        updateFavorites,
                        getThemeBackgroundBindings: () => themeBackgroundBindings,
                        loadThemeTags,
                        saveThemeTags,
                        invalidateThemesCache,
                        filterThemeList,
                        triggerSelectChange,
                        updateActiveState,
                        setSuspendObserver: (val) => { _suspendObserver = val; },
                        callGenericPopup,
                        toastr,
                        escapeHtml
                    });
                    performBatchRename = batchRenameModule.performBatchRename;
                    openBatchRenamePopup = batchRenameModule.openBatchRenamePopup;
                } catch (e) {
                    console.error('[Theme Manager] 批量重命名模块加载失败:', e);
                }

                let performBatchDelete = () => {};
                try {
                    const { initBatchDelete } = await import(`${baseDir}modules/batch-delete.js`);
                    const batchDeleteModule = initBatchDelete({
                        getSelectedForBatch: () => selectedForBatch,
                        clearSelectedForBatch: () => selectedForBatch.clear(),
                        setLastClickedThemeName: (val) => { lastClickedThemeName = val; },
                        confirmAction,
                        findThemeObject,
                        findOptionByValue,
                        originalSelect,
                        suspendObserver: (fn) => {
                            _suspendObserver = true;
                            try { fn(); } finally { setTimeout(() => { _suspendObserver = false; }, 0); }
                        },
                        limitConcurrency,
                        deleteTheme,
                        themeItemMap,
                        allParsedThemes,
                        allParsedThemesMap,
                        allThemeObjects,
                        allThemeObjectsMap,
                        stKnownThemes,
                        themeBackgroundBindings,
                        THEME_BACKGROUND_BINDINGS_KEY,
                        getFavorites: () => favorites,
                        setFavorites: (newFavs) => { favorites = newFavs; },
                        updateFavorites,
                        loadThemeTags,
                        saveThemeTags,
                        applyThemeDirect,
                        renderTagsUI,
                        updateActiveState,
                        toastr,
                        invalidateThemesCache
                    });
                    performBatchDelete = batchDeleteModule.performBatchDelete;
                } catch (e) {
                    console.error('[Theme Manager] 批量删除模块加载失败:', e);
                }




                // ===============================================
                // =========== 事件监听器 (EVENT LISTENERS) ===========
                // ===============================================

                // VVVVVVVVVVVV 新增代码 VVVVVVVVVVVV -->

                // ===================== 自定义模块化备份系统 =====================
                let openCustomExportModal = () => {};
                let openCustomImportModal = () => {};
                let triggerFullImport = () => {};

                const { initBackupManager, BACKUP_MODULE_DEFS } = await import(`${baseDir}modules/backup-manager.js`);
                const backupModule = initBackupManager({
                    getAllThemesFromAPI,
                    apiRequest,
                    allThemeObjectsMap,
                    recordThemeMtime,
                    showLoader,
                    hideLoader,
                    callGenericPopup,
                    closePopup,
                    escapeHtml,
                    limitConcurrency,
                    onRestoreComplete: async ({ themesToImport, importThemesMod, themeOk, themeFail, settingsCount }) => {
                        // 3. 热更新内存变量
                        invalidateTagsCache();
                        invalidateThemesCache();
                        isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
                        hideTagPills = localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true';
                        tagPillDisplayMode = localStorage.getItem(TAG_PILL_MODE_KEY) || (hideTagPills ? 'none' : 'all');
                        showUsageCount = localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true';
                        enableAvatarHelper = localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) !== 'false';
                        enableColorTransfer = localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true';
                        enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false';
                        enableReplaceAvatarBtn = localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) !== 'false';
                        tagFilterMode = localStorage.getItem(TAG_FILTER_MODE_KEY) || 'or';
                        try { usageCount = JSON.parse(localStorage.getItem(USAGE_COUNT_KEY)) || {}; } catch (e) {}
                        try { favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; favoritesSet = new Set(favorites); } catch (e) {}
                        themeDayNightPairs = loadThemeDayNightPairs();
                        try { autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || autoThemeSettings; } catch (e) {}
                        themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};

                        // 4. 更新 ST 原生下拉框
                        if (themesToImport.length > 0) {
                            _suspendObserver = true;
                            try {
                                themesToImport.forEach(themeObj => {
                                    if (!themeObj || !themeObj.name) return;
                                    updateSTThemeMemory(themeObj, 'add');
                                    if (!findOptionByValue(originalSelect, themeObj.name)) {
                                        const opt = document.createElement('option');
                                        opt.value = themeObj.name;
                                        opt.textContent = themeObj.name;
                                        originalSelect.appendChild(opt);
                                    }
                                    stKnownThemes.add(themeObj.name);
                                });
                                syncStKnownThemes();
                            } finally {
                                setTimeout(() => { _suspendObserver = false; }, 0);
                            }
                        }

                        // 5. 重建标签索引与 UI
                        applyKeywordMappings();
                        const freshTags = loadThemeTags();
                        buildThemeTagIndex(freshTags);
                        if (contentWrapper) {
                            contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                            contentWrapper.classList.toggle('hide-tag-pills', hideTagPills);
                        }
                        document.dispatchEvent(new CustomEvent('themeManager:enableAvatarHelperChanged', { detail: enableAvatarHelper }));
                        updateManualToggleBtnVisibility();
                        if (enableReplaceAvatarBtn) { registerReplaceImageButtons(); } else { removeReplaceImageButtons(); }

                        // 6. 重建全量 UI
                        await buildThemeUI();
                        updateActiveState();
                        if (typeof checkAutoTheme === 'function') checkAutoTheme();
                    }
                });
                openCustomExportModal = backupModule.openCustomExportModal;
                openCustomImportModal = backupModule.openCustomImportModal;
                triggerFullImport = backupModule.triggerFullImport;
                const fullBackupFileInput = { click: () => triggerFullImport() };

                let exportSettings = () => {};
                let importSettings = () => {};
                let openResetSystemModal = () => {};
                let openSettingsPopup = () => {};

                try {
                    const { initSettingsManager } = await import(`${baseDir}modules/settings-manager.js`);
                    const smModule = initSettingsManager({
                        settingsKeysToSync,
                        callGenericPopup,
                        closePopup,
                        toastr,
                        invalidateTagsCache,
                        invalidateThemesCache,
                        loadThemeTags,
                        buildThemeTagIndex,
                        applyKeywordMappings: () => applyKeywordMappings(),
                        loadThemeDayNightPairs,
                        getTagsForTheme: (v, t) => getTagsForTheme(v, t),
                        getAllParsedThemes: () => allParsedThemes,
                        getContentWrapper: () => contentWrapper,
                        getThemeItemMap: () => themeItemMap,
                        getUsageCount: () => usageCount,
                        updateThemeItemDayNightState: (name) => updateThemeItemDayNightState(name),
                        softRefreshUI: () => softRefreshUI(),
                        updateActiveState: () => updateActiveState(),
                        checkAutoTheme: () => { if (typeof checkAutoTheme === 'function') checkAutoTheme(); },
                        updateManualToggleBtnVisibility: () => updateManualToggleBtnVisibility(),
                        registerReplaceImageButtons,
                        removeReplaceImageButtons,
                        openCustomExportModal: () => openCustomExportModal(),
                        getSettingsFileInput: () => settingsFileInput,
                        getFullBackupFileInput: () => fullBackupFileInput,
                        hardResyncThemes: (showToast) => hardResyncThemes(showToast),
                        getFavorites: () => favorites,
                        setFavorites: (favs) => { favorites = favs; favoritesSet = new Set(favs); },
                        setAutoThemeSettings: (ats) => { autoThemeSettings = ats; },
                        getAutoThemeSettings: () => autoThemeSettings,
                        keys: {
                            TWO_LINE_LAYOUT_KEY,
                            TAG_PILL_MODE_KEY,
                            HIDE_TAG_PILLS_KEY,
                            SHOW_USAGE_COUNT_KEY,
                            ENABLE_DAYNIGHT_BINDING_KEY,
                            ENABLE_REPLACE_AVATAR_BTN_KEY,
                            ENABLE_AVATAR_HELPER_KEY,
                            ENABLE_COLOR_TRANSFER_KEY,
                            TAG_FILTER_MODE_KEY,
                            USAGE_COUNT_KEY,
                            FAVORITES_KEY,
                            THEME_DAY_NIGHT_PAIRS_KEY,
                            AUTO_THEME_KEY
                        }
                    });
                    exportSettings = smModule.exportSettings;
                    importSettings = smModule.importSettings;
                    openResetSystemModal = smModule.openResetSystemModal;
                    openSettingsPopup = smModule.openSettingsPopup;
                } catch (e) {
                    console.error('[Theme Manager] 设置管理模块加载失败:', e);
                }


                settingsFileInput.addEventListener('change', importSettings);

                const autoGroupBtn = managerPanel.querySelector('#tm-auto-group-btn');
                if (autoGroupBtn) {
                    autoGroupBtn.addEventListener('click', () => openAutoGroupWizard());
                }

                const settingsBtn = managerPanel.querySelector('#tm-settings-btn');
                if (settingsBtn) {
                    settingsBtn.addEventListener('click', () => openSettingsPopup());
                }

                // ---------- 功能结束 ----------

                // ^^^^^^^^^^^^ 新增代码 ^^^^^^^^^^^^ -->

                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    if (e.target.closest('#tm-quick-manual-toggle-btn')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                const quickManualToggleBtn = managerPanel.querySelector('#tm-quick-manual-toggle-btn');
                if (quickManualToggleBtn) {
                    quickManualToggleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        executeManualThemeToggle();
                    });
                }

                updateManualToggleBtnVisibility();

                // 搜索输入防抖（支持流畅实时复合搜索）
                let _searchDebounceTimer = null;
                searchBox.addEventListener('input', (e) => {
                    clearTimeout(_searchDebounceTimer);
                    _searchDebounceTimer = setTimeout(() => {
                        currentPage = 1;
                        filterThemeList(0);
                    }, 250);
                });

                // 初始化配置项控件状态
                listModeSelect.value = listMode;
                pageSizeSelect.value = String(pageSize);
                sortSelect.value = sortBy;
                pageSizeSelect.style.display = listMode === 'page' ? 'inline-block' : 'none';

                listModeSelect.addEventListener('change', (e) => {
                    listMode = e.target.value;
                    localStorage.setItem(LIST_MODE_KEY, listMode);
                    pageSizeSelect.style.display = listMode === 'page' ? 'inline-block' : 'none';
                    currentPage = 1;
                    buildThemeListLazy(0);
                });

                pageSizeSelect.addEventListener('change', (e) => {
                    pageSize = parseInt(e.target.value);
                    localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
                    currentPage = 1;
                    buildThemeListLazy(0);
                });

                sortSelect.addEventListener('change', (e) => {
                    sortBy = e.target.value;
                    localStorage.setItem(SORT_SELECT_KEY, sortBy);
                    currentPage = 1;
                    buildThemeListLazy(0);
                });

                // 使用次数显示 toggle
                const toggleUsageCountBtn = managerPanel.querySelector('#tm-toggle-usage-count-btn');
                if (toggleUsageCountBtn) {
                    toggleUsageCountBtn.classList.toggle('active', showUsageCount);
                    toggleUsageCountBtn.addEventListener('click', () => {
                        showUsageCount = !showUsageCount;
                        localStorage.setItem(SHOW_USAGE_COUNT_KEY, showUsageCount ? 'true' : 'false');
                        toggleUsageCountBtn.classList.toggle('active', showUsageCount);
                        // 更新所有已渲染的主题项
                        themeItemMap.forEach((item, themeName) => {
                            const usageSpan = item.children[0].querySelector('.theme-usage-count');
                            if (usageSpan) {
                                if (showUsageCount && usageCount[themeName]) {
                                    usageSpan.textContent = usageCount[themeName];
                                    usageSpan.style.display = '';
                                } else {
                                    usageSpan.style.display = 'none';
                                }
                            }
                        });
                    });
                }

                // 头像管理开启/禁用 toggle
                const toggleAvatarHelperBtn = managerPanel.querySelector('#tm-toggle-avatar-helper-btn');
                if (toggleAvatarHelperBtn) {
                    // 根据当前状态设置初始图标
                    const updateAvatarHelperBtnIcon = (enabled) => {
                        const icon = toggleAvatarHelperBtn.querySelector('i');
                        if (icon) {
                            icon.className = enabled ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
                        }
                        toggleAvatarHelperBtn.classList.toggle('active', enabled);
                    };
                    updateAvatarHelperBtnIcon(enableAvatarHelper);
                    toggleAvatarHelperBtn.addEventListener('click', () => {
                        enableAvatarHelper = !enableAvatarHelper;
                        localStorage.setItem(ENABLE_AVATAR_HELPER_KEY, String(enableAvatarHelper));
                        updateAvatarHelperBtnIcon(enableAvatarHelper);
                        // 派发自定义事件以支持无刷新热更新
                        document.dispatchEvent(new CustomEvent('themeManager:enableAvatarHelperChanged', { detail: enableAvatarHelper }));
                    });
                }

                // 配色提取功能开启/禁用 toggle (默认关闭，与头像按钮一致使用 check/xmark 图标)
                const toggleColorTransferBtn = managerPanel.querySelector('#tm-toggle-color-transfer-btn');
                if (toggleColorTransferBtn) {
                    const updateColorTransferBtnIcon = (enabled) => {
                        const icon = toggleColorTransferBtn.querySelector('i');
                        if (icon) {
                            icon.className = enabled ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
                        }
                        toggleColorTransferBtn.classList.toggle('active', enabled);
                    };
                    updateColorTransferBtnIcon(enableColorTransfer);
                    toggleColorTransferBtn.addEventListener('click', () => {
                        enableColorTransfer = !enableColorTransfer;
                        localStorage.setItem(ENABLE_COLOR_TRANSFER_KEY, String(enableColorTransfer));
                        updateColorTransferBtnIcon(enableColorTransfer);
                        toastr.info(`提取配色功能已${enableColorTransfer ? '开启' : '关闭'}`);
                        // 批量更新所有卡片上的配色按钮显示
                        themeItemMap.forEach((item) => {
                            const btn = item.querySelector('.color-transfer-btn');
                            if (btn) btn.style.display = enableColorTransfer ? 'inline-flex' : 'none';
                        });
                    });
                }

                // 日夜绑定功能开启/禁用 toggle
                const toggleDayNightBindingBtn = managerPanel.querySelector('#tm-toggle-daynight-binding-btn');
                if (toggleDayNightBindingBtn) {
                    const updateDayNightBindingBtnIcon = (enabled) => {
                        const icon = toggleDayNightBindingBtn.querySelector('i');
                        if (icon) {
                            icon.className = enabled ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
                        }
                        toggleDayNightBindingBtn.classList.toggle('active', enabled);
                    };
                    updateDayNightBindingBtnIcon(enableDayNightBinding);
                    toggleDayNightBindingBtn.addEventListener('click', () => {
                        enableDayNightBinding = !enableDayNightBinding;
                        localStorage.setItem(ENABLE_DAYNIGHT_BINDING_KEY, String(enableDayNightBinding));
                        updateDayNightBindingBtnIcon(enableDayNightBinding);
                        toastr.info(`日夜绑定图标已${enableDayNightBinding ? '显示' : '隐藏'}`);
                        // 批量更新所有卡片上的日夜绑定按钮显示
                        themeItemMap.forEach((item) => {
                            const btn = item.querySelector('.link-daynight-btn');
                            if (btn) btn.style.display = enableDayNightBinding ? 'inline-flex' : 'none';
                        });
                    });
                }

                // ==========================================================
                // ========= 替换卡图/头像按钮注入 (模块化: modules/avatar-replace.js) =========
                // ==========================================================
                let removeReplaceImageButtons = () => {};
                let registerReplaceImageButtons = () => {};

                try {
                    const { initAvatarReplace } = await import(`${baseDir}modules/avatar-replace.js`);
                    const avatarReplaceModule = initAvatarReplace({
                        ENABLE_REPLACE_AVATAR_BTN_KEY,
                        toastr
                    });
                    removeReplaceImageButtons = avatarReplaceModule.removeReplaceImageButtons;
                    registerReplaceImageButtons = avatarReplaceModule.registerReplaceImageButtons;
                    avatarReplaceModule.initAvatarReplaceListeners();
                } catch (e) {
                    console.error('[Theme Manager] 头像替换模块加载失败:', e);
                }

                const toggleReplaceAvatarBtn = managerPanel.querySelector('#tm-toggle-replace-avatar-btn');
                if (toggleReplaceAvatarBtn) {
                    const updateReplaceAvatarBtnIcon = (enabled) => {
                        const icon = toggleReplaceAvatarBtn.querySelector('i');
                        if (icon) {
                            icon.className = enabled ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
                        }
                        toggleReplaceAvatarBtn.classList.toggle('active', enabled);
                    };
                    updateReplaceAvatarBtnIcon(enableReplaceAvatarBtn);
                    toggleReplaceAvatarBtn.addEventListener('click', () => {
                        enableReplaceAvatarBtn = !enableReplaceAvatarBtn;
                        localStorage.setItem(ENABLE_REPLACE_AVATAR_BTN_KEY, String(enableReplaceAvatarBtn));
                        updateReplaceAvatarBtnIcon(enableReplaceAvatarBtn);
                        toastr.info(`替换按键已${enableReplaceAvatarBtn ? '显示' : '隐藏'}`);
                        if (enableReplaceAvatarBtn) {
                            registerReplaceImageButtons();
                        } else {
                            removeReplaceImageButtons();
                        }
                        document.dispatchEvent(new CustomEvent('themeManager:enableReplaceAvatarBtnChanged', { detail: enableReplaceAvatarBtn }));
                    });
                }
                // ==========================================================
                // ========= 配色提取与调色板迁移 (模块化: modules/color-transfer.js) =========
                // ==========================================================
                let openColorTransferModal = () => {};
                let closeColorTransferModal = () => {};
                let transferThemeColors = () => {};
                let extractThemeBaseName = () => '';
                let getSmartRecommendedThemes = () => [];

                try {
                    const { initColorTransfer } = await import(`${baseDir}modules/color-transfer.js`);
                    const colorModule = initColorTransfer({
                        getAllParsedThemes: () => allParsedThemes,
                        allThemeObjectsMap,
                        loadThemeTags,
                        saveTheme,
                        updateSTThemeMemory,
                        originalSelect,
                        applyThemeDirect,
                        showLoader,
                        hideLoader
                    });
                    openColorTransferModal = colorModule.openColorTransferModal;
                    closeColorTransferModal = colorModule.closeColorTransferModal;
                    transferThemeColors = colorModule.transferThemeColors;
                    extractThemeBaseName = colorModule.extractThemeBaseName;
                    getSmartRecommendedThemes = colorModule.getSmartRecommendedThemes;
                } catch (e) {
                    console.error('[Theme Manager] 提取配色模块加载失败:', e);
                }
                const scrollToThemeListTop = () => {
                    if (contentWrapper) {
                        contentWrapper.scrollTop = 0;
                    }
                    const themeListEl = contentWrapper ? contentWrapper.querySelector('.theme-list') : null;
                    const targetEl = themeListEl || contentWrapper;
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                };

                firstPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (currentPage > 1) {
                            currentPage = 1;
                            buildThemeListLazy(0);
                            scrollToThemeListTop();
                        }
                    });
                });

                prevPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (currentPage > 1) {
                            currentPage--;
                            buildThemeListLazy(0);
                            scrollToThemeListTop();
                        }
                    });
                });

                nextPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const totalPages = Math.ceil(filteredThemes.length / pageSize);
                        if (currentPage < totalPages) {
                            currentPage++;
                            buildThemeListLazy(0);
                            scrollToThemeListTop();
                        }
                    });
                });

                lastPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const totalPages = Math.ceil(filteredThemes.length / pageSize);
                        if (currentPage < totalPages) {
                            currentPage = totalPages;
                            buildThemeListLazy(0);
                            scrollToThemeListTop();
                        }
                    });
                });

                pageInputs.forEach(input => {
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            let targetPage = parseInt(e.target.value);
                            const totalPages = Math.ceil(filteredThemes.length / pageSize) || 1;
                            if (isNaN(targetPage)) {
                                e.target.value = String(currentPage);
                                return;
                            }
                            if (targetPage < 1) targetPage = 1;
                            if (targetPage > totalPages) targetPage = totalPages;
                            if (targetPage !== currentPage) {
                                currentPage = targetPage;
                                buildThemeListLazy(0);
                                scrollToThemeListTop();
                            }
                        }
                    });
                    input.addEventListener('blur', (e) => {
                        let targetPage = parseInt(e.target.value);
                        const totalPages = Math.ceil(filteredThemes.length / pageSize) || 1;
                        if (isNaN(targetPage)) {
                            e.target.value = String(currentPage);
                            return;
                        }
                        if (targetPage < 1) targetPage = 1;
                        if (targetPage > totalPages) targetPage = totalPages;
                        if (targetPage !== currentPage) {
                            currentPage = targetPage;
                            buildThemeListLazy(0);
                            scrollToThemeListTop();
                        } else {
                            e.target.value = String(currentPage);
                        }
                    });
                });

                randomBtn.addEventListener('click', async () => {
                    // 复用已缓存的主题列表，避免额外的 API 请求
                    if (allParsedThemes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * allParsedThemes.length);
                        const randomThemeName = allParsedThemes[randomIndex].value;
                        if (randomThemeName) {
                            applyThemeDirect(randomThemeName);
                            updateActiveState();
                        }
                    }
                });


                batchEditBtn.addEventListener('click', () => {
                    isBatchEditMode = !isBatchEditMode;
                    managerPanel.classList.toggle('batch-edit-mode', isBatchEditMode);
                    batchActionsBar.style.display = isBatchEditMode ? 'flex' : 'none';
                    batchEditBtn.classList.toggle('selected', isBatchEditMode);
                    batchEditBtn.textContent = isBatchEditMode ? '退出批量编辑' : '';
                    if (!isBatchEditMode) {
                        batchEditBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 批量编辑';
                    }


                    if (!isBatchEditMode) {
                        selectedForBatch.clear();
                        lastClickedThemeName = null;
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                    }
                });

                // 展开/收起更多操作按钮
                // 初始化时读取保存的折叠状态
                const savedBatchEditCollapsed = localStorage.getItem(BATCH_EDIT_COLLAPSED_KEY);
                if (savedBatchEditCollapsed === 'false') {
                    moreActionsContainer.classList.remove('collapsed');
                    toggleMoreActionsBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
                    toggleMoreActionsBtn.title = '收起更多操作';
                }

                toggleMoreActionsBtn.addEventListener('click', () => {
                    const isCollapsed = moreActionsContainer.classList.toggle('collapsed');
                    toggleMoreActionsBtn.innerHTML = isCollapsed
                        ? '<i class="fa-solid fa-ellipsis"></i>'
                        : '<i class="fa-solid fa-chevron-up"></i>';
                    toggleMoreActionsBtn.title = isCollapsed ? '展开更多操作' : '收起更多操作';
                    // 保存折叠状态到 localStorage
                    localStorage.setItem(BATCH_EDIT_COLLAPSED_KEY, isCollapsed ? 'true' : 'false');
                });



                // 弹窗让用户设置导入美化时所分配的目标分类标签
                let showImportTagSelectionPopup = () => {};
                let handleBatchThemeImport = () => {};

                try {
                    const { initThemeImport } = await import(`${baseDir}modules/theme-import.js`);
                    const themeImportModule = initThemeImport({
                        loadThemeTags,
                        saveThemeTags,
                        isSubtagsEnabled,
                        getActiveTagFilters: () => activeTagFilters,
                        escapeHtml,
                        callGenericPopup,
                        toastr,
                        fileInput,
                        showLoader,
                        hideLoader,
                        limitConcurrency,
                        saveTheme,
                        suspendObserver: (fn) => {
                            _suspendObserver = true;
                            try { fn(); } finally { setTimeout(() => { _suspendObserver = false; }, 0); }
                        },
                        updateSTThemeMemory,
                        findOptionByValue,
                        originalSelect,
                        stKnownThemes,
                        syncStKnownThemes,
                        allThemeObjectsMap,
                        allThemeObjects,
                        invalidateThemesCache,
                        invalidateValidThemeNamesCache,
                        allParsedThemesMap,
                        softAddThemeUI,
                        contentWrapper,
                        applyKeywordMappings: (names) => applyKeywordMappings(names),
                        softRefreshUI: (names) => softRefreshUI(names),
                        filterThemeList: (pos) => filterThemeList(pos),
                        updateActiveState: () => updateActiveState()
                    });
                    showImportTagSelectionPopup = themeImportModule.showImportTagSelectionPopup;
                    handleBatchThemeImport = themeImportModule.handleBatchThemeImport;
                } catch (e) {
                    console.error('[Theme Manager] 主题导入模块加载失败:', e);
                }

                fileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    try {
                        await handleBatchThemeImport(files);
                    } finally {
                        event.target.value = '';
                    }
                });



                batchImportBtn.addEventListener('click', () => {
                    fileInput.click();
                });



                document.querySelector('#batch-add-tag-btn').addEventListener('click', () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    openTagAssignmentPopup(Array.from(selectedForBatch));
                });

                document.querySelector('#batch-remove-tag-btn').addEventListener('click', () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    openTagRemovalPopup(Array.from(selectedForBatch));
                });

                document.querySelector('#batch-rename-btn')?.addEventListener('click', () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    openBatchRenamePopup(Array.from(selectedForBatch));
                });

                manageTagsBtn.addEventListener('click', () => {
                    openManageTagsPopup();
                });

                try {
                    const { initAutoGroup, AUTO_GROUP_STOPWORDS, isTextMatchingCompositeSearch, sanitizeThemeTitle } = await import(`${baseDir}modules/auto-group.js`);
                    const autoGroupModule = initAutoGroup({
                        loadThemeTags,
                        saveThemeTags,
                        sanitizeSubtagThemeAssociations,
                        getValidInstalledThemeNames,
                        invalidateValidThemeNamesCache,
                        getAllParsedThemes: () => allParsedThemes,
                        getSelectedForBatch: () => selectedForBatch,
                        getFilteredThemes: () => (typeof filteredThemes !== 'undefined' ? filteredThemes : allParsedThemes),
                        getActiveTagAncestryPath: () => (typeof activeTagAncestryPath !== 'undefined' ? activeTagAncestryPath : []),
                        getAllDescendantTagIds: (id, tags) => getAllDescendantTagIds(id, tags),
                        getTagsForTheme: (tName, tags) => getTagsForTheme(tName, tags),
                        softRefreshUI: (names) => softRefreshUI(names),
                        renderTagsUI: () => renderTagsUI(),
                        updateActiveState: () => updateActiveState(),
                        callGenericPopup,
                        closePopup,
                        confirmAction,
                        toastr,
                        escapeHtml,
                        showLoader,
                        hideLoader
                    });
                    applyKeywordMappings = autoGroupModule.applyKeywordMappings;
                    openAutoGroupWizard = autoGroupModule.openAutoGroupWizard;
                    openAutoGroupBatchMatrix = autoGroupModule.openAutoGroupBatchMatrix;
                    runAutoGroupReviewStep = autoGroupModule.runAutoGroupReviewStep;
                    extractCandidateThemeGroups = autoGroupModule.extractCandidateThemeGroups;
                } catch (e) {
                    console.error('[Theme Manager] 智能分组模块加载失败:', e);
                }

                // ==========================================================
                // ========= 标签交互与管理弹窗 (模块化: modules/tag-ui.js) =========
                // ==========================================================
                let openTagKeywordsModal = () => {};
                let openManageTagsPopup = () => {};
                let openTagAssignmentPopup = () => {};
                let openTagRemovalPopup = () => {};

                try {
                    const { initTagUI } = await import(`${baseDir}modules/tag-ui.js`);
                    const tagUiModule = initTagUI({
                        loadThemeTags,
                        saveThemeTags,
                        isSubtagsEnabled,
                        getValidInstalledThemeNames,
                        escapeHtml,
                        getAdaptivePopoverBg,
                        softRefreshUI: (names) => softRefreshUI(names),
                        applyKeywordMappings: () => applyKeywordMappings(),
                        openAutoGroupWizard: () => openAutoGroupWizard(),
                        callGenericPopup,
                        toastr,
                        ENABLE_SUBTAGS_KEY,
                        getIsBatchEditMode: () => isBatchEditMode,
                        getSelectedForBatch: () => selectedForBatch,
                        resetBatchSelection: () => {
                            selectedForBatch.clear();
                            lastClickedThemeName = null;
                        }
                    });
                    openTagKeywordsModal = tagUiModule.openTagKeywordsModal;
                    openManageTagsPopup = tagUiModule.openManageTagsPopup;
                    openTagAssignmentPopup = tagUiModule.openTagAssignmentPopup;
                    openTagRemovalPopup = tagUiModule.openTagRemovalPopup;
                } catch (e) {
                    console.error('[Theme Manager] 标签UI模块加载失败:', e);
                }


                document.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);

                // --- 全选按钮 (Select All) ---
                const batchSelectAllBtn = managerPanel.querySelector('#batch-select-all-btn');
                if (batchSelectAllBtn) {
                    batchSelectAllBtn.addEventListener('click', () => {
                        const items = Array.from(contentWrapper.querySelectorAll('.theme-item')).filter(item => item.style.display !== 'none');
                        if (items.length === 0) {
                            toastr.info('当前列表中没有可选择的美化。');
                            return;
                        }
                        items.forEach(item => {
                            const val = item.dataset.value;
                            if (val) {
                                selectedForBatch.add(val);
                                item.classList.add('selected-for-batch');
                            }
                        });
                        toastr.info(`已全选当前列表中的 ${items.length} 个美化！`);
                    });
                }

                // --- 连选按钮 (Range / Connect Select) ---
                const batchSelectRangeBtn = managerPanel.querySelector('#batch-select-range-btn');
                if (batchSelectRangeBtn) {
                    batchSelectRangeBtn.addEventListener('click', () => {
                        const items = Array.from(contentWrapper.querySelectorAll('.theme-item')).filter(item => item.style.display !== 'none');
                        const selectedIndices = [];
                        items.forEach((item, index) => {
                            const val = item.dataset.value;
                            if (val && selectedForBatch.has(val)) {
                                selectedIndices.push(index);
                            }
                        });

                        if (selectedIndices.length < 2) {
                            toastr.info('请先至少手动点击/勾选 2 个美化卡片作为“起始”和“结束”项。');
                            return;
                        }

                        const start = selectedIndices[0];
                        const end = selectedIndices[selectedIndices.length - 1];

                        for (let i = start; i <= end; i++) {
                            const item = items[i];
                            const val = item.dataset.value;
                            if (val) {
                                selectedForBatch.add(val);
                                item.classList.add('selected-for-batch');
                            }
                        }

                        toastr.info(`连选成功！已覆盖区间内的 ${end - start + 1} 个美化。`);
                    });
                }

                // --- 反选按钮 (Invert Select) ---
                const batchInvertSelectBtn = managerPanel.querySelector('#batch-invert-select-btn');
                if (batchInvertSelectBtn) {
                    batchInvertSelectBtn.addEventListener('click', () => {
                        const items = Array.from(contentWrapper.querySelectorAll('.theme-item')).filter(item => item.style.display !== 'none');
                        if (items.length === 0) {
                            toastr.info('当前列表中没有可选择的美化。');
                            return;
                        }

                        items.forEach(item => {
                            const val = item.dataset.value;
                            if (val) {
                                if (selectedForBatch.has(val)) {
                                    selectedForBatch.delete(val);
                                    item.classList.remove('selected-for-batch');
                                } else {
                                    selectedForBatch.add(val);
                                    item.classList.add('selected-for-batch');
                                }
                            }
                        });

                        toastr.info(`反选成功！当前已选中 ${selectedForBatch.size} 项。`);
                    });
                }

                contentWrapper.addEventListener('click', async (event) => {
                    const target = event.target;
                    const button = target.closest('button');
                    if (!button && preventNextClick) {
                        preventNextClick = false;
                        return;
                    }
                    preventNextClick = false;
                    const themeItem = target.closest('.theme-item');

                    if (!themeItem) return;
                    const themeName = themeItem.dataset.value;

                    if (isBatchEditMode) {
                        if (event.shiftKey && lastClickedThemeName) {
                            const items = Array.from(contentWrapper.querySelectorAll('.theme-item')).filter(item => item.style.display !== 'none');
                            const lastIdx = items.findIndex(item => item.dataset.value === lastClickedThemeName);
                            const currentIdx = items.findIndex(item => item.dataset.value === themeName);
                            if (lastIdx !== -1 && currentIdx !== -1) {
                                const start = Math.min(lastIdx, currentIdx);
                                const end = Math.max(lastIdx, currentIdx);
                                const shouldSelect = !selectedForBatch.has(themeName);
                                for (let i = start; i <= end; i++) {
                                    const item = items[i];
                                    const val = item.dataset.value;
                                    if (shouldSelect) {
                                        selectedForBatch.add(val);
                                        item.classList.add('selected-for-batch');
                                    } else {
                                        selectedForBatch.delete(val);
                                        item.classList.remove('selected-for-batch');
                                    }
                                }
                            }
                        } else {
                            if (selectedForBatch.has(themeName)) {
                                selectedForBatch.delete(themeName);
                                themeItem.classList.remove('selected-for-batch');
                            } else {
                                selectedForBatch.add(themeName);
                                themeItem.classList.add('selected-for-batch');
                            }
                        }
                        lastClickedThemeName = themeName;
                    } else {
                        if (button && button.classList.contains('set-tag-btn')) {
                            openTagAssignmentPopup(themeName);
                            return;
                        }

                        if (button && button.classList.contains('link-bg-btn')) {
                            if (themeBackgroundBindings[themeName]) {
                                // 已经绑定了，这次点击是“解绑”
                                delete themeBackgroundBindings[themeName];
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                // 切换图标和状态
                                button.classList.remove('linked');
                                button.querySelector('i').className = 'fa-solid fa-link';
                                button.title = '关联背景图';
                            } else {
                                // 未绑定，进入绑定模式
                                isBindingMode = true;
                                themeNameToBind = themeName;
                                _bindingStartTime = Date.now();
                                if (_bindingTimeout) clearTimeout(_bindingTimeout);
                                _bindingTimeout = setTimeout(() => {
                                    if (isBindingMode) {
                                        isBindingMode = false;
                                        themeNameToBind = null;
                                        console.log('[Theme Manager] 背景关联模式超时自动退出');
                                    }
                                }, 60000);

                                // 异步延时打开背景抽屉，避免被当前按钮点击冒泡干扰
                                setTimeout(() => {
                                    const bgDrawer = document.querySelector('#Backgrounds');
                                    const toggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                                    if (toggleButton && (!bgDrawer || bgDrawer.classList.contains('closedDrawer'))) {
                                        toggleButton.click();
                                    }
                                }, 50);
                            }
                            return;
                        }

                        if (button && button.classList.contains('link-daynight-btn')) {
                            openDayNightPairModal(themeName);
                            return;
                        }

                        if (button && button.classList.contains('favorite-btn')) {
                            if (favoritesSet.has(themeName)) {
                                updateFavorites(favorites.filter(f => f !== themeName));
                                button.innerHTML = '<i class="fa-regular fa-star"></i>';
                            } else {
                                updateFavorites([...favorites, themeName]);
                                button.innerHTML = '<i class="fa-solid fa-star"></i>';
                            }
                            // 轻量更新：如果正在按收藏/未分类筛选则刷新列表可见性，否则不重建
                            if (activeTagFilters.has('__FAVORITES__')) {
                                filterThemeList();
                            }
                            return;
                        }

                        if (button && button.classList.contains('color-transfer-btn')) {
                            openColorTransferModal(themeName);
                            return;
                        }
                        else if (button && button.classList.contains('rename-btn')) {
                            const oldName = themeName;
                            const newName = await promptAction(`请输入新名称：`, oldName);
                            if (newName && newName.trim() && newName.trim() !== oldName) {
                                const finalNewName = newName.trim();
                                // 检查新名称是否已存在
                                if (allParsedThemes.some(t => t.value === finalNewName)) {
                                    toastr.warning(`主题 "${finalNewName}" 已存在，请使用其他名称。`);
                                    return;
                                }

                                showLoader();
                                try {
                                    // 1. 获取完整的主题对象（包含所有 CSS 与颜色字段，若内存缺少则向 API 重新拉取）
                                    let fullThemeObj = findThemeObject(oldName);
                                    if (!fullThemeObj || (!fullThemeObj.main_text_color && !fullThemeObj.custom_css)) {
                                        const allThemesFromAPI = await getAllThemesFromAPI();
                                        const fetched = allThemesFromAPI.find(t => t && t.name === oldName);
                                        if (fetched) fullThemeObj = fetched;
                                    }

                                    if (!fullThemeObj) {
                                        hideLoader();
                                        toastr.error(`无法获取主题「${oldName}」的完整配置数据，重命名失败！`);
                                        return;
                                    }

                                    const isActive = originalSelect.value === oldName;
                                    const cleanObj = normalizeThemeObject(fullThemeObj, finalNewName);
                                    const { mtime: _mtime, ...objectToSave } = { ...cleanObj, name: finalNewName, value: finalNewName };

                                    // 2. 写入新文件到磁盘
                                    await saveTheme(objectToSave);
                                    console.log(`[Theme Manager Rename] ✅ Step 1 新文件保存落盘成功: "${finalNewName}.json"`);

                                    // 3. 擦除旧物理文件
                                    const deleteOk = await deleteTheme(oldName, fullThemeObj);
                                    console.log(`[Theme Manager Rename] Step 2 旧文件物理擦除 ${deleteOk ? '成功' : '完成'}`);

                                    // 4. 同步更新本地 DOM、原生下拉框与内存数据
                                    manualUpdateOriginalSelect('rename', oldName, finalNewName);
                                    updateSTThemeMemory({ name: oldName }, 'delete');
                                    updateSTThemeMemory(objectToSave, 'add');
                                    allThemeObjectsMap.delete(oldName);
                                    allThemeObjectsMap.set(finalNewName, objectToSave);
                                    invalidateThemesCache();

                                    const favIndex = favorites.indexOf(oldName);
                                    if (favIndex > -1) {
                                        const updatedFavs = [...favorites];
                                        updatedFavs[favIndex] = finalNewName;
                                        updateFavorites(updatedFavs);
                                    }

                                    if (themeBackgroundBindings[oldName]) {
                                        themeBackgroundBindings[finalNewName] = themeBackgroundBindings[oldName];
                                        delete themeBackgroundBindings[oldName];
                                        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                    }

                                    // 同步更新标签数据中的主题名
                                    let tagsToUpdate = loadThemeTags();
                                    tagsToUpdate.forEach(tag => {
                                        if (tag.themes) {
                                            const idx = tag.themes.indexOf(oldName);
                                            if (idx > -1) tag.themes[idx] = finalNewName;
                                        }
                                    });
                                    saveThemeTags(tagsToUpdate);

                                    // 同步更新角色绑定的主题名
                                    let charBindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                                    let charBindingsChanged = false;
                                    Object.keys(charBindings).forEach(chid => {
                                        if (charBindings[chid] === oldName) {
                                            charBindings[chid] = finalNewName;
                                            charBindingsChanged = true;
                                        }
                                    });
                                    if (charBindingsChanged) {
                                        localStorage.setItem(CHARACTER_THEME_BINDINGS_KEY, JSON.stringify(charBindings));
                                    }

                                    // 同步更新自动切换主题设置
                                    if (typeof handleAutoThemeRenamed === 'function') {
                                        handleAutoThemeRenamed(oldName, finalNewName);
                                    }

                                    // 增量更新 UI
                                    softRenameThemeUI(oldName, finalNewName);

                                    // 若是当前激活主题，重新应用
                                    if (isActive) {
                                        originalSelect.value = finalNewName;
                                        applyThemeDirect(finalNewName);
                                    }
                                    updateActiveState();
                                    hideLoader();
                                    toastr.success(`已成功将「${oldName}」重命名为「${finalNewName}」！`);

                                } catch (e) {
                                    hideLoader();
                                    console.error(`[Theme Manager Rename] 重命名失败:`, e);
                                    toastr.error(`重命名失败: ${e.message || e}`);
                                }
                            }
                        }
                        else if (button && button.classList.contains('delete-btn')) {
                            const displayName = themeItem.querySelector('.theme-item-name-text')?.textContent || themeName;
                            const confirmed = await confirmAction(`确定要删除主题 "${displayName}" 吗？`);
                            if (confirmed) {
                                try {
                                    const isCurrentlyActive = originalSelect.value === themeName;
                                    // ⚠️ 必须在清内存前先取完整对象快照（deleteTheme 需要用 name 字段定位磁盘文件）
                                    const targetThemeObj = findThemeObject(themeName);

                                    // 先发起物理磁盘擦除（此时 ST 内存尚未清除，findThemeObject 可以找到准确数据）
                                    const deleteTask = deleteTheme(themeName, targetThemeObj);

                                    // 0ms 乐观 UI 删除：立刻从视口移除 DOM 节点并清除数据及关系映射
                                    manualUpdateOriginalSelect('delete', themeName);
                                    updateSTThemeMemory({ name: themeName }, 'delete');
                                    softDeleteThemeUI(themeName);

                                    if (themeBackgroundBindings[themeName]) {
                                        delete themeBackgroundBindings[themeName];
                                        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                    }

                                    // 清理收藏
                                    updateFavorites(favorites.filter(f => f !== themeName));

                                    // 清理标签数据
                                    let tagsToUpdate = loadThemeTags();
                                    tagsToUpdate.forEach(tag => {
                                        if (tag.themes) {
                                            const idx = tag.themes.indexOf(themeName);
                                            if (idx > -1) tag.themes.splice(idx, 1);
                                        }
                                    });
                                    saveThemeTags(tagsToUpdate);

                                    // 清理角色绑定的主题
                                    let charBindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                                    let charBindingsChanged = false;
                                    Object.keys(charBindings).forEach(chid => {
                                        if (charBindings[chid] === themeName) {
                                            delete charBindings[chid];
                                            charBindingsChanged = true;
                                        }
                                    });
                                    if (charBindingsChanged) {
                                        localStorage.setItem(CHARACTER_THEME_BINDINGS_KEY, JSON.stringify(charBindings));
                                    }

                                    // 清理自动切换主题设置的选中主题与独立日夜对
                                    if (typeof handleAutoThemeDeleted === 'function') {
                                        handleAutoThemeDeleted(themeName);
                                    }

                                    if (isCurrentlyActive) {
                                        const azureOption = findOptionByValue(originalSelect, 'Azure');
                                        const fallbackName = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                                        if (fallbackName) {
                                            applyThemeDirect(fallbackName);
                                        }
                                    }
                                    invalidateThemesCache();
                                    renderTagsUI();
                                    updateActiveState();

                                    deleteTask.then(isDeleted => {
                                        if (isDeleted) {
                                            toastr.success(`主题 "${themeName}" 已成功从磁盘及系统中删除！`);
                                        } else {
                                            console.error(`[Theme Manager Delete ERROR] ❌ 主题 "${themeName}" 界面已移除，但物理文件未能成功在磁盘擦除！详见上方控制台日志。`);
                                            toastr.error(`主题 "${themeName}" 物理擦除失败，请按 F12 查看控制台。`);
                                        }
                                    }).catch(err => console.error('[Theme Manager Delete Async Error]:', err));
                                } catch (err) {
                                    console.error('[Theme Manager Delete Error]:', err);
                                    toastr.error('删除美化时发生异常，请查看控制台。');
                                }
                            }
                        } else {
                            applyThemeDirect(themeName);
                            updateActiveState();
                        }
                    }
                });

                // 移动端长按连选逻辑
                contentWrapper.addEventListener('touchstart', (event) => {
                    if (!isBatchEditMode) return;
                    const themeItem = event.target.closest('.theme-item');
                    if (!themeItem) return;

                    const themeName = themeItem.dataset.value;
                    const touch = event.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;

                    if (touchTimer) clearTimeout(touchTimer);

                    touchTimer = setTimeout(() => {
                        preventNextClick = true;
                        touchTimer = null;

                        // 震动反馈
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }

                        // 连选逻辑
                        if (lastClickedThemeName && lastClickedThemeName !== themeName) {
                            const items = Array.from(contentWrapper.querySelectorAll('.theme-item')).filter(item => item.style.display !== 'none');
                            const lastIdx = items.findIndex(item => item.dataset.value === lastClickedThemeName);
                            const currentIdx = items.findIndex(item => item.dataset.value === themeName);
                            if (lastIdx !== -1 && currentIdx !== -1) {
                                const start = Math.min(lastIdx, currentIdx);
                                const end = Math.max(lastIdx, currentIdx);
                                const shouldSelect = !selectedForBatch.has(themeName);
                                for (let i = start; i <= end; i++) {
                                    const item = items[i];
                                    const val = item.dataset.value;
                                    if (shouldSelect) {
                                        selectedForBatch.add(val);
                                        item.classList.add('selected-for-batch');
                                    } else {
                                        selectedForBatch.delete(val);
                                        item.classList.remove('selected-for-batch');
                                    }
                                }
                            }
                        } else {
                            if (selectedForBatch.has(themeName)) {
                                selectedForBatch.delete(themeName);
                                themeItem.classList.remove('selected-for-batch');
                            } else {
                                selectedForBatch.add(themeName);
                                themeItem.classList.add('selected-for-batch');
                            }
                        }
                        lastClickedThemeName = themeName;
                    }, 500);
                }, { passive: true });

                contentWrapper.addEventListener('touchmove', (event) => {
                    if (touchTimer) {
                        const touch = event.touches[0];
                        const deltaX = touch.clientX - touchStartX;
                        const deltaY = touch.clientY - touchStartY;
                        if (Math.sqrt(deltaX * deltaX + deltaY * deltaY) > 10) {
                            clearTimeout(touchTimer);
                            touchTimer = null;
                        }
                    }
                }, { passive: true });

                contentWrapper.addEventListener('touchend', () => {
                    if (touchTimer) {
                        clearTimeout(touchTimer);
                        touchTimer = null;
                    }
                });

                contentWrapper.addEventListener('touchcancel', () => {
                    if (touchTimer) {
                        clearTimeout(touchTimer);
                        touchTimer = null;
                    }
                });

                contentWrapper.addEventListener('scroll', () => {
                    if (listMode !== 'scroll') return;
                    if (contentWrapper.scrollHeight - contentWrapper.scrollTop - contentWrapper.clientHeight < 120) {
                        renderNextChunk();
                    }
                }, { passive: true });

                originalSelect.addEventListener('change', (event) => {
                    const newThemeName = event.target.value;
                    if (!newThemeName) return;

                    // 若是由外部/用户在原生下拉框直接选择主题（非 applyThemeDirect 程序内触发），统一走纯净切换引擎
                    if (!_isSwitchingTheme) {
                        applyThemeDirect(newThemeName);
                        return;
                    }

                    updateActiveState();
                    // 使用次数统计
                    if (newThemeName) {
                        usageCount[newThemeName] = (usageCount[newThemeName] || 0) + 1;
                        localStorage.setItem(USAGE_COUNT_KEY, JSON.stringify(usageCount));
                        // 实时更新 DOM 中的次数显示
                        if (showUsageCount) {
                            const item = themeItemMap.get(newThemeName);
                            if (item) {
                                const usageSpan = item.children[0].querySelector('.theme-usage-count');
                                if (usageSpan) {
                                    usageSpan.textContent = usageCount[newThemeName];
                                    usageSpan.style.display = '';
                                }
                            }
                        }
                    }
                    const boundBg = themeBackgroundBindings[newThemeName];
                    if (boundBg) {
                        applyBackgroundDirectly(boundBg);
                    }
                });

                const observer = new MutationObserver((mutations) => {
                    if (_suspendObserver) return;
                    debouncedBuildThemeUI(300);
                });
                observer.observe(originalSelect, { childList: true }); // 仅监听 option 增减，移除 characterData 避免文本变化误触发重建

                const bgMenuContent = document.getElementById('bg_menu_content');
                const bgCustomContent = document.getElementById('bg_custom_content');

                const bgObserverCallback = async (e) => {
                    if (!isBindingMode) return;

                    // 1. 保护期判定：在刚触发绑定模式的短时间内（如 800ms 内），因程序自动调用 toggleButton.click() 打开背景抽屉，
                    // 产生的 drawer-toggle 点击事件绝对不能取消绑定模式！
                    const isRecentActivation = Date.now() - _bindingStartTime < 800;

                    // 2. 检查点击是否发生在背景抽屉相关区域（抽屉本体、抽屉切换按钮、文件夹瓦片、返回按钮、Tab选项卡等）
                    const isWithinBackgroundArea = Boolean(e.target.closest('#Backgrounds, #backgrounds-drawer-toggle, #logo_block, .bg_folder_tile, #bg_back_to_folders, #bg_tabs, .ui-tabs-nav, .bg_example, [bgfile]'));

                    if (!isWithinBackgroundArea) {
                        // 如果点击在背景抽屉外部的其它主要交互区域，且已过初始保护期，退出关联模式
                        if (!isRecentActivation && e.target.closest('#rm_print_characters_block, #send_textarea, #right-nav-panel, #sheld')) {
                            console.log('[Theme Manager] 用户点击了外部区域，安全退出背景图关联模式');
                            isBindingMode = false;
                            themeNameToBind = null;
                            if (_bindingTimeout) clearTimeout(_bindingTimeout);
                        }
                        return;
                    }

                    // 3. 如果点击了文件夹钻取、返回文件夹、Tab标签切换或卡片上的辅助小按钮，放行其原生操作，不中断绑定模式
                    if (e.target.closest('.bg_folder_tile, #bg_back_to_folders, .ui-tabs-anchor, .jg-button, .mobile-only-menu-toggle')) {
                        return;
                    }

                    // 4. 检查是否点击了具体的背景图卡片
                    const bgElement = e.target.closest('.bg_example, [bgfile], [data-bgfile]');
                    if (!bgElement) {
                        // 点击的是背景抽屉内的空白处、滚动条或工具栏，不拦截、不退出
                        return;
                    }

                    // 5. 命中背景卡片，拦截原生选择行为并执行关联
                    e.preventDefault();
                    e.stopPropagation();
                    if (_bindingTimeout) {
                        clearTimeout(_bindingTimeout);
                        _bindingTimeout = null;
                    }

                    const bgFileName = bgElement.getAttribute('bgfile')
                        || bgElement.dataset?.bgfile
                        || bgElement.getAttribute('data-bgfile')
                        || (typeof $ !== 'undefined' ? $(bgElement).attr('bgfile') : null)
                        || bgElement.querySelector('[bgfile]')?.getAttribute('bgfile');

                    if (!bgFileName) {
                        console.warn('[Theme Manager] 未能从所点击的卡片中获取背景文件名:', bgElement);
                        return;
                    }

                    const currentThemeToBind = themeNameToBind;
                    if (!currentThemeToBind) {
                        console.warn('[Theme Manager] 关联失败：themeNameToBind 为空');
                        isBindingMode = false;
                        return;
                    }

                    // 写入持久化存储
                    themeBackgroundBindings[currentThemeToBind] = bgFileName;
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    // 解除绑定模式
                    isBindingMode = false;
                    themeNameToBind = null;

                    // 如果当前关联的主题正是正在使用的主题，立即调用双模引擎应用背景
                    if (currentThemeToBind === originalSelect?.value) {
                        applyBackgroundDirectly(bgFileName);
                    }

                    // 轻量级更新主题项 UI 状态
                    const themeItem = themeItemMap.get(currentThemeToBind);
                    if (themeItem) {
                        const linkBtn = themeItem.querySelector('.link-bg-btn');
                        if (linkBtn) {
                            linkBtn.classList.add('linked');
                            const icon = linkBtn.querySelector('i');
                            if (icon) {
                                icon.className = 'fa-solid fa-link-slash';
                            }
                            linkBtn.title = '取消背景图关联';
                        }
                    }

                    // 平滑返回：先关闭背景抽屉，再切回设置面板
                    setTimeout(() => {
                        const bgDrawer = document.querySelector('#Backgrounds');
                        if (bgDrawer && !bgDrawer.classList.contains('closedDrawer')) {
                            const bgToggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                            if (bgToggleButton) {
                                bgToggleButton.click();
                            }
                        }

                        setTimeout(() => {
                            const userSettingsPanel = document.querySelector('#user-settings-block');
                            if (userSettingsPanel && userSettingsPanel.classList.contains('closedDrawer')) {
                                const settingsToggleButton = document.querySelector('#user-settings-button .drawer-toggle') || document.querySelector('#user-settings-button');
                                if (settingsToggleButton) {
                                    settingsToggleButton.click();
                                }
                            }
                        }, 120);
                    }, 150);
                };
                // 使用全局 document 捕获阶段事件委托，无论背景抽屉何时挂载/卸载/冻结/解冻，均能稳定捕获卡片点击
                document.addEventListener('click', bgObserverCallback, true);

                // 按 ESC 键随时安全退出背景绑定模式，防止状态卡死
                window.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && isBindingMode) {
                        isBindingMode = false;
                        themeNameToBind = null;
                        if (_bindingTimeout) clearTimeout(_bindingTimeout);
                    }
                }, true);

                // ==========================================================
                // ========= 角色卡绑定美化 (模块化解耦引入 modules/character-binding.js) =========
                // ==========================================================
                let getThemeForTarget = null;
                let applyBoundThemeForCharacter = null;
                let getAvatarFilename = null;

                try {
                    const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                    const { initCharacterBinding } = await import(`${baseDir}modules/character-binding.js`);
                    const cbModule = initCharacterBinding({
                        CHARACTER_THEME_BINDINGS_KEY,
                        loadThemeTags,
                        allParsedThemes,
                        stKnownThemes,
                        themeBackgroundBindings,
                        applyThemeDirect,
                        updateActiveState,
                        applyBackgroundDirectly,
                        escapeHtml
                    });
                    getThemeForTarget = cbModule.getThemeForTarget;
                    applyBoundThemeForCharacter = cbModule.applyBoundThemeForCharacter;
                    getAvatarFilename = cbModule.getAvatarFilename;
                } catch (e) {
                    console.error('[Theme Manager] 角色绑定模块加载失败:', e);
                }

                // ==========================================================
                // ======= 日夜自动随动与配对 (模块化: modules/auto-theme.js) =======
                // ==========================================================
                let autoModule = null;
                try {
                    const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                    const { initAutoTheme } = await import(`${baseDir}modules/auto-theme.js`);
                    autoModule = initAutoTheme({
                        AUTO_THEME_KEY,
                        THEME_DAY_NIGHT_PAIRS_KEY,
                        managerPanel,
                        originalSelect,
                        allParsedThemes,
                        themeItemMap,
                        loadThemeTags,
                        getThemeForTarget,
                        applyThemeDirect,
                        applyBackgroundDirectly,
                        themeBackgroundBindings,
                        escapeHtml
                    });
                    executeManualThemeToggle = autoModule.executeManualThemeToggle;
                    updateThemeItemDayNightState = autoModule.updateThemeItemDayNightState;
                    openDayNightPairModal = autoModule.openDayNightPairModal;
                    applyAutoThemeLoop = autoModule.applyAutoThemeLoop;
                    updateManualToggleBtnVisibility = autoModule.updateManualToggleBtnVisibility;
                    handleAutoThemeRenamed = autoModule.handleThemeRenamed;
                    handleAutoThemeDeleted = autoModule.handleThemeDeleted;
                    getPairForTheme = autoModule.getPairForTheme;
                    saveThemeDayNightPairs = autoModule.saveThemeDayNightPairs;
                    loadThemeDayNightPairs = autoModule.loadThemeDayNightPairs;
                } catch (e) {
                    console.error('[Theme Manager] 自动主题切换模块加载失败:', e);
                }

                async function initBackgroundEnhancements() {
                    try {
                        const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                        const { initBackgroundEnhancements: initBg } = await import(`${baseDir}modules/background-batch.js`);
                        if (typeof initBg === 'function') {
                            initBg({ getRequestHeaders, showLoader, hideLoader, limitConcurrency });
                        }
                    } catch (e) {
                        console.error('[Theme Manager] 加载背景批量增强模块失败:', e);
                    }
                }

                // ==========================================================
                // ======================= 功能结束 =========================
                // ==========================================================


                buildThemeUI().then(() => {
                    applyAutoThemeLoop();
                    initBackgroundEnhancements();

                    // 监听聊天切换事件，在 SillyTavern 重置背景后重新应用绑定的背景图
                    // 解决移动端进入角色卡聊天时背景图被 onChatChanged() 覆盖的问题
                    // 监听聊天与角色切换事件，实现角色绑定的美化自动切换
                    if (eventSource && eventTypes) {
                        console.log(`[Theme Manager Debug] Event source & event types found. Registering listeners.`);
                        eventSource.on(eventTypes.CHAT_CHANGED, () => {
                            console.log(`[Theme Manager Debug] CHAT_CHANGED event fired`);
                            const currentTheme = originalSelect.value;
                            const boundBg = themeBackgroundBindings[currentTheme];
                            if (boundBg) {
                                // 短延迟确保在 SillyTavern 的 onChatChanged 完成后再应用
                                setTimeout(() => applyBackgroundDirectly(boundBg), 300);
                            }
                        });

                        eventSource.on(eventTypes.CHARACTER_SELECTED, () => {
                            console.log(`[Theme Manager Debug] CHARACTER_SELECTED event fired`);
                            const { characters, characterId } = SillyTavern.getContext();
                            const character = characters[characterId];
                            if (character && character.avatar) {
                                console.log(`[Theme Manager Debug] CHARACTER_SELECTED avatar:`, character.avatar);
                                // 短延时确保上下文就绪
                                setTimeout(() => applyBoundThemeForCharacter(character.avatar), 100);
                            } else {
                                console.log(`[Theme Manager Debug] CHARACTER_SELECTED: no character or avatar. ID:`, characterId);
                            }
                        });
                    } else {
                        console.warn(`[Theme Manager Debug] eventSource or eventTypes not found!`);
                    }

                    // 首次载入时，自动应用当前选中角色的绑定主题
                    try {
                        const { characters, characterId } = SillyTavern.getContext();
                        const character = characters[characterId];
                        console.log(`[Theme Manager Debug] Startup character avatar:`, character ? character.avatar : 'none');
                        if (character && character.avatar) {
                            applyBoundThemeForCharacter(character.avatar);
                        }
                    } catch (e) {
                        console.warn('[Theme Manager] 首次载入应用绑定美化失败:', e);
                    }


                    const isInitiallyCollapsed = localStorage.getItem(COLLAPSE_KEY) !== 'false';
                    setCollapsed(isInitiallyCollapsed, false);

                    // === 加载独立的 avatar-settings.js 头像高级调整脚本 ===
                    const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                    const avatarScript = document.createElement('script');
                    avatarScript.src = `${baseDir}avatar-settings.js?v=${Date.now()}`;
                    avatarScript.defer = true;
                    document.head.appendChild(avatarScript);

                    // === 首次安装运行提示 (加载独立的 first-run.js 脚本) ===
                    const firstRunShownKey = 'themeManager_firstRunNotificationShown';
                    if (!localStorage.getItem(firstRunShownKey)) {
                        // 使用标准 ES Module 的 import.meta.url 获取当前脚本的绝对路径目录，确保在安装和任何目录下均能 100% 成功加载
                        const baseDir = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
                        const script = document.createElement('script');
                        // 增加时间戳查询参数以避免浏览器缓存旧版 JS 脚本
                        script.src = `${baseDir}first-run.js?v=${Date.now()}`;
                        script.defer = true;
                        document.head.appendChild(script);
                    }
                });

            } catch (error) {
                console.error("Theme Manager: 初始化过程中发生错误:", error);
            }
        }
    }, 250);
})();

