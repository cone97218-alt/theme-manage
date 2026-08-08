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
            let hasOption = false;
            for (let i = 0; i < originalSelect.options.length; i++) {
                if (originalSelect.options[i].value === target) {
                    hasOption = true;
                    break;
                }
            }
            if (hasOption) themeToApply = target;
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
                        const bg1 = document.querySelector('#bg1');
                        if (bg1) {
                            const currentBg = bg1.style.backgroundImage;
                            const targetUrl = `backgrounds/${encodeURIComponent(boundBg)}`;
                            if (currentBg && (currentBg.includes(targetUrl) || currentBg.includes(boundBg))) {
                                return; // 背景已正确设置，直接跳过，避免重复点击与重排
                            }
                        }

                        const escapedBg = CSS.escape(boundBg);
                        const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${escapedBg}"], #bg_custom_content .bg_example[bgfile="${escapedBg}"]`);
                        if (bgElement) {
                            bgElement.click();
                        } else if (bg1) {
                            bg1.style.backgroundImage = `url("backgrounds/${encodeURIComponent(boundBg)}")`;
                        }
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

    const initInterval = setInterval(() => {
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

                let isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
                let themeDayNightPairs = loadThemeDayNightPairs();
                let enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false'; // 默认开启 (true)

                function loadThemeDayNightPairs() {
                    try {
                        const raw = JSON.parse(localStorage.getItem(THEME_DAY_NIGHT_PAIRS_KEY));
                        if (Array.isArray(raw)) {
                            return raw.filter(p => p && (p.dayTheme || p.nightTheme));
                        }
                        if (raw && typeof raw === 'object') {
                            // 兼容性迁移：将旧版字典模式自动平滑迁移为统一日夜组数组模式
                            const list = [];
                            const processed = new Set();
                            Object.keys(raw).forEach(k => {
                                const targetNight = raw[k]?.nightTarget;
                                const targetDay = raw[k]?.dayTarget;
                                if (targetNight && !processed.has(`${k}-${targetNight}`)) {
                                    list.push({ dayTheme: k, nightTheme: targetNight });
                                    processed.add(`${k}-${targetNight}`);
                                    processed.add(`${targetNight}-${k}`);
                                }
                                if (targetDay && !processed.has(`${targetDay}-${k}`)) {
                                    list.push({ dayTheme: targetDay, nightTheme: k });
                                    processed.add(`${targetDay}-${k}`);
                                    processed.add(`${k}-${targetDay}`);
                                }
                            });
                            localStorage.setItem(THEME_DAY_NIGHT_PAIRS_KEY, JSON.stringify(list));
                            return list;
                        }
                    } catch (e) {}
                    return [];
                }

                function saveThemeDayNightPairs(pairs) {
                    themeDayNightPairs = pairs;
                    localStorage.setItem(THEME_DAY_NIGHT_PAIRS_KEY, JSON.stringify(themeDayNightPairs));
                }

                function getPairForTheme(themeName) {
                    if (!themeName || !Array.isArray(themeDayNightPairs)) return null;
                    return themeDayNightPairs.find(p => p && (p.dayTheme === themeName || p.nightTheme === themeName)) || null;
                }

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

                async function apiRequest(endpoint, method = 'POST', body = {}, suppressToast = false) {
                    try {
                        const headers = getRequestHeaders() || {};
                        if (!headers['Content-Type'] && !headers['content-type']) {
                            headers['Content-Type'] = 'application/json';
                        }
                        const options = { method, headers, body: JSON.stringify(body) };
                        const response = await fetch(`/api/${endpoint}`, options);
                        const responseText = await response.text();
                        if (!response.ok) {
                            throw new Error(responseText || `HTTP error! status: ${response.status}`);
                        }
                        if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
                        return responseText ? JSON.parse(responseText) : {};
                    } catch (error) {
                        console.error(`API request to /api/${endpoint} failed:`, error);
                        if (!suppressToast) {
                            toastr.error(`API请求失败: ${error.message}`);
                        }
                        throw error;
                    }
                }

                async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }
                async function deleteTheme(themeName, themeObjParam = null) {
                    if (!themeName) return false;

                    console.log(`[Theme Manager Delete] ══════════════════════════════════════`);
                    console.log(`[Theme Manager Delete] 开始擦除物理文件: "${themeName}"`);

                    const candidateSet = new Set();
                    const addNameVariants = (str) => {
                        if (!str || typeof str !== 'string') return;
                        const raw = str.trim();
                        if (!raw) return;

                        const baseList = new Set();
                        baseList.add(raw);

                        // 标准 OS 文件名 sanitize 变体 (剔除非法 OS 字符)
                        const sanitized = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
                        if (sanitized) baseList.add(sanitized);

                        // 变体 A: 剥离括号符号 (例如: "【Miao & Game】 360px" -> "Miao & Game 360px")
                        const unbracketed = raw.replace(/[\[\]【】（）()《》<>]/g, ' ').replace(/\s+/g, ' ').trim();
                        if (unbracketed) baseList.add(unbracketed);

                        // 变体 B: 剥离括号及其内部内容 (例如: "【Miao & Game】 360px" -> "360px")
                        const cleanOuter = raw.replace(/([\[【（(《<].*?[\]】）)》>])/g, '').trim();
                        if (cleanOuter) baseList.add(cleanOuter);

                        // 变体 C: 提取括号内部文本 (例如: "【Miao & Game】 360px" -> "Miao & Game")
                        const bracketMatches = raw.match(/([\[【（(《<].*?[\]】）)》>])/g);
                        if (bracketMatches) {
                            bracketMatches.forEach(bm => {
                                const inner = bm.replace(/[\[\]【】（）()《》<>]/g, '').trim();
                                if (inner) baseList.add(inner);
                            });
                        }

                        baseList.forEach(v => {
                            if (!v) return;
                            const noExt = v.replace(/\.json$/i, '').trim();
                            if (!noExt) return;

                            candidateSet.add(noExt);
                            candidateSet.add(noExt.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim());

                            if (noExt.includes('&amp;')) candidateSet.add(noExt.replace(/&amp;/g, '&'));
                            if (noExt.includes('&')) {
                                candidateSet.add(noExt.replace(/&/g, 'and'));
                                candidateSet.add(noExt.replace(/&/g, ' '));
                                candidateSet.add(noExt.replace(/\s*&\s*/g, '_&_'));
                                candidateSet.add(noExt.replace(/\s*&\s*/g, '_and_'));
                            }
                            if (noExt.includes(' ') || noExt.includes('_')) {
                                candidateSet.add(noExt.replace(/\s+/g, '_'));
                                candidateSet.add(noExt.replace(/_/g, ' '));
                            }
                            if (noExt.includes(' ') || noExt.includes('-')) {
                                candidateSet.add(noExt.replace(/\s+/g, '-'));
                                candidateSet.add(noExt.replace(/-/g, ' '));
                            }
                        });
                    };

                    if (themeObjParam) {
                        if (themeObjParam.name) addNameVariants(themeObjParam.name);
                        if (themeObjParam.value) addNameVariants(themeObjParam.value);
                    }
                    const stObj = findThemeObject(themeName);
                    if (stObj) {
                        if (stObj.name) addNameVariants(stObj.name);
                        if (stObj.value) addNameVariants(stObj.value);
                    }
                    addNameVariants(themeName);

                    const candidates = Array.from(candidateSet).filter(Boolean);
                    console.log(`[Theme Manager Delete] 📋 试探磁盘候选文件名 (${candidates.length} 个):`, candidates);

                    let isDeletedOnDisk = false;

                    for (const candidateName of candidates) {
                        try {
                            await apiRequest('themes/delete', 'POST', { name: candidateName }, true);
                            isDeletedOnDisk = true;
                            console.log(`[Theme Manager Delete] ✅ 成功擦除磁盘文件: "${candidateName}.json"`);
                            break;
                        } catch (err) {
                            // 继续下一个候选试探
                        }
                    }

                    if (!isDeletedOnDisk) {
                        console.warn(`[Theme Manager Delete] ⚠️ 所有试探候选名均未命中磁盘文件，可能文件已被手动删除。候选名:`, candidates);
                    }

                    // 同步清理 ST 内存
                    updateSTThemeMemory({ name: themeName }, 'delete', themeName);
                    console.log(`[Theme Manager Delete] ══════════════════════════════════════`);
                    return isDeletedOnDisk;
                }
                // 从 ST 内存里找到某主题的完整数据对象（包含颜色、CSS 等所有字段）
                function findThemeObject(themeName) {
                    if (!themeName) return null;
                    const raw = String(themeName).trim();

                    // 1. 先从本扩展的内存缓存里直接命中
                    const fromMap = allThemeObjectsMap.get(raw);
                    if (fromMap) return fromMap;

                    // 2. 从 ST 全局 themes 数组里查找（这里存的是包含完整字段的对象）
                    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                        const ctx = SillyTavern.getContext();
                        const stThemes = ctx?.themes || ctx?.power_user?.themes;
                        if (Array.isArray(stThemes)) {
                            const found = stThemes.find(t => t && t.name === raw);
                            if (found) return found;
                        }
                    }

                    // 3. 全局 power_user 对象
                    if (typeof power_user !== 'undefined' && Array.isArray(power_user.themes)) {
                        const found = power_user.themes.find(t => t && t.name === raw);
                        if (found) return found;
                    }

                    return null;
                }

                // 直接把主题对象写盘（对象里必须包含 name 字段和完整样式字段）
                async function saveTheme(themeObject) {
                    if (!themeObject || !themeObject.name) {
                        console.error('[Theme Manager] saveTheme: 传入的对象无效或缺少 name', themeObject);
                        return;
                    }
                    console.log(`[Theme Manager] saveTheme → 写入 "${themeObject.name}.json"`);
                    await apiRequest('themes/save', 'POST', themeObject);
                    console.log(`[Theme Manager] saveTheme ✅ 写入成功: "${themeObject.name}.json"`);
                }

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
                                            setTimeout(() => { input.focus(); input.select(); }, 100);
                                        }
                                    }
                                }
                            });
                            if (res === 1 || res === true || (res && res.result === 1)) {
                                const inputEl = document.querySelector(`#${inputId}`);
                                return inputEl ? inputEl.value : defaultValue;
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

                function sortThemes(themes, sortBy) {
                    const sorted = [...themes];
                    if (sortBy === 'name-asc') {
                        sorted.sort((a, b) => a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' }));
                    } else if (sortBy === 'name-desc') {
                        sorted.sort((a, b) => b.display.localeCompare(a.display, undefined, { numeric: true, sensitivity: 'base' }));
                    } else if (sortBy === 'favorite-first') {
                        sorted.sort((a, b) => {
                            const aFav = favoritesSet.has(a.value);
                            const bFav = favoritesSet.has(b.value);
                            if (aFav && !bFav) return -1;
                            if (!aFav && bFav) return 1;
                            return a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
                        });
                    } else if (sortBy === 'time-desc') {
                        sorted.sort((a, b) => {
                            const diff = (b.mtime || 0) - (a.mtime || 0);
                            if (diff !== 0) return diff;
                            return a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
                        });
                    } else if (sortBy === 'time-asc') {
                        sorted.sort((a, b) => {
                            const diff = (a.mtime || 0) - (b.mtime || 0);
                            if (diff !== 0) return diff;
                            return a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
                        });
                    } else if (sortBy === 'usage-desc') {
                        sorted.sort((a, b) => {
                            const diff = (usageCount[b.value] || 0) - (usageCount[a.value] || 0);
                            if (diff !== 0) return diff;
                            return a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
                        });
                    } else if (sortBy === 'usage-asc') {
                        sorted.sort((a, b) => {
                            const diff = (usageCount[a.value] || 0) - (usageCount[b.value] || 0);
                            if (diff !== 0) return diff;
                            return a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
                        });
                    }
                    return sorted;
                }

                function findOptionByValue(selectEl, value) {
                    return Array.from(selectEl.options).find(opt => opt.value === value) || null;
                }

                // MutationObserver 暂停标记（在手动操作 originalSelect 时避免冗余重建）
                let _suspendObserver = false;

                // buildThemeUI 防抖
                let _buildThemeUITimer = null;
                function debouncedBuildThemeUI(delay = 200) {
                    clearTimeout(_buildThemeUITimer);
                    _buildThemeUITimer = setTimeout(() => buildThemeUI(), delay);
                }

                // API 缓存
                let _themesCache = null;
                let _themesCacheTime = 0;
                const CACHE_TTL = 5000; // 5秒缓存
                async function getCachedThemes() {
                    const now = Date.now();
                    if (_themesCache && (now - _themesCacheTime) < CACHE_TTL) {
                        return _themesCache;
                    }
                    _themesCache = await getAllThemesFromAPI();
                    _themesCacheTime = now;
                    return _themesCache;
                }
                function invalidateThemesCache() {
                    _themesCache = null;
                    _themesCacheTime = 0;
                }

                // 双重触发展示与 jQuery 原生 change 事件，保证 ST 原生 $('#themes').on('change') 监听函数必被激活
                function triggerSelectChange(selectEl) {
                    if (!selectEl) return;
                    console.log(`[Theme Manager] 触发展示与原生 change 事件, 当前选中值: ${selectEl.value}`);
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    if (window.jQuery) {
                        try {
                            $(selectEl).trigger('change');
                            console.log('[Theme Manager] jQuery $(#themes).trigger("change") 执行成功');
                        } catch (e) {
                            console.error('[Theme Manager Error] jQuery trigger("change") 失败:', e);
                        }
                    }
                }

                // 剔除 #themes select 中的重复 option，从根源杜绝 DOM 节点与全量 UI 渲染产生同名重复卡片
                function deduplicateSelectOptions(selectEl) {
                    if (!selectEl || !selectEl.options) return;
                    const seen = new Set();
                    const options = Array.from(selectEl.options);
                    let removedCount = 0;
                    options.forEach(opt => {
                        if (!opt.value || seen.has(opt.value)) {
                            opt.remove();
                            removedCount++;
                        } else {
                            seen.add(opt.value);
                        }
                    });
                    if (removedCount > 0) {
                        console.log(`[Theme Manager] deduplicateSelectOptions 清理了 ${removedCount} 个重复 option 节点`);
                    }
                }

                function manualUpdateOriginalSelect(action, oldName, newName) {
                    const originalSelect = document.querySelector('#themes');
                    if (!originalSelect) return;
                    console.log(`[Theme Manager] manualUpdateOriginalSelect: action=${action}, oldName=${oldName}, newName=${newName}`);
                    _suspendObserver = true;
                    try {
                        if (action === 'add') {
                            const existingOption = findOptionByValue(originalSelect, newName);
                            if (!existingOption) {
                                const option = document.createElement('option');
                                option.value = newName; option.textContent = newName;
                                originalSelect.appendChild(option);
                            }
                            stKnownThemes.add(newName);
                        } else if (action === 'delete') {
                            const cleanName = oldName ? oldName.replace(/\[.*?\]/g, '').trim() : '';
                            Array.from(originalSelect.options).forEach(opt => {
                                if (opt.value === oldName || opt.value === cleanName || opt.textContent === oldName || opt.textContent === cleanName) {
                                    opt.remove();
                                }
                            });
                            stKnownThemes.delete(oldName);
                            if (cleanName) stKnownThemes.delete(cleanName);
                        } else if (action === 'rename') {
                            const optionToRename = findOptionByValue(originalSelect, oldName);
                            if (optionToRename) {
                                optionToRename.value = newName;
                                optionToRename.textContent = newName;
                            }
                            // 如果被重命名的是当前激活项，同步更新 select.value
                            if (originalSelect.value === oldName) {
                                originalSelect.value = newName;
                            }
                            stKnownThemes.delete(oldName);
                            stKnownThemes.add(newName);
                        }
                        deduplicateSelectOptions(originalSelect);
                    } finally {
                        setTimeout(() => { _suspendObserver = false; }, 0);
                    }
                }

                // === 动态同步 stKnownThemes 集合，防范导入/重命名新主题后识别为未知主题导致原生切换失效 ===
                function syncStKnownThemes() {
                    const originalSelect = document.querySelector('#themes');
                    if (originalSelect && originalSelect.options) {
                        Array.from(originalSelect.options).forEach(opt => {
                            if (opt.value) stKnownThemes.add(opt.value);
                        });
                    }
                }

                // === ST 原生 Custom CSS 编辑器与 CodeMirror 深度内存/DOM 双向同步助手 ===
                function syncCustomCssToST(customCss) {
                    const cssVal = customCss !== undefined && customCss !== null ? customCss : '';
                    console.log(`[Theme Manager] syncCustomCssToST 触发, 目标 CSS 字节数: ${cssVal.length}`);

                    // 1. 写入 ST 官方权威单一数据源 power_user.custom_css
                    try {
                        if (typeof power_user !== 'undefined') {
                            power_user.custom_css = cssVal;
                        }
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx && ctx.power_user) {
                                ctx.power_user.custom_css = cssVal;
                            }
                        }
                    } catch (e) {
                        console.error('[Theme Manager Error] 同步 power_user.custom_css 失败:', e);
                    }

                    // 2. 优先直接使用酒馆原生的 applyCustomCSS 官方渲染管道
                    try {
                        if (typeof applyCustomCSS === 'function') {
                            applyCustomCSS();
                        }
                    } catch (e) {}

                    // 3. 兜底同步酒馆原生 Custom CSS 文本框元素 DOM 与 CodeMirror 编辑器
                    const editorEl = document.querySelector('#customCSS') || document.querySelector('#style_custom_content') || document.querySelector('#custom_style') || document.querySelector('#style_custom');
                    if (editorEl) {
                        if (editorEl.value !== cssVal) {
                            editorEl.value = cssVal;
                            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
                            editorEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        if (editorEl.CodeMirror && editorEl.CodeMirror.getValue() !== cssVal) {
                            editorEl.CodeMirror.setValue(cssVal);
                        } else if (window.jQuery && $(editorEl).data('codemirror')) {
                            const cm = $(editorEl).data('codemirror');
                            if (cm && cm.getValue() !== cssVal) {
                                cm.setValue(cssVal);
                            }
                        }
                    }

                    // 4. 全局 CodeMirror DOM 实例兜底同步
                    try {
                        const cmDoms = document.querySelectorAll('.CodeMirror');
                        if (cmDoms.length > 0) {
                            cmDoms.forEach(cmDom => {
                                if (cmDom && cmDom.CodeMirror && cmDom.CodeMirror.getValue() !== cssVal) {
                                    cmDom.CodeMirror.setValue(cssVal);
                                }
                            });
                        }
                    } catch (e) {}

                    // 5. 确保原生 <style id="custom-style"> 标签节点同步刷新
                    let style = document.getElementById('custom-style');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'custom-style';
                        document.head.appendChild(style);
                    }
                    style.innerHTML = cssVal;
                }

                // === ST 内部内存同步助手（实现真正的热更新与落盘固化） ===
                function updateSTThemeMemory(themeObject, action = 'add', oldName = null) {
                    const targetName = themeObject ? (themeObject.name || themeObject.value) : oldName;
                    if (!targetName) return;

                    const cleanName = String(targetName).replace(/\[.*?\]/g, '').trim();
                    const exactNames = new Set([String(targetName)]);
                    if (cleanName) exactNames.add(cleanName);
                    if (themeObject && themeObject.name) exactNames.add(String(themeObject.name));
                    if (oldName) {
                        exactNames.add(String(oldName));
                        exactNames.add(String(oldName).replace(/\[.*?\]/g, '').trim());
                    }

                    const isMatch = (item) => {
                        if (!item) return false;
                        const itemStr = typeof item === 'string' ? item : (item.name || item.value || '');
                        return exactNames.has(String(itemStr));
                    };

                    try {
                        let updated = false;

                        const purgeFromArray = (arr) => {
                            if (!Array.isArray(arr)) return false;
                            let changed = false;
                            for (let i = arr.length - 1; i >= 0; i--) {
                                if (isMatch(arr[i])) {
                                    arr.splice(i, 1);
                                    changed = true;
                                }
                            }
                            return changed;
                        };

                        // 1. 同步 ST getContext 内存数组 (包括 ctx.themes 以及 ctx.power_user.themes)
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx) {
                                if (action === 'delete') {
                                    if (purgeFromArray(ctx.themes)) updated = true;
                                    if (ctx.power_user && purgeFromArray(ctx.power_user.themes)) updated = true;
                                } else if (action === 'rename' && oldName) {
                                    if (Array.isArray(ctx.themes)) {
                                        const idx = ctx.themes.findIndex(t => isMatch(t));
                                        if (idx !== -1) ctx.themes[idx] = themeObject;
                                        else ctx.themes.push(themeObject);
                                        updated = true;
                                    }
                                    if (ctx.power_user && Array.isArray(ctx.power_user.themes)) {
                                        const idx = ctx.power_user.themes.findIndex(t => isMatch(t));
                                        if (idx !== -1) ctx.power_user.themes[idx] = themeObject;
                                        else ctx.power_user.themes.push(themeObject);
                                        updated = true;
                                    }
                                } else if (action === 'add' || action === 'save') {
                                    if (Array.isArray(ctx.themes)) {
                                        const idx = ctx.themes.findIndex(t => isMatch(t));
                                        if (idx !== -1) ctx.themes[idx] = themeObject;
                                        else ctx.themes.push(themeObject);
                                        updated = true;
                                    }
                                    if (ctx.power_user && Array.isArray(ctx.power_user.themes)) {
                                        const idx = ctx.power_user.themes.findIndex(t => isMatch(t));
                                        if (idx !== -1) ctx.power_user.themes[idx] = themeObject;
                                        else ctx.power_user.themes.push(themeObject);
                                        updated = true;
                                    }
                                }
                            }
                        }

                        // 2. 同步全局 power_user 对象的 themes 数组
                        if (typeof power_user !== 'undefined' && power_user) {
                            if (action === 'delete') {
                                if (purgeFromArray(power_user.themes)) updated = true;
                            } else if (action === 'rename' && oldName) {
                                if (Array.isArray(power_user.themes)) {
                                    const idx = power_user.themes.findIndex(t => isMatch(t));
                                    if (idx !== -1) power_user.themes[idx] = themeObject;
                                    else power_user.themes.push(themeObject);
                                    updated = true;
                                }
                            } else if (action === 'add' || action === 'save') {
                                if (Array.isArray(power_user.themes)) {
                                    const idx = power_user.themes.findIndex(t => isMatch(t));
                                    if (idx !== -1) power_user.themes[idx] = themeObject;
                                    else power_user.themes.push(themeObject);
                                    updated = true;
                                }
                            }
                        }

                        // 3. 同步全局 themes 数组 (针对旧版与手机端全局变量)
                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            if (action === 'delete') {
                                if (purgeFromArray(themes)) updated = true;
                            } else if (action === 'rename' && oldName) {
                                const idx = themes.findIndex(t => isMatch(t));
                                if (idx !== -1) themes[idx] = themeObject;
                                else themes.push(themeObject);
                                updated = true;
                            } else if (action === 'add' || action === 'save') {
                                const idx = themes.findIndex(t => isMatch(t));
                                if (idx !== -1) themes[idx] = themeObject;
                                else themes.push(themeObject);
                                updated = true;
                            }
                        }
                        if (typeof window !== 'undefined' && Array.isArray(window.themes)) {
                            if (action === 'delete') {
                                if (purgeFromArray(window.themes)) updated = true;
                            }
                        }

                        // 4. 固化持久写入磁盘 settings.json 文件
                        if (updated || action === 'delete') {
                            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                                const ctx = SillyTavern.getContext();
                                if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                                else if (ctx.saveSettings) ctx.saveSettings();
                            } else if (typeof saveSettingsDebounced === 'function') {
                                saveSettingsDebounced();
                            } else if (typeof saveSettings === 'function') {
                                saveSettings();
                            }
                        }
                    } catch (e) {
                        console.error('[Theme Manager Error] 同步 ST 内部主题内存失败:', e);
                    }
                }

                // UI 控件 DOM 缓存 (避免在切换新主题时反复进行昂贵的 querySelector)
                let _uiControlsCache = null;
                function getUIControls() {
                    if (!_uiControlsCache) {
                        _uiControlsCache = {};
                        const selectors = [
                            '#main-text-color-picker', '#italics-color-picker', '#underline-color-picker',
                            '#quote-color-picker', '#blur-tint-color-picker', '#chat-tint-color-picker',
                            '#user-mes-blur-tint-color-picker', '#bot-mes-blur-tint-color-picker',
                            '#shadow-color-picker', '#border-color-picker', '#blur_strength_counter',
                            '#blur_strength', '#shadow_width_counter', '#shadow_width',
                            '#font_scale_counter', '#font_scale', '#chat_width_slider_counter',
                            '#chat_width_slider', '#fast_ui_mode', '#waifuMode', '#noShadowsmode',
                            '#avatar_style', '#chat_display', '#blur-strength-block', '#shadow-width-block',
                            'meta[name=theme-color]'
                        ];
                        selectors.forEach(sel => {
                            const el = document.querySelector(sel);
                            if (el) _uiControlsCache[sel] = el;
                        });
                    }
                    return _uiControlsCache;
                }

                // === 彻底消除上一个美化颜色残留的全量主题颜色/控件应用函数 ===
                function applyThemeColors(themeObj) {
                    if (!themeObj) return;

                    console.log(`[Theme Manager] 执行 applyThemeColors 颜色重置与映射, 主题: "${themeObj.name}"`);
                    const root = document.documentElement;

                    const colorMap = [
                        { prop: 'main_text_color', var: '--SmartThemeBodyColor', picker: '#main-text-color-picker', default: 'rgba(255, 255, 255, 1)' },
                        { prop: 'italics_text_color', var: '--SmartThemeEmColor', picker: '#italics-color-picker', default: 'rgba(255, 255, 255, 1)' },
                        { prop: 'underline_text_color', var: '--SmartThemeUnderlineColor', picker: '#underline-color-picker', default: 'rgba(255, 255, 255, 1)' },
                        { prop: 'quote_text_color', var: '--SmartThemeQuoteColor', picker: '#quote-color-picker', default: 'rgba(255, 255, 255, 1)' },
                        { prop: 'blur_tint_color', var: '--SmartThemeBlurTintColor', picker: '#blur-tint-color-picker', default: 'rgba(0, 0, 0, 0.6)' },
                        { prop: 'chat_tint_color', var: '--SmartThemeChatTintColor', picker: '#chat-tint-color-picker', default: 'rgba(0, 0, 0, 0.4)' },
                        { prop: 'user_mes_blur_tint_color', var: '--SmartThemeUserMesBlurTintColor', picker: '#user-mes-blur-tint-color-picker', default: 'rgba(0, 0, 0, 0.4)' },
                        { prop: 'bot_mes_blur_tint_color', var: '--SmartThemeBotMesBlurTintColor', picker: '#bot-mes-blur-tint-color-picker', default: 'rgba(0, 0, 0, 0.4)' },
                        { prop: 'shadow_color', var: '--SmartThemeShadowColor', picker: '#shadow-color-picker', default: 'rgba(0, 0, 0, 0.8)' },
                        { prop: 'border_color', var: '--SmartThemeBorderColor', picker: '#border-color-picker', default: 'rgba(255, 255, 255, 0.1)' },
                    ];

                    colorMap.forEach(item => {
                        const val = themeObj[item.prop] !== undefined ? themeObj[item.prop] : item.default;
                        
                        // 1. 设置 CSS 变量 (高效直接写入行内 style)
                        root.style.setProperty(item.var, val);

                        // 2. 主文本色 RGB 拆分
                        if (item.prop === 'main_text_color' && val) {
                            try {
                                const parts = val.split('(')[1].split(')')[0].split(',');
                                root.style.setProperty('--SmartThemeCheckboxBgColorR', parts[0].trim());
                                root.style.setProperty('--SmartThemeCheckboxBgColorG', parts[1].trim());
                                root.style.setProperty('--SmartThemeCheckboxBgColorB', parts[2].trim());
                                root.style.setProperty('--SmartThemeCheckboxBgColorA', parts[3] ? parts[3].trim() : '1');
                            } catch(e){}
                        }

                        // 3. 极速更新酒馆 UI 界面中的 Color Picker 控件（静默赋值，防止 20 次事件轰炸导致重绘顿挫）
                        const pickerEl = document.querySelector(item.picker);
                        if (pickerEl) {
                            pickerEl.setAttribute('color', val);
                            pickerEl.value = val;
                        }

                        // 4. 同步更新 power_user 内存中对应的值
                        if (typeof power_user !== 'undefined') {
                            power_user[item.prop] = val;
                        }
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx && ctx.power_user) {
                                ctx.power_user[item.prop] = val;
                            }
                        }
                    });

                    // 5. 应用数值与开关系列参数（带有默认兜底）
                    const numMap = [
                        { prop: 'blur_strength', var: '--blurStrength', picker: '#blur_strength', counter: '#blur_strength_counter', default: 10 },
                        { prop: 'shadow_width', var: '--shadowWidth', picker: '#shadow_width', counter: '#shadow_width_counter', default: 2 },
                        { prop: 'font_scale', var: '--fontScale', picker: '#font_scale', counter: '#font_scale_counter', default: 1 },
                    ];
                    numMap.forEach(item => {
                        const val = themeObj[item.prop] !== undefined ? themeObj[item.prop] : item.default;
                        root.style.setProperty(item.var, String(val));
                        const pEl = document.querySelector(item.picker);
                        const cEl = document.querySelector(item.counter);
                        if (pEl) pEl.value = val;
                        if (cEl) cEl.value = val;
                        if (typeof power_user !== 'undefined') power_user[item.prop] = val;
                    });

                    if (themeObj.chat_width !== undefined) {
                        root.style.setProperty('--sheldWidth', `${themeObj.chat_width}vw`);
                        const cw = document.querySelector('#chat_width_slider');
                        const cwc = document.querySelector('#chat_width_slider_counter');
                        if (cw) cw.value = themeObj.chat_width;
                        if (cwc) cwc.value = themeObj.chat_width;
                        if (typeof power_user !== 'undefined') power_user.chat_width = themeObj.chat_width;
                    }
                }

                // === 直接应用主题（热更新核心） ===
                // 绕过 ST 内部模块作用域 of themes 引用失效问题
                // 在重命名/导入后无需刷新即可切换主题
                function applyThemeDirect(themeName) {
                    console.log(`[Theme Manager] applyThemeDirect 触发切换至主题: "${themeName}"`);
                    const originalSelect = document.querySelector('#themes');
                    deduplicateSelectOptions(originalSelect);
                    syncStKnownThemes();

                    const themeObj = allThemeObjectsMap.get(themeName);
                    const targetCss = (themeObj && themeObj.custom_css) ? themeObj.custom_css : '';

                    if (themeObj) {
                        updateSTThemeMemory(themeObj, 'add');
                        applyThemeColors(themeObj);
                    }

                    // 必定同步更新或清空 Custom CSS，彻底消除上一个美化遗留的样式污染
                    syncCustomCssToST(targetCss);

                    // 防范 ST 原生 loadTheme 异步写回导致 custom_css 偏移的静默守护
                    const scheduleAsyncProtection = () => {
                        setTimeout(() => {
                            const curCss = (typeof power_user !== 'undefined' && power_user.custom_css) || '';
                            if (curCss !== targetCss) {
                                console.log(`[Theme Manager] 静默纠偏同步主题 "${themeName}" 的 Custom CSS`);
                                syncCustomCssToST(targetCss);
                            }
                        }, 250);
                    };

                    // 核心优化: 更新选中值并同步触发表单变更
                    if (originalSelect) {
                        originalSelect.value = themeName;
                        triggerSelectChange(originalSelect);
                    }
                    scheduleAsyncProtection();
                }

                // 标签数据缓存（避免每次调用都 JSON.parse）
                let _tagsCache = null;
                function loadThemeTags() {
                    if (_tagsCache) return _tagsCache;
                    _tagsCache = JSON.parse(localStorage.getItem(THEME_TAGS_KEY)) || [];
                    return _tagsCache;
                }
                function refreshAllParsedThemesTags() {
                    const tags = loadThemeTags();
                    buildThemeTagIndex(tags);
                    if (allParsedThemes && allParsedThemes.length > 0) {
                        allParsedThemes.forEach(t => {
                            t.tags = getTagsForTheme(t.value, tags);
                        });
                    }
                }
                function saveThemeTags(tags) {
                    _tagsCache = tags; // 更新缓存
                    localStorage.setItem(THEME_TAGS_KEY, JSON.stringify(tags));
                    invalidateThemeTagIndex(); // 标签数据变了，反向索引也要失效
                    refreshAllParsedThemesTags(); // 实时重刷全量 parsedThemes 的标签关联
                    document.dispatchEvent(new CustomEvent('themeManager:tagsChanged', { detail: tags }));
                }
                function invalidateTagsCache() {
                    _tagsCache = null;
                    invalidateThemeTagIndex();
                }
                // 构建 themeName -> [tagId] 的反向索引，避免每次调用都做 O(tags*themes) 扫描
                let _themeTagIndex = null;
                function buildThemeTagIndex(tags) {
                    const index = new Map();
                    tags.forEach(t => {
                        if (t.themes) {
                            t.themes.forEach(themeName => {
                                if (!index.has(themeName)) index.set(themeName, []);
                                index.get(themeName).push(t.id);
                            });
                        }
                    });
                    _themeTagIndex = index;
                    return index;
                }
                function invalidateThemeTagIndex() { _themeTagIndex = null; }
                function getTagsForTheme(themeName, cachedTags) {
                    if (_themeTagIndex) return _themeTagIndex.get(themeName) || [];
                    const allTags = cachedTags || loadThemeTags();
                    return allTags.filter(t => t.themes && t.themes.includes(themeName)).map(t => t.id);
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
                    applyBoundThemeForCharacter: (avatarName) => applyBoundThemeForCharacter(avatarName)
                };

                const originalContainer = originalSelect.parentElement;
                if (!originalContainer) return;
                originalSelect.style.display = 'none';

                const managerPanel = document.createElement('div');
                managerPanel.id = 'theme-manager-panel';
                managerPanel.innerHTML = `
                    <div id="theme-manager-header">
                        <h4><i class="fa-solid fa-palette"></i> 主题美化管理</h4>
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
                                <input type="search" id="theme-search-box" placeholder="搜索主题...">
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
                                <button id="tm-toggle-usage-count-btn" class="menu_button" title="显示/隐藏使用次数统计"><i class="fa-solid fa-chart-bar"></i> 统计</button>
                                <button id="tm-toggle-avatar-helper-btn" class="menu_button" title="开启/完全禁用头像管理功能"><i class="fa-solid fa-check"></i> 头像</button>
                                <button id="tm-toggle-color-transfer-btn" class="menu_button" title="开启/禁用提取配色功能"><i class="fa-solid fa-palette"></i> 配色</button>
                                <button id="tm-toggle-daynight-binding-btn" class="menu_button" title="显示/隐藏卡片日夜绑定按钮"><i class="fa-solid fa-circle-half-stroke"></i> 日夜</button>
                                <button id="tm-toggle-replace-avatar-btn" class="menu_button" title="显示/隐藏详情页替换按键"><i class="fa-solid fa-check"></i> 替换</button>
                                <button id="tm-toggle-twoline-layout-btn" class="menu_button" title="美化名单独占一行，标签与功能图标另起一行排版"><i class="fa-solid fa-align-left"></i> 排版</button>
                                <button id="manage-tags-btn" class="menu_button" title="管理标签"><i class="fa-solid fa-tags"></i> 标签</button>
                                <button id="tm-auto-group-btn" class="menu_button" style="background: rgba(0, 123, 255, 0.18) !important; color: #4dabf7 !important; border: 1px solid rgba(0, 123, 255, 0.3) !important;" title="自动提取美化名中的共同词组并向导生成标签/分类"><i class="fa-solid fa-wand-magic-sparkles"></i> 分组</button>
                                <button id="tm-export-settings-btn" class="menu_button" title="导出配置文件"><i class="fa-solid fa-file-export"></i> 导出</button>
                                <button id="tm-import-settings-btn" class="menu_button" title="从配置文件中导入插件设置"><i class="fa-solid fa-file-import"></i> 导入</button>
                                <button id="tm-sync-disk-btn" class="menu_button" style="background: rgba(40, 167, 69, 0.18) !important; color: #72e48e !important; border: 1px solid rgba(40, 167, 69, 0.3) !important;" title="重新从磁盘读取主题并强行对齐界面与物理文件"><i class="fa-solid fa-arrows-rotate"></i> 对照磁盘</button>
                                <button id="tm-reset-all-system-btn" class="menu_button" style="background: rgba(220, 53, 69, 0.12) !important; color: #ff8888 !important; border: 1px solid rgba(220, 53, 69, 0.2) !important;" title="重置美化插件的所有数据"><i class="fa-solid fa-triangle-exclamation"></i> 重置</button>
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
                nativeButtonsContainer.appendChild(updateButton);
                nativeButtonsContainer.appendChild(saveAsButton);

                // 原生保存/另存为按钮点击后的内存与已知主题防爆同步
                if (updateButton) {
                    updateButton.addEventListener('click', () => {
                        setTimeout(() => {
                            syncStKnownThemes();
                            invalidateThemesCache();
                            const currentThemeName = originalSelect.value;
                            const themeObj = allThemeObjectsMap.get(currentThemeName);
                            const editorEl = document.querySelector('#customCSS') || document.querySelector('#style_custom_content') || document.querySelector('#custom_style') || document.querySelector('#style_custom');
                            if (themeObj && editorEl) {
                                themeObj.custom_css = editorEl.value;
                            }
                        }, 300);
                    });
                }
                if (saveAsButton) {
                    saveAsButton.addEventListener('click', () => {
                        setTimeout(() => {
                            syncStKnownThemes();
                            invalidateThemesCache();
                            debouncedBuildThemeUI(300);
                        }, 500);
                    });
                }

                const header = managerPanel.querySelector('#theme-manager-header');
                const content = managerPanel.querySelector('#theme-manager-content');
                const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');
                const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
                const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
                const contentWrapper = managerPanel.querySelector('.theme-content');
                if (contentWrapper) {
                    contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
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
                let allThemeObjects = [];
                let allThemeObjectsMap = new Map(); // themeName -> themeObject O(1) cache
                const stKnownThemes = new Set(Array.from(originalSelect.options).map(opt => opt.value));
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let lastClickedThemeName = null;
                let touchTimer = null;
                let preventNextClick = false;
                let touchStartX = 0;
                let touchStartY = 0;
                let themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};



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

                    contentWrapper.innerHTML = '正在加载主题...';
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
                            Array.from(originalSelect.options).forEach(opt => {
                                if (opt.value && !serverThemeNames.has(opt.value)) {
                                    console.log(`[Theme Manager] 🧹 清理原生下拉框中的死选项: "${opt.value}"`);
                                    opt.remove();
                                }
                            });
                        }

                        // 如果主题列表未发生变化，直接更新 active 状态即可，避免重建 DOM
                        if (allParsedThemes.length > 0 && isThemeListIdentical() && themeItemMap.size > 0) {
                            contentWrapper.innerHTML = '';
                            updateActiveState();
                            return;
                        }

                        contentWrapper.innerHTML = '';

                        // 缓存标签数据，避免在循环中反复 JSON.parse
                        const cachedTags = loadThemeTags();
                        // 构建反向索引，将 getTagsForTheme 从 O(tags*themes) 降为 O(1)
                        buildThemeTagIndex(cachedTags);

                        // 仅以服务器真实存在的主题数据对象构建 UI 列表，彻底隔离已被物理删除的残留项
                        allParsedThemes = allThemeObjects.map(t => {
                            const themeName = t.name || t.value;
                            if (!themeName) return null;
                            const tagIds = getTagsForTheme(themeName, cachedTags);
                            return { value: themeName, display: themeName, tags: tagIds, mtime: t.mtime || 0 };
                        }).filter(Boolean);

                        // 刷新 Map 索引
                        allParsedThemesMap.clear();
                        allParsedThemes.forEach(t => allParsedThemesMap.set(t.value, t));

                        renderTagsUI(cachedTags);
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

                        // 3. 全量规范化重写落盘，确保每一个物理文件的文件名与 JSON 内 name 100% 强制对齐
                        let fixedCount = 0;
                        const usedNames = new Set();
                        for (let i = 0; i < freshThemes.length; i++) {
                            const t = freshThemes[i];
                            if (!t || typeof t !== 'object') continue;
                            let origName = (t.name || t.value || '未命名主题').trim();

                            if (usedNames.has(origName)) {
                                // 发现同名冲突，自动添加后缀区别并规范落盘
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
                            }
                            usedNames.add(origName);

                            // 规范化落盘：重新提交一次 save 请求，强制后端按当前 name 写入规范物理文件名 sanitize(name).json
                            try {
                                const { mtime: _m, ...cleanObj } = t;
                                cleanObj.name = origName;
                                await apiRequest('themes/save', 'POST', cleanObj, true);
                            } catch (e) {
                                console.warn('[Theme Manager Resync] 重新规范落盘提示:', e);
                            }
                        }

                        if (fixedCount > 0) {
                            // 若有重名修复，再次刷新最新列表
                            invalidateThemesCache();
                            freshThemes = await getAllThemesFromAPI();
                        }

                        // 4. 全量更新 ST getContext / power_user 内存
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx) ctx.themes = freshThemes;
                        }
                        if (typeof power_user !== 'undefined') {
                            power_user.themes = freshThemes;
                        }
                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            themes.length = 0;
                            themes.push(...freshThemes);
                        }

                        // 5. 重构原生 #themes 下拉框 (<select id="themes">)
                        const selectEl = originalSelect || document.querySelector('#themes');
                        if (selectEl) {
                            const currentVal = selectEl.value;
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
                            } else if (freshThemes.length > 0) {
                                selectEl.value = freshThemes[0].name || freshThemes[0].value;
                                triggerSelectChange(selectEl);
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
                        <div class="theme-item-sub-row">
                            <div class="theme-item-tags" style="display:none;"></div>
                            <div class="theme-item-buttons">
                                <button class="set-tag-btn" title="分类标签"><i class="fa-solid fa-tags"></i></button>
                                <button class="link-bg-btn" title="关联背景图"><i class="fa-solid fa-link"></i></button>
                                <button class="link-daynight-btn" title="绑定日夜美化"><i class="fa-solid fa-circle-half-stroke"></i></button>
                                <button class="favorite-btn" title="收藏"><i class="fa-regular fa-star"></i></button>
                                <button class="color-transfer-btn" title="提取配色" style="display:none;"><i class="fa-solid fa-palette"></i></button>
                                <button class="rename-btn" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                <button class="delete-btn" title="删除"><i class="fa-solid fa-trash-can"></i></button>
                            </div>
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
                    const usageSpan = nameDiv.children[1];
                    const subRowDiv = item.children[1];
                    const tagsDiv = subRowDiv.children[0];
                    const buttonsDiv = subRowDiv.children[1];
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

                    // 设置标签药丸
                    if (theme.tags && theme.tags.length > 0) {
                        tagsDiv.innerHTML = '';
                        let hasTags = false;
                        theme.tags.forEach(tagId => {
                            const tagObj = tagsMap.get(tagId);
                            if (tagObj) {
                                hasTags = true;
                                const pill = document.createElement('span');
                                pill.className = 'theme-item-tag-pill';
                                pill.textContent = tagObj.name;
                                tagsDiv.appendChild(pill);
                            }
                        });
                        tagsDiv.style.display = hasTags ? 'flex' : 'none';
                    } else {
                        tagsDiv.style.display = 'none';
                        tagsDiv.innerHTML = '';
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

                    // 预计算筛选集合用于首次显示
                    const searchTerm = searchBox.value.toLowerCase();

                    const matched = allParsedThemes.filter(theme => {
                        const matchesTag = isThemeMatchingFilters(theme);
                        const matchesSearch = !searchTerm || theme.display.toLowerCase().includes(searchTerm);
                        return matchesTag && matchesSearch;
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

                function getExpandedTagIds(tagId, tags) {
                    if (!isSubtagsEnabled()) return [tagId];
                    const tag = tags.find(t => t.id === tagId);
                    if (!tag) return [tagId];
                    // 如果是一级标签（parentId 为空），包含其自身及所有二级子标签
                    if (!tag.parentId) {
                        const childIds = tags.filter(t => t.parentId === tagId).map(t => t.id);
                        return [tagId, ...childIds];
                    }
                    return [tagId];
                }

                // 判断主题是否匹配当前标签筛选
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
                                const targetIds = getExpandedTagIds(tagId, tags);
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
                            const targetIds = getExpandedTagIds(tagId, tags);
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

                        const tagsDiv = item.querySelector('.theme-item-tags');
                        if (tagsDiv) {
                            tagsDiv.innerHTML = '';
                            if (theme.tags && theme.tags.length > 0) {
                                let hasTags = false;
                                theme.tags.forEach(tagId => {
                                    const tagObj = tagsById.get(tagId);
                                    if (tagObj) {
                                        hasTags = true;
                                        const pill = document.createElement('span');
                                        pill.className = 'theme-item-tag-pill';
                                        pill.textContent = tagObj.name;
                                        tagsDiv.appendChild(pill);
                                    }
                                });
                                tagsDiv.style.display = hasTags ? 'flex' : 'none';
                            } else {
                                tagsDiv.style.display = 'none';
                            }
                        }
                    }

                    filterThemeList();
                }

                // 增量重命名，避免刷新 DOM
                function softRenameThemeUI(oldName, newName) {
                    const item = themeItemMap.get(oldName);
                    if (item) {
                        item.dataset.value = newName;
                        const textSpan = item.children[0].children[0];
                        if (textSpan) textSpan.textContent = newName;
                        themeItemMap.set(newName, item);
                        themeItemMap.delete(oldName);
                    }
                    
                    const themeObj = allParsedThemes.find(t => t.value === oldName);
                    if (themeObj) {
                        themeObj.value = newName;
                        themeObj.display = newName;
                        themeObj.mtime = Date.now();
                        allParsedThemesMap.set(newName, themeObj);
                        allParsedThemesMap.delete(oldName);
                    }
                    
                    const objIndex = allThemeObjects.findIndex(t => t.name === oldName);
                    if (objIndex > -1) {
                        const obj = allThemeObjects[objIndex];
                        obj.name = newName;
                        obj.mtime = Date.now();
                        allThemeObjectsMap.set(newName, obj);
                    }
                    allThemeObjectsMap.delete(oldName);
                    stKnownThemes.delete(oldName); // 重命名旧主题后，ST 内部不再认识该旧名字
                }

                // 增量删除，避免刷新 DOM
                function softDeleteThemeUI(themeName) {
                    const item = themeItemMap.get(themeName);
                    if (item) {
                        item.remove();
                        themeItemMap.delete(themeName);
                    }

                    const idx = allParsedThemes.findIndex(t => t.value === themeName);
                    if (idx > -1) {
                        allParsedThemes.splice(idx, 1);
                        allParsedThemesMap.delete(themeName);
                    }

                    const objIndex = allThemeObjects.findIndex(t => t.name === themeName);
                    if (objIndex > -1) {
                        allThemeObjects.splice(objIndex, 1);
                    }
                    allThemeObjectsMap.delete(themeName);
                    stKnownThemes.delete(themeName);
                }

                // 增量添加主题项到 UI，避免全量重建 DOM（批量导入时调用）
                function softAddThemeUI(themeObject, cachedTags = null, listFragment = null) {
                    const themeName = themeObject.name;
                    const tags = cachedTags || loadThemeTags();
                    const tagsMap = new Map(tags.map(t => [t.id, t]));
                    const tagIds = getTagsForTheme(themeName, tags);
                    const newParsed = { value: themeName, display: themeName, tags: tagIds, mtime: themeObject.mtime || Date.now() };

                    // 更新 allParsedThemes（覆盖或追加）- O(1) Map 查找
                    const existingParsed = allParsedThemesMap.get(themeName);
                    if (existingParsed) {
                        existingParsed.tags = tagIds;
                    } else {
                        allParsedThemes.push(newParsed);
                        allParsedThemesMap.set(themeName, newParsed);
                    }

                    // 更新 allThemeObjects（覆盖或追加）- O(1) 原地更新
                    const existingObj = allThemeObjectsMap.get(themeName);
                    if (existingObj) {
                        Object.assign(existingObj, themeObject);
                    } else {
                        allThemeObjects.push(themeObject);
                        allThemeObjectsMap.set(themeName, themeObject);
                    }

                    // 构建并缓存 DOM 节点（cloneNode 比 innerHTML 快）
                    const item = createThemeItem(newParsed, tagsMap);
                    themeItemMap.set(themeName, item);

                    // 应用当前搜索和标签筛选（新项默认可见性）
                    const matchesTag = isThemeMatchingFilters(newParsed);
                    const searchTerm = searchBox.value.toLowerCase();
                    const matchesSearch = !searchTerm || themeName.toLowerCase().includes(searchTerm);
                    item.style.display = (matchesTag && matchesSearch) ? 'flex' : 'none';

                    // 如果提供了 listFragment，则追加到 fragment 中以实现批量插入；否则直接 append 到 DOM
                    if (listFragment) {
                        listFragment.appendChild(item);
                    } else {
                        const list = contentWrapper.querySelector('.theme-list');
                        if (list) list.appendChild(item);
                    }
                }

                function renderTagsUI(cachedTags) {
                    const container = managerPanel.querySelector('#theme-tags-container');
                    if (!container) return;
                    container.innerHTML = '';

                    let subtagsContainer = managerPanel.querySelector('#theme-subtags-container');
                    if (!subtagsContainer) {
                        subtagsContainer = document.createElement('div');
                        subtagsContainer.className = 'theme-tags-row theme-subtags-row';
                        subtagsContainer.id = 'theme-subtags-container';
                        subtagsContainer.style.display = 'none';
                        container.parentNode.insertBefore(subtagsContainer, container.nextSibling);
                    } else {
                        subtagsContainer.innerHTML = '';
                        subtagsContainer.style.display = 'none';
                    }

                    const subtagsEnabled = isSubtagsEnabled();

                    // 筛选模式切换图标（OR / AND），放在最前面
                    const modeBtn = document.createElement('div');
                    modeBtn.className = `tm-filter-mode-btn${tagFilterMode === 'and' ? ' active' : ''}`;
                    modeBtn.title = tagFilterMode === 'and' ? '当前：AND 交叉筛选（点击切换为 OR 模式）' : '当前：OR 任意筛选（点击切换为 AND 模式）';
                    modeBtn.innerHTML = tagFilterMode === 'and'
                        ? '<i class="fa-solid fa-layer-group"></i>'
                        : '<i class="fa-solid fa-circle-nodes"></i>';
                    modeBtn.addEventListener('click', () => {
                        tagFilterMode = tagFilterMode === 'or' ? 'and' : 'or';
                        localStorage.setItem(TAG_FILTER_MODE_KEY, tagFilterMode);
                        updateTagChipsActiveState();
                        if (activeTagFilters.size > 0) {
                            currentPage = 1;
                            filterThemeList(0);
                        }
                    });
                    container.appendChild(modeBtn);

                    // "全部" (All) Tag
                    const allChip = document.createElement('div');
                    allChip.className = `theme-tag-chip ${activeTagFilters.size === 0 ? 'active' : ''}`;
                    allChip.dataset.special = 'all';
                    allChip.innerHTML = `全部`;
                    allChip.addEventListener('click', () => {
                        activeLevel1TagId = null;
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
                    if (tags.length > 0) {
                        const visibleLevel1Tags = subtagsEnabled
                            ? tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId))
                            : tags;

                        visibleLevel1Tags.forEach(tag => {
                            const chip = document.createElement('div');
                            const childIds = subtagsEnabled ? tags.filter(t => t.parentId === tag.id).map(t => t.id) : [];
                            const hasActiveChild = childIds.some(cId => activeTagFilters.has(cId));
                            const hasSubUncat = activeTagFilters.has(`__SUB_UNCATEGORIZED__:${tag.id}`);
                            const isL1Active = activeLevel1TagId === tag.id;
                            const isDirectActive = activeTagFilters.has(tag.id);

                            chip.className = `theme-tag-chip level1 ${isDirectActive || isL1Active || hasActiveChild || hasSubUncat ? 'active' : ''}`;
                            chip.dataset.tagId = tag.id;

                            let count = tag.themes ? tag.themes.length : 0;
                            if (subtagsEnabled) {
                                const allRelatedThemeNames = new Set(tag.themes || []);
                                childIds.forEach(cId => {
                                    const cTag = tags.find(t => t.id === cId);
                                    if (cTag && cTag.themes) {
                                        cTag.themes.forEach(th => allRelatedThemeNames.add(th));
                                    }
                                });
                                count = allRelatedThemeNames.size;
                            }

                            chip.innerHTML = `${escapeHtml(tag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${count})</span>`;
                            chip.addEventListener('click', () => {
                                if (subtagsEnabled) {
                                    if (activeLevel1TagId === tag.id && activeTagFilters.has(tag.id)) {
                                        activeLevel1TagId = null;
                                        activeTagFilters.clear();
                                    } else {
                                        activeLevel1TagId = tag.id;
                                        if (tagFilterMode === 'or') activeTagFilters.clear();
                                        activeTagFilters.add(tag.id);
                                    }
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

                        // 如果开启二级目录且选中的一级标签有效，渲染二级标签排
                        if (subtagsEnabled && activeLevel1TagId) {
                            const parentTag = tags.find(t => t.id === activeLevel1TagId);
                            if (parentTag) {
                                const childTags = tags.filter(t => t.parentId === activeLevel1TagId);
                                const childTagIds = childTags.map(t => t.id);
                                subtagsContainer.style.display = 'flex';

                                const labelSpan = document.createElement('span');
                                labelSpan.className = 'tm-subtag-label';
                                labelSpan.innerHTML = `<i class="fa-solid fa-angle-right"></i> ${escapeHtml(parentTag.name)}:`;
                                subtagsContainer.appendChild(labelSpan);

                                // 1. 渲染该一级分类下已定义的二级标签
                                childTags.forEach(childTag => {
                                    const subChip = document.createElement('div');
                                    subChip.className = `theme-tag-chip level2 ${activeTagFilters.has(childTag.id) ? 'active' : ''}`;
                                    subChip.dataset.tagId = childTag.id;
                                    subChip.innerHTML = `${escapeHtml(childTag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${childTag.themes ? childTag.themes.length : 0})</span>`;
                                    subChip.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        if (activeTagFilters.has(childTag.id)) {
                                            if (tagFilterMode === 'or') {
                                                activeTagFilters.clear();
                                                activeTagFilters.add(activeLevel1TagId);
                                            } else {
                                                activeTagFilters.delete(childTag.id);
                                            }
                                        } else {
                                            if (tagFilterMode === 'or') activeTagFilters.clear();
                                            activeTagFilters.add(childTag.id);
                                        }
                                        handleTagFilterChange();
                                        renderTagsUI();
                                    });
                                    subtagsContainer.appendChild(subChip);
                                });

                                // 2. 渲染默认二级“未分类”标签 (属于当前一级分类，但无任何二级子分类标签的主题)
                                const l1Themes = parentTag.themes || [];
                                const subUncatCount = l1Themes.filter(themeName => {
                                    const themeTags = getTagsForTheme(themeName, tags);
                                    return !themeTags.some(tId => childTagIds.includes(tId));
                                }).length;

                                const subUncatKey = `__SUB_UNCATEGORIZED__:${activeLevel1TagId}`;
                                const isSubUncatActive = activeTagFilters.has(subUncatKey);
                                const subUncatChip = document.createElement('div');
                                subUncatChip.className = `theme-tag-chip level2 sub-uncategorized ${isSubUncatActive ? 'active' : ''}`;
                                subUncatChip.dataset.special = 'sub-uncategorized';
                                subUncatChip.innerHTML = `未分类 <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${subUncatCount})</span>`;
                                subUncatChip.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    if (isSubUncatActive) {
                                        if (tagFilterMode === 'or') {
                                            activeTagFilters.clear();
                                            activeTagFilters.add(activeLevel1TagId);
                                        } else {
                                            activeTagFilters.delete(subUncatKey);
                                        }
                                    } else {
                                        if (tagFilterMode === 'or') activeTagFilters.clear();
                                        activeTagFilters.add(subUncatKey);
                                    }
                                    handleTagFilterChange();
                                    renderTagsUI();
                                });
                                subtagsContainer.appendChild(subUncatChip);
                            }
                        }
                    }
                }
                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    // O(1)：只操作两个节点，而非 querySelectorAll 全量遍历（主题列表很长时收益明显）
                    if (_activeThemeItem) _activeThemeItem.classList.remove('active');
                    _activeThemeItem = themeItemMap.get(currentValue) || null;
                    if (_activeThemeItem) _activeThemeItem.classList.add('active');
                }

                async function performBatchRename(renameLogic) {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    showLoader();
                    _suspendObserver = true;

                    let successCount = 0;
                    let errorCount = 0;
                    let skippedCount = 0;
                    let activeThemeWasRenamed = false;

                    try {
                        const currentThemes = await getAllThemesFromAPI();
                        let favoritesToUpdate = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                        let tagsToUpdate = loadThemeTags();

                        const renameTasks = [];
                        const usedNewNames = new Set();

                        for (const oldName of selectedForBatch) {
                            const newName = renameLogic(oldName);
                            if (!newName || !newName.trim()) {
                                skippedCount++;
                                continue;
                            }

                            if (usedNewNames.has(newName) || currentThemes.some(t => t.name === newName && t.name !== oldName)) {
                                console.warn(`批量操作：目标名称 "${newName}" 已存在或内部冲突，已跳过 "${oldName}"。`);
                                toastr.warning(`主题名称 "${newName}" 冲突，已跳过。`);
                                skippedCount++;
                                continue;
                            }

                            if (newName === oldName) {
                                successCount++; // 名字没变
                                continue;
                            }

                            // ⚠️ 在入队时立刻快照完整对象，避免并发 task 互相清除内存后找不到
                            const fullThemeObj = findThemeObject(oldName);
                            if (!fullThemeObj) {
                                console.error(`[Theme Manager Batch Rename] 无法读取主题 "${oldName}" 的完整数据，跳过此项`);
                                errorCount++;
                                continue;
                            }

                            usedNewNames.add(newName);
                            renameTasks.push({ oldName, newName, fullThemeObj });
                        }

                        if (renameTasks.length > 0) {
                            // 并发数降低到 3：write-file-atomic 高并发下易出现文件系统竞争，导致 HTTP 超时但文件实际已写入
                            const results = await limitConcurrency(3, renameTasks, async ({ oldName, newName, fullThemeObj }) => {
                                // 去掉 mtime（服务器读时自动添加，写盘时不应包含）
                                const { mtime: _mtime, ...cleanObj } = fullThemeObj;
                                const objectToSave = { ...cleanObj, name: newName };

                                let saveOk = false;
                                let deleteOk = false;

                                // 1. 尝试写入新文件（suppressToast：true，由返回结果统一处理提示）
                                try {
                                    await apiRequest('themes/save', 'POST', objectToSave, true);
                                    saveOk = true;
                                    console.log(`[Batch Rename] ✅ 保存成功: "${newName}.json"`);
                                } catch (saveErr) {
                                    // 即使 HTTP 报错，文件可能实际已写入（write-file-atomic 超时常见）
                                    console.warn(`[Batch Rename] ⚠️ 保存报错 (${saveErr.message})，但文件可能已写入，继续删除旧文件`);
                                }

                                // 2. 无论保存是否报错都尝试删除旧文件
                                // （保存可能实际已成功，不删旧文件会导致磁盘上同时存在新旧两个文件）
                                try {
                                    const deleted = await deleteTheme(oldName, fullThemeObj);
                                    deleteOk = deleted;
                                } catch (delErr) {
                                    console.warn(`[Batch Rename] 删除旧主题 "${oldName}" 失败:`, delErr);
                                }

                                return { oldName, newName, newThemeObject: objectToSave, saveOk, deleteOk };
                            });

                            // 批量更新原生 DOM、内存与插件状态
                            results.forEach((res, index) => {
                                const task = renameTasks[index];
                                if (res.status === 'fulfilled') {
                                    const { oldName, newName, newThemeObject, saveOk, deleteOk } = res.value;

                                    if (!saveOk && !deleteOk) {
                                        // 两者均失败，确认报错
                                        errorCount++;
                                        toastr.error(`重命名「${oldName}」失败（保存和删除均失败）`);
                                        return;
                                    }

                                    successCount++;
                                    if (!saveOk) console.warn(`[Batch Rename] "${oldName}" 保存报错但删除成功，可能新文件已存在`);
                                    if (!deleteOk) console.warn(`[Batch Rename] "${oldName}" 新文件已写入但旧文件未删除`);

                                    const isActive = originalSelect.value === oldName;
                                    manualUpdateOriginalSelect('rename', oldName, newName);
                                    if (isActive) activeThemeWasRenamed = true;

                                    updateSTThemeMemory({ name: oldName }, 'delete');
                                    updateSTThemeMemory(newThemeObject, 'add');
                                    softRenameThemeUI(oldName, newName);

                                    const favIndex = favoritesToUpdate.indexOf(oldName);
                                    if (favIndex > -1) favoritesToUpdate[favIndex] = newName;

                                    if (themeBackgroundBindings[oldName]) {
                                        themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                        delete themeBackgroundBindings[oldName];
                                    }

                                    // 同步更新标签数据
                                    tagsToUpdate.forEach(tag => {
                                        if (tag.themes) {
                                            const idx = tag.themes.indexOf(oldName);
                                            if (idx > -1) tag.themes[idx] = newName;
                                        }
                                    });
                                } else {
                                    // Promise 本身报错（极少出现）
                                    errorCount++;
                                    console.error(`批量重命名任务异常 "${task.oldName}":`, res.reason);
                                    toastr.error(`处理「${task.oldName}」时异常: ${res.reason?.message || res.reason}`);
                                }
                            });
                        }

                        updateFavorites(favoritesToUpdate);
                        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                        saveThemeTags(tagsToUpdate);

                        selectedForBatch.clear();
                        lastClickedThemeName = null;
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(el => el.classList.remove('selected-for-batch'));
                        invalidateThemesCache();
                        filterThemeList();

                        let summary = `批量操作完成！成功 ${successCount} 个`;
                        if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
                        if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
                        summary += '。';
                        toastr.success(summary);

                        if (activeThemeWasRenamed) {
                            triggerSelectChange(originalSelect);
                        }
                        updateActiveState();
                    } catch (err) {
                        console.error('批量重命名执行失败:', err);
                        toastr.error('批量重命名发生异常：' + (err.message || err));
                    } finally {
                        hideLoader();
                        setTimeout(() => { _suspendObserver = false; }, 100);
                    }
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const deleteCount = selectedForBatch.size;
                    const confirmed = await confirmAction(`确定要删除选中的 ${deleteCount} 个主题吗？`);
                    if (!confirmed) return;

                    const deletedThemes = Array.from(selectedForBatch);
                    const successSet = new Set(deletedThemes);

                    // ⚠️ 必须在清内存前先快照每个主题的完整对象（deleteTheme 需要 name 字段来定位磁盘文件）
                    const themeObjSnapshots = new Map();
                    deletedThemes.forEach(name => {
                        const obj = findThemeObject(name);
                        if (obj) themeObjSnapshots.set(name, obj);
                    });

                    // 0ms 乐观 UI 更新：立刻清除选择状态与视口 DOM 节点
                    selectedForBatch.clear();
                    lastClickedThemeName = null;

                    // 1. 批量更新 ST 原生下拉框
                    _suspendObserver = true;
                    try {
                        deletedThemes.forEach(themeName => {
                            const optionToDelete = findOptionByValue(originalSelect, themeName);
                            if (optionToDelete) optionToDelete.remove();
                        });
                    } finally {
                        setTimeout(() => { _suspendObserver = false; }, 0);
                    }

                    // 2. 批量同步 ST 内部主题内存
                    try {
                        const contexts = [];
                        if (typeof power_user !== 'undefined') contexts.push(power_user);
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            contexts.push(SillyTavern.getContext());
                        }

                        contexts.forEach(ctx => {
                            if (ctx && Array.isArray(ctx.themes)) {
                                ctx.themes = ctx.themes.filter(t => !successSet.has(t.name) && !successSet.has(t.value));
                            }
                        });

                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            for (let i = themes.length - 1; i >= 0; i--) {
                                if (successSet.has(themes[i].name) || successSet.has(themes[i].value)) {
                                    themes.splice(i, 1);
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[Theme Manager] 批量同步 ST 内部主题内存失败:', e);
                    }

                    // 3. 批量删除主题 UI 状态与缓存
                    deletedThemes.forEach(themeName => {
                        const item = themeItemMap.get(themeName);
                        if (item) {
                            item.remove();
                            themeItemMap.delete(themeName);
                        }

                        const idx = allParsedThemes.findIndex(t => t.value === themeName);
                        if (idx > -1) {
                            allParsedThemes.splice(idx, 1);
                            allParsedThemesMap.delete(themeName);
                        }

                        const objIndex = allThemeObjects.findIndex(t => t.name === themeName || t.value === themeName);
                        if (objIndex > -1) {
                            allThemeObjects.splice(objIndex, 1);
                        }
                        allThemeObjectsMap.set(themeName, null);
                        allThemeObjectsMap.delete(themeName);
                        stKnownThemes.delete(themeName);

                        if (themeBackgroundBindings[themeName]) {
                            delete themeBackgroundBindings[themeName];
                        }
                    });

                    // 4. 清理收藏和标签数据
                    favorites = favorites.filter(f => !successSet.has(f));
                    let tagsToUpdate = loadThemeTags();
                    tagsToUpdate.forEach(tag => {
                        if (tag.themes) {
                            tag.themes = tag.themes.filter(t => !successSet.has(t));
                        }
                    });

                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                    updateFavorites(favorites);
                    saveThemeTags(tagsToUpdate);

                    // 5. 切换激活状态，如果被删的主题是当前激活的
                    const isCurrentlyActiveDeleted = successSet.has(originalSelect.value);
                    if (isCurrentlyActiveDeleted) {
                        const azureOption = findOptionByValue(originalSelect, 'Azure');
                        originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                        triggerSelectChange(originalSelect);
                    }

                    // 0ms 瞬间完成 UI 刷新与提示
                    renderTagsUI(tagsToUpdate);
                    updateActiveState();
                    toastr.success(`已成功批量删除 ${deleteCount} 个美化主题！`);

                    // 后台高并发 (25) 异步执行物理磁盘文件擦除（使用提前快照的 themeObj，此时 ST 内存已清除）
                    (async () => {
                        try {
                            await limitConcurrency(25, deletedThemes, name => {
                                const themeObj = themeObjSnapshots.get(name) || null;
                                return deleteTheme(name, themeObj);
                            });

                            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                                const ctx = SillyTavern.getContext();
                                if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                            }
                            invalidateThemesCache();
                        } catch (err) {
                            console.error('[Theme Manager] 异步批量删除物理文件异常:', err);
                        }
                    })();
                }



                // ===============================================
                // =========== 事件监听器 (EVENT LISTENERS) ===========
                // ===============================================

                // VVVVVVVVVVVV 新增代码 VVVVVVVVVVVV -->

                // ---------- 导入/导出插件配置 ----------

                const settingsKeysToSync = [
                    FAVORITES_KEY,
                    COLLAPSE_KEY, // AutoTheme relies on custom parsing
                    THEME_TAGS_KEY,
                    THEME_BACKGROUND_BINDINGS_KEY,
                    CHARACTER_THEME_BINDINGS_KEY,
                    'themeManager_autoTheme',
                    TAG_FILTER_MODE_KEY,
                    USAGE_COUNT_KEY,
                    SHOW_USAGE_COUNT_KEY,
                    ENABLE_AVATAR_HELPER_KEY,
                    ENABLE_COLOR_TRANSFER_KEY,
                    TWO_LINE_LAYOUT_KEY
                ];

                function exportSettings() {
                    const settingsToExport = {};
                    settingsKeysToSync.forEach(key => {
                        const value = localStorage.getItem(key);
                        if (value !== null) {
                            settingsToExport[key] = value;
                        }
                    });

                    const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'theme_manager_config.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toastr.success('配置已成功导出！');
                }

                async function importSettings(event) {
                    const file = event.target.files[0];
                    if (!file) return;

                    try {
                        const content = await file.text();
                        const settingsToImport = JSON.parse(content);

                        let importCount = 0;
                        for (const key in settingsToImport) {
                            if (settingsKeysToSync.includes(key)) {
                                localStorage.setItem(key, settingsToImport[key]);
                                importCount++;
                            }
                        }

                        toastr.success(`成功导入 ${importCount} 条配置！请刷新页面以应用所有更改。`, '导入成功');
                        // 导入后刷新缓存
                        invalidateTagsCache();
                        invalidateThemesCache();
                        showRefreshNotification(); // 显示那个“请刷新页面”的横幅提示

                    } catch (error) {
                        console.error('导入配置失败:', error);
                        toastr.error(`导入失败，文件可能已损坏或格式不正确。错误: ${error.message}`);
                    } finally {
                        event.target.value = ''; // 确保总是重置文件输入
                    }
                }

                managerPanel.querySelector('#tm-export-settings-btn').addEventListener('click', exportSettings);
                managerPanel.querySelector('#tm-import-settings-btn').addEventListener('click', () => settingsFileInput.click());
                settingsFileInput.addEventListener('change', importSettings);

                const syncDiskBtn = managerPanel.querySelector('#tm-sync-disk-btn');
                if (syncDiskBtn) {
                    syncDiskBtn.addEventListener('click', () => hardResyncThemes(true));
                }

                const twoLineBtn = managerPanel.querySelector('#tm-toggle-twoline-layout-btn');
                if (twoLineBtn) {
                    if (isTwoLineLayout) twoLineBtn.classList.add('active');
                    twoLineBtn.addEventListener('click', () => {
                        isTwoLineLayout = !isTwoLineLayout;
                        localStorage.setItem(TWO_LINE_LAYOUT_KEY, isTwoLineLayout ? 'true' : 'false');
                        twoLineBtn.classList.toggle('active', isTwoLineLayout);
                        if (contentWrapper) contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                        toastr.info(isTwoLineLayout ? '已开启换行排版模式（美化名单独占一行）' : '已恢复单行排版模式');
                    });
                }
                const autoGroupBtn = managerPanel.querySelector('#tm-auto-group-btn');
                if (autoGroupBtn) {
                    autoGroupBtn.addEventListener('click', () => openAutoGroupWizard());
                }

                const twoLineChk = managerPanel.querySelector('#tm-twoline-layout-chk');
                if (twoLineChk) {
                    twoLineChk.addEventListener('change', () => {
                        isTwoLineLayout = twoLineChk.checked;
                        localStorage.setItem(TWO_LINE_LAYOUT_KEY, isTwoLineLayout ? 'true' : 'false');
                        if (contentWrapper) contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                    });
                }

                // ---------- 功能结束 ----------

                // ^^^^^^^^^^^^ 新增代码 ^^^^^^^^^^^^ -->

                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                // 搜索输入防抖（移动端输入法频繁触发 input 事件）
                let _searchDebounceTimer = null;
                searchBox.addEventListener('input', (e) => {
                    clearTimeout(_searchDebounceTimer);
                    _searchDebounceTimer = setTimeout(() => {
                        currentPage = 1;
                        filterThemeList(0);
                    }, 1000);
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

                // 替换卡图按键开启/禁用 toggle 及按键注入逻辑
                function removeReplaceImageButtons() {
                    $('#theme-manager-char-replace-image-btn, .theme-manager-char-replace-image-btn').remove();
                    $('#theme-manager-user-replace-image-btn, .theme-manager-user-replace-image-btn').remove();
                }

                function registerReplaceImageButtons() {
                    if (localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) === 'false') {
                        removeReplaceImageButtons();
                        return;
                    }

                    // 1. 角色卡详情页替换卡图按钮
                    $('.form_create_bottom_buttons_block').each(function() {
                        const $container = $(this);
                        if ($container.find('#theme-manager-char-replace-image-btn').length === 0) {
                            const $btn = $('<div>', {
                                id: 'theme-manager-char-replace-image-btn',
                                class: 'menu_button fa-solid fa-file-image theme-manager-char-replace-image-btn',
                                title: '替换角色卡图片',
                                'data-i18n': '[title]替换角色卡图片'
                            }).on('click', function(e) {
                                e.preventDefault();
                                e.stopPropagation();
                                const addAvatarBtn = document.getElementById('add_avatar_button');
                                if (addAvatarBtn) {
                                    addAvatarBtn.click();
                                } else {
                                    toastr.warning('未找到角色卡头像上传组件。');
                                }
                            });

                            const $deleteBtn = $container.find('#delete_button');
                            if ($deleteBtn.length > 0) {
                                $btn.insertBefore($deleteBtn);
                            } else {
                                $container.append($btn);
                            }
                        }
                    });

                    // 2. 用户详情页替换头像按钮
                    $('.persona_controls_buttons_block').each(function() {
                        const $container = $(this);
                        if ($container.find('#theme-manager-user-replace-image-btn').length === 0) {
                            const $btn = $('<div>', {
                                id: 'theme-manager-user-replace-image-btn',
                                class: 'menu_button fa-solid fa-file-image theme-manager-user-replace-image-btn',
                                title: '替换用户头像图片',
                                'data-i18n': '[title]替换用户头像图片'
                            }).on('click', function(e) {
                                e.preventDefault();
                                e.stopPropagation();
                                const personaSetImgBtn = document.getElementById('persona_set_image_button');
                                if (personaSetImgBtn) {
                                    personaSetImgBtn.click();
                                } else {
                                    const userAvatarInput = document.getElementById('avatar_upload_file');
                                    const userAvatarOverwrite = document.getElementById('avatar_upload_overwrite');
                                    if (userAvatarInput && userAvatarOverwrite) {
                                        const currentPersona = typeof user_avatar !== 'undefined' ? user_avatar : '';
                                        userAvatarOverwrite.value = currentPersona;
                                        userAvatarInput.click();
                                    } else {
                                        toastr.warning('未找到用户头像上传组件。');
                                    }
                                }
                            });

                            const $deletePersonaBtn = $container.find('#persona_delete_button');
                            if ($deletePersonaBtn.length > 0) {
                                $btn.insertBefore($deletePersonaBtn);
                            } else {
                                $container.append($btn);
                            }
                        }
                    });
                }

                // 立即注册并开启轻量级巡检与面板交互监听，确保 100% 成功注入
                registerReplaceImageButtons();
                setInterval(registerReplaceImageButtons, 1000);
                $(document).on('click', '#rightNavDrawerIcon, #avatar-and-name-block, #persona_controls, .character_select, .persona_item, .drawer-icon, #user_avatar_block', function() {
                    setTimeout(registerReplaceImageButtons, 50);
                    setTimeout(registerReplaceImageButtons, 300);
                });

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

                // === 智能推荐算法：提取美化主题的基础系列名称 (去除色彩词、修饰词及作者后缀) ===
                function extractThemeBaseName(name) {
                    if (!name) return '';
                    let base = name;
                    // 移除作者后缀 (如 by xxx, author xxx)
                    base = base.replace(/by\s*.*$/i, '');
                    // 移除版本号 (如 v1, v2.0)
                    base = base.replace(/v\d+(\.\d+)?/gi, '');
                    // 移除常见色彩、修饰词与符号
                    const modifierRegex = /(深色|浅色|暗色|亮色|黑色|白色|红色|蓝色|绿色|黄色|粉色|紫色|灰色|米色|棕色|金|银|莫兰迪|莫兰迪米|莫兰迪暗|Dark|Light|Black|White|Red|Blue|Green|Yellow|Pink|Purple|Grey|Gray|Beige|Night|Day|版|模式|配色|主题|美化|[·・\-_s])/gi;
                    base = base.replace(modifierRegex, '').trim();
                    return base.toLowerCase();
                }

                // 计算智能推荐主题列表 (按置信度降序)
                function getSmartRecommendedThemes(targetThemeName, allThemes) {
                    const targetBase = extractThemeBaseName(targetThemeName);
                    const recommendations = [];

                    allThemes.forEach(t => {
                        if (t.value === targetThemeName) return;
                        const sourceBase = extractThemeBaseName(t.value);

                        let isRecommended = false;
                        let score = 0;

                        if (targetBase && sourceBase) {
                            if (targetBase === sourceBase) {
                                isRecommended = true;
                                score = 100;
                            } else if (targetBase.length >= 2 && sourceBase.includes(targetBase)) {
                                isRecommended = true;
                                score = 80;
                            } else if (sourceBase.length >= 2 && targetBase.includes(sourceBase)) {
                                isRecommended = true;
                                score = 70;
                            }
                        }

                        // 回退匹配：原始名字前缀相同 (前 3 个字符及以上)
                        if (!isRecommended && targetThemeName.length >= 3 && t.value.length >= 3) {
                            const prefixTarget = targetThemeName.slice(0, 3).toLowerCase();
                            const prefixSource = t.value.slice(0, 3).toLowerCase();
                            if (prefixTarget === prefixSource) {
                                isRecommended = true;
                                score = 50;
                            }
                        }

                        if (isRecommended) {
                            recommendations.push({ theme: t, score });
                        }
                    });

                    recommendations.sort((a, b) => b.score - a.score);
                    return recommendations.map(r => r.theme);
                }

                // === 提取配色模态框相关逻辑 (支持动态注入、FontAwesome 搜索与 OptGroup 结构化分组) ===
                let _colorTransferTargetTheme = null;

                function getOrBuildColorTransferModal() {
                    let modal = document.querySelector('#tm-color-transfer-modal');
                    if (!modal) {
                        modal = document.createElement('div');
                        modal.id = 'tm-color-transfer-modal';
                        modal.className = 'tm-modal';
                        modal.style.display = 'none';
                        modal.innerHTML = `
                            <div class="tm-modal-content" style="max-width: 440px;">
                                <div class="tm-modal-header">
                                    <h3><i class="fa-solid fa-palette"></i> 提取配色方案</h3>
                                    <button id="close-color-transfer-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                                </div>
                                <div class="tm-modal-body">
                                    <div style="margin-bottom: 12px; font-size: 13px;">
                                        <strong>目标美化:</strong> <span id="color-transfer-target-name" style="color: var(--SmartThemeQuoteColor, #4a90e2); font-weight: bold;"></span>
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; margin-bottom: 6px; font-size: 12px;"><strong>选择来源美化 (提取其颜色配置):</strong></label>
                                        <div style="position: relative; margin-bottom: 8px;">
                                            <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.5; font-size: 12px; pointer-events: none;"></i>
                                            <input type="search" id="color-transfer-search-input" class="text_pole" placeholder="搜索来源美化名称..." style="width: 100%; height: 32px; padding-left: 30px; font-size: 12px; box-sizing: border-box; margin: 0;">
                                        </div>
                                        <select id="color-transfer-source-select" class="text_pole" size="8" style="width: 100%; height: 200px; font-size: 12px; margin: 0; padding: 4px; box-sizing: border-box;"></select>
                                    </div>
                                </div>
                                <div class="tm-modal-footer" style="display:flex; justify-content:flex-end; gap:8px; padding-top:10px;">
                                    <button id="cancel-color-transfer-btn" class="menu_button" style="margin:0;">取消</button>
                                    <button id="confirm-color-transfer-btn" class="menu_button menu_button_icon primary" style="background: var(--SmartThemeQuoteColor, #4a90e2) !important; color: #fff !important; margin:0;"><i class="fa-solid fa-check"></i> 确认覆盖配色</button>
                                </div>
                            </div>`;
                        document.body.appendChild(modal);

                        modal.querySelector('#close-color-transfer-modal').addEventListener('click', closeColorTransferModal);
                        modal.querySelector('#cancel-color-transfer-btn').addEventListener('click', closeColorTransferModal);
                        modal.querySelector('#confirm-color-transfer-btn').addEventListener('click', async () => {
                            if (!_colorTransferTargetTheme) return;
                            const sourceSelect = modal.querySelector('#color-transfer-source-select');
                            const sourceThemeName = sourceSelect ? sourceSelect.value : '';
                            if (!sourceThemeName) {
                                toastr.warning('请先选择一个来源美化！');
                                return;
                            }
                            const targetThemeName = _colorTransferTargetTheme;
                            closeColorTransferModal();
                            await transferThemeColors(sourceThemeName, targetThemeName);
                        });
                    }
                    return modal;
                }

                function openColorTransferModal(targetThemeName) {
                    _colorTransferTargetTheme = targetThemeName;
                    const modal = getOrBuildColorTransferModal();
                    const targetNameSpan = modal.querySelector('#color-transfer-target-name');
                    const sourceSelect = modal.querySelector('#color-transfer-source-select');
                    const searchInput = modal.querySelector('#color-transfer-search-input');

                    if (targetNameSpan) targetNameSpan.textContent = targetThemeName;
                    if (searchInput) searchInput.value = '';

                    const otherThemes = allParsedThemes.filter(t => t.value !== targetThemeName);
                    const recommendedThemes = getSmartRecommendedThemes(targetThemeName, otherThemes);
                    const recommendedSet = new Set(recommendedThemes.map(t => t.value));

                    // 加载扩展分类标签
                    const cachedTags = loadThemeTags();
                    const tagMap = new Map();
                    cachedTags.forEach(tag => {
                        tagMap.set(tag.id, { name: tag.name, themes: [] });
                    });

                    const unclassifiedThemes = [];

                    // 归类非推荐的主题
                    otherThemes.forEach(t => {
                        if (recommendedSet.has(t.value)) return;

                        if (t.tags && t.tags.length > 0) {
                            let added = false;
                            t.tags.forEach(tagId => {
                                const group = tagMap.get(tagId);
                                if (group) {
                                    group.themes.push(t);
                                    added = true;
                                }
                            });
                            if (!added) unclassifiedThemes.push(t);
                        } else {
                            unclassifiedThemes.push(t);
                        }
                    });

                    function renderSourceSelectOptions(filterKeyword = '') {
                        if (!sourceSelect) return;
                        sourceSelect.innerHTML = '';
                        const keyword = filterKeyword.toLowerCase().trim();
                        let firstSelectableOption = null;

                        const addGroup = (groupTitle, themes, isRecommend = false) => {
                            const matched = themes.filter(t => !keyword || t.display.toLowerCase().includes(keyword));
                            if (matched.length === 0) return;

                            const groupEl = document.createElement('optgroup');
                            groupEl.label = groupTitle;

                            matched.forEach(t => {
                                const opt = document.createElement('option');
                                opt.value = t.value;
                                opt.textContent = isRecommend ? `${t.display} (智能推荐)` : t.display;
                                groupEl.appendChild(opt);
                                if (!firstSelectableOption) {
                                    firstSelectableOption = opt;
                                }
                            });

                            sourceSelect.appendChild(groupEl);
                        };

                        // 1. 智能推荐分组
                        if (recommendedThemes.length > 0) {
                            addGroup('智能推荐 (同系列美化)', recommendedThemes, true);
                        }

                        // 2. 标签分类分组
                        cachedTags.forEach(tag => {
                            const groupData = tagMap.get(tag.id);
                            if (groupData && groupData.themes.length > 0) {
                                addGroup(`标签: ${groupData.name}`, groupData.themes);
                            }
                        });

                        // 3. 其他未分类分组
                        if (unclassifiedThemes.length > 0) {
                            addGroup('未分类美化', unclassifiedThemes);
                        }

                        // 默认选中推荐的第一项
                        if (firstSelectableOption) {
                            firstSelectableOption.selected = true;
                        }
                    }

                    renderSourceSelectOptions();

                    // 绑定实时搜索框输入事件
                    if (searchInput) {
                        searchInput.oninput = (e) => {
                            renderSourceSelectOptions(e.target.value);
                        };
                    }

                    modal.style.display = 'flex';
                }

                function closeColorTransferModal() {
                    const modal = document.querySelector('#tm-color-transfer-modal');
                    if (modal) modal.style.display = 'none';
                    _colorTransferTargetTheme = null;
                }

                async function transferThemeColors(sourceName, targetName) {
                    const sourceObj = allThemeObjectsMap.get(sourceName);
                    const targetObj = allThemeObjectsMap.get(targetName);
                    if (!sourceObj || !targetObj) {
                        toastr.error('获取美化主题数据失败！');
                        return;
                    }

                    showLoader();
                    try {
                        const colorKeys = [
                            'main_text_color', 'italics_text_color', 'underline_text_color', 'quote_text_color',
                            'blur_tint_color', 'chat_tint_color', 'user_mes_blur_tint_color', 'bot_mes_blur_tint_color',
                            'shadow_color', 'border_color', 'blur_strength', 'shadow_width', 'font_scale', 'chat_width'
                        ];

                        colorKeys.forEach(key => {
                            if (sourceObj[key] !== undefined) {
                                targetObj[key] = sourceObj[key];
                            }
                        });

                        await saveTheme(targetObj);
                        updateSTThemeMemory(targetObj, 'add');
                        allThemeObjectsMap.set(targetName, targetObj);

                        if (originalSelect.value === targetName) {
                            applyThemeColors(targetObj);
                            syncCustomCssToST(targetObj.custom_css);
                        }

                        toastr.success(`已成功从「${sourceName}」提取配色应用至「${targetName}」！`);
                    } catch (err) {
                        console.error('[Theme Manager Error] 提取配色应用失败:', err);
                        toastr.error('配色应用失败，请检查控制台。');
                    } finally {
                        hideLoader();
                    }
                }

                firstPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (currentPage > 1) {
                            currentPage = 1;
                            buildThemeListLazy(0);
                            managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    });
                });

                prevPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (currentPage > 1) {
                            currentPage--;
                            buildThemeListLazy(0);
                            managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    });
                });

                nextPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const totalPages = Math.ceil(filteredThemes.length / pageSize);
                        if (currentPage < totalPages) {
                            currentPage++;
                            buildThemeListLazy(0);
                            managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    });
                });

                lastPageBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const totalPages = Math.ceil(filteredThemes.length / pageSize);
                        if (currentPage < totalPages) {
                            currentPage = totalPages;
                            buildThemeListLazy(0);
                            managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                                managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                            managerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } else {
                            e.target.value = String(currentPage);
                        }
                    });
                });

                randomBtn.addEventListener('click', async () => {
                    // 复用已缓存的主题列表，避免额外的 API 请求
                    if (allParsedThemes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * allParsedThemes.length);
                        originalSelect.value = allParsedThemes[randomIndex].value;
                        triggerSelectChange(originalSelect);
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



                fileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    if (!files.length) return;

                    showLoader();

                    // 1. 并行读取文件内容并解析 JSON
                    const fileReadPromises = Array.from(files).map(async (file) => {
                        try {
                            const fileContent = await file.text();
                            const themeObject = JSON.parse(fileContent);
                            const filenameWithoutExt = file.name.replace(/\.json$/i, '');
                            if (themeObject && typeof themeObject.main_text_color !== 'undefined') {
                                // 确保 themeObject.name 保持与导入的文件名完全一致，防止保存文件名与 UI 注册不一致
                                themeObject.name = filenameWithoutExt || themeObject.name;
                                return { file, themeObject, valid: true };
                            }
                            return { file, valid: false, error: '非有效的主题文件' };
                        } catch (err) {
                            return { file, valid: false, error: err.message };
                        }
                    });

                    console.log(`[Theme Manager] 开始处理批量导入文件, 选择的文件数: ${files.length}`);

                    const parsedFiles = await Promise.all(fileReadPromises);
                    const validFiles = parsedFiles.filter(f => f.valid);
                    const invalidFiles = parsedFiles.filter(f => !f.valid);

                    if (invalidFiles.length > 0) {
                        invalidFiles.forEach(f => {
                            console.error(`[Theme Manager Error] 无效的主题文件 "${f.file.name}":`, f.error);
                        });
                    }

                    let successCount = 0;
                    let errorCount = invalidFiles.length;
                    const importedThemes = [];
                    let needsUIUpdate = false;

                    // 2. 并行发送 API 保存请求 (限制并发为 5)
                    if (validFiles.length > 0) {
                        console.log(`[Theme Manager] 开始并发保存 ${validFiles.length} 个有效主题...`);
                        const saveResults = await limitConcurrency(5, validFiles, async ({ themeObject }) => {
                            try {
                                await saveTheme(themeObject);
                                return { success: true, themeObject };
                            } catch (err) {
                                return { success: false, themeObject, error: err };
                            }
                        });

                        // 收集保存成功的主题
                        saveResults.forEach((res, index) => {
                            const orig = validFiles[index];
                            if (res.status === 'fulfilled' && res.value.success) {
                                successCount++;
                                const themeObject = res.value.themeObject;
                                importedThemes.push(themeObject);
                                console.log(`[Theme Manager] 成功保存主题到服务器: "${themeObject.name}"`);
                            } else {
                                errorCount++;
                                console.error(`[Theme Manager Error] 保存主题 "${orig.themeObject.name}" 失败:`, res.status === 'fulfilled' ? res.value.error : res.reason);
                            }
                        });
                    }

                    // 3. 批量更新下拉框、内存及 UI DOM
                    if (importedThemes.length > 0) {
                        needsUIUpdate = true;

                        // 批量更新 ST 原生下拉框 & 同步内部内存
                        _suspendObserver = true;
                        try {
                            importedThemes.forEach(themeObject => {
                                updateSTThemeMemory(themeObject, 'add');
                                const existingOption = findOptionByValue(originalSelect, themeObject.name);
                                if (!existingOption) {
                                    const option = document.createElement('option');
                                    option.value = themeObject.name;
                                    option.textContent = themeObject.name;
                                    originalSelect.appendChild(option);
                                }
                                stKnownThemes.add(themeObject.name);
                            });
                            syncStKnownThemes();
                        } finally {
                            setTimeout(() => { _suspendObserver = false; }, 0);
                        }

                        invalidateThemesCache();

                        // 预先读取一次标签并缓存
                        const cachedTags = loadThemeTags();
                        const listFragment = document.createDocumentFragment();
                        const list = contentWrapper.querySelector('.theme-list');

                        importedThemes.forEach(themeObject => {
                            const themeName = themeObject.name;
                            const existingParsed = allParsedThemesMap.get(themeName);
                            const isNewTheme = !existingParsed;

                            if (isNewTheme) {
                                // 批量构建并追加到 DocumentFragment
                                softAddThemeUI(themeObject, cachedTags, listFragment);
                            } else {
                                // 覆盖现有主题：使用 Object.assign 原地更新数据，免去 findIndex 的 O(N) 搜索开销
                                const existingObj = allThemeObjectsMap.get(themeName);
                                if (existingObj) {
                                    Object.assign(existingObj, themeObject);
                                } else {
                                    allThemeObjects.push(themeObject);
                                    allThemeObjectsMap.set(themeName, themeObject);
                                }
                            }
                        });

                        // 一次性挂载到 DOM，减少 Reflow
                        if (list && listFragment.children.length > 0) {
                            list.appendChild(listFragment);
                        }

                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                        }
                    }

                    hideLoader();
                    
                    let summary = `批量导入完成！成功 ${successCount} 个`;
                    if (errorCount > 0) {
                        summary += `，失败 ${errorCount} 个。`;
                        toastr.warning(summary);
                    } else {
                        summary += '。';
                        toastr.success(summary);
                    }

                    if (needsUIUpdate) {
                        updateActiveState();
                    }

                    // 关键词自动映射：导入时自动为新主题打标签
                    if (importedThemes.length > 0) {
                        applyKeywordMappings(importedThemes.map(t => t.name));
                    }

                    event.target.value = '';
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

                if (resetAllSystemBtn) {
                    resetAllSystemBtn.addEventListener('click', async () => {
                        const popupContent = document.createElement('div');
                        popupContent.innerHTML = `
                            <h4><i class="fa-solid fa-triangle-exclamation" style="color:#ff8888; margin-right:6px;"></i>重置美化插件数据</h4>
                            <p style="font-size:12px; opacity:0.8; margin-bottom:12px; text-align:left;">请勾选您需要清除的数据模块（此操作不可逆）：</p>
                            <div style="display:flex; flex-direction:column; gap:8px; margin:10px 0; text-align:left; padding-left:10px;">
                                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                    <input type="checkbox" id="reset-opt-tags" checked> 重置美化标签与分类设置
                                </label>
                                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                    <input type="checkbox" id="reset-opt-bindings" checked> 重置角色卡美化自动映射
                                </label>
                                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                    <input type="checkbox" id="reset-opt-avatars" checked> 重置头像高级设置（缩放/偏移/框/图库）
                                </label>
                            </div>
                            <p style="font-size:11px; color:#ff8888; margin-top:10px; text-align:left;">确认重置后，网页将会自动刷新以载入默认状态。</p>
                        `;

                        await callGenericPopup(popupContent, 'confirm', null, {
                            okButton: '确认重置',
                            cancelButton: '取消',
                            wide: true,
                            onOpen: (popup) => {
                                const dlg = popup.dlg;
                                if (dlg) {
                                    dlg.style.width = '90%';
                                    dlg.style.maxWidth = '450px';
                                }
                                const okButton = dlg.querySelector('.popup-button-ok');
                                if (okButton) {
                                    okButton.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
                                    okButton.style.color = '#fff';
                                    okButton.addEventListener('click', (e) => {
                                        e.preventDefault();
                                        const doTags = dlg.querySelector('#reset-opt-tags').checked;
                                        const doBindings = dlg.querySelector('#reset-opt-bindings').checked;
                                        const doAvatars = dlg.querySelector('#reset-opt-avatars').checked;

                                        let clearedCount = 0;
                                        if (doTags) {
                                            localStorage.removeItem('themeManager_themeTags');
                                            localStorage.removeItem('themeManager_activeTagsFilters');
                                            clearedCount++;
                                        }
                                        if (doBindings) {
                                            localStorage.removeItem('themeManager_characterThemeBindings');
                                            clearedCount++;
                                        }
                                        if (doAvatars) {
                                            localStorage.removeItem('themeManager_avatarAdjustments');
                                            localStorage.removeItem('themeManager_customFrames');
                                            localStorage.removeItem('themeManager_avatarPanelGeometry');
                                            localStorage.removeItem('themeManager_disableAvatarZoom');
                                            clearedCount++;
                                        }

                                        if (clearedCount > 0) {
                                            toastr.success('选定数据已成功重置，正在重新载入页面...');
                                            setTimeout(() => location.reload(), 1000);
                                        } else {
                                            toastr.info('未勾选任何重置选项。');
                                        }
                                        popup.close();
                                    });
                                }
                            }
                        });
                    });
                }


                // 将定义放在 openManageTagsPopup 之前，以便弹窗内可直接调用
                function applyKeywordMappings(themeNames) {
                    const tags = loadThemeTags();
                    const hasKeywords = tags.some(t => t.keywords && t.keywords.length > 0);
                    if (!hasKeywords) return false;

                    const themesToCheck = themeNames
                        ? (Array.isArray(themeNames) ? themeNames : [themeNames])
                        : allParsedThemes.map(t => t.value);
                    let changed = false;

                    for (const themeName of themesToCheck) {
                        const nameLC = themeName.toLowerCase();
                        for (const tag of tags) {
                            if (!tag.keywords || tag.keywords.length === 0) continue;
                            const matches = tag.keywords.some(kw => kw && nameLC.includes(kw.toLowerCase()));
                            if (matches) {
                                if (!tag.themes) tag.themes = [];
                                if (!tag.themes.includes(themeName)) {
                                    tag.themes.push(themeName);
                                    changed = true;
                                }
                            }
                        }
                    }

                    if (changed) {
                        saveThemeTags(tags);
                        softRefreshUI(themeNames && Array.isArray(themeNames) ? themeNames : null);
                    }
                    return changed;
                }

                // === 超强分词与停止词过滤 (解决 700+ 超量美化在移动端卡顿) ===
                // === 超强分词与停止词过滤 (解决 700+ 超量美化在移动端卡顿) ===
                const AUTO_GROUP_STOPWORDS = new Set([
                    'json', 'theme', 'themes', 'preset', 'presets', 'copy', 'new', 'fixed', 'final',
                    '360px', '1080p', '720p', 'v1', 'v2', 'v3', 'v4', 'v5', 'mode', 'ui', 'dark', 'light',
                    'st', 'sillytavern', 'main', 'card', 'style', 'test', 'demo',
                    '美化', '主题', '预设', '整合', '重置', '修改', '修复', '最终', '完整', '通用', '版本', '备份', '副本'
                ]);

                function extractCandidateThemeGroups(themePool, minMatch = 2, targetLevel = 'l1', parentId = null) {
                    const list = themePool || allParsedThemes || [];
                    const candidateMap = new Map(); // kw -> Set(themeName)

                    // 0. 收集同级已存在的标签名，若已存在同名标签则自动跳过
                    const existingTags = loadThemeTags();
                    const existingTagNamesAtLevel = new Set(
                        existingTags
                            .filter(t => (targetLevel === 'l2' ? t.parentId === parentId : (!t.parentId || !existingTags.some(p => p.id === t.parentId))))
                            .map(t => t.name.trim().toLowerCase())
                    );

                    // 1. 匹配各类括号里面的独立标记词（如 【黑金】 [Cyberpunk] (v2) 《动漫》 <Lite>）
                    list.forEach(t => {
                        const name = t.display || t.value;
                        if (!name) return;

                        // A. 括号内标签提取
                        let match;
                        const bRegex = /[\[【（(《<](.+?)[\]】）)》>]/g;
                        while ((match = bRegex.exec(name)) !== null) {
                            const kw = match[1].trim();
                            const kwLower = kw.toLowerCase();
                            if (kw.length >= 1 && kw.length <= 20 && !AUTO_GROUP_STOPWORDS.has(kwLower) && !existingTagNamesAtLevel.has(kwLower)) {
                                if (!candidateMap.has(kw)) candidateMap.set(kw, new Set());
                                candidateMap.get(kw).add(t.value);
                            }
                        }

                        // B. 常用分词提取 (按空格、下划线、加号等分隔)
                        const cleanName = name.replace(/[\[\]【】（）()《》<>]/g, ' ');
                        const tokens = cleanName.split(/[\s_\-\+\/\\]+/).map(s => s.trim()).filter(Boolean);

                        tokens.forEach(token => {
                            const tokenLower = token.toLowerCase();
                            if (token.length >= 2 && token.length <= 15) {
                                if (!/^\d+$/.test(token) && !AUTO_GROUP_STOPWORDS.has(tokenLower) && !existingTagNamesAtLevel.has(tokenLower)) {
                                    if (!candidateMap.has(token)) candidateMap.set(token, new Set());
                                    candidateMap.get(token).add(t.value);
                                }
                            }
                        });
                    });

                    // 2. 转换为数组并按门槛筛选
                    const result = [];
                    candidateMap.forEach((themesSet, kw) => {
                        if (themesSet.size >= minMatch) {
                            result.push({
                                keyword: kw,
                                themes: Array.from(themesSet)
                            });
                        }
                    });

                    // 3. 最大公约词归并提取 (Longest Common Prefix Subsumption)
                    // 按照关键词字符串长度升序排序（短词优先）
                    result.sort((a, b) => a.keyword.length - b.keyword.length);
                    const prunedCandidates = [];

                    for (const item of result) {
                        const kwLower = item.keyword.toLowerCase();
                        // 检测当前关键词是否为已有较短候选词的衍生词（例如 "12345" 包含了短词 "1234"）
                        const isSubsumed = prunedCandidates.some(parent => {
                            const parentKwLower = parent.keyword.toLowerCase();
                            if (kwLower.includes(parentKwLower)) {
                                const parentSet = new Set(parent.themes);
                                const overlapCount = item.themes.filter(tName => parentSet.has(tName)).length;
                                // 若当前词 75% 以上的美化已被短词包含，则直接取最大公约词，剔除衍生冗余长词
                                if (overlapCount / item.themes.length >= 0.75) {
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (!isSubsumed) {
                            prunedCandidates.push(item);
                        }
                    }

                    // 按包含的美化数量降序排列，截取前 80 个最热门候选
                    prunedCandidates.sort((a, b) => b.themes.length - a.themes.length);
                    return prunedCandidates.slice(0, 80);
                }

                // === 分组向导 Step 1: 设置基数范围、目标层级与门槛 ===
                async function openAutoGroupWizard() {
                    if (!allParsedThemes || allParsedThemes.length === 0) {
                        toastr.info('当前没有可供提取标签的美化主题。');
                        return;
                    }

                    const existingTags = loadThemeTags();
                    const l1Tags = existingTags.filter(t => !t.parentId || !existingTags.some(p => p.id === t.parentId));

                    let l1SelectOptionsHtml = l1Tags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
                    if (!l1SelectOptionsHtml) {
                        l1SelectOptionsHtml = '<option value="">(尚未创建一级主标签)</option>';
                    }

                    let allTagsSelectOptionsHtml = existingTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.themes ? t.themes.length : 0})</option>`).join('');
                    if (!allTagsSelectOptionsHtml) {
                        allTagsSelectOptionsHtml = '<option value="">(暂无已选标签)</option>';
                    }

                    const selectedCount = selectedForBatch ? selectedForBatch.size : 0;
                    const filteredCount = typeof filteredThemes !== 'undefined' ? filteredThemes.length : allParsedThemes.length;
                    const scopeFilteredLabel = selectedCount > 0 ? `当前批量勾选的美化 (共 ${selectedCount} 个)` : `当前界面已筛选的美化 (共 ${filteredCount} 个)`;

                    const setupHtml = `
                        <div style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
                            <h4 style="margin:0 0 10px 0; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-wand-magic-sparkles" style="color:#ffc107;"></i> 智能美化分组向导
                            </h4>
                            <div style="background:rgba(255,255,255,0.04); border-radius:6px; padding:16px; flex:1; display:flex; flex-direction:column; gap:16px; overflow-y:auto;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-layer-group"></i> 1. 选择分析的美化基数范围：
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="all" checked style="margin:0;">
                                            <span>全部美化主题 (共 <b>${allParsedThemes.length}</b> 个)</span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="filtered" style="margin:0;">
                                            <span>${scopeFilteredLabel}</span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="tag" style="margin:0;">
                                            <span>特定标签下的美化</span>
                                        </label>
                                        <div id="tm-auto-scope-tag-container" style="margin-left:24px; display:none;">
                                            <select id="tm-auto-scope-tag-select" class="text_pole" style="font-size:12px; height:30px; padding:2px 8px; width:100%; max-width:280px;">
                                                ${allTagsSelectOptionsHtml}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-sitemap"></i> 2. 选择生成标签的目标层级：
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-level" value="l1" checked style="margin:0;">
                                            <span>创建为 <b>一级主标签/分类</b></span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-level" value="l2" style="margin:0;">
                                            <span>创建为 <b>二级子标签</b> (支持向归属主分类融合/合并)</span>
                                        </label>
                                        <div id="tm-auto-parent-container" style="margin-left:24px; display:none;">
                                            <select id="tm-auto-parent-select" class="text_pole" style="font-size:12px; height:30px; padding:2px 8px; width:100%; max-width:280px;">
                                                ${l1SelectOptionsHtml}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-filter"></i> 3. 提取门槛：
                                    </div>
                                    <div style="display:inline-flex; align-items:center; gap:8px; font-size:13px; padding-left:12px;">
                                        <span>至少重合包含：</span>
                                        <input type="number" id="tm-auto-min-match" class="text_pole" value="2" min="2" max="50" style="width:60px; text-align:center; height:28px; padding:0; margin:0;">
                                        <span>个美化主题</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;

                    let selectedScope = 'all';
                    let selectedLevel = 'l1';
                    let parentId = null;
                    let minMatch = 2;

                    const popupRes = await callGenericPopup(setupHtml, 'confirm', null, {
                        title: '分组提取设置',
                        okButton: '<i class="fa-solid fa-play"></i> 开始分析提取',
                        cancelButton: '<i class="fa-solid fa-xmark"></i> 取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = getPopupContainer(popup);
                            let isBatchDeleteMode = false;
                            const selectedBatchTagIds = new Set();
                            if (dlg) {
                                dlg.style.width = '80vw';
                                dlg.style.height = '80vh';
                                dlg.style.maxWidth = '900px';
                                dlg.style.maxHeight = '80vh';
                                dlg.style.display = 'flex';
                                dlg.style.flexDirection = 'column';
                            }

                            const scopeRadios = dlg.querySelectorAll('input[name="tm-auto-scope"]');
                            const scopeTagContainer = dlg.querySelector('#tm-auto-scope-tag-container');
                            scopeRadios.forEach(r => {
                                r.addEventListener('change', () => {
                                    if (r.checked) selectedScope = r.value;
                                    scopeTagContainer.style.display = (selectedScope === 'tag') ? 'block' : 'none';
                                });
                            });

                            const levelRadios = dlg.querySelectorAll('input[name="tm-auto-level"]');
                            const parentContainer = dlg.querySelector('#tm-auto-parent-container');
                            levelRadios.forEach(r => {
                                r.addEventListener('change', () => {
                                    if (r.checked) selectedLevel = r.value;
                                    parentContainer.style.display = (selectedLevel === 'l2') ? 'block' : 'none';
                                });
                            });

                            const minMatchInput = dlg.querySelector('#tm-auto-min-match');
                            const parentSelect = dlg.querySelector('#tm-auto-parent-select');

                            dlg.addEventListener('change', () => {
                                const checkedScope = dlg.querySelector('input[name="tm-auto-scope"]:checked');
                                if (checkedScope) selectedScope = checkedScope.value;
                                const checkedLevel = dlg.querySelector('input[name="tm-auto-level"]:checked');
                                if (checkedLevel) selectedLevel = checkedLevel.value;
                                if (parentSelect) parentId = parentSelect.value;
                                if (minMatchInput) minMatch = parseInt(minMatchInput.value) || 2;
                            });
                        }
                    });

                    if (!popupRes) return;

                    showLoader();
                    setTimeout(() => {
                        try {
                            let pool = [];
                            if (selectedScope === 'filtered') {
                                if (selectedForBatch && selectedForBatch.size > 0) {
                                    const set = new Set(selectedForBatch);
                                    pool = allParsedThemes.filter(t => set.has(t.value));
                                } else if (typeof filteredThemes !== 'undefined' && filteredThemes.length > 0) {
                                    pool = filteredThemes;
                                } else {
                                    pool = allParsedThemes;
                                }
                            } else if (selectedScope === 'tag') {
                                const scopeTagId = document.querySelector('#tm-auto-scope-tag-select')?.value;
                                const scopeTag = existingTags.find(tg => tg.id === scopeTagId);
                                if (scopeTag && scopeTag.themes) {
                                    const tagThemesSet = new Set(scopeTag.themes);
                                    pool = allParsedThemes.filter(t => tagThemesSet.has(t.value));
                                } else {
                                    pool = allParsedThemes;
                                }
                            } else {
                                pool = allParsedThemes;
                            }

                            const candidates = extractCandidateThemeGroups(pool, minMatch, selectedLevel, parentId);
                            hideLoader();

                            if (candidates.length === 0) {
                                toastr.info(`在选定的 ${pool.length} 个美化中，未分析到重合数 ≥ ${minMatch} 且未重复的词组分类。`);
                                return;
                            }

                            // 启动审核向导，带空 historyStack 历史战报栈
                            runAutoGroupReviewStep(candidates, 0, selectedLevel, parentId, 0, 0, []);
                        } catch (err) {
                            hideLoader();
                            console.error('分组提取失败:', err);
                            toastr.error('分组提取发生异常: ' + (err.message || err));
                        }
                    }, 150);
                }

                // === 分组向导 Step 2: 逐个审核通过/不通过（支持 80% 大屏幕、最大公约数提取与子标签合并） ===
                async function runAutoGroupReviewStep(candidates, currentIndex, level, parentId, createdTagsCount, assignedThemesCount, historyStack = []) {
                    if (currentIndex >= candidates.length) {
                        renderTagsUI();
                        updateActiveState();
                        toastr.success(`🎉 分组向导已完成！共创建/更新了 ${createdTagsCount} 个标签分类。`);
                        return;
                    }

                    const candidate = candidates[currentIndex];
                    const targetLevelLabel = level === 'l2' ? '二级子标签' : '一级主标签';
                    const MAX_INITIAL_THEMES = 25;
                    const initialThemes = candidate.themes.slice(0, MAX_INITIAL_THEMES);
                    const remainingThemes = candidate.themes.slice(MAX_INITIAL_THEMES);

                    const wizardHtml = `
                        <div style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:8px;">
                                <span style="font-weight:bold; font-size:14px; color:var(--SmartThemeQuoteColor, #4a90e2); display:inline-flex; align-items:center; gap:6px;">
                                    <i class="fa-solid fa-list-check" style="color:#ffc107;"></i> 审核分组向导 (${currentIndex + 1} / ${candidates.length})
                                </span>
                                <span style="font-size:12px; padding:3px 10px; border-radius:12px; background:rgba(0,123,255,0.18); color:#4dabf7; font-weight:bold;">
                                    <i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>${targetLevelLabel}
                                </span>
                            </div>
                            <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:6px; margin-bottom:10px; flex:1; display:flex; flex-direction:column; min-height:0;">
                                <div style="font-size:14px; font-weight:bold; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
                                    <span style="display:inline-flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-tag" style="color:#ffc107;"></i> 标签名称：
                                        <input type="text" id="wizard-tag-name-input" class="text_pole" value="${escapeHtml(candidate.keyword)}" style="display:inline-block; width:200px; height:28px; padding:2px 8px; font-size:13px; margin:0;">
                                    </span>
                                    <span style="font-size:12px; font-weight:normal; opacity:0.8;">
                                        <i class="fa-solid fa-layer-group" style="margin-right:4px;"></i> 匹配 <b>${candidate.themes.length}</b> 个美化
                                    </span>
                                </div>
                                <div style="font-size:12px; opacity:0.75; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
                                    <i class="fa-solid fa-tags"></i> 勾选需加入该标签的美化（支持多标签与已存在同名分类合并）：
                                </div>
                                <div id="wizard-themes-container" style="flex:1; max-height:calc(80vh - 180px); overflow-y:auto; background:rgba(0,0,0,0.15); padding:8px; border-radius:4px; display:flex; flex-direction:column; gap:4px;">
                                    ${initialThemes.map(tName => `
                                        <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px; user-select:none;">
                                            <input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;">
                                            <span style="word-break:break-all;">${escapeHtml(tName)}</span>
                                        </label>
                                    `).join('')}
                                    ${remainingThemes.length > 0 ? `
                                        <button id="wizard-load-more-btn" class="menu_button" style="margin:6px 0 0 0; font-size:11px; width:100%; justify-content:center; background:rgba(255,255,255,0.06);"><i class="fa-solid fa-chevron-down"></i> 展开余下 ${remainingThemes.length} 个美化...</button>
                                    ` : ''}
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px;">
                                <div style="display:flex; gap:6px;">
                                    ${historyStack.length > 0 ? `
                                        <button id="wizard-undo-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(255,193,7,0.2) !important; color:#ffc107 !important;" title="撤销上一步操作并重写上个卡片"><i class="fa-solid fa-rotate-left"></i> 上一步</button>
                                    ` : ''}
                                    <button id="wizard-stop-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(220,53,69,0.2) !important; color:#ff8888 !important;" title="结束向导并保存当前已建立的分组"><i class="fa-solid fa-circle-stop"></i> 结束向导</button>
                                </div>
                                <button id="wizard-pass-all-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(0,123,255,0.2) !important; color:#4dabf7 !important;" title="将其余候选全自动通过"><i class="fa-solid fa-forward-fast"></i> 全部剩余通过</button>
                            </div>
                        </div>
                    `;

                    let actionTaken = 'standard';

                    const popupRes = await callGenericPopup(wizardHtml, 'confirm', null, {
                        title: `美化分组审核 (${currentIndex + 1}/${candidates.length})`,
                        okButton: '<i class="fa-solid fa-check"></i> 通过并创建/合并',
                        cancelButton: '<i class="fa-solid fa-xmark"></i> 不通过 / 跳过',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;
                            if (dlg) {
                                dlg.style.width = '80vw';
                                dlg.style.height = '80vh';
                                dlg.style.maxWidth = '900px';
                                dlg.style.maxHeight = '80vh';
                                dlg.style.display = 'flex';
                                dlg.style.flexDirection = 'column';
                            }

                            const loadMoreBtn = dlg.querySelector('#wizard-load-more-btn');
                            if (loadMoreBtn) {
                                loadMoreBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    const container = dlg.querySelector('#wizard-themes-container');
                                    loadMoreBtn.remove();
                                    const frag = document.createDocumentFragment();
                                    remainingThemes.forEach(tName => {
                                        const lbl = document.createElement('label');
                                        lbl.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px; user-select:none;';
                                        lbl.innerHTML = `<input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;"><span style="word-break:break-all;">${escapeHtml(tName)}</span>`;
                                        frag.appendChild(lbl);
                                    });
                                    container.appendChild(frag);
                                });
                            }

                            const undoBtn = dlg.querySelector('#wizard-undo-btn');
                            if (undoBtn) {
                                undoBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'undo';
                                    popup.close();
                                });
                            }

                            const stopBtn = dlg.querySelector('#wizard-stop-btn');
                            if (stopBtn) {
                                stopBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'stop';
                                    popup.close();
                                });
                            }

                            const passAllBtn = dlg.querySelector('#wizard-pass-all-btn');
                            if (passAllBtn) {
                                passAllBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'pass_all';
                                    popup.close();
                                });
                            }
                        }
                    });

                    // 辅助函数：保存/更新/合并二级与一级标签但不重刷全量 DOM
                    const createTagAndSaveSilent = (cItem, tagName, themesList) => {
                        if (!themesList || themesList.length === 0) return { success: false, isNew: false };
                        let tags = loadThemeTags();

                        let isNew = false;
                        // 支持同级标签合并：匹配同级别且同名的已有标签
                        let tagObj = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase() && (parentId ? t.parentId === parentId : (!t.parentId || !tags.some(p => p.id === t.parentId))));
                        if (!tagObj) {
                            isNew = true;
                            tagObj = {
                                id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                                name: tagName,
                                parentId: parentId || null,
                                themes: [],
                                keywords: [tagName]
                            };
                            tags.push(tagObj);
                        } else {
                            if (parentId && !tagObj.parentId) tagObj.parentId = parentId;
                            if (!tagObj.keywords) tagObj.keywords = [];
                            if (!tagObj.keywords.includes(tagName)) tagObj.keywords.push(tagName);
                        }

                        if (!tagObj.themes) tagObj.themes = [];
                        themesList.forEach(tn => {
                            if (!tagObj.themes.includes(tn)) tagObj.themes.push(tn);
                        });

                        // 若为二级子标签，同步把美化追加至其归属的一级主分类 themes 中
                        if (parentId) {
                            const parentTagObj = tags.find(t => t.id === parentId);
                            if (parentTagObj) {
                                if (!parentTagObj.themes) parentTagObj.themes = [];
                                themesList.forEach(tn => {
                                    if (!parentTagObj.themes.includes(tn)) parentTagObj.themes.push(tn);
                                });
                            }
                        }

                        saveThemeTags(tags);
                        return { success: true, isNew: isNew, tagId: tagObj.id };
                    };

                    // 1. 中途撤销上一步 (Rollback History)
                    if (actionTaken === 'undo') {
                        if (historyStack.length > 0) {
                            const lastStep = historyStack.pop();
                            if (lastStep.action === 'approve' && lastStep.addedThemes && lastStep.addedThemes.length > 0) {
                                let tags = loadThemeTags();
                                const tagObj = tags.find(t => t.name.toLowerCase() === lastStep.tagName.toLowerCase() && (parentId ? t.parentId === parentId : true));
                                if (tagObj && tagObj.themes) {
                                    const removeSet = new Set(lastStep.addedThemes);
                                    tagObj.themes = tagObj.themes.filter(tn => !removeSet.has(tn));
                                    if (tagObj.themes.length === 0 && lastStep.isNew) {
                                        const idx = tags.indexOf(tagObj);
                                        if (idx > -1) tags.splice(idx, 1);
                                    }
                                    saveThemeTags(tags);
                                }
                            }
                            const newCreatedCount = Math.max(0, createdTagsCount - (lastStep.action === 'approve' ? 1 : 0));
                            setTimeout(() => runAutoGroupReviewStep(candidates, lastStep.currentIndex, level, parentId, newCreatedCount, assignedThemesCount, historyStack), 50);
                        } else {
                            setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex, level, parentId, createdTagsCount, assignedThemesCount, historyStack), 50);
                        }
                        return;
                    }

                    // 2. 中途停止向导
                    if (actionTaken === 'stop') {
                        renderTagsUI();
                        updateActiveState();
                        toastr.info(`⏹️ 分组向导已停止。已为您生成并保存了 ${createdTagsCount} 个标签分类。`);
                        return;
                    }

                    // 3. 全部剩余自动通过
                    if (actionTaken === 'pass_all') {
                        let passCount = 0;
                        for (let i = currentIndex; i < candidates.length; i++) {
                            const c = candidates[i];
                            const res = createTagAndSaveSilent(c, c.keyword, c.themes);
                            if (res.success) passCount++;
                        }
                        renderTagsUI();
                        updateActiveState();
                        toastr.success(`🎉 分组向导完成！共自动生成并挂载了 ${createdTagsCount + passCount} 个标签分类。`);
                        return;
                    }

                    // 4. 标准用户按键分支 (通过 vs 跳过)
                    if (popupRes) {
                        // 用户点击了 '✅ 通过并创建/合并标签'
                        const tagNameInput = document.querySelector('#wizard-tag-name-input');
                        const tagName = (tagNameInput ? tagNameInput.value : candidate.keyword).trim() || candidate.keyword;
                        const checkedThemes = Array.from(document.querySelectorAll('.wizard-theme-chk:checked')).map(cb => cb.value);
                        const finalThemes = checkedThemes.length > 0 ? checkedThemes : candidate.themes;

                        const saveRes = createTagAndSaveSilent(candidate, tagName, finalThemes);

                        historyStack.push({
                            currentIndex: currentIndex,
                            action: 'approve',
                            tagName: tagName,
                            addedThemes: finalThemes,
                            isNew: saveRes.isNew
                        });

                        setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex + 1, level, parentId, createdTagsCount + (saveRes.success ? 1 : 0), assignedThemesCount + finalThemes.length, historyStack), 50);
                    } else {
                        // 用户点击了 '❌ 不通过 / 跳过'
                        historyStack.push({
                            currentIndex: currentIndex,
                            action: 'skip',
                            tagName: candidate.keyword,
                            addedThemes: [],
                            isNew: false
                        });

                        setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex + 1, level, parentId, createdTagsCount, assignedThemesCount, historyStack), 50);
                    }
                }

                

