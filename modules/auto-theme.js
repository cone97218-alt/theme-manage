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

export function applyEarlyAutoTheme(originalSelect, settings) {
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
        const [dayH, dayM] = (settings.dayStart || '06:00').split(':').map(Number);
        const [nightH, nightM] = (settings.nightStart || '18:00').split(':').map(Number);
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

export function populateAutoThemeDropdowns(modalContainer) {
    if (!modalContainer) return;
    const dayTarget = modalContainer.querySelector('#auto-theme-day-target');
    const nightTarget = modalContainer.querySelector('#auto-theme-night-target');
    const tags = loadThemeTags();

    if (!dayTarget || !nightTarget) return;

    if (typeof $ !== 'undefined') {
        if ($(dayTarget).data('select2')) $(dayTarget).select2('destroy');
        if ($(nightTarget).data('select2')) $(nightTarget).select2('destroy');
    }

    let optionsHtml = '<option value="">(不改变)</option>';
    if (tags.length > 0) {
        optionsHtml += '<optgroup label="[随机] 从标签中选择">';
        tags.forEach(t => {
            optionsHtml += `<option value="[Tag] ${t.id}">随机标签: ${escapeHtml(t.name)}</option>`;
        });
        optionsHtml += '</optgroup>';
    }
    optionsHtml += '<optgroup label="[指定] 特定主题">';
    (state.allParsedThemes || []).forEach(t => {
        optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
    });
    optionsHtml += '</optgroup>';

    dayTarget.innerHTML = optionsHtml;
    nightTarget.innerHTML = optionsHtml;
    dayTarget.value = state.autoThemeSettings.dayTarget || '';
    nightTarget.value = state.autoThemeSettings.nightTarget || '';

    const pairsContainer = modalContainer.querySelector('#tm-pairs-list-container');
    if (pairsContainer) populateAutoThemePairsList(pairsContainer);

    if (typeof $ !== 'undefined' && $.fn.select2) {
        setTimeout(() => {
            $([dayTarget, nightTarget]).select2({
                dropdownParent: $(modalContainer).find('.tm-modal-content'),
                width: '100%'
            });
        }, 0);
    }
}

export function loadThemeDayNightPairs() {

    try {
        const raw = localStorage.getItem(THEME_DAYNIGHT_PAIRS_KEY);
        state.themeDayNightPairs = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('[Theme Manager] 读取日夜配对数据失败:', e);
        state.themeDayNightPairs = [];
    }
    return state.themeDayNightPairs;
}

export function populateAutoThemePairsList(container) {
    if (!container) return;
    if (!Array.isArray(state.themeDayNightPairs) || state.themeDayNightPairs.length === 0) {
        container.innerHTML = '<div style="opacity:0.7; font-style:italic; text-align:center; padding:10px;">暂无独立日夜组（可在各个美化卡片上点击 <i class="fa-solid fa-circle-half-stroke"></i> 进行关联绑定）</div>';
        return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
    state.themeDayNightPairs.forEach((pair, index) => {
        html += `<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
            <div style="font-size:12px;">
                <span style="color:#fadb14;"><i class="fa-solid fa-sun"></i> ${escapeHtml(pair.dayTheme || '未指定')}</span>
                <span style="margin: 0 8px; opacity:0.7;">↔</span>
                <span style="color:#fa8c16;"><i class="fa-solid fa-moon"></i> ${escapeHtml(pair.nightTheme || '未指定')}</span>
            </div>
            <button class="tm-remove-pair-btn menu_button" data-index="${index}" style="padding:1px 6px; font-size:11px; margin:0; width:auto;"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.tm-remove-pair-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.index);
            if (!isNaN(idx) && state.themeDayNightPairs[idx]) {
                const removed = state.themeDayNightPairs.splice(idx, 1)[0];
                saveThemeDayNightPairs(state.themeDayNightPairs);
                if (removed?.dayTheme) updateThemeItemDayNightState(removed.dayTheme);
                if (removed?.nightTheme) updateThemeItemDayNightState(removed.nightTheme);
                populateAutoThemePairsList(container);
            }
        });
    });
}


export function updateManualToggleBtnVisibility() {
    const btn = state.managerPanel ? state.managerPanel.querySelector('#tm-quick-manual-toggle-btn') : document.querySelector('#tm-quick-manual-toggle-btn');
    if (btn) {
        btn.style.display = state.autoThemeSettings.enableManualToggle ? 'inline-flex' : 'none';
    }
}

export function updateThemeItemDayNightState(themeName) {

    const item = state.themeItemMap ? state.themeItemMap.get(themeName) : null;
    if (!item) return;
    const buttonsDiv = item.querySelector('.theme-item-buttons') || item.children[1];
    if (!buttonsDiv || !buttonsDiv.children[2]) return;
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

let currentTargetThemeForPair = null;

function getOrBuildDayNightModal() {
    if (_daynightModal) return _daynightModal;
    const modal = document.createElement('div');
    modal.className = 'tm-modal-wrapper';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="tm-modal-content" style="max-width: 420px; width: 90%;">
            <div class="tm-modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px; margin-bottom:15px;">
                <h4 style="margin:0;"><i class="fa-solid fa-circle-half-stroke"></i> 绑定日夜美化组合</h4>
                <button class="tm-modal-close menu_button" style="padding:2px 8px; margin:0;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p style="font-size:13px; margin-bottom:12px;">当前操作美化：<b id="tm-daynight-current-name" style="color:var(--primary-color, #007bff);"></b></p>
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div>
                    <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;"><i class="fa-solid fa-sun" style="color:#fadb14;"></i> 对应日间美化 (Light Theme):</label>
                    <select id="tm-daynight-day-select" class="text_pole" style="width:100%;"></select>
                </div>
                <div>
                    <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;"><i class="fa-solid fa-moon" style="color:#fa8c16;"></i> 对应夜间美化 (Dark Theme):</label>
                    <select id="tm-daynight-night-select" class="text_pole" style="width:100%;"></select>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:12px;">
                <button id="tm-daynight-clear-btn" class="menu_button" style="margin:0;">清除解绑</button>
                <button id="tm-daynight-cancel-btn" class="menu_button" style="margin:0;">取消</button>
                <button id="tm-daynight-save-btn" class="menu_button primary" style="margin:0;">保存关联</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    _daynightModal = modal;

    const closeBtn = modal.querySelector('.tm-modal-close');
    const cancelBtn = modal.querySelector('#tm-daynight-cancel-btn');
    const clearBtn = modal.querySelector('#tm-daynight-clear-btn');
    const saveBtn = modal.querySelector('#tm-daynight-save-btn');

    const closeModal = () => { modal.style.display = 'none'; };
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    clearBtn.addEventListener('click', () => {
        if (!currentTargetThemeForPair) return;
        let pairs = Array.isArray(state.themeDayNightPairs) ? [...state.themeDayNightPairs] : [];
        pairs = pairs.filter(p => p && p.dayTheme !== currentTargetThemeForPair && p.nightTheme !== currentTargetThemeForPair);
        saveThemeDayNightPairs(pairs);
        toastr.success(`已解绑主题 "${currentTargetThemeForPair}" 的日夜关联。`);
        closeModal();
        if (state.buildThemeListLazyFn) state.buildThemeListLazyFn();
    });

    saveBtn.addEventListener('click', () => {
        if (!currentTargetThemeForPair) return;
        const dayVal = modal.querySelector('#tm-daynight-day-select').value;
        const nightVal = modal.querySelector('#tm-daynight-night-select').value;

        if (!dayVal && !nightVal) {
            toastr.warning('请至少指定一个日间或夜间主题。');
            return;
        }

        let pairs = Array.isArray(state.themeDayNightPairs) ? [...state.themeDayNightPairs] : [];
        pairs = pairs.filter(p => p && p.dayTheme !== currentTargetThemeForPair && p.nightTheme !== currentTargetThemeForPair);
        if (dayVal && dayVal !== currentTargetThemeForPair) {
            pairs = pairs.filter(p => p && p.dayTheme !== dayVal && p.nightTheme !== dayVal);
        }
        if (nightVal && nightVal !== currentTargetThemeForPair) {
            pairs = pairs.filter(p => p && p.dayTheme !== nightVal && p.nightTheme !== nightVal);
        }

        pairs.push({ dayTheme: dayVal || currentTargetThemeForPair, nightTheme: nightVal || currentTargetThemeForPair });
        saveThemeDayNightPairs(pairs);
        toastr.success('已成功保存日夜美化组合关联！');
        closeModal();
        if (state.buildThemeListLazyFn) state.buildThemeListLazyFn();
    });

    return modal;
}

export function openDayNightPairModal(themeName) {
    currentTargetThemeForPair = themeName;
    const modal = getOrBuildDayNightModal();

    const titleSpan = modal.querySelector('#tm-daynight-current-name');
    const nightSelect = modal.querySelector('#tm-daynight-night-select');
    const daySelect = modal.querySelector('#tm-daynight-day-select');

    if (titleSpan) titleSpan.textContent = themeName;

    let optionsHtml = '<option value="">(未指定 / 不关联)</option>';
    state.allParsedThemes.forEach(t => {
        optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
    });
    if (nightSelect) nightSelect.innerHTML = optionsHtml;
    if (daySelect) daySelect.innerHTML = optionsHtml;

    const existingPair = getPairForTheme(themeName);
    if (existingPair) {
        if (daySelect) daySelect.value = existingPair.dayTheme || '';
        if (nightSelect) nightSelect.value = existingPair.nightTheme || '';
    } else {
        const isNightName = /(深色|暗色|黑色|Dark|Night)/i.test(themeName);
        if (isNightName) {
            if (nightSelect) nightSelect.value = themeName;
            if (daySelect) daySelect.value = '';
        } else {
            if (daySelect) daySelect.value = themeName;
            if (nightSelect) nightSelect.value = '';
        }
    }

    modal.style.display = 'flex';
}

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
