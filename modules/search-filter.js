/**
 * search-filter.js
 * 通用复合搜索匹配逻辑与主题筛选函数
 */

import { state } from './state.js';
import { ACTIVE_TAGS_KEY } from './constants.js';

// ─── 复合搜索匹配 ─────────────────────────────────────────────────────────────

/**
 * 通用复合搜索匹配逻辑
 * 支持 OR: 空格/逗号/|; 与: +/AND/&&; 排除: -/!/NOT
 * @param {string} targetTextLC 待匹配文本（已小写）
 * @param {string} rawSearch 原始搜索字符串
 */
export function isTextMatchingCompositeSearch(targetTextLC, rawSearch) {
    if (!rawSearch || typeof rawSearch !== 'string') return true;
    const raw = rawSearch.trim();
    if (!raw) return true;

    // 1. 若包含 + 或 AND 或 &&，作为最高优先级与逻辑处理 (AND 组)
    if (raw.includes('+') || /\bAND\b/i.test(raw) || raw.includes('&&')) {
        const andParts = raw.split(/\+|\bAND\b|&&/i).map(s => s.trim()).filter(Boolean);
        return andParts.every(part => checkSearchSubExpression(targetTextLC, part));
    }

    // 2. 单表达组 (支持空格 / 逗号 / 竖线 | 作为 OR，支持 - / ! 作排除)
    return checkSearchSubExpression(targetTextLC, raw);
}

/**
 * 检查单个搜索子表达式
 * @param {string} targetTextLC 待匹配文本（已小写）
 * @param {string} expr 子表达式
 */
export function checkSearchSubExpression(targetTextLC, expr) {
    if (!expr) return true;

    const tokens = expr.split(/[\s,，\|/／\\;；·]|\bOR\b/i).map(s => s.trim()).filter(Boolean);
    if (tokens.length === 0) return true;

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

    // 排除项检查 (NOT 逻辑)：若包含任意排除关键词，则判定不匹配
    for (let i = 0; i < negativeTerms.length; i++) {
        if (targetTextLC.includes(negativeTerms[i])) {
            return false;
        }
    }

    // 正向项检查 (OR 复合匹配)：满足任意一个正向关键词即匹配
    if (positiveTerms.length > 0) {
        return positiveTerms.some(term => targetTextLC.includes(term));
    }

    return true;
}

/**
 * 判断主题是否匹配当前搜索关键词（含标签名搜索）
 * @param {object} theme 主题对象
 * @param {string} rawSearch 原始搜索字符串
 * @param {Map} tagsById 标签 ID -> 标签对象 Map
 */
export function isThemeMatchingSearch(theme, rawSearch, tagsById) {
    if (!rawSearch || !rawSearch.trim()) return true;
    let targetText = (theme.display || '') + ' ' + (theme.value || '');
    if (theme.tags && theme.tags.length > 0 && tagsById) {
        for (let i = 0; i < theme.tags.length; i++) {
            const tagObj = tagsById.get(theme.tags[i]);
            if (tagObj && tagObj.name) {
                targetText += ' ' + tagObj.name;
            }
        }
    }
    return isTextMatchingCompositeSearch(targetText.toLowerCase(), rawSearch);
}

/**
 * 轻量级筛选：通知 theme-ui 重建列表
 * 为避免与 theme-ui.js 的循环依赖，buildThemeListLazy 通过 state.buildThemeListLazyFn 在初始化时注入
 * @param {number} [scrollTop] 滚动位置
 */
export function filterThemeList(scrollTop) {
    if (typeof state.buildThemeListLazyFn === 'function') {
        state.buildThemeListLazyFn(scrollTop);
    }
}

/**
 * 标签筛选切换的轻量级处理函数
 */
export function handleTagFilterChange() {
    localStorage.setItem(ACTIVE_TAGS_KEY, JSON.stringify(Array.from(state.activeTagFilters)));
    // updateTagChipsActiveState 通过 state.updateTagChipsActiveStateFn 注入（避免循环依赖）
    if (typeof state.updateTagChipsActiveStateFn === 'function') {
        state.updateTagChipsActiveStateFn();
    }
    state.currentPage = 1;
    filterThemeList(0); // 筛选切换时滚动回顶部
}
