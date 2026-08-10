import { state } from './state.js';
import { THEME_TAGS_KEY, ACTIVE_TAGS_KEY, TAG_FILTER_MODE_KEY, ENABLE_SUBTAGS_KEY } from './constants.js';

// ─── 有效主题名称缓存 ────────────────────────────────────────────────────────────

function invalidateValidThemeNamesCache() {
    state._cachedValidThemeNames = null;
}

export function getValidInstalledThemeNames() {
    if (state._cachedValidThemeNames) return state._cachedValidThemeNames;
    const names = new Set();
    if (typeof state.stKnownThemes !== 'undefined' && state.stKnownThemes && state.stKnownThemes.size > 0) {
        state.stKnownThemes.forEach(name => { if (name) names.add(name); });
    }
    if (typeof state.allParsedThemes !== 'undefined' && state.allParsedThemes && state.allParsedThemes.length > 0) {
        state.allParsedThemes.forEach(t => { if (t && t.value) names.add(t.value); });
    }
    const select = document.querySelector('#themes');
    if (select && select.options) {
        for (let i = 0; i < select.options.length; i++) {
            const val = select.options[i].value;
            if (val) names.add(val);
        }
    }
    state._cachedValidThemeNames = names;
    return names;
}

// 校验并规范化标签关联：
// 1. 自动过滤剔除不存在于当前机器的非本域美化死链接 (O(N) 线性过滤)
// 2. 基于当前机器实际存在的美化，针对含有关键词的标签做高性能预转换与动态匹配 (O(N) Set + Break)
// 3. 子标签包含的主题自动同步提升至其父级一级标签
export function sanitizeTagsWithValidThemes(tags) {
    if (!Array.isArray(tags)) return tags;
    const validThemeNames = getValidInstalledThemeNames();

    tags.forEach(t => {
        if (!Array.isArray(t.themes)) t.themes = [];
        if (!Array.isArray(t.keywords)) t.keywords = [];
    });

    if (validThemeNames.size > 0) {
        // 1. 过滤不存在于本机的异地美化名称
        tags.forEach(t => {
            t.themes = t.themes.filter(themeName => validThemeNames.has(themeName));
        });

        // 2. 重新扫描本机美化，自动匹配已定义的关键词 (极致循环优化)
        const allThemes = Array.from(validThemeNames);
        tags.forEach(tag => {
            if (!tag.keywords || tag.keywords.length === 0) return;
            const kwLCs = tag.keywords.filter(Boolean).map(kw => kw.toLowerCase());
            if (kwLCs.length === 0) return;

            const existingThemesSet = new Set(tag.themes);
            for (let i = 0; i < allThemes.length; i++) {
                const themeName = allThemes[i];
                if (existingThemesSet.has(themeName)) continue;
                const nameLC = themeName.toLowerCase();
                for (let j = 0; j < kwLCs.length; j++) {
                    if (nameLC.includes(kwLCs[j])) {
                        tag.themes.push(themeName);
                        existingThemesSet.add(themeName);
                        break;
                    }
                }
            }
        });
    }

    return sanitizeSubtagThemeAssociations(tags);
}

// 校验并规范化标签关联：子标签包含的主题自动同步向上递归提升至其所有父级/祖先标签 (N-Level 递归)
export function sanitizeSubtagThemeAssociations(tags) {
    if (!Array.isArray(tags)) return tags;
    const tagMap = new Map(tags.map(t => [t.id, t]));

    // 确保数组初始化完整
    tags.forEach(t => {
        if (!Array.isArray(t.themes)) t.themes = [];
        if (!Array.isArray(t.keywords)) t.keywords = [];
    });

    // 自动向上递归同步 (Recursive Auto-promote)：多级子标签拥有的主题自动并入其所有父级/祖先标签
    tags.forEach(t => {
        let currentParentId = t.parentId;
        const visited = new Set();
        while (currentParentId && !visited.has(currentParentId)) {
            visited.add(currentParentId);
            const parent = tagMap.get(currentParentId);
            if (parent) {
                if (!Array.isArray(parent.themes)) parent.themes = [];
                t.themes.forEach(themeName => {
                    if (!parent.themes.includes(themeName)) {
                        parent.themes.push(themeName);
                    }
                });
                currentParentId = parent.parentId;
            } else {
                break;
            }
        }
    });

    return tags;
}

// 标签数据缓存（避免每次调用都 JSON.parse）
export function loadThemeTags() {
    if (state._tagsCache) return state._tagsCache;
    state._tagsCache = JSON.parse(localStorage.getItem(THEME_TAGS_KEY)) || [];
    sanitizeTagsWithValidThemes(state._tagsCache);
    return state._tagsCache;
}

