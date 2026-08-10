/**
 * popups.js
 * 批量重命名与批量删除处理逻辑
 */

import { state, ctx } from './state.js';
import { FAVORITES_KEY, THEME_BACKGROUND_BINDINGS_KEY } from './constants.js';
import { limitConcurrency, findOptionByValue, manualUpdateOriginalSelect, triggerSelectChange, escapeHtml } from './utils.js';
import { getAllThemesFromAPI, findThemeObject, apiRequest, deleteTheme, updateSTThemeMemory, confirmAction, invalidateThemesCache, showLoader, hideLoader } from './api.js';
import { loadThemeTags, saveThemeTags } from './tags-core.js';
import { renderTagsUI, isSubtagsEnabled } from './tags-ui.js';
import { filterThemeList } from './search-filter.js';
import { updateFavorites, updateActiveState, softRefreshUI } from './theme-ui.js';

export async function openTagAssignmentPopup(themeNames) {
    const singleMode = typeof themeNames === 'string';
    const themesToAssign = singleMode ? [themeNames] : Array.from(themeNames);

    let tags = loadThemeTags();
    if (tags.length === 0) {
        toastr.info('还没有创建任何标签，请先去管理标签中创建。');
        return;
    }

    const subtagsEnabled = isSubtagsEnabled();
    let popupHtml = `<p>选择要分配的标签：</p><div style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">`;

    if (!subtagsEnabled) {
        tags.forEach(t => {
            const isChecked = singleMode ? (t.themes && t.themes.includes(themeNames)) : false;
            popupHtml += `
                <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                    <input type="checkbox" class="tag-assign-cb" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
                    ${escapeHtml(t.name)}
                </label>
            `;
        });
    } else {
        const renderAssignTreeHtml = (nodeTag, depth) => {
            const childTags = tags.filter(t => t.parentId === nodeTag.id);
            const isChecked = singleMode ? (nodeTag.themes && nodeTag.themes.includes(themeNames)) : false;
            let html = `
                <div style="margin-left:${depth > 0 ? 14 : 0}px; margin-bottom:4px; ${depth === 0 ? 'border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px; background:rgba(255,255,255,0.02);' : ''}">
                    <label style="display:flex; align-items:center; gap:6px; font-size:${depth === 0 ? '12px' : '11px'}; font-weight:${depth === 0 ? 'bold' : 'normal'}; cursor:pointer;">
                        <input type="checkbox" class="tag-assign-cb" data-id="${nodeTag.id}" ${isChecked ? 'checked' : ''}>
                        <i class="${depth === 0 ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${depth === 0 ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.7;'} font-size:11px;"></i>
                        ${escapeHtml(nodeTag.name)}
                    </label>
            `;
            if (childTags.length > 0) {
                html += `<div style="display:flex; flex-direction:column; gap:4px; margin-left:18px; margin-top:4px; padding-left:6px; border-left:2px solid rgba(255,255,255,0.1);">`;
                childTags.forEach(cTag => {
                    html += renderAssignTreeHtml(cTag, depth + 1);
                });
                html += `</div>`;
            }
            html += `</div>`;
            return html;
        };

        const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
        rootTags.forEach(rTag => {
            popupHtml += renderAssignTreeHtml(rTag, 0);
        });
    }
    popupHtml += `</div>`;

    await ctx.callGenericPopup(popupHtml, 'confirm', null, {
        title: singleMode ? `设置标签: ${themeNames.replace(/\[.*?\]/g, '').trim()}` : `批量设置标签 (${themesToAssign.length} 个主题)`,
        okButton: '保存',
        onOpen: (popup) => {
            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                const checkboxes = popup.dlg.querySelectorAll('.tag-assign-cb');
                const tagsById = new Map(tags.map(t => [t.id, t]));
                checkboxes.forEach(cb => {
                    const tagId = cb.dataset.id;
                    const tag = tagsById.get(tagId);
                    if (!tag) return;
                    if (!tag.themes) tag.themes = [];

                    if (cb.checked) {
                        themesToAssign.forEach(th => {
                            if (!tag.themes.includes(th)) tag.themes.push(th);
                        });
                    } else {
                        if (singleMode) {
                            const idx = tag.themes.indexOf(themeNames);
                            if (idx > -1) tag.themes.splice(idx, 1);
                        }
                    }
                });
                saveThemeTags(tags);
                toastr.success('标签分配已保存');
                if (!singleMode && state.isBatchEditMode) {
                    state.selectedForBatch.clear();
                    state.lastClickedThemeName = null;
                }
                softRefreshUI(themesToAssign);
            });
        }
    });
}

