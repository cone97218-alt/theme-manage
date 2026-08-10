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
