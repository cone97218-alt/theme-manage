/**
 * auto-theme.js
 * 自动主题切换与日夜美化联动功能
 */

import { state } from './state.js';
import { AUTO_THEME_KEY, THEME_DAYNIGHT_PAIRS_KEY } from './constants.js';
import { escapeHtml, triggerSelectChange } from './utils.js';
import { getThemeForTarget } from './avatar.js';
import { applyBackgroundDirectly } from './background.js';

let currentAutoThemeState = null;
let autoThemeCheckInterval = null;

/**
 * 获取特定主题所属的日夜配对
 * @param {string} themeName
 */
export function getPairForTheme(themeName) {
    if (!themeName || !Array.isArray(state.themeDayNightPairs)) return null;
    return state.themeDayNightPairs.find(p => p && (p.dayTheme === themeName || p.nightTheme === themeName)) || null;
}

/**
 * 保存日夜配对数组到 localStorage
 * @param {Array} pairs
 */
export function saveThemeDayNightPairs(pairs) {
    state.themeDayNightPairs = pairs;
    localStorage.setItem(THEME_DAYNIGHT_PAIRS_KEY, JSON.stringify(pairs));
}

/**
 * 执行手动日夜模式快速切换
 */
export function executeManualThemeToggle() {
    const originalSelect = document.querySelector('#themes');
    if (!originalSelect) return;
    const currentTheme = originalSelect.value;
    const pair = getPairForTheme(currentTheme);
    let target = null;
    let nextState = 'night';

    if (pair && (pair.dayTheme || pair.nightTheme)) {
        if (currentTheme === pair.dayTheme) {
            nextState = 'night';
            target = pair.nightTheme || pair.dayTheme;
        } else if (currentTheme === pair.nightTheme) {
            nextState = 'day';
            target = pair.dayTheme || pair.nightTheme;
        } else {
            nextState = (currentAutoThemeState === 'day') ? 'night' : 'day';
            target = nextState === 'night' ? (pair.nightTheme || pair.dayTheme) : (pair.dayTheme || pair.nightTheme);
        }
    } else {
        const globalDayTheme = getThemeForTarget(state.autoThemeSettings.dayTarget);
        const globalNightTheme = getThemeForTarget(state.autoThemeSettings.nightTarget);

        if (currentTheme === globalDayTheme) {
            nextState = 'night';
            target = state.autoThemeSettings.nightTarget;
        } else if (currentTheme === globalNightTheme) {
            nextState = 'day';
            target = state.autoThemeSettings.dayTarget;
        } else {
            nextState = (currentAutoThemeState === 'day') ? 'night' : 'day';
            target = nextState === 'day' ? state.autoThemeSettings.dayTarget : state.autoThemeSettings.nightTarget;
        }
    }

    if (!target) {
        toastr.warning('未配置对应的日/夜间主题或全局目标。', '快捷切换');
        return;
    }

    const themeToApply = getThemeForTarget(target);
    if (!themeToApply) {
        toastr.warning(`找不到目标主题: ${target}`, '快捷切换');
        return;
    }

    if (originalSelect.value !== themeToApply) {
        originalSelect.value = themeToApply;
        triggerSelectChange(originalSelect);
        toastr.success(`手动切换至 ${nextState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '快捷切换', { escapeHtml: false });
    } else {
        toastr.info(`当前已是 ${nextState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '快捷切换', { escapeHtml: false });
    }

    const boundBg = state.themeBackgroundBindings[themeToApply];
    if (boundBg) {
        applyBackgroundDirectly(boundBg);
    }

    currentAutoThemeState = nextState;
}

/**
 * 判断当前系统深色/浅色模式
 */
export function getSystemThemeMode() {
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

/**
 * 执行自动主题切换
 * @param {'day'|'night'} newState
 */
export function performAutoThemeSwitch(newState) {
    if (currentAutoThemeState === newState) return;

    let target = null;
    const originalSelect = document.querySelector('#themes');
    if (!originalSelect) return;
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
        target = newState === 'day' ? state.autoThemeSettings.dayTarget : state.autoThemeSettings.nightTarget;
    }

    const themeToApply = getThemeForTarget(target);

    if (themeToApply) {
        const themeChanged = originalSelect.value !== themeToApply;
        if (themeChanged) {
            originalSelect.value = themeToApply;
            triggerSelectChange(originalSelect);
            toastr.info(`自动切换至 ${newState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '主题随动', { escapeHtml: false });
        }
        const boundBg = state.themeBackgroundBindings[themeToApply];
        if (boundBg) {
            applyBackgroundDirectly(boundBg);
        }
    }
    currentAutoThemeState = newState;
}

/**
 * 检查并触发自动主题切换条件
 */
export function checkAutoTheme() {
    if (!state.autoThemeSettings.enabled) return;

    let newState = null;
    if (state.autoThemeSettings.mode === 'system') {
        newState = getSystemThemeMode();
    } else if (state.autoThemeSettings.mode === 'time') {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const [dayH, dayM] = (state.autoThemeSettings.dayStart || '06:00').split(':').map(Number);
        const [nightH, nightM] = (state.autoThemeSettings.nightStart || '18:00').split(':').map(Number);
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

/**
 * 启动自动主题检查循环
 */
export function applyAutoThemeLoop() {
    if (autoThemeCheckInterval) clearInterval(autoThemeCheckInterval);
    if (state.autoThemeSettings.enabled) {
        checkAutoTheme();
        autoThemeCheckInterval = setInterval(checkAutoTheme, 60000);
    }
}

/**
 * 初始化系统主题与焦点变化监听
 */
export function initAutoThemeListeners() {
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (state.autoThemeSettings.enabled && state.autoThemeSettings.mode === 'system') {
                currentAutoThemeState = null;
                performAutoThemeSwitch(e.matches ? 'night' : 'day');
            }
        });
    }

    const tauri = window.__TAURI__ || window.parent?.__TAURI__ || window.top?.__TAURI__;
    if (tauri && tauri.event && typeof tauri.event.listen === 'function') {
        try {
            tauri.event.listen('tauri://theme-changed', (event) => {
                if (state.autoThemeSettings.enabled && state.autoThemeSettings.mode === 'system') {
                    const themePayload = typeof event.payload === 'string' ? event.payload : (event.payload?.theme || '');
                    const newState = themePayload.includes('dark') ? 'night' : 'day';
                    currentAutoThemeState = null;
                    performAutoThemeSwitch(newState);
                }
            });
            console.log('[Theme Manager] 已成功注册 Tauri 原生主题监听事件');
        } catch (e) {
            console.warn('[Theme Manager] 注册 Tauri 主题监听事件失败:', e);
        }
    }

    window.addEventListener('focus', () => {
        if (state.autoThemeSettings.enabled) checkAutoTheme();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.autoThemeSettings.enabled) checkAutoTheme();
    });
}
