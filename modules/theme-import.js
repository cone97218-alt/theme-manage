/**
 * modules/theme-import.js
 * 美化主题批量导入与目标标签分配交互模块
 */

export function initThemeImport(config) {
    const {
        loadThemeTags,
        saveThemeTags,
        isSubtagsEnabled,
        getActiveTagFilters = () => new Set(),
        escapeHtml,
        callGenericPopup,
        toastr,
        fileInput,
        showLoader,
        hideLoader,
        limitConcurrency,
        saveTheme,
        suspendObserver = (fn) => fn(),
        updateSTThemeMemory,
        findOptionByValue,
        originalSelect,
        stKnownThemes,
        syncStKnownThemes,
        allThemeObjectsMap,
        allThemeObjects,
        invalidateThemesCache,
        invalidateValidThemeNamesCache,
        allParsedThemesMap,
        softAddThemeUI,
        contentWrapper,
        applyKeywordMappings,
        softRefreshUI,
        filterThemeList,
        updateActiveState
    } = config;

    // 弹窗让用户设置导入美化时所分配的目标分类标签
    async function showImportTagSelectionPopup(validFiles, invalidFiles) {
        const tags = loadThemeTags();
        const subtagsEnabled = isSubtagsEnabled();
        const activeTagFilters = getActiveTagFilters();

        // 检查当前是否有正在筛选的单标签
        const currentActiveTagId = (activeTagFilters && activeTagFilters.size === 1)
            ? Array.from(activeTagFilters)[0]
            : null;

        // 构建下拉框选项
        let optionsHtml = `<option value="">-- 不分配标签 (默认) --</option>`;
        optionsHtml += `<option value="__new__">➕ 创建新标签并导入...</option>`;

        if (!subtagsEnabled) {
            tags.forEach(t => {
                const isSelected = (currentActiveTagId && t.id === currentActiveTagId);
                optionsHtml += `<option value="${escapeHtml(t.id)}" ${isSelected ? 'selected' : ''}>🏷️ ${escapeHtml(t.name)}${isSelected ? ' (当前筛选)' : ''}</option>`;
            });
        } else {
            const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
            const renderOptionTree = (nodeTag, depth) => {
                const isSelected = (currentActiveTagId && nodeTag.id === currentActiveTagId);
                const indent = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(depth);
                const icon = depth === 0 ? '📁 ' : '↳ 🏷️ ';
                let h = `<option value="${escapeHtml(nodeTag.id)}" ${isSelected ? 'selected' : ''}>${indent}${icon}${escapeHtml(nodeTag.name)}${isSelected ? ' (当前筛选)' : ''}</option>`;
                const children = tags.filter(t => t.parentId === nodeTag.id);
                children.forEach(c => {
                    h += renderOptionTree(c, depth + 1);
                });
                return h;
            };
            rootTags.forEach(rTag => {
                optionsHtml += renderOptionTree(rTag, 0);
            });
        }

        // 构建多选标签树 HTML（供切换多选时使用）
        let multitagHtml = '';
        if (tags.length > 0) {
            if (!subtagsEnabled) {
                tags.forEach(t => {
                    const isChecked = (currentActiveTagId && t.id === currentActiveTagId);
                    multitagHtml += `
                        <label style="display:flex; align-items:center; gap:6px; padding:3px 4px; font-size:12px; cursor:pointer;">
                            <input type="checkbox" class="tm-imp-multitag-cb" value="${escapeHtml(t.id)}" ${isChecked ? 'checked' : ''}>
                            <span>🏷️ ${escapeHtml(t.name)}</span>
                        </label>
                    `;
                });
            } else {
                const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                const renderTreeMulti = (nodeTag, depth) => {
                    const isChecked = (currentActiveTagId && nodeTag.id === currentActiveTagId);
                    let h = `
                        <div style="margin-left:${depth > 0 ? 12 : 0}px; margin-bottom:3px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:${depth === 0 ? '12px' : '11px'}; font-weight:${depth === 0 ? 'bold' : 'normal'}; cursor:pointer;">
                                <input type="checkbox" class="tm-imp-multitag-cb" value="${escapeHtml(nodeTag.id)}" ${isChecked ? 'checked' : ''}>
                                <i class="${depth === 0 ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${depth === 0 ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.7;'} font-size:11px;"></i>
                                <span>${escapeHtml(nodeTag.name)}</span>
                            </label>
                    `;
                    const children = tags.filter(t => t.parentId === nodeTag.id);
                    if (children.length > 0) {
                        h += `<div style="display:flex; flex-direction:column; gap:3px; margin-left:14px; padding-left:4px; border-left:1px solid rgba(255,255,255,0.1);">`;
                        children.forEach(c => {
                            h += renderTreeMulti(c, depth + 1);
                        });
                        h += `</div>`;
                    }
                    h += `</div>`;
                    return h;
                };
                rootTags.forEach(r => {
                    multitagHtml += renderTreeMulti(r, 0);
                });
            }
        } else {
            multitagHtml = `<div style="font-size:11px; opacity:0.6; padding:4px;">暂无标签，可使用上方选项快速新建。</div>`;
        }

        const popupHtml = `
            <div class="tm-imp-dialog-content" style="text-align:left; font-size:13px; display:flex; flex-direction:column; gap:10px; max-height:calc(80vh - 130px); max-height:calc(80dvh - 130px); overflow-y:auto; padding-right:4px; flex:0 1 auto; min-height:0;">
                <!-- 文件信息卡片 -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:bold; font-size:13px;">
                            <i class="fa-solid fa-file-arrow-up" style="color:var(--SmartThemeQuoteColor, #4a90e2); margin-right:6px;"></i>
                            准备导入美化主题
                        </span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:11.5px; opacity:0.8; background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:4px;">
                                共 ${validFiles.length} 个
                            </span>
                            <button id="tm-imp-reselect-btn" class="menu_button" type="button" style="width:26px; height:26px; min-width:26px; padding:0; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; font-size:12px; border-radius:4px;" title="重新选择美化文件"><i class="fa-solid fa-arrows-rotate"></i></button>
                        </div>
                    </div>
                    <div style="max-height:75px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:4px; padding:2px;">
                        ${validFiles.map(f => `
                            <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.05); border-radius:4px; font-size:11px; font-family:monospace;">
                                <i class="fa-solid fa-palette" style="font-size:10px; opacity:0.7;"></i>
                                ${escapeHtml(f.themeObject.name)}
                            </span>
                        `).join('')}
                    </div>
                    ${invalidFiles.length > 0 ? `
                        <div style="color:#ffaa00; font-size:11px; margin-top:6px; display:flex; align-items:center; gap:4px;">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            另有 ${invalidFiles.length} 个非有效主题文件将被自动跳过
                        </div>
                    ` : ''}
                </div>

                <!-- 目标标签卡片 -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-weight:bold; font-size:13px; margin:0; display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-tags" style="color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                            导入目标分类标签：
                        </label>
                        ${tags.length > 0 ? `
                            <button id="tm-imp-multitag-toggle" class="menu_button" type="button" style="width:26px; height:26px; min-width:26px; padding:0; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; font-size:12px; border-radius:4px;" title="切换多选标签模式">
                                <i class="fa-solid fa-list-check"></i>
                            </button>
                        ` : ''}
                    </div>

                    <!-- 单选下拉模式 -->
                    <div id="tm-imp-singletag-wrap">
                        <select id="tm-imp-tag-select" class="text_pole" style="width:100%; height:32px; font-size:12.5px; padding:2px 8px; margin:0; box-sizing:border-box;">
                            ${optionsHtml}
                        </select>
                        <!-- 新建标签输入栏 -->
                        <div id="tm-imp-new-tag-wrap" style="display:none; margin-top:8px;">
                            <input type="text" id="tm-imp-new-tag-input" class="text_pole" placeholder="请输入要新建的标签名称..." style="width:100%; height:30px; font-size:12px; padding:2px 8px; box-sizing:border-box;">
                        </div>
                    </div>

                    <!-- 多选模式 (默认隐藏) -->
                    <div id="tm-imp-multitag-wrap" style="display:none; margin-top:6px;">
                        <div style="font-size:11px; opacity:0.7; margin-bottom:4px;">勾选要分配的标签（可多选）：</div>
                        <div style="max-height:140px; overflow-y:auto; padding:6px; border:1px solid rgba(255,255,255,0.08); border-radius:6px; background:rgba(0,0,0,0.15); display:flex; flex-direction:column; gap:2px;">
                            ${multitagHtml}
                        </div>
                    </div>

                    <div style="margin-top:6px; font-size:11px; opacity:0.65; line-height:1.4;">
                        💡 提示：设置后，本次导入的美化将自动加入对应标签，方便在标签栏中按类快速筛选与管理。
                    </div>
                </div>

                <!-- 规则选项 -->
                <div style="padding:0 2px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; user-select:none;">
                        <input type="checkbox" id="tm-imp-apply-kw" checked>
                        <span>同时对导入的美化执行关键词规则自动映射标签</span>
                    </label>
                </div>
            </div>
        `;

        return new Promise(async (resolve) => {
            let isResolved = false;
            let isMultiMode = false;

            await callGenericPopup(popupHtml, 'confirm', null, {
                title: `导入主题设置 (${validFiles.length} 个美化)`,
                okButton: '确认导入',
                cancelButton: '取消',
                wide: false,
                onOpen: (popup) => {
                    const dlg = popup.dlg;
                    if (!dlg) return;

                    dlg.classList.add('tm-tag-assign-dialog');
                    dlg.style.maxHeight = '80vh';
                    dlg.style.maxHeight = '80dvh';
                    dlg.style.height = 'auto';
                    dlg.style.display = 'flex';
                    dlg.style.flexDirection = 'column';
                    dlg.style.width = '92vw';
                    dlg.style.maxWidth = '500px';

                    const body = dlg.querySelector('.popup-body');
                    if (body) {
                        body.style.maxHeight = 'calc(80vh - 16px)';
                        body.style.maxHeight = 'calc(80dvh - 16px)';
                        body.style.height = 'auto';
                        body.style.minHeight = '0';
                        body.style.flex = '0 1 auto';
                        body.style.display = 'flex';
                        body.style.flexDirection = 'column';
                        body.style.overflow = 'hidden';
                    }

                    const content = dlg.querySelector('.popup-content');
                    if (content) {
                        content.style.maxHeight = 'calc(80vh - 80px)';
                        content.style.maxHeight = 'calc(80dvh - 80px)';
                        content.style.height = 'auto';
                        content.style.minHeight = '0';
                        content.style.flex = '0 1 auto';
                        content.style.display = 'flex';
                        content.style.flexDirection = 'column';
                        content.style.overflow = 'hidden';
                        content.style.padding = '0 4px';
                        content.style.marginTop = '6px';
                    }

                    const tagSelect = dlg.querySelector('#tm-imp-tag-select');
                    const newTagWrap = dlg.querySelector('#tm-imp-new-tag-wrap');
                    const newTagInput = dlg.querySelector('#tm-imp-new-tag-input');
                    const singleWrap = dlg.querySelector('#tm-imp-singletag-wrap');
                    const multiWrap = dlg.querySelector('#tm-imp-multitag-wrap');
                    const multiToggleBtn = dlg.querySelector('#tm-imp-multitag-toggle');
                    const reselectBtn = dlg.querySelector('#tm-imp-reselect-btn');
                    const applyKwCb = dlg.querySelector('#tm-imp-apply-kw');
                    const okBtn = dlg.querySelector('.popup-button-ok');

                    // 下拉选择切换
                    if (tagSelect) {
                        tagSelect.addEventListener('change', () => {
                            if (tagSelect.value === '__new__') {
                                newTagWrap.style.display = 'block';
                                if (newTagInput) {
                                    newTagInput.focus();
                                }
                            } else {
                                newTagWrap.style.display = 'none';
                            }
                        });
                    }

                    // 多选切换按钮
                    if (multiToggleBtn) {
                        multiToggleBtn.addEventListener('click', () => {
                            isMultiMode = !isMultiMode;
                            if (isMultiMode) {
                                singleWrap.style.display = 'none';
                                multiWrap.style.display = 'block';
                                multiToggleBtn.innerHTML = '<i class="fa-solid fa-list"></i>';
                                multiToggleBtn.title = '切换回单选下拉';
                            } else {
                                singleWrap.style.display = 'block';
                                multiWrap.style.display = 'none';
                                multiToggleBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
                                multiToggleBtn.title = '切换为多选标签模式';
                            }
                        });
                    }

                    // 重选文件按钮
                    if (reselectBtn) {
                        reselectBtn.addEventListener('click', () => {
                            isResolved = true;
                            resolve(null);
                            const cancelBtn = dlg.querySelector('.popup-button-cancel');
                            if (cancelBtn) cancelBtn.click();
                            setTimeout(() => { if (fileInput) fileInput.click(); }, 120);
                        });
                    }

                    // 确认拦截校验 (捕获阶段)
                    if (okBtn) {
                        okBtn.addEventListener('click', (e) => {
                            let targetTagIds = [];
                            let newTagName = null;

                            if (isMultiMode) {
                                const checkedCbs = dlg.querySelectorAll('.tm-imp-multitag-cb:checked');
                                targetTagIds = Array.from(checkedCbs).map(cb => cb.value);
                            } else {
                                if (tagSelect.value === '__new__') {
                                    const val = newTagInput ? newTagInput.value.trim() : '';
                                    if (!val) {
                                        e.preventDefault();
                                        e.stopImmediatePropagation();
                                        toastr.warning('请输入新标签名称，或选择已有标签。');
                                        if (newTagInput) newTagInput.focus();
                                        return;
                                    }
                                    newTagName = val;
                                } else if (tagSelect.value) {
                                    targetTagIds = [tagSelect.value];
                                }
                            }

                            isResolved = true;
                            resolve({
                                confirmed: true,
                                targetTagIds,
                                newTagName,
                                applyKeywords: applyKwCb ? applyKwCb.checked : true
                            });
                        }, true);
                    }
                }
            });

            if (!isResolved) {
                resolve(null);
            }
        });
    }

    async function handleBatchThemeImport(files) {
        if (!files || !files.length) return;

        showLoader();

        try {
            // 1. 并行读取文件内容并解析 JSON
            const fileReadPromises = Array.from(files).map(async (file) => {
                try {
                    const fileContent = await file.text();
                    const themeObject = JSON.parse(fileContent);
                    const filenameWithoutExt = file.name.replace(/\.json$/i, '').trim();
                    if (themeObject && typeof themeObject.main_text_color !== 'undefined') {
                        // 优先显示并使用文件内部定义的主题名称 (themeObject.name)，若未指定才回退到文件名
                        const internalName = (typeof themeObject.name === 'string' && themeObject.name.trim())
                            ? themeObject.name.trim()
                            : '';
                        const effectiveName = internalName || filenameWithoutExt || '未命名美化';
                        themeObject.name = effectiveName;
                        themeObject.value = effectiveName;
                        return { file, themeObject, valid: true };
                    }
                    return { file, valid: false, error: '非有效的主题文件' };
                } catch (err) {
                    return { file, valid: false, error: err.message };
                }
            });

            console.log(`[Theme Manager] 开始处理批量导入文件, 选择的文件数: ${files.length}`);

            const parsedFiles = await Promise.all(fileReadPromises);
            const validFiles = parsedFiles.filter(f => f.valid);
            const invalidFiles = parsedFiles.filter(f => !f.valid);

            if (invalidFiles.length > 0) {
                invalidFiles.forEach(f => {
                    console.error(`[Theme Manager Error] 无效的主题文件 "${f.file.name}":`, f.error);
                });
            }

            hideLoader();

            if (validFiles.length === 0) {
                toastr.error('所选文件中没有包含有效的主题美化文件。');
                return;
            }

            // 弹窗让用户设置导入的目标标签
            const importConfig = await showImportTagSelectionPopup(validFiles, invalidFiles);
            if (!importConfig) {
                return;
            }

            showLoader();

            let targetTagIds = importConfig.targetTagIds || [];
            let allTags = loadThemeTags();

            // 如果用户在弹窗中选择新建标签
            if (importConfig.newTagName) {
                let existingTag = allTags.find(t => t.name.toLowerCase() === importConfig.newTagName.toLowerCase());
                if (!existingTag) {
                    existingTag = {
                        id: Date.now().toString(),
                        name: importConfig.newTagName,
                        parentId: null,
                        themes: []
                    };
                    allTags.push(existingTag);
                    saveThemeTags(allTags);
                }
                if (!targetTagIds.includes(existingTag.id)) {
                    targetTagIds.push(existingTag.id);
                }
            }

            let successCount = 0;
            let errorCount = invalidFiles.length;
            const importedThemes = [];
            let needsUIUpdate = false;

            // 2. 并行发送 API 保存请求 (限制并发为 5)
            console.log(`[Theme Manager] 开始并发保存 ${validFiles.length} 个有效主题...`);
            const saveResults = await limitConcurrency(5, validFiles, async ({ themeObject }) => {
                try {
                    await saveTheme(themeObject);
                    return { success: true, themeObject };
                } catch (err) {
                    return { success: false, themeObject, error: err };
                }
            });

            // 收集保存成功的主题
            saveResults.forEach((res, index) => {
                const orig = validFiles[index];
                if (res.status === 'fulfilled' && res.value.success) {
                    successCount++;
                    const themeObject = res.value.themeObject;
                    importedThemes.push(themeObject);
                    console.log(`[Theme Manager] 成功保存主题到服务器: "${themeObject.name}"`);
                } else {
                    errorCount++;
                    console.error(`[Theme Manager Error] 保存主题 "${orig.themeObject.name}" 失败:`, res.status === 'fulfilled' ? res.value.error : res.reason);
                }
            });

            // 3. 批量更新下拉框、内存及 UI DOM
            if (importedThemes.length > 0) {
                needsUIUpdate = true;

                // 第一步：批量更新 ST 原生下拉框 & 同步内部内存与已知合法美化名称集
                suspendObserver(() => {
                    importedThemes.forEach(themeObject => {
                        updateSTThemeMemory(themeObject, 'add');
                        const existingOption = findOptionByValue(originalSelect, themeObject.name);
                        if (!existingOption) {
                            const option = document.createElement('option');
                            option.value = themeObject.name;
                            option.textContent = themeObject.name;
                            originalSelect.appendChild(option);
                        }
                        stKnownThemes.add(themeObject.name);
                        allThemeObjectsMap.set(themeObject.name, themeObject);
                    });
                    syncStKnownThemes();
                });

                // 立即失效主题缓存与合法美化名称缓存，确保后续标签校验认可新导入的主题
                invalidateThemesCache();
                invalidateValidThemeNamesCache();

                // 第二步：如果指定了目标标签，批量将美化关联到标签并保存（此时系统已识别新主题为合法美化，不会被过滤剔除）
                if (targetTagIds.length > 0) {
                    allTags = loadThemeTags();
                    targetTagIds.forEach(tId => {
                        const tag = allTags.find(t => String(t.id) === String(tId));
                        if (tag) {
                            if (!Array.isArray(tag.themes)) tag.themes = [];
                            importedThemes.forEach(th => {
                                if (!tag.themes.includes(th.name)) {
                                    tag.themes.push(th.name);
                                }
                            });
                        }
                    });
                    saveThemeTags(allTags);
                }

                // 第三步：预先读取已包含目标标签的最新标签数据并构建挂载卡片 DOM
                const cachedTags = loadThemeTags();
                const listFragment = document.createDocumentFragment();
                const list = contentWrapper.querySelector('.theme-list');

                importedThemes.forEach(themeObject => {
                    const themeName = themeObject.name;
                    const existingParsed = allParsedThemesMap.get(themeName);
                    const isNewTheme = !existingParsed;

                    if (isNewTheme) {
                        // 批量构建并追加到 DocumentFragment
                        softAddThemeUI(themeObject, cachedTags, listFragment);
                    } else {
                        // 覆盖现有主题：使用 Object.assign 原地更新数据，免去 findIndex 的 O(N) 搜索开销
                        const existingObj = allThemeObjectsMap.get(themeName);
                        if (existingObj) {
                            Object.assign(existingObj, themeObject);
                        } else {
                            allThemeObjects.push(themeObject);
                            allThemeObjectsMap.set(themeName, themeObject);
                        }
                    }
                });

                // 一次性挂载到 DOM，减少 Reflow
                if (list && listFragment.children.length > 0) {
                    list.appendChild(listFragment);
                }

                // 第四步：关键词自动映射（若启用）
                if (importConfig.applyKeywords && importedThemes.length > 0) {
                    applyKeywordMappings(importedThemes.map(t => t.name));
                }

                // 第五步：精准刷新被导入主题的标签展示与顶部标签栏
                softRefreshUI(importedThemes.map(t => t.name));

                // 第六步：依照当前排序规则 (sortBy) 重新对全量美化卡片排序并定位到顶部
                filterThemeList(0);

                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                }
            }

            let summary = `批量导入完成！成功 ${successCount} 个`;
            if (importedThemes.length > 0 && targetTagIds.length > 0) {
                const finalTags = loadThemeTags();
                const assignedTagNames = finalTags.filter(t => targetTagIds.includes(String(t.id))).map(t => t.name).join(', ');
                if (assignedTagNames) {
                    summary += `，已分配至标签「${assignedTagNames}」`;
                }
            }
            if (errorCount > 0) {
                summary += `，失败 ${errorCount} 个。`;
                toastr.warning(summary);
            } else {
                summary += '。';
                toastr.success(summary);
            }

            if (needsUIUpdate) {
                updateActiveState();
            }

        } catch (err) {
            console.error('[Theme Manager Error] 批量导入产生未捕获异常:', err);
            toastr.error('导入美化发生异常: ' + (err.message || err));
        } finally {
            hideLoader();
        }
    }

    return {
        showImportTagSelectionPopup,
        handleBatchThemeImport
    };
}
