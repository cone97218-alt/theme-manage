/**
 * settings.js
 * 扩展高级设置面板与配置导入导出
 */

import { state, ctx } from './state.js';
import {
    FAVORITES_KEY, COLLAPSE_KEY, THEME_TAGS_KEY, THEME_BACKGROUND_BINDINGS_KEY,
    CHARACTER_THEME_BINDINGS_KEY, THEME_DAYNIGHT_PAIRS_KEY, AUTO_THEME_KEY,
    TAG_FILTER_MODE_KEY, ENABLE_SUBTAGS_KEY, ACTIVE_TAG_PATH_KEY, USAGE_COUNT_KEY,
    SHOW_USAGE_COUNT_KEY, ENABLE_AVATAR_HELPER_KEY, ENABLE_COLOR_TRANSFER_KEY,
    ENABLE_DAYNIGHT_BINDING_KEY, ENABLE_REPLACE_AVATAR_BTN_KEY, TWO_LINE_LAYOUT_KEY,
    HIDE_TAG_PILLS_KEY, TAG_PILL_MODE_KEY
} from './constants.js';
import { invalidateTagsCache, loadThemeTags, buildThemeTagIndex, getTagsForTheme } from './tags-core.js';
import { invalidateThemesCache } from './api.js';
import { softRefreshUI } from './tags-ui.js';
import { hardResyncThemes, applyKeywordMappings } from './theme-ui.js';

export const settingsKeysToSync = [
    FAVORITES_KEY, COLLAPSE_KEY, THEME_TAGS_KEY, THEME_BACKGROUND_BINDINGS_KEY,
    CHARACTER_THEME_BINDINGS_KEY, THEME_DAYNIGHT_PAIRS_KEY, AUTO_THEME_KEY,
    TAG_FILTER_MODE_KEY, ENABLE_SUBTAGS_KEY, ACTIVE_TAG_PATH_KEY, USAGE_COUNT_KEY,
    SHOW_USAGE_COUNT_KEY, ENABLE_AVATAR_HELPER_KEY, ENABLE_COLOR_TRANSFER_KEY,
    ENABLE_DAYNIGHT_BINDING_KEY, ENABLE_REPLACE_AVATAR_BTN_KEY, TWO_LINE_LAYOUT_KEY,
    HIDE_TAG_PILLS_KEY, TAG_PILL_MODE_KEY
];

export function exportSettings() {
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

export async function importSettings(file) {
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

        invalidateTagsCache();
        invalidateThemesCache();

        state.isTwoLineLayout = localStorage.getItem(TWO_LINE_LAYOUT_KEY) === 'true';
        state.hideTagPills = localStorage.getItem(HIDE_TAG_PILLS_KEY) === 'true';
        state.tagPillDisplayMode = localStorage.getItem(TAG_PILL_MODE_KEY) || (state.hideTagPills ? 'none' : 'all');
        state.showUsageCount = localStorage.getItem(SHOW_USAGE_COUNT_KEY) === 'true';
        state.enableAvatarHelper = localStorage.getItem(ENABLE_AVATAR_HELPER_KEY) !== 'false';
        state.enableColorTransfer = localStorage.getItem(ENABLE_COLOR_TRANSFER_KEY) === 'true';
        state.enableDayNightBinding = localStorage.getItem(ENABLE_DAYNIGHT_BINDING_KEY) !== 'false';
        state.enableReplaceAvatarBtn = localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) !== 'false';
        state.tagFilterMode = localStorage.getItem(TAG_FILTER_MODE_KEY) || 'or';

        applyKeywordMappings();

        const freshTags = loadThemeTags();
        buildThemeTagIndex(freshTags);
        if (state.allParsedThemes && state.allParsedThemes.length > 0) {
            state.allParsedThemes.forEach(t => {
                t.tags = getTagsForTheme(t.value, freshTags);
            });
        }

        if (state.contentWrapper) {
            state.contentWrapper.classList.toggle('two-line-layout', state.isTwoLineLayout);
            state.contentWrapper.classList.toggle('hide-tag-pills', state.hideTagPills);
        }

        softRefreshUI();
    } catch (err) {
        console.error('导入配置失败:', err);
        toastr.error('导入配置失败：' + (err.message || err));
    }
}