export function refreshAllParsedThemesTags() {
    const tags = loadThemeTags();
    buildThemeTagIndex(tags);
    if (state.allParsedThemes && state.allParsedThemes.length > 0) {
        state.allParsedThemes.forEach(t => {
            t.tags = getTagsForTheme(t.value, tags);
        });
    }
}

export function saveThemeTags(tags) {
    sanitizeTagsWithValidThemes(tags);
    state._tagsCache = tags; // 更新缓存
    localStorage.setItem(THEME_TAGS_KEY, JSON.stringify(tags));
    invalidateThemeTagIndex(); // 标签数据变了，反向索引也要失效
    refreshAllParsedThemesTags(); // 实时重刷全量 parsedThemes 的标签关联
    document.dispatchEvent(new CustomEvent('themeManager:tagsChanged', { detail: tags }));
}

export function invalidateTagsCache() {
    state._tagsCache = null;
    invalidateThemeTagIndex();
}

// 构建 themeName -> [tagId] 的反向索引，避免每次调用都做 O(tags*themes) 扫描
export function buildThemeTagIndex(tags) {
    const index = new Map();
    tags.forEach(t => {
        if (t.themes) {
            t.themes.forEach(themeName => {
                if (!index.has(themeName)) index.set(themeName, []);
                index.get(themeName).push(t.id);
            });
        }
    });
    state._themeTagIndex = index;
    return index;
}

export function invalidateThemeTagIndex() { state._themeTagIndex = null; }

export function getTagsForTheme(themeName, cachedTags) {
    if (state._themeTagIndex) return state._themeTagIndex.get(themeName) || [];
    const allTags = cachedTags || loadThemeTags();
    return allTags.filter(t => t.themes && t.themes.includes(themeName)).map(t => t.id);
}

// ─── 子标签工具 ──────────────────────────────────────────────────────────────────

export function getAllDescendantTagIds(tagId, tags) {
    if (!isSubtagsEnabled()) return [tagId];
    const result = [tagId];
    const queue = [tagId];
    while (queue.length > 0) {
        const currId = queue.shift();
        for (let i = 0; i < tags.length; i++) {
            if (tags[i].parentId === currId) {
                result.push(tags[i].id);
                queue.push(tags[i].id);
            }
        }
    }
    return result;
}

// 判断主题是否匹配当前标签筛选 (N 级多层级支持)
export function isThemeMatchingFilters(theme) {
    if (state.activeTagFilters.size === 0) return true;
    const tags = loadThemeTags();
    const themeTags = (theme && theme.tags && theme.tags.length > 0)
        ? theme.tags
        : getTagsForTheme(theme.value, tags);

    if (state.tagFilterMode === 'and') {
        // AND 模式：主题必须同时满足所有已选标签
        for (const tagId of state.activeTagFilters) {
            let matched = false;
            if (tagId === '__FAVORITES__' && state.favoritesSet.has(theme.value)) matched = true;
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
                const targetIds = getAllDescendantTagIds(tagId, tags);
                if (themeTags.some(tId => targetIds.includes(tId))) matched = true;
            }
            if (!matched) return false;
        }
        return true;
    }
    // OR 模式（默认）：匹配任意标签即可
    for (const tagId of state.activeTagFilters) {
        if (tagId === '__FAVORITES__' && state.favoritesSet.has(theme.value)) return true;
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
            const targetIds = getAllDescendantTagIds(tagId, tags);
            if (themeTags.some(tId => targetIds.includes(tId))) return true;
        }
    }
    return false;
}

// ─── 标签药丸显示判断 ─────────────────────────────────────────────────────────────

export function isTagPillVisible(tagObj, themeTagIds, tagMode, tagsById) {
    if (tagMode === 'none') return false;
    const isSub = !!(tagObj.parentId && tagsById.has(tagObj.parentId));
    if (tagMode === 'l1') return !isSub;
    if (tagMode === 'l2' || tagMode === 'sub') return isSub;
    if (tagMode === 'leaf') {
        return !themeTagIds.some(otherId => {
            if (otherId === tagObj.id) return false;
            const otherTag = tagsById.get(otherId);
            return otherTag && otherTag.parentId === tagObj.id;
        });
    }
    return true;
}

// ─── 内部工具（未导出） ───────────────────────────────────────────────────────────

function isSubtagsEnabled() {
    return localStorage.getItem(ENABLE_SUBTAGS_KEY) === 'true';
}
