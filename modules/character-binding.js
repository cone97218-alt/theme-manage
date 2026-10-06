/**
 * modules/character-binding.js
 * 角色卡专属美化绑定与自动随动监听
 */
export function initCharacterBinding({
    CHARACTER_THEME_BINDINGS_KEY,
    loadThemeTags,
    allParsedThemes,
    stKnownThemes,
    themeBackgroundBindings,
    applyThemeDirect,
    updateActiveState,
    applyBackgroundDirectly,
    escapeHtml
}) {
    // 核心工具：解析目标（主题名或 [Tag] 格式）并返回最终要应用的主题名
    function getThemeForTarget(target) {
        if (!target) return null;
        if (target.startsWith('[Tag] ')) {
            const tagId = target.replace('[Tag] ', '');
            const tags = typeof loadThemeTags === 'function' ? loadThemeTags() : [];
            const tag = tags.find(t => t.id === tagId);
            if (!tag || !tag.themes || tag.themes.length === 0) return null;

            const pool = allParsedThemes.filter(t => tag.themes.includes(t.value));
            if (pool.length > 0) {
                return pool[Math.floor(Math.random() * pool.length)].value;
            }
        } else {
            const raw = String(target).trim();
            const clean = raw.replace(/\s*\(\d+\)$/, '').trim();
            // 检查主题是否仍然存在 (支持精确匹配、去除 (1) 副本后缀、或大小写匹配)
            if (stKnownThemes && stKnownThemes.has(raw)) return raw;
            if (clean && stKnownThemes && stKnownThemes.has(clean)) return clean;
            if (stKnownThemes) {
                for (const name of stKnownThemes) {
                    if (name && (name.toLowerCase() === raw.toLowerCase() || name.toLowerCase() === clean.toLowerCase())) {
                        return name;
                    }
                }
            }
            if (Array.isArray(allParsedThemes) && allParsedThemes.some(t => t.value === raw || t.value === clean)) {
                return raw;
            }
        }
        return null;
    }

    // 从 URL 或路径中提取纯文件名（兼容处理以保持与保存端键名一致）
    function getAvatarFilename(url) {
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

    // 核心功能：为特定头像名应用绑定的值（可能是具体主题，也可能是标签随机）
    function applyBoundThemeForCharacter(avatarName) {
        if (!avatarName) return;
        const cleanName = getAvatarFilename(avatarName);
        if (!cleanName) return;

        let bindings = {};
        try {
            bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
        } catch (e) {
            bindings = {};
        }

        const target = bindings[cleanName];
        if (target) {
            const themeToApply = getThemeForTarget(target);
            if (themeToApply) {
                const themeSelect = document.querySelector('#themes');
                if (themeSelect) {
                    if (themeSelect.value !== themeToApply) {
                        console.log(`[Theme Manager] 角色绑定触发切换: ${themeToApply} (来源: ${target})`);
                        applyThemeDirect(themeToApply);
                        if (typeof updateActiveState === 'function') updateActiveState();
                        if (typeof toastr !== 'undefined') {
                            toastr.info(`已应用角色绑定的美化：<b>${escapeHtml ? escapeHtml(themeToApply) : themeToApply}</b>`, '', { timeOut: 2000, escapeHtml: false });
                        }
                    }
                }

                // 强制同步背景图
                const boundBg = themeBackgroundBindings ? themeBackgroundBindings[themeToApply] : null;
                if (boundBg && typeof applyBackgroundDirectly === 'function') {
                    applyBackgroundDirectly(boundBg);
                }
            }
        }
    }

    // 监听角色卡片的点击事件以自动应用美化
    const rightNavPanel = document.getElementById('right-nav-panel');
    if (rightNavPanel) {
        rightNavPanel.addEventListener('click', (event) => {
            const characterBlock = event.target.closest('.character_select');
            if (!characterBlock) return;

            setTimeout(() => {
                if (window.SillyTavern && SillyTavern.getContext) {
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

    // 监听欢迎页面“最近的聊天”列表的点击事件，以自动应用美化
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

    return {
        getThemeForTarget,
        applyBoundThemeForCharacter,
        getAvatarFilename
    };
}
