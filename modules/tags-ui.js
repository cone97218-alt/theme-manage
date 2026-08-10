/**
 * tags-ui.js
 * 标签芯片 UI 渲染、多级树面包屑与切换状态
 */

import { state } from './state.js';
import { ACTIVE_TAGS_KEY, ACTIVE_TAG_PATH_KEY, TAG_FILTER_MODE_KEY, ENABLE_SUBTAGS_KEY } from './constants.js';
import { loadThemeTags, buildThemeTagIndex, getTagsForTheme, getAllDescendantTagIds, isTagPillVisible } from './tags-core.js';
import { handleTagFilterChange, filterThemeList } from './search-filter.js';
import { escapeHtml } from './utils.js';

export function isSubtagsEnabled() {
    return localStorage.getItem(ENABLE_SUBTAGS_KEY) !== 'false';
}

/**
 * 快速更新标签芯片的 active 状态（纯 CSS 切换，不重建 DOM）
 */
export function updateTagChipsActiveState() {
    if (!state.managerPanel) return;
    const container = state.managerPanel.querySelector('#theme-tags-container');
    const subtagsContainers = state.managerPanel.querySelectorAll('.theme-subtags-row');
    const cachedTags = loadThemeTags();
    if (!container) return;

    container.querySelectorAll('.theme-tag-chip').forEach(chip => {
        const tagId = chip.dataset.tagId;
        if (tagId) {
            const isL1 = chip.classList.contains('level1');
            if (isL1) {
                const childIds = isSubtagsEnabled() ? cachedTags.filter(t => t.parentId === tagId).map(t => t.id) : [];
                const hasActiveChild = childIds.some(cId => state.activeTagFilters.has(cId));
                const hasSubUncat = state.activeTagFilters.has(`__SUB_UNCATEGORIZED__:${tagId}`);
                const isL1Active = state.activeLevel1TagId === tagId;
                const isDirectActive = state.activeTagFilters.has(tagId);

                chip.classList.toggle('active', isDirectActive || isL1Active || hasActiveChild || hasSubUncat);
            } else {
                chip.classList.toggle('active', state.activeTagFilters.has(tagId));
            }
        } else if (chip.dataset.special === 'favorites') {
            chip.classList.toggle('active', state.activeTagFilters.has('__FAVORITES__'));
        } else if (chip.dataset.special === 'uncategorized') {
            chip.classList.toggle('active', state.activeTagFilters.has('__UNCATEGORIZED__'));
        } else if (chip.dataset.special === 'all') {
            chip.classList.toggle('active', state.activeTagFilters.size === 0);
        }
    });

    subtagsContainers.forEach(subtagsContainer => {
        subtagsContainer.querySelectorAll('.theme-tag-chip').forEach(chip => {
            const tagId = chip.dataset.tagId;
            if (tagId) {
                chip.classList.toggle('active', state.activeTagFilters.has(tagId));
            } else if (chip.dataset.special === 'sub-uncategorized') {
                const subUncatKey = `__SUB_UNCATEGORIZED__:${state.activeLevel1TagId}`;
                chip.classList.toggle('active', state.activeTagFilters.has(subUncatKey));
            }
        });
    });

    const modeBtn = container.querySelector('.tm-filter-mode-btn');
    if (modeBtn) {
        modeBtn.title = state.tagFilterMode === 'and' ? '当前：AND 交叉筛选（点击切换为 OR 模式）' : '当前：OR 任意筛选（点击切换为 AND 模式）';
        modeBtn.innerHTML = state.tagFilterMode === 'and'
            ? '<i class="fa-solid fa-layer-group"></i>'
            : '<i class="fa-solid fa-circle-nodes"></i>';
        modeBtn.classList.toggle('active', state.tagFilterMode === 'and');
    }
}

// 注册回调给 state 供其他模块反向引用（解耦循环依赖）
state.updateTagChipsActiveStateFn = updateTagChipsActiveState;

/**
 * 轻量级更新标签和界面，不重建 DOM
 * @param {Array<string>|null} changedThemeNames 若指定则只更新这些主题的标签 pill
 */
