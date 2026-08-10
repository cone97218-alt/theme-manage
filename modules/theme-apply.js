/**
 * theme-apply.js
 * 主题颜色应用、直接切换与 ST 内存同步函数
 */

import { state } from './state.js';
import { deduplicateSelectOptions, triggerSelectChange, syncStKnownThemes } from './utils.js';
import { syncCustomCssToST, updateSTThemeMemory, getUIControls } from './api.js';

// ─── 全量主题颜色应用 ─────────────────────────────────────────────────────────

/**
 * 彻底消除上一个美化颜色残留，全量应用新主题的颜色/控件参数
 * @param {object} themeObj 主题对象（含完整颜色字段）
 */
export function applyThemeColors(themeObj) {
    if (!themeObj) return;

    console.log(`[Theme Manager] 执行 applyThemeColors 颜色重置与映射, 主题: "${themeObj.name}"`);
    const root = document.documentElement;

    const colorMap = [
        { prop: 'main_text_color',          var: '--SmartThemeBodyColor',             picker: '#main-text-color-picker',          default: 'rgba(255, 255, 255, 1)' },
        { prop: 'italics_text_color',        var: '--SmartThemeEmColor',               picker: '#italics-color-picker',            default: 'rgba(255, 255, 255, 1)' },
        { prop: 'underline_text_color',      var: '--SmartThemeUnderlineColor',        picker: '#underline-color-picker',          default: 'rgba(255, 255, 255, 1)' },
        { prop: 'quote_text_color',          var: '--SmartThemeQuoteColor',            picker: '#quote-color-picker',              default: 'rgba(255, 255, 255, 1)' },
        { prop: 'blur_tint_color',           var: '--SmartThemeBlurTintColor',         picker: '#blur-tint-color-picker',          default: 'rgba(0, 0, 0, 0.6)' },
        { prop: 'chat_tint_color',           var: '--SmartThemeChatTintColor',         picker: '#chat-tint-color-picker',          default: 'rgba(0, 0, 0, 0.4)' },
        { prop: 'user_mes_blur_tint_color',  var: '--SmartThemeUserMesBlurTintColor',  picker: '#user-mes-blur-tint-color-picker', default: 'rgba(0, 0, 0, 0.4)' },
        { prop: 'bot_mes_blur_tint_color',   var: '--SmartThemeBotMesBlurTintColor',   picker: '#bot-mes-blur-tint-color-picker',  default: 'rgba(0, 0, 0, 0.4)' },
        { prop: 'shadow_color',              var: '--SmartThemeShadowColor',           picker: '#shadow-color-picker',             default: 'rgba(0, 0, 0, 0.8)' },
        { prop: 'border_color',              var: '--SmartThemeBorderColor',           picker: '#border-color-picker',             default: 'rgba(255, 255, 255, 0.1)' },
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
            } catch(e) {}
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
        { prop: 'shadow_width',  var: '--shadowWidth',  picker: '#shadow_width',  counter: '#shadow_width_counter',  default: 2 },
        { prop: 'font_scale',    var: '--fontScale',    picker: '#font_scale',    counter: '#font_scale_counter',    default: 1 },
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

// ─── 直接热切换主题（热更新核心） ────────────────────────────────────────────

/**
 * 绕过 ST 内部模块作用域，直接热切换主题（在重命名/导入后无需刷新即可切换）
 * @param {string} themeName 主题名称
 */
export function applyThemeDirect(themeName) {
    console.log(`[Theme Manager] applyThemeDirect 触发切换至主题: "${themeName}"`);
    const originalSelect = document.querySelector('#themes');
    deduplicateSelectOptions(originalSelect);
    syncStKnownThemes();

    const themeObj = state.allThemeObjectsMap.get(themeName);
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
