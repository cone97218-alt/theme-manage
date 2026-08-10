/**
 * background.js
 * 背景图直接应用与背景图管理增强
 */

import { state } from './state.js';
import { THEME_BACKGROUND_BINDINGS_KEY } from './constants.js';

/**
 * 直接应用指定的背景图片
 * @param {string} bgFile 背景文件名
 */
export function applyBackgroundDirectly(bgFile) {
    if (!bgFile) return;

    // 检查当前背景是否已经是此背景，避免重复应用与重排
    const bg1 = document.querySelector('#bg1');
    if (bg1) {
        const currentBg = bg1.style.backgroundImage;
        const targetUrl = `backgrounds/${encodeURIComponent(bgFile)}`;
        if (currentBg && (currentBg.includes(targetUrl) || currentBg.includes(bgFile))) {
            console.log(`[Theme Manager] 背景图已经是 ${bgFile}，跳过应用`);
            return;
        }
    }

    // 尝试通过 DOM 元素点击（桌面端通常可用）
    const escapedBg = CSS.escape(bgFile);
    const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${escapedBg}"], #bg_custom_content .bg_example[bgfile="${escapedBg}"]`);
    if (bgElement) {
        bgElement.click();
        return;
    }

    // 移动端降级方案：直接设置 CSS 背景图 + 持久化设置
    try {
        const bgUrl = `url("backgrounds/${encodeURIComponent(bgFile)}")`;
        if (bg1) {
            bg1.style.backgroundImage = bgUrl;
        }

        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const stCtx = SillyTavern.getContext();
            if (stCtx.saveSettingsDebounced) {
                const settingsBlock = document.querySelector('#background_fitting');
                if (settingsBlock) {
                    stCtx.saveSettingsDebounced();
                }
            }
        }
        console.log(`[Theme Manager] 直接应用背景图: ${bgFile}`);
    } catch (err) {
        console.error('[Theme Manager] 直接应用背景图失败:', err);
    }
}

/**
 * 监听背景选择容器的绑定模式点击事件
 */
export function initBackgroundBindingListeners() {
    const bgMenuContent = document.getElementById('bg_menu_content');
    const bgCustomContent = document.getElementById('bg_custom_content');

    const bgObserverCallback = async (e) => {
        if (!state.isBindingMode) return;

        e.preventDefault();
        e.stopPropagation();

        const bgElement = e.target.closest('.bg_example');
        if (!bgElement) return;

        const bgFileName = bgElement.getAttribute('bgfile');
        state.themeBackgroundBindings[state.themeNameToBind] = bgFileName;
        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(state.themeBackgroundBindings));

        state.isBindingMode = false;
        const savedThemeNameToBind = state.themeNameToBind;
        state.themeNameToBind = null;

        const originalSelect = document.querySelector('#themes');
        if (originalSelect && savedThemeNameToBind === originalSelect.value) {
            applyBackgroundDirectly(bgFileName);
        }

        const settingsToggleButton = document.querySelector('#user-settings-button .drawer-toggle');
        if (settingsToggleButton) {
            const userSettingsPanel = document.querySelector('#user-settings-block');
            if (userSettingsPanel && userSettingsPanel.classList.contains('closedDrawer')) {
                settingsToggleButton.click();
            }
        }

        setTimeout(() => {
            const bgDrawer = document.querySelector('#Backgrounds');
            if (bgDrawer && !bgDrawer.classList.contains('closedDrawer')) {
                const bgToggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                if (bgToggleButton) {
                    bgToggleButton.click();
                }
            }
        }, 150);

        if (typeof state.softRefreshUIFn === 'function') {
            state.softRefreshUIFn([savedThemeNameToBind]);
        }
    };

    if (bgMenuContent) bgMenuContent.addEventListener('click', bgObserverCallback, true);
    if (bgCustomContent) bgCustomContent.addEventListener('click', bgObserverCallback, true);
}

/**
 * 初始化背景选择 Drawer 的批量删除增强功能
 */
