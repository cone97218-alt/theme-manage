// modules/theme-core.js
// 主题核心数据模型、标准化清洗、API 通信、ST 内存同步与原生切换管道

export const DEFAULT_THEME_PROPS = {
    main_text_color: 'rgba(255, 255, 255, 1)',
    italics_text_color: 'rgba(255, 255, 255, 1)',
    underline_text_color: 'rgba(255, 255, 255, 1)',
    quote_text_color: 'rgba(255, 255, 255, 1)',
    blur_tint_color: 'rgba(0, 0, 0, 0.6)',
    chat_tint_color: 'rgba(0, 0, 0, 0.4)',
    user_mes_blur_tint_color: 'rgba(0, 0, 0, 0.4)',
    bot_mes_blur_tint_color: 'rgba(0, 0, 0, 0.4)',
    shadow_color: 'rgba(0, 0, 0, 0.8)',
    border_color: 'rgba(255, 255, 255, 0.1)',
    blur_strength: 10,
    shadow_width: 2,
    font_scale: 1,
    chat_width: 50,
    custom_css: ''
};

export const THEME_COLOR_KEYS = [
    { key: 'main_text_color', pickerId: '#main-text-color-picker', cssVar: '--SmartThemeBodyColor' },
    { key: 'italics_text_color', pickerId: '#italics-color-picker', cssVar: '--SmartThemeEmColor' },
    { key: 'underline_text_color', pickerId: '#underline-color-picker', cssVar: '--SmartThemeUnderlineColor' },
    { key: 'quote_text_color', pickerId: '#quote-color-picker', cssVar: '--SmartThemeQuoteColor' },
    { key: 'blur_tint_color', pickerId: '#blur-tint-color-picker', cssVar: '--SmartThemeBlurTintColor' },
    { key: 'chat_tint_color', pickerId: '#chat-tint-color-picker', cssVar: '--SmartThemeChatTintColor' },
    { key: 'user_mes_blur_tint_color', pickerId: '#user-mes-blur-tint-color-picker', cssVar: '--SmartThemeUserMesBlurTintColor' },
    { key: 'bot_mes_blur_tint_color', pickerId: '#bot-mes-blur-tint-color-picker', cssVar: '--SmartThemeBotMesBlurTintColor' },
    { key: 'shadow_color', pickerId: '#shadow-color-picker', cssVar: '--SmartThemeShadowColor' },
    { key: 'border_color', pickerId: '#border-color-picker', cssVar: '--SmartThemeBorderColor' }
];

export function normalizeThemeObject(t, fallbackName = '') {
    if (!t || typeof t !== 'object') t = {};
    const name = String(t.name || t.value || fallbackName || '').trim();
    const normalized = { ...DEFAULT_THEME_PROPS, ...t, name, value: name };
    normalized.custom_css = (typeof t.custom_css === 'string') ? t.custom_css : '';
    return normalized;
}

export function getSolidRgbFromCssVar(varName) {
    try {
        let val = (getComputedStyle(document.documentElement).getPropertyValue(varName) ||
                   getComputedStyle(document.body).getPropertyValue(varName) || '').trim();
        if (!val) return null;

        const match = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (match) {
            return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]), str: `rgb(${match[1]}, ${match[2]}, ${match[3]})` };
        }

        if (val.startsWith('#')) {
            let hex = val.slice(1);
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            if (hex.length >= 6) {
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    return { r, g, b, str: `rgb(${r}, ${g}, ${b})` };
                }
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

export function getAdaptivePopoverBg() {
    const candidateVars = [
        '--SmartThemeBlurTintColor',
        '--SmartThemeBotMesBlurTintColor',
        '--SmartThemeUserMesBlurTintColor',
        '--SmartThemeChatTintColor'
    ];

    for (const v of candidateVars) {
        const parsed = getSolidRgbFromCssVar(v);
        if (parsed) {
            if (parsed.r + parsed.g + parsed.b < 30) {
                return `rgb(${parsed.r + 32}, ${parsed.g + 34}, ${parsed.b + 42})`;
            }
            return parsed.str;
        }
    }
    return '#24262e';
}

export function getPowerUser() {
    if (typeof power_user !== 'undefined' && power_user) return power_user;
    if (typeof window !== 'undefined' && window.power_user) return window.power_user;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        try {
            const ctx = SillyTavern.getContext();
            if (ctx) {
                const pu = ctx.powerUserSettings || ctx.power_user || null;
                if (pu && typeof window !== 'undefined' && !window.power_user) {
                    window.power_user = pu;
                }
                return pu;
            }
        } catch (e) {}
    }
    return null;
}