export async function openResetSystemModal() {
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

    if (ctx && ctx.callGenericPopup) {
        await ctx.callGenericPopup(popupContent, 'confirm', null, {
            okButton: '确认重置',
            cancelButton: '取消',
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                const okButton = dlg ? dlg.querySelector('.popup-button-ok') : null;
                if (okButton) {
                    okButton.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
                    okButton.style.color = '#fff';
                    okButton.onclick = (e) => {
                        e.preventDefault();
                        const doTags = dlg.querySelector('#reset-opt-tags').checked;
                        const doBindings = dlg.querySelector('#reset-opt-bindings').checked;
                        const doAvatars = dlg.querySelector('#reset-opt-avatars').checked;

                        let clearedCount = 0;
                        if (doTags) {
                            localStorage.removeItem(THEME_TAGS_KEY);
                            localStorage.removeItem('themeManager_activeTagsFilters');
                            clearedCount++;
                        }
                        if (doBindings) {
                            localStorage.removeItem(CHARACTER_THEME_BINDINGS_KEY);
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
                    };
                }
            }
        });
    }
}

export async function openSettingsPopup() {
    const getPopupHtml = () => `
        <div class="tm-settings-popup" style="max-height: 75vh; overflow-y: auto; overflow-x: hidden; padding-right: 4px; box-sizing: border-box;">
            <div style="margin-bottom: 14px;">
                <h4 class="tm-settings-section-title"><i class="fa-solid fa-sliders" style="margin-right: 6px;"></i> 视图与显示设置</h4>
                <div class="tm-settings-buttons-flex">
                    <button id="tm-pop-toggle-twoline" class="menu_button ${state.isTwoLineLayout ? 'active' : ''}"><i class="fa-solid fa-align-left"></i> 换行排版 (${state.isTwoLineLayout ? '开启' : '关闭'})</button>
                    <button id="tm-pop-toggle-usage" class="menu_button ${state.showUsageCount ? 'active' : ''}"><i class="fa-solid fa-chart-bar"></i> 使用统计 (${state.showUsageCount ? '开启' : '关闭'})</button>
                    <button id="tm-pop-toggle-daynight" class="menu_button ${state.enableDayNightBinding ? 'active' : ''}"><i class="fa-solid fa-circle-half-stroke"></i> 日夜图标 (${state.enableDayNightBinding ? '开启' : '关闭'})</button>
                    <button id="tm-pop-toggle-replace" class="menu_button ${state.enableReplaceAvatarBtn ? 'active' : ''}"><i class="fa-solid fa-check"></i> 详情页替换 (${state.enableReplaceAvatarBtn ? '开启' : '关闭'})</button>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <label for="tm-pop-select-tag-pill-mode" style="font-size: 12.5px; margin: 0; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <i id="tm-pill-mode-icon" class="${state.tagPillDisplayMode === 'none' ? 'fa-solid fa-eye-slash' : 'fa-solid fa-tags'}" style="color: var(--SmartThemeQuoteColor, #4a90e2);"></i> 标签胶囊显示范围：
                    </label>
                    <select id="tm-pop-select-tag-pill-mode" class="text_pole" style="font-size: 12px; height: 28px; padding: 2px 8px; width: 210px; margin: 0;">
                        <option value="all" ${state.tagPillDisplayMode === 'all' ? 'selected' : ''}>显示全部层级标签 (所有分类)</option>
                        <option value="l1" ${state.tagPillDisplayMode === 'l1' ? 'selected' : ''}>仅显示顶级主分类 (一级标签)</option>
                        <option value="l2" ${state.tagPillDisplayMode === 'l2' || state.tagPillDisplayMode === 'sub' ? 'selected' : ''}>仅显示所有子级标签 (二级及以上)</option>
                        <option value="leaf" ${state.tagPillDisplayMode === 'leaf' ? 'selected' : ''}>仅显示末级细分标签 (最深子标签)</option>
                        <option value="none" ${state.tagPillDisplayMode === 'none' ? 'selected' : ''}>完全隐藏标签胶囊</option>
                    </select>
                </div>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 class="tm-settings-section-title"><i class="fa-solid fa-cubes" style="margin-right: 6px;"></i> 核心扩展功能</h4>
                <div class="tm-settings-buttons-flex">
                    <button id="tm-pop-toggle-avatar" class="menu_button ${state.enableAvatarHelper ? 'active' : ''}"><i class="fa-solid fa-user-gear"></i> 头像管理 (${state.enableAvatarHelper ? '开启' : '关闭'})</button>
                    <button id="tm-pop-toggle-color" class="menu_button ${state.enableColorTransfer ? 'active' : ''}"><i class="fa-solid fa-palette"></i> 提取配色 (${state.enableColorTransfer ? '开启' : '关闭'})</button>
                </div>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 class="tm-settings-section-title"><i class="fa-solid fa-database" style="margin-right: 6px;"></i> 拓展数据管理</h4>
                <div class="tm-settings-buttons-flex">
                    <button id="tm-pop-export-data" class="menu_button"><i class="fa-solid fa-file-export"></i> 导出数据</button>
                    <button id="tm-pop-import-data" class="menu_button"><i class="fa-solid fa-file-import"></i> 导入数据</button>
                </div>
            </div>

            <div style="margin-bottom: 8px;">
                <h4 class="tm-settings-section-title"><i class="fa-solid fa-wrench" style="margin-right: 6px;"></i> 高级与系统维保</h4>
                <div class="tm-settings-buttons-flex">
                    <button id="tm-pop-sync-disk" class="menu_button"><i class="fa-solid fa-arrows-rotate"></i> 对照磁盘</button>
                    <button id="tm-pop-reset-system" class="menu_button"><i class="fa-solid fa-triangle-exclamation"></i> 重置数据</button>
                </div>
            </div>
        </div>
    `;

    if (ctx && ctx.callGenericPopup) {
        await ctx.callGenericPopup(getPopupHtml(), 'confirm', null, {
            title: '美化插件高级设置',
            okButton: '关闭',
            cancelButton: null,
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;

                const btnTwoLine = dlg.querySelector('#tm-pop-toggle-twoline');
                if (btnTwoLine) {
                    btnTwoLine.addEventListener('click', () => {
                        state.isTwoLineLayout = !state.isTwoLineLayout;
                        localStorage.setItem(TWO_LINE_LAYOUT_KEY, state.isTwoLineLayout ? 'true' : 'false');
                        btnTwoLine.classList.toggle('active', state.isTwoLineLayout);
                        btnTwoLine.innerHTML = `<i class="fa-solid fa-align-left"></i> 换行排版 (${state.isTwoLineLayout ? '开启' : '关闭'})`;
                        if (state.contentWrapper) state.contentWrapper.classList.toggle('two-line-layout', state.isTwoLineLayout);
                        toastr.info(`美化列表已切换为: ${state.isTwoLineLayout ? '换行排版模式' : '常规单行模式'}`);
                    });
                }

                const selectPillMode = dlg.querySelector('#tm-pop-select-tag-pill-mode');
                if (selectPillMode) {
                    selectPillMode.addEventListener('change', (e) => {
                        state.tagPillDisplayMode = e.target.value;
                        localStorage.setItem(TAG_PILL_MODE_KEY, state.tagPillDisplayMode);
                        state.hideTagPills = (state.tagPillDisplayMode === 'none');
                        localStorage.setItem(HIDE_TAG_PILLS_KEY, state.hideTagPills ? 'true' : 'false');

                        if (state.contentWrapper) {
                            state.contentWrapper.classList.toggle('hide-tag-pills', state.hideTagPills);
                        }
                        softRefreshUI();
                    });
                }

                const btnExport = dlg.querySelector('#tm-pop-export-data');
                if (btnExport) btnExport.addEventListener('click', exportSettings);

                const btnSync = dlg.querySelector('#tm-pop-sync-disk');
                if (btnSync) {
                    btnSync.addEventListener('click', () => hardResyncThemes(true));
                }

                const btnReset = dlg.querySelector('#tm-pop-reset-system');
                if (btnReset) {
                    btnReset.addEventListener('click', openResetSystemModal);
                }
            }
        });
    }
}