export async function openTagRemovalPopup(themeNames) {
    const themesToAssign = Array.from(themeNames);

    let tags = loadThemeTags();
    if (tags.length === 0) {
        toastr.info('还没有创建任何标签，无法移除。');
        return;
    }

    const subtagsEnabled = isSubtagsEnabled();
    let popupHtml = `<p>选择要从所选主题中移除的标签：</p><div style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">`;

    if (!subtagsEnabled) {
        tags.forEach(t => {
            popupHtml += `
                <label style="display:flex; align-items:center; gap:8px; padding:4px;">
                    <input type="checkbox" class="tag-remove-cb" data-id="${t.id}">
                    ${escapeHtml(t.name)}
                </label>
            `;
        });
    } else {
        const renderRemoveTreeHtml = (nodeTag, depth) => {
            const childTags = tags.filter(t => t.parentId === nodeTag.id);
            let html = `
                <div style="margin-left:${depth > 0 ? 14 : 0}px; margin-bottom:4px; ${depth === 0 ? 'border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px; background:rgba(255,255,255,0.02);' : ''}">
                    <label style="display:flex; align-items:center; gap:6px; font-size:${depth === 0 ? '12px' : '11px'}; font-weight:${depth === 0 ? 'bold' : 'normal'}; cursor:pointer;">
                        <input type="checkbox" class="tag-remove-cb" data-id="${nodeTag.id}">
                        <i class="${depth === 0 ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${depth === 0 ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.7;'} font-size:11px;"></i>
                        ${escapeHtml(nodeTag.name)}
                    </label>
            `;
            if (childTags.length > 0) {
                html += `<div style="display:flex; flex-direction:column; gap:4px; margin-left:18px; margin-top:4px; padding-left:6px; border-left:2px solid rgba(255,255,255,0.1);">`;
                childTags.forEach(cTag => {
                    html += renderRemoveTreeHtml(cTag, depth + 1);
                });
                html += `</div>`;
            }
            html += `</div>`;
            return html;
        };

        const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
        rootTags.forEach(rTag => {
            popupHtml += renderRemoveTreeHtml(rTag, 0);
        });
    }
    popupHtml += `</div>`;

    await ctx.callGenericPopup(popupHtml, 'confirm', null, {
        title: `批量移除标签 (${themesToAssign.length} 个主题)`,
        okButton: '移除',
        cancelButton: '取消',
        onOpen: (popup) => {
            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                const checkboxes = popup.dlg.querySelectorAll('.tag-remove-cb');
                let removedAnything = false;
                checkboxes.forEach(cb => {
                    if (cb.checked) {
                        const tagId = cb.dataset.id;
                        const tag = tags.find(t => t.id === tagId);
                        if (tag && tag.themes) {
                            themesToAssign.forEach(th => {
                                const idx = tag.themes.indexOf(th);
                                if (idx > -1) {
                                    tag.themes.splice(idx, 1);
                                    removedAnything = true;
                                }
                            });
                        }
                    }
                });
                if (removedAnything) {
                    saveThemeTags(tags);
                    toastr.success('已成功移除标签');
                }
                if (state.isBatchEditMode) {
                    state.selectedForBatch.clear();
                    state.lastClickedThemeName = null;
                }
                softRefreshUI();
            });
        }
    });
}



