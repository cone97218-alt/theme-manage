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

export function sanitizeThemeName(name) {
    if (!name) return '';
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

export async function openBatchRenamePopup(themeNames) {
    if (!themeNames || themeNames.length === 0) return;

    const popupHtml = `
        <div id="tm-batch-rename-dialog" style="display:flex; flex-direction:column; gap:12px; max-width:550px; text-align:left;">
            <p style="margin:0; font-size:13px; opacity:0.9;">
                为已选中的 <strong>${themeNames.length}</strong> 个主题批量修改名称。选择重命名规则并输入相关参数：
            </p>

            <div style="display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); padding-bottom:8px;">
                <button type="button" class="menu_button tm-rename-tab active" data-tab="prefix" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-heading"></i> 前缀</button>
                <button type="button" class="menu_button tm-rename-tab" data-tab="suffix" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-align-left"></i> 后缀</button>
                <button type="button" class="menu_button tm-rename-tab" data-tab="phrase" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-cube"></i> 固定词组</button>
                <button type="button" class="menu_button tm-rename-tab" data-tab="combo" style="display:inline-flex; flex-direction:row; align-items:center; justify-content:center; white-space:nowrap; font-size:12px; padding:4px 10px; margin:0;"><i class="fa-solid fa-layer-group"></i> 综合设置</button>
            </div>

            <!-- Panel 1: 前缀设置 -->
            <div class="tm-rename-panel" data-panel="prefix" style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; gap:16px; align-items:center;">
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-prefix-action" value="add" checked> 增加前缀
                    </label>
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-prefix-action" value="remove"> 删除前缀
                    </label>
                </div>
                <div>
                    <input type="text" id="tm-rename-prefix-input" class="text_pole" placeholder="请输入前缀文本 (例如 [Cyber] )" style="width:100%; box-sizing:border-box;">
                </div>
            </div>

            <!-- Panel 2: 后缀设置 -->
            <div class="tm-rename-panel" data-panel="suffix" style="display:none; flex-direction:column; gap:8px;">
                <div style="display:flex; gap:16px; align-items:center;">
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-suffix-action" value="add" checked> 增加后缀
                    </label>
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-suffix-action" value="remove"> 删除后缀
                    </label>
                </div>
                <div>
                    <input type="text" id="tm-rename-suffix-input" class="text_pole" placeholder="请输入后缀文本 (例如 _v2)" style="width:100%; box-sizing:border-box;">
                </div>
            </div>

            <!-- Panel 3: 固定词组设置 -->
            <div class="tm-rename-panel" data-panel="phrase" style="display:none; flex-direction:column; gap:8px;">
                <div style="display:flex; gap:16px; align-items:center;">
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-phrase-action" value="delete" checked> 删除固定词组
                    </label>
                    <label style="font-size:13px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="radio" name="tm-phrase-action" value="replace"> 替换固定词组
                    </label>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <input type="text" id="tm-rename-find-phrase" class="text_pole" placeholder="要查找/删除的固定词组" style="width:100%; box-sizing:border-box;">
                    <input type="text" id="tm-rename-replace-phrase" class="text_pole" placeholder="替换为 (留空代表直接删除该词组)" style="width:100%; box-sizing:border-box; display:none;">
                </div>
            </div>

            <!-- Panel 4: 综合设置 -->
            <div class="tm-rename-panel" data-panel="combo" style="display:none; flex-direction:column; gap:8px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <span style="font-size:11px; opacity:0.8;">增加前缀：</span>
                        <input type="text" id="tm-combo-add-prefix" class="text_pole" placeholder="前缀" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                    <div>
                        <span style="font-size:11px; opacity:0.8;">匹配删除前缀：</span>
                        <input type="text" id="tm-combo-del-prefix" class="text_pole" placeholder="前缀" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                    <div>
                        <span style="font-size:11px; opacity:0.8;">增加后缀：</span>
                        <input type="text" id="tm-combo-add-suffix" class="text_pole" placeholder="后缀" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                    <div>
                        <span style="font-size:11px; opacity:0.8;">匹配删除后缀：</span>
                        <input type="text" id="tm-combo-del-suffix" class="text_pole" placeholder="后缀" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <span style="font-size:11px; opacity:0.8;">查找固定词组：</span>
                        <input type="text" id="tm-combo-find-phrase" class="text_pole" placeholder="词组" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                    <div>
                        <span style="font-size:11px; opacity:0.8;">替换为：</span>
                        <input type="text" id="tm-combo-replace-phrase" class="text_pole" placeholder="替换文本 (留空即删)" style="width:100%; box-sizing:border-box; height:28px;">
                    </div>
                </div>
            </div>

            <!-- 实时预览区 -->
            <div style="margin-top:4px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:12px; font-weight:bold; opacity:0.9;"><i class="fa-solid fa-eye"></i> 重命名效果预览：</span>
                    <span id="tm-preview-count-label" style="font-size:11px; opacity:0.6;"></span>
                </div>
                <div id="tm-rename-preview-list" style="max-height:160px; overflow-y:auto; background:rgba(0,0,0,0.15); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); border-radius:4px; padding:6px; font-size:12px; font-family:monospace;">
                </div>
            </div>
        </div>
    `;

    await ctx.callGenericPopup(popupHtml, 'confirm', null, {
        title: `批量重命名主题 (${themeNames.length} 项)`,
        okButton: '开始重命名',
        cancelButton: '取消',
        onOpen: (popup) => {
            const container = popup.dlg.querySelector('#tm-batch-rename-dialog');
            if (!container) return;

            let activeTab = 'prefix';

            const tabs = container.querySelectorAll('.tm-rename-tab');
            const panels = container.querySelectorAll('.tm-rename-panel');

            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    activeTab = tab.dataset.tab;
                    panels.forEach(p => {
                        p.style.display = p.dataset.panel === activeTab ? 'flex' : 'none';
                    });
                    updatePreview();
                });
            });

            container.querySelectorAll('input[name="tm-phrase-action"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    const replaceInput = container.querySelector('#tm-rename-replace-phrase');
                    if (replaceInput) replaceInput.style.display = radio.value === 'replace' ? 'block' : 'none';
                    updatePreview();
                });
            });

            container.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', updatePreview);
                input.addEventListener('change', updatePreview);
            });

            function getRenameLogic() {
                if (activeTab === 'prefix') {
                    const action = container.querySelector('input[name="tm-prefix-action"]:checked')?.value || 'add';
                    const prefix = container.querySelector('#tm-rename-prefix-input').value;
                    if (!prefix) return (name) => name;
                    if (action === 'add') return (name) => sanitizeThemeName(prefix + name);
                    if (action === 'remove') return (name) => sanitizeThemeName(name.startsWith(prefix) ? name.slice(prefix.length) : name);
                } else if (activeTab === 'suffix') {
                    const action = container.querySelector('input[name="tm-suffix-action"]:checked')?.value || 'add';
                    const suffix = container.querySelector('#tm-rename-suffix-input').value;
                    if (!suffix) return (name) => name;
                    if (action === 'add') return (name) => sanitizeThemeName(name + suffix);
                    if (action === 'remove') return (name) => sanitizeThemeName(name.endsWith(suffix) ? name.slice(0, name.length - suffix.length) : name);
                } else if (activeTab === 'phrase') {
                    const action = container.querySelector('input[name="tm-phrase-action"]:checked')?.value || 'delete';
                    const findPhrase = container.querySelector('#tm-rename-find-phrase').value;
                    const replacePhrase = action === 'replace' ? container.querySelector('#tm-rename-replace-phrase').value : '';
                    if (!findPhrase) return (name) => name;
                    return (name) => sanitizeThemeName(name.split(findPhrase).join(replacePhrase));
                } else if (activeTab === 'combo') {
                    const addPrefix = container.querySelector('#tm-combo-add-prefix').value;
                    const delPrefix = container.querySelector('#tm-combo-del-prefix').value;
                    const addSuffix = container.querySelector('#tm-combo-add-suffix').value;
                    const delSuffix = container.querySelector('#tm-combo-del-suffix').value;
                    const findPhrase = container.querySelector('#tm-combo-find-phrase').value;
                    const replacePhrase = container.querySelector('#tm-combo-replace-phrase').value || '';

                    return function(name) {
                        let res = name;
                        if (delPrefix && res.startsWith(delPrefix)) res = res.slice(delPrefix.length);
                        if (addPrefix) res = addPrefix + res;
                        if (findPhrase) res = res.split(findPhrase).join(replacePhrase);
                        if (delSuffix && res.endsWith(delSuffix)) res = res.slice(0, res.length - delSuffix.length);
                        if (addSuffix) res = addSuffix + res;
                        return sanitizeThemeName(res);
                    };
                }
                return (name) => name;
            }

            function updatePreview() {
                const logic = getRenameLogic();
                const previewContainer = container.querySelector('#tm-rename-preview-list');
                const countLabel = container.querySelector('#tm-preview-count-label');
                if (!previewContainer) return;

                let changedCount = 0;
                let html = '';

                themeNames.forEach((oldName) => {
                    const newName = logic(oldName);
                    const isChanged = newName !== oldName && newName.trim() !== '';
                    if (isChanged) changedCount++;

                    html += `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:2px 0; border-bottom:1px dashed rgba(255,255,255,0.05); ${isChanged ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.6;'}">
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:45%;" title="${escapeHtml(oldName)}">${escapeHtml(oldName)}</span>
                            <i class="fa-solid fa-arrow-right" style="font-size:10px; opacity:0.5;"></i>
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:45%; font-weight:${isChanged ? 'bold' : 'normal'};" title="${escapeHtml(newName)}">${escapeHtml(newName)}</span>
                        </div>
                    `;
                });

                previewContainer.innerHTML = html || '<div style="opacity:0.5; text-align:center; padding:8px;">暂无预测更改</div>';
                if (countLabel) countLabel.textContent = `变动: ${changedCount} / ${themeNames.length}`;
            }

            updatePreview();

            popup.dlg.querySelector('.popup-button-ok').addEventListener('click', () => {
                const renameLogic = getRenameLogic();
                performBatchRename(renameLogic);
            });
        }
    });
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
