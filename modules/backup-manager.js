/**
 * modules/backup-manager.js
 * 酒馆主题管理器 - 备份、导出与恢复模块
 * 负责选择性导出/恢复主题、标签、背景、快捷键及全部界面个性化偏好。
 */

export const BACKUP_MODULE_DEFS = [
    {
        id: 'themes',
        name: '美化主题文件',
        icon: 'fa-solid fa-palette',
        desc: '包含选定主题的完整样式、颜色与自定义 CSS 配置',
        isThemes: true
    },
    {
        id: 'tags',
        name: '标签分类体系',
        icon: 'fa-solid fa-tags',
        desc: '包含全部分级标签树、子标签、过滤偏好与关键词自动映射规则',
        keys: [
            'themeManager_themeTags',
            'themeManager_tagFilterMode',
            'themeManager_enableSubtags',
            'themeManager_activeTagsFilters',
            'themeManager_activeTagAncestryPath',
            'themeManager_tagPillMode',
            'themeManager_hideTagPills'
        ]
    },
    {
        id: 'daynight',
        name: '日夜模式与日夜组',
        icon: 'fa-solid fa-circle-half-stroke',
        desc: '包含日夜主题组配对绑定、自动主题切换策略与开关状态',
        keys: [
            'themeManager_themeDayNightPairs',
            'themeManager_autoTheme',
            'themeManager_enableDayNightBinding'
        ]
    },
    {
        id: 'backgrounds',
        name: '背景图绑定',
        icon: 'fa-solid fa-image',
        desc: '包含各美化主题所关联绑定的专属背景图配置',
        keys: [
            'themeManager_backgroundBindings'
        ]
    },
    {
        id: 'avatars',
        name: '角色绑定与头像管理',
        icon: 'fa-solid fa-user-gear',
        desc: '包含角色卡绑定的专属美化配置、头像辅助器及替换按键设置',
        keys: [
            'themeManager_characterThemeBindings',
            'themeManager_enableAvatarHelper',
            'themeManager_enableReplaceAvatarBtn'
        ]
    },
    {
        id: 'favorites_usage',
        name: '收藏夹与使用统计',
        icon: 'fa-solid fa-star',
        desc: '包含加星收藏主题列表以及主题使用点击次数统计',
        keys: [
            'themeManager_favorites',
            'themeManager_usageCount',
            'themeManager_showUsageCount'
        ]
    },
    {
        id: 'ui_preferences',
        name: '界面显示偏好',
        icon: 'fa-solid fa-sliders',
        desc: '包含换行排版、分页大小、排序方式、配色提取器等界面习惯偏好',
        keys: [
            'themeManager_twoLineLayout',
            'themeManager_pageSize',
            'themeManager_sortSelect',
            'themeManager_listMode',
            'themeManager_enableColorTransfer',
            'themeManager_collapsed',
            'themeManager_batchEditCollapsed'
        ]
    }
];