function getPopupContainer(popup) {
    if (!popup) return document;
    if (popup.dlg) {
        if (popup.dlg instanceof Element) return popup.dlg;
        if (popup.dlg[0] instanceof Element) return popup.dlg[0];
        if (typeof popup.dlg.find === 'function') return popup.dlg[0] || document;
    }
    if (popup instanceof Element) return popup;
    if (popup[0] instanceof Element) return popup[0];
    if (typeof popup.find === 'function') return popup[0] || document;
    return document;
}

function normalizeTagHierarchy(tags) {
    if (!Array.isArray(tags)) return [];
    tags.forEach((t, idx) => {
        if (!t.id) t.id = 'tag_' + Date.now() + '_' + idx;
    });
    const validIds = new Set(tags.map(t => String(t.id)));
    tags.forEach(t => {
        if (t.parentId && (!validIds.has(String(t.parentId)) || String(t.parentId) === String(t.id))) {
            t.parentId = null;
        }
    });
    return tags;
}

async function openManageTagsPopup() {
                    invalidateTagsCache();
                    let tags = normalizeTagHierarchy(loadThemeTags());
                    let subtagsEnabled = isSubtagsEnabled();

                    let popupHtml = `
                        <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:10px;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:bold; user-select:none;">
                                <input type="checkbox" id="chk-enable-subtags" ${subtagsEnabled ? 'checked' : ''}>
                                <span>开启二级目录模式</span> <small style="opacity:0.6; font-weight:normal;">(支持一级目录/二级标签)</small>
                            </label>
                            <button id="tm-tags-batch-delete-mode-btn" class="menu_button" style="margin:0; font-size:12px; padding:3px 10px; height:28px; line-height:1; display:inline-flex; align-items:center; gap:4px; flex-shrink:0; white-space:nowrap; background:rgba(220,53,69,0.15) !important; color:#ff8888 !important; border:1px solid rgba(220,53,69,0.3) !important;"><i class="fa-solid fa-trash-can"></i> 批量删除</button>
                        </div>
                        <div style="margin-bottom:15px; display:flex; gap:8px; align-items:center;">
                            <input type="text" id="new-tag-name" class="text_pole" placeholder="${subtagsEnabled ? '新一级标签名称...' : '新标签名称...'}" style="flex-grow:1; min-width:0;">
                            <button id="add-new-tag-btn" class="menu_button" style="margin:0; white-space:nowrap; flex-shrink:0; width:auto;"><i class="fa-solid fa-plus"></i> ${subtagsEnabled ? '添加一级标签' : '添加标签'}</button>
                        </div>
                        <div id="tags-management-list" style="max-height: 380px; overflow-y:auto; padding-right:4px;"></div>
                        <div style="margin-top:10px; border-top:1px solid rgba(128,128,128,0.2); padding-top:10px;">
                            <button id="apply-keyword-mappings-btn" class="menu_button" style="width:100%; justify-content:center;"><i class="fa-solid fa-wand-magic-sparkles"></i> 对所有现有美化重新应用关键词映射</button>
                        </div>
                    `;

                    await callGenericPopup(popupHtml, 'confirm', null, {
                        title: '管理标签',
                        okButton: '关闭',
                        cancelButton: '取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;

                            const renderList = () => {
                                const listContainer = dlg.querySelector('#tags-management-list');
                                if (!listContainer) return;

                                invalidateTagsCache();
                                tags = normalizeTagHierarchy(loadThemeTags());

                                if (!tags || tags.length === 0) {
                                    listContainer.innerHTML = `<div style="text-align:center; padding:30px 10px; opacity:0.6; font-size:13px; background:rgba(255,255,255,0.02); border-radius:6px; margin:10px 0;">
                                        <i class="fa-solid fa-tags" style="font-size:24px; margin-bottom:8px; display:block; color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                                        暂无任何标签分类<br>
                                        <small style="opacity:0.75;">请在上方输入名称并点击「${subtagsEnabled ? '+添加一级标签' : '+添加标签'}」，或在主界面使用「分组」向导生成分类。</small>
                                    </div>`;
                                    return;
                                }

                                if (!subtagsEnabled) {
                                    let html = '<ul style="list-style:none; padding:0; margin:0;">';
                                    tags.forEach((t, idx) => {
                                        const kwCount = t.keywords ? t.keywords.length : 0;
                                        html += `
                                            <li class="tm-flat-tag-item" data-id="${t.id}" data-index="${idx}" style="display:flex; justify-content:space-between; padding:6px 8px; background:rgba(255,255,255,0.04); margin-bottom:4px; border-radius:4px; align-items:center;">
                                                <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
                                                    ${isBatchDeleteMode ? `<input type="checkbox" class="tm-tag-batch-chk" data-id="${t.id}" ${selectedBatchTagIds.has(t.id) ? 'checked' : ''} style="margin:0 4px 0 0; cursor:pointer;">` : ''}<i class="fa-solid fa-tag" style="opacity:0.7; font-size:11px; flex-shrink:0;"></i>
                                                    <span style="word-break: break-all; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(t.name)}</span>
                                                    <small style="opacity:0.6; flex-shrink:0; white-space:nowrap;">(${t.themes ? t.themes.length : 0})</small>
                                                    ${kwCount > 0 ? `<small style="opacity:0.5; flex-shrink:0; white-space:nowrap;">[${kwCount}词]</small>` : ''}
                                                </div>
                                                <div style="display:flex; gap:3px; align-items:center; flex-shrink:0;">
                                                    <button class="menu_button move-flat-up tm-btn-icon-only" data-id="${t.id}" title="向上移动" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                                                    <button class="menu_button move-flat-down tm-btn-icon-only" data-id="${t.id}" title="向下移动" ${idx === tags.length - 1 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                                                    <button class="menu_button keywords-tag-inline tm-btn-icon-only" data-id="${t.id}" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                                    <button class="menu_button rename-tag-inline tm-btn-icon-only" data-id="${t.id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                                    <button class="menu_button delete-tag-inline tm-btn-icon-only" data-id="${t.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
                                                </div>
                                            </li>
                                        `;
                                    });
                                    html += '</ul>';
                                    listContainer.innerHTML = html;
                                    listContainer.querySelectorAll('.tm-tag-batch-chk').forEach(chk => {
                                        chk.addEventListener('change', (e) => {
                                            const id = e.target.dataset.id;
                                            if (e.target.checked) selectedBatchTagIds.add(id);
                                            else selectedBatchTagIds.delete(id);
                                            const btn = dlg.querySelector('#tm-tags-batch-delete-mode-btn');
                                            if (btn && isBatchDeleteMode) {
                                                btn.innerHTML = `<i class="fa-solid fa-check"></i> 确认删除已选 (${selectedBatchTagIds.size})`;
                                            }
                                        });
                                    });
                                } else {
                                    let html = '<div class="tm-subtags-tree">';
                                    const l1Tags = tags.filter(t => !t.parentId);

                                    l1Tags.forEach((l1Tag, l1Idx) => {
                                        const kwCount = l1Tag.keywords ? l1Tag.keywords.length : 0;
                                        const childTags = tags.filter(t => t.parentId === l1Tag.id);

                                        html += `
                                            <div class="tm-level1-card" data-id="${l1Tag.id}" data-index="${l1Idx}">
                                                <div class="tm-level1-header" data-id="${l1Tag.id}">
                                                    <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
                                                        ${isBatchDeleteMode ? `<input type="checkbox" class="tm-tag-batch-chk" data-id="${l1Tag.id}" ${selectedBatchTagIds.has(l1Tag.id) ? 'checked' : ''} style="margin:0 4px 0 0; cursor:pointer;">` : ''}<i class="fa-solid fa-folder-open" style="color:var(--SmartThemeQuoteColor, #4a90e2); flex-shrink:0;"></i>
                                                        <span style="font-weight:bold; font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(l1Tag.name)}</span>
                                                        <small style="opacity:0.6; flex-shrink:0; white-space:nowrap;">(二级:${childTags.length}/主题:${l1Tag.themes ? l1Tag.themes.length : 0})</small>
                                                        ${kwCount > 0 ? `<small style="opacity:0.5; flex-shrink:0; white-space:nowrap;">[${kwCount}词]</small>` : ''}
                                                    </div>
                                                    <div style="display:flex; gap:3px; align-items:center; flex-shrink:0;">
                                                        <button class="menu_button move-l1-up tm-btn-icon-only" data-id="${l1Tag.id}" title="向上移动一级目录" ${l1Idx === 0 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                                                        <button class="menu_button move-l1-down tm-btn-icon-only" data-id="${l1Tag.id}" title="向下移动一级目录" ${l1Idx === l1Tags.length - 1 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                                                        <button class="menu_button add-subtag-btn tm-btn-icon-only" data-id="${l1Tag.id}" title="添加二级标签"><i class="fa-solid fa-plus"></i></button>
                                                        <button class="menu_button demote-tag-inline tm-btn-icon-only" data-id="${l1Tag.id}" title="降为二级标签（划入别的一级目录）"><i class="fa-solid fa-turn-down"></i></button>
                                                        <button class="menu_button keywords-tag-inline tm-btn-icon-only" data-id="${l1Tag.id}" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                                        <button class="menu_button rename-tag-inline tm-btn-icon-only" data-id="${l1Tag.id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                                        <button class="menu_button delete-tag-inline tm-btn-icon-only" data-id="${l1Tag.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
                                                    </div>
                                                </div>
                                                <div class="tm-level2-container" data-parent-id="${l1Tag.id}">
                                        `;

                                        if (childTags.length === 0) {
                                            html += `<div class="tm-empty-subtags-dropzone" data-parent-id="${l1Tag.id}">(暂无二级标签)</div>`;
                                        } else {
                                            childTags.forEach((cTag, cIdx) => {
                                                const cKwCount = cTag.keywords ? cTag.keywords.length : 0;
                                                html += `
                                                    <div class="tm-level2-item" data-id="${cTag.id}" data-parent-id="${l1Tag.id}" data-index="${cIdx}">
                                                        <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
                                                            ${isBatchDeleteMode ? `<input type="checkbox" class="tm-tag-batch-chk" data-id="${cTag.id}" ${selectedBatchTagIds.has(cTag.id) ? 'checked' : ''} style="margin:0 4px 0 0; cursor:pointer;">` : ''}<i class="fa-solid fa-tag" style="opacity:0.7; font-size:11px; flex-shrink:0;"></i>
                                                            <span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(cTag.name)}</span>
                                                            <small style="opacity:0.6; flex-shrink:0; white-space:nowrap;">(${cTag.themes ? cTag.themes.length : 0})</small>
                                                            ${cKwCount > 0 ? `<small style="opacity:0.5; flex-shrink:0; white-space:nowrap;">[${cKwCount}词]</small>` : ''}
                                                        </div>
                                                        <div style="display:flex; gap:3px; align-items:center; flex-shrink:0;">
                                                            <button class="menu_button move-l2-up tm-btn-icon-only" data-id="${cTag.id}" title="向上移动" ${cIdx === 0 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                                                            <button class="menu_button move-l2-down tm-btn-icon-only" data-id="${cTag.id}" title="向下移动" ${cIdx === childTags.length - 1 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                                                            <button class="menu_button promote-tag-inline tm-btn-icon-only" data-id="${cTag.id}" title="升为独立一级目录/标签"><i class="fa-solid fa-turn-up"></i></button>
                                                            <button class="menu_button keywords-tag-inline tm-btn-icon-only" data-id="${cTag.id}" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                                            <button class="menu_button rename-tag-inline tm-btn-icon-only" data-id="${cTag.id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                                            <button class="menu_button delete-tag-inline tm-btn-icon-only" data-id="${cTag.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
                                                        </div>
                                                    </div>
                                                `;
                                            });
                                        }
                                        html += `
                                                </div>
                                            </div>
                                        `;
                                    });
                                    html += '</div>';
                                    listContainer.innerHTML = html;
                                }

                                BindEvents();
                            };

                            function BindEvents() {
                                // 删除
                                dlg.querySelectorAll('.delete-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        if (confirm('确定删除此标签吗？(不会删除主题本身)')) {
                                            const targetTag = tags.find(t => t.id === id);
                                            const affectedThemes = targetTag && targetTag.themes ? [...targetTag.themes] : [];
                                            tags.forEach(t => {
                                                if (t.parentId === id) t.parentId = null;
                                            });
                                            tags = tags.filter(t => t.id !== id);
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI(affectedThemes);
                                        }
                                    });
                                });

                                // 重命名
                                dlg.querySelectorAll('.rename-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const newName = prompt('输入新名称:', tag.name);
                                        if (newName && newName.trim() && newName.trim() !== tag.name) {
                                            tag.name = newName.trim();
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI(tag.themes || []);
                                        }
                                    });
                                });

                                // 关键词
                                dlg.querySelectorAll('.keywords-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const currentKeywords = (tag.keywords || []).join(', ');
                                        const input = prompt(
                                            `「${tag.name}」的关键词（逗号分隔）\n导入或重命名的美化名如包含这些词，将自动归入此标签：`,
                                            currentKeywords
                                        );
                                        if (input !== null) {
                                            tag.keywords = input.split(',').map(k => k.trim()).filter(k => k.length > 0);
                                            saveThemeTags(tags);
                                            renderList();
                                        }
                                    });
                                });

                                // 添加二级标签
                                dlg.querySelectorAll('.add-subtag-btn').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const parentId = e.currentTarget.dataset.id;
                                        const parentTag = tags.find(t => t.id === parentId);
                                        const subName = prompt(`为一级目录「${parentTag ? parentTag.name : ''}」添加二级标签名称:`);
                                        if (subName && subName.trim()) {
                                            const name = subName.trim();
                                            if (tags.some(t => t.name === name && t.parentId === parentId)) {
                                                toastr.warning('该一级目录已存在同名二级标签');
                                                return;
                                            }
                                            tags.push({ id: Date.now().toString(), name: name, parentId: parentId, themes: [], keywords: [] });
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI([]);
                                        }
                                    });
                                });

                                // 提升为一级标签
                                dlg.querySelectorAll('.promote-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (tag) {
                                            tag.parentId = null;
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI([]);
                                            toastr.success(`已将「${tag.name}」升为一级标签`);
                                        }
                                    });
                                });

                                // 降为二级标签（划入别的一级目录）
                                dlg.querySelectorAll('.demote-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const l1Tag = tags.find(t => t.id === id);
                                        if (!l1Tag) return;
                                        const otherL1Tags = tags.filter(t => (!t.parentId || !tags.some(p => p.id === t.parentId)) && t.id !== id);
                                        if (otherL1Tags.length === 0) {
                                            toastr.warning('没有其他一级目录，请先新建另一个一级目录');
                                            return;
                                        }

                                        let selectHtml = `<p style="margin-bottom:10px;">选择将「<b>${escapeHtml(l1Tag.name)}</b>」转为哪个一级目录下的二级标签：</p>
                                        <div style="display:flex; flex-direction:column; gap:8px; max-height:260px; overflow-y:auto; padding-right:4px;">`;
                                        otherL1Tags.forEach((targetL1, idx) => {
                                            selectHtml += `
                                                <label class="target-l1-label" style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.05); border-radius:6px; cursor:pointer; user-select:none; border:1px solid rgba(128,128,128,0.2); transition:background 0.2s;">
                                                    <input type="radio" name="target_l1_radio" value="${targetL1.id}" ${idx === 0 ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px; accent-color:var(--SmartThemeQuoteColor, #4a90e2);">
                                                    <i class="fa-solid fa-folder-open" style="color:var(--SmartThemeQuoteColor, #4a90e2); font-size:14px;"></i>
                                                    <span style="font-weight:bold; font-size:13px; flex:1; min-width:0; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(targetL1.name)}</span>
                                                    <small style="opacity:0.6; flex-shrink:0;">(${targetL1.themes ? targetL1.themes.length : 0}个主题)</small>
                                                </label>
                                            `;
                                        });
                                        selectHtml += `</div>`;

                                        callGenericPopup(selectHtml, 'confirm', null, {
                                            title: '降为二级标签',
                                            okButton: '确定转换',
                                            cancelButton: '取消',
                                            wide: true,
                                            onOpen: (subPopup) => {
                                                const subDlg = subPopup.dlg;
                                                subDlg.querySelectorAll('.target-l1-label').forEach(lbl => {
                                                    lbl.addEventListener('click', () => {
                                                        const rad = lbl.querySelector('input[type="radio"]');
                                                        if (rad) rad.checked = true;
                                                    });
                                                });
                                                const okBtn = subDlg ? subDlg.querySelector('.popup-button-ok') : null;
                                                if (okBtn) {
                                                    okBtn.addEventListener('click', () => {
                                                        const checkedRadio = subDlg.querySelector('input[name="target_l1_radio"]:checked');
                                                        if (!checkedRadio) return;
                                                        const targetL1Id = checkedRadio.value;
                                                        tags.forEach(t => {
                                                            if (t.parentId === l1Tag.id) t.parentId = null;
                                                        });
                                                        l1Tag.parentId = targetL1Id;
                                                        saveThemeTags(tags);
                                                        renderList();
                                                        softRefreshUI();
                                                        toastr.success(`已将「${l1Tag.name}」划入别的一级目录作为二级标签`);
                                                    });
                                                }
                                            }
                                        });
                                    });
                                });

                                // 上下移动按钮事件 (平级模式)
                                dlg.querySelectorAll('.move-flat-up').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const idx = tags.findIndex(t => t.id === id);
                                        if (idx > 0) {
                                            const [moved] = tags.splice(idx, 1);
                                            tags.splice(idx - 1, 0, moved);
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI();
                                        }
                                    });
                                });
                                dlg.querySelectorAll('.move-flat-down').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const idx = tags.findIndex(t => t.id === id);
                                        if (idx > -1 && idx < tags.length - 1) {
                                            const [moved] = tags.splice(idx, 1);
                                            tags.splice(idx + 1, 0, moved);
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI();
                                        }
                                    });
                                });

                                // 上下移动按钮事件 (一级目录)
                                dlg.querySelectorAll('.move-l1-up').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const l1Tags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                                        const l1Idx = l1Tags.findIndex(t => t.id === id);
                                        if (l1Idx > 0) {
                                            const srcTag = l1Tags[l1Idx];
                                            const tgtTag = l1Tags[l1Idx - 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });
                                dlg.querySelectorAll('.move-l1-down').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const l1Tags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                                        const l1Idx = l1Tags.findIndex(t => t.id === id);
                                        if (l1Idx > -1 && l1Idx < l1Tags.length - 1) {
                                            const srcTag = l1Tags[l1Idx];
                                            const tgtTag = l1Tags[l1Idx + 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });

                                // 上下移动按钮事件 (二级标签)
                                dlg.querySelectorAll('.move-l2-up').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const childTags = tags.filter(t => t.parentId === tag.parentId);
                                        const cIdx = childTags.findIndex(t => t.id === id);
                                        if (cIdx > 0) {
                                            const srcTag = childTags[cIdx];
                                            const tgtTag = childTags[cIdx - 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });
                                dlg.querySelectorAll('.move-l2-down').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const childTags = tags.filter(t => t.parentId === tag.parentId);
                                        const cIdx = childTags.findIndex(t => t.id === id);
                                        if (cIdx > -1 && cIdx < childTags.length - 1) {
                                            const srcTag = childTags[cIdx];
                                            const tgtTag = childTags[cIdx + 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });
                            };

                            const chkSubtags = dlg.querySelector('#chk-enable-subtags');
                            if (chkSubtags) {
                                chkSubtags.addEventListener('change', () => {
                                    subtagsEnabled = chkSubtags.checked;
                                    localStorage.setItem(ENABLE_SUBTAGS_KEY, subtagsEnabled ? 'true' : 'false');
                                    const input = dlg.querySelector('#new-tag-name');
                                    const addBtn = dlg.querySelector('#add-new-tag-btn');
                                    if (input) input.placeholder = subtagsEnabled ? '新一级标签名称...' : '新标签名称...';
                                    if (addBtn) addBtn.innerHTML = subtagsEnabled ? '<i class="fa-solid fa-plus"></i> 添加一级标签' : '<i class="fa-solid fa-plus"></i> 添加标签';
                                    renderList();
                                    softRefreshUI();
                                });
                            }

                            dlg.querySelector('#add-new-tag-btn').addEventListener('click', () => {
                                const input = dlg.querySelector('#new-tag-name');
                                const name = input.value.trim();
                                if (!name) return;
                                if (tags.some(t => t.name === name && !t.parentId)) {
                                    toastr.warning('同名标签已存在');
                                    return;
                                }
                                tags.push({ id: Date.now().toString(), name: name, parentId: null, themes: [], keywords: [] });
                                saveThemeTags(tags);
                                input.value = '';
                                renderList();
                                softRefreshUI();
                            });

                            const applyMappingsBtn = dlg.querySelector('#apply-keyword-mappings-btn');
                            if (applyMappingsBtn) {
                                applyMappingsBtn.addEventListener('click', () => {
                                    const applied = applyKeywordMappings();
                                    if (applied) {
                                        toastr.success('关键词映射已重新应用！');
                                    } else {
                                        toastr.info('没有找到新的匹配，或尚未设置关键词。');
                                    }
                                });
                            }

                            const modalAutoGroupBtn = dlg.querySelector('#modal-auto-group-btn');
                            if (modalAutoGroupBtn) {
                                modalAutoGroupBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    popup.close();
                                    openAutoGroupWizard();
                                });
                            }

                            renderList();
                        }
                    });
                }

                async function openTagAssignmentPopup(themeNames) {
                    const singleMode = typeof themeNames === 'string';
                    const themesToAssign = singleMode ? [themeNames] : themeNames;

                    let tags = loadThemeTags();
                    if (tags.length === 0) {
                        toastr.info('还没有创建任何标签，请先去管理标签中创建。');
                        return;
                    }

                    const subtagsEnabled = isSubtagsEnabled();
                    let popupHtml = `<p>选择要分配的标签：</p><div style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">`;

                    if (!subtagsEnabled) {
                        tags.forEach(t => {
                            const isChecked = singleMode ? (t.themes && t.themes.includes(themeNames)) : false;
                            popupHtml += `
                                <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                                    <input type="checkbox" class="tag-assign-cb" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
                                    ${escapeHtml(t.name)}
                                </label>
                            `;
                        });
                    } else {
                        const l1Tags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                        l1Tags.forEach(l1 => {
                            const isCheckedL1 = singleMode ? (l1.themes && l1.themes.includes(themeNames)) : false;
                            const childTags = tags.filter(t => t.parentId === l1.id);
                            popupHtml += `
                                <div style="border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px; background:rgba(255,255,255,0.02);">
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:bold; font-size:12px;">
                                        <input type="checkbox" class="tag-assign-cb" data-id="${l1.id}" ${isCheckedL1 ? 'checked' : ''}>
                                        <i class="fa-solid fa-folder-open" style="color:var(--SmartThemeQuoteColor, #4a90e2); font-size:11px;"></i>
                                        ${escapeHtml(l1.name)}
                                    </label>
                            `;
                            if (childTags.length > 0) {
                                popupHtml += `<div style="display:flex; flex-direction:column; gap:4px; margin-left:22px; margin-top:4px; padding-left:6px; border-left:2px solid rgba(255,255,255,0.1);">`;
                                childTags.forEach(c => {
                                    const isCheckedC = singleMode ? (c.themes && c.themes.includes(themeNames)) : false;
                                    popupHtml += `
                                        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
                                            <input type="checkbox" class="tag-assign-cb" data-id="${c.id}" ${isCheckedC ? 'checked' : ''}>
                                            <i class="fa-solid fa-tag" style="opacity:0.7; font-size:10px;"></i>
                                            ${escapeHtml(c.name)}
                                        </label>
                                    `;
                                });
                                popupHtml += `</div>`;
                            }
                            popupHtml += `</div>`;
                        });
                    }
                    popupHtml += `</div>`;

                    await callGenericPopup(popupHtml, 'confirm', null, {
                        title: singleMode ? `设置标签: ${themeNames.replace(/\[.*?\]/g, '').trim()}` : `批量设置标签 (${themesToAssign.length} 个主题)`,
                        okButton: '保存',
                        onOpen: (popup) => {
                            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                                const checkboxes = popup.dlg.querySelectorAll('.tag-assign-cb');
                                const tagsById = new Map(tags.map(t => [t.id, t]));
                                checkboxes.forEach(cb => {
                                    const tagId = cb.dataset.id;
                                    const tag = tagsById.get(tagId);
                                    if (!tag) return;
                                    if (!tag.themes) tag.themes = [];

                                    if (cb.checked) {
                                        themesToAssign.forEach(th => {
                                            if (!tag.themes.includes(th)) tag.themes.push(th);
                                        });
                                    } else {
                                        if (singleMode) {
                                            const idx = tag.themes.indexOf(themeNames);
                                            if (idx > -1) tag.themes.splice(idx, 1);
                                        }
                                    }
                                });
                                saveThemeTags(tags);
                                toastr.success('标签分配已保存');
                                if (!singleMode && isBatchEditMode) {
                                    selectedForBatch.clear();
                                    lastClickedThemeName = null;
                                }
                                softRefreshUI(themesToAssign);
                            });
                        }
                    });
                }

                async function openTagRemovalPopup(themeNames) {
                    const themesToAssign = themeNames;

                    let tags = loadThemeTags();
                    if (tags.length === 0) {
                        toastr.info('还没有创建任何标签，无法移除。');
                        return;
                    }

                    const subtagsEnabled = isSubtagsEnabled();
                    let popupHtml = `<p>选择要从所选主题中移除的标签：</p><div style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">`;

                    if (!subtagsEnabled) {
                        tags.forEach(t => {
                            popupHtml += `
                                <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                                    <input type="checkbox" class="tag-remove-cb" data-id="${t.id}">
                                    ${escapeHtml(t.name)}
                                </label>
                            `;
                        });
                    } else {
                        const l1Tags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                        l1Tags.forEach(l1 => {
                            const childTags = tags.filter(t => t.parentId === l1.id);
                            popupHtml += `
                                <div style="border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px; background:rgba(255,255,255,0.02);">
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:bold; font-size:12px;">
                                        <input type="checkbox" class="tag-remove-cb" data-id="${l1.id}">
                                        <i class="fa-solid fa-folder-open" style="color:var(--SmartThemeQuoteColor, #4a90e2); font-size:11px;"></i>
                                        ${escapeHtml(l1.name)}
                                    </label>
                            `;
                            if (childTags.length > 0) {
                                popupHtml += `<div style="display:flex; flex-direction:column; gap:4px; margin-left:22px; margin-top:4px; padding-left:6px; border-left:2px solid rgba(255,255,255,0.1);">`;
                                childTags.forEach(c => {
                                    popupHtml += `
                                        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
                                            <input type="checkbox" class="tag-remove-cb" data-id="${c.id}">
                                            <i class="fa-solid fa-tag" style="opacity:0.7; font-size:10px;"></i>
                                            ${escapeHtml(c.name)}
                                        </label>
                                    `;
                                });
                                popupHtml += `</div>`;
                            }
                            popupHtml += `</div>`;
                        });
                    }
                    popupHtml += `</div>`;

                    await callGenericPopup(popupHtml, 'confirm', null, {
                        title: `批量移除标签 (${themesToAssign.length} 个主题)`,
                        okButton: '移除',
                        cancelButton: '取消',
                        onOpen: (popup) => {
                            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                                const checkboxes = popup.dlg.querySelectorAll('.tag-remove-cb');
                                let removedAnything = false;
                                checkboxes.forEach(cb => {
                                    if (cb.checked) {
                                        const tagId = cb.dataset.id;
                                        const tag = tags.find(t => t.id === tagId);
                                        if (tag && tag.themes) {
                                            themesToAssign.forEach(th => {
                                                const idx = tag.themes.indexOf(th);
                                                if (idx > -1) {
                                                    tag.themes.splice(idx, 1);
                                                    removedAnything = true;
                                                }
                                            });
                                        }
                                    }
                                });
                                if (removedAnything) {
                                    saveThemeTags(tags);
                                    toastr.success('已成功移除标签');
                                }
                                if (isBatchEditMode) {
                                    selectedForBatch.clear();
                                    lastClickedThemeName = null;
                                }
                                softRefreshUI();
                            });
                        }
                    });
                }

                async function openBatchRenamePopup(themeNames) {
                    if (!themeNames || themeNames.length === 0) return;

                    const popupHtml = `
                        <div id="tm-batch-rename-dialog" style="display:flex; flex-direction:column; gap:12px; max-width:550px; text-align:left;">
                            <p style="margin:0; font-size:13px; opacity:0.9;">
                                为已选中的 <strong>${themeNames.length}</strong> 个主题批量修改名称。选择重命名规则并输入相关参数：
                            </p>

                            <div style="display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); padding-bottom:8px;">
                                <button type="button" class="menu_button tm-rename-tab active" data-tab="prefix" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-heading"></i> 前缀</button>
                                <button type="button" class="menu_button tm-rename-tab" data-tab="suffix" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-align-left"></i> 后缀</button>
                                <button type="button" class="menu_button tm-rename-tab" data-tab="phrase" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-cube"></i> 固定词组</button>
                                <button type="button" class="menu_button tm-rename-tab" data-tab="combo" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-layer-group"></i> 综合设置</button>
                            </div>

                            <!-- Panel 1: 前缀设置 -->
                            <div class="tm-rename-panel" data-panel="prefix" style="display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:16px; align-items:center;">
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-prefix-action" value="add" checked> 增加前缀
                                    </label>
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-prefix-action" value="remove"> 删除前缀
                                    </label>
                                </div>
                                <div>
                                    <input type="text" id="tm-rename-prefix-input" class="text_pole" placeholder="请输入前缀文本 (如: [Cyber] )" style="width:100%; box-sizing:border-box;">
                                </div>
                            </div>

                            <!-- Panel 2: 后缀设置 -->
                            <div class="tm-rename-panel" data-panel="suffix" style="display:none; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:16px; align-items:center;">
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-suffix-action" value="add" checked> 增加后缀
                                    </label>
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-suffix-action" value="remove"> 删除后缀
                                    </label>
                                </div>
                                <div>
                                    <input type="text" id="tm-rename-suffix-input" class="text_pole" placeholder="请输入后缀文本 (如: _v2)" style="width:100%; box-sizing:border-box;">
                                </div>
                            </div>

                            <!-- Panel 3: 固定词组设置 -->
                            <div class="tm-rename-panel" data-panel="phrase" style="display:none; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:16px; align-items:center;">
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-phrase-action" value="delete" checked> 删除固定词组
                                    </label>
                                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                                        <input type="radio" name="tm-phrase-action" value="replace"> 替换固定词组
                                    </label>
                                </div>
                                <div style="display:flex; flex-direction:column; gap:6px;">
                                    <input type="text" id="tm-rename-find-phrase" class="text_pole" placeholder="要查找/删除的固定词组" style="width:100%; box-sizing:border-box;">
                                    <input type="text" id="tm-rename-replace-phrase" class="text_pole" placeholder="替换为 (留空代表直接删除该词组)" style="width:100%; box-sizing:border-box; display:none;">
                                </div>
                            </div>

                            <!-- Panel 4: 综合设置 -->
                            <div class="tm-rename-panel" data-panel="combo" style="display:none; flex-direction:column; gap:8px;">
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">增加前缀：</span>
                                        <input type="text" id="tm-combo-add-prefix" class="text_pole" placeholder="前缀" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">匹配删除前缀：</span>
                                        <input type="text" id="tm-combo-del-prefix" class="text_pole" placeholder="前缀" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">增加后缀：</span>
                                        <input type="text" id="tm-combo-add-suffix" class="text_pole" placeholder="后缀" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">匹配删除后缀：</span>
                                        <input type="text" id="tm-combo-del-suffix" class="text_pole" placeholder="后缀" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                </div>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">查找固定词组：</span>
                                        <input type="text" id="tm-combo-find-phrase" class="text_pole" placeholder="词组" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                    <div>
                                        <span style="font-size:11px; opacity:0.8;">替换为：</span>
                                        <input type="text" id="tm-combo-replace-phrase" class="text_pole" placeholder="替换文本 (留空即删)" style="width:100%; box-sizing:border-box; height:28px;">
                                    </div>
                                </div>
                            </div>

                            <!-- 实时预览区 -->
                            <div style="margin-top:4px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                    <span style="font-size:12px; font-weight:bold; opacity:0.9;"><i class="fa-solid fa-eye"></i> 重命名效果预览：</span>
                                    <span id="tm-preview-count-label" style="font-size:11px; opacity:0.6;"></span>
                                </div>
                                <div id="tm-rename-preview-list" style="max-height:160px; overflow-y:auto; background:rgba(0,0,0,0.15); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); border-radius:4px; padding:6px; font-size:12px; font-family:monospace;">
                                </div>
                            </div>
                        </div>
                    `;

                    await callGenericPopup(popupHtml, 'confirm', null, {
                        title: `批量重命名主题 (${themeNames.length} 个)`,
                        okButton: '开始重命名',
                        cancelButton: '取消',
                        onOpen: (popup) => {
                            const container = popup.dlg.querySelector('#tm-batch-rename-dialog');
                            if (!container) return;

                            let activeTab = 'prefix';

                            const tabs = container.querySelectorAll('.tm-rename-tab');
                            const panels = container.querySelectorAll('.tm-rename-panel');

                            tabs.forEach(tab => {
                                tab.addEventListener('click', () => {
                                    tabs.forEach(t => t.classList.remove('active'));
                                    tab.classList.add('active');
                                    activeTab = tab.dataset.tab;
                                    panels.forEach(p => {
                                        p.style.display = p.dataset.panel === activeTab ? 'flex' : 'none';
                                    });
                                    updatePreview();
                                });
                            });

                            const phraseRadios = container.querySelectorAll('input[name="tm-phrase-action"]');
                            const replaceInput = container.querySelector('#tm-rename-replace-phrase');
                            phraseRadios.forEach(radio => {
                                radio.addEventListener('change', () => {
                                    if (replaceInput) {
                                        replaceInput.style.display = radio.value === 'replace' ? 'block' : 'none';
                                    }
                                    updatePreview();
                                });
                            });

                            container.querySelectorAll('input').forEach(input => {
                                input.addEventListener('input', updatePreview);
                                input.addEventListener('change', updatePreview);
                            });

                            function sanitizeThemeName(str) {
                                if (!str) return '';
                                return str.replace(/[\\/:*?"<>|]/g, '').trim();
                            }

                            function getRenameLogic() {
                                if (activeTab === 'prefix') {
                                    const action = container.querySelector('input[name="tm-prefix-action"]:checked')?.value || 'add';
                                    const prefix = container.querySelector('#tm-rename-prefix-input').value;
                                    if (!prefix) return (name) => name;
                                    if (action === 'add') return (name) => sanitizeThemeName(prefix + name);
                                    if (action === 'remove') return (name) => sanitizeThemeName(name.startsWith(prefix) ? name.slice(prefix.length) : name);
                                } else if (activeTab === 'suffix') {
                                    const action = container.querySelector('input[name="tm-suffix-action"]:checked')?.value || 'add';
                                    const suffix = container.querySelector('#tm-rename-suffix-input').value;
                                    if (!suffix) return (name) => name;
                                    if (action === 'add') return (name) => sanitizeThemeName(name + suffix);
                                    if (action === 'remove') return (name) => sanitizeThemeName(name.endsWith(suffix) ? name.slice(0, name.length - suffix.length) : name);
                                } else if (activeTab === 'phrase') {
                                    const action = container.querySelector('input[name="tm-phrase-action"]:checked')?.value || 'delete';
                                    const findPhrase = container.querySelector('#tm-rename-find-phrase').value;
                                    const replacePhrase = action === 'replace' ? container.querySelector('#tm-rename-replace-phrase').value : '';
                                    if (!findPhrase) return (name) => name;
                                    return (name) => sanitizeThemeName(name.split(findPhrase).join(replacePhrase));
                                } else if (activeTab === 'combo') {
                                    const addPrefix = container.querySelector('#tm-combo-add-prefix').value;
                                    const delPrefix = container.querySelector('#tm-combo-del-prefix').value;
                                    const addSuffix = container.querySelector('#tm-combo-add-suffix').value;
                                    const delSuffix = container.querySelector('#tm-combo-del-suffix').value;
                                    const findPhrase = container.querySelector('#tm-combo-find-phrase').value;
                                    const replacePhrase = container.querySelector('#tm-combo-replace-phrase').value || '';

                                    return function(name) {
                                        let res = name;
                                        if (delPrefix && res.startsWith(delPrefix)) res = res.slice(delPrefix.length);
                                        if (addPrefix) res = addPrefix + res;
                                        if (findPhrase) res = res.split(findPhrase).join(replacePhrase);
                                        if (delSuffix && res.endsWith(delSuffix)) res = res.slice(0, res.length - delSuffix.length);
                                        if (addSuffix) res = res + addSuffix;
                                        return sanitizeThemeName(res);
                                    };
                                }
                                return (name) => name;
                            }

                            function updatePreview() {
                                const logic = getRenameLogic();
                                const previewContainer = container.querySelector('#tm-rename-preview-list');
                                const countLabel = container.querySelector('#tm-preview-count-label');
                                if (!previewContainer) return;

                                let changedCount = 0;
                                let html = '';

                                themeNames.forEach((oldName) => {
                                    const newName = logic(oldName);
                                    const isChanged = oldName !== newName;
                                    if (isChanged) changedCount++;

                                    let statusClass = isChanged ? 'color:#4caf50;' : 'opacity:0.6;';
                                    let changeSymbol = isChanged ? '<i class="fa-solid fa-arrow-right" style="margin:0 4px; font-size:10px;"></i>' : ' (未变)';

                                    let newDisplay = escapeHtml(newName);
                                    if (!newName.trim()) {
                                        newDisplay = '<span style="color:#ff5252;">[空名称 - 无效]</span>';
                                    }

                                    html += `
                                        <div style="display:flex; align-items:center; justify-content:space-between; padding:2px 0; border-bottom:1px dashed rgba(255,255,255,0.05);">
                                            <span style="opacity:0.8; word-break:break-all;">${escapeHtml(oldName)}</span>
                                            <span style="${statusClass} font-weight:bold; white-space:nowrap; margin-left:8px;">${changeSymbol} ${newDisplay}</span>
                                        </div>
                                    `;
                                });

                                previewContainer.innerHTML = html || '<div style="opacity:0.5;">暂无所选主题</div>';
                                if (countLabel) {
                                    countLabel.textContent = `共 ${themeNames.length} 项，其中 ${changedCount} 项将发生改变`;
                                }
                            }

                            updatePreview();

                            const okBtn = popup.dlg.querySelector('.popup-button-ok');
                            if (okBtn) {
                                okBtn.addEventListener('click', async () => {
                                    const logic = getRenameLogic();
                                    let hasChanges = false;
                                    let hasEmpty = false;

                                    for (const name of themeNames) {
                                        const newName = logic(name);
                                        if (!newName.trim()) {
                                            hasEmpty = true;
                                        }
                                        if (newName !== name) {
                                            hasChanges = true;
                                        }
                                    }

                                    if (hasEmpty) {
                                        toastr.error('无法重命名：存在重命名后名称为空的主题。');
                                        return;
                                    }

                                    if (!hasChanges) {
                                        toastr.info('没有名称发生变化，已取消操作。');
                                        return;
                                    }

                                    await performBatchRename(logic);
                                });
                            }
                        }
                    });
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
                                // 尝试点击新版按钮，如果不存在，则点击旧版按钮
                                const toggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                                if (toggleButton) {
                                    toggleButton.click();
                                }
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
                                // ⚠️ 在清内存前先快照完整数据（后台异步块需要用它写盘，届时内存已清）
                                const fullThemeObj = findThemeObject(oldName) || { name: oldName };
                                const isActive = originalSelect.value === oldName;
                                const newThemeObject = { ...fullThemeObj, name: finalNewName };

                                // 0ms 乐观 UI 重命名：在后台写入物理文件的同时，立刻增量更新本地 DOM、下拉框与关系数据
                                manualUpdateOriginalSelect('rename', oldName, finalNewName);
                                updateSTThemeMemory({ name: oldName }, 'delete');
                                updateSTThemeMemory(newThemeObject, 'add');
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
                                let autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {};
                                let autoThemeChanged = false;
                                if (autoThemeSettings.dayTarget === oldName) {
                                    autoThemeSettings.dayTarget = finalNewName;
                                    autoThemeChanged = true;
                                }
                                if (autoThemeSettings.nightTarget === oldName) {
                                    autoThemeSettings.nightTarget = finalNewName;
                                    autoThemeChanged = true;
                                }
                                if (autoThemeChanged) {
                                    localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(autoThemeSettings));
                                }

                                if (Array.isArray(themeDayNightPairs)) {
                                    let pairsChanged = false;
                                    themeDayNightPairs.forEach(p => {
                                        if (p.dayTheme === oldName) { p.dayTheme = finalNewName; pairsChanged = true; }
                                        if (p.nightTheme === oldName) { p.nightTheme = finalNewName; pairsChanged = true; }
                                    });
                                    if (pairsChanged) saveThemeDayNightPairs(themeDayNightPairs);
                                }

                                // 增量更新 UI（0ms 即时响应，不销毁重建整个 DOM 列表）
                                softRenameThemeUI(oldName, finalNewName);

                                // 重命名后，如果是当前激活的主题，我们需要更新当前选择并重新应用以同步ST内部状态
                                if (isActive) {
                                    originalSelect.value = finalNewName;
                                    applyThemeDirect(finalNewName);
                                }
                                toastr.success(`已将「${oldName}」重命名为「${finalNewName}」`);
                                updateActiveState();

                                // 后台异步：写新文件，再删旧文件（使用上面已快照的 fullThemeObj，不重新查内存）
                                (async () => {
                                    console.log(`[Theme Manager Rename] ══════════════════`);
                                    console.log(`[Theme Manager Rename] "${oldName}" → "${finalNewName}"`);
                                    try {
                                        if (!fullThemeObj.main_text_color && !fullThemeObj.custom_css) {
                                            console.warn(`[Theme Manager Rename] ⚠️ 快照数据可能不完整，字段数: ${Object.keys(fullThemeObj).length}`);
                                        }
                                        // 去掉 mtime，保存时不应携带
                                        const { mtime: _mtime, ...cleanObj } = fullThemeObj;
                                        const objectToSave = { ...cleanObj, name: finalNewName };

                                        // Step 1: 写入新文件（suppressToast，避免出现重复报错弹窗）
                                        let saveOk = false;
                                        try {
                                            await apiRequest('themes/save', 'POST', objectToSave, true);
                                            saveOk = true;
                                            console.log(`[Theme Manager Rename] Step 1 ✅ 新文件写入成功: "${finalNewName}.json"`);
                                        } catch (saveErr) {
                                            console.warn(`[Theme Manager Rename] ⚠️ 写入报错 (${saveErr.message})，文件可能已写入，仍继续删旧文件`);
                                        }

                                        // Step 2: 无论 save 是否报错都删旧文件
                                        const deleteOk = await deleteTheme(oldName, fullThemeObj);
                                        console.log(`[Theme Manager Rename] Step 2 ${deleteOk ? '✅' : '⚠️'} 旧文件: "${oldName}"`);

                                        if (!saveOk && !deleteOk) {
                                            toastr.error(`重命名磁盘操作失败：新文件写入与旧文件删除均出错`);
                                        } else if (!deleteOk) {
                                            toastr.warning(`「${oldName}」旧文件未能删除，刷新后可能出现重复`);
                                        }
                                    } catch (e) {
                                        console.error(`[Theme Manager Rename] ❌ 重命名磁盘操作失败:`, e);
                                        toastr.error(`重命名磁盘操作失败: ${e.message || e}`);
                                    }
                                    console.log(`[Theme Manager Rename] ══════════════════`);
                                })();
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
                                    let autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {};
                                    let autoThemeChanged = false;
                                    if (autoThemeSettings.dayTarget === themeName) {
                                        autoThemeSettings.dayTarget = '';
                                        autoThemeChanged = true;
                                    }
                                    if (autoThemeSettings.nightTarget === themeName) {
                                        autoThemeSettings.nightTarget = '';
                                        autoThemeChanged = true;
                                    }
                                    if (autoThemeChanged) {
                                        localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(autoThemeSettings));
                                    }

                                    if (Array.isArray(themeDayNightPairs)) {
                                        themeDayNightPairs = themeDayNightPairs.filter(p => p && p.dayTheme !== themeName && p.nightTheme !== themeName);
                                        saveThemeDayNightPairs(themeDayNightPairs);
                                    }

                                    if (isCurrentlyActive) {
                                        const azureOption = findOptionByValue(originalSelect, 'Azure');
                                        originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                                        triggerSelectChange(originalSelect);
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

                function applyBackgroundDirectly(bgFile) {
                    if (!bgFile) return;

                    // 检查当前背景是否已经是此背景，避免重复应用与重排
                    const bg1 = document.querySelector('#bg1');
                    if (bg1) {
                        const currentBg = bg1.style.backgroundImage;
                        const targetUrl = `backgrounds/${encodeURIComponent(bgFile)}`;
                        if (currentBg && (currentBg.includes(targetUrl) || currentBg.includes(bgFile))) {
                            console.log(`[Theme Manager] 背景图已经是 ${bgFile}，跳过应用`);
                            return;
                        }
                    }

                    // 尝试通过 DOM 元素点击（桌面端通常可用）
                    const escapedBg = CSS.escape(bgFile);
                    const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${escapedBg}"], #bg_custom_content .bg_example[bgfile="${escapedBg}"]`);
                    if (bgElement) {
                        bgElement.click();
                        return;
                    }

                    // 移动端降级方案：直接设置 CSS 背景图 + 持久化设置
                    // 这复刻了 SillyTavern backgrounds.js 中 setBackground() 的核心逻辑
                    try {
                        const bgUrl = `url("backgrounds/${encodeURIComponent(bgFile)}")`;
                        const bg1 = document.querySelector('#bg1');
                        if (bg1) {
                            bg1.style.backgroundImage = bgUrl;
                        }

                        // 通过 SillyTavern 的 power_user 设置持久化背景选择
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            // 更新 SillyTavern 的内部背景设置状态
                            if (ctx.saveSettingsDebounced) {
                                // 读取并修改 power_user 中的背景设置
                                const settingsBlock = document.querySelector('#background_fitting');
                                if (settingsBlock) {
                                    // 触发 ST 的设置保存流程
                                    ctx.saveSettingsDebounced();
                                }
                            }
                        }
                        console.log(`[Theme Manager] 直接应用背景图: ${bgFile}`);
                    } catch (err) {
                        console.error('[Theme Manager] 直接应用背景图失败:', err);
                    }
                }

                originalSelect.addEventListener('change', (event) => {
                    updateActiveState();
                    const newThemeName = event.target.value;
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

                    e.preventDefault();
                    e.stopPropagation();

                    const bgElement = e.target.closest('.bg_example');
                    if (!bgElement) return;

                    const bgFileName = bgElement.getAttribute('bgfile');
                    themeBackgroundBindings[themeNameToBind] = bgFileName;
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    // 先解除绑定模式，否则 applyBackgroundDirectly 内部的模拟点击会被我们自己的拦截器再次拦截
                    isBindingMode = false;
                    const savedThemeNameToBind = themeNameToBind; // 备份一下
                    themeNameToBind = null;

                    // 如果当前关联的主题正是正在使用的主题，则立即应用背景
                    if (savedThemeNameToBind === originalSelect.value) {
                        applyBackgroundDirectly(bgFileName);
                    }

                    // 移除 toastr 提示，实现静默关联

                    // 优化跳转流程：优先尝试打开设置面板
                    const settingsToggleButton = document.querySelector('#user-settings-button .drawer-toggle');
                    if (settingsToggleButton) {
                        const userSettingsPanel = document.querySelector('#user-settings-block');
                        // 只有当设置面板关着时才点它
                        if (userSettingsPanel && userSettingsPanel.classList.contains('closedDrawer')) {
                            settingsToggleButton.click();
                        }
                    }

                    // 延迟检查背景抽屉状态。有些酒馆版本会自动因为设置面板打开而关闭背景面板。
                    setTimeout(() => {
                        const bgDrawer = document.querySelector('#Backgrounds');
                        // 关键修复：只有当背景抽屉仍然是开着的状态（不含 closedDrawer 类）时，才去手动点它关闭
                        if (bgDrawer && !bgDrawer.classList.contains('closedDrawer')) {
                            const bgToggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                            if (bgToggleButton) {
                                bgToggleButton.click();
                            }
                        }
                    }, 150);

                    // 轻量级更新 UI，不重建整个 DOM
                    const themeItem = themeItemMap.get(savedThemeNameToBind);
                    if (themeItem) {
                        const linkBtn = themeItem.querySelector('.link-bg-btn');
                        if (linkBtn) {
                            linkBtn.classList.add('linked');
                            linkBtn.querySelector('i').className = 'fa-solid fa-link-slash';
                            linkBtn.title = '取消背景图关联';
                        }
                    }
                };

                if (bgMenuContent) bgMenuContent.addEventListener('click', bgObserverCallback, true);
                if (bgCustomContent) bgCustomContent.addEventListener('click', bgObserverCallback, true);

                // ==========================================================
                // ========= 新增功能：角色卡绑定美化 (Character Theme Binding) =========
                // ==========================================================

                // 绑定美化 UI 配置已迁移到 avatar-settings.js 高级设置面板中

                // 核心工具：解析目标（主题名或 [Tag] 格式）并返回最终要应用的主题名
                function getThemeForTarget(target) {
                    if (!target) return null;
                    if (target.startsWith('[Tag] ')) {
                        const tagId = target.replace('[Tag] ', '');
                        const tags = loadThemeTags();
                        const tag = tags.find(t => t.id === tagId);
                        if (!tag || !tag.themes || tag.themes.length === 0) return null;

                        const pool = allParsedThemes.filter(t => tag.themes.includes(t.value));
                        if (pool.length > 0) {
                            return pool[Math.floor(Math.random() * pool.length)].value;
                        }
                    } else {
                        // 检查主题是否仍然存在 (O(1) Set 快速检索，避免 DOM 扫描)
                        if (stKnownThemes.has(target)) return target;
                    }
                    return null;
                }

                // 从 URL 或路径中提取纯文件名（兼容处理以保持与保存端键名一致）
                function getAvatarFilename(url) {
                    if (!url) return '';
                    let cleanUrl = url.split('?')[0].split('#')[0];
                    const lastSlash = cleanUrl.lastIndexOf('/');
                    if (lastSlash !== -1) {
                        cleanUrl = cleanUrl.substring(lastSlash + 1);
                    }
                    try {
                        return decodeURIComponent(cleanUrl);
                    } catch (e) {
                        return cleanUrl;
                    }
                }

                // 核心功能：为特定头像名应用绑定的值（可能是具体主题，也可能是标签随机）
                function applyBoundThemeForCharacter(avatarName) {
                    console.log(`[Theme Manager Debug] applyBoundThemeForCharacter called with:`, avatarName);
                    if (!avatarName) return;
                    const cleanName = getAvatarFilename(avatarName);
                    console.log(`[Theme Manager Debug] cleanName:`, cleanName);
                    if (!cleanName) return;

                    const bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                    console.log(`[Theme Manager Debug] bindings loaded:`, bindings);
                    const target = bindings[cleanName];
                    console.log(`[Theme Manager Debug] target found:`, target);

                    if (target) {
                        const themeToApply = getThemeForTarget(target);
                        console.log(`[Theme Manager Debug] themeToApply:`, themeToApply);
                        if (themeToApply) {
                            const themeSelect = document.querySelector('#themes');
                            console.log(`[Theme Manager Debug] themeSelect:`, themeSelect ? themeSelect.value : 'not found');
                            if (themeSelect) {
                                // 1. 如果解析出的具体主题与当前不同，则切换
                                if (themeSelect.value !== themeToApply) {
                                    console.log(`[Theme Manager] 角色绑定触发切换: ${themeToApply} (来源: ${target})`);
                                    themeSelect.value = themeToApply;
                                    triggerSelectChange(themeSelect);
                                    toastr.info(`已应用角色绑定的美化：<b>${escapeHtml(themeToApply)}</b>`, '', { timeOut: 2000, escapeHtml: false });
                                } else {
                                    console.log(`[Theme Manager Debug] Theme is already active:`, themeToApply);
                                }
                            }

                            // 2. 强制同步背景图
                            const boundBg = themeBackgroundBindings[themeToApply];
                            if (boundBg) {
                                applyBackgroundDirectly(boundBg);
                            }
                        }
                    }
                }

                // 监听角色卡片的点击事件以自动应用美化 (增加容错判断)
                const rightNavPanel = document.getElementById('right-nav-panel');
                if (rightNavPanel) {
                    rightNavPanel.addEventListener('click', (event) => {
                        const characterBlock = event.target.closest('.character_select');
                        if (!characterBlock) return;

                        setTimeout(() => {
                            const characters = SillyTavern.getContext().characters;
                            const chid = characterBlock.dataset.chid;
                            const character = characters[chid];
                            if (character && character.avatar) {
                                applyBoundThemeForCharacter(character.avatar);
                            }
                        }, 50);
                    });
                }

                // 监听欢迎页面“最近的聊天”列表的点击事件，以自动应用美化 (增加容错判断)
                const chatArea = document.getElementById('chat');
                if (chatArea) {
                    chatArea.addEventListener('click', (event) => {
                        const recentChatBlock = event.target.closest('.recentChat');
                        if (!recentChatBlock) return;

                        const characterAvatar = recentChatBlock.dataset.avatar;
                        if (characterAvatar) {
                            setTimeout(() => {
                                applyBoundThemeForCharacter(characterAvatar);
                            }, 50);
                        }
                    });
                }

                // ==========================================================
                // ======================= Auto Theme Switcher =========================
                // ==========================================================
                let autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {
                    enabled: false,
                    mode: 'system',
                    dayStart: '06:00',
                    nightStart: '18:00',
                    dayTarget: '',
                    nightTarget: ''
                };
                let autoThemeCheckInterval = null;



                function getSystemThemeMode() {
                    if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) {
                        return 'night';
                    }
                    if (document.documentElement.classList.contains('light') || document.body.classList.contains('light')) {
                        return 'day';
                    }
                    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        return 'night';
                    }
                    return 'day';
                }

                function performAutoThemeSwitch(newState) {
                    if (currentAutoThemeState === newState) return;

                    let target = null;
                    const currentTheme = originalSelect.value;
                    const pair = getPairForTheme(currentTheme);
                    if (pair) {
                        if (newState === 'night') {
                            target = pair.nightTheme || pair.dayTheme;
                        } else if (newState === 'day') {
                            target = pair.dayTheme || pair.nightTheme;
                        }
                    }

                    if (!target) {
                        target = newState === 'day' ? autoThemeSettings.dayTarget : autoThemeSettings.nightTarget;
                    }

                    const themeToApply = getThemeForTarget(target);

                    if (themeToApply) {
                        const themeChanged = originalSelect.value !== themeToApply;
                        if (themeChanged) {
                            originalSelect.value = themeToApply;
                            triggerSelectChange(originalSelect);
                            toastr.info(`自动切换至 ${newState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '主题随动', { escapeHtml: false });
                        }
                        // 无论主题是否变化，都主动应用绑定的背景图
                        const boundBg = themeBackgroundBindings[themeToApply];
                        if (boundBg) {
                            applyBackgroundDirectly(boundBg);
                        }
                    }
                    currentAutoThemeState = newState;
                }

                function checkAutoTheme() {
                    if (!autoThemeSettings.enabled) return;

                    let newState = null;
                    if (autoThemeSettings.mode === 'system') {
                        newState = getSystemThemeMode();
                    } else if (autoThemeSettings.mode === 'time') {
                        const now = new Date();
                        const currentTime = now.getHours() * 60 + now.getMinutes();
                        const [dayH, dayM] = autoThemeSettings.dayStart.split(':').map(Number);
                        const [nightH, nightM] = autoThemeSettings.nightStart.split(':').map(Number);
                        const dayTime = dayH * 60 + dayM;
                        const nightTime = nightH * 60 + nightM;

                        if (dayTime < nightTime) {
                            newState = (currentTime >= dayTime && currentTime < nightTime) ? 'day' : 'night';
                        } else {
                            newState = (currentTime >= nightTime && currentTime < dayTime) ? 'night' : 'day';
                        }
                    }
                    if (newState) performAutoThemeSwitch(newState);
                }

                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                    if (autoThemeSettings.enabled && autoThemeSettings.mode === 'system') {
                        // 系统深色模式实际发生了变化，重置状态以确保强制重新应用主题和背景
                        currentAutoThemeState = null;
                        performAutoThemeSwitch(e.matches ? 'night' : 'day');
                    }
                });

                // 针对 Tauri / TauriTavern 宿主环境的 IPC 主题监听
                const setupTauriThemeListener = () => {
                    const tauri = window.__TAURI__ || window.parent?.__TAURI__ || window.top?.__TAURI__;
                    if (tauri && tauri.event && typeof tauri.event.listen === 'function') {
                        try {
                            tauri.event.listen('tauri://theme-changed', (event) => {
                                if (autoThemeSettings.enabled && autoThemeSettings.mode === 'system') {
                                    const themePayload = typeof event.payload === 'string' ? event.payload : (event.payload?.theme || '');
                                    const newState = themePayload.includes('dark') ? 'night' : 'day';
                                    currentAutoThemeState = null;
                                    performAutoThemeSwitch(newState);
                                }
                            });
                            console.log('[Theme Manager] 已成功注册 Tauri 原生主题监听事件 (tauri://theme-changed)');
                        } catch (e) {
                            console.warn('[Theme Manager] 注册 Tauri 主题监听事件失败:', e);
                        }
                    }
                };
                setupTauriThemeListener();

                // 监听窗口恢复焦点与可见性变化，解决桌面 App 最小化/休眠恢复后的同步滞后问题
                window.addEventListener('focus', () => {
                    if (autoThemeSettings.enabled) {
                        checkAutoTheme();
                    }
                });
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden && autoThemeSettings.enabled) {
                        checkAutoTheme();
                    }
                });

                function applyAutoThemeLoop() {
                    if (autoThemeCheckInterval) clearInterval(autoThemeCheckInterval);
                    if (autoThemeSettings.enabled) {
                        checkAutoTheme();
                        autoThemeCheckInterval = setInterval(checkAutoTheme, 60000);
                    }
                }

                const autoThemeBtn = managerPanel.querySelector('#auto-theme-settings-btn');
                const autoThemeModal = managerPanel.querySelector('#auto-theme-modal');
                const closeAutoThemeModalBtn = managerPanel.querySelector('#close-auto-theme-modal');
                const saveAutoThemeBtn = managerPanel.querySelector('#save-auto-theme-btn');

                let currentTargetThemeForPair = null;

                function updateThemeItemDayNightState(themeName) {
                    const item = themeItemMap.get(themeName);
                    if (!item) return;
                    const buttonsDiv = item.children[1];
                    const linkDaynightBtn = buttonsDiv.children[2];
                    const pair = getPairForTheme(themeName);
                    if (pair) {
                        linkDaynightBtn.classList.add('daynight-linked');
                        const otherTheme = pair.dayTheme === themeName ? pair.nightTheme : pair.dayTheme;
                        linkDaynightBtn.title = `已绑定日夜组合 (对应美化: ${otherTheme || '未指定'})`;
                    } else {
                        linkDaynightBtn.classList.remove('daynight-linked');
                        linkDaynightBtn.title = '绑定日夜美化';
                    }
                }

                function openDayNightPairModal(themeName) {
                    currentTargetThemeForPair = themeName;
                    const pairModal = managerPanel.querySelector('#tm-daynight-pair-modal');
                    const titleSpan = managerPanel.querySelector('#tm-daynight-current-name');
                    const nightSelect = managerPanel.querySelector('#tm-daynight-night-select');
                    const daySelect = managerPanel.querySelector('#tm-daynight-day-select');

                    titleSpan.textContent = themeName;

                    if ($(nightSelect).data('select2')) $(nightSelect).select2('destroy');
                    if ($(daySelect).data('select2')) $(daySelect).select2('destroy');

                    let optionsHtml = '<option value="">(未指定/不关联)</option>';
                    allParsedThemes.forEach(t => {
                        optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
                    });
                    nightSelect.innerHTML = optionsHtml;
                    daySelect.innerHTML = optionsHtml;

                    const existingPair = getPairForTheme(themeName);
                    if (existingPair) {
                        daySelect.value = existingPair.dayTheme || '';
                        nightSelect.value = existingPair.nightTheme || '';
                    } else {
                        const isNightName = /(深色|暗色|黑色|Dark|Night|黑)/i.test(themeName);
                        if (isNightName) {
                            nightSelect.value = themeName;
                            daySelect.value = '';
                        } else {
                            daySelect.value = themeName;
                            nightSelect.value = '';
                        }
                    }

                    pairModal.style.display = 'flex';

                    // 初始化 Select2 增加可搜索能力
                    setTimeout(() => {
                        $([nightSelect, daySelect]).select2({
                            dropdownParent: $(pairModal).find('.tm-modal-content'),
                            width: '100%'
                        });
                    }, 0);
                }

                function populateAutoThemePairsList() {
                    const pairsContainer = managerPanel.querySelector('#tm-pairs-list-container');
                    if (!pairsContainer) return;

                    if (!Array.isArray(themeDayNightPairs) || themeDayNightPairs.length === 0) {
                        pairsContainer.innerHTML = '<div style="opacity:0.7; font-style:italic; text-align:center; padding:10px;">暂无独立日夜组（可在各个美化卡片上点击 <i class="fa-solid fa-circle-half-stroke"></i> 进行关联绑定）</div>';
                        return;
                    }

                    let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
                    themeDayNightPairs.forEach((pair, index) => {
                        html += `<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
                            <div style="font-size:12px;">
                                <span style="color:#fadb14;"><i class="fa-solid fa-sun"></i> ${escapeHtml(pair.dayTheme || '未指定')}</span>
                                <span style="margin: 0 8px; opacity:0.7;">⇄</span>
                                <span style="color:#fa8c16;"><i class="fa-solid fa-moon"></i> ${escapeHtml(pair.nightTheme || '未指定')}</span>
                            </div>
                            <button class="tm-remove-pair-btn menu_button" data-index="${index}" style="padding:1px 6px; font-size:11px; margin:0; width:auto;"><i class="fa-solid fa-xmark"></i></button>
                        </div>`;
                    });
                    html += '</div>';
                    pairsContainer.innerHTML = html;

                    pairsContainer.querySelectorAll('.tm-remove-pair-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const idx = parseInt(e.currentTarget.dataset.index);
                            if (!isNaN(idx) && themeDayNightPairs[idx]) {
                                const removed = themeDayNightPairs.splice(idx, 1)[0];
                                saveThemeDayNightPairs(themeDayNightPairs);
                                if (removed?.dayTheme) updateThemeItemDayNightState(removed.dayTheme);
                                if (removed?.nightTheme) updateThemeItemDayNightState(removed.nightTheme);
                                populateAutoThemePairsList();
                            }
                        });
                    });
                }

                const daynightModal = managerPanel.querySelector('#tm-daynight-pair-modal');
                const closeTmDaynightBtn = managerPanel.querySelector('#close-tm-daynight-modal');
                const saveTmDaynightBtn = managerPanel.querySelector('#save-tm-daynight-btn');
                const clearTmDaynightBtn = managerPanel.querySelector('#clear-tm-daynight-btn');

                closeTmDaynightBtn.addEventListener('click', () => {
                    daynightModal.style.display = 'none';
                });

                saveTmDaynightBtn.addEventListener('click', () => {
                    if (!currentTargetThemeForPair) return;
                    const nightVal = managerPanel.querySelector('#tm-daynight-night-select').value;
                    const dayVal = managerPanel.querySelector('#tm-daynight-day-select').value;

                    // 移除包含涉及美化的旧组合
                    themeDayNightPairs = themeDayNightPairs.filter(p => {
                        if (!p) return false;
                        if (p.dayTheme === currentTargetThemeForPair || p.nightTheme === currentTargetThemeForPair) return false;
                        if (dayVal && (p.dayTheme === dayVal || p.nightTheme === dayVal)) return false;
                        if (nightVal && (p.dayTheme === nightVal || p.nightTheme === nightVal)) return false;
                        return true;
                    });

                    if (dayVal || nightVal) {
                        const finalDay = dayVal || currentTargetThemeForPair;
                        const finalNight = nightVal || currentTargetThemeForPair;
                        themeDayNightPairs.push({
                            dayTheme: finalDay,
                            nightTheme: finalNight
                        });
                    }

                    saveThemeDayNightPairs(themeDayNightPairs);
                    
                    if (dayVal) updateThemeItemDayNightState(dayVal);
                    if (nightVal) updateThemeItemDayNightState(nightVal);
                    updateThemeItemDayNightState(currentTargetThemeForPair);

                    toastr.success(`已更新美化日夜组合绑定！`);
                    daynightModal.style.display = 'none';
                });

                clearTmDaynightBtn.addEventListener('click', () => {
                    if (!currentTargetThemeForPair) return;
                    const pair = getPairForTheme(currentTargetThemeForPair);
                    if (pair) {
                        themeDayNightPairs = themeDayNightPairs.filter(p => p !== pair);
                        saveThemeDayNightPairs(themeDayNightPairs);
                        if (pair.dayTheme) updateThemeItemDayNightState(pair.dayTheme);
                        if (pair.nightTheme) updateThemeItemDayNightState(pair.nightTheme);
                        toastr.info(`已解除该美化的日夜组合关联。`);
                    }
                    daynightModal.style.display = 'none';
                });

                function populateAutoThemeDropdowns() {
                    const dayTarget = managerPanel.querySelector('#auto-theme-day-target');
                    const nightTarget = managerPanel.querySelector('#auto-theme-night-target');
                    const tags = loadThemeTags();

                    if ($(dayTarget).data('select2')) $(dayTarget).select2('destroy');
                    if ($(nightTarget).data('select2')) $(nightTarget).select2('destroy');

                    let optionsHtml = '<option value="">(不改变)</option>';
                    if (tags.length > 0) {
                        optionsHtml += '<optgroup label="[随机] 从标签中选择">';
                        tags.forEach(t => {
                            optionsHtml += `<option value="[Tag] ${t.id}">随机标签: ${escapeHtml(t.name)}</option>`;
                        });
                        optionsHtml += '</optgroup>';
                    }
                    optionsHtml += '<optgroup label="[指定] 特定主题">';
                    allParsedThemes.forEach(t => {
                        optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
                    });
                    optionsHtml += '</optgroup>';

                    dayTarget.innerHTML = optionsHtml;
                    nightTarget.innerHTML = optionsHtml;
                    dayTarget.value = autoThemeSettings.dayTarget;
                    nightTarget.value = autoThemeSettings.nightTarget;

                    populateAutoThemePairsList();

                    // 初始化 Select2 提高检索效率
                    setTimeout(() => {
                        $([dayTarget, nightTarget]).select2({
                            dropdownParent: $(autoThemeModal).find('.tm-modal-content'),
                            width: '100%'
                        });
                    }, 0);
                }

                autoThemeBtn.addEventListener('click', () => {
                    managerPanel.querySelector('#auto-theme-enable').checked = autoThemeSettings.enabled;
                    managerPanel.querySelector(`input[name="auto-theme-mode"][value="${autoThemeSettings.mode}"]`).checked = true;
                    managerPanel.querySelector('#auto-theme-day-start').value = autoThemeSettings.dayStart;
                    managerPanel.querySelector('#auto-theme-night-start').value = autoThemeSettings.nightStart;
                    managerPanel.querySelector('#auto-theme-time-settings').style.display = autoThemeSettings.mode === 'time' ? 'block' : 'none';

                    populateAutoThemeDropdowns();
                    autoThemeModal.style.display = 'flex';
                });

                managerPanel.querySelectorAll('input[name="auto-theme-mode"]').forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        managerPanel.querySelector('#auto-theme-time-settings').style.display = e.target.value === 'time' ? 'block' : 'none';
                    });
                });

                closeAutoThemeModalBtn.addEventListener('click', () => {
                    autoThemeModal.style.display = 'none';
                });

                saveAutoThemeBtn.addEventListener('click', () => {
                    autoThemeSettings.enabled = managerPanel.querySelector('#auto-theme-enable').checked;
                    autoThemeSettings.mode = managerPanel.querySelector('input[name="auto-theme-mode"]:checked').value;
                    autoThemeSettings.dayStart = managerPanel.querySelector('#auto-theme-day-start').value || '06:00';
                    autoThemeSettings.nightStart = managerPanel.querySelector('#auto-theme-night-start').value || '18:00';
                    autoThemeSettings.dayTarget = managerPanel.querySelector('#auto-theme-day-target').value;
                    autoThemeSettings.nightTarget = managerPanel.querySelector('#auto-theme-night-target').value;

                    localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(autoThemeSettings));
                    toastr.success('自动切换主题设置已保存！');
                    autoThemeModal.style.display = 'none';

                    currentAutoThemeState = null;
                    applyAutoThemeLoop();
                });

                // ==========================================================
                // ===== 注入原生背景面板 - 批量删除功能 (Background Batch Delete) =====
                // ==========================================================

                function initBackgroundEnhancements() {
                    const bgDrawer = document.getElementById('Backgrounds');
                    if (!bgDrawer) return;

                    // 查找背景面板的 header 区域
                    const headerRow = bgDrawer.querySelector('.bg-header-row-1');
                    if (!headerRow || document.getElementById('tm-bg-batch-toggle-btn')) return;

                    let isBatchMode = false;
                    const selectedBgs = new Set();

                    // --- 创建批量管理按钮 ---
                    const batchToggleBtn = document.createElement('div');
                    batchToggleBtn.id = 'tm-bg-batch-toggle-btn';
                    batchToggleBtn.className = 'menu_button menu_button_icon';
                    batchToggleBtn.title = '批量删除背景';
                    batchToggleBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
                    headerRow.appendChild(batchToggleBtn);

                    // --- 创建操作栏 ---
                    const actionsBar = document.createElement('div');
                    actionsBar.id = 'tm-bg-batch-actions-bar';
                    actionsBar.style.display = 'none';
                    actionsBar.innerHTML = `
                        <button id="tm-bg-select-all-btn" class="menu_button menu_button_icon"><i class="fa-solid fa-check-double"></i>全选</button>
                        <button id="tm-bg-batch-delete-btn" class="menu_button menu_button_icon" disabled><i class="fa-solid fa-trash-can"></i>删除选中</button>
                        <span class="tm-bg-count"></span>
                    `;
                    // 插入到 #bg_tabs 之前
                    const bgTabs = bgDrawer.querySelector('#bg_tabs');
                    if (bgTabs) {
                        bgTabs.parentNode.insertBefore(actionsBar, bgTabs);
                    }

                    const selectAllBtn = actionsBar.querySelector('#tm-bg-select-all-btn');
                    const deleteBtn = actionsBar.querySelector('#tm-bg-batch-delete-btn');
                    const countSpan = actionsBar.querySelector('.tm-bg-count');

                    function updateCount() {
                        countSpan.textContent = selectedBgs.size > 0 ? `已选 ${selectedBgs.size} 项` : '';
                        deleteBtn.disabled = selectedBgs.size === 0;
                    }

                    // 给所有 .bg_example 添加 checkbox
                    function injectCheckboxes(container) {
                        if (!container) return;
                        container.querySelectorAll('.bg_example').forEach(bgEl => {
                            if (bgEl.querySelector('.tm-bg-batch-checkbox')) return;
                            const bgFile = bgEl.getAttribute('bgfile');
                            if (!bgFile) return;

                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.className = 'tm-bg-batch-checkbox';
                            cb.dataset.bgfile = bgFile;
                            cb.checked = selectedBgs.has(bgFile);

                            cb.addEventListener('change', (e) => {
                                e.stopPropagation();
                                if (cb.checked) {
                                    selectedBgs.add(bgFile);
                                    bgEl.classList.add('tm-bg-selected');
                                } else {
                                    selectedBgs.delete(bgFile);
                                    bgEl.classList.remove('tm-bg-selected');
                                }
                                updateCount();
                            });

                            cb.addEventListener('click', (e) => { e.stopPropagation(); });
                            bgEl.style.position = 'relative';
                            bgEl.prepend(cb);
                        });
                    }

                    // 初始注入
                    const bgMenuContent = document.getElementById('bg_menu_content');
                    const bgCustomContent = document.getElementById('bg_custom_content');
                    injectCheckboxes(bgMenuContent);
                    injectCheckboxes(bgCustomContent);

                    // 监听背景列表变化，自动注入 checkbox 并在执行前防抖 (Debounce)
                    let bgMutTimer = null;
                    const bgMutObs = new MutationObserver(() => {
                        if (bgMutTimer) clearTimeout(bgMutTimer);
                        bgMutTimer = setTimeout(() => {
                            injectCheckboxes(bgMenuContent);
                            injectCheckboxes(bgCustomContent);
                        }, 200);
                    });
                    if (bgMenuContent) bgMutObs.observe(bgMenuContent, { childList: true });
                    if (bgCustomContent) bgMutObs.observe(bgCustomContent, { childList: true });

                    // --- 切换批量模式 ---
                    batchToggleBtn.addEventListener('click', () => {
                        isBatchMode = !isBatchMode;
                        batchToggleBtn.classList.toggle('active', isBatchMode);

                        // 给 bg_menu_content 和 bg_custom_content 的父容器添加模式 class
                        const bgTabsPanel = bgDrawer.querySelector('#bg_tabs');
                        if (bgTabsPanel) bgTabsPanel.classList.toggle('tm-bg-batch-mode', isBatchMode);

                        actionsBar.style.display = isBatchMode ? 'flex' : 'none';

                        if (!isBatchMode) {
                            selectedBgs.clear();
                            bgDrawer.querySelectorAll('.tm-bg-selected').forEach(el => el.classList.remove('tm-bg-selected'));
                            bgDrawer.querySelectorAll('.tm-bg-batch-checkbox').forEach(cb => cb.checked = false);
                            updateCount();
                        }
                    });

                    // --- 全选 ---
                    selectAllBtn.addEventListener('click', () => {
                        const activeTab = document.querySelector('#bg_tabs .ui-tabs-panel[aria-hidden="false"]') ||
                            document.querySelector('#bg_tabs .ui-tabs-panel:not([hidden])') ||
                            bgMenuContent;
                        if (!activeTab) return;

                        const allBgEls = activeTab.querySelectorAll('.bg_example[bgfile]');
                        const allSelected = [...allBgEls].every(el => selectedBgs.has(el.getAttribute('bgfile')));

                        allBgEls.forEach(el => {
                            const bgFile = el.getAttribute('bgfile');
                            const cb = el.querySelector('.tm-bg-batch-checkbox');
                            if (allSelected) {
                                selectedBgs.delete(bgFile);
                                el.classList.remove('tm-bg-selected');
                                if (cb) cb.checked = false;
                            } else {
                                selectedBgs.add(bgFile);
                                el.classList.add('tm-bg-selected');
                                if (cb) cb.checked = true;
                            }
                        });
                        updateCount();
                    });

                    // --- 批量删除 ---
                    deleteBtn.addEventListener('click', async () => {
                        if (selectedBgs.size === 0) return;
                        if (!confirm(`确定要删除选中的 ${selectedBgs.size} 个背景图吗？此操作不可撤销。`)) return;

                        showLoader();
                        const headers = getRequestHeaders();
                        const bgsToDelete = Array.from(selectedBgs);

                        // 并发发送 API 请求 (限制并发为 5)
                        const results = await limitConcurrency(5, bgsToDelete, async (bgFile) => {
                            const response = await fetch('/api/backgrounds/delete', {
                                method: 'POST',
                                headers: headers,
                                body: JSON.stringify({ bg: bgFile })
                            });
                            if (!response.ok) throw new Error(await response.text());
                            return bgFile;
                        });

                        let successCount = 0;
                        let errorCount = 0;
                        const successfullyDeleted = [];

                        results.forEach((res, index) => {
                            const bgFile = bgsToDelete[index];
                            if (res.status === 'fulfilled') {
                                successCount++;
                                successfullyDeleted.push(bgFile);
                            } else {
                                console.error(`删除背景 "${bgFile}" 失败:`, res.reason);
                                errorCount++;
                            }
                        });

                        // 批量从 DOM 中移除已删除的背景元素
                        successfullyDeleted.forEach(bgFile => {
                            const elements = document.querySelectorAll(`.bg_example[bgfile="${bgFile}"]`);
                            elements.forEach(el => el.remove());
                            selectedBgs.delete(bgFile);
                        });

                        hideLoader();

                        let message = `删除完成！成功 ${successCount} 个`;
                        if (errorCount > 0) {
                            message += `，失败 ${errorCount} 个。`;
                            toastr.warning(message);
                        } else {
                            message += '。';
                            toastr.success(message);
                        }

                        updateCount();
                    });
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