export async function performBatchRename(renameLogic) {
    if (state.selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
    showLoader();
    state._suspendObserver = true;

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let activeThemeWasRenamed = false;
    const originalSelect = document.querySelector('#themes');

    try {
        const currentThemes = await getAllThemesFromAPI();
        let favoritesToUpdate = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
        let tagsToUpdate = loadThemeTags();

        const renameTasks = [];
        const usedNewNames = new Set();

        for (const oldName of state.selectedForBatch) {
            const newName = renameLogic(oldName);
            if (!newName || !newName.trim()) {
                skippedCount++;
                continue;
            }

            if (usedNewNames.has(newName) || currentThemes.some(t => t.name === newName && t.name !== oldName)) {
                console.warn(`批量操作：目标名称 "${newName}" 已存在或内部冲突，已跳过 "${oldName}"。`);
                toastr.warning(`主题名称 "${newName}" 冲突，已跳过。`);
                skippedCount++;
                continue;
            }

            if (newName === oldName) {
                successCount++;
                continue;
            }

            const fullThemeObj = findThemeObject(oldName);
            if (!fullThemeObj) {
                console.error(`[Theme Manager Batch Rename] 无法读取主题 "${oldName}" 的完整数据，跳过此项`);
                errorCount++;
                continue;
            }

            usedNewNames.add(newName);
            renameTasks.push({ oldName, newName, fullThemeObj });
        }

        if (renameTasks.length > 0) {
            const results = await limitConcurrency(3, renameTasks, async ({ oldName, newName, fullThemeObj }) => {
                const { mtime: _mtime, ...cleanObj } = fullThemeObj;
                const objectToSave = { ...cleanObj, name: newName };

                let saveOk = false;
                let deleteOk = false;

                try {
                    await apiRequest('themes/save', 'POST', objectToSave, true);
                    saveOk = true;
                    console.log(`[Batch Rename] ✅ 保存成功: "${newName}.json"`);
                } catch (saveErr) {
                    console.warn(`[Batch Rename] ⚠️ 保存报错 (${saveErr.message})，但文件可能已写入，继续删除旧文件`);
                }

                try {
                    const deleted = await deleteTheme(oldName, fullThemeObj);
                    deleteOk = deleted;
                } catch (delErr) {
                    console.warn(`[Batch Rename] 删除旧主题 "${oldName}" 失败:`, delErr);
                }

                return { oldName, newName, newThemeObject: objectToSave, saveOk, deleteOk };
            });

            results.forEach((res, index) => {
                const task = renameTasks[index];
                if (res.status === 'fulfilled') {
                    const { oldName, newName, newThemeObject, saveOk, deleteOk } = res.value;

                    if (!saveOk && !deleteOk) {
                        errorCount++;
                        toastr.error(`重命名「${oldName}」失败（保存和删除均失败）`);
                        return;
                    }

                    successCount++;
                    if (originalSelect && originalSelect.value === oldName) activeThemeWasRenamed = true;
                    manualUpdateOriginalSelect('rename', oldName, newName);

                    updateSTThemeMemory({ name: oldName }, 'delete');
                    updateSTThemeMemory(newThemeObject, 'add');

                    const favIndex = favoritesToUpdate.indexOf(oldName);
                    if (favIndex > -1) favoritesToUpdate[favIndex] = newName;

                    if (state.themeBackgroundBindings[oldName]) {
                        state.themeBackgroundBindings[newName] = state.themeBackgroundBindings[oldName];
                        delete state.themeBackgroundBindings[oldName];
                    }

                    tagsToUpdate.forEach(tag => {
                        if (tag.themes) {
                            const idx = tag.themes.indexOf(oldName);
                            if (idx > -1) tag.themes[idx] = newName;
                        }
                    });
                } else {
                    errorCount++;
                    console.error(`批量重命名任务异常 "${task.oldName}":`, res.reason);
                    toastr.error(`处理「${task.oldName}」时异常: ${res.reason?.message || res.reason}`);
                }
            });
        }

        updateFavorites(favoritesToUpdate);
        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));
        saveThemeTags(tagsToUpdate);

        state.selectedForBatch.clear();
        state.lastClickedThemeName = null;
        if (state.managerPanel) {
            state.managerPanel.querySelectorAll('.selected-for-batch').forEach(el => el.classList.remove('selected-for-batch'));
        }
        invalidateThemesCache();
        filterThemeList();

        let summary = `批量操作完成！成功 ${successCount} 个`;
        if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
        if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
        summary += '。';
        toastr.success(summary);

        if (activeThemeWasRenamed && originalSelect) {
            triggerSelectChange(originalSelect);
        }
        updateActiveState();
    } catch (err) {
        console.error('批量重命名执行失败:', err);
        toastr.error('批量重命名发生异常：' + (err.message || err));
    } finally {
        hideLoader();
        setTimeout(() => { state._suspendObserver = false; }, 100);
    }
}