export function initBackgroundEnhancements() {
    const bgDrawer = document.getElementById('Backgrounds');
    if (!bgDrawer) return;

    const headerRow = bgDrawer.querySelector('.bg-header-row-1');
    if (!headerRow || document.getElementById('tm-bg-batch-toggle-btn')) return;

    let isBatchMode = false;
    const selectedBgs = new Set();

    const batchToggleBtn = document.createElement('div');
    batchToggleBtn.id = 'tm-bg-batch-toggle-btn';
    batchToggleBtn.className = 'menu_button menu_button_icon';
    batchToggleBtn.title = '批量删除背景';
    batchToggleBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
    headerRow.appendChild(batchToggleBtn);

    const actionsBar = document.createElement('div');
    actionsBar.id = 'tm-bg-batch-actions-bar';
    actionsBar.style.display = 'none';
    actionsBar.innerHTML = `
        <button id="tm-bg-select-all-btn" class="menu_button menu_button_icon"><i class="fa-solid fa-check-double"></i>全选</button>
        <button id="tm-bg-batch-delete-btn" class="menu_button menu_button_icon" disabled><i class="fa-solid fa-trash-can"></i>删除选中</button>
        <span class="tm-bg-count"></span>
    `;

    const bgTabs = bgDrawer.querySelector('#bg_tabs');
    if (bgTabs) {
        bgTabs.parentNode.insertBefore(actionsBar, bgTabs);
    }

    const selectAllBtn = actionsBar.querySelector('#tm-bg-select-all-btn');
    const deleteBtn = actionsBar.querySelector('#tm-bg-batch-delete-btn');
    const countSpan = actionsBar.querySelector('.tm-bg-count');

    function updateCount() {
        countSpan.textContent = selectedBgs.size > 0 ? `已选 ${selectedBgs.size} 项` : '';
        deleteBtn.disabled = selectedBgs.size === 0;
    }

    function injectCheckboxes(container) {
        if (!container) return;
        container.querySelectorAll('.bg_example').forEach(bgEl => {
            if (bgEl.querySelector('.tm-bg-batch-checkbox')) return;
            const bgFile = bgEl.getAttribute('bgfile');
            if (!bgFile) return;

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'tm-bg-batch-checkbox';
            cb.dataset.bgfile = bgFile;
            cb.checked = selectedBgs.has(bgFile);

            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                if (cb.checked) {
                    selectedBgs.add(bgFile);
                    bgEl.classList.add('tm-bg-selected');
                } else {
                    selectedBgs.delete(bgFile);
                    bgEl.classList.remove('tm-bg-selected');
                }
                updateCount();
            });

            cb.addEventListener('click', (e) => { e.stopPropagation(); });
            bgEl.style.position = 'relative';
            bgEl.prepend(cb);
        });
    }

    const bgMenuContent = document.getElementById('bg_menu_content');
    const bgCustomContent = document.getElementById('bg_custom_content');
    injectCheckboxes(bgMenuContent);
    injectCheckboxes(bgCustomContent);

    let bgMutTimer = null;
    const bgMutObs = new MutationObserver(() => {
        if (bgMutTimer) clearTimeout(bgMutTimer);
        bgMutTimer = setTimeout(() => {
            injectCheckboxes(bgMenuContent);
            injectCheckboxes(bgCustomContent);
        }, 200);
    });
    if (bgMenuContent) bgMutObs.observe(bgMenuContent, { childList: true });
    if (bgCustomContent) bgMutObs.observe(bgCustomContent, { childList: true });

    batchToggleBtn.addEventListener('click', () => {
        isBatchMode = !isBatchMode;
        batchToggleBtn.classList.toggle('active', isBatchMode);

        const bgTabsPanel = bgDrawer.querySelector('#bg_tabs');
        if (bgTabsPanel) bgTabsPanel.classList.toggle('tm-bg-batch-mode', isBatchMode);

        actionsBar.style.display = isBatchMode ? 'flex' : 'none';

        if (!isBatchMode) {
            selectedBgs.clear();
            bgDrawer.querySelectorAll('.tm-bg-selected').forEach(el => el.classList.remove('tm-bg-selected'));
            bgDrawer.querySelectorAll('.tm-bg-batch-checkbox').forEach(cb => cb.checked = false);
            updateCount();
        }
    });

    selectAllBtn.addEventListener('click', () => {
        const activeTab = document.querySelector('#bg_tabs .ui-tabs-panel[aria-hidden="false"]') ||
            document.querySelector('#bg_tabs .ui-tabs-panel:not([hidden])') ||
            bgMenuContent;
        if (!activeTab) return;

        const allBgEls = activeTab.querySelectorAll('.bg_example[bgfile]');
        const allSelected = [...allBgEls].every(el => selectedBgs.has(el.getAttribute('bgfile')));

        allBgEls.forEach(el => {
            const bgFile = el.getAttribute('bgfile');
            const cb = el.querySelector('.tm-bg-batch-checkbox');
            if (allSelected) {
                selectedBgs.delete(bgFile);
                el.classList.remove('tm-bg-selected');
                if (cb) cb.checked = false;
            } else {
                selectedBgs.add(bgFile);
                el.classList.add('tm-bg-selected');
                if (cb) cb.checked = true;
            }
        });
        updateCount();
    });

    deleteBtn.addEventListener('click', async () => {
        if (selectedBgs.size === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedBgs.size} 个背景图吗？此操作不可撤销。`)) return;

        if (typeof ctx.showLoader === 'function') ctx.showLoader();
        const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
        const bgsToDelete = Array.from(selectedBgs);

        const results = await limitConcurrency(5, bgsToDelete, async (bgFile) => {
            const response = await fetch('/api/backgrounds/delete', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ bg: bgFile })
            });
            if (!response.ok) throw new Error(await response.text());
            return bgFile;
        });

        let successCount = 0;
        let errorCount = 0;
        const successfullyDeleted = [];

        results.forEach((res, index) => {
            const bgFile = bgsToDelete[index];
            if (res.status === 'fulfilled') {
                successCount++;
                successfullyDeleted.push(bgFile);
            } else {
                console.error(`删除背景 "${bgFile}" 失败:`, res.reason);
                errorCount++;
            }
        });

        successfullyDeleted.forEach(bgFile => {
            const elements = document.querySelectorAll(`.bg_example[bgfile="${bgFile}"]`);
            elements.forEach(el => el.remove());
            selectedBgs.delete(bgFile);
        });

        if (typeof ctx.hideLoader === 'function') ctx.hideLoader();

        let message = `删除完成！成功 ${successCount} 个`;
        if (errorCount > 0) {
            message += `，失败 ${errorCount} 个。`;
            toastr.warning(message);
        } else {
            message += '。';
            toastr.success(message);
        }

        updateCount();
    });
}
