/**
 * script.js - 主入口文件 (ES Modules)
 * 插件的挂载、DOM 事件绑定与各子模块调度中心
 */

import { state, initCtx } from './modules/state.js';
import {
    COLLAPSE_KEY, TWO_LINE_LAYOUT_KEY, HIDE_TAG_PILLS_KEY, USAGE_COUNT_KEY,
    LIST_MODE_KEY, PAGE_SIZE_KEY, SORT_SELECT_KEY, BATCH_EDIT_COLLAPSED_KEY,
    FAVORITES_KEY, THEME_BACKGROUND_BINDINGS_KEY
} from './modules/constants.js';
import { isTouchDevice, triggerSelectChange, deduplicateSelectOptions, debouncedBuildThemeUI, manualUpdateOriginalSelect } from './modules/utils.js';
import { buildThemeUI, hardResyncThemes, updateActiveState, buildThemeListLazy, updateFavorites, softRefreshUI } from './modules/theme-ui.js';
import { renderTagsUI, updateTagChipsActiveState } from './modules/tags-ui.js';
import { handleTagFilterChange, filterThemeList } from './modules/search-filter.js';
import { applyThemeDirect } from './modules/theme-apply.js';
import { initBackgroundBindingListeners, applyBackgroundDirectly, initBackgroundEnhancements } from './modules/background.js';

import { initCharacterBindingListeners, applyBoundThemeForCharacter } from './modules/avatar.js';
import { initAutoThemeListeners, applyAutoThemeLoop, executeManualThemeToggle, checkAutoTheme, openDayNightPairModal, applyEarlyAutoTheme, initAutoThemeModals } from './modules/auto-theme.js';

import { openManageTagsPopup } from './modules/manage-tags.js';
import { openSettingsPopup, importSettings } from './modules/settings.js';
import { openAutoGroupWizard } from './modules/auto-group.js';
import { performBatchRename, performBatchDelete, openTagAssignmentPopup, openTagRemovalPopup, openBatchRenamePopup } from './modules/popups.js';

import { loadThemeTags, getTagsForTheme, saveThemeTags } from './modules/tags-core.js';
import { openColorTransferModal } from './modules/color-transfer.js';
import { apiRequest, deleteTheme, findThemeObject, updateSTThemeMemory, confirmAction, promptAction } from './modules/api.js';

let initAttempts = 0;
const maxAttempts = 50;

