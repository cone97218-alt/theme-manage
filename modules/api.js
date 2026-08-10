import { state, ctx } from './state.js';
import { CACHE_TTL } from './constants.js';
import { escapeHtml } from './utils.js';

// invalidateValidThemeNamesCache 直接内联，避免与 tags-core.js 产生循环依赖
function invalidateValidThemeNamesCache() { state._cachedValidThemeNames = null; }

export async function apiRequest(endpoint, method = 'POST', body = {}, suppressToast = false) {
    try {
        const headers = ctx.getRequestHeaders() || {};
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

export async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }

export async function deleteTheme(themeName, themeObjParam = null) {
    if (!themeName) return false;

    console.log(`[Theme Manager Delete] ══════════════════════════════════════`);
    console.log(`[Theme Manager Delete] 开始擦除物理文件: "${themeName}"`);

    // 1. 第一优先级：优先绝对精准擦除原始名称
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
export function findThemeObject(themeName) {
    if (!themeName) return null;
    const raw = String(themeName).trim();

    // 1. 先从本扩展的内存缓存里直接命中
    const fromMap = state.allThemeObjectsMap.get(raw);
    if (fromMap) return fromMap;

    // 2. 从 ST 全局 themes 数组里查找（这里存的是包含完整字段的对象）
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const stCtx = SillyTavern.getContext();
        const stThemes = stCtx?.themes || stCtx?.power_user?.themes;
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
export async function saveTheme(themeObject) {
    if (!themeObject || !themeObject.name) {
        console.error('[Theme Manager] saveTheme: 传入的对象无效或缺少 name', themeObject);
        return;
    }
    console.log(`[Theme Manager] saveTheme → 写入 "${themeObject.name}.json"`);
    await apiRequest('themes/save', 'POST', themeObject);
    console.log(`[Theme Manager] saveTheme ✅ 写入成功: "${themeObject.name}.json"`);
}

// === 移动端/跨端通用确认弹窗助手 ===
export async function confirmAction(message, okText = '确认删除') {
    if (typeof ctx.callGenericPopup === 'function') {
        try {
            const res = await ctx.callGenericPopup(`
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

export async function promptAction(message, defaultValue = '') {
    if (typeof ctx.callGenericPopup === 'function') {
        try {
            const inputId = 'tm-prompt-input-' + Date.now();
            let currentInputValue = defaultValue;
            const res = await ctx.callGenericPopup(`
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

export async function getCachedThemes() {
    const now = Date.now();
    if (state._themesCache && (now - state._themesCacheTime) < CACHE_TTL) {
        return state._themesCache;
    }
    state._themesCache = await getAllThemesFromAPI();
    state._themesCacheTime = now;
    return state._themesCache;
}

export function invalidateThemesCache() {
    state._themesCache = null;
    state._themesCacheTime = 0;
    invalidateValidThemeNamesCache();
}

// === ST 原生 Custom CSS 编辑器与 CodeMirror 深度内存/DOM 双向同步助手 ===
export function syncCustomCssToST(customCss) {
    const cssVal = customCss !== undefined && customCss !== null ? customCss : '';
    console.log(`[Theme Manager] syncCustomCssToST 触发, 目标 CSS 字节数: ${cssVal.length}`);

    // 1. 写入 ST 官方权威单一数据源 power_user.custom_css
    try {
        if (typeof power_user !== 'undefined') {
            power_user.custom_css = cssVal;
        }
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const stCtx = SillyTavern.getContext();
            if (stCtx && stCtx.power_user) {
                stCtx.power_user.custom_css = cssVal;
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
export function updateSTThemeMemory(themeObject, action = 'add', oldName = null) {
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
            const stCtx = SillyTavern.getContext();
            if (stCtx) {
                if (action === 'delete') {
                    if (purgeFromArray(stCtx.themes)) updated = true;
                    if (stCtx.power_user && purgeFromArray(stCtx.power_user.themes)) updated = true;
                } else if (action === 'rename' && oldName) {
                    if (Array.isArray(stCtx.themes)) {
                        const idx = stCtx.themes.findIndex(t => isMatch(t));
                        if (idx !== -1) stCtx.themes[idx] = themeObject;
                        else stCtx.themes.push(themeObject);
                        updated = true;
                    }
                    if (stCtx.power_user && Array.isArray(stCtx.power_user.themes)) {
                        const idx = stCtx.power_user.themes.findIndex(t => isMatch(t));
                        if (idx !== -1) stCtx.power_user.themes[idx] = themeObject;
                        else stCtx.power_user.themes.push(themeObject);
                        updated = true;
                    }
                } else if (action === 'add' || action === 'save') {
                    if (Array.isArray(stCtx.themes)) {
                        const idx = stCtx.themes.findIndex(t => isMatch(t));
                        if (idx !== -1) stCtx.themes[idx] = themeObject;
                        else stCtx.themes.push(themeObject);
                        updated = true;
                    }
                    if (stCtx.power_user && Array.isArray(stCtx.power_user.themes)) {
                        const idx = stCtx.power_user.themes.findIndex(t => isMatch(t));
                        if (idx !== -1) stCtx.power_user.themes[idx] = themeObject;
                        else stCtx.power_user.themes.push(themeObject);
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
                const stCtx = SillyTavern.getContext();
                if (stCtx.saveSettingsDebounced) stCtx.saveSettingsDebounced();
                else if (stCtx.saveSettings) stCtx.saveSettings();
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
export function getUIControls() {
    if (!state._uiControlsCache) {
        state._uiControlsCache = {};
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
            if (el) state._uiControlsCache[sel] = el;
        });
    }
    return state._uiControlsCache;
}
