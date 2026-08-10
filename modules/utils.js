/**
 * utils.js
 * 通用工具函数，大多数是纯函数或仅操作 DOM/state。
 */

import { state } from './state.js';
import { CACHE_TTL } from './constants.js';

// ─── 并发控制 ────────────────────────────────────────────────────────────────

/**
 * 轻量级并发限制辅助函数，保证在低端设备或超大批量操作时网络请求有序，避免过载
 * @param {number} concurrency 最大并发数
 * @param {any[]} items 任务列表
 * @param {(item: any) => Promise<any>} taskFn 任务函数
 */
export async function limitConcurrency(concurrency, items, taskFn) {
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

// ─── HTML 工具 ───────────────────────────────────────────────────────────────

/** 安全转义 HTML 特殊字符 */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/** 安全关闭 SillyTavern generic popup 弹窗 */
export function closePopup(popup) {
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

/** 显示数据刷新的提示栏 */
export function showRefreshNotification() {
    const notice = document.querySelector('#tm-refresh-notice');
    if (notice) {
        notice.style.display = 'block';
    }
}



// ─── 滚动工具 ────────────────────────────────────────────────────────────────

/** 递归查找最近的可滚动祖先节点 */
export function getScrollParent(node) {
    if (node === null) return window;
    if (node.scrollHeight > node.clientHeight) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
            return node;
        }
    }
    return getScrollParent(node.parentNode);
}

// ─── 主题列表排序 ─────────────────────────────────────────────────────────────

/**
 * 对主题列表按指定规则排序，返回新数组（不修改原数组）
 * @param {Array} themes 主题列表
 * @param {string} sortBy 排序规则
 */
export function sortThemes(themes, sortBy) {
    const sorted = [...themes];
    const locOpts = { numeric: true, sensitivity: 'base' };
    if (sortBy === 'name-asc') {
        sorted.sort((a, b) => a.display.localeCompare(b.display, undefined, locOpts));
    } else if (sortBy === 'name-desc') {
        sorted.sort((a, b) => b.display.localeCompare(a.display, undefined, locOpts));
    } else if (sortBy === 'favorite-first') {
        sorted.sort((a, b) => {
            const aFav = state.favoritesSet.has(a.value);
            const bFav = state.favoritesSet.has(b.value);
            if (aFav && !bFav) return -1;
            if (!aFav && bFav) return 1;
            return a.display.localeCompare(b.display, undefined, locOpts);
        });
    } else if (sortBy === 'time-desc') {
        sorted.sort((a, b) => {
            const diff = (b.mtime || 0) - (a.mtime || 0);
            return diff !== 0 ? diff : a.display.localeCompare(b.display, undefined, locOpts);
        });
    } else if (sortBy === 'time-asc') {
        sorted.sort((a, b) => {
            const diff = (a.mtime || 0) - (b.mtime || 0);
            return diff !== 0 ? diff : a.display.localeCompare(b.display, undefined, locOpts);
        });
    } else if (sortBy === 'usage-desc') {
        sorted.sort((a, b) => {
            const diff = (state.usageCount[b.value] || 0) - (state.usageCount[a.value] || 0);
            return diff !== 0 ? diff : a.display.localeCompare(b.display, undefined, locOpts);
        });
    } else if (sortBy === 'usage-asc') {
        sorted.sort((a, b) => {
            const diff = (state.usageCount[a.value] || 0) - (state.usageCount[b.value] || 0);
            return diff !== 0 ? diff : a.display.localeCompare(b.display, undefined, locOpts);
        });
    }
    return sorted;
}

// ─── Select 工具 ─────────────────────────────────────────────────────────────

/** 按 value 查找 select option */
export function findOptionByValue(selectEl, value) {
    return Array.from(selectEl.options).find(opt => opt.value === value) || null;
}

/**
 * 双重触发 change 事件（保证 ST 原生 jQuery 监听器也被激活）
 * @param {HTMLSelectElement} selectEl
 */
export function triggerSelectChange(selectEl) {
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

/**
 * 剔除 #themes select 中的重复 option，防止同名重复卡片
 * @param {HTMLSelectElement} selectEl
 */
export function deduplicateSelectOptions(selectEl) {
    if (!selectEl || !selectEl.options) return;
    const seen = new Set();
    let removedCount = 0;
    Array.from(selectEl.options).forEach(opt => {
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

/**
 * 手动更新原生 #themes select（add / rename / delete）
 * @param {'add'|'rename'|'delete'} action
 * @param {string|null} oldName
 * @param {string|null} newName
 */
export function manualUpdateOriginalSelect(action, oldName, newName) {
    const originalSelect = document.querySelector('#themes');
    if (!originalSelect) return;
    console.log(`[Theme Manager] manualUpdateOriginalSelect: action=${action}, oldName=${oldName}, newName=${newName}`);
    state._suspendObserver = true;
    try {
        if (action === 'add') {
            const existingOption = findOptionByValue(originalSelect, newName);
            if (!existingOption) {
                const option = document.createElement('option');
                option.value = newName; option.textContent = newName;
                originalSelect.appendChild(option);
            }
            state.stKnownThemes.add(newName);
        } else if (action === 'delete') {
            const cleanName = oldName ? oldName.replace(/\[.*?\]/g, '').trim() : '';
            Array.from(originalSelect.options).forEach(opt => {
                if (opt.value === oldName || opt.value === cleanName || opt.textContent === oldName || opt.textContent === cleanName) {
                    opt.remove();
                }
            });
            state.stKnownThemes.delete(oldName);
            if (cleanName) state.stKnownThemes.delete(cleanName);
        } else if (action === 'rename') {
            const optionToRename = findOptionByValue(originalSelect, oldName);
            if (optionToRename) {
                optionToRename.value = newName;
                optionToRename.textContent = newName;
            }
            if (originalSelect.value === oldName) originalSelect.value = newName;
            state.stKnownThemes.delete(oldName);
            state.stKnownThemes.add(newName);
        }
        deduplicateSelectOptions(originalSelect);
    } finally {
        setTimeout(() => { state._suspendObserver = false; }, 0);
    }
}

/** 动态同步 stKnownThemes 集合 */
export function syncStKnownThemes() {
    const originalSelect = document.querySelector('#themes');
    if (originalSelect && originalSelect.options) {
        Array.from(originalSelect.options).forEach(opt => {
            if (opt.value) state.stKnownThemes.add(opt.value);
        });
    }
}

// ─── 防抖 ────────────────────────────────────────────────────────────────────

/**
 * 防抖调用 buildThemeUI（需要 buildThemeUI 从外部传入以避免循环依赖）
 * @param {Function} buildThemeUIFn buildThemeUI 函数引用
 * @param {number} delay 防抖延迟毫秒数
 */
export function debouncedBuildThemeUI(buildThemeUIFn, delay = 200) {
    clearTimeout(state._buildThemeUITimer);
    state._buildThemeUITimer = setTimeout(() => buildThemeUIFn(), delay);
}

// ─── 触摸设备检测 ─────────────────────────────────────────────────────────────

/** 是否为触摸设备（移动端跳过动画避免 scrollHeight 昂贵布局重排） */
export const isTouchDevice = window.matchMedia('(hover: none)').matches;