const initInterval = setInterval(() => {
    initAttempts++;

    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const sillyCtx = SillyTavern.getContext();
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button') || document.querySelector('#theme_update_button');
        const saveAsButton = document.querySelector('#ui-preset-save-button') || document.querySelector('#save_theme_as');

        if (originalSelect && updateButton && saveAsButton) {

            clearInterval(initInterval);
            console.log('[Theme Manager] SillyTavern 上下文及 DOM 已就绪，开始初始化插件 (ES Modules 架构)...');

            initCtx(sillyCtx);
            state.originalSelect = originalSelect;

            window.themeManager = {
                getTags: () => loadThemeTags(),
                getThemeTags: (themeName) => getTagsForTheme(themeName),
                onTagsChanged: (callback) => {
                    document.addEventListener('themeManager:tagsChanged', (event) => {
                        callback(event.detail);
                    });
                },
                applyBoundThemeForCharacter: (avatarName) => {
                    import('./modules/avatar.js').then(m => m.applyBoundThemeForCharacter(avatarName));
                }
            };

            const originalContainer = originalSelect.parentElement;
            if (!originalContainer) return;
            originalSelect.style.display = 'none';

            const managerPanel = document.createElement('div');
            managerPanel.id = 'theme-manager-panel';
            managerPanel.innerHTML = `
                <div id="theme-manager-header">
                    <h4 style="display:flex; align-items:center; gap:6px;">
                        <span><i class="fa-solid fa-palette"></i> 主题美化管理</span>
                        <button id="tm-quick-manual-toggle-btn" style="display:none;" title="快捷切换日夜美化"><i class="fa-solid fa-circle-half-stroke"></i></button>
                    </h4>
                    <div id="native-buttons-container"></div>
                    <div id="theme-manager-toggle-icon" class="fa-solid fa-chevron-down"></div>
                </div>
                <div id="theme-manager-content">
                    <div id="theme-manager-refresh-notice" style="display:none; margin: 10px 0; padding: 10px; background-color: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 5px; text-align: center; color: var(--main-text-color);">
                        <i class="fa-solid fa-lightbulb"></i> <b>提示：</b>检测到文件变更。
                        <a id="theme-manager-refresh-page-btn" style="color:var(--primary-color, #007bff); text-decoration:underline; cursor:pointer; font-weight:bold;">刷新页面</a>。
                    </div>
                    <div class="theme-manager-actions" data-mode="theme">
                        <div class="tm-button-row">
                            <input type="search" id="theme-search-box" placeholder="搜索主题..." title="支持复合搜索：/ 与 + 排除">
                            <button id="random-theme-btn" class="menu_button" title="随机应用一个主题"><i class="fa-solid fa-dice"></i> 随机</button>
                            <button id="auto-theme-settings-btn" class="menu_button" title="自动主题切换设置"><i class="fa-solid fa-circle-half-stroke"></i> 自动</button>
                            <button id="toggle-more-actions-btn" class="menu_button" title="展开/收起更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                        </div>
                    </div>
                    <div id="more-actions-container" class="theme-manager-actions collapsed" data-mode="shared">
                        <div class="tm-button-row" style="margin-bottom: 5px; gap: 8px;">
                            <select id="tm-list-mode-select" class="text_pole" title="列表显示模式" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0;">
                                <option value="scroll">上下滑动看全部</option>
                                <option value="page">分页显示模式</option>
                            </select>
                            <select id="tm-page-size-select" class="text_pole" title="每页条数" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0; display: none;">
                                <option value="30">每页 30 条</option>
                                <option value="50">每页 50 条</option>
                                <option value="100">每页 100 条</option>
                                <option value="200">每页 200 条</option>
                                <option value="500">每页 500 条</option>
                            </select>
                            <select id="tm-sort-select" class="text_pole" title="排序规则" style="flex: 1; min-width: 0; padding: 2px 5px; height: 28px; font-size: 12px; margin: 0;">
                                <option value="name-asc">名称 A-Z</option>
                                <option value="name-desc">名称 Z-A</option>
                                <option value="favorite-first">收藏优先</option>
                                <option value="time-desc">时间倒序</option>
                                <option value="time-asc">时间正序</option>
                                <option value="usage-desc">次数 多→少</option>
                                <option value="usage-asc">次数 少→多</option>
                            </select>
                        </div>
                        <div class="tm-button-row">
                            <button id="batch-edit-btn" class="menu_button" title="进入/退出批量编辑模式"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
                            <button id="batch-import-btn" class="menu_button" title="从文件批量导入主题"><i class="fa-solid fa-folder-open"></i> 导入</button>
                            <button id="manage-tags-btn" class="menu_button" title="管理标签"><i class="fa-solid fa-tags"></i> 标签</button>
                            <button id="tm-auto-group-btn" class="menu_button" title="自动提取分类向导"><i class="fa-solid fa-wand-magic-sparkles"></i> 分组</button>
                            <button id="tm-settings-btn" class="menu_button" title="插件高级设置"><i class="fa-solid fa-gear"></i> 设置</button>
                        </div>
                    </div>

                    <div id="batch-actions-bar" style="display:none;" data-mode="theme">
                        <button id="batch-select-all-btn" class="menu_button" title="全选当前列表中的所有美化"><i class="fa-solid fa-square-check"></i> 全选</button>
                        <button id="batch-select-range-btn" class="menu_button" title="连选：选中首尾勾选项之间的全部美化"><i class="fa-solid fa-list-check"></i> 连选</button>
                        <button id="batch-invert-select-btn" class="menu_button" title="反选当前列表中的全部"><i class="fa-solid fa-arrow-rotate-left"></i> 反选</button>
                        <button id="batch-add-tag-btn" class="menu_button"><i class="fa-solid fa-tags"></i> 加标签</button>
                        <button id="batch-remove-tag-btn" class="menu_button"><i class="fa-solid fa-tag"></i> 解标签</button>
                        <button id="batch-rename-btn" class="menu_button"><i class="fa-solid fa-i-cursor"></i> 重命名</button>
                        <button id="batch-delete-btn" class="menu_button"><i class="fa-solid fa-trash-can"></i> 删选中</button>
                    </div>
                    <div class="theme-tags-row" id="theme-tags-container"></div>
                    <div id="tm-pagination-bar-top" class="tm-pagination-bar" style="display:none; justify-content: center; align-items: center; gap: 8px; margin-top: 5px; margin-bottom: 5px; width: 100%;">
                        <button class="tm-first-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到首页"><i class="fa-solid fa-angles-left"></i></button>
                        <button class="tm-prev-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                        <span style="font-size: 12px; display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                            第 <input type="number" class="tm-page-input text_pole" style="width: 45px; text-align: center; height: 24px; padding: 0; margin: 0; font-size: 12px;" min="1" value="1"> 页 / 共 <span class="tm-total-pages-text">1</span> 页
                        </span>
                        <button class="tm-next-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
                        <button class="tm-last-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="前往末页"><i class="fa-solid fa-angles-right"></i></button>
                    </div>
                    <div class="theme-content"></div>
                    <div id="tm-pagination-bar-bottom" class="tm-pagination-bar" style="display:none; justify-content: center; align-items: center; gap: 8px; margin-top: 5px; margin-bottom: 5px; width: 100%;">
                        <button class="tm-first-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="回到首页"><i class="fa-solid fa-angles-left"></i></button>
                        <button class="tm-prev-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                        <span style="font-size: 12px; display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                            第 <input type="number" class="tm-page-input text_pole" style="width: 45px; text-align: center; height: 24px; padding: 0; margin: 0; font-size: 12px;" min="1" value="1"> 页 / 共 <span class="tm-total-pages-text">1</span> 页
                        </span>
                        <button class="tm-next-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
                        <button class="tm-last-page-btn menu_button" style="width: auto; padding: 2px 8px; margin: 0;" title="前往末页"><i class="fa-solid fa-angles-right"></i></button>
                    </div>
                    <div id="auto-theme-modal" class="tm-modal" style="display:none;">
                        <div class="tm-modal-content">
                            <div class="tm-modal-header">
                                <h3><i class="fa-solid fa-circle-half-stroke"></i> 自动主题切换</h3>
                                <button id="close-auto-theme-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="tm-modal-body">
                                <label style="display:flex; align-items:center; gap:8px; width:100%; white-space:nowrap;">
                                    <input type="checkbox" id="auto-theme-enable" style="margin:0;"> 启用自动切换
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; width:100%; white-space:nowrap; margin-top:6px;">
                                    <input type="checkbox" id="auto-theme-enable-manual" style="margin:0;"> 启用手动切换
                                </label>
                                <hr>
                                <div>
                                    <label style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                                        <input type="radio" name="auto-theme-mode" value="system" style="margin:0;"> 跟随系统深色模式
                                    </label>
                                    <label style="display:flex; align-items:center; gap:8px;">
                                        <input type="radio" name="auto-theme-mode" value="time" style="margin:0;"> 固定时间段
                                    </label>
                                </div>
                                <div id="auto-theme-time-settings" class="tm-time-settings" style="display:none; margin-top:10px;">
                                    <label style="display:flex; flex-direction:column; gap:5px; margin-bottom:10px;">
                                        日间开始时间: <input type="time" id="auto-theme-day-start" value="06:00" class="text_pole">
                                    </label>
                                    <label style="display:flex; flex-direction:column; gap:5px;">
                                        夜间开始时间: <input type="time" id="auto-theme-night-start" value="18:00" class="text_pole">
                                    </label>
                                </div>
                                <hr>
                                <div style="margin-top:10px;">
                                    <label><b>日间主题/标签 (全局浅色):</b></label>
                                    <select id="auto-theme-day-target" class="text_pole" style="width:100%; margin-bottom:10px;"></select>
                                    <label><b>夜间主题/标签 (全局深色):</b></label>
                                    <select id="auto-theme-night-target" class="text_pole" style="width:100%;"></select>
                                    <p style="font-size: 0.8em; opacity: 0.8; margin-top: 5px;">* 如果选择带有 <code>[Tag]</code> 的分类，将在该标签下随机挑选。</p>
                                </div>
                                <hr>
                                <div style="margin-top:10px;">
                                    <label><b>按美化独立日夜组配置 (优先于全局):</b></label>
                                    <div id="tm-pairs-list-container" style="max-height: 140px; overflow-y: auto; font-size: 0.85em; margin-top: 5px; border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; padding: 6px;"></div>
                                </div>
                            </div>
                            <div class="tm-modal-footer" style="display:flex; justify-content:center; padding-top:10px;">
                                <button id="save-auto-theme-btn" class="menu_button" style="width:100%; justify-content:center;"><i class="fa-solid fa-check"></i> 保存设置</button>
                            </div>
                        </div>
                    </div>
                    <div id="tm-daynight-pair-modal" class="tm-modal" style="display:none;">
                        <div class="tm-modal-content">
                            <div class="tm-modal-header">
                                <h3><i class="fa-solid fa-circle-half-stroke"></i> 美化日夜联动绑定</h3>
                                <button id="close-tm-daynight-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="tm-modal-body">
                                <p style="margin-bottom:10px; font-weight:bold;">当前美化：<span id="tm-daynight-current-name" style="color:var(--SmartThemeEmColor);"></span></p>
                                <label style="display:block; margin-bottom:10px;">
                                    <b>对应的夜间美化 (切换到夜间时):</b>
                                    <select id="tm-daynight-night-select" class="text_pole" style="width:100%; margin-top:4px;"></select>
                                </label>
                                <label style="display:block; margin-bottom:10px;">
                                    <b>对应的日间美化 (切换到日间时):</b>
                                    <select id="tm-daynight-day-select" class="text_pole" style="width:100%; margin-top:4px;"></select>
                                </label>
                                <p style="font-size:0.8em; opacity:0.8; margin-top:5px;">* 配置后，当在当前美化下触发日夜模式切换时，将优先切换至此处绑定的专属美化；无绑定时回退全局设置。</p>
                            </div>
                            <div class="tm-modal-footer" style="display:flex; gap:10px; justify-content:center; padding-top:10px;">
                                <button id="save-tm-daynight-btn" class="menu_button" style="flex:1; justify-content:center;"><i class="fa-solid fa-check"></i> 保存绑定</button>
                                <button id="clear-tm-daynight-btn" class="menu_button" style="flex:1; justify-content:center; color:#ff4d4f;"><i class="fa-solid fa-trash-can"></i> 解除绑定</button>
                            </div>
                        </div>
                    </div>
                </div>`;


            originalContainer.prepend(managerPanel);
            state.managerPanel = managerPanel;
            state.contentWrapper = managerPanel.querySelector('.theme-content');
            state.searchBox = managerPanel.querySelector('#theme-search-box');

            initAutoThemeModals(managerPanel);

            if (state.contentWrapper) {
                state.contentWrapper.classList.toggle('two-line-layout', state.isTwoLineLayout);
                state.contentWrapper.classList.toggle('hide-tag-pills', state.hideTagPills);
            }

            const nativeButtonsContainer = managerPanel.querySelector('#native-buttons-container');
            nativeButtonsContainer.appendChild(updateButton);
            nativeButtonsContainer.appendChild(saveAsButton);

            const settingsFileInput = document.createElement('input');
            settingsFileInput.type = 'file';
            settingsFileInput.accept = '.json';
            settingsFileInput.style.display = 'none';
            document.body.appendChild(settingsFileInput);
            settingsFileInput.addEventListener('change', (e) => importSettings(e.target.files[0]));

            const themeBatchFileInput = document.createElement('input');
            themeBatchFileInput.type = 'file';
            themeBatchFileInput.multiple = true;
            themeBatchFileInput.accept = '.json';
            themeBatchFileInput.style.display = 'none';
            document.body.appendChild(themeBatchFileInput);

            themeBatchFileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (!files || files.length === 0) return;
                const fileReadPromises = files.map(async (file) => {
                    try {
                        const content = await file.text();
                        const themeObj = JSON.parse(content);
                        const filename = file.name.replace(/\.json$/i, '');
                        if (themeObj && typeof themeObj.main_text_color !== 'undefined') {
                            themeObj.name = filename || themeObj.name;
                            return { file, themeObj, valid: true };
                        }
                        return { file, valid: false, error: '非有效美化预设' };
                    } catch (err) {
                        return { file, valid: false, error: err.message };
                    }
                });
                const parsed = await Promise.all(fileReadPromises);
                const valids = parsed.filter(p => p.valid);
                if (valids.length === 0) {
                    toastr.error('未找到有效的美化文件');
                    return;
                }
                for (const item of valids) {
                    await saveTheme(item.themeObj);
                }
                toastr.success(`成功并发导入 ${valids.length} 个美化主题！`);
                hardResyncThemes();
            });

            // 按钮事件注册
            const batchImportBtn = managerPanel.querySelector('#batch-import-btn');
            if (batchImportBtn) {
                batchImportBtn.addEventListener('click', () => themeBatchFileInput.click());
            }

            managerPanel.querySelector('#manage-tags-btn').addEventListener('click', openManageTagsPopup);
            managerPanel.querySelector('#tm-settings-btn').addEventListener('click', openSettingsPopup);
            managerPanel.querySelector('#tm-auto-group-btn').addEventListener('click', openAutoGroupWizard);

            // 批量按钮事件注册
            const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
            const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
            const toggleMoreActionsBtn = managerPanel.querySelector('#toggle-more-actions-btn');
            const moreActionsContainer = managerPanel.querySelector('#more-actions-container');

            batchEditBtn.addEventListener('click', () => {
                state.isBatchEditMode = !state.isBatchEditMode;
                managerPanel.classList.toggle('batch-edit-mode', state.isBatchEditMode);
                batchActionsBar.style.display = state.isBatchEditMode ? 'flex' : 'none';
                batchEditBtn.classList.toggle('selected', state.isBatchEditMode);
                batchEditBtn.innerHTML = state.isBatchEditMode ? '退出批量编辑' : '<i class="fa-solid fa-pen-to-square"></i> 编辑';
                if (!state.isBatchEditMode) {
                    state.selectedForBatch.clear();
                    state.lastClickedThemeName = null;
                    managerPanel.querySelectorAll('.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                }
            });

            const savedBatchEditCollapsed = localStorage.getItem(BATCH_EDIT_COLLAPSED_KEY);
            if (savedBatchEditCollapsed === 'false') {
                moreActionsContainer.classList.remove('collapsed');
                toggleMoreActionsBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
                toggleMoreActionsBtn.title = '收起更多操作';
            }

            toggleMoreActionsBtn.addEventListener('click', () => {
                const isCollapsed = moreActionsContainer.classList.toggle('collapsed');
                toggleMoreActionsBtn.innerHTML = isCollapsed ? '<i class="fa-solid fa-ellipsis"></i>' : '<i class="fa-solid fa-chevron-up"></i>';
                toggleMoreActionsBtn.title = isCollapsed ? '展开更多操作' : '收起更多操作';
                localStorage.setItem(BATCH_EDIT_COLLAPSED_KEY, isCollapsed ? 'true' : 'false');
            });

            managerPanel.querySelector('#batch-select-all-btn').addEventListener('click', () => {
                state.themeItemMap.forEach((item, themeName) => {
                    state.selectedForBatch.add(themeName);
                    item.classList.add('selected-for-batch');
                });
                toastr.info(`已全选当前 ${state.selectedForBatch.size} 项美化。`);
            });

            managerPanel.querySelector('#batch-select-range-btn').addEventListener('click', () => {
                const items = Array.from(state.contentWrapper.querySelectorAll('.theme-item'));
                const selectedItems = items.filter(item => state.selectedForBatch.has(item.dataset.value));
                if (selectedItems.length < 2) {
                    toastr.warning('连选需要先手动勾选至少首尾 2 个美化卡片。');
                    return;
                }
                const firstIdx = items.indexOf(selectedItems[0]);
                const lastIdx = items.indexOf(selectedItems[selectedItems.length - 1]);
                for (let i = firstIdx; i <= lastIdx; i++) {
                    const val = items[i].dataset.value;
                    state.selectedForBatch.add(val);
                    items[i].classList.add('selected-for-batch');
                }
                toastr.info(`连选成功！已选中 ${selectedItems[0].dataset.value} 至 ${selectedItems[selectedItems.length - 1].dataset.value} 共 ${lastIdx - firstIdx + 1} 项。`);
            });

            managerPanel.querySelector('#batch-invert-select-btn').addEventListener('click', () => {
                state.themeItemMap.forEach((item, themeName) => {
                    if (state.selectedForBatch.has(themeName)) {
                        state.selectedForBatch.delete(themeName);
                        item.classList.remove('selected-for-batch');
                    } else {
                        state.selectedForBatch.add(themeName);
                        item.classList.add('selected-for-batch');
                    }
                });
                toastr.info(`反选成功！当前已选中 ${state.selectedForBatch.size} 项。`);
            });

            managerPanel.querySelector('#batch-add-tag-btn').addEventListener('click', () => {
                if (state.selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                openTagAssignmentPopup(state.selectedForBatch);
            });

            managerPanel.querySelector('#batch-remove-tag-btn').addEventListener('click', () => {
                if (state.selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                openTagRemovalPopup(state.selectedForBatch);
            });

            managerPanel.querySelector('#batch-rename-btn').addEventListener('click', () => {
                if (state.selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                openBatchRenamePopup(Array.from(state.selectedForBatch));
            });

            managerPanel.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);

            managerPanel.querySelector('#random-theme-btn').addEventListener('click', () => {
                if (state.allParsedThemes.length === 0) return;
                const randomIndex = Math.floor(Math.random() * state.allParsedThemes.length);
                const randomTheme = state.allParsedThemes[randomIndex].value;
                applyThemeDirect(randomTheme);
            });

            managerPanel.querySelector('#auto-theme-settings-btn').addEventListener('click', () => {
                checkAutoTheme();
                openSettingsPopup();
            });

            const quickManualToggleBtn = managerPanel.querySelector('#tm-quick-manual-toggle-btn');
            if (quickManualToggleBtn) {
                quickManualToggleBtn.style.display = state.autoThemeSettings.enableManualToggle ? 'inline-flex' : 'none';
                quickManualToggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    executeManualThemeToggle();
                });
            }

            const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
            if (refreshBtn) refreshBtn.addEventListener('click', () => location.reload());

            // 搜索与排序下拉框事件
            let _searchDebounceTimer = null;
            if (state.searchBox) {
                state.searchBox.addEventListener('input', () => {
                    clearTimeout(_searchDebounceTimer);
                    _searchDebounceTimer = setTimeout(() => {
                        state.currentPage = 1;
                        filterThemeList(0);
                    }, 250);
                });
            }

            const listModeSelect = managerPanel.querySelector('#tm-list-mode-select');
            const pageSizeSelect = managerPanel.querySelector('#tm-page-size-select');
            const sortSelect = managerPanel.querySelector('#tm-sort-select');

            listModeSelect.value = state.listMode;
            pageSizeSelect.value = String(state.pageSize);
            sortSelect.value = state.sortBy;
            pageSizeSelect.style.display = state.listMode === 'page' ? 'inline-block' : 'none';

            listModeSelect.addEventListener('change', (e) => {
                state.listMode = e.target.value;
                localStorage.setItem(LIST_MODE_KEY, state.listMode);
                pageSizeSelect.style.display = state.listMode === 'page' ? 'inline-block' : 'none';
                state.currentPage = 1;
                buildThemeListLazy(0);
            });

            pageSizeSelect.addEventListener('change', (e) => {
                state.pageSize = parseInt(e.target.value);
                localStorage.setItem(PAGE_SIZE_KEY, String(state.pageSize));
                state.currentPage = 1;
                buildThemeListLazy(0);
            });

            sortSelect.addEventListener('change', (e) => {
                state.sortBy = e.target.value;
                localStorage.setItem(SORT_SELECT_KEY, state.sortBy);
                state.currentPage = 1;
                buildThemeListLazy(0);
            });

            // 分页按钮事件注册
            const registerPaginationEvents = (bar) => {
                if (!bar) return;
                bar.querySelector('.tm-first-page-btn').addEventListener('click', () => { state.currentPage = 1; buildThemeListLazy(0); });
                bar.querySelector('.tm-prev-page-btn').addEventListener('click', () => { state.currentPage--; buildThemeListLazy(0); });
                bar.querySelector('.tm-next-page-btn').addEventListener('click', () => { state.currentPage++; buildThemeListLazy(0); });
                bar.querySelector('.tm-last-page-btn').addEventListener('click', () => {
                    const totalPages = parseInt(bar.querySelector('.tm-total-pages-text').textContent) || 1;
                    state.currentPage = totalPages;
                    buildThemeListLazy(0);
                });
                const pageInput = bar.querySelector('.tm-page-input');
                if (pageInput) {
                    const updatePage = () => {
                        const val = parseInt(pageInput.value);
                        if (!isNaN(val)) { state.currentPage = val; buildThemeListLazy(0); }
                    };
                    pageInput.addEventListener('change', updatePage);
                    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') updatePage(); });
                }
            };
            registerPaginationEvents(managerPanel.querySelector('#tm-pagination-bar-top'));
            registerPaginationEvents(managerPanel.querySelector('#tm-pagination-bar-bottom'));

            // 折叠面板 Header
            const header = managerPanel.querySelector('#theme-manager-header');
            const content = managerPanel.querySelector('#theme-manager-content');
            const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');

            function setCollapsed(isCollapsed) {
                if (isCollapsed) {
                    content.style.maxHeight = '0px';
                    toggleIcon.classList.add('collapsed');
                    localStorage.setItem(COLLAPSE_KEY, 'true');
                } else {
                    content.style.maxHeight = '';
                    toggleIcon.classList.remove('collapsed');
                    localStorage.setItem(COLLAPSE_KEY, 'false');
                }
            }

            header.addEventListener('click', (e) => {
                if (e.target.closest('#native-buttons-container') || e.target.closest('#tm-quick-manual-toggle-btn')) return;
                const isCollapsed = localStorage.getItem(COLLAPSE_KEY) === 'true';
                setCollapsed(!isCollapsed);
            });

            setCollapsed(localStorage.getItem(COLLAPSE_KEY) === 'true');

            // 监听原下拉框 change 事件
            originalSelect.addEventListener('change', (event) => {
                updateActiveState();
                const newThemeName = event.target.value;
                if (newThemeName) {
                    state.usageCount[newThemeName] = (state.usageCount[newThemeName] || 0) + 1;
                    localStorage.setItem(USAGE_COUNT_KEY, JSON.stringify(state.usageCount));
                }
                const boundBg = state.themeBackgroundBindings[newThemeName];
                if (boundBg) {
                    applyBackgroundDirectly(boundBg);
                }
            });

            // 监听主题卡片列表全局点击事件代理
            state.contentWrapper.addEventListener('click', async (event) => {
                const target = event.target;
                const button = target.closest('button');
                const themeItem = target.closest('.theme-item');

                if (!themeItem) return;
                const themeName = themeItem.dataset.value;

                if (state.isBatchEditMode) {
                    if (event.shiftKey && state.lastClickedThemeName) {
                        const items = Array.from(state.contentWrapper.querySelectorAll('.theme-item'));
                        const lastIdx = items.findIndex(item => item.dataset.value === state.lastClickedThemeName);
                        const currentIdx = items.findIndex(item => item.dataset.value === themeName);
                        if (lastIdx !== -1 && currentIdx !== -1) {
                            const start = Math.min(lastIdx, currentIdx);
                            const end = Math.max(lastIdx, currentIdx);
                            const shouldSelect = !state.selectedForBatch.has(themeName);
                            for (let i = start; i <= end; i++) {
                                const item = items[i];
                                const val = item.dataset.value;
                                if (shouldSelect) {
                                    state.selectedForBatch.add(val);
                                    item.classList.add('selected-for-batch');
                                } else {
                                    state.selectedForBatch.delete(val);
                                    item.classList.remove('selected-for-batch');
                                }
                            }
                        }
                    } else {
                        if (state.selectedForBatch.has(themeName)) {
                            state.selectedForBatch.delete(themeName);
                            themeItem.classList.remove('selected-for-batch');
                        } else {
                            state.selectedForBatch.add(themeName);
                            themeItem.classList.add('selected-for-batch');
                        }
                    }
                    state.lastClickedThemeName = themeName;
                } else {
                    if (button && button.classList.contains('set-tag-btn')) {
                        openTagAssignmentPopup(themeName);
                        return;
                    }

                    if (button && button.classList.contains('link-bg-btn')) {
                        if (state.themeBackgroundBindings[themeName]) {
                            delete state.themeBackgroundBindings[themeName];
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));
                            button.classList.remove('linked');
                            button.querySelector('i').className = 'fa-solid fa-link';
                            button.title = '关联背景图';
                            toastr.info(`已取消主题 "${themeName}" 的背景图关联。`);
                        } else {
                            state.isBindingMode = true;
                            state.themeNameToBind = themeName;
                            const toggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                            if (toggleButton) toggleButton.click();
                            toastr.info(`进入背景图关联模式：请在背景图片库中点击任意图片即可绑定到 "${themeName}"。`);
                        }
                        return;
                    }

                    if (button && button.classList.contains('link-daynight-btn')) {
                        openDayNightPairModal(themeName);
                        return;
                    }

                    if (button && button.classList.contains('favorite-btn')) {
                        if (state.favoritesSet.has(themeName)) {
                            updateFavorites(state.favorites.filter(f => f !== themeName));
                            button.innerHTML = '<i class="fa-regular fa-star"></i>';
                        } else {
                            updateFavorites([...state.favorites, themeName]);
                            button.innerHTML = '<i class="fa-solid fa-star"></i>';
                        }
                        if (state.activeTagFilters.has('__FAVORITES__')) {
                            filterThemeList();
                        }
                        return;
                    }

                    if (button && button.classList.contains('color-transfer-btn')) {
                        openColorTransferModal(themeName);
                        return;
                    }

                    if (button && button.classList.contains('rename-btn')) {
                        const oldName = themeName;
                        const newName = await promptAction('请输入新的美化主题名称：', oldName);
                        if (!newName || !newName.trim() || newName.trim() === oldName) return;
                        const cleanNewName = newName.trim();
                        const fullThemeObj = findThemeObject(oldName);
                        if (!fullThemeObj) { toastr.error('无法提取主题原始对象数据'); return; }

                        const { mtime: _m, ...cleanObj } = fullThemeObj;
                        const objectToSave = { ...cleanObj, name: cleanNewName };

                        try {
                            await apiRequest('themes/save', 'POST', objectToSave);
                            await deleteTheme(oldName, fullThemeObj);
                            manualUpdateOriginalSelect('rename', oldName, cleanNewName);
                            updateSTThemeMemory({ name: oldName }, 'delete');
                            updateSTThemeMemory(objectToSave, 'add');

                            if (state.themeBackgroundBindings[oldName]) {
                                state.themeBackgroundBindings[cleanNewName] = state.themeBackgroundBindings[oldName];
                                delete state.themeBackgroundBindings[oldName];
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));
                            }
                            let tagsToUpdate = loadThemeTags();
                            tagsToUpdate.forEach(tag => {
                                if (tag.themes) {
                                    const idx = tag.themes.indexOf(oldName);
                                    if (idx > -1) tag.themes[idx] = cleanNewName;
                                }
                            });
                            saveThemeTags(tagsToUpdate);

                            toastr.success(`主题已成功重命名为 "${cleanNewName}"`);
                            if (originalSelect.value === oldName) {
                                originalSelect.value = cleanNewName;
                                triggerSelectChange(originalSelect);
                            }
                            softRefreshUI([cleanNewName]);
                        } catch (err) {
                            console.error('重命名主题失败:', err);
                            toastr.error('重命名主题异常: ' + (err.message || err));
                        }
                        return;
                    }

                    if (button && button.classList.contains('delete-btn')) {
                        const themeToDelete = themeName;
                        const confirmed = await confirmAction(`确定要彻底删除主题 "${themeToDelete}" 吗？此操作不可撤销！`);
                        if (!confirmed) return;

                        const fullThemeObj = findThemeObject(themeToDelete);
                        try {
                            await deleteTheme(themeToDelete, fullThemeObj);
                            manualUpdateOriginalSelect('delete', themeToDelete);
                            updateSTThemeMemory({ name: themeToDelete }, 'delete');

                            if (state.themeBackgroundBindings[themeToDelete]) {
                                delete state.themeBackgroundBindings[themeToDelete];
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));
                            }

                            let tagsToUpdate = loadThemeTags();
                            tagsToUpdate.forEach(tag => {
                                if (tag.themes) {
                                    const idx = tag.themes.indexOf(themeToDelete);
                                    if (idx > -1) tag.themes.splice(idx, 1);
                                }
                            });
                            saveThemeTags(tagsToUpdate);

                            if (originalSelect.value === themeToDelete) {
                                const firstOpt = originalSelect.options[0];
                                if (firstOpt) {
                                    originalSelect.value = firstOpt.value;
                                    triggerSelectChange(originalSelect);
                                }
                            }
                            toastr.success(`主题 "${themeToDelete}" 已成功删除！`);
                            softRefreshUI();
                        } catch (err) {
                            console.error('删除主题失败:', err);
                            toastr.error('删除主题失败: ' + (err.message || err));
                        }
                        return;
                    }

                    // 点击普通列表项卡片（非点击按钮） -> 激活该美化主题
                    if (originalSelect.value !== themeName) {
                        originalSelect.value = themeName;
                        triggerSelectChange(originalSelect);
                        updateActiveState();
                    }
                }
            });

            // MutationObserver 监听原生 #themes 下拉框的 DOM 动态改变
            const observer = new MutationObserver(() => {
                if (state._suspendObserver) return;
                debouncedBuildThemeUI(buildThemeUI, 300);
            });
            observer.observe(originalSelect, { childList: true });

            // 注册 SillyTavern 原生 EventSource 事件监听
            const { eventSource, eventTypes } = sillyCtx;
            if (eventSource && eventTypes) {
                eventSource.on(eventTypes.CHAT_CHANGED, () => {
                    const currentTheme = originalSelect.value;
                    const boundBg = state.themeBackgroundBindings[currentTheme];
                    if (boundBg) {
                        setTimeout(() => applyBackgroundDirectly(boundBg), 300);
                    }
                });

                eventSource.on(eventTypes.CHARACTER_SELECTED, () => {
                    const { characters, characterId } = SillyTavern.getContext();
                    const character = characters ? characters[characterId] : null;
                    if (character && character.avatar) {
                        setTimeout(() => applyBoundThemeForCharacter(character.avatar), 100);
                    }
                });
            }

            // 初始化背景图关联、角色卡绑定、日夜随动监听
            initBackgroundBindingListeners();
            initBackgroundEnhancements();
            initCharacterBindingListeners();
            initAutoThemeListeners();
            applyEarlyAutoTheme(originalSelect, state.autoThemeSettings);
            applyAutoThemeLoop();

            // 构建渲染插件主题列表 UI
            buildThemeUI();
        }
    } else if (initAttempts >= maxAttempts) {

        clearInterval(initInterval);
        console.error('[Theme Manager] 初始化超时：未在规定时间内找到 SillyTavern.getContext() 对象');
    }
}, 100);