export function initBackupManager(config = {}) {
    const {
        getAllThemesFromAPI,
        apiRequest,
        allThemeObjectsMap,
        recordThemeMtime,
        showLoader,
        hideLoader,
        callGenericPopup,
        closePopup,
        escapeHtml = (s) => String(s || ''),
        limitConcurrency,
        onRestoreComplete
    } = config;

    let fileInputEl = null;

    function getFileInput() {
        if (!fileInputEl) {
            fileInputEl = document.createElement('input');
            fileInputEl.type = 'file';
            fileInputEl.accept = '.json';
            fileInputEl.style.display = 'none';
            document.body.appendChild(fileInputEl);
            fileInputEl.addEventListener('change', handleBackupFileInputChange);
        }
        return fileInputEl;
    }

    function triggerFullImport() {
        getFileInput().click();
    }

    async function handleBackupFileInputChange(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const content = await file.text();
            const backup = JSON.parse(content);
            await openCustomImportModal(backup);
        } catch (err) {
            console.error('[Theme Manager] 解析备份文件失败:', err);
            toastr.error(`解析备份文件失败，文件可能已损坏或格式不正确。错误: ${err.message}`);
        } finally {
            event.target.value = '';
        }
    }

    // 打开自定义备份导出弹窗
    async function openCustomExportModal() {
        showLoader();
        let allThemes = [];
        try {
            allThemes = await getAllThemesFromAPI();
        } catch (e) {
            console.error('[Theme Manager] 获取全量主题失败:', e);
            toastr.error('获取主题列表失败，请检查网络');
        } finally {
            hideLoader();
        }

        const exportDlgHtml = `
            <div class="tm-custom-backup-modal" style="max-height: 78vh; overflow-y: auto; overflow-x: hidden; padding: 4px 6px; box-sizing: border-box; text-align: left;">
                <style>
                    .tm-custom-backup-modal .menu_button {
                        white-space: nowrap !important;
                        word-break: keep-all !important;
                        flex-shrink: 0 !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        text-align: center !important;
                        min-width: max-content !important;
                        writing-mode: horizontal-tb !important;
                    }
                </style>
                <div style="margin-bottom: 12px; font-size: 12px; opacity: 0.8; line-height: 1.5;">
                    请勾选需要导出的数据模块。您也可以在下方单独挑选需要备份的美化主题：
                </div>

                <!-- 模块全选/清空快捷栏 -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 4px 2px; flex-wrap: wrap; gap: 8px;">
                    <span style="font-weight: bold; font-size: 13px; color: var(--SmartThemeQuoteColor, #4a90e2); white-space: nowrap; flex-shrink: 0;">
                        <i class="fa-solid fa-cubes" style="margin-right: 4px;"></i> 数据模块选择
                    </span>
                    <div style="display: flex; flex-direction: row; gap: 8px; flex-shrink: 0; align-items: center;">
                        <button id="tm-exp-select-all-mod" class="menu_button" style="padding: 3px 10px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-check-double" style="margin-right: 4px;"></i>全选模块</button>
                        <button id="tm-exp-clear-all-mod" class="menu_button" style="padding: 3px 10px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-xmark" style="margin-right: 4px;"></i>清空模块</button>
                    </div>
                </div>

                <!-- 模块复选框列表 -->
                <div id="tm-exp-modules-container" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
                    ${BACKUP_MODULE_DEFS.map(mod => `
                        <label class="tm-mod-card" style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; cursor: pointer;">
                            <input type="checkbox" class="tm-exp-mod-cb" data-mod-id="${mod.id}" checked style="margin-top: 3px; flex-shrink: 0;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <i class="${mod.icon}" style="color: var(--SmartThemeQuoteColor, #4a90e2); flex-shrink: 0;"></i>
                                    <span style="white-space: nowrap;">${escapeHtml(mod.name)}</span>
                                    ${mod.isThemes ? `<span style="font-size: 11px; opacity: 0.7; font-weight: normal; white-space: nowrap;">(共 ${allThemes.length} 个主题)</span>` : ''}
                                </div>
                                <div style="font-size: 11.5px; opacity: 0.65; margin-top: 2px;">
                                    ${escapeHtml(mod.desc)}
                                </div>
                            </div>
                        </label>
                    `).join('')}
                </div>

                <!-- 主题精细选择容器 -->
                <div id="tm-exp-themes-subpanel" style="border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px; background: rgba(0,0,0,0.15); margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                        <span style="font-weight: bold; font-size: 12.5px; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                            <i class="fa-solid fa-list-check" style="color: var(--SmartThemeQuoteColor, #4a90e2);"></i> 选择需要导出的美化主题
                        </span>
                        <span id="tm-exp-theme-count-badge" style="font-size: 11.5px; opacity: 0.75; white-space: nowrap;">已选: ${allThemes.length} / ${allThemes.length}</span>
                    </div>
                    <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="tm-exp-theme-search" class="text_pole" placeholder="搜索主题名称..." style="flex: 1 1 140px; min-width: 110px; height: 28px; font-size: 11.5px; padding: 2px 8px; margin: 0; box-sizing: border-box;">
                        <div style="display: flex; flex-direction: row; gap: 6px; flex-shrink: 0; align-items: center;">
                            <button id="tm-exp-theme-select-all" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">全选</button>
                            <button id="tm-exp-theme-unselect-all" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">全不选</button>
                            <button id="tm-exp-theme-range-select" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;" title="连选：选中首尾已勾选主题之间的全部美化">连选</button>
                            <button id="tm-exp-theme-invert" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">反选</button>
                        </div>
                    </div>
                    <div id="tm-exp-theme-list" style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 6px; background: rgba(255,255,255,0.01);">
                        ${allThemes.map(t => {
                            const themeName = t.name || t.value || '';
                            return `
                                <label class="tm-exp-theme-row" data-theme-name="${escapeHtml(themeName.toLowerCase())}" style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 6px; border-radius: 4px; cursor: pointer; user-select: none;">
                                    <input type="checkbox" class="tm-exp-theme-cb" value="${escapeHtml(themeName)}" checked style="flex-shrink: 0;">
                                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(themeName)}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        await callGenericPopup(exportDlgHtml, 'confirm', null, {
            title: '自定义备份导出',
            okButton: '确认导出',
            cancelButton: '取消',
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                if (!dlg) return;

                const themeSubpanel = dlg.querySelector('#tm-exp-themes-subpanel');
                const themesModCb = dlg.querySelector('.tm-exp-mod-cb[data-mod-id="themes"]');
                const modCheckboxes = dlg.querySelectorAll('.tm-exp-mod-cb');
                const themeCheckboxes = dlg.querySelectorAll('.tm-exp-theme-cb');
                const themeCountBadge = dlg.querySelector('#tm-exp-theme-count-badge');
                const themeSearchInput = dlg.querySelector('#tm-exp-theme-search');
                const themeRows = dlg.querySelectorAll('.tm-exp-theme-row');

                const updateThemeCount = () => {
                    const checkedCount = dlg.querySelectorAll('.tm-exp-theme-cb:checked').length;
                    if (themeCountBadge) {
                        themeCountBadge.textContent = `已选: ${checkedCount} / ${allThemes.length}`;
                    }
                };

                const updateThemesSubpanelVisibility = () => {
                    if (themeSubpanel && themesModCb) {
                        themeSubpanel.style.display = themesModCb.checked ? 'block' : 'none';
                    }
                };

                if (themesModCb) {
                    themesModCb.addEventListener('change', updateThemesSubpanelVisibility);
                }

                // 模块全选/清空
                dlg.querySelector('#tm-exp-select-all-mod')?.addEventListener('click', () => {
                    modCheckboxes.forEach(cb => { cb.checked = true; });
                    updateThemesSubpanelVisibility();
                });
                dlg.querySelector('#tm-exp-clear-all-mod')?.addEventListener('click', () => {
                    modCheckboxes.forEach(cb => { cb.checked = false; });
                    updateThemesSubpanelVisibility();
                });

                // 主题搜索过滤
                if (themeSearchInput) {
                    themeSearchInput.addEventListener('input', (e) => {
                        const kw = (e.target.value || '').trim().toLowerCase();
                        themeRows.forEach(row => {
                            const name = row.getAttribute('data-theme-name') || '';
                            row.style.display = (!kw || name.includes(kw)) ? 'flex' : 'none';
                        });
                    });
                }

                // 主题全选/全不选/连选/反选
                dlg.querySelector('#tm-exp-theme-select-all')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-exp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = true;
                    });
                    updateThemeCount();
                });
                dlg.querySelector('#tm-exp-theme-unselect-all')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-exp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = false;
                    });
                    updateThemeCount();
                });
                dlg.querySelector('#tm-exp-theme-range-select')?.addEventListener('click', () => {
                    const visibleRows = Array.from(themeRows).filter(row => row.style.display !== 'none');
                    const selectedIndices = [];
                    visibleRows.forEach((row, idx) => {
                        const cb = row.querySelector('.tm-exp-theme-cb');
                        if (cb && cb.checked) selectedIndices.push(idx);
                    });

                    if (selectedIndices.length < 2) {
                        toastr.info('请先至少勾选 2 个主题作为连选的【起点】和【终点】。');
                        return;
                    }

                    const start = selectedIndices[0];
                    const end = selectedIndices[selectedIndices.length - 1];

                    for (let i = start; i <= end; i++) {
                        const cb = visibleRows[i].querySelector('.tm-exp-theme-cb');
                        if (cb) cb.checked = true;
                    }

                    updateThemeCount();
                    toastr.success(`连选成功！已覆盖区间内的 ${end - start + 1} 个主题。`);
                });
                dlg.querySelector('#tm-exp-theme-invert')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-exp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = !cb.checked;
                    });
                    updateThemeCount();
                });

                let lastExpCheckedIndex = -1;
                themeCheckboxes.forEach((cb, idx) => {
                    cb.addEventListener('click', (e) => {
                        if (e.shiftKey && lastExpCheckedIndex !== -1 && lastExpCheckedIndex !== idx) {
                            const startIdx = Math.min(lastExpCheckedIndex, idx);
                            const endIdx = Math.max(lastExpCheckedIndex, idx);
                            const targetChecked = cb.checked;
                            for (let i = startIdx; i <= endIdx; i++) {
                                const targetCb = themeCheckboxes[i];
                                if (targetCb) targetCb.checked = targetChecked;
                            }
                        }
                        lastExpCheckedIndex = idx;
                        updateThemeCount();
                    });
                });

                // 确认导出按钮事件
                const okBtn = dlg.querySelector('.popup-button-ok');
                if (okBtn) {
                    okBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const selectedModIds = Array.from(modCheckboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-mod-id'));
                        const exportThemesMod = selectedModIds.includes('themes');
                        const selectedThemeNames = new Set(
                            exportThemesMod ? Array.from(themeCheckboxes).filter(cb => cb.checked).map(cb => cb.value) : []
                        );

                        if (selectedModIds.length === 0 || (exportThemesMod && selectedModIds.length === 1 && selectedThemeNames.size === 0)) {
                            toastr.warning('请至少选择一个模块或主题进行导出。');
                            return;
                        }

                        closePopup(popup);

                        // 执行导出打包
                        const themesToExport = exportThemesMod
                            ? allThemes.filter(t => selectedThemeNames.has(t.name || t.value))
                            : [];

                        const settingsSnapshot = {};
                        const keysToExport = new Set();
                        BACKUP_MODULE_DEFS.forEach(mod => {
                            if (selectedModIds.includes(mod.id) && mod.keys) {
                                mod.keys.forEach(k => keysToExport.add(k));
                            }
                        });

                        keysToExport.forEach(key => {
                            const val = localStorage.getItem(key);
                            if (val !== null) settingsSnapshot[key] = val;
                        });

                        const backup = {
                            _version: 2,
                            _type: 'themeManager_customBackup',
                            _exportedAt: new Date().toISOString(),
                            _modules: selectedModIds,
                            _themeCount: themesToExport.length,
                            themes: themesToExport,
                            settings: settingsSnapshot
                        };

                        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        const filename = `theme_manager_backup_${ts}.json`;
                        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        toastr.success(`备份导出成功！共 ${themesToExport.length} 个主题 + ${Object.keys(settingsSnapshot).length} 条配置。`, '备份导出');
                    });
                }
            }
        });
    }

    // 打开自定义备份导入弹窗
    async function openCustomImportModal(backup) {
        const themeList = Array.isArray(backup.themes) ? backup.themes : [];
        const settingsMap = (backup.settings && typeof backup.settings === 'object') ? backup.settings : (typeof backup === 'object' && !backup._type ? backup : {});

        // 判断备份包中实际包含哪些模块
        const availableModules = BACKUP_MODULE_DEFS.filter(mod => {
            if (mod.isThemes) return themeList.length > 0;
            if (mod.keys) {
                return mod.keys.some(k => settingsMap[k] !== undefined && settingsMap[k] !== null);
            }
            return false;
        });

        if (availableModules.length === 0 && themeList.length === 0 && Object.keys(settingsMap).length === 0) {
            toastr.error('该文件不包含任何可识别的美化主题或配置数据。');
            return;
        }

        const exportedDateStr = backup._exportedAt ? new Date(backup._exportedAt).toLocaleString('zh-CN') : '未知时间';

        const importDlgHtml = `
            <div class="tm-custom-backup-modal" style="max-height: 78vh; overflow-y: auto; overflow-x: hidden; padding: 4px 6px; box-sizing: border-box; text-align: left;">
                <style>
                    .tm-custom-backup-modal .menu_button {
                        white-space: nowrap !important;
                        word-break: keep-all !important;
                        flex-shrink: 0 !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        text-align: center !important;
                        min-width: max-content !important;
                        writing-mode: horizontal-tb !important;
                    }
                </style>
                <div style="margin-bottom: 10px; font-size: 12px; opacity: 0.8; line-height: 1.5;">
                    备份文件生成于：<b>${escapeHtml(exportedDateStr)}</b><br>
                    请勾选本次需要恢复的数据模块（未勾选的模块将保持现状不变）：
                </div>

                <!-- 模块全选/清空快捷栏 -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 4px 2px; flex-wrap: wrap; gap: 8px;">
                    <span style="font-weight: bold; font-size: 13px; color: var(--SmartThemeQuoteColor, #4a90e2); white-space: nowrap; flex-shrink: 0;">
                        <i class="fa-solid fa-cubes" style="margin-right: 4px;"></i> 待恢复模块
                    </span>
                    <div style="display: flex; flex-direction: row; gap: 8px; flex-shrink: 0; align-items: center;">
                        <button id="tm-imp-select-all-mod" class="menu_button" style="padding: 3px 10px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-check-double" style="margin-right: 4px;"></i>全选模块</button>
                        <button id="tm-imp-clear-all-mod" class="menu_button" style="padding: 3px 10px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-xmark" style="margin-right: 4px;"></i>清空模块</button>
                    </div>
                </div>

                <!-- 可用模块复选框列表 -->
                <div id="tm-imp-modules-container" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
                    ${availableModules.map(mod => `
                        <label class="tm-mod-card" style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; cursor: pointer;">
                            <input type="checkbox" class="tm-imp-mod-cb" data-mod-id="${mod.id}" checked style="margin-top: 3px; flex-shrink: 0;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <i class="${mod.icon}" style="color: var(--SmartThemeQuoteColor, #4a90e2); flex-shrink: 0;"></i>
                                    <span style="white-space: nowrap;">${escapeHtml(mod.name)}</span>
                                    ${mod.isThemes ? `<span style="font-size: 11px; opacity: 0.7; font-weight: normal; white-space: nowrap;">(备份包内含 ${themeList.length} 个主题)</span>` : ''}
                                </div>
                                <div style="font-size: 11.5px; opacity: 0.65; margin-top: 2px;">
                                    ${escapeHtml(mod.desc)}
                                </div>
                            </div>
                        </label>
                    `).join('')}
                </div>

                <!-- 主题精细选择容器（若包含主题） -->
                ${themeList.length > 0 ? `
                    <div id="tm-imp-themes-subpanel" style="border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px; background: rgba(0,0,0,0.15); margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                            <span style="font-weight: bold; font-size: 12.5px; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                                <i class="fa-solid fa-list-check" style="color: var(--SmartThemeQuoteColor, #4a90e2);"></i> 勾选需要恢复导入的美化主题
                            </span>
                            <span id="tm-imp-theme-count-badge" style="font-size: 11.5px; opacity: 0.75; white-space: nowrap;">已选: ${themeList.length} / ${themeList.length}</span>
                        </div>
                        <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center; flex-wrap: wrap;">
                            <input type="text" id="tm-imp-theme-search" class="text_pole" placeholder="搜索主题名称..." style="flex: 1 1 140px; min-width: 110px; height: 28px; font-size: 11.5px; padding: 2px 8px; margin: 0; box-sizing: border-box;">
                            <div style="display: flex; flex-direction: row; gap: 6px; flex-shrink: 0; align-items: center;">
                                <button id="tm-imp-theme-select-all" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">全选</button>
                                <button id="tm-imp-theme-unselect-all" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">全不选</button>
                                <button id="tm-imp-theme-range-select" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;" title="连选：选中首尾已勾选主题之间的全部美化">连选</button>
                                <button id="tm-imp-theme-invert" class="menu_button" style="padding: 3px 8px; font-size: 11.5px; white-space: nowrap; flex-shrink: 0;">反选</button>
                            </div>
                        </div>
                        <div id="tm-imp-theme-list" style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 6px; background: rgba(255,255,255,0.01);">
                            ${themeList.map(t => {
                                const themeName = t.name || t.value || '';
                                return `
                                    <label class="tm-imp-theme-row" data-theme-name="${escapeHtml(themeName.toLowerCase())}" style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 6px; border-radius: 4px; cursor: pointer; user-select: none;">
                                        <input type="checkbox" class="tm-imp-theme-cb" value="${escapeHtml(themeName)}" checked style="flex-shrink: 0;">
                                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(themeName)}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        await callGenericPopup(importDlgHtml, 'confirm', null, {
            title: '选择性备份恢复导入',
            okButton: '确认导入',
            cancelButton: '取消',
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                if (!dlg) return;

                const themeSubpanel = dlg.querySelector('#tm-imp-themes-subpanel');
                const themesModCb = dlg.querySelector('.tm-imp-mod-cb[data-mod-id="themes"]');
                const modCheckboxes = dlg.querySelectorAll('.tm-imp-mod-cb');
                const themeCheckboxes = dlg.querySelectorAll('.tm-imp-theme-cb');
                const themeCountBadge = dlg.querySelector('#tm-imp-theme-count-badge');
                const themeSearchInput = dlg.querySelector('#tm-imp-theme-search');
                const themeRows = dlg.querySelectorAll('.tm-imp-theme-row');

                const updateThemeCount = () => {
                    const checkedCount = dlg.querySelectorAll('.tm-imp-theme-cb:checked').length;
                    if (themeCountBadge) {
                        themeCountBadge.textContent = `已选: ${checkedCount} / ${themeList.length}`;
                    }
                };

                const updateThemesSubpanelVisibility = () => {
                    if (themeSubpanel && themesModCb) {
                        themeSubpanel.style.display = themesModCb.checked ? 'block' : 'none';
                    }
                };

                if (themesModCb) {
                    themesModCb.addEventListener('change', updateThemesSubpanelVisibility);
                }

                // 模块全选/清空
                dlg.querySelector('#tm-imp-select-all-mod')?.addEventListener('click', () => {
                    modCheckboxes.forEach(cb => { cb.checked = true; });
                    updateThemesSubpanelVisibility();
                });
                dlg.querySelector('#tm-imp-clear-all-mod')?.addEventListener('click', () => {
                    modCheckboxes.forEach(cb => { cb.checked = false; });
                    updateThemesSubpanelVisibility();
                });

                // 主题搜索过滤
                if (themeSearchInput) {
                    themeSearchInput.addEventListener('input', (e) => {
                        const kw = (e.target.value || '').trim().toLowerCase();
                        themeRows.forEach(row => {
                            const name = row.getAttribute('data-theme-name') || '';
                            row.style.display = (!kw || name.includes(kw)) ? 'flex' : 'none';
                        });
                    });
                }

                // 主题全选/全不选/连选/反选
                dlg.querySelector('#tm-imp-theme-select-all')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-imp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = true;
                    });
                    updateThemeCount();
                });
                dlg.querySelector('#tm-imp-theme-unselect-all')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-imp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = false;
                    });
                    updateThemeCount();
                });
                dlg.querySelector('#tm-imp-theme-range-select')?.addEventListener('click', () => {
                    const visibleRows = Array.from(themeRows).filter(row => row.style.display !== 'none');
                    const selectedIndices = [];
                    visibleRows.forEach((row, idx) => {
                        const cb = row.querySelector('.tm-imp-theme-cb');
                        if (cb && cb.checked) selectedIndices.push(idx);
                    });

                    if (selectedIndices.length < 2) {
                        toastr.info('请先至少勾选 2 个主题作为连选的【起点】和【终点】。');
                        return;
                    }

                    const start = selectedIndices[0];
                    const end = selectedIndices[selectedIndices.length - 1];

                    for (let i = start; i <= end; i++) {
                        const cb = visibleRows[i].querySelector('.tm-imp-theme-cb');
                        if (cb) cb.checked = true;
                    }

                    updateThemeCount();
                    toastr.success(`连选成功！已覆盖区间内的 ${end - start + 1} 个主题。`);
                });
                dlg.querySelector('#tm-imp-theme-invert')?.addEventListener('click', () => {
                    themeCheckboxes.forEach(cb => {
                        const row = cb.closest('.tm-imp-theme-row');
                        if (row && row.style.display !== 'none') cb.checked = !cb.checked;
                    });
                    updateThemeCount();
                });

                let lastImpCheckedIndex = -1;
                themeCheckboxes.forEach((cb, idx) => {
                    cb.addEventListener('click', (e) => {
                        if (e.shiftKey && lastImpCheckedIndex !== -1 && lastImpCheckedIndex !== idx) {
                            const startIdx = Math.min(lastImpCheckedIndex, idx);
                            const endIdx = Math.max(lastImpCheckedIndex, idx);
                            const targetChecked = cb.checked;
                            for (let i = startIdx; i <= endIdx; i++) {
                                const targetCb = themeCheckboxes[i];
                                if (targetCb) targetCb.checked = targetChecked;
                            }
                        }
                        lastImpCheckedIndex = idx;
                        updateThemeCount();
                    });
                });

                // 确认导入按钮事件
                const okBtn = dlg.querySelector('.popup-button-ok');
                if (okBtn) {
                    okBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const selectedModIds = Array.from(modCheckboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-mod-id'));
                        const importThemesMod = selectedModIds.includes('themes');
                        const selectedThemeNames = new Set(
                            importThemesMod ? Array.from(themeCheckboxes).filter(cb => cb.checked).map(cb => cb.value) : []
                        );

                        if (selectedModIds.length === 0 || (importThemesMod && selectedModIds.length === 1 && selectedThemeNames.size === 0)) {
                            toastr.warning('请至少选择一个需要恢复的模块或主题。');
                            return;
                        }

                        closePopup(popup);
                        showLoader();

                        try {
                            let themeOk = 0, themeFail = 0;
                            const themesToImport = importThemesMod
                                ? themeList.filter(t => selectedThemeNames.has(t.name || t.value))
                                : [];

                            // 1. 写入选中的主题文件（带并发限制）
                            if (themesToImport.length > 0) {
                                await limitConcurrency(4, themesToImport, async (themeObj) => {
                                    if (!themeObj || !themeObj.name) { themeFail++; return; }
                                    try {
                                        const { mtime: _m, ...cleanObj } = themeObj;
                                        await apiRequest('themes/save', 'POST', cleanObj, true);
                                        allThemeObjectsMap.set(themeObj.name, themeObj);
                                        recordThemeMtime(themeObj.name, Date.now());
                                        themeOk++;
                                    } catch (err) {
                                        console.error(`[Theme Manager] 恢复主题失败 "${themeObj.name}":`, err);
                                        themeFail++;
                                    }
                                });
                            }

                            // 2. 写入选中的配置模块
                            const keysToRestore = new Set();
                            BACKUP_MODULE_DEFS.forEach(mod => {
                                if (selectedModIds.includes(mod.id) && mod.keys) {
                                    mod.keys.forEach(k => keysToRestore.add(k));
                                }
                            });

                            let settingsCount = 0;
                            keysToRestore.forEach(key => {
                                if (settingsMap[key] !== undefined && settingsMap[key] !== null) {
                                    localStorage.setItem(key, settingsMap[key]);
                                    settingsCount++;
                                }
                            });

                            if (typeof onRestoreComplete === 'function') {
                                await onRestoreComplete({
                                    themesToImport,
                                    keysToRestore,
                                    themeOk,
                                    themeFail,
                                    settingsCount,
                                    importThemesMod
                                });
                            }

                            let summary = `备份恢复完成！`;
                            if (importThemesMod) summary += ` 主题：成功 ${themeOk} 个${themeFail > 0 ? ` (失败 ${themeFail})` : ''}；`;
                            summary += ` 配置恢复：${settingsCount} 条。`;

                            if (themeFail > 0) {
                                toastr.warning(summary, '恢复完成');
                            } else {
                                toastr.success(summary, '恢复完成');
                            }
                        } catch (err) {
                            console.error('[Theme Manager] 恢复备份发生异常:', err);
                            toastr.error('导入恢复发生异常: ' + (err.message || err));
                        } finally {
                            hideLoader();
                        }
                    });
                }
            }
        });
    }

    return {
        BACKUP_MODULE_DEFS,
        openCustomExportModal,
        openCustomImportModal,
        handleBackupFileInputChange,
        triggerFullImport
    };
}
