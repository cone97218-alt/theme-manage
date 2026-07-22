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
            newState = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
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

        const target = newState === 'day' ? settings.dayTarget : settings.nightTarget;
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
                originalSelect.dispatchEvent(new Event('change'));
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
                const BATCH_EDIT_COLLAPSED_KEY = 'themeManager_batchEditCollapsed';
                const ACTIVE_TAGS_KEY = 'themeManager_activeTagsFilters';
                const AUTO_THEME_KEY = 'themeManager_autoTheme';
                const LIST_MODE_KEY = 'themeManager_listMode';
                const PAGE_SIZE_KEY = 'themeManager_pageSize';
                const SORT_SELECT_KEY = 'themeManager_sortSelect';
                const TAG_FILTER_MODE_KEY = 'themeManager_tagFilterMode';
                const USAGE_COUNT_KEY = 'themeManager_usageCount';
                                const SHOW_USAGE_COUNT_KEY = 'themeManager_showUsageCount';
                const ENABLE_AVATAR_HELPER_KEY = 'themeManager_enableAvatarHelper';
                const ENABLE_COLOR_TRANSFER_KEY = 'themeManager_enableColorTransfer';

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
                let editingThemeForTags = null;

                async function apiRequest(endpoint, method = 'POST', body = {}) {
                    try {
                        const headers = getRequestHeaders();
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
                        toastr.error(`API请求失败: ${error.message}`);
                        throw error;
                    }
                }

                async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }
                async function deleteTheme(themeName) { await apiRequest('themes/delete', 'POST', { name: themeName }); }
                async function saveTheme(themeObject) { await apiRequest('themes/save', 'POST', themeObject); }

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
                            const optionToDelete = findOptionByValue(originalSelect, oldName);
                            if (optionToDelete) optionToDelete.remove();
                            stKnownThemes.delete(oldName);
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
                        // rename 会触发 characterData mutation，需要更长的暂停窗口
                        // 避免 MutationObserver 重建整个 UI（即"出现两个"的根本原因）
                        // 软更新模式下不再需要长时间暂停；0ms 足够让 MutationObserver 先于 setTimeout 触发并被 flag 拦截
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
                    const cssVal = customCss !== undefined ? customCss : '';
                    console.log(`[Theme Manager] syncCustomCssToST 触发, 目标 CSS 字节数: ${cssVal.length}`);

                    // 1. 同步 ST 全局与 power_user 数据结构
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

                    // 2. 同步酒馆原生 Custom CSS 文本框元素 DOM
                    const editorEl = document.querySelector('#customCSS') || document.querySelector('#style_custom_content') || document.querySelector('#custom_style') || document.querySelector('#style_custom');
                    if (editorEl) {
                        console.log('[Theme Manager] 找到 Custom CSS 编辑器 DOM 节点:', editorEl.id || editorEl.tagName);
                        editorEl.value = cssVal;
                        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
                        editorEl.dispatchEvent(new Event('change', { bubbles: true }));

                        // 3. 同步 CodeMirror 编辑器实例 (若 ST 或插件挂载了 CodeMirror)
                        if (editorEl.CodeMirror) {
                            console.log('[Theme Manager] 找到 editorEl.CodeMirror 实例, 执行 setValue');
                            editorEl.CodeMirror.setValue(cssVal);
                        } else if (window.jQuery && $(editorEl).data('codemirror')) {
                            console.log('[Theme Manager] 找到 $(editorEl).data("codemirror") 实例, 执行 setValue');
                            $(editorEl).data('codemirror').setValue(cssVal);
                        }
                    } else {
                        console.warn('[Theme Manager] 未在当前页面找到 Custom CSS 文本框 DOM 节点 (#style_custom_content)');
                    }

                    // 4. 全局 CodeMirror DOM 实例兜底同步
                    try {
                        const cmDoms = document.querySelectorAll('.CodeMirror');
                        if (cmDoms.length > 0) {
                            console.log(`[Theme Manager] 找到 ${cmDoms.length} 个 CodeMirror DOM 实例进行兜底同步`);
                            cmDoms.forEach(cmDom => {
                                if (cmDom && cmDom.CodeMirror && cmDom.CodeMirror.getValue() !== cssVal) {
                                    cmDom.CodeMirror.setValue(cssVal);
                                }
                            });
                        }
                    } catch (e) {
                        console.error('[Theme Manager Error] 全局 CodeMirror 实例同步失败:', e);
                    }

                    // 5. 确保原生 <style id="custom-style"> 标签节点同步刷新
                    let style = document.getElementById('custom-style');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'custom-style';
                        document.head.appendChild(style);
                    }
                    style.innerHTML = cssVal;
                }

                // === ST 内部内存同步助手（实现真正的热更新） ===
                function updateSTThemeMemory(themeObject, action = 'add', oldName = null) {
                    const tName = themeObject ? themeObject.name : oldName;
                    console.log(`[Theme Manager] updateSTThemeMemory 执行: action=${action}, name=${tName}`);
                    try {
                        const contexts = [];
                        if (typeof power_user !== 'undefined') contexts.push(power_user);
                        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            const ctx = SillyTavern.getContext();
                            contexts.push(ctx);
                            if (ctx && Array.isArray(ctx.themes)) {
                                if (action === 'delete') {
                                    const idx = ctx.themes.findIndex(t => t.name === tName);
                                    if (idx !== -1) ctx.themes.splice(idx, 1);
                                } else if (action === 'rename' && oldName) {
                                    const idx = ctx.themes.findIndex(t => t.name === oldName);
                                    if (idx !== -1) ctx.themes[idx] = themeObject;
                                    else ctx.themes.push(themeObject);
                                } else if (action === 'add' || action === 'save') {
                                    const idx = ctx.themes.findIndex(t => t.name === themeObject.name);
                                    if (idx !== -1) ctx.themes[idx] = themeObject;
                                    else ctx.themes.push(themeObject);
                                }
                            }
                        }
                        
                        // 显式更新全局 themes (针对某些版本的 ST 和手机端)
                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            if (action === 'delete') {
                                const idx = themes.findIndex(t => t.name === tName);
                                if (idx !== -1) themes.splice(idx, 1);
                            } else if (action === 'rename' && oldName) {
                                const idx = themes.findIndex(t => t.name === oldName);
                                if (idx !== -1) themes[idx] = themeObject;
                                else themes.push(themeObject);
                            } else if (action === 'add' || action === 'save') {
                                const idx = themes.findIndex(t => t.name === themeObject.name);
                                if (idx !== -1) themes[idx] = themeObject;
                                else themes.push(themeObject);
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
                            _uiControlsCache[sel] = document.querySelector(sel);
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
                        
                        // 1. 设置 CSS 变量
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

                        // 3. 更新酒馆 UI 界面中的 Color Picker 控件
                        const pickerEl = document.querySelector(item.picker);
                        if (pickerEl) {
                            pickerEl.setAttribute('color', val);
                            pickerEl.value = val;
                            if (window.jQuery) {
                                try {
                                    $(pickerEl).attr('color', val).val(val).trigger('input').trigger('change');
                                } catch(e){}
                            }
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
                    deduplicateSelectOptions(originalSelect);
                    syncStKnownThemes();

                    const themeObj = allThemeObjectsMap.get(themeName);

                    if (themeObj) {
                        updateSTThemeMemory(themeObj, 'add');
                        syncCustomCssToST(themeObj.custom_css);
                        applyThemeColors(themeObj);
                    }

                    // 核心优化 1: 如果 ST 内部 themes 包含此主题，则使用 ST 原生逻辑处理，完美规避重复执行与组件刷新冲突
                    if (stKnownThemes.has(themeName)) {
                        originalSelect.value = themeName;
                        triggerSelectChange(originalSelect);
                        if (themeObj) {
                            syncCustomCssToST(themeObj.custom_css);
                            applyThemeColors(themeObj);
                        }
                        return;
                    }

                    // 核心优化 2: 如果 ST 内部不包含该主题 (当前会话重命名或导入)，我们再手动按需执行 applyThemeDirect
                    if (!themeObj) {
                        originalSelect.value = themeName;
                        triggerSelectChange(originalSelect);
                        return;
                    }

                    const root = document.documentElement;
                    try {
                        if (typeof power_user !== 'undefined') {
                            power_user.theme = themeName;
                            // 赋值所有 power_user 属性，以便 ST 其余部分能读取到最新的值
                            Object.entries(themeObj).forEach(([k, v]) => {
                                if (v !== undefined) power_user[k] = v;
                            });
                        }
                    } catch(e) {}

                    // 核心优化 3: 使用 requestAnimationFrame 批处理所有 DOM 写入，确保仅触发一次重绘与回流
                    requestAnimationFrame(() => {
                        applyThemeColors(themeObj);
                        syncCustomCssToST(themeObj.custom_css);

                        // 3. 开关类样式与控件
                        const controls = getUIControls();
                        if (themeObj.fast_ui_mode !== undefined) {
                            document.body.classList.toggle('no-blur', themeObj.fast_ui_mode);
                            const bs = controls['#blur-strength-block'];
                            if (bs) bs.style.opacity = themeObj.fast_ui_mode ? '0.2' : '1';
                        }
                        if (themeObj.waifuMode !== undefined) document.body.classList.toggle('waifuMode', themeObj.waifuMode);
                        if (themeObj.noShadows !== undefined) {
                            document.body.classList.toggle('noShadows', themeObj.noShadows);
                            const sw = controls['#shadow-width-block'];
                            if (sw) sw.style.opacity = themeObj.noShadows ? '0.2' : '1';
                        }
                        
                        if (themeObj.avatar_style !== undefined) {
                            document.body.classList.toggle('big-avatars', themeObj.avatar_style === 0);
                            document.body.classList.toggle('square-avatars', themeObj.avatar_style === 1);
                            document.body.classList.toggle('rounded-avatars', themeObj.avatar_style === 2);
                        }
                        if (themeObj.chat_display !== undefined) {
                            document.body.classList.remove('bubblechat', 'documentstyle');
                            if (themeObj.chat_display === 1) document.body.classList.add('bubblechat');
                            if (themeObj.chat_display === 2) document.body.classList.add('documentstyle');
                        }

                        // 复选框和下拉菜单控制（保留非颜色/非数字属性）
                        const otherInputs = {
                            '#fast_ui_mode': themeObj.fast_ui_mode,
                            '#waifuMode': themeObj.waifuMode,
                            '#noShadowsmode': themeObj.noShadows,
                            '#avatar_style': themeObj.avatar_style,
                            '#chat_display': themeObj.chat_display,
                        };
                        for (const [sel, val] of Object.entries(otherInputs)) {
                            if (val !== undefined) {
                                const el = controls[sel];
                                if (el) {
                                    if (el.type === 'checkbox') el.checked = val;
                                    else if (el.tagName === 'SELECT') el.value = val;
                                }
                            }
                        }
                    });

                    // 4. 设置 select 值并双重触发 ST 原生 change
                    originalSelect.value = themeName;
                    triggerSelectChange(originalSelect);
                }

                // 标签数据缓存（避免每次调用都 JSON.parse）
                let _tagsCache = null;
                function loadThemeTags() {
                    if (_tagsCache) return _tagsCache;
                    _tagsCache = JSON.parse(localStorage.getItem(THEME_TAGS_KEY)) || [];
                    return _tagsCache;
                }
                function saveThemeTags(tags) {
                    _tagsCache = tags; // 更新缓存
                    localStorage.setItem(THEME_TAGS_KEY, JSON.stringify(tags));
                    invalidateThemeTagIndex(); // 标签数据变了，反向索引也要失效
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
                                <button id="manage-tags-btn" class="menu_button" title="管理标签"><i class="fa-solid fa-tags"></i> 标签</button>
                                <button id="tm-export-settings-btn" class="menu_button" title="导出配置文件"><i class="fa-solid fa-file-export"></i> 导出</button>
                                <button id="tm-import-settings-btn" class="menu_button" title="从配置文件中导入插件设置"><i class="fa-solid fa-file-import"></i> 导入</button>
                                <button id="tm-reset-all-system-btn" class="menu_button" style="background: rgba(220, 53, 69, 0.12) !important; color: #ff8888 !important; border: 1px solid rgba(220, 53, 69, 0.2) !important;" title="重置美化插件的所有数据"><i class="fa-solid fa-arrows-rotate"></i> 重置</button>
                            </div>
                        </div>

                        <div id="batch-actions-bar" style="display:none;" data-mode="theme">
                            <button id="batch-add-tag-btn" class="menu_button"><i class="fa-solid fa-tags"></i> 加标签</button>
                            <button id="batch-remove-tag-btn" class="menu_button"><i class="fa-solid fa-tag"></i> 删标签</button>
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
                                        <label><b>日间主题/标签 (浅色):</b></label>
                                        <select id="auto-theme-day-target" class="text_pole" style="width:100%; margin-bottom:10px;"></select>
                                        
                                        <label><b>夜间主题/标签 (深色):</b></label>
                                        <select id="auto-theme-night-target" class="text_pole" style="width:100%;"></select>
                                        <p style="font-size: 0.8em; opacity: 0.8; margin-top: 5px;">* 如果选择带有 <code>[Tag]</code> 的分类，将在该标签下随机挑选。</p>
                                    </div>
                                </div>
                                <div class="tm-modal-footer" style="display:flex; justify-content:center; padding-top:10px;">
                                    <button id="save-auto-theme-btn" class="menu_button" style="width:100%; justify-content:center;"><i class="fa-solid fa-check"></i> 保存设置</button>
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

                    // 如果主题列表未发生变化，直接更新 active 状态即可，避免重建 DOM
                    if (allParsedThemes.length > 0 && isThemeListIdentical() && themeItemMap.size > 0) {
                        updateActiveState();
                        return;
                    }

                    contentWrapper.innerHTML = '正在加载主题...';
                    try {
                        allThemeObjects = await getCachedThemes();
                        allThemeObjectsMap.clear();
                        allThemeObjects.forEach(t => allThemeObjectsMap.set(t.name, t));
                        contentWrapper.innerHTML = '';

                        // 缓存标签数据，避免在循环中反复 JSON.parse
                        const cachedTags = loadThemeTags();
                        // 构建反向索引，将 getTagsForTheme 从 O(tags*themes) 降为 O(1)
                        buildThemeTagIndex(cachedTags);

                        allParsedThemes = Array.from(originalSelect.options).map(option => {
                            const themeName = option.value;
                            if (!themeName) return null;
                            const tagIds = getTagsForTheme(themeName, cachedTags);
                            const themeObj = allThemeObjectsMap.get(themeName);
                            const mtime = themeObj ? themeObj.mtime : 0;
                            return { value: themeName, display: themeName, tags: tagIds, mtime: mtime || 0 };
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
                        <div class="theme-item-buttons">
                            <button class="set-tag-btn" title="分类标签"><i class="fa-solid fa-tags"></i></button>
                            <button class="link-bg-btn" title="关联背景图"><i class="fa-solid fa-link"></i></button>
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
                    const favoriteBtn = buttonsDiv.children[2];
                    const colorTransferBtn = buttonsDiv.children[3];
                    const renameBtn = buttonsDiv.children[4];
                    const deleteBtn = buttonsDiv.children[5];

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
                        const tagsDiv = document.createElement('div');
                        tagsDiv.className = 'theme-item-tags';
                        theme.tags.forEach(tagId => {
                            const tagObj = tagsMap.get(tagId);
                            if (tagObj) {
                                const pill = document.createElement('span');
                                pill.className = 'theme-item-tag-pill';
                                pill.textContent = tagObj.name;
                                tagsDiv.appendChild(pill);
                            }
                        });
                        nameDiv.appendChild(tagsDiv);
                    }

                    // 设置收藏状态
                    const isFavorited = favoritesSet.has(theme.value);
                    if (isFavorited) {
                        favoriteBtn.children[0].className = 'fa-solid fa-star';
                    }

                    // 设置绑定状态
                    const isBound = !!themeBackgroundBindings[theme.value];
                    if (isBound) {
                        linkBgBtn.classList.add('linked');
                        linkBgBtn.children[0].className = 'fa-solid fa-link-slash';
                        linkBgBtn.title = '取消背景图关联';
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

                // 判断主题是否匹配当前标签筛选
                function isThemeMatchingFilters(theme) {
                    if (activeTagFilters.size === 0) return true;
                    if (tagFilterMode === 'and') {
                        // AND 模式：主题必须同时满足所有已选标签
                        for (const tagId of activeTagFilters) {
                            let matched = false;
                            if (tagId === '__FAVORITES__' && favoritesSet.has(theme.value)) matched = true;
                            if (tagId === '__UNCATEGORIZED__' && (!theme.tags || theme.tags.length === 0)) matched = true;
                            if (theme.tags && theme.tags.includes(tagId)) matched = true;
                            if (!matched) return false;
                        }
                        return true;
                    }
                    // OR 模式（默认）：匹配任意标签即可
                    for (const tagId of activeTagFilters) {
                        if (tagId === '__FAVORITES__' && favoritesSet.has(theme.value)) return true;
                        if (tagId === '__UNCATEGORIZED__' && (!theme.tags || theme.tags.length === 0)) return true;
                        if (theme.tags && theme.tags.includes(tagId)) return true;
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
                    if (!container) return;
                    container.querySelectorAll('.theme-tag-chip').forEach(chip => {
                        const tagId = chip.dataset.tagId;
                        if (tagId) {
                            chip.classList.toggle('active', activeTagFilters.has(tagId));
                        } else if (chip.dataset.special === 'favorites') {
                            chip.classList.toggle('active', activeTagFilters.has('__FAVORITES__'));
                        } else if (chip.dataset.special === 'uncategorized') {
                            chip.classList.toggle('active', activeTagFilters.has('__UNCATEGORIZED__'));
                        } else if (chip.dataset.special === 'all') {
                            chip.classList.toggle('active', activeTagFilters.size === 0);
                        }
                    });
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
                        const nameDiv = item.children[0];
                        const oldTagsDiv = nameDiv.querySelector('.theme-item-tags');
                        if (oldTagsDiv) oldTagsDiv.remove();

                        // 添加新标签
                        if (theme.tags && theme.tags.length > 0) {
                            const tagsDiv = document.createElement('div');
                            tagsDiv.className = 'theme-item-tags';
                            theme.tags.forEach(tagId => {
                                const tagObj = tagsById.get(tagId); // O(1) 查找
                                if (tagObj) {
                                    const pill = document.createElement('span');
                                    pill.className = 'theme-item-tag-pill';
                                    pill.textContent = tagObj.name;
                                    tagsDiv.appendChild(pill);
                                }
                            });
                            nameDiv.appendChild(tagsDiv);
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
                    stKnownThemes.delete(themeName); // 彻底删除，从 ST 认识列表移除
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
                        activeTagFilters.clear();
                        handleTagFilterChange();
                    });
                    container.appendChild(allChip);

                    // "收藏" (Favorites) Tag
                    const favChip = document.createElement('div');
                    favChip.className = `theme-tag-chip ${activeTagFilters.has('__FAVORITES__') ? 'active' : ''}`;
                    favChip.dataset.special = 'favorites';
                    favChip.innerHTML = `收藏`;
                    favChip.addEventListener('click', () => {
                        if (activeTagFilters.has('__FAVORITES__')) {
                            activeTagFilters.delete('__FAVORITES__');
                        } else {
                            if (tagFilterMode === 'or') activeTagFilters.clear();
                            activeTagFilters.add('__FAVORITES__');
                        }
                        handleTagFilterChange();
                    });
                    container.appendChild(favChip);

                    // "未分类" (Uncategorized) Tag
                    const uncatChip = document.createElement('div');
                    uncatChip.className = `theme-tag-chip ${activeTagFilters.has('__UNCATEGORIZED__') ? 'active' : ''}`;
                    uncatChip.dataset.special = 'uncategorized';
                    uncatChip.innerHTML = `未分类`;
                    uncatChip.addEventListener('click', () => {
                        if (activeTagFilters.has('__UNCATEGORIZED__')) {
                            activeTagFilters.delete('__UNCATEGORIZED__');
                        } else {
                            if (tagFilterMode === 'or') activeTagFilters.clear();
                            activeTagFilters.add('__UNCATEGORIZED__');
                        }
                        handleTagFilterChange();
                    });
                    container.appendChild(uncatChip);

                    const tags = cachedTags || loadThemeTags();
                    if (tags.length > 0) {
                        tags.forEach(tag => {
                            const chip = document.createElement('div');
                            chip.className = `theme-tag-chip ${activeTagFilters.has(tag.id) ? 'active' : ''}`;
                            chip.dataset.tagId = tag.id;
                            chip.innerHTML = `${escapeHtml(tag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${tag.themes ? tag.themes.length : 0})</span>`;
                            chip.addEventListener('click', () => {
                                if (activeTagFilters.has(tag.id)) {
                                    activeTagFilters.delete(tag.id);
                                } else {
                                    if (tagFilterMode === 'or') activeTagFilters.clear();
                                    activeTagFilters.add(tag.id);
                                }
                                handleTagFilterChange();
                            });
                            container.appendChild(chip);
                        });
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

                    let successCount = 0;
                    let errorCount = 0;
                    let skippedCount = 0;
                    let activeThemeWasRenamed = false;
                    const currentThemes = await getAllThemesFromAPI();
                    let favoritesToUpdate = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                    let tagsToUpdate = loadThemeTags();

                    const renameTasks = [];

                    for (const oldName of selectedForBatch) {
                        const themeObject = currentThemes.find(t => t.name === oldName);
                        if (!themeObject) {
                            console.warn(`批量操作：在API返回中未找到主题 "${oldName}"，已跳过。`);
                            skippedCount++;
                            continue;
                        }
                        const newName = renameLogic(oldName);
                        if (currentThemes.some(t => t.name === newName && t.name !== oldName)) {
                            console.warn(`批量操作：目标名称 "${newName}" 已存在，已跳过 "${oldName}"。`);
                            toastr.warning(`主题 "${newName}" 已存在，跳过重命名。`);
                            skippedCount++;
                            continue;
                        }

                        if (newName === oldName) {
                            successCount++; // 名字没变，不算作需要 API 的操作
                            continue;
                        }

                        renameTasks.push({ oldName, newName, themeObject });
                    }

                    if (renameTasks.length > 0) {
                        // 并行执行所有的重命名保存与删除操作 (限制并发为 3)
                        const results = await limitConcurrency(3, renameTasks, async ({ oldName, newName, themeObject }) => {
                            const newThemeObject = { ...themeObject, name: newName };
                            // 保存新文件和删除旧文件并行进行
                            await Promise.all([
                                saveTheme(newThemeObject),
                                deleteTheme(oldName)
                            ]);
                            return { oldName, newName, newThemeObject };
                        });

                        // 批量更新原生 DOM、内存与插件状态
                        _suspendObserver = true;
                        try {
                            results.forEach((res, index) => {
                                const task = renameTasks[index];
                                if (res.status === 'fulfilled') {
                                    successCount++;
                                    const { oldName, newName, newThemeObject } = res.value;

                                    const isActive = originalSelect.value === oldName;
                                    manualUpdateOriginalSelect('rename', oldName, newName);
                                    if (isActive) {
                                        activeThemeWasRenamed = true;
                                    }

                                    updateSTThemeMemory({ name: oldName }, 'delete');
                                    updateSTThemeMemory(newThemeObject, 'add');
                                    softRenameThemeUI(oldName, newName);

                                    const favIndex = favoritesToUpdate.indexOf(oldName);
                                    if (favIndex > -1) {
                                        favoritesToUpdate[favIndex] = newName;
                                    }

                                    if (themeBackgroundBindings[oldName]) {
                                        themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                        delete themeBackgroundBindings[oldName];
                                    }

                                    // 同步更新标签数据中的主题名
                                    tagsToUpdate.forEach(tag => {
                                        if (tag.themes) {
                                            const idx = tag.themes.indexOf(oldName);
                                            if (idx > -1) tag.themes[idx] = newName;
                                        }
                                    });
                                } else {
                                    errorCount++;
                                    console.error(`批量重命名主题 "${task.oldName}" 时失败:`, res.reason);
                                    toastr.error(`处理主题 "${task.oldName}" 时失败: ${res.reason.message || res.reason}`);
                                }
                            });
                        } finally {
                            setTimeout(() => { _suspendObserver = false; }, 0);
                        }
                    }

                    updateFavorites(favoritesToUpdate);
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                    saveThemeTags(tagsToUpdate);

                    hideLoader();
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
                        originalSelect.dispatchEvent(new Event('change'));
                    }
                    updateActiveState();
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return;

                    showLoader();
                    const deletedThemes = Array.from(selectedForBatch);
                    const deletedSet = new Set(deletedThemes);

                    // 并发发送 API 删除请求 (限制并发为 5)
                    const results = await limitConcurrency(5, deletedThemes, name => deleteTheme(name));

                    const successfullyDeleted = [];
                    const failedDeleted = [];
                    results.forEach((res, index) => {
                        const name = deletedThemes[index];
                        if (res.status === 'fulfilled') {
                            successfullyDeleted.push(name);
                        } else {
                            failedDeleted.push(name);
                            console.error(`删除主题 "${name}" 失败:`, res.reason);
                        }
                    });

                    if (successfullyDeleted.length === 0) {
                        hideLoader();
                        toastr.error('批量删除全部失败，请检查后端权限或连接状况。');
                        return;
                    }

                    const successSet = new Set(successfullyDeleted);
                    let tagsToUpdate = loadThemeTags();

                    // 判断被删除的主题中是否有当前激活的
                    const isCurrentlyActiveDeleted = successSet.has(originalSelect.value);

                    // 1. 批量更新 ST 原生下拉框
                    _suspendObserver = true;
                    try {
                        successfullyDeleted.forEach(themeName => {
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
                                ctx.themes = ctx.themes.filter(t => !successSet.has(t.name));
                            }
                        });

                        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                            for (let i = themes.length - 1; i >= 0; i--) {
                                if (successSet.has(themes[i].name)) {
                                    themes.splice(i, 1);
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[Theme Manager] 批量同步 ST 内部主题内存失败:', e);
                    }

                    // 3. 批量删除主题 UI 状态
                    successfullyDeleted.forEach(themeName => {
                        // 从 DOM 移除
                        const item = themeItemMap.get(themeName);
                        if (item) {
                            item.remove();
                            themeItemMap.delete(themeName);
                        }

                        // 从数据缓存中移除
                        const idx = allParsedThemes.findIndex(t => t.value === themeName);
                        if (idx > -1) {
                            allParsedThemes.splice(idx, 1);
                            allParsedThemesMap.delete(themeName);
                        }

                        const objIndex = allThemeObjects.findIndex(t => t.name === themeName);
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
                    tagsToUpdate.forEach(tag => {
                        if (tag.themes) {
                            tag.themes = tag.themes.filter(t => !successSet.has(t));
                        }
                    });

                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                    updateFavorites(favorites);
                    saveThemeTags(tagsToUpdate);

                    // 5. 切换激活状态，如果被删的主题是当前激活的
                    if (isCurrentlyActiveDeleted) {
                        const azureOption = findOptionByValue(originalSelect, 'Azure');
                        originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                        originalSelect.dispatchEvent(new Event('change'));
                    }

                    // 批量操作完成后统一触发持久化
                    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                        const ctx = SillyTavern.getContext();
                        if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                    }

                    selectedForBatch.clear();
                    lastClickedThemeName = null;
                    hideLoader();
                    invalidateThemesCache();

                    // 更新顶部标签按钮计数器
                    renderTagsUI(tagsToUpdate);

                    if (failedDeleted.length > 0) {
                        toastr.warning(`批量删除完成！成功 ${successfullyDeleted.length} 个，失败 ${failedDeleted.length} 个（${failedDeleted.join(', ')}）。`);
                    } else {
                        toastr.success(`批量删除完成！成功删除 ${successfullyDeleted.length} 个主题。`);
                    }

                    updateActiveState();
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
                    ENABLE_COLOR_TRANSFER_KEY
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
                        originalSelect.dispatchEvent(new Event('change'));
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
                            if (themeObject && themeObject.name && typeof themeObject.main_text_color !== 'undefined') {
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

                async function openManageTagsPopup() {
                    let tags = loadThemeTags();

                    let popupHtml = `
                        <div style="margin-bottom:15px; display:flex; gap:10px; align-items:center; flex-wrap:nowrap;">
                            <input type="text" id="new-tag-name" class="text_pole" placeholder="新标签名称" style="flex-grow:1; min-width:0;">
                            <button id="add-new-tag-btn" class="menu_button" style="margin:0; white-space:nowrap; flex-shrink:0; width:auto;"><i class="fa-solid fa-plus"></i> 添加</button>
                        </div>
                        <ul id="tags-management-list" style="list-style:none; padding:0; margin:0; max-height: 300px; overflow-y:auto;">
                    `;

                    const renderList = () => {
                        let listHtml = '';
                        tags.forEach(t => {
                            const kwCount = t.keywords ? t.keywords.length : 0;
                            listHtml += `
                                <li style="display:flex; justify-content:space-between; padding:8px; background:rgba(255,255,255,0.05); margin-bottom:5px; border-radius:4px; align-items:center;">
                                    <span style="word-break: break-all;">${escapeHtml(t.name)} <small style="opacity:0.6; white-space:nowrap;">(${t.themes ? t.themes.length : 0})</small>${kwCount > 0 ? `<small style="opacity:0.5; white-space:nowrap; margin-left:4px;">[${kwCount}词]</small>` : ''}</span>
                                    <div style="display:flex; gap:5px; flex-shrink:0;">
                                        <button class="menu_button keywords-tag-inline" data-id="${t.id}" style="margin:0; padding:4px 8px; font-size:12px; width:auto; flex-basis:auto;" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                        <button class="menu_button rename-tag-inline" data-id="${t.id}" style="margin:0; padding:4px 8px; font-size:12px; width:auto; flex-basis:auto;"><i class="fa-solid fa-pen"></i></button>
                                        <button class="menu_button delete-tag-inline" data-id="${t.id}" style="margin:0; padding:4px 8px; font-size:12px; width:auto; flex-basis:auto;"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </li>
                            `;
                        });
                        return listHtml;
                    };

                    popupHtml += renderList() + `</ul>
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
                            const RefreshList = () => {
                                dlg.querySelector('#tags-management-list').innerHTML = renderList();
                                BindEvents();
                            };

                            const BindEvents = () => {
                                dlg.querySelectorAll('.delete-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const id = e.currentTarget.dataset.id;
                                        if (confirm('确定删除此标签吗？(不会删除主题本身)')) {
                                            tags = tags.filter(t => t.id !== id);
                                            saveThemeTags(tags);
                                            RefreshList();
                                            softRefreshUI();
                                        }
                                    });
                                });
                                dlg.querySelectorAll('.rename-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        const newName = prompt('输入新名称:', tag.name);
                                        if (newName && newName.trim() && newName.trim() !== tag.name) {
                                            tag.name = newName.trim();
                                            saveThemeTags(tags);
                                            RefreshList();
                                            softRefreshUI();
                                        }
                                    });
                                });
                                // 关键词编辑按钮
                                dlg.querySelectorAll('.keywords-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        const currentKeywords = (tag.keywords || []).join(', ');
                                        const input = prompt(
                                            `「${tag.name}」的关键词（逗号分隔）
导入或重命名的美化名如包含这些词，将自动帰入此标签：`,
                                            currentKeywords
                                        );
                                        if (input !== null) {
                                            tag.keywords = input.split(',').map(k => k.trim()).filter(k => k.length > 0);
                                            saveThemeTags(tags);
                                            RefreshList();
                                        }
                                    });
                                });
                            };

                            dlg.querySelector('#add-new-tag-btn').addEventListener('click', () => {
                                const input = dlg.querySelector('#new-tag-name');
                                const name = input.value.trim();
                                if (!name) return;
                                if (tags.some(t => t.name === name)) {
                                    toastr.warning('标签名已存在');
                                    return;
                                }
                                tags.push({ id: Date.now().toString(), name: name, themes: [], keywords: [] });
                                saveThemeTags(tags);
                                input.value = '';
                                RefreshList();
                                softRefreshUI();
                            });

                            // 重新应用关键词映射按钮
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

                            BindEvents();
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

                    let popupHtml = `<p>选择要分配的标签：</p><div style="display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto;">`;
                    tags.forEach(t => {
                        // In single mode, check if the theme has this tag
                        const isChecked = singleMode ? (t.themes && t.themes.includes(themeNames)) : false;
                        popupHtml += `
                            <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                                <input type="checkbox" class="tag-assign-cb" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
                                ${escapeHtml(t.name)}
                            </label>
                        `;
                    });
                    popupHtml += `</div>`;

                    await callGenericPopup(popupHtml, 'confirm', null, {
                        title: singleMode ? `设置标签: ${themeNames.replace(/\[.*?\]/g, '').trim()}` : `批量设置标签 (${themesToAssign.length} 个主题)`,
                        okButton: '保存',
                        onOpen: (popup) => {
                            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                                const checkboxes = popup.dlg.querySelectorAll('.tag-assign-cb');
                                const tagsById = new Map(tags.map(t => [t.id, t])); // O(1) 查找，避免每个 checkbox 都 Array.find
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
                                softRefreshUI(themesToAssign); // 精准更新：只重建受影响的主题项的 pill
                            });
                        }
                    });
                }

                async function openTagRemovalPopup(themeNames) {
                    const themesToAssign = themeNames; // always array for batch

                    let tags = loadThemeTags();
                    if (tags.length === 0) {
                        toastr.info('还没有创建任何标签，无法移除。');
                        return;
                    }

                    let popupHtml = `<p>选择要从所选主题中移除的标签：</p><div style="display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto;">`;
                    tags.forEach(t => {
                        popupHtml += `
                            <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                                <input type="checkbox" class="tag-remove-cb" data-id="${t.id}">
                                ${t.name}
                            </label>
                        `;
                    });
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

                document.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);

                contentWrapper.addEventListener('click', async (event) => {
                    if (preventNextClick) {
                        preventNextClick = false;
                        return;
                    }
                    const target = event.target;
                    const button = target.closest('button');
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
                            const newName = prompt(`请输入新名称：`, oldName);
                            if (newName && newName.trim() && newName.trim() !== oldName) {
                                const finalNewName = newName.trim();
                                // 检查新名称是否已存在
                                if (allParsedThemes.some(t => t.value === finalNewName)) {
                                    toastr.warning(`主题 "${finalNewName}" 已存在，请使用其他名称。`);
                                    return;
                                }
                                const themeObject = allThemeObjectsMap.get(oldName);
                                if (!themeObject) return;
                                const isActive = originalSelect.value === oldName;
                                const newThemeObject = { ...themeObject, name: finalNewName };
                                await saveTheme(newThemeObject);
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, finalNewName);
                                // delete+add 比 rename 更可靠：不依赖 ST 内部数组里必须存在 oldName
                                updateSTThemeMemory({ name: oldName }, 'delete');
                                updateSTThemeMemory(newThemeObject, 'add');
                                invalidateThemesCache(); // 使缓存失效，确保后续调用获取最新数据

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

                                // 增量更新 UI（无需全量重建 DOM）
                                softRenameThemeUI(oldName, finalNewName);
                                filterThemeList();

                                // 重命名后，如果是当前激活的主题，我们需要更新当前选择并重新应用以同步ST内部状态
                                if (isActive) {
                                    originalSelect.value = finalNewName;
                                    applyThemeDirect(finalNewName);
                                }
                                toastr.success(`已将「${oldName}」重命名为「${finalNewName}」`);
                                updateActiveState();
                            }
                        }
                        else if (button && button.classList.contains('delete-btn')) {
                            if (confirm(`确定要删除主题 "${themeItem.querySelector('.theme-item-name-text').textContent}" 吗？`)) {
                                const isCurrentlyActive = originalSelect.value === themeName;
                                await deleteTheme(themeName);
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

                                // 清理自动切换主题设置的选中主题
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

                                if (isCurrentlyActive) {
                                    const azureOption = findOptionByValue(originalSelect, 'Azure');
                                    originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                                    originalSelect.dispatchEvent(new Event('change'));
                                }
                                invalidateThemesCache();
                                updateActiveState();
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
                                    themeSelect.dispatchEvent(new Event('change'));
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



                function performAutoThemeSwitch(newState) {
                    if (currentAutoThemeState === newState) return;

                    const target = newState === 'day' ? autoThemeSettings.dayTarget : autoThemeSettings.nightTarget;
                    const themeToApply = getThemeForTarget(target);

                    if (themeToApply) {
                        const themeChanged = originalSelect.value !== themeToApply;
                        if (themeChanged) {
                            originalSelect.value = themeToApply;
                            originalSelect.dispatchEvent(new Event('change'));
                            toastr.info(`自动切换至 ${newState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '主题随动', { escapeHtml: false });
                        }
                        // 无论主题是否变化，都主动应用绑定的背景图
                        const boundBg = themeBackgroundBindings[themeToApply];
                        if (boundBg) {
                            // 如果主题没变（change事件不会触发），需要主动应用背景
                            // 如果主题变了，change事件也会尝试应用，但这里再调用一次做兜底保障
                            applyBackgroundDirectly(boundBg);
                        }
                    }
                    currentAutoThemeState = newState;
                }

                function checkAutoTheme() {
                    if (!autoThemeSettings.enabled) return;

                    let newState = null;
                    if (autoThemeSettings.mode === 'system') {
                        newState = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
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

                function populateAutoThemeDropdowns() {
                    const dayTarget = managerPanel.querySelector('#auto-theme-day-target');
                    const nightTarget = managerPanel.querySelector('#auto-theme-night-target');
                    const tags = loadThemeTags();

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

                    // 初始化 Select2 并配置防自动聚焦
                    setTimeout(() => {
                        $([dayTarget, nightTarget]).select2({
                            dropdownParent: $(autoThemeModal).find('.tm-modal-content'),
                            width: '100%'
                        }).on('select2:open', () => {
                            setTimeout(() => {
                                const searchField = document.querySelector('.select2-search__field');
                                if (searchField) searchField.blur();
                            }, 0);
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