export async function performBatchDelete() {
    if (state.selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
    const deleteCount = state.selectedForBatch.size;
    const confirmed = await confirmAction(`确定要删除选中的 ${deleteCount} 个主题吗？`);
    if (!confirmed) return;

    const deletedThemes = Array.from(state.selectedForBatch);
    const successSet = new Set(deletedThemes);
    const originalSelect = document.querySelector('#themes');

    const themeObjSnapshots = new Map();
    deletedThemes.forEach(name => {
        const obj = findThemeObject(name);
        if (obj) themeObjSnapshots.set(name, obj);
    });

    state.selectedForBatch.clear();
    state.lastClickedThemeName = null;

    state._suspendObserver = true;
    try {
        if (originalSelect) {
            deletedThemes.forEach(themeName => {
                const optionToDelete = findOptionByValue(originalSelect, themeName);
                if (optionToDelete) optionToDelete.remove();
            });
        }
    } finally {
        setTimeout(() => { state._suspendObserver = false; }, 0);
    }

    try {
        const contexts = [];
        if (typeof power_user !== 'undefined') contexts.push(power_user);
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            contexts.push(SillyTavern.getContext());
        }

        contexts.forEach(ctx => {
            if (ctx && Array.isArray(ctx.themes)) {
                ctx.themes = ctx.themes.filter(t => !successSet.has(t.name) && !successSet.has(t.value));
            }
        });

        if (typeof themes !== 'undefined' && Array.isArray(themes)) {
            for (let i = themes.length - 1; i >= 0; i--) {
                if (successSet.has(themes[i].name) || successSet.has(themes[i].value)) {
                    themes.splice(i, 1);
                }
            }
        }
    } catch (e) {
        console.warn('[Theme Manager] 批量同步 ST 内部主题内存失败:', e);
    }

    deletedThemes.forEach(themeName => {
        const item = state.themeItemMap.get(themeName);
        if (item) {
            item.remove();
            state.themeItemMap.delete(themeName);
        }

        const idx = state.allParsedThemes.findIndex(t => t.value === themeName);
        if (idx > -1) {
            state.allParsedThemes.splice(idx, 1);
            state.allParsedThemesMap.delete(themeName);
        }

        const objIndex = state.allThemeObjects.findIndex(t => t.name === themeName || t.value === themeName);
        if (objIndex > -1) {
            state.allThemeObjects.splice(objIndex, 1);
        }
        state.allThemeObjectsMap.delete(themeName);
        state.stKnownThemes.delete(themeName);

        if (state.themeBackgroundBindings[themeName]) {
            delete state.themeBackgroundBindings[themeName];
        }
    });

    state.favorites = state.favorites.filter(f => !successSet.has(f));
    let tagsToUpdate = loadThemeTags();
    tagsToUpdate.forEach(tag => {
        if (tag.themes) {
            tag.themes = tag.themes.filter(t => !successSet.has(t));
        }
    });

    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));
    updateFavorites(state.favorites);
    saveThemeTags(tagsToUpdate);

    if (originalSelect) {
        const isCurrentlyActiveDeleted = successSet.has(originalSelect.value);
        if (isCurrentlyActiveDeleted) {
            const azureOption = findOptionByValue(originalSelect, 'Azure');
            originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
            triggerSelectChange(originalSelect);
        }
    }

    renderTagsUI(tagsToUpdate);
    updateActiveState();
    toastr.success(`已成功批量删除 ${deleteCount} 个美化主题！`);

    (async () => {
        try {
            await limitConcurrency(25, deletedThemes, name => {
                const themeObj = themeObjSnapshots.get(name) || null;
                return deleteTheme(name, themeObj);
            });

            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                const stCtx = SillyTavern.getContext();
                if (stCtx.saveSettingsDebounced) stCtx.saveSettingsDebounced();
            }
            invalidateThemesCache();
        } catch (err) {
            console.error('[Theme Manager] 异步批量删除物理文件异常:', err);
        }
    })();
}