export function softRefreshUI(changedThemeNames = null) {
    const cachedTags = loadThemeTags();
    buildThemeTagIndex(cachedTags);

    if (Array.isArray(changedThemeNames) && changedThemeNames.length === 0) {
        renderTagsUI(cachedTags);
        updateTagChipsActiveState();
        return;
    }

    const tagsById = new Map(cachedTags.map(t => [t.id, t]));

    if (changedThemeNames) {
        changedThemeNames.forEach(name => {
            const theme = state.allParsedThemesMap.get(name);
            if (theme) theme.tags = getTagsForTheme(name, cachedTags);
        });
    } else {
        state.allParsedThemes.forEach(theme => {
            theme.tags = getTagsForTheme(theme.value, cachedTags);
        });
    }

    renderTagsUI(cachedTags);
    updateTagChipsActiveState();

    if (typeof state.updateThemeItemTagsFn === 'function') {
        state.updateThemeItemTagsFn(changedThemeNames, tagsById);
    }

    filterThemeList();
}

state.softRefreshUIFn = softRefreshUI;

export function saveActiveTagAncestryPath() {
    localStorage.setItem(ACTIVE_TAG_PATH_KEY, JSON.stringify(state.activeTagAncestryPath));
}

export function syncActiveAncestryPath(allTags) {
    if (!isSubtagsEnabled() || state.activeTagFilters.size === 0) {
        state.activeTagAncestryPath = [];
        return;
    }
    const validPath = [];
    for (const tagId of state.activeTagAncestryPath) {
        const tag = allTags.find(t => t.id === tagId);
        if (tag) {
            validPath.push(tag.id);
        } else {
            break;
        }
    }
    state.activeTagAncestryPath = validPath;

    if (state.activeTagAncestryPath.length === 0 && state.activeTagFilters.size > 0) {
        for (const filterId of state.activeTagFilters) {
            let currId = typeof filterId === 'string' && filterId.startsWith('__SUB_UNCATEGORIZED__:')
                ? filterId.split(':')[1]
                : filterId;

            const ancestors = [];
            const visited = new Set();
            while (currId && !visited.has(currId)) {
                visited.add(currId);
                const tag = allTags.find(t => t.id === currId);
                if (tag) {
                    ancestors.unshift(tag.id);
                    currId = tag.parentId;
                } else {
                    break;
                }
            }
            if (ancestors.length > 0) {
                state.activeTagAncestryPath = ancestors;
                saveActiveTagAncestryPath();
                break;
            }
        }
    }
}

/**
 * 渲染全量标签过滤栏与多级树面包屑
 * @param {Array} [cachedTags]
 */
