/**
 * modules/avatar-replace.js
 * 角色卡与用户头像详情页“替换卡图/头像”快捷按钮注入与管理
 */

export function initAvatarReplace(config) {
    const {
        ENABLE_REPLACE_AVATAR_BTN_KEY = 'themeManager_enableReplaceAvatarBtn',
        toastr
    } = config;

    function removeReplaceImageButtons() {
        if (typeof $ !== 'undefined') {
            $('#theme-manager-char-replace-image-btn, .theme-manager-char-replace-image-btn').remove();
            $('#theme-manager-user-replace-image-btn, .theme-manager-user-replace-image-btn').remove();
        }
    }

    function registerReplaceImageButtons() {
        if (localStorage.getItem(ENABLE_REPLACE_AVATAR_BTN_KEY) === 'false') {
            removeReplaceImageButtons();
            return;
        }

        // 极速短路：若角色卡与用户两处替换按钮均已挂载，微秒级直接返回，消除每秒定时器无谓的 DOM 深度扫描
        const charBtnExists = document.getElementById('theme-manager-char-replace-image-btn');
        const userBtnExists = document.getElementById('theme-manager-user-replace-image-btn');
        if (charBtnExists && userBtnExists) return;

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
                        if (toastr) toastr.warning('未找到角色卡头像上传组件。');
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
                        const userAvatarOverwrite = document.getElementById('avatar_upload_overwrite');
                        if (userAvatarInput && userAvatarOverwrite) {
                            const currentPersona = typeof user_avatar !== 'undefined' ? user_avatar : '';
                            userAvatarOverwrite.value = currentPersona;
                            userAvatarInput.click();
                        } else {
                            if (toastr) toastr.warning('未找到用户头像上传组件。');
                        }
                    }
                });

                const $deletePersonaBtn = $container.find('#persona_delete_button');
                if ($deletePersonaBtn.length > 0) {
                    $btn.insertBefore($deletePersonaBtn);
                } else {
                    $container.append($btn);
                }
            }
        });
    }

    function initAvatarReplaceListeners() {
        registerReplaceImageButtons();
        setInterval(registerReplaceImageButtons, 1000);
        if (typeof $ !== 'undefined') {
            $(document).on('click', '#rightNavDrawerIcon, #avatar-and-name-block, #persona_controls, .character_select, .persona_item, .drawer-icon, #user_avatar_block', function() {
                setTimeout(registerReplaceImageButtons, 50);
                setTimeout(registerReplaceImageButtons, 300);
            });
        }
    }

    return {
        removeReplaceImageButtons,
        registerReplaceImageButtons,
        initAvatarReplaceListeners
    };
}
