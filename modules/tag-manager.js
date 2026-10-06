/**
 * modules/tag-manager.js
 * 酒馆主题管理器 - 标签核心管理模块
 * 负责分类标签的存储读取、数据清洗、多级父子继承、关键词动态关联及反向索引缓存。
 */

export const THEME_TAGS_KEY = 'themeManager_themeTags';

export function createTagManager(config = {}) {
    const {
        getValidInstalledThemeNames = () => new Set(),
        getAllParsedThemes = () => [],
    } = config;

    let _tagsCache = null;
    let _themeTagIndex = null;

    /**
     * 校验并规范化标签关联：子标签包含的主题自动同步向上递归提升至其所有父级/祖先标签 (N-Level 递归)
     */
    function sanitizeSubtagThemeAssociations(tags) {
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

    /**
     * 校验并规范化标签关联：
     * 1. 自动过滤剔除不存在于当前机器的非本域美化死链接 (O(N) 线性过滤)
     * 2. 基于当前机器实际存在的美化，针对含有关键词的标签做高性能预转换与动态匹配 (O(N) Set + Break)
     * 3. 子标签包含的主题自动同步提升至其父级一级标签
     */
    function sanitizeTagsWithValidThemes(tags) {
        if (!Array.isArray(tags)) return tags;
        const validThemeNames = getValidInstalledThemeNames();

        tags.forEach(t => {
            if (!Array.isArray(t.themes)) t.themes = [];
            if (!Array.isArray(t.keywords)) t.keywords = [];
        });

        if (validThemeNames && validThemeNames.size > 0) {
            // 1. 过滤不存在于本机的异地美化名称
            tags.forEach(t => {
                t.themes = t.themes.filter(themeName => validThemeNames.has(themeName));
            });

            // 2. 重新扫描本机美化，自动匹配已定义的关键词 (严格遵循本分组作用域限制，禁止跨分组扩散)
            const tagMap = new Map(tags.map(t => [t.id, t]));
            const allThemes = Array.from(validThemeNames);

            // 预先建立每个主题归属的顶层标签集合，防止无父标签的关键词跨分组抢夺已有主题
            const themeToL1TagsMap = new Map();
            tags.forEach(t => {
                if (!t.parentId) {
                    (t.themes || []).forEach(th => {
                        if (!themeToL1TagsMap.has(th)) themeToL1TagsMap.set(th, new Set());
                        themeToL1TagsMap.get(th).add(t.id);
                    });
                }
            });

            tags.forEach(tag => {
                if (!tag.keywords || tag.keywords.length === 0) return;
                const kwLCs = tag.keywords.filter(Boolean).map(kw => kw.toLowerCase());
                if (kwLCs.length === 0) return;

                const existingThemesSet = new Set(tag.themes);

                // 核心：确定本标签允许匹配的候选美化池（严格限定在本分组内）
                let candidateThemes = allThemes;
                const isGlobal = tag.globalKeywords === true;

                if (!isGlobal) {
                    if (tag.parentId) {
                        // 有直属父级标签：限定仅在直属父标签包含的美化内匹配（本分组映射）
                        const parentTag = tagMap.get(tag.parentId);
                        const parentThemesSet = new Set(parentTag && Array.isArray(parentTag.themes) ? parentTag.themes : []);
                        candidateThemes = allThemes.filter(th => parentThemesSet.has(th));
                    } else if (tag.scopeTagId) {
                        // 绑定了分组作用域的标签：限定仅在作用域标签的美化内匹配
                        const scopeTag = tagMap.get(tag.scopeTagId);
                        const scopeThemesSet = new Set(scopeTag && Array.isArray(scopeTag.themes) ? scopeTag.themes : []);
                        candidateThemes = allThemes.filter(th => scopeThemesSet.has(th));
                    } else {
                        // 一级独立标签：只能匹配本标签已有美化，或尚未归类到任何其他一级分组的美化，绝不抢夺其他分组的美化
                        candidateThemes = allThemes.filter(th => {
                            if (existingThemesSet.has(th)) return true;
                            const owners = themeToL1TagsMap.get(th);
                            return !owners || owners.size === 0 || (owners.size === 1 && owners.has(tag.id));
                        });
                    }
                }

                for (let i = 0; i < candidateThemes.length; i++) {
                    const themeName = candidateThemes[i];
                    if (existingThemesSet.has(themeName)) continue;
                    const nameLC = themeName.toLowerCase();
                    for (let j = 0; j < kwLCs.length; j++) {
                        if (nameLC.includes(kwLCs[j])) {
                            tag.themes.push(themeName);
                            existingThemesSet.add(themeName);
                            if (!tag.parentId) {
                                if (!themeToL1TagsMap.has(themeName)) themeToL1TagsMap.set(themeName, new Set());
                                themeToL1TagsMap.get(themeName).add(tag.id);
                            }
                            break;
                        }
                    }
                }
            });
        }

        return sanitizeSubtagThemeAssociations(tags);
    }

    /**
     * 标签数据缓存读取（避免每次调用都 JSON.parse）
     */
    function loadThemeTags() {
        if (_tagsCache) return _tagsCache;
        try {
            _tagsCache = JSON.parse(localStorage.getItem(THEME_TAGS_KEY)) || [];
        } catch (e) {
            _tagsCache = [];
        }
        sanitizeTagsWithValidThemes(_tagsCache);
        return _tagsCache;
    }

    /**
     * 构建 themeName -> [tagId] 的反向索引，避免每次调用都做 O(tags*themes) 扫描
     */
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

    function invalidateThemeTagIndex() {
        _themeTagIndex = null;
    }

    function getTagsForTheme(themeName, cachedTags) {
        if (_themeTagIndex) return _themeTagIndex.get(themeName) || [];
        const allTags = cachedTags || loadThemeTags();
        return allTags.filter(t => t.themes && t.themes.includes(themeName)).map(t => t.id);
    }

    function refreshAllParsedThemesTags() {
        const tags = loadThemeTags();
        buildThemeTagIndex(tags);
        const parsedThemes = getAllParsedThemes();
        if (parsedThemes && parsedThemes.length > 0) {
            parsedThemes.forEach(t => {
                t.tags = getTagsForTheme(t.value, tags);
            });
        }
    }

    function saveThemeTags(tags) {
        sanitizeTagsWithValidThemes(tags);
        _tagsCache = tags;
        localStorage.setItem(THEME_TAGS_KEY, JSON.stringify(tags));
        invalidateThemeTagIndex();
        refreshAllParsedThemesTags();
        document.dispatchEvent(new CustomEvent('themeManager:tagsChanged', { detail: tags }));
    }

    function invalidateTagsCache() {
        _tagsCache = null;
        invalidateThemeTagIndex();
    }

    return {
        loadThemeTags,
        saveThemeTags,
        invalidateTagsCache,
        buildThemeTagIndex,
        invalidateThemeTagIndex,
        getTagsForTheme,
        refreshAllParsedThemesTags,
        sanitizeTagsWithValidThemes,
        sanitizeSubtagThemeAssociations
    };
}
