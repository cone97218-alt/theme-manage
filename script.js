/**
 * script.js - 主入口文件 (ES Modules)
 * 插件的挂载、DOM 事件绑定与各子模块调度中心
 */

import { state, initCtx } from './modules/state.js';
import { COLLAPSE_KEY, TWO_LINE_LAYOUT_KEY, HIDE_TAG_PILLS_KEY, USAGE_COUNT_KEY } from './modules/constants.js';
import { isTouchDevice, triggerSelectChange, deduplicateSelectOptions, debouncedBuildThemeUI } from './modules/utils.js';
import { buildThemeUI, hardResyncThemes, updateActiveState, buildThemeListLazy } from './modules/theme-ui.js';
import { renderTagsUI, updateTagChipsActiveState } from './modules/tags-ui.js';
import { handleTagFilterChange, filterThemeList } from './modules/search-filter.js';
import { applyThemeDirect } from './modules/theme-apply.js';
import { initBackgroundBindingListeners, applyBackgroundDirectly } from './modules/background.js';
import { initCharacterBindingListeners } from './modules/avatar.js';
import { initAutoThemeListeners, applyAutoThemeLoop, executeManualThemeToggle } from './modules/auto-theme.js';
import { openManageTagsPopup } from './modules/manage-tags.js';
import { openSettingsPopup, importSettings } from './modules/settings.js';
import { openAutoGroupWizard } from './modules/auto-group.js';
import { performBatchRename, performBatchDelete } from './modules/popups.js';
import { loadThemeTags, getTagsForTheme } from './modules/tags-core.js';

let initAttempts = 0;
const maxAttempts = 50;

const initInterval = setInterval(() => {
    initAttempts++;

    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const sillyCtx = SillyTavern.getContext();
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#theme_update_button');
        const saveAsButton = document.querySelector('#save_theme_as');

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
                            <button id="manage-tags-btn" class="menu_button" title="管理标签"><i class="fa-solid fa-tags"></i> 标签</button>
                            <button id="tm-auto-group-btn" class="menu_button" title="自动提取分类向导"><i class="fa-solid fa-wand-magic-sparkles"></i> 分组</button>
                            <button id="tm-settings-btn" class="menu_button" title="插件高级设置"><i class="fa-solid fa-gear"></i> 设置</button>
                        </div>
                    </div>

                    <div id="batch-actions-bar" style="display:none;" data-mode="theme">
                        <button id="batch-rename-btn" class="menu_button"><i class="fa-solid fa-i-cursor"></i> 重命名</button>
                        <button id="batch-delete-btn" class="menu_button"><i class="fa-solid fa-trash-can"></i> 删选中</button>
                    </div>
                    <div class="theme-tags-row" id="theme-tags-container"></div>
                    <div class="theme-content"></div>
                </div>`;

            originalContainer.prepend(managerPanel);
            state.managerPanel = managerPanel;
            state.contentWrapper = managerPanel.querySelector('.theme-content');
            state.searchBox = managerPanel.querySelector('#theme-search-box');

            const nativeButtonsContainer = managerPanel.querySelector('#native-buttons-container');
            nativeButtonsContainer.appendChild(updateButton);
            nativeButtonsContainer.appendChild(saveAsButton);

            const settingsFileInput = document.createElement('input');
            settingsFileInput.type = 'file';
            settingsFileInput.accept = '.json';
            settingsFileInput.style.display = 'none';
            document.body.appendChild(settingsFileInput);
            settingsFileInput.addEventListener('change', (e) => importSettings(e.target.files[0]));

            managerPanel.querySelector('#manage-tags-btn').addEventListener('click', openManageTagsPopup);
            managerPanel.querySelector('#tm-settings-btn').addEventListener('click', openSettingsPopup);
            managerPanel.querySelector('#tm-auto-group-btn').addEventListener('click', openAutoGroupWizard);
            managerPanel.querySelector('#batch-rename-btn').addEventListener('click', () => performBatchRename(oldName => oldName));
            managerPanel.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);

            managerPanel.querySelector('#random-theme-btn').addEventListener('click', () => {
                if (state.allParsedThemes.length === 0) return;
                const randomIndex = Math.floor(Math.random() * state.allParsedThemes.length);
                const randomTheme = state.allParsedThemes[randomIndex].value;
                applyThemeDirect(randomTheme);
            });

            managerPanel.querySelector('#auto-theme-settings-btn').addEventListener('click', () => {
                import('./modules/auto-theme.js').then(m => m.checkAutoTheme());
                openSettingsPopup();
            });

            if (state.searchBox) {
                state.searchBox.addEventListener('input', () => {
                    filterThemeList(0);
                });
            }

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

            const observer = new MutationObserver(() => {
                if (state._suspendObserver) return;
                debouncedBuildThemeUI(buildThemeUI, 300);
            });
            observer.observe(originalSelect, { childList: true });

            initBackgroundBindingListeners();
            initCharacterBindingListeners();
            initAutoThemeListeners();
            applyAutoThemeLoop();

            buildThemeUI();
        }
    } else if (initAttempts >= maxAttempts) {
        clearInterval(initInterval);
        console.error('[Theme Manager] 初始化超时：未在规定时间内找到 SillyTavern.getContext() 对象');
    }
}, 100);