export function initThemeCore(options) {
    const {
        getRequestHeaders,
        originalSelect,
        recordThemeMtime,
        allParsedThemesMap = new Map(),
        getThemeBackgroundBindings = () => ({}),
        applyBackgroundDirectly = () => {},
        updateActiveState = () => {},
        onObserverSuspendChange = () => {}
    } = options;

    const initialPu = getPowerUser();
    if (initialPu && typeof window !== 'undefined' && !window.power_user) {
        window.power_user = initialPu;
    }

    let allThemeObjects = [];
    const allThemeObjectsMap = new Map();
    const stKnownThemes = new Set(Array.from(originalSelect?.options || []).map(opt => opt.value));

    let _themesCache = null;
    let _themesCacheTime = 0;
    const CACHE_TTL = 5000;

    let _cachedValidThemeNames = null;
    let _isSwitchingTheme = false;

    async function apiRequest(endpoint, method = 'POST', body = {}, suppressToast = false) {
        try {
            const headers = (typeof getRequestHeaders === 'function' ? getRequestHeaders() : {}) || {};
            if (!headers['Content-Type'] && !headers['content-type']) {
                headers['Content-Type'] = 'application/json';
            }
            const fetchOptions = { method, headers, body: JSON.stringify(body) };
            const response = await fetch(`/api/${endpoint}`, fetchOptions);
            const responseText = await response.text();
            if (!response.ok) {
                throw new Error(responseText || `HTTP error! status: ${response.status}`);
            }
            if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
            return responseText ? JSON.parse(responseText) : {};
        } catch (error) {
            console.error(`API request to /api/${endpoint} failed:`, error);
            if (!suppressToast && typeof toastr !== 'undefined') {
                toastr.error(`API请求失败: ${error.message}`);
            }
            throw error;
        }
    }

    async function getAllThemesFromAPI() {
        return (await apiRequest('settings/get', 'POST', {})).themes || [];
    }

    async function getCachedThemes() {
        const now = Date.now();
        if (_themesCache && (now - _themesCacheTime) < CACHE_TTL) {
            return _themesCache;
        }
        const rawThemes = await getAllThemesFromAPI();
        _themesCache = (rawThemes || []).map(t => {
            const clean = normalizeThemeObject(t);
            if (clean.name) allThemeObjectsMap.set(clean.name, clean);
            return clean;
        });
        _themesCacheTime = now;
        return _themesCache;
    }

    function invalidateThemesCache() {
        _themesCache = null;
        _themesCacheTime = 0;
        invalidateValidThemeNamesCache();
    }

    function invalidateValidThemeNamesCache() {
        _cachedValidThemeNames = null;
    }

    function findThemeObject(themeName) {
        if (!themeName) return null;
        const raw = String(themeName).trim();
        const clean = raw.replace(/\s*\(\d+\)$/, '').trim();

        if (allThemeObjectsMap.has(raw)) return allThemeObjectsMap.get(raw);
        if (clean && allThemeObjectsMap.has(clean)) return allThemeObjectsMap.get(clean);

        for (const [k, v] of allThemeObjectsMap.entries()) {
            if (!v) continue;
            const vName = String(v.name || v.value || '').trim();
            if (vName === raw || vName === clean || k.toLowerCase() === raw.toLowerCase() || vName.toLowerCase() === raw.toLowerCase()) {
                return v;
            }
        }

        const pu = getPowerUser();
        if (pu && Array.isArray(pu.themes)) {
            const found = pu.themes.find(t => t && (t.name === raw || t.name === clean || t.value === raw || (t.name && t.name.toLowerCase() === raw.toLowerCase())));
            if (found) return found;
        }

        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            const stThemes = ctx?.themes || ctx?.powerUserSettings?.themes || ctx?.power_user?.themes;
            if (Array.isArray(stThemes)) {
                const found = stThemes.find(t => t && (t.name === raw || t.name === clean || t.value === raw || (t.name && t.name.toLowerCase() === raw.toLowerCase())));
                if (found) return found;
            }
        }

        if (typeof window !== 'undefined' && Array.isArray(window.themes)) {
            const found = window.themes.find(t => t && (t.name === raw || t.name === clean || t.value === raw));
            if (found) return found;
        }

        if (allParsedThemesMap && (allParsedThemesMap.has(raw) || allParsedThemesMap.has(clean))) {
            const parsed = allParsedThemesMap.get(raw) || allParsedThemesMap.get(clean);
            if (parsed && parsed.data && typeof parsed.data === 'object') return parsed.data;
        }

        return null;
    }

    function captureCurrentThemeSnapshot(themeName) {
        const pu = getPowerUser();
        const rawName = String(themeName || pu?.theme || originalSelect?.value || '').trim();
        const currentObj = findThemeObject(rawName) || {};

        let currentCss = '';
        const editorEl = document.querySelector('#customCSS') || document.querySelector('#style_custom_content') || document.querySelector('#custom_style');
        if (editorEl) {
            if (editorEl.CodeMirror && typeof editorEl.CodeMirror.getValue === 'function') {
                currentCss = editorEl.CodeMirror.getValue();
            } else if (window.jQuery && $(editorEl).data('codemirror')) {
                const cm = $(editorEl).data('codemirror');
                if (cm && typeof cm.getValue === 'function') currentCss = cm.getValue();
            } else if (typeof editorEl.value === 'string' && editorEl.value.trim()) {
                currentCss = editorEl.value;
            }
        }
        if (!currentCss && pu && typeof pu.custom_css === 'string' && pu.custom_css.trim()) {
            currentCss = pu.custom_css;
        }
        if (!currentCss) {
            const styleTag = document.getElementById('custom-style');
            if (styleTag && typeof styleTag.innerHTML === 'string' && styleTag.innerHTML.trim()) {
                currentCss = styleTag.innerHTML;
            }
        }

        // 辅助提取数值（支持 DOM 滑块、计数器输入框、pu 字段、旧主题对象及保底默认值）
        const extractNum = (sliderId, counterId, puProp, minVal, maxVal, defaultVal) => {
            let val = null;
            const slider = sliderId ? document.querySelector(sliderId) : null;
            const counter = counterId ? document.querySelector(counterId) : null;
            if (slider && slider.value !== '' && !isNaN(Number(slider.value))) {
                val = Number(slider.value);
            } else if (counter && counter.value !== '' && !isNaN(Number(counter.value))) {
                val = Number(counter.value);
            } else if (pu && pu[puProp] !== undefined && pu[puProp] !== null && pu[puProp] !== '' && !isNaN(Number(pu[puProp]))) {
                val = Number(pu[puProp]);
            } else if (currentObj && currentObj[puProp] !== undefined && currentObj[puProp] !== null && currentObj[puProp] !== '' && !isNaN(Number(currentObj[puProp]))) {
                val = Number(currentObj[puProp]);
            }
            if (val !== null && !isNaN(val)) {
                if (minVal !== undefined && val < minVal) val = minVal;
                if (maxVal !== undefined && val > maxVal) val = maxVal;
                return val;
            }
            return defaultVal;
        };

        const finalChatWidth = extractNum('#chat_width_slider', '#chat_width_slider_counter', 'chat_width', 10, 100, DEFAULT_THEME_PROPS.chat_width);
        const finalFontScale = extractNum('#font_scale', '#font_scale_counter', 'font_scale', 0.1, 5, DEFAULT_THEME_PROPS.font_scale);
        const finalBlur = extractNum('#blur_strength', '#blur_strength_counter', 'blur_strength', 0, 100, DEFAULT_THEME_PROPS.blur_strength);
        const finalShadow = extractNum('#shadow_width', '#shadow_width_counter', 'shadow_width', 0, 50, DEFAULT_THEME_PROPS.shadow_width);

        if (pu) {
            pu.chat_width = finalChatWidth;
            pu.font_scale = finalFontScale;
            pu.blur_strength = finalBlur;
            pu.shadow_width = finalShadow;
        }

        // 权威取色逻辑：
        // ① pu[puProp] (用户选色时 ST 监听器实时写入的权威内存数据，格式如 rgba(r,g,b,a))
        // ② 生效中的 CSS 变量 (applyThemeColor 实时写入的真实样式)
        // ③ picker.rgba / picker.rgb / picker.value (Web Component 内部实时属性)
        // ④ currentObj[puProp] (已加载主题对象的原始颜色)
        // ⑤ picker.getAttribute('color') (仅作为末位兜底，切勿优先读取，因 toolcool 选色时不更新 attribute)
        // ⑥ DEFAULT_THEME_PROPS[puProp]
        const getColorVal = (pickerId, puProp, cssVar) => {
            if (pu && typeof pu[puProp] === 'string' && pu[puProp].trim()) {
                return pu[puProp].trim();
            }

            if (cssVar) {
                try {
                    const cssVal = (document.documentElement.style.getPropertyValue(cssVar) ||
                        (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(cssVar) : '')).trim();
                    if (cssVal) return cssVal;
                } catch (e) {}
            }

            const picker = document.querySelector(pickerId);
            if (picker) {
                if (typeof picker.rgba === 'string' && picker.rgba.trim()) return picker.rgba.trim();
                if (typeof picker.value === 'string' && picker.value.trim()) return picker.value.trim();
            }

            if (currentObj && typeof currentObj[puProp] === 'string' && currentObj[puProp].trim()) {
                return currentObj[puProp].trim();
            }

            if (picker) {
                const attrCol = picker.getAttribute('color');
                if (attrCol && typeof attrCol === 'string' && attrCol.trim()) return attrCol.trim();
            }

            return DEFAULT_THEME_PROPS[puProp];
        };

        const snapshot = normalizeThemeObject({
            ...currentObj,
            name: rawName,
            value: rawName,
            custom_css: currentCss || '',
            main_text_color: getColorVal('#main-text-color-picker', 'main_text_color', '--SmartThemeBodyColor'),
            italics_text_color: getColorVal('#italics-color-picker', 'italics_text_color', '--SmartThemeEmColor'),
            underline_text_color: getColorVal('#underline-color-picker', 'underline_text_color', '--SmartThemeUnderlineColor'),
            quote_text_color: getColorVal('#quote-color-picker', 'quote_text_color', '--SmartThemeQuoteColor'),
            blur_tint_color: getColorVal('#blur-tint-color-picker', 'blur_tint_color', '--SmartThemeBlurTintColor'),
            chat_tint_color: getColorVal('#chat-tint-color-picker', 'chat_tint_color', '--SmartThemeChatTintColor'),
            user_mes_blur_tint_color: getColorVal('#user-mes-blur-tint-color-picker', 'user_mes_blur_tint_color', '--SmartThemeUserMesBlurTintColor'),
            bot_mes_blur_tint_color: getColorVal('#bot-mes-blur-tint-color-picker', 'bot_mes_blur_tint_color', '--SmartThemeBotMesBlurTintColor'),
            shadow_color: getColorVal('#shadow-color-picker', 'shadow_color', '--SmartThemeShadowColor'),
            border_color: getColorVal('#border-color-picker', 'border_color', '--SmartThemeBorderColor'),
            blur_strength: finalBlur,
            shadow_width: finalShadow,
            font_scale: finalFontScale,
            chat_width: finalChatWidth
        }, rawName);

        // 同步所有额外高级属性
        const extraKeys = [
            'fast_ui_mode', 'waifuMode', 'avatar_style', 'chat_display', 'toastr_position',
            'noShadows', 'timer_enabled', 'timestamps_enabled', 'timestamp_model_icon',
            'mesIDDisplay_enabled', 'hideChatAvatars_enabled', 'message_token_count_enabled',
            'expand_message_actions', 'enableZenSliders', 'enableLabMode', 'hotswap_enabled',
            'bogus_folders', 'zoomed_avatar_magnification', 'reduced_motion', 'compact_input_area',
            'show_swipe_num_all_messages', 'click_to_edit', 'media_display'
        ];
        if (pu) {
            extraKeys.forEach(k => {
                if (pu[k] !== undefined) snapshot[k] = pu[k];
            });
        }
        const reducedMotionEl = document.querySelector('#reduced_motion');
        if (reducedMotionEl) snapshot.reduced_motion = reducedMotionEl.checked;

        return snapshot;
    }

    function updateSTThemeMemory(themeObject, action = 'add', oldName = null) {
        const targetName = themeObject ? (themeObject.name || themeObject.value) : oldName;
        if (!targetName) return;

        const normalizedObj = themeObject ? normalizeThemeObject(themeObject) : null;
        const cleanName = String(targetName).replace(/\[.*?\]/g, '').trim();
        const exactNames = new Set([String(targetName)]);
        if (cleanName) exactNames.add(cleanName);
        if (normalizedObj && normalizedObj.name) exactNames.add(String(normalizedObj.name));
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

            const updateInArray = (arr, newObj) => {
                if (!Array.isArray(arr)) return false;
                const idx = arr.findIndex(t => isMatch(t));
                if (idx !== -1) arr[idx] = newObj;
                else arr.push(newObj);
                return true;
            };

            const pu = getPowerUser();
            if (pu) {
                if (action === 'delete') {
                    if (purgeFromArray(pu.themes)) updated = true;
                } else if (normalizedObj && Array.isArray(pu.themes)) {
                    updateInArray(pu.themes, normalizedObj);
                    updated = true;
                }
            }

            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                const ctx = SillyTavern.getContext();
                if (ctx) {
                    if (action === 'delete') {
                        if (purgeFromArray(ctx.themes)) updated = true;
                        if (ctx.powerUserSettings && purgeFromArray(ctx.powerUserSettings.themes)) updated = true;
                        if (ctx.power_user && purgeFromArray(ctx.power_user.themes)) updated = true;
                    } else if (normalizedObj) {
                        if (Array.isArray(ctx.themes)) updateInArray(ctx.themes, normalizedObj);
                        if (ctx.powerUserSettings && Array.isArray(ctx.powerUserSettings.themes)) updateInArray(ctx.powerUserSettings.themes, normalizedObj);
                        if (ctx.power_user && Array.isArray(ctx.power_user.themes)) updateInArray(ctx.power_user.themes, normalizedObj);
                        updated = true;
                    }
                }
            }

            if (typeof themes !== 'undefined' && Array.isArray(themes)) {
                if (action === 'delete') {
                    if (purgeFromArray(themes)) updated = true;
                } else if (normalizedObj) {
                    updateInArray(themes, normalizedObj);
                    updated = true;
                }
            }
            if (typeof window !== 'undefined' && Array.isArray(window.themes)) {
                if (action === 'delete') {
                    if (purgeFromArray(window.themes)) updated = true;
                } else if (normalizedObj) {
                    updateInArray(window.themes, normalizedObj);
                    updated = true;
                }
            }

            if (action === 'delete') {
                allThemeObjectsMap.delete(targetName);
                if (cleanName) allThemeObjectsMap.delete(cleanName);
                if (Array.isArray(_themesCache)) {
                    _themesCache = _themesCache.filter(t => !isMatch(t));
                }
            } else if (normalizedObj) {
                allThemeObjectsMap.set(normalizedObj.name, normalizedObj);
                if (Array.isArray(_themesCache)) {
                    const idx = _themesCache.findIndex(t => isMatch(t));
                    if (idx !== -1) _themesCache[idx] = normalizedObj;
                    else _themesCache.push(normalizedObj);
                }
            }

            if (updated || action === 'delete' || action === 'save') {
                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                    else if (ctx.saveSettings) ctx.saveSettings();
                }
            }
        } catch (e) {
            console.error('[Theme Manager Error] 同步 ST 内部主题内存失败:', e);
        }
    }

    async function saveTheme(themeObject) {
        if (!themeObject || (!themeObject.name && !themeObject.value)) {
            console.error('[Theme Manager] saveTheme: 传入的对象无效或缺少 name', themeObject);
            return false;
        }
        const normalized = normalizeThemeObject(themeObject);
        console.log(`[Theme Manager] saveTheme → 写入 "${normalized.name}.json" (CSS长度: ${normalized.custom_css.length})`);

        const { mtime: _m, ...payload } = normalized;
        await apiRequest('themes/save', 'POST', payload);
        console.log(`[Theme Manager] saveTheme ✅ 写入成功: "${normalized.name}.json"`);

        const now = Date.now();
        if (typeof recordThemeMtime === 'function') {
            recordThemeMtime(normalized.name, now);
        }
        normalized.mtime = now;
        allThemeObjectsMap.set(normalized.name, normalized);

        const parsed = allParsedThemesMap.get(normalized.name);
        if (parsed) parsed.mtime = now;

        updateSTThemeMemory(normalized, 'save');
        invalidateThemesCache();
        return true;
    }

    async function deleteTheme(themeName, themeObjParam = null) {
        if (!themeName) return false;

        console.log(`[Theme Manager Delete] ══════════════════════════════════════`);
        console.log(`[Theme Manager Delete] 开始擦除物理文件: "${themeName}"`);

        const rawName = String(themeName).trim();
        try {
            await apiRequest('themes/delete', 'POST', { name: rawName }, true);
            console.log(`[Theme Manager Delete] ✅ 成功精准擦除磁盘文件: "${rawName}.json"`);
            updateSTThemeMemory({ name: themeName }, 'delete', themeName);
            return true;
        } catch (err) {
            console.log(`[Theme Manager Delete] ℹ️ 精确匹配 "${rawName}.json" 未直接删除 (${err.message})，继续尝试变体文件...`);
        }

        const candidateSet = new Set();
        const addNameVariants = (str) => {
            if (!str || typeof str !== 'string') return;
            const raw = str.trim();
            if (!raw) return;

            const baseList = new Set();
            baseList.add(raw);

            const sanitized = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
            if (sanitized) baseList.add(sanitized);

            const unbracketed = raw.replace(/[\[\]【】（）()《》<>]/g, ' ').replace(/\s+/g, ' ').trim();
            if (unbracketed) baseList.add(unbracketed);

            const cleanOuter = raw.replace(/([\[【（(《<].*?[\]】）)》>])/g, '').trim();
            if (cleanOuter) baseList.add(cleanOuter);

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
            } catch (err) {}
        }

        if (!isDeletedOnDisk) {
            console.warn(`[Theme Manager Delete] ⚠️ 所有试探候选名均未命中磁盘文件，可能文件已被手动删除。候选名:`, candidates);
        }

        updateSTThemeMemory({ name: themeName }, 'delete', themeName);
        console.log(`[Theme Manager Delete] ══════════════════════════════════════`);
        return isDeletedOnDisk;
    }

    function triggerSelectChange(selectEl) {
        if (!selectEl) return;
        console.log(`[Theme Manager] 触发展示与原生 change 事件, 当前选中值: ${selectEl.value}`);
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window !== 'undefined' && window.jQuery) {
            try {
                $(selectEl).trigger('change');
                console.log('[Theme Manager] jQuery $(#themes).trigger("change") 执行成功');
            } catch (e) {
                console.error('[Theme Manager Error] jQuery trigger("change") 失败:', e);
            }
        }
    }

    function deduplicateSelectOptions(selectEl) {
        if (!selectEl || !selectEl.options) return;
        const pu = getPowerUser();
        const activeVal = pu?.theme || selectEl.value || '';
        const seen = new Map();
        const options = Array.from(selectEl.options);
        let removedCount = 0;
        onObserverSuspendChange(true);
        try {
            options.forEach(opt => {
                if (!opt.value) {
                    opt.remove();
                    removedCount++;
                    return;
                }
                if (seen.has(opt.value)) {
                    const prevOpt = seen.get(opt.value);
                    if (opt.selected || opt.value === activeVal) {
                        prevOpt.remove();
                        seen.set(opt.value, opt);
                    } else {
                        opt.remove();
                    }
                    removedCount++;
                } else {
                    seen.set(opt.value, opt);
                }
            });
            if (activeVal && seen.has(activeVal)) {
                const targetOpt = seen.get(activeVal);
                targetOpt.selected = true;
                selectEl.value = activeVal;
                if (pu) {
                    pu.theme = activeVal;
                }
            }
        } finally {
            onObserverSuspendChange(false);
        }
        if (removedCount > 0) {
            console.log(`[Theme Manager] deduplicateSelectOptions 智能清理了 ${removedCount} 个重复 option 节点，保持当前主题: "${activeVal}"`);
        }
    }

    function manualUpdateOriginalSelect(action, oldName, newName) {
        const select = originalSelect || document.querySelector('#themes');
        if (!select) return;
        console.log(`[Theme Manager] manualUpdateOriginalSelect: action=${action}, oldName=${oldName}, newName=${newName}`);
        onObserverSuspendChange(true);
        try {
            if (action === 'add') {
                const existingOption = Array.from(select.options).find(opt => opt.value === newName);
                if (!existingOption) {
                    const option = document.createElement('option');
                    option.value = newName; option.textContent = newName;
                    select.appendChild(option);
                }
                stKnownThemes.add(newName);
            } else if (action === 'delete') {
                const cleanName = oldName ? oldName.replace(/\[.*?\]/g, '').trim() : '';
                Array.from(select.options).forEach(opt => {
                    if (opt.value === oldName || opt.value === cleanName || opt.textContent === oldName || opt.textContent === cleanName) {
                        opt.remove();
                    }
                });
                stKnownThemes.delete(oldName);
                if (cleanName) stKnownThemes.delete(cleanName);
            } else if (action === 'rename') {
                const optionToRename = Array.from(select.options).find(opt => opt.value === oldName);
                if (optionToRename) {
                    optionToRename.value = newName;
                    optionToRename.textContent = newName;
                }
                if (select.value === oldName) {
                    select.value = newName;
                }
                stKnownThemes.delete(oldName);
                stKnownThemes.add(newName);
            }
            deduplicateSelectOptions(select);
        } finally {
            setTimeout(() => { onObserverSuspendChange(false); }, 0);
        }
    }

    function syncStKnownThemes() {
        const select = originalSelect || document.querySelector('#themes');
        if (select && select.options) {
            Array.from(select.options).forEach(opt => {
                if (opt.value) stKnownThemes.add(opt.value);
            });
        }
    }

    function applyThemeDirect(themeName) {
        if (!themeName) return;
        console.log(`[Theme Manager] 切换至主题: "${themeName}"`);

        _isSwitchingTheme = true;
        try {
            const select = originalSelect || document.querySelector('#themes');
            deduplicateSelectOptions(select);
            syncStKnownThemes();

            let themeObj = findThemeObject(themeName) || { name: themeName };
            const cleanTheme = normalizeThemeObject(themeObj, themeName);

            updateSTThemeMemory(cleanTheme, 'add');

            if (select) {
                let opt = Array.from(select.options).find(o => o.value === cleanTheme.name);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = cleanTheme.name;
                    opt.textContent = cleanTheme.name;
                    select.appendChild(opt);
                }
                opt.selected = true;
                select.value = cleanTheme.name;
            }

            const pu = getPowerUser();
            if (pu) {
                pu.theme = cleanTheme.name;
            }

            // 1. 同步自定义 CSS (custom_css) 至内存、编辑器与 DOM (<style id="custom-style">)
            const customCss = (typeof cleanTheme.custom_css === 'string') ? cleanTheme.custom_css : '';
            if (pu) {
                pu.custom_css = customCss;
            }
            const editorEl = document.querySelector('#customCSS') || document.querySelector('#style_custom_content') || document.querySelector('#custom_style');
            if (editorEl) {
                editorEl.value = customCss;
            }
            let customStyleTag = document.getElementById('custom-style');
            if (!customStyleTag) {
                customStyleTag = document.createElement('style');
                customStyleTag.setAttribute('type', 'text/css');
                customStyleTag.setAttribute('id', 'custom-style');
                document.head.appendChild(customStyleTag);
            }
            customStyleTag.innerHTML = customCss;

            // 2. 触发原生 select 联动，此时内存与 DOM 已完全就绪
            if (select) {
                onObserverSuspendChange(true);
                try {
                    triggerSelectChange(select);
                } finally {
                    setTimeout(() => { onObserverSuspendChange(false); }, 50);
                }
            }

            // 【核心修复】显式同步高级布尔开关与样式类
            if (cleanTheme.fast_ui_mode !== undefined) {
                const fastUi = Boolean(cleanTheme.fast_ui_mode);
                if (pu) pu.fast_ui_mode = fastUi;
                const fastUiEl = document.querySelector('#fast_ui_mode');
                if (fastUiEl) fastUiEl.checked = fastUi;
                if (fastUi) document.body.classList.add('fast-ui');
                else document.body.classList.remove('fast-ui');
            }
            if (cleanTheme.waifuMode !== undefined) {
                const waifu = Boolean(cleanTheme.waifuMode);
                if (pu) pu.waifuMode = waifu;
                const waifuEl = document.querySelector('#waifuMode');
                if (waifuEl) waifuEl.checked = waifu;
                if (waifu) document.body.classList.add('waifuMode');
                else document.body.classList.remove('waifuMode');
            }
            if (cleanTheme.noShadows !== undefined) {
                const noShadows = Boolean(cleanTheme.noShadows);
                if (pu) pu.noShadows = noShadows;
                const noShadowsEl = document.querySelector('#noShadows');
                if (noShadowsEl) noShadowsEl.checked = noShadows;
                if (noShadows) document.body.classList.add('noShadows');
                else document.body.classList.remove('noShadows');
            }
            if (cleanTheme.reduced_motion !== undefined) {
                const redMotion = Boolean(cleanTheme.reduced_motion);
                if (pu) pu.reduced_motion = redMotion;
                const redMotionEl = document.querySelector('#reduced_motion');
                if (redMotionEl) redMotionEl.checked = redMotion;
                if (redMotion) document.body.classList.add('reduced-motion');
                else document.body.classList.remove('reduced-motion');
            }
            if (cleanTheme.compact_input_area !== undefined) {
                const compactInput = Boolean(cleanTheme.compact_input_area);
                if (pu) pu.compact_input_area = compactInput;
                const compactInputEl = document.querySelector('#compact_input_area');
                if (compactInputEl) compactInputEl.checked = compactInput;
                if (compactInput) document.body.classList.add('compact-input');
                else document.body.classList.remove('compact-input');
            }
            const extraKeys = [
                'avatar_style', 'chat_display', 'toastr_position',
                'timer_enabled', 'timestamps_enabled', 'timestamp_model_icon',
                'mesIDDisplay_enabled', 'hideChatAvatars_enabled', 'message_token_count_enabled',
                'expand_message_actions', 'enableZenSliders', 'enableLabMode', 'hotswap_enabled',
                'bogus_folders', 'zoomed_avatar_magnification', 'show_swipe_num_all_messages',
                'click_to_edit', 'media_display'
            ];
            if (pu) {
                extraKeys.forEach(k => {
                    if (cleanTheme[k] !== undefined) {
                        pu[k] = cleanTheme[k];
                    }
                });
            }

            // 【关键强化】显式双重保障：10 项主题色 100% 同步还原并生效至 DOM、CSS 变量、取色器与内存
            THEME_COLOR_KEYS.forEach(({ key, pickerId, cssVar }) => {
                const col = cleanTheme[key] || DEFAULT_THEME_PROPS[key];
                if (col) {
                    if (pu) pu[key] = col;
                    try {
                        document.documentElement.style.setProperty(cssVar, col);
                    } catch (e) {}

                    const picker = document.querySelector(pickerId);
                    if (picker) {
                        try {
                            picker.setAttribute('color', col);
                            if ('rgba' in picker) picker.rgba = col;
                        } catch (e) {}
                    }

                    if (key === 'main_text_color' && typeof col === 'string' && col.includes('(')) {
                        try {
                            const parts = col.split('(')[1].split(')')[0].split(',');
                            if (parts.length >= 4) {
                                document.documentElement.style.setProperty('--SmartThemeCheckboxBgColorR', parts[0].trim());
                                document.documentElement.style.setProperty('--SmartThemeCheckboxBgColorG', parts[1].trim());
                                document.documentElement.style.setProperty('--SmartThemeCheckboxBgColorB', parts[2].trim());
                                document.documentElement.style.setProperty('--SmartThemeCheckboxBgColorA', parts[3].trim());
                            }
                        } catch (e) {}
                    }

                    if (key === 'blur_tint_color') {
                        try {
                            const metaThemeColor = document.querySelector('meta[name=theme-color]');
                            if (metaThemeColor) metaThemeColor.setAttribute('content', col);
                        } catch (e) {}
                    }
                }
            });

            // 【关键强化】确保切换回该主题时，页面宽度、字体大小、模糊度等样式与控件 100% 同步还原并生效
            if (cleanTheme.chat_width !== undefined) {
                const widthVal = Number(cleanTheme.chat_width) || 50;
                if (pu) pu.chat_width = widthVal;
                document.documentElement.style.setProperty('--sheldWidth', `${widthVal}vw`);
                const slider = document.querySelector('#chat_width_slider');
                if (slider) slider.value = widthVal;
                const counter = document.querySelector('#chat_width_slider_counter');
                if (counter) counter.value = widthVal;
            }
            if (cleanTheme.font_scale !== undefined) {
                const fontVal = Number(cleanTheme.font_scale) || 1;
                if (pu) pu.font_scale = fontVal;
                document.documentElement.style.setProperty('--sheldFontScale', `${fontVal}`);
                document.documentElement.style.setProperty('--fontScale', String(fontVal));
                const slider = document.querySelector('#font_scale');
                if (slider) slider.value = fontVal;
                const counter = document.querySelector('#font_scale_counter');
                if (counter) counter.value = fontVal;
            }
            if (cleanTheme.blur_strength !== undefined) {
                const blurVal = Number(cleanTheme.blur_strength) || 10;
                if (pu) pu.blur_strength = blurVal;
                document.documentElement.style.setProperty('--sheldBlur', `${blurVal}px`);
                document.documentElement.style.setProperty('--blurStrength', String(blurVal));
                const slider = document.querySelector('#blur_strength');
                if (slider) slider.value = blurVal;
                const counter = document.querySelector('#blur_strength_counter');
                if (counter) counter.value = blurVal;
            }
            if (cleanTheme.shadow_width !== undefined) {
                const shadowVal = Number(cleanTheme.shadow_width) || 2;
                if (pu) pu.shadow_width = shadowVal;
                document.documentElement.style.setProperty('--shadowWidth', String(shadowVal));
                const slider = document.querySelector('#shadow_width');
                if (slider) slider.value = shadowVal;
                const counter = document.querySelector('#shadow_width_counter');
                if (counter) counter.value = shadowVal;
            }

            try {
                const bindings = getThemeBackgroundBindings();
                const boundBg = bindings ? bindings[cleanTheme.name] : null;
                if (boundBg) {
                    applyBackgroundDirectly(boundBg);
                }
            } catch (e) {
                console.error('[Theme Manager] 应用绑定背景失败:', e);
            }

            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                try {
                    SillyTavern.getContext().saveSettingsDebounced();
                } catch (e) {}
            }

            updateActiveState();

            try {
                document.dispatchEvent(new CustomEvent('themeManager:themeChanged', { 
                    detail: { themeName: cleanTheme.name, themeObj: cleanTheme } 
                }));
            } catch (e) {}
        } finally {
            _isSwitchingTheme = false;
        }
    }

    function getValidInstalledThemeNames() {
        if (_cachedValidThemeNames) return _cachedValidThemeNames;
        const names = new Set();
        if (stKnownThemes && stKnownThemes.size > 0) {
            stKnownThemes.forEach(name => { if (name) names.add(name); });
        }
        if (allThemeObjectsMap && allThemeObjectsMap.size > 0) {
            allThemeObjectsMap.forEach((_, name) => { if (name) names.add(name); });
        }
        if (typeof getAllThemeObjects === 'function') {
            const list = getAllThemeObjects();
            if (Array.isArray(list)) list.forEach(t => { if (t && t.name) names.add(t.name); });
        } else if (Array.isArray(allThemeObjects) && allThemeObjects.length > 0) {
            allThemeObjects.forEach(t => { if (t && t.name) names.add(t.name); });
        }
        const select = originalSelect || document.querySelector('#themes');
        if (select && select.options) {
            for (let i = 0; i < select.options.length; i++) {
                const val = select.options[i].value;
                if (val) names.add(val);
            }
        }
        _cachedValidThemeNames = names;
        return names;
    }

    return {
        getPowerUser,
        allThemeObjects,
        allThemeObjectsMap,
        stKnownThemes,
        normalizeThemeObject,
        captureCurrentThemeSnapshot,
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
        THEME_COLOR_KEYS,
        isSwitchingTheme: () => _isSwitchingTheme
    };
}
