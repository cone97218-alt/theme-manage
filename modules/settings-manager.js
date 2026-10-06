/**
 * modules/settings-manager.js
 * 扩展设置导出、导入、重置与高级设置面板弹窗交互
 */

export function initSettingsManager(config) {
    const {
        settingsKeysToSync,
        callGenericPopup,
        closePopup,
        toastr,
        invalidateTagsCache = () => {},
        invalidateThemesCache = () => {},
        loadThemeTags = () => [],
        buildThemeTagIndex = () => {},
        applyKeywordMappings = () => {},
        loadThemeDayNightPairs = () => ({}),
        getTagsForTheme = (v, t) => [],
        getAllParsedThemes = () => [],
        getContentWrapper = () => null,
        getThemeItemMap = () => new Map(),
        getUsageCount = () => ({}),
        updateThemeItemDayNightState = () => {},
        softRefreshUI = () => {},
        updateActiveState = () => {},
        checkAutoTheme = () => {},
        updateManualToggleBtnVisibility = () => {},
        registerReplaceImageButtons = () => {},
        removeReplaceImageButtons = () => {},
        openCustomExportModal = () => {},
        getSettingsFileInput = () => null,
        getFullBackupFileInput = () => null,
        hardResyncThemes = () => {},
        getFavorites = () => [],
        setFavorites = () => {},
        setAutoThemeSettings = () => {},
        getAutoThemeSettings = () => ({}),
        keys = {}
    } = config;

    const {
        TWO_LINE_LAYOUT_KEY = 'themeManager_twoLineLayout',
        TAG_PILL_MODE_KEY = 'themeManager_tagPillDisplayMode',
        HIDE_TAG_PILLS_KEY = 'themeManager_hideTagPills',
        SHOW_USAGE_COUNT_KEY = 'themeManager_showUsageCount',
        ENABLE_DAYNIGHT_BINDING_KEY = 'themeManager_enableDayNightBinding',
        ENABLE_REPLACE_AVATAR_BTN_KEY = 'themeManager_enableReplaceAvatarBtn',
        ENABLE_AVATAR_HELPER_KEY = 'themeManager_enableAvatarHelper',
        ENABLE_COLOR_TRANSFER_KEY = 'themeManager_enableColorTransfer',
        TAG_FILTER_MODE_KEY = 'themeManager_tagFilterMode',
        USAGE_COUNT_KEY = 'themeManager_usageCount',
        FAVORITES_KEY = 'themeManager_favorites',
        THEME_DAY_NIGHT_PAIRS_KEY = 'themeManager_themeDayNightPairs',
        AUTO_THEME_KEY = 'themeManager_autoThemeSettings'
    } = keys;

    function exportSettings() {
        const settingsToExport = {};
        settingsKeysToSync.forEach(key => {
            const value = localStorage.getItem(key);
            if (value !== null) {
                settingsToExport[key] = value;
            }
        });

        const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'theme_manager_config.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastr.success('配置已成功导出！');
    }

    async function importSettings(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const content = await file.text();
            const settingsToImport = JSON.parse(content);

            let importCount = 0;
            for (const key in settingsToImport) {
                if (settingsKeysToSync.includes(key)) {
                    localStorage.setItem(key, settingsToImport[key]);
                    importCount++;
                }
            }

            toastr.success(`成功导入 ${importCount} 条配置！`, '导入成功 (已实时热更新)');

            // 1. 刷新缓存
            invalidateTagsCache();
            invalidateThemesCache();

            // 2. 重新加载内存中的全局变量 (实现无需刷新的热更新)
            const isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
            const hideTagPills = localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true';
            const tagPillDisplayMode = localStorage.getItem(TAG_PILL_MODE_KEY) || (hideTagPills ? 'none' : 'all');
            const showUsageCount = localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true';
            const enableAvatarHelper = localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) === 'true';
            const enableColorTransfer = localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true';
            const enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false';
            const enableReplaceAvatarBtn = localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) === 'true';

            let usageCount = getUsageCount();
            if (localStorage.getItem(USAGE_COUNT_KEY)) {
                try {
                    usageCount = JSON.parse(localStorage.getItem(USAGE_COUNT_KEY)) || {};
                } catch (e) { }
            }
            if (localStorage.getItem(FAVORITES_KEY)) {
                try {
                    const favs = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                    setFavorites(favs);
                } catch (e) { }
            }
            if (localStorage.getItem(THEME_DAY_NIGHT_PAIRS_KEY)) {
                loadThemeDayNightPairs();
            }
            if (localStorage.getItem(AUTO_THEME_KEY)) {
                try {
                    const ats = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || getAutoThemeSettings();
                    setAutoThemeSettings(ats);
                } catch (e) { }
            }

            // 3. 应用关键词自动映射
            applyKeywordMappings();

            // 4. 重新构建标签与主题关联索引
            const freshTags = loadThemeTags();
            buildThemeTagIndex(freshTags);
            const allParsedThemes = getAllParsedThemes();
            if (allParsedThemes && allParsedThemes.length > 0) {
                allParsedThemes.forEach(t => {
                    t.tags = getTagsForTheme(t.value, freshTags);
                });
            }

            // 5. 更新容器 Layout Class
            const contentWrapper = getContentWrapper();
            if (contentWrapper) {
                contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                contentWrapper.classList.toggle('hide-tag-pills', hideTagPills);
            }

            // 6. 派发事件与更新扩展辅助模块
            document.dispatchEvent(new CustomEvent('themeManager:enableAvatarHelperChanged', { detail: enableAvatarHelper }));
            updateManualToggleBtnVisibility();

            if (enableReplaceAvatarBtn) {
                registerReplaceImageButtons();
            } else {
                removeReplaceImageButtons();
            }

            // 7. 更新已渲染卡片的局部按钮与状态
            const themeItemMap = getThemeItemMap();
            themeItemMap.forEach((item, themeName) => {
                const colorBtn = item.querySelector('.color-transfer-btn');
                if (colorBtn) colorBtn.style.display = enableColorTransfer ? 'inline-flex' : 'none';

                const daynightBtn = item.querySelector('.link-daynight-btn');
                if (daynightBtn) daynightBtn.style.display = enableDayNightBinding ? 'inline-flex' : 'none';

                const usageSpan = item.querySelector('.theme-usage-count');
                if (usageSpan) {
                    if (showUsageCount && usageCount[themeName]) {
                        usageSpan.textContent = usageCount[themeName];
                        usageSpan.style.display = '';
                    } else {
                        usageSpan.style.display = 'none';
                    }
                }

                updateThemeItemDayNightState(themeName);
            });

            // 8. 若高级设置弹窗已打开，同步更新弹窗内部按钮控件状态
            const settingsDlg = document.querySelector('.tm-settings-popup');
            if (settingsDlg) {
                const btnTwoLine = settingsDlg.querySelector('#tm-pop-toggle-twoline');
                if (btnTwoLine) {
                    btnTwoLine.classList.toggle('active', isTwoLineLayout);
                    btnTwoLine.innerHTML = `<i class="fa-solid fa-align-left"></i> 换行排版 (${isTwoLineLayout ? '开启' : '关闭'})`;
                }
                const btnUsage = settingsDlg.querySelector('#tm-pop-toggle-usage');
                if (btnUsage) {
                    btnUsage.classList.toggle('active', showUsageCount);
                    btnUsage.innerHTML = `<i class="fa-solid fa-chart-bar"></i> 使用统计 (${showUsageCount ? '开启' : '关闭'})`;
                }
                const btnDayNight = settingsDlg.querySelector('#tm-pop-toggle-daynight');
                if (btnDayNight) {
                    btnDayNight.classList.toggle('active', enableDayNightBinding);
                    btnDayNight.innerHTML = `<i class="fa-solid fa-circle-half-stroke"></i> 日夜图标 (${enableDayNightBinding ? '开启' : '关闭'})`;
                }
                const btnReplace = settingsDlg.querySelector('#tm-pop-toggle-replace');
                if (btnReplace) {
                    btnReplace.classList.toggle('active', enableReplaceAvatarBtn);
                    btnReplace.innerHTML = `<i class="fa-solid fa-check"></i> 详情页替换 (${enableReplaceAvatarBtn ? '开启' : '关闭'})`;
                }
                const btnAvatar = settingsDlg.querySelector('#tm-pop-toggle-avatar');
                if (btnAvatar) {
                    btnAvatar.classList.toggle('active', enableAvatarHelper);
                    btnAvatar.innerHTML = `<i class="fa-solid fa-user-gear"></i> 头像管理 (${enableAvatarHelper ? '开启' : '关闭'})`;
                }
                const btnColor = settingsDlg.querySelector('#tm-pop-toggle-color');
                if (btnColor) {
                    btnColor.classList.toggle('active', enableColorTransfer);
                    btnColor.innerHTML = `<i class="fa-solid fa-palette"></i> 提取配色 (${enableColorTransfer ? '开启' : '关闭'})`;
                }
                const selectPillMode = settingsDlg.querySelector('#tm-pop-select-tag-pill-mode');
                if (selectPillMode) {
                    selectPillMode.value = tagPillDisplayMode;
                    const iconMap = {
                        'all': 'fa-solid fa-tags',
                        'l1': 'fa-solid fa-folder-tree',
                        'l2': 'fa-solid fa-tag',
                        'none': 'fa-solid fa-eye-slash'
                    };
                    const iconEl = settingsDlg.querySelector('#tm-pill-mode-icon');
                    if (iconEl) iconEl.className = iconMap[tagPillDisplayMode] || 'fa-solid fa-tags';
                }
            }

            // 9. 刷新 UI 与激活状态
            softRefreshUI();
            updateActiveState();

            if (checkAutoTheme) {
                checkAutoTheme();
            }

        } catch (error) {
            console.error('导入配置失败:', error);
            toastr.error(`导入失败，文件可能已损坏或格式不正确。错误: ${error.message}`);
        } finally {
            event.target.value = '';
        }
    }

    async function openResetSystemModal() {
        const popupContent = document.createElement('div');
        popupContent.innerHTML = `
            <h4><i class="fa-solid fa-triangle-exclamation" style="color:#ff8888; margin-right:6px;"></i>重置美化插件数据</h4>
            <p style="font-size:12px; opacity:0.8; margin-bottom:12px; text-align:left;">请勾选您需要清除的数据模块（此操作不可逆）：</p>
            <div style="display:flex; flex-direction:column; gap:8px; margin:10px 0; text-align:left; padding-left:10px;">
                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="reset-opt-tags" checked> 重置美化标签与分类设置
                </label>
                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="reset-opt-bindings" checked> 重置角色卡美化自动映射
                </label>
                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="reset-opt-avatars" checked> 重置头像高级设置（缩放/偏移/框/图库）
                </label>
            </div>
            <p style="font-size:11px; color:#ff8888; margin-top:10px; text-align:left;">确认重置后，网页将会自动刷新以载入默认状态。</p>
        `;

        await callGenericPopup(popupContent, 'confirm', null, {
            okButton: '确认重置',
            cancelButton: '取消',
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                if (dlg) {
                    dlg.style.width = '90%';
                    dlg.style.maxWidth = '450px';
                }
                const okButton = dlg.querySelector('.popup-button-ok');
                if (okButton) {
                    okButton.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
                    okButton.style.color = '#fff';
                    okButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        const doTags = dlg.querySelector('#reset-opt-tags').checked;
                        const doBindings = dlg.querySelector('#reset-opt-bindings').checked;
                        const doAvatars = dlg.querySelector('#reset-opt-avatars').checked;

                        let clearedCount = 0;
                        if (doTags) {
                            localStorage.removeItem('themeManager_themeTags');
                            localStorage.removeItem('themeManager_activeTagsFilters');
                            clearedCount++;
                        }
                        if (doBindings) {
                            localStorage.removeItem('themeManager_characterThemeBindings');
                            clearedCount++;
                        }
                        if (doAvatars) {
                            localStorage.removeItem('themeManager_avatarAdjustments');
                            localStorage.removeItem('themeManager_customFrames');
                            localStorage.removeItem('themeManager_avatarPanelGeometry');
                            localStorage.removeItem('themeManager_disableAvatarZoom');
                            clearedCount++;
                        }

                        if (clearedCount > 0) {
                            toastr.success('选定数据已成功重置，正在重新载入页面...');
                            setTimeout(() => location.reload(), 1000);
                        } else {
                            toastr.info('未勾选任何重置选项。');
                        }
                        closePopup(popup);
                    });
                }
            }
        });
    }

    async function openSettingsPopup() {
        let isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
        let showUsageCount = localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true';
        let enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false';
        let enableReplaceAvatarBtn = localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) !== 'false';
        let hideTagPills = localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true';
        let tagPillDisplayMode = localStorage.getItem(TAG_PILL_MODE_KEY) || (hideTagPills ? 'none' : 'all');
        let enableAvatarHelper = localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) !== 'false';
        let enableColorTransfer = localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true';

        const getPopupHtml = () => `
            <div class="tm-settings-popup" style="max-height: 75vh; overflow-y: auto; overflow-x: hidden; padding-right: 4px; box-sizing: border-box;">
                <div style="margin-bottom: 14px;">
                    <h4 class="tm-settings-section-title">
                        <i class="fa-solid fa-sliders" style="margin-right: 6px;"></i> 视图与显示设置
                    </h4>
                    <div class="tm-settings-buttons-flex">
                        <button id="tm-pop-toggle-twoline" class="menu_button ${isTwoLineLayout ? 'active' : ''}"><i class="fa-solid fa-align-left"></i> 换行排版 (${isTwoLineLayout ? '开启' : '关闭'})</button>
                        <button id="tm-pop-toggle-usage" class="menu_button ${showUsageCount ? 'active' : ''}"><i class="fa-solid fa-chart-bar"></i> 使用统计 (${showUsageCount ? '开启' : '关闭'})</button>
                        <button id="tm-pop-toggle-daynight" class="menu_button ${enableDayNightBinding ? 'active' : ''}"><i class="fa-solid fa-circle-half-stroke"></i> 日夜图标 (${enableDayNightBinding ? '开启' : '关闭'})</button>
                        <button id="tm-pop-toggle-replace" class="menu_button ${enableReplaceAvatarBtn ? 'active' : ''}"><i class="fa-solid fa-check"></i> 详情页替换 (${enableReplaceAvatarBtn ? '开启' : '关闭'})</button>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                        <label for="tm-pop-select-tag-pill-mode" style="font-size: 12.5px; margin: 0; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <i id="tm-pill-mode-icon" class="${tagPillDisplayMode === 'none' ? 'fa-solid fa-eye-slash' : (tagPillDisplayMode === 'l1' ? 'fa-solid fa-folder-tree' : (tagPillDisplayMode === 'leaf' ? 'fa-solid fa-tag' : 'fa-solid fa-tags'))}" style="color: var(--SmartThemeQuoteColor, #4a90e2);"></i> 标签胶囊显示范围：
                        </label>
                        <select id="tm-pop-select-tag-pill-mode" class="text_pole" style="font-size: 12px; height: 28px; padding: 2px 8px; width: 210px; margin: 0;">
                            <option value="all" ${tagPillDisplayMode === 'all' ? 'selected' : ''}>显示全部层级标签 (所有分类)</option>
                            <option value="l1" ${tagPillDisplayMode === 'l1' ? 'selected' : ''}>仅显示顶级主分类 (一级标签)</option>
                            <option value="l2" ${tagPillDisplayMode === 'l2' || tagPillDisplayMode === 'sub' ? 'selected' : ''}>仅显示所有子级标签 (二级及以上)</option>
                            <option value="leaf" ${tagPillDisplayMode === 'leaf' ? 'selected' : ''}>仅显示末级细分标签 (最深子标签)</option>
                            <option value="none" ${tagPillDisplayMode === 'none' ? 'selected' : ''}>完全隐藏标签胶囊</option>
                        </select>
                    </div>
                </div>

                <div style="margin-bottom: 14px;">
                    <h4 class="tm-settings-section-title">
                        <i class="fa-solid fa-cubes" style="margin-right: 6px;"></i> 核心扩展功能
                    </h4>
                    <div class="tm-settings-buttons-flex">
                        <button id="tm-pop-toggle-avatar" class="menu_button ${enableAvatarHelper ? 'active' : ''}"><i class="fa-solid fa-user-gear"></i> 头像管理 (${enableAvatarHelper ? '开启' : '关闭'})</button>
                        <button id="tm-pop-toggle-color" class="menu_button ${enableColorTransfer ? 'active' : ''}"><i class="fa-solid fa-palette"></i> 提取配色 (${enableColorTransfer ? '开启' : '关闭'})</button>
                    </div>
                </div>

                <div style="margin-bottom: 14px;">
                    <h4 class="tm-settings-section-title">
                        <i class="fa-solid fa-database" style="margin-right: 6px;"></i> 拓展数据管理
                    </h4>
                    <div style="font-size: 11.5px; opacity: 0.65; margin-bottom: 6px; padding: 0 2px;">
                        <i class="fa-solid fa-circle-info" style="margin-right: 4px;"></i>
                        <b>轻量配置导出/导入</b>：仅备份标签、收藏、绑定、显示设置等纯配置数据（不含美化文件）。
                    </div>
                    <div class="tm-settings-buttons-flex" style="margin-bottom: 8px;">
                        <button id="tm-pop-export-data" class="menu_button"><i class="fa-solid fa-file-export"></i> 导出配置</button>
                        <button id="tm-pop-import-data" class="menu_button"><i class="fa-solid fa-file-import"></i> 导入配置</button>
                    </div>
                    <div style="font-size: 11.5px; opacity: 0.65; margin-bottom: 6px; padding: 0 2px;">
                        <i class="fa-solid fa-box-archive" style="margin-right: 4px;"></i>
                        <b>自定义备份/恢复</b>：可按需自由勾选备份/恢复具体模块（主题文件、标签、日夜、头像、背景等），并支持挑选具体美化。
                    </div>
                    <div class="tm-settings-buttons-flex">
                        <button id="tm-pop-full-export" class="menu_button" style="color: var(--SmartThemeQuoteColor, #4a90e2);"><i class="fa-solid fa-box-archive"></i> 自定义备份导出</button>
                        <button id="tm-pop-full-import" class="menu_button" style="color: var(--SmartThemeQuoteColor, #4a90e2);"><i class="fa-solid fa-cloud-arrow-up"></i> 备份恢复导入</button>
                    </div>
                </div>

                <div style="margin-bottom: 8px;">
                    <h4 class="tm-settings-section-title">
                        <i class="fa-solid fa-wrench" style="margin-right: 6px;"></i> 高级与系统维保
                    </h4>
                    <div class="tm-settings-buttons-flex">
                        <button id="tm-pop-sync-disk" class="menu_button"><i class="fa-solid fa-arrows-rotate"></i> 对照磁盘</button>
                        <button id="tm-pop-reset-system" class="menu_button"><i class="fa-solid fa-triangle-exclamation"></i> 重置数据</button>
                    </div>
                </div>
            </div>
        `;

        await callGenericPopup(getPopupHtml(), 'confirm', null, {
            title: '美化插件高级设置',
            okButton: '关闭',
            cancelButton: null,
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                const contentWrapper = getContentWrapper();
                const themeItemMap = getThemeItemMap();
                const usageCount = getUsageCount();

                const btnTwoLine = dlg.querySelector('#tm-pop-toggle-twoline');
                if (btnTwoLine) {
                    btnTwoLine.addEventListener('click', () => {
                        isTwoLineLayout = !isTwoLineLayout;
                        localStorage.setItem(TWO_LINE_LAYOUT_KEY, isTwoLineLayout ? 'true' : 'false');
                        btnTwoLine.classList.toggle('active', isTwoLineLayout);
                        btnTwoLine.innerHTML = `<i class="fa-solid fa-align-left"></i> 换行排版 (${isTwoLineLayout ? '开启' : '关闭'})`;
                        if (contentWrapper) contentWrapper.classList.toggle('two-line-layout', isTwoLineLayout);
                        toastr.info(`美化列表已切换为: ${isTwoLineLayout ? '换行排版模式' : '常规单行模式'}`);
                    });
                }

                const selectPillMode = dlg.querySelector('#tm-pop-select-tag-pill-mode');
                if (selectPillMode) {
                    selectPillMode.addEventListener('change', (e) => {
                        tagPillDisplayMode = e.target.value;
                        localStorage.setItem(TAG_PILL_MODE_KEY, tagPillDisplayMode);
                        hideTagPills = (tagPillDisplayMode === 'none');
                        localStorage.setItem(HIDE_TAG_PILLS_KEY, hideTagPills ? 'true' : 'false');
                        
                        if (contentWrapper) {
                            contentWrapper.classList.toggle('hide-tag-pills', hideTagPills);
                        }

                        const iconMap = {
                            'all': 'fa-solid fa-tags',
                            'l1': 'fa-solid fa-folder-tree',
                            'l2': 'fa-solid fa-tag',
                            'none': 'fa-solid fa-eye-slash'
                        };
                        const iconEl = dlg.querySelector('#tm-pill-mode-icon');
                        if (iconEl) iconEl.className = iconMap[tagPillDisplayMode] || 'fa-solid fa-tags';

                        softRefreshUI();

                        const labels = {
                            'all': '显示全部层级标签',
                            'l1': '仅显示顶级主分类',
                            'l2': '仅显示所有子级标签',
                            'sub': '仅显示所有子级标签',
                            'leaf': '仅显示末级细分标签',
                            'none': '完全隐藏标签胶囊'
                        };
                        toastr.info(`标签胶囊显示模式已切换为：${labels[tagPillDisplayMode] || tagPillDisplayMode}`);
                    });
                }

                const btnUsage = dlg.querySelector('#tm-pop-toggle-usage');
                if (btnUsage) {
                    btnUsage.addEventListener('click', () => {
                        showUsageCount = !showUsageCount;
                        localStorage.setItem(SHOW_USAGE_COUNT_KEY, showUsageCount ? 'true' : 'false');
                        btnUsage.classList.toggle('active', showUsageCount);
                        btnUsage.innerHTML = `<i class="fa-solid fa-chart-bar"></i> 使用统计 (${showUsageCount ? '开启' : '关闭'})`;
                        themeItemMap.forEach((item, themeName) => {
                            const usageSpan = item.children[0]?.querySelector('.theme-usage-count');
                            if (usageSpan) {
                                if (showUsageCount && usageCount[themeName]) {
                                    usageSpan.textContent = usageCount[themeName];
                                    usageSpan.style.display = '';
                                } else {
                                    usageSpan.style.display = 'none';
                                }
                            }
                        });
                    });
                }

                const btnDayNight = dlg.querySelector('#tm-pop-toggle-daynight');
                if (btnDayNight) {
                    btnDayNight.addEventListener('click', () => {
                        enableDayNightBinding = !enableDayNightBinding;
                        localStorage.setItem(ENABLE_DAYNIGHT_BINDING_KEY, String(enableDayNightBinding));
                        btnDayNight.classList.toggle('active', enableDayNightBinding);
                        btnDayNight.innerHTML = `<i class="fa-solid fa-circle-half-stroke"></i> 日夜图标 (${enableDayNightBinding ? '开启' : '关闭'})`;
                        toastr.info(`日夜绑定图标已${enableDayNightBinding ? '显示' : '隐藏'}`);
                        themeItemMap.forEach((item) => {
                            const btn = item.querySelector('.link-daynight-btn');
                            if (btn) btn.style.display = enableDayNightBinding ? 'inline-flex' : 'none';
                        });
                    });
                }

                const btnReplace = dlg.querySelector('#tm-pop-toggle-replace');
                if (btnReplace) {
                    btnReplace.addEventListener('click', () => {
                        enableReplaceAvatarBtn = !enableReplaceAvatarBtn;
                        localStorage.setItem(ENABLE_REPLACE_AVATAR_BTN_KEY, String(enableReplaceAvatarBtn));
                        btnReplace.classList.toggle('active', enableReplaceAvatarBtn);
                        btnReplace.innerHTML = `<i class="fa-solid fa-check"></i> 详情页替换 (${enableReplaceAvatarBtn ? '开启' : '关闭'})`;
                        toastr.info(`替换按键已${enableReplaceAvatarBtn ? '显示' : '隐藏'}`);
                        if (enableReplaceAvatarBtn) {
                            registerReplaceImageButtons();
                        } else {
                            removeReplaceImageButtons();
                        }
                    });
                }

                const btnAvatar = dlg.querySelector('#tm-pop-toggle-avatar');
                if (btnAvatar) {
                    btnAvatar.addEventListener('click', () => {
                        enableAvatarHelper = !enableAvatarHelper;
                        localStorage.setItem(ENABLE_AVATAR_HELPER_KEY, String(enableAvatarHelper));
                        btnAvatar.classList.toggle('active', enableAvatarHelper);
                        btnAvatar.innerHTML = `<i class="fa-solid fa-user-gear"></i> 头像管理 (${enableAvatarHelper ? '开启' : '关闭'})`;
                        document.dispatchEvent(new CustomEvent('themeManager:enableAvatarHelperChanged', { detail: enableAvatarHelper }));
                        toastr.info(`头像管理功能已${enableAvatarHelper ? '开启' : '关闭'}`);
                    });
                }

                const btnColor = dlg.querySelector('#tm-pop-toggle-color');
                if (btnColor) {
                    btnColor.addEventListener('click', () => {
                        enableColorTransfer = !enableColorTransfer;
                        localStorage.setItem(ENABLE_COLOR_TRANSFER_KEY, String(enableColorTransfer));
                        btnColor.classList.toggle('active', enableColorTransfer);
                        btnColor.innerHTML = `<i class="fa-solid fa-palette"></i> 提取配色 (${enableColorTransfer ? '开启' : '关闭'})`;
                        toastr.info(`提取配色功能已${enableColorTransfer ? '开启' : '关闭'}`);
                        themeItemMap.forEach((item) => {
                            const btn = item.querySelector('.color-transfer-btn');
                            if (btn) btn.style.display = enableColorTransfer ? 'inline-flex' : 'none';
                        });
                    });
                }

                const btnExport = dlg.querySelector('#tm-pop-export-data');
                if (btnExport) {
                    btnExport.addEventListener('click', exportSettings);
                }

                const btnImport = dlg.querySelector('#tm-pop-import-data');
                if (btnImport) {
                    btnImport.addEventListener('click', () => {
                        const input = getSettingsFileInput();
                        if (input) input.click();
                    });
                }

                const btnFullExport = dlg.querySelector('#tm-pop-full-export');
                if (btnFullExport) {
                    btnFullExport.addEventListener('click', () => openCustomExportModal());
                }

                const btnFullImport = dlg.querySelector('#tm-pop-full-import');
                if (btnFullImport) {
                    btnFullImport.addEventListener('click', () => {
                        const input = getFullBackupFileInput();
                        if (input) input.click();
                    });
                }

                const btnSync = dlg.querySelector('#tm-pop-sync-disk');
                if (btnSync) {
                    btnSync.addEventListener('click', () => {
                        closePopup(popup);
                        hardResyncThemes(true);
                    });
                }

                const btnReset = dlg.querySelector('#tm-pop-reset-system');
                if (btnReset) {
                    btnReset.addEventListener('click', () => {
                        closePopup(popup);
                        openResetSystemModal();
                    });
                }
            }
        });
    }

    return {
        exportSettings,
        importSettings,
        openResetSystemModal,
        openSettingsPopup
    };
}
