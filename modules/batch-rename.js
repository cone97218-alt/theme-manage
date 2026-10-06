/**
 * modules/batch-rename.js
 * 酒馆主题管理器 - 批量重命名模块
 * 支持批量前缀、后缀、固定词组替换以及综合正则式批处理，带实时双向预览与重名冲突检测。
 */

export function sanitizeThemeName(str) {
    if (!str) return '';
    return str.replace(/[\\/:*?"<>|]/g, '').trim();
}

export function initBatchRename(config = {}) {
    const {
        getSelectedForBatch = () => new Set(),
        clearSelectedForBatch = () => {},
        showLoader = () => {},
        hideLoader = () => {},
        getAllThemesFromAPI,
        findThemeObject,
        normalizeThemeObject,
        apiRequest,
        deleteTheme,
        limitConcurrency,
        originalSelect,
        manualUpdateOriginalSelect,
        updateSTThemeMemory,
        softRenameThemeUI,
        updateFavorites,
        getThemeBackgroundBindings = () => ({}),
        loadThemeTags,
        saveThemeTags,
        invalidateThemesCache,
        filterThemeList,
        triggerSelectChange,
        updateActiveState,
        setSuspendObserver = () => {},
        callGenericPopup,
        toastr,
        escapeHtml = (s) => String(s || '')
    } = config;

    async function performBatchRename(renameLogic) {
        const selectedForBatch = getSelectedForBatch();
        if (!selectedForBatch || selectedForBatch.size === 0) {
            toastr.info('请先选择至少一个主题。');
            return;
        }

        showLoader();
        setSuspendObserver(true);

        let successCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        let activeThemeWasRenamed = false;

        try {
            const currentThemes = await getAllThemesFromAPI();
            const favoritesKey = 'themeManager_favorites';
            let favoritesToUpdate = JSON.parse(localStorage.getItem(favoritesKey)) || [];
            let tagsToUpdate = loadThemeTags();
            const themeBackgroundBindings = getThemeBackgroundBindings();

            const renameTasks = [];
            const usedNewNames = new Set();

            for (const oldName of selectedForBatch) {
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
                    const cleanObj = normalizeThemeObject(fullThemeObj, newName);
                    const { mtime: _mtime, ...objectToSave } = { ...cleanObj, name: newName, value: newName };

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
                        if (!saveOk) console.warn(`[Batch Rename] "${oldName}" 保存报错但删除成功，可能新文件已存在`);
                        if (!deleteOk) console.warn(`[Batch Rename] "${oldName}" 新文件已写入但旧文件未删除`);

                        const isActive = originalSelect.value === oldName;
                        manualUpdateOriginalSelect('rename', oldName, newName);
                        if (isActive) activeThemeWasRenamed = true;

                        updateSTThemeMemory({ name: oldName }, 'delete');
                        updateSTThemeMemory(newThemeObject, 'add');
                        softRenameThemeUI(oldName, newName);

                        const favIndex = favoritesToUpdate.indexOf(oldName);
                        if (favIndex > -1) favoritesToUpdate[favIndex] = newName;

                        if (themeBackgroundBindings[oldName]) {
                            themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                            delete themeBackgroundBindings[oldName];
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
            localStorage.setItem('themeManager_backgroundBindings', JSON.stringify(themeBackgroundBindings));
            saveThemeTags(tagsToUpdate);

            clearSelectedForBatch();
            invalidateThemesCache();
            filterThemeList();

            let summary = `批量操作完成！成功 ${successCount} 个`;
            if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
            if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
            summary += '。';
            toastr.success(summary);

            if (activeThemeWasRenamed) {
                triggerSelectChange(originalSelect);
            }
            updateActiveState();
        } catch (err) {
            console.error('批量重命名执行失败:', err);
            toastr.error('批量重命名发生异常：' + (err.message || err));
        } finally {
            hideLoader();
            setTimeout(() => { setSuspendObserver(false); }, 100);
        }
    }

    async function openBatchRenamePopup(themeNames) {
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
                        <input type="text" id="tm-rename-prefix-input" class="text_pole" placeholder="请输入前缀文本 (如: [Cyber] )" style="width:100%; box-sizing:border-box;">
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
                        <input type="text" id="tm-rename-suffix-input" class="text_pole" placeholder="请输入后缀文本 (如: _v2)" style="width:100%; box-sizing:border-box;">
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

        await callGenericPopup(popupHtml, 'confirm', null, {
            title: `批量重命名主题 (${themeNames.length} 个)`,
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

                const phraseRadios = container.querySelectorAll('input[name="tm-phrase-action"]');
                const replaceInput = container.querySelector('#tm-rename-replace-phrase');
                phraseRadios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        if (replaceInput) {
                            replaceInput.style.display = radio.value === 'replace' ? 'block' : 'none';
                        }
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
                            if (addSuffix) res = res + addSuffix;
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
                        const isChanged = oldName !== newName;
                        if (isChanged) changedCount++;

                        let statusClass = isChanged ? 'color:#4caf50;' : 'opacity:0.6;';
                        let changeSymbol = isChanged ? '<i class="fa-solid fa-arrow-right" style="margin:0 4px; font-size:10px;"></i>' : ' (未变)';

                        let newDisplay = escapeHtml(newName);
                        if (!newName.trim()) {
                            newDisplay = '<span style="color:#ff5252;">[空名称 - 无效]</span>';
                        }

                        html += `
                            <div style="display:flex; align-items:center; justify-content:space-between; padding:2px 0; border-bottom:1px dashed rgba(255,255,255,0.05);">
                                <span style="opacity:0.8; word-break:break-all;">${escapeHtml(oldName)}</span>
                                <span style="${statusClass} font-weight:bold; white-space:nowrap; margin-left:8px;">${changeSymbol} ${newDisplay}</span>
                            </div>
                        `;
                    });

                    previewContainer.innerHTML = html || '<div style="opacity:0.5;">暂无所选主题</div>';
                    if (countLabel) {
                        countLabel.textContent = `共 ${themeNames.length} 项，其中 ${changedCount} 项将发生改变`;
                    }
                }

                updatePreview();

                const okBtn = popup.dlg.querySelector('.popup-button-ok');
                if (okBtn) {
                    okBtn.addEventListener('click', async () => {
                        const logic = getRenameLogic();
                        let hasChanges = false;
                        let hasEmpty = false;

                        for (const name of themeNames) {
                            const newName = logic(name);
                            if (!newName.trim()) {
                                hasEmpty = true;
                            }
                            if (newName !== name) {
                                hasChanges = true;
                            }
                        }

                        if (hasEmpty) {
                            toastr.error('无法重命名：存在重命名后名称为空的主题。');
                            return;
                        }

                        if (!hasChanges) {
                            toastr.info('没有名称发生变化，已取消操作。');
                            return;
                        }

                        await performBatchRename(logic);
                    });
                }
            }
        });
    }

    return {
        performBatchRename,
        openBatchRenamePopup
    };
}
