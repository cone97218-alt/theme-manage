/**
 * avatar.js
 * 角色卡片/头像绑定美化功能
 */

import { state } from './state.js';
import { CHARACTER_THEME_BINDINGS_KEY } from './constants.js';
import { loadThemeTags } from './tags-core.js';
import { escapeHtml, triggerSelectChange } from './utils.js';
import { applyBackgroundDirectly } from './background.js';

/**
 * 解析目标（主题名或 [Tag] 格式）并返回最终要应用的主题名
 * @param {string} target 目标名称或 [Tag] 标识
 */
export function getThemeForTarget(target) {
    if (!target) return null;
    if (target.startsWith('[Tag] ')) {
        const tagId = target.replace('[Tag] ', '');
        const tags = loadThemeTags();
        const tag = tags.find(t => t.id === tagId);
        if (!tag || !tag.themes || tag.themes.length === 0) return null;

        const pool = state.allParsedThemes.filter(t => tag.themes.includes(t.value));
        if (pool.length > 0) {
            return pool[Math.floor(Math.random() * pool.length)].value;
        }
    } else {
        if (state.stKnownThemes.has(target)) return target;
    }
    return null;
}

/**
 * 从 URL 或路径中提取纯文件名
 * @param {string} url
 */
export function getAvatarFilename(url) {
    if (!url) return '';
    let cleanUrl = url.split('?')[0].split('#')[0];
    const lastSlash = cleanUrl.lastIndexOf('/');
    if (lastSlash !== -1) {
        cleanUrl = cleanUrl.substring(lastSlash + 1);
    }
    try {
        return decodeURIComponent(cleanUrl);
    } catch (e) {
        return cleanUrl;
    }
}

/**
 * 为特定头像名应用绑定的美化
 * @param {string} avatarName
 */
export function applyBoundThemeForCharacter(avatarName) {
    console.log(`[Theme Manager Debug] applyBoundThemeForCharacter called with:`, avatarName);
    if (!avatarName) return;
    const cleanName = getAvatarFilename(avatarName);
    if (!cleanName) return;

    const bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
    const target = bindings[cleanName];

    if (target) {
        const themeToApply = getThemeForTarget(target);
        if (themeToApply) {
            const themeSelect = document.querySelector('#themes');
            if (themeSelect) {
                if (themeSelect.value !== themeToApply) {
                    console.log(`[Theme Manager] 角色绑定触发切换: ${themeToApply} (来源: ${target})`);
                    themeSelect.value = themeToApply;
                    triggerSelectChange(themeSelect);
                    toastr.info(`已应用角色绑定的美化：<b>${escapeHtml(themeToApply)}</b>`, '', { timeOut: 2000, escapeHtml: false });
                }
            }

            const boundBg = state.themeBackgroundBindings[themeToApply];
            if (boundBg) {
                applyBackgroundDirectly(boundBg);
            }
        }
    }
}

/**
 * 初始化角色卡片和最近聊天面板的点击监听器
 */
export function initCharacterBindingListeners() {
    const rightNavPanel = document.getElementById('right-nav-panel');
    if (rightNavPanel) {
        rightNavPanel.addEventListener('click', (event) => {
            const characterBlock = event.target.closest('.character_select');
            if (!characterBlock) return;

            setTimeout(() => {
                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const characters = SillyTavern.getContext().characters;
                    const chid = characterBlock.dataset.chid;
                    const character = characters ? characters[chid] : null;
                    if (character && character.avatar) {
                        applyBoundThemeForCharacter(character.avatar);
                    }
                }
            }, 50);
        });
    }

    const chatArea = document.getElementById('chat');
    if (chatArea) {
        chatArea.addEventListener('click', (event) => {
            const recentChatBlock = event.target.closest('.recentChat');
            if (!recentChatBlock) return;

            const characterAvatar = recentChatBlock.dataset.avatar;
            if (characterAvatar) {
                setTimeout(() => {
                    applyBoundThemeForCharacter(characterAvatar);
                }, 50);
            }
        });
    }
}
