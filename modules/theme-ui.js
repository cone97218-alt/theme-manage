/**
 * theme-ui.js
 * 主题卡片 UI 渲染、懒加载与性能列表更新
 */

import { state } from './state.js';
import { FAVORITES_KEY } from './constants.js';
import { loadThemeTags, buildThemeTagIndex, getTagsForTheme, isTagPillVisible, isThemeMatchingFilters } from './tags-core.js';
import { renderTagsUI } from './tags-ui.js';
import { isThemeMatchingSearch, sortThemes, getScrollParent, triggerSelectChange, deduplicateSelectOptions } from './utils.js';
import { getCachedThemes, getAllThemesFromAPI, invalidateThemesCache, apiRequest, showLoader, hideLoader } from './api.js';

let _themeItemTemplate = null;
let _activeThemeItem = null;

let filteredThemes = [];
let renderedCount = 0;
const CHUNK_SIZE = 35;
let scrollListenerAttached = false;

export function updateFavorites(newFavorites) {
    state.favorites = newFavorites;
    state.favoritesSet = new Set(newFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
}

export function isThemeListIdentical() {
    const originalSelect = document.querySelector('#themes');
    if (!originalSelect) return false;
    const options = Array.from(originalSelect.options).filter(opt => opt.value);
    if (state.allParsedThemes.length !== options.length) {
        return false;
    }
    for (let i = 0; i < state.allParsedThemes.length; i++) {
        if (state.allParsedThemes[i].value !== options[i].value) {
            return false;
        }
    }
    return true;
}

export function updateActiveState() {
    const originalSelect = document.querySelector('#themes');
    if (!originalSelect) return;
    const currentValue = originalSelect.value;
    if (_activeThemeItem) {
        _activeThemeItem.classList.remove('active');
    }
    const currentItem = state.themeItemMap.get(currentValue);
    if (currentItem) {
        currentItem.classList.add('active');
        _activeThemeItem = currentItem;
    } else {
        _activeThemeItem = null;
    }
}

export function applyKeywordMappings() {
    const cachedTags = loadThemeTags();
    if (!cachedTags || cachedTags.length === 0) return;
    const allThemes = state.allParsedThemes.map(t => t.value);

    let hasChanges = false;
    cachedTags.forEach(tag => {
        if (!tag.keywords || tag.keywords.length === 0) return;
        const kwLCs = tag.keywords.filter(Boolean).map(kw => kw.toLowerCase());
        if (kwLCs.length === 0) return;

        if (!Array.isArray(tag.themes)) tag.themes = [];
        const existingSet = new Set(tag.themes);

        for (let i = 0; i < allThemes.length; i++) {
            const themeName = allThemes[i];
            if (existingSet.has(themeName)) continue;
            const nameLC = themeName.toLowerCase();
            for (let j = 0; j < kwLCs.length; j++) {
                if (nameLC.includes(kwLCs[j])) {
                    tag.themes.push(themeName);
                    existingSet.add(themeName);
                    hasChanges = true;
                    break;
                }
            }
        }
    });

    if (hasChanges) {
        localStorage.setItem('theme_manager_tags', JSON.stringify(cachedTags));
        buildThemeTagIndex(cachedTags);
    }
}

function getThemeItemTemplate() {
    if (_themeItemTemplate) return _themeItemTemplate;
    const tpl = document.createElement('li');
    tpl.className = 'theme-item';
    tpl.innerHTML = `
        <div class="theme-item-name">
            <span class="theme-item-name-text"></span><span class="theme-usage-count" style="display:none;"></span>
        </div>
        <div class="theme-item-buttons">
            <button class="set-tag-btn" title="分类标签"><i class="fa-solid fa-tags"></i></button>
            <button class="link-bg-btn" title="关联背景图"><i class="fa-solid fa-link"></i></button>
            <button class="link-daynight-btn" title="绑定日夜美化"><i class="fa-solid fa-circle-half-stroke"></i></button>
            <button class="favorite-btn" title="收藏"><i class="fa-regular fa-star"></i></button>
            <button class="color-transfer-btn" title="提取配色" style="display:none;"><i class="fa-solid fa-palette"></i></button>
            <button class="rename-btn" title="重命名"><i class="fa-solid fa-pen"></i></button>
            <button class="delete-btn" title="删除"><i class="fa-solid fa-trash-can"></i></button>
        </div>`;
    _themeItemTemplate = tpl;
    return tpl;
}

export function createThemeItem(theme, tagsMap) {
    const item = getThemeItemTemplate().cloneNode(true);
    item.dataset.value = theme.value;

    const nameDiv = item.children[0];
    const nameSpan = nameDiv.children[0];
    const usageSpan = nameDiv.children[1];
    const buttonsDiv = item.children[1];

    const linkBgBtn = buttonsDiv.children[1];
    const linkDaynightBtn = buttonsDiv.children[2];
    const favoriteBtn = buttonsDiv.children[3];
    const colorTransferBtn = buttonsDiv.children[4];

    if (colorTransferBtn) {
        colorTransferBtn.style.display = state.enableColorTransfer ? 'inline-flex' : 'none';
    }

    nameSpan.textContent = theme.display;

    if (state.showUsageCount && state.usageCount[theme.value]) {
        usageSpan.textContent = state.usageCount[theme.value];
        usageSpan.style.display = '';
    } else {
        usageSpan.style.display = 'none';
    }

    if (theme.tags && theme.tags.length > 0 && state.tagPillDisplayMode !== 'none') {
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'theme-item-tags';
        theme.tags.forEach(tagId => {
            const tagObj = tagsMap.get(tagId);
            if (tagObj && isTagPillVisible(tagObj, theme.tags, state.tagPillDisplayMode, tagsMap)) {
                const pill = document.createElement('span');
                pill.className = 'theme-item-tag-pill';
                pill.textContent = tagObj.name;
                tagsDiv.appendChild(pill);
            }
        });
        if (tagsDiv.children.length > 0) {
            item.insertBefore(tagsDiv, buttonsDiv);
        }
    }

    const isFavorited = state.favoritesSet.has(theme.value);
    if (isFavorited) {
        favoriteBtn.children[0].className = 'fa-solid fa-star';
    }

    const isBound = !!state.themeBackgroundBindings[theme.value];
    if (isBound) {
        linkBgBtn.classList.add('linked');
        linkBgBtn.children[0].className = 'fa-solid fa-link-slash';
        linkBgBtn.title = '取消背景图关联';
    }

    if (linkDaynightBtn) {
        linkDaynightBtn.style.display = state.enableDayNightBinding ? 'inline-flex' : 'none';
    }

    if (state.isBatchEditMode && state.selectedForBatch.has(theme.value)) {
        item.classList.add('selected-for-batch');
    }

    return item;
}

export function renderNextChunk() {
    if (!state.contentWrapper) return;
    if (renderedCount >= filteredThemes.length) return;

    const cachedTags = loadThemeTags();
    const tagsMap = new Map(cachedTags.map(t => [t.id, t]));
    const list = state.contentWrapper.querySelector('.theme-list');
    if (!list) return;

    const fragment = document.createDocumentFragment();
    const nextIndex = Math.min(renderedCount + CHUNK_SIZE, filteredThemes.length);
    const originalSelect = document.querySelector('#themes');

    for (let i = renderedCount; i < nextIndex; i++) {
        const theme = filteredThemes[i];
        const item = createThemeItem(theme, tagsMap);
        state.themeItemMap.set(theme.value, item);

        if (originalSelect && theme.value === originalSelect.value) {
            item.classList.add('active');
            _activeThemeItem = item;
        }

        fragment.appendChild(item);
    }

    list.appendChild(fragment);
    renderedCount = nextIndex;
}

export function checkScrollLoad() {
    if (!state.contentWrapper) return;
    if (state.listMode !== 'scroll') return;
    if (renderedCount >= filteredThemes.length) return;

    const rect = state.contentWrapper.getBoundingClientRect();
    const scrollParent = getScrollParent(state.contentWrapper);
    let isNearBottom = false;

    if (scrollParent === window) {
        isNearBottom = rect.bottom - window.innerHeight < 150;
    } else {
        const parentRect = scrollParent.getBoundingClientRect();
        isNearBottom = rect.bottom - parentRect.bottom < 150;
    }

    if (isNearBottom) {
        renderNextChunk();
        setTimeout(checkScrollLoad, 100);
    }
}

export function initListScrollListener() {
    if (!state.contentWrapper || scrollListenerAttached) return;
    const scrollParent = getScrollParent(state.contentWrapper);
    if (scrollParent) {
        scrollParent.addEventListener('scroll', () => {
            if (state.listMode !== 'scroll') return;

            const rect = state.contentWrapper.getBoundingClientRect();
            let isNearBottom = false;

            if (scrollParent === window) {
                isNearBottom = rect.bottom - window.innerHeight < 150;
            } else {
                const parentRect = scrollParent.getBoundingClientRect();
                isNearBottom = rect.bottom - parentRect.bottom < 150;
            }

            if (isNearBottom) {
                renderNextChunk();
            }
        }, { passive: true });
        scrollListenerAttached = true;
    }
}

export function buildThemeListLazy(scrollTop) {
    if (!state.contentWrapper) return;
    const savedScroll = scrollTop !== undefined ? scrollTop : state.contentWrapper.scrollTop;
    const originalSelect = document.querySelector('#themes');

    state.themeItemMap.clear();
    _activeThemeItem = null;
    const oldList = state.contentWrapper.querySelector('.theme-list');
    if (oldList) oldList.remove();

    const list = document.createElement('ul');
    list.className = 'theme-list';
    state.contentWrapper.appendChild(list);

    const searchBox = document.querySelector('#theme-search-box');
    const rawSearch = searchBox ? searchBox.value : '';
    const cachedTags = loadThemeTags();
    const tagsMap = new Map(cachedTags.map(t => [t.id, t]));

    const matched = state.allParsedThemes.filter(theme => {
        const matchesTag = isThemeMatchingFilters(theme);
        const matchesSearch = isThemeMatchingSearch(theme, rawSearch, tagsMap);
        return matchesTag && matchesSearch;
    });

    filteredThemes = sortThemes(matched, state.sortBy);

    const paginationBars = document.querySelectorAll('.tm-pagination-bar');
    paginationBars.forEach(bar => {
        bar.style.display = state.listMode === 'page' ? 'flex' : 'none';
    });

    if (state.listMode === 'page') {
        const totalPages = Math.ceil(filteredThemes.length / state.pageSize) || 1;
        if (state.currentPage > totalPages) state.currentPage = totalPages;
        if (state.currentPage < 1) state.currentPage = 1;

        const totalPagesTexts = document.querySelectorAll('.tm-total-pages-text');
        const pageInputs = document.querySelectorAll('.tm-page-input');
        const firstPageBtns = document.querySelectorAll('.tm-first-page-btn');
        const prevPageBtns = document.querySelectorAll('.tm-prev-page-btn');
        const nextPageBtns = document.querySelectorAll('.tm-next-page-btn');
        const lastPageBtns = document.querySelectorAll('.tm-last-page-btn');

        totalPagesTexts.forEach(el => el.textContent = String(totalPages));
        pageInputs.forEach(el => {
            el.value = String(state.currentPage);
            el.max = String(totalPages);
        });

        firstPageBtns.forEach(btn => btn.disabled = state.currentPage <= 1);
        prevPageBtns.forEach(btn => btn.disabled = state.currentPage <= 1);
        nextPageBtns.forEach(btn => btn.disabled = state.currentPage >= totalPages);
        lastPageBtns.forEach(btn => btn.disabled = state.currentPage >= totalPages);

        const startIndex = (state.currentPage - 1) * state.pageSize;
        const endIndex = Math.min(startIndex + state.pageSize, filteredThemes.length);
        const pageThemes = filteredThemes.slice(startIndex, endIndex);

        const fragment = document.createDocumentFragment();

        pageThemes.forEach(theme => {
            const item = createThemeItem(theme, tagsMap);
            state.themeItemMap.set(theme.value, item);

            if (originalSelect && theme.value === originalSelect.value) {
                item.classList.add('active');
                _activeThemeItem = item;
            }

            fragment.appendChild(item);
        });

        list.appendChild(fragment);
        state.contentWrapper.scrollTop = savedScroll;
        updateActiveState();
    } else {
        renderedCount = 0;
        renderNextChunk();

        state.contentWrapper.scrollTop = savedScroll;
        updateActiveState();

        setTimeout(checkScrollLoad, 100);
        initListScrollListener();
    }
}

// 注册给 state 以支持 search-filter / tags-ui 模块的反向引用
state.buildThemeListLazyFn = buildThemeListLazy;

export async function buildThemeUI() {
    if (!state.contentWrapper) return;
    const originalSelect = document.querySelector('#themes');
    if (originalSelect) deduplicateSelectOptions(originalSelect);

    const scrollTop = state.contentWrapper.scrollTop;
    state.contentWrapper.innerHTML = '正在加载主题...';

    try {
        state.allThemeObjects = await getCachedThemes();
        state.allThemeObjectsMap.clear();
        state.allThemeObjects.forEach(t => {
            const name = t.name || t.value;
            if (name) state.allThemeObjectsMap.set(name, t);
        });

        const serverThemeNames = new Set(Array.from(state.allThemeObjectsMap.keys()));
        if (originalSelect && originalSelect.options) {
            Array.from(originalSelect.options).forEach(opt => {
                if (opt.value && !serverThemeNames.has(opt.value)) {
                    console.log(`[Theme Manager] 🧹 清理原生下拉框中的死选项: "${opt.value}"`);
                    opt.remove();
                }
            });
        }

        if (state.allParsedThemes.length > 0 && isThemeListIdentical() && state.themeItemMap.size > 0) {
            state.contentWrapper.innerHTML = '';
            updateActiveState();
            return;
        }

        state.contentWrapper.innerHTML = '';

        const cachedTags = loadThemeTags();
        buildThemeTagIndex(cachedTags);

        state.allParsedThemes = state.allThemeObjects.map(t => {
            const themeName = t.name || t.value;
            if (!themeName) return null;
            return { value: themeName, display: themeName, tags: [], mtime: t.mtime || 0 };
        }).filter(Boolean);

        state.allParsedThemesMap.clear();
        state.allParsedThemes.forEach(t => state.allParsedThemesMap.set(t.value, t));

        applyKeywordMappings();

        const updatedTags = loadThemeTags();
        buildThemeTagIndex(updatedTags);
        state.allParsedThemes.forEach(t => {
            t.tags = getTagsForTheme(t.value, updatedTags);
        });

        renderTagsUI(updatedTags);
        buildThemeListLazy(scrollTop);

    } catch (err) {
        state.contentWrapper.innerHTML = '加载主题失败，请检查浏览器控制台获取更多信息。';
        console.error(err);
    }
}

export async function hardResyncThemes(showToast = true) {
    console.log('[Theme Manager] 🔄 开始重新对照磁盘并全量同步...');
    showLoader();
    state._suspendObserver = true;

    try {
        invalidateThemesCache();
        let freshThemes = await getAllThemesFromAPI();

        let fixedCount = 0;
        const usedNames = new Set();
        for (let i = 0; i < freshThemes.length; i++) {
            const t = freshThemes[i];
            if (!t || typeof t !== 'object') continue;
            let origName = (t.name || t.value || '未命名主题').trim();

            if (usedNames.has(origName)) {
                let suffixIndex = 2;
                let newUniqueName = `${origName} (${suffixIndex})`;
                while (usedNames.has(newUniqueName)) {
                    suffixIndex++;
                    newUniqueName = `${origName} (${suffixIndex})`;
                }
                console.warn(`[Theme Manager Resync] ⚠️ 发现同名主题 "${origName}"，自动重命名对齐为 "${newUniqueName}"`);
                t.name = newUniqueName;
                t.value = newUniqueName;
                origName = newUniqueName;
                fixedCount++;
            }
            usedNames.add(origName);

            try {
                const { mtime: _m, ...cleanObj } = t;
                cleanObj.name = origName;
                await apiRequest('themes/save', 'POST', cleanObj, true);
            } catch (e) {
                console.warn('[Theme Manager Resync] 重新规范落盘提示:', e);
            }
        }

        if (fixedCount > 0) {
            invalidateThemesCache();
            freshThemes = await getAllThemesFromAPI();
        }

        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const stCtx = SillyTavern.getContext();
            if (stCtx) stCtx.themes = freshThemes;
        }
        if (typeof power_user !== 'undefined') {
            power_user.themes = freshThemes;
        }

        const originalSelect = document.querySelector('#themes');
        if (originalSelect) {
            const currentVal = originalSelect.value;
            originalSelect.innerHTML = '';
            const existingNames = new Set();

            freshThemes.forEach(t => {
                const name = t.name || t.value;
                if (!name || existingNames.has(name)) return;
                existingNames.add(name);

                const option = document.createElement('option');
                option.value = name;
                option.innerText = name;
                originalSelect.appendChild(option);
            });

            if (currentVal && existingNames.has(currentVal)) {
                originalSelect.value = currentVal;
            } else if (freshThemes.length > 0) {
                originalSelect.value = freshThemes[0].name || freshThemes[0].value;
                triggerSelectChange(originalSelect);
            }
        }

        const validThemeNames = new Set(freshThemes.map(t => t.name || t.value).filter(Boolean));
        state.favorites = state.favorites.filter(f => validThemeNames.has(f));
        updateFavorites(state.favorites);

        let tagsToUpdate = loadThemeTags();
        let tagsChanged = false;
        tagsToUpdate.forEach(tag => {
            if (tag.themes && Array.isArray(tag.themes)) {
                const beforeLen = tag.themes.length;
                tag.themes = tag.themes.filter(t => validThemeNames.has(t));
                if (tag.themes.length !== beforeLen) tagsChanged = true;
            }
        });
        if (tagsChanged) localStorage.setItem('theme_manager_tags', JSON.stringify(tagsToUpdate));

        state.allParsedThemes = [];
        state.allParsedThemesMap.clear();
        state.themeItemMap.clear();
        if (state.contentWrapper) state.contentWrapper.innerHTML = '';

        await buildThemeUI();

        if (showToast) {
            let msg = `已成功与磁盘对照同步！共读取并强制对齐 ${freshThemes.length} 个美化主题。`;
            if (fixedCount > 0) msg += `（自动修复并重命名了 ${fixedCount} 个命名冲突）`;
            toastr.success(msg);
        }
    } catch (err) {
        console.error('[Theme Manager] 重新对照磁盘失败:', err);
        toastr.error('对照磁盘发生异常，请查看控制台: ' + (err.message || err));
    } finally {
        hideLoader();
        setTimeout(() => { state._suspendObserver = false; }, 100);
    }
}
