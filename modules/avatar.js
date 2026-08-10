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

    // 定时轮询注册替换卡图/头像按钮
    setInterval(registerReplaceImageButtons, 1000);
}

export function removeReplaceImageButtons() {
    if (typeof $ !== 'undefined') {
        $('#theme-manager-char-replace-image-btn, .theme-manager-char-replace-image-btn').remove();
        $('#theme-manager-user-replace-image-btn, .theme-manager-user-replace-image-btn').remove();
    }
}

export function registerReplaceImageButtons() {
    if (localStorage.getItem('themeManager_enableReplaceAvatarBtn') === 'false') {
        removeReplaceImageButtons();
        return;
    }
    if (typeof $ === 'undefined') return;

    // 1. 角色卡详情页替换卡图按钮
    $('.form_create_bottom_buttons_block').each(function() {
        const $container = $(this);
        if ($container.find('#theme-manager-char-replace-image-btn').length === 0) {
            const $btn = $('<div>', {
                id: 'theme-manager-char-replace-image-btn',
                class: 'menu_button fa-solid fa-file-image theme-manager-char-replace-image-btn',
                title: '替换角色卡图片',
                'data-i18n': '[title]替换角色卡图片'
            }).on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const addAvatarBtn = document.getElementById('add_avatar_button');
                if (addAvatarBtn) {
                    addAvatarBtn.click();
                } else {
                    toastr.warning('未找到角色卡头像上传组件。');
                }
            });

            const $deleteBtn = $container.find('#delete_button');
            if ($deleteBtn.length > 0) {
                $btn.insertBefore($deleteBtn);
            } else {
                $container.append($btn);
            }
        }
    });

    // 2. 用户详情页替换头像按钮
    $('.persona_controls_buttons_block').each(function() {
        const $container = $(this);
        if ($container.find('#theme-manager-user-replace-image-btn').length === 0) {
            const $btn = $('<div>', {
                id: 'theme-manager-user-replace-image-btn',
                class: 'menu_button fa-solid fa-file-image theme-manager-user-replace-image-btn',
                title: '替换用户头像图片',
                'data-i18n': '[title]替换用户头像图片'
            }).on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const personaSetImgBtn = document.getElementById('persona_set_image_button');
                if (personaSetImgBtn) {
                    personaSetImgBtn.click();
                } else {
                    const userAvatarInput = document.getElementById('avatar_upload_file');
                    if (userAvatarInput) userAvatarInput.click();
                    else toastr.warning('未找到用户头像上传组件。');
                }
            });

            const $deleteBtn = $container.find('#persona_delete_button');
            if ($deleteBtn.length > 0) {
                $btn.insertBefore($deleteBtn);
            } else {
                $container.append($btn);
            }
        }
    });
}

