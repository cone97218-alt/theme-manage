/**
 * state.js
 * 所有模块共享的可变运行时状态对象。
 * 各模块通过导入此对象并直接修改其属性来共享状态，
 * 避免了跨模块参数传递的复杂性。
 *
 * 初始化流程：
 *   1. script.js 在 SillyTavern 上下文就绪后调用 initState(ctx)
 *   2. 各子模块直接访问 state.xxx 和 ctx.xxx
 */

import {
    FAVORITES_KEY, ACTIVE_TAGS_KEY, LIST_MODE_KEY, PAGE_SIZE_KEY,
    SORT_SELECT_KEY, TAG_FILTER_MODE_KEY, USAGE_COUNT_KEY,
    SHOW_USAGE_COUNT_KEY, ENABLE_AVATAR_HELPER_KEY, ENABLE_COLOR_TRANSFER_KEY,
    ENABLE_DAYNIGHT_BINDING_KEY, ENABLE_REPLACE_AVATAR_BTN_KEY,
    TWO_LINE_LAYOUT_KEY, HIDE_TAG_PILLS_KEY, TAG_PILL_MODE_KEY,
    AUTO_THEME_KEY, THEME_BACKGROUND_BINDINGS_KEY, ENABLE_SUBTAGS_KEY,
    ACTIVE_TAG_PATH_KEY
} from './constants.js';

// ─── SillyTavern 上下文（由 initCtx 注入）──────────────────────────────────
/** @type {{ getRequestHeaders: Function, showLoader: Function, hideLoader: Function, callGenericPopup: Function, eventSource: any, eventTypes: any }} */
export const ctx = {};

/**
 * 初始化 SillyTavern 上下文到 ctx 对象
 * @param {object} sillyTavernCtx SillyTavern.getContext() 解构结果
 */
export function initCtx(sillyTavernCtx) {
    Object.assign(ctx, sillyTavernCtx);
}

// ─── 共享可变状态 ──────────────────────────────────────────────────────────
function _parseUsageCount() {
    try {
        const parsed = JSON.parse(localStorage.getItem(USAGE_COUNT_KEY));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) { console.error('[Theme Manager] Failed to parse usageCount:', e); }
    return {};
}

function _parseActiveTagFilters() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ACTIVE_TAGS_KEY));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.keys(parsed).filter(k => parsed[k]);
        if (typeof parsed === 'string') return [parsed];
    } catch (e) { console.error('[Theme Manager] Failed to parse activeTagFilters:', e); }
    return [];
}

function _parseActiveTagPath() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ACTIVE_TAG_PATH_KEY));
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
    return [];
}

export const state = {
    // ── UI 布局 ──
    listMode:             localStorage.getItem(LIST_MODE_KEY) || 'scroll',
    pageSize:             parseInt(localStorage.getItem(PAGE_SIZE_KEY)) || 50,
    sortBy:               localStorage.getItem(SORT_SELECT_KEY) || 'name-asc',
    isTwoLineLayout:      localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true',
    hideTagPills:         localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true',
    tagPillDisplayMode:   localStorage.getItem(TAG_PILL_MODE_KEY) || (localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true' ? 'none' : 'all'),
    currentPage:          1,

    // ── 功能开关 ──
    showUsageCount:       localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true',
    enableAvatarHelper:   localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) !== 'false',
    enableColorTransfer:  localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true',
    enableReplaceAvatarBtn: localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) !== 'false',
    enableDayNightBinding: localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false',

    // ── 主题数据 ──
    allParsedThemes:      /** @type {Array<{value:string,display:string,tags:string[]}>} */ ([]),
    allParsedThemesMap:   new Map(),   // themeName -> theme object for O(1) lookup
    allThemeObjects:      [],          // 包含完整颜色/CSS 字段的原始主题对象数组
    allThemeObjectsMap:   new Map(),   // themeName -> themeObject O(1) cache
    stKnownThemes:        new Set(),   // SillyTavern 原生 #themes select 已知名称集合
    refreshNeeded:        false,

    // ── 收藏 ──
    favorites:            JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [],
    favoritesSet:         new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []),

    // ── 使用次数 ──
    usageCount:           _parseUsageCount(),

    // ── 标签筛选 ──
    tagFilterMode:        localStorage.getItem(TAG_FILTER_MODE_KEY) || 'or',
    activeTagFilters:     new Set(_parseActiveTagFilters()),
    activeLevel1TagId:    null,
    activeTagAncestryPath: _parseActiveTagPath(),   // N-级祖先路径数组 [l1Id, l2Id, ...]
    renderAllAncestorSubtagRows: false,

    // ── 背景绑定 ──
    themeBackgroundBindings: JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {},

    // ── 自动主题设置 ──
    autoThemeSettings: (() => {
        try {
            return JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {};
        } catch (e) { return {}; }
    })(),

    // ── 日夜配对 ──
    themeDayNightPairs: [],

    // ── 批量编辑 ──
    isBatchEditMode:      false,
    selectedForBatch:     new Set(),
    lastClickedThemeName: null,

    // ── 绑定模式 ──
    isBindingMode:        false,
    themeNameToBind:      null,

    // ── 编辑中的标签主题 ──
    editingThemeForTags:  null,

    // ── 触控 ──
    touchTimer:           null,
    preventNextClick:     false,
    touchStartX:          0,
    touchStartY:          0,

    // ── 内部缓存（带前缀 _ 表示私有） ──
    _suspendObserver:     false,
    _buildThemeUITimer:   null,
    _themesCache:         null,
    _themesCacheTime:     0,
    _tagsCache:           null,
    _themeTagIndex:       null,
    _cachedValidThemeNames: null,
    _uiControlsCache:     null,

    // ── DOM 引用（由 init 注入） ──
    originalSelect:       null,
    managerPanel:         null,
    contentWrapper:       null,
    searchBox:            null,
};
