/**
 * modules/batch-delete.js
 * 批量删除美化主题模块
 */

export function initBatchDelete(config) {
    const {
        getSelectedForBatch,
        clearSelectedForBatch,
        setLastClickedThemeName = () => {},
        confirmAction,
        findThemeObject,
        findOptionByValue,
        originalSelect,
        suspendObserver = (fn) => fn(),
        limitConcurrency,
        deleteTheme,
        themeItemMap,
        allParsedThemes,
        allParsedThemesMap,
        allThemeObjects,
        allThemeObjectsMap,
        stKnownThemes,
        themeBackgroundBindings,
        THEME_BACKGROUND_BINDINGS_KEY,
        getFavorites,
        setFavorites,
        updateFavorites,
        loadThemeTags,
        saveThemeTags,
        applyThemeDirect,
        renderTagsUI,
        updateActiveState,
        toastr,
        invalidateThemesCache
    } = config;

    async function performBatchDelete() {
        const selectedForBatch = getSelectedForBatch();
        if (!selectedForBatch || selectedForBatch.size === 0) {
            toastr.info('请先选择至少一个主题。');
            return;
        }
        const deleteCount = selectedForBatch.size;
        const confirmed = await confirmAction(`确定要删除选中的 ${deleteCount} 个主题吗？`);
        if (!confirmed) return;

        const deletedThemes = Array.from(selectedForBatch);
        const successSet = new Set(deletedThemes);

        // ⚠️ 必须在清内存前先快照每个主题的完整对象（deleteTheme 需要 name 字段来定位磁盘文件）
        const themeObjSnapshots = new Map();
        deletedThemes.forEach(name => {
            const obj = findThemeObject(name);
            if (obj) themeObjSnapshots.set(name, obj);
        });

        // 0ms 乐观 UI 更新：立刻清除选择状态与视口 DOM 节点
        clearSelectedForBatch();
        setLastClickedThemeName(null);

        // 1. 批量更新 ST 原生下拉框
        suspendObserver(() => {
            deletedThemes.forEach(themeName => {
                const optionToDelete = findOptionByValue(originalSelect, themeName);
                if (optionToDelete) optionToDelete.remove();
            });
        });

        // 2. 批量同步 ST 内部主题内存
        try {
            const contexts = [];
            const pu = typeof power_user !== 'undefined' ? power_user : (window.power_user || (typeof SillyTavern !== 'undefined' && SillyTavern.getContext?.()?.powerUserSettings));
            if (pu) contexts.push(pu);
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                const ctx = SillyTavern.getContext();
                if (ctx) contexts.push(ctx);
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

        // 3. 批量删除主题 UI 状态与缓存
        deletedThemes.forEach(themeName => {
            const item = themeItemMap.get(themeName);
            if (item) {
                item.remove();
                themeItemMap.delete(themeName);
            }

            const idx = allParsedThemes.findIndex(t => t.value === themeName);
            if (idx > -1) {
                allParsedThemes.splice(idx, 1);
                allParsedThemesMap.delete(themeName);
            }

            const objIndex = allThemeObjects.findIndex(t => t.name === themeName || t.value === themeName);
            if (objIndex > -1) {
                allThemeObjects.splice(objIndex, 1);
            }
            allThemeObjectsMap.set(themeName, null);
            allThemeObjectsMap.delete(themeName);
            stKnownThemes.delete(themeName);

            if (themeBackgroundBindings[themeName]) {
                delete themeBackgroundBindings[themeName];
            }
        });

        // 4. 清理收藏和标签数据
        let currentFavs = getFavorites ? getFavorites() : [];
        currentFavs = currentFavs.filter(f => !successSet.has(f));
        if (setFavorites) setFavorites(currentFavs);

        let tagsToUpdate = loadThemeTags();
        tagsToUpdate.forEach(tag => {
            if (tag.themes) {
                tag.themes = tag.themes.filter(t => !successSet.has(t));
            }
        });

        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
        updateFavorites(currentFavs);
        saveThemeTags(tagsToUpdate);

        // 5. 切换激活状态，如果被删的主题是当前激活的
        const isCurrentlyActiveDeleted = successSet.has(originalSelect.value);
        if (isCurrentlyActiveDeleted) {
            const azureOption = findOptionByValue(originalSelect, 'Azure');
            const fallbackName = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
            if (fallbackName) {
                applyThemeDirect(fallbackName);
            }
        }

        // 0ms 瞬间完成 UI 刷新与提示
        renderTagsUI(tagsToUpdate);
        updateActiveState();
        toastr.success(`已成功批量删除 ${deleteCount} 个美化主题！`);

        // 后台高并发 (25) 异步执行物理磁盘文件擦除（使用提前快照的 themeObj，此时 ST 内存已清除）
        (async () => {
            try {
                await limitConcurrency(25, deletedThemes, name => {
                    const themeObj = themeObjSnapshots.get(name) || null;
                    return deleteTheme(name, themeObj);
                });

                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                }
                invalidateThemesCache();
            } catch (err) {
                console.error('[Theme Manager] 异步批量删除物理文件异常:', err);
            }
        })();
    }

    return {
        performBatchDelete
    };
}