export function renderTagsUI(cachedTags) {
    if (!state.managerPanel) return;
    const container = state.managerPanel.querySelector('#theme-tags-container');
    if (!container) return;
    container.innerHTML = '';

    const oldSubtags = state.managerPanel.querySelectorAll('.theme-subtags-row, .tm-breadcrumb-bar');
    oldSubtags.forEach(el => el.remove());

    const subtagsEnabled = isSubtagsEnabled();

    const modeBtn = document.createElement('div');
    modeBtn.className = `tm-filter-mode-btn${state.tagFilterMode === 'and' ? ' active' : ''}`;
    modeBtn.title = state.tagFilterMode === 'and'
        ? '当前：AND 交叉模式（支持跨排多选交集，点击切换为 OR 同层单选）'
        : '当前：OR 单选模式（每一层级同时只能选中一个，点击切换为 AND 交叉多选）';
    modeBtn.innerHTML = state.tagFilterMode === 'and'
        ? '<i class="fa-solid fa-layer-group"></i>'
        : '<i class="fa-solid fa-circle-nodes"></i>';
    modeBtn.addEventListener('click', () => {
        state.tagFilterMode = state.tagFilterMode === 'or' ? 'and' : 'or';
        localStorage.setItem(TAG_FILTER_MODE_KEY, state.tagFilterMode);
        if (state.tagFilterMode === 'or') {
            let activeTagToKeep = null;
            if (state.activeTagAncestryPath.length > 0) {
                activeTagToKeep = state.activeTagAncestryPath[state.activeTagAncestryPath.length - 1];
            } else if (state.activeTagFilters.size > 0) {
                activeTagToKeep = Array.from(state.activeTagFilters)[0];
            }
            state.activeTagFilters.clear();
            if (activeTagToKeep) state.activeTagFilters.add(activeTagToKeep);
            toastr.info('已切换为 OR 模式 (每一层级仅限单选一个标签)');
        } else {
            toastr.info('已切换为 AND 模式 (跨层多选，多标签交集筛选)');
        }
        handleTagFilterChange();
        renderTagsUI();
    });
    container.appendChild(modeBtn);

    const allChip = document.createElement('div');
    allChip.className = `theme-tag-chip ${state.activeTagFilters.size === 0 && state.activeTagAncestryPath.length === 0 ? 'active' : ''}`;
    allChip.dataset.special = 'all';
    allChip.innerHTML = `全部`;
    allChip.addEventListener('click', () => {
        state.activeLevel1TagId = null;
        state.activeTagAncestryPath = [];
        saveActiveTagAncestryPath();
        state.activeTagFilters.clear();
        handleTagFilterChange();
        renderTagsUI();
    });
    container.appendChild(allChip);

    const favChip = document.createElement('div');
    favChip.className = `theme-tag-chip ${state.activeTagFilters.has('__FAVORITES__') ? 'active' : ''}`;
    favChip.dataset.special = 'favorites';
    favChip.innerHTML = `收藏`;
    favChip.addEventListener('click', () => {
        state.activeLevel1TagId = null;
        state.activeTagAncestryPath = [];
        saveActiveTagAncestryPath();
        if (state.activeTagFilters.has('__FAVORITES__')) {
            state.activeTagFilters.delete('__FAVORITES__');
        } else {
            if (state.tagFilterMode === 'or') state.activeTagFilters.clear();
            state.activeTagFilters.add('__FAVORITES__');
        }
        handleTagFilterChange();
        renderTagsUI();
    });
    container.appendChild(favChip);

    const uncatChip = document.createElement('div');
    uncatChip.className = `theme-tag-chip ${state.activeTagFilters.has('__UNCATEGORIZED__') ? 'active' : ''}`;
    uncatChip.dataset.special = 'uncategorized';
    uncatChip.innerHTML = `未分类`;
    uncatChip.addEventListener('click', () => {
        state.activeLevel1TagId = null;
        state.activeTagAncestryPath = [];
        saveActiveTagAncestryPath();
        if (state.activeTagFilters.has('__UNCATEGORIZED__')) {
            state.activeTagFilters.delete('__UNCATEGORIZED__');
        } else {
            if (state.tagFilterMode === 'or') state.activeTagFilters.clear();
            state.activeTagFilters.add('__UNCATEGORIZED__');
        }
        handleTagFilterChange();
        renderTagsUI();
    });
    container.appendChild(uncatChip);

    const tags = cachedTags || loadThemeTags();

    if (!subtagsEnabled) {
        state.activeTagAncestryPath = [];
    } else {
        syncActiveAncestryPath(tags);
    }

    if (tags.length > 0) {
        const rootTags = subtagsEnabled
            ? tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId))
            : tags;

        rootTags.forEach(tag => {
            const chip = document.createElement('div');
            const descendantIds = subtagsEnabled ? getAllDescendantTagIds(tag.id, tags) : [tag.id];
            const isPathActive = state.activeTagAncestryPath.length > 0 && state.activeTagAncestryPath[0] === tag.id;
            const isDirectActive = state.activeTagFilters.has(tag.id);
            const hasActiveChild = descendantIds.some(dId => state.activeTagFilters.has(dId));

            chip.className = `theme-tag-chip level1 ${isDirectActive || isPathActive || hasActiveChild ? 'active' : ''}`;
            chip.dataset.tagId = tag.id;

            let count = tag.themes ? tag.themes.length : 0;
            if (subtagsEnabled) {
                const allThemeNames = new Set();
                descendantIds.forEach(dId => {
                    const dTag = tags.find(t => t.id === dId);
                    if (dTag && dTag.themes) {
                        dTag.themes.forEach(th => allThemeNames.add(th));
                    }
                });
                count = allThemeNames.size;
            }

            chip.innerHTML = `${escapeHtml(tag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${count})</span>`;
            chip.addEventListener('click', () => {
                if (subtagsEnabled) {
                    if (state.activeTagAncestryPath[0] === tag.id) {
                        if (state.tagFilterMode === 'or' && state.activeTagFilters.has(tag.id) && state.activeTagAncestryPath.length === 1) {
                            state.activeTagAncestryPath = [];
                            state.activeTagFilters.clear();
                        } else {
                            state.activeTagAncestryPath = [tag.id];
                            if (state.tagFilterMode === 'or') {
                                state.activeTagFilters.clear();
                                state.activeTagFilters.add(tag.id);
                            } else {
                                state.activeTagFilters.add(tag.id);
                            }
                        }
                    } else {
                        state.activeTagAncestryPath = [tag.id];
                        if (state.tagFilterMode === 'or') state.activeTagFilters.clear();
                        state.activeTagFilters.add(tag.id);
                    }
                    saveActiveTagAncestryPath();
                } else {
                    if (state.activeTagFilters.has(tag.id)) {
                        state.activeTagFilters.delete(tag.id);
                    } else {
                        if (state.tagFilterMode === 'or') state.activeTagFilters.clear();
                        state.activeTagFilters.add(tag.id);
                    }
                }
                handleTagFilterChange();
                renderTagsUI();
            });
            container.appendChild(chip);
        });

        if (subtagsEnabled && state.activeTagAncestryPath.length > 0) {
            let lastRowRef = container;

            const breadcrumbBar = document.createElement('div');
            breadcrumbBar.className = 'tm-breadcrumb-bar';

            const rootCrumb = document.createElement('span');
            rootCrumb.className = 'tm-breadcrumb-item';
            rootCrumb.innerHTML = `<i class="fa-solid fa-house" style="font-size:10px;"></i> 主分类`;
            rootCrumb.addEventListener('click', () => {
                state.activeTagAncestryPath = [];
                saveActiveTagAncestryPath();
                state.activeTagFilters.clear();
                handleTagFilterChange();
                renderTagsUI();
            });
            breadcrumbBar.appendChild(rootCrumb);

            state.activeTagAncestryPath.forEach((pathTagId, idx) => {
                const pathTag = tags.find(t => t.id === pathTagId);
                if (!pathTag) return;

                const sep = document.createElement('span');
                sep.className = 'tm-breadcrumb-separator';
                sep.innerHTML = `<i class="fa-solid fa-angle-right"></i>`;
                breadcrumbBar.appendChild(sep);

                const item = document.createElement('span');
                const isLast = idx === state.activeTagAncestryPath.length - 1;
                item.className = `tm-breadcrumb-item${isLast ? ' active' : ''}`;
                const descIds = getAllDescendantTagIds(pathTag.id, tags);
                const allThemeNames = new Set();
                descIds.forEach(dId => {
                    const dTag = tags.find(t => t.id === dId);
                    if (dTag && dTag.themes) dTag.themes.forEach(th => allThemeNames.add(th));
                });
                item.innerHTML = `${escapeHtml(pathTag.name)} <small style="opacity:0.6;">(${allThemeNames.size})</small>`;
                item.addEventListener('click', () => {
                    state.activeTagAncestryPath = state.activeTagAncestryPath.slice(0, idx + 1);
                    saveActiveTagAncestryPath();
                    if (state.tagFilterMode === 'or') {
                        state.activeTagFilters.clear();
                        state.activeTagFilters.add(pathTag.id);
                    }
                    handleTagFilterChange();
                    renderTagsUI();
                });
                breadcrumbBar.appendChild(item);
            });

            if (state.activeTagAncestryPath.length > 1) {
                const toggleFoldBtn = document.createElement('span');
                toggleFoldBtn.className = 'tm-breadcrumb-item tm-toggle-fold';
                toggleFoldBtn.style.opacity = '0.6';
                toggleFoldBtn.style.marginLeft = 'auto';
                toggleFoldBtn.style.fontSize = '11px';
                toggleFoldBtn.style.padding = '0 4px';
                toggleFoldBtn.title = state.renderAllAncestorSubtagRows ? '折叠上级标签胶囊 (仅显示最小层级)' : '展开所有上级标签胶囊';
                toggleFoldBtn.innerHTML = `<i class="fa-solid ${state.renderAllAncestorSubtagRows ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>`;
                toggleFoldBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    state.renderAllAncestorSubtagRows = !state.renderAllAncestorSubtagRows;
                    renderTagsUI();
                });
                breadcrumbBar.appendChild(toggleFoldBtn);
            }

            container.parentNode.insertBefore(breadcrumbBar, lastRowRef.nextSibling);
            lastRowRef = breadcrumbBar;

            const displayDepthIndices = state.renderAllAncestorSubtagRows
                ? state.activeTagAncestryPath.map((_, idx) => idx)
                : [state.activeTagAncestryPath.length - 1];

            displayDepthIndices.forEach(depthIdx => {
                const parentTagId = state.activeTagAncestryPath[depthIdx];
                const parentTag = tags.find(t => t.id === parentTagId);
                if (!parentTag) return;

                const childTags = tags.filter(t => t.parentId === parentTagId);
                const childTagIds = childTags.map(t => t.id);
                if (childTags.length === 0) return;

                const subRow = document.createElement('div');
                subRow.className = `theme-tags-row theme-subtags-row level-${depthIdx + 2}`;

                const labelSpan = document.createElement('span');
                labelSpan.className = 'tm-subtag-label';
                labelSpan.innerHTML = `<i class="fa-solid fa-angle-right"></i> ${escapeHtml(parentTag.name)}:`;
                subRow.appendChild(labelSpan);

                const currentDepthSelectedId = state.activeTagAncestryPath[depthIdx + 1];

                childTags.forEach(childTag => {
                    const subChip = document.createElement('div');
                    const isSubDirectActive = state.activeTagFilters.has(childTag.id);
                    const isSubInPath = currentDepthSelectedId === childTag.id;
                    const cDescIds = getAllDescendantTagIds(childTag.id, tags);
                    const cThemeNames = new Set();
                    cDescIds.forEach(dId => {
                        const dTag = tags.find(t => t.id === dId);
                        if (dTag && dTag.themes) dTag.themes.forEach(th => cThemeNames.add(th));
                    });

                    subChip.className = `theme-tag-chip level2 ${isSubDirectActive || isSubInPath ? 'active' : ''}`;
                    subChip.dataset.tagId = childTag.id;
                    subChip.innerHTML = `${escapeHtml(childTag.name)} <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${cThemeNames.size})</span>`;
                    subChip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (state.tagFilterMode === 'or') {
                            if (isSubInPath && isSubDirectActive) {
                                state.activeTagAncestryPath = state.activeTagAncestryPath.slice(0, depthIdx + 1);
                                state.activeTagFilters.clear();
                                const parentIdAtUpperLevel = state.activeTagAncestryPath[state.activeTagAncestryPath.length - 1];
                                if (parentIdAtUpperLevel) {
                                    state.activeTagFilters.add(parentIdAtUpperLevel);
                                }
                            } else {
                                state.activeTagAncestryPath = [...state.activeTagAncestryPath.slice(0, depthIdx + 1), childTag.id];
                                state.activeTagFilters.clear();
                                state.activeTagFilters.add(childTag.id);
                            }
                        } else {
                            state.activeTagAncestryPath = [...state.activeTagAncestryPath.slice(0, depthIdx + 1), childTag.id];
                            if (state.activeTagFilters.has(childTag.id)) {
                                state.activeTagFilters.delete(childTag.id);
                            } else {
                                state.activeTagFilters.add(childTag.id);
                            }
                        }
                        saveActiveTagAncestryPath();
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    subRow.appendChild(subChip);
                });

                const lThemes = parentTag.themes || [];
                const subUncatCount = lThemes.filter(themeName => {
                    const themeTags = getTagsForTheme(themeName, tags);
                    return !themeTags.some(tId => childTagIds.includes(tId));
                }).length;

                if (subUncatCount > 0 || childTags.length > 0) {
                    const subUncatKey = `__SUB_UNCATEGORIZED__:${parentTagId}`;
                    const isSubUncatActive = state.activeTagFilters.has(subUncatKey);
                    const subUncatChip = document.createElement('div');
                    subUncatChip.className = `theme-tag-chip level2 sub-uncategorized ${isSubUncatActive ? 'active' : ''}`;
                    subUncatChip.dataset.special = 'sub-uncategorized';
                    subUncatChip.innerHTML = `未分类 <span style="opacity:0.6;font-size:10px;margin-left:3px;">(${subUncatCount})</span>`;
                    subUncatChip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (state.tagFilterMode === 'or') {
                            if (isSubUncatActive) {
                                state.activeTagAncestryPath = state.activeTagAncestryPath.slice(0, depthIdx + 1);
                                state.activeTagFilters.clear();
                                state.activeTagFilters.add(parentTagId);
                            } else {
                                state.activeTagAncestryPath = state.activeTagAncestryPath.slice(0, depthIdx + 1);
                                state.activeTagFilters.clear();
                                state.activeTagFilters.add(subUncatKey);
                            }
                        } else {
                            if (isSubUncatActive) {
                                state.activeTagFilters.delete(subUncatKey);
                            } else {
                                state.activeTagFilters.add(subUncatKey);
                            }
                        }
                        saveActiveTagAncestryPath();
                        handleTagFilterChange();
                        renderTagsUI();
                    });
                    subRow.appendChild(subUncatChip);
                }

                container.parentNode.insertBefore(subRow, lastRowRef.nextSibling);
                lastRowRef = subRow;
            });
        }
    }
}
