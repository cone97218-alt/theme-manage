/**
 * Avatar Advanced Adjuster (头像高级调整助手)
 * Created for SillyTavern Extension.
 * Provides double-click/long-press popup, zoom/offset adjustments, free cropping, custom frames, and gallery overrides.
 */

(function () {
    const ADJUSTMENTS_KEY = 'themeManager_avatarAdjustments';
    const FRAMES_KEY = 'themeManager_customFrames';
    const BINDINGS_KEY = 'themeManager_characterThemeBindings';
    const TAGS_KEY = 'themeManager_themeTags';
    const DISABLE_ZOOM_KEY = 'themeManager_disableAvatarZoom';
    const GEOMETRY_KEY = 'themeManager_avatarPanelGeometry';
    
    let currentTargetType = 'char'; // 'char' | 'user'
    let currentAvatarFile = ''; // e.g. 'avatar.png'
    let originalAvatarUrl = ''; // Cached working source URL of the current target avatar
    let cropperInstance = null;
    let isZoomDisabled = localStorage.getItem(DISABLE_ZOOM_KEY) === 'true';
    let avatarTriggerMethod = localStorage.getItem('themeManager_avatarTriggerMethod') || 'all';
    const PREVIEW_VISIBLE_KEY = 'themeManager_avatarPreviewVisible';
    let isPreviewVisible = localStorage.getItem(PREVIEW_VISIBLE_KEY) !== 'false';
    let isHdEnabled = localStorage.getItem('themeManager_enableAvatarHD') !== 'false';

    // 获取酒馆背景色的 RGB 部分以实现 100% 不透明跟随
    function getSolidTavernColor() {
        const dummy = document.createElement('div');
        dummy.style.display = 'none';
        dummy.style.color = 'var(--SmartThemeBlurTintColor, rgba(30, 30, 30, 0.95))';
        document.body.appendChild(dummy);
        const computed = window.getComputedStyle(dummy).color;
        document.body.removeChild(dummy);
        
        if (computed) {
            const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
            }
        }
        return 'rgb(30, 30, 30)';
    }

    // 莫兰迪色系配色方案：应用到弹窗面板的背景、文字、边框颜色
    function applyPanelColorScheme(panel, scheme) {
        if (!panel) return;

        // 先重置所有自定义配色属性
        panel.style.removeProperty('background-color');
        panel.style.removeProperty('color');
        panel.style.removeProperty('border-color');
        panel.classList.remove('tm-scheme-morandi-beige', 'tm-scheme-morandi-dark');

        if (scheme === 'morandi-beige') {
            panel.style.backgroundColor = '#ece4d8';
            panel.style.color = '#4a3f35';
            panel.classList.add('tm-scheme-morandi-beige');
        } else if (scheme === 'morandi-dark') {
            panel.style.backgroundColor = '#3a3d42';
            panel.style.color = '#c8cdd4';
            panel.classList.add('tm-scheme-morandi-dark');
        } else {
            // default：跟随酒馆主题
            panel.style.backgroundColor = getSolidTavernColor();
        }
    }

    // 保存面板位置和尺寸几何属性
    function savePanelGeometry(panel) {
        const geom = {
            width: panel.style.width,
            height: panel.style.height,
            left: panel.style.left,
            top: panel.style.top
        };
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify(geom));
        console.log('[Theme Manager Avatar] Saved panel geometry:', geom);
    }

    // 从 url 中提取文件名
    function getAvatarFilename(src) {
        if (!src) return '';
        try {
            const url = new URL(src, window.location.href);
            const pathname = decodeURIComponent(url.pathname);
            const parts = pathname.split('/');
            return parts[parts.length - 1];
        } catch (e) {
            return '';
        }
    }

    // 获取当前活动的角色卡名
    function getActiveCharacterName() {
        try {
            const context = SillyTavern.getContext();
            const characters = context.characters || [];
            const characterId = context.characterId;
            const activeChar = characters[characterId];
            return activeChar ? activeChar.name : '';
        } catch (e) {
            return '';
        }
    }

    // 动态同步 body 上的 data-active-char 属性
    function updateActiveCharacterAttr() {
        const name = getActiveCharacterName();
        if (name) {
            document.body.setAttribute('data-active-char', name);
        } else {
            document.body.removeAttribute('data-active-char');
        }
    }

    // 给 DOM 中的消息 div 贴上发送者名 data-ch-name 属性标签，以实现精准 CSS 选择替换
    function tagMessageElementsWithCharName(messageEl) {
        if (!messageEl) return;
        const nameSpan = messageEl.querySelector('.name_text');
        if (nameSpan) {
            const name = nameSpan.textContent.trim();
            if (name) {
                messageEl.setAttribute('data-ch-name', name);
            }
        }
    }

    // 将消息 DOM 逐个遍历打标签
    function tagAllMessages() {
        document.querySelectorAll('.mes').forEach(tagMessageElementsWithCharName);
    }

    // 计算出唯一的存储 key (一切配置均与当前角色名称强绑定，彻底避免不同角色卡因头像文件名相同而串台的问题)
    function getAdjustmentKey(type, file) {
        const charName = getActiveCharacterName();
        if (type === 'char') {
            if (charName) {
                return `char_${charName}`;
            }
            return `char_${file}`;
        }
        // 用户头像：绑定当前活动的聊天角色名，若未加载会话，则降级为全局 key
        if (charName) {
            return `user_char_${charName}_${file}`;
        }
        return `user_global_${file}`;
    }

    // 根据当前选中的 Tab 和子页动态显示或隐藏顶部的头像/框体常驻预览区
    function adjustPreviewVisibility(panel) {
        const previewContainer = panel.querySelector('.avatar-adv-preview-container');
        if (!previewContainer) return;

        const activeTabBtn = panel.querySelector('.avatar-adv-tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'adjust';

        let activeSubtab = 'apply';
        if (activeTab === 'frame') {
            const btnStore = panel.querySelector('#btn-subtab-store');
            if (btnStore && btnStore.classList.contains('active')) {
                activeSubtab = 'store';
            }
        }

        // 头像框存储页 (frame tab && store subtab) 以及美化主题绑定页 (bind tab) 无需顶部预览
        if (activeTab === 'bind' || (activeTab === 'frame' && activeSubtab === 'store')) {
            previewContainer.style.display = 'none';
        } else {
            previewContainer.style.display = isPreviewVisible ? 'flex' : 'none';
        }
    }

    // 初始化基础 CSS
    function initStyles() {
        if (document.getElementById('avatar-adv-base-css')) return;
        const style = document.createElement('style');
        style.id = 'avatar-adv-base-css';
        style.textContent = `
            /* 1. 精准对齐与适配酒馆的外观设置 (方形/圆角/圆形/矩形头像) */
            /* 方形头像 (Square) */
            body.square-avatars .avatar-adv-preview-wrapper,
            body.square-avatars .avatar-adv-preview-wrapper img,
            body.square-avatars #shared-frame-preview,
            body.square-avatars .frame-item-card-preview,
            body.square-avatars .frame-card-preview-layer,
            body.square-avatars .frame-item-card-preview div,
            body.square-avatars #active-frame-adjust-panel div[style*="width:30px"],
            body.square-avatars #chat .mesAvatarWrapper::after {
                border-radius: var(--avatar-base-border-radius, 2px) !important;
            }
            /* 圆角矩形头像 (Rounded) */
            body.rounded-avatars .avatar-adv-preview-wrapper,
            body.rounded-avatars .avatar-adv-preview-wrapper img,
            body.rounded-avatars #shared-frame-preview,
            body.rounded-avatars .frame-item-card-preview,
            body.rounded-avatars .frame-card-preview-layer,
            body.rounded-avatars .frame-item-card-preview div,
            body.rounded-avatars #active-frame-adjust-panel div[style*="width:30px"],
            body.rounded-avatars #chat .mesAvatarWrapper::after {
                border-radius: var(--avatar-base-border-radius-rounded, 10px) !important;
            }
            /* 矩形长头像 (Rectangular / Big Avatars) */
            body.big-avatars .avatar-adv-preview-container {
                height: 220px !important;
            }
            body.big-avatars .avatar-adv-preview-wrapper {
                width: calc(110px * var(--big-avatar-width-factor, 1.2)) !important;
                height: calc(110px * var(--big-avatar-height-factor, 1.8)) !important;
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars .avatar-adv-preview-wrapper img {
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars #shared-frame-preview {
                width: calc(100% + 4px) !important;
                height: calc(100% + 4px) !important;
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars .frame-item-card-preview {
                width: calc(50px * var(--big-avatar-width-factor, 1.2)) !important;
                height: calc(50px * var(--big-avatar-height-factor, 1.8)) !important;
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars .frame-card-preview-layer {
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars .frame-item-card-preview div {
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars #active-frame-adjust-panel div[style*="width:30px"] {
                width: calc(30px * var(--big-avatar-width-factor, 1.2)) !important;
                height: calc(30px * var(--big-avatar-height-factor, 1.8)) !important;
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }
            body.big-avatars #chat .mesAvatarWrapper::after {
                width: calc(var(--avatar-base-width) * var(--big-avatar-width-factor, 1.2)) !important;
                height: calc(var(--avatar-base-height) * var(--big-avatar-height-factor, 1.8)) !important;
                border-radius: calc(var(--avatar-base-border-radius, 2px) * var(--big-avatar-border-factor, 5)) !important;
            }

            /* 2. 兼容与优化：强制使实际的头像图片捕获点击事件 */
            #chat .mesAvatarWrapper img,
            #chat .mesAvatarWrapper .avatar img,
            #chat .mesAvatarWrapper .user_avatar img,
            #right-nav-panel .character_select img {
                pointer-events: auto !important;
                cursor: pointer !important;
            }

            /* 头像缩放高清渲染优化（可选项，基于 tm-avatar-hd-rendering 类触发） */
            body.tm-avatar-hd-rendering #chat .mesAvatarWrapper img,
            body.tm-avatar-hd-rendering #chat .mesAvatarWrapper .avatar img,
            body.tm-avatar-hd-rendering #chat .mesAvatarWrapper .user_avatar img,
            body.tm-avatar-hd-rendering #right-nav-panel .character_select img {
                image-rendering: -webkit-optimize-contrast !important;
                image-rendering: crisp-edges !important;
                transform-style: preserve-3d !important;
                backface-visibility: hidden !important;
            }

            #avatar-adv-panel {
                position: fixed !important; /* 悬浮于浏览器视口固定位置，防遮挡与滚动偏离 */
                border: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.1));
                border-radius: 12px;
                box-shadow: none !important; /* 清除所有背景阴影与阴影发光 */
                z-index: 10001;
                display: flex;
                flex-direction: column;
                color: var(--SmartThemeBodyColor, #fff);
                font-family: system-ui, -apple-system, sans-serif;
                overflow: hidden;
                user-select: none;
            }
            #avatar-adv-header {
                padding: 12px 16px;
                background: transparent;
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-direction: row;
                flex-wrap: nowrap;
            }
            #avatar-adv-header h3 {
                margin: 0;
                font-size: 15px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                flex-direction: row;
                white-space: nowrap;
            }
            .avatar-adv-close-btn {
                background: none;
                border: none;
                color: inherit;
                font-size: 18px;
                cursor: pointer;
                opacity: 0.7;
                transition: opacity 0.2s;
                display: inline-flex;
                align-items: center;
            }
            .avatar-adv-close-btn:hover {
                opacity: 1;
            }
            .avatar-adv-tabs-bar {
                display: flex;
                background: transparent;
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                flex-direction: row;
            }
            .avatar-adv-tab-btn {
                flex: 1;
                padding: 10px;
                background: none;
                border: none;
                color: inherit;
                cursor: pointer;
                font-size: 16px;
                opacity: 0.6;
                transition: all 0.2s;
                border-bottom: 2px solid transparent;
                display: inline-flex;
                justify-content: center;
                align-items: center;
            }
            .avatar-adv-tab-btn.active {
                opacity: 1;
                border-bottom-color: var(--SmartThemeQuoteColor, #007bff);
                background: transparent;
            }
            .avatar-adv-content {
                flex: 1;
                padding: 16px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .avatar-adv-tab-content {
                display: none;
                height: 100%;
                flex-direction: column;
                gap: 12px;
            }
            .avatar-adv-tab-content.active {
                display: flex;
            }
            
            /* 共享预览区域 */
            .avatar-adv-preview-container {
                display: flex;
                justify-content: center;
                align-items: center;
                background: transparent;
                border: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                border-radius: 8px;
                padding: 15px;
                height: 160px;
                position: relative;
                overflow: hidden;
                flex-direction: row;
                flex-shrink: 0;
            }
            .avatar-adv-preview-wrapper {
                width: 110px;
                height: 110px;
                border-radius: var(--avatar-base-border-radius-round, 50%);
                overflow: hidden;
                position: relative;
                border: 2px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                background: transparent;
            }
            .avatar-adv-preview-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            #shared-frame-preview {
                position: absolute;
                pointer-events: none;
                border-radius: var(--avatar-base-border-radius-round, 50%);
                z-index: 5;
                display: none;
            }

            .avatar-adv-control-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .avatar-adv-control-row {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-direction: row;
                flex-wrap: nowrap;
            }
            .avatar-adv-control-row label {
                width: 70px;
                font-size: 12px;
                opacity: 0.8;
                white-space: nowrap;
            }
            .avatar-adv-control-row input[type="range"] {
                flex: 1;
                accent-color: var(--SmartThemeQuoteColor, #007bff);
            }
            .avatar-adv-control-row span {
                width: 40px;
                font-size: 11px;
                text-align: right;
                opacity: 0.6;
                white-space: nowrap;
            }
            
            /* 自由裁剪区 */
            .cropper-container-wrapper {
                width: 100%;
                height: 200px;
                background: transparent;
                border-radius: 8px;
                overflow: hidden;
            }
            
            /* 头像框网格预览 */
            .frame-list-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
                max-height: 200px;
                overflow-y: auto;
                padding: 4px;
            }
            .frame-item-card {
                background: transparent;
                border: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                border-radius: 8px;
                padding: 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .frame-item-card:hover, .frame-item-card.active {
                background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.03));
                border-color: var(--SmartThemeQuoteColor, #007bff);
            }
            .frame-item-card-preview {
                width: 50px;
                height: 50px;
                border-radius: var(--avatar-base-border-radius-round, 50%);
                position: relative;
                background: transparent;
                overflow: visible;
            }
            .frame-item-card-text {
                font-size: 11px;
                text-align: center;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                width: 100%;
            }
            
            /* 图库样式 */
            .gallery-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
                max-height: 180px;
                overflow-y: auto;
                padding: 4px;
            }
            .gallery-item {
                position: relative;
                aspect-ratio: 1;
                border-radius: 6px;
                overflow: hidden;
                cursor: pointer;
                border: 1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08));
                background: transparent;
            }
            .gallery-item:hover, .gallery-item.active {
                border-color: var(--SmartThemeQuoteColor, #007bff);
            }
            .gallery-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .gallery-item-delete {
                position: absolute;
                top: 2px;
                right: 2px;
                background: rgba(220,53,69,0.9);
                color: #fff;
                border: none;
                border-radius: 50%;
                width: 16px;
                height: 16px;
                display: none;
                align-items: center;
                justify-content: center;
                font-size: 9px;
                cursor: pointer;
                z-index: 2;
            }
            .gallery-item:hover .gallery-item-delete {
                display: inline-flex;
            }
            
            /* 拖拽手柄 - 增大手机端的可点击区域 */
            .avatar-adv-resizer {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 35px;
                height: 35px;
                cursor: se-resize;
                background: linear-gradient(135deg, transparent 21px, rgba(255,255,255,0.3) 21px);
                z-index: 10002;
            }

            .avatar-adv-form-row {
                display: flex;
                flex-direction: row;
                gap: 8px;
                align-items: center;
                flex-wrap: nowrap;
            }
            .avatar-adv-form-row label {
                font-size: 12px;
                opacity: 0.8;
                white-space: nowrap;
            }

            /* 美化绑定定制折叠列表 */
            .theme-group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 10px;
                background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.02));
                margin-top: 4px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
            }
            .theme-group-header:hover {
                background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.05));
            }
            .theme-group-content {
                display: flex;
                flex-direction: column;
                gap: 2px;
                padding: 2px 0 2px 10px;
            }
            .theme-row-item {
                padding: 5px 8px;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .theme-row-item:hover {
                background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.03));
            }
            .theme-row-item.active {
                background: rgba(0, 123, 255, 0.15) !important;
                border-left: 3px solid var(--SmartThemeQuoteColor, #007bff);
                font-weight: 600;
            }

            /* 大选项卡 (角色/用户/设置) — 纯图标紧凑方形 */
            .avatar-adv-major-tab-btn {
                flex: none;
                width: 32px;
                height: 30px;
                padding: 0;
                background: none;
                border: 1px solid transparent;
                color: inherit;
                font-size: 14px;
                cursor: pointer;
                opacity: 0.55;
                transition: all 0.18s;
                border-radius: 6px;
                display: inline-flex;
                justify-content: center;
                align-items: center;
            }
            .avatar-adv-major-tab-btn:hover {
                opacity: 0.9;
                background: rgba(255,255,255,0.05);
            }
            .avatar-adv-major-tab-btn.active {
                opacity: 1;
                background: var(--SmartThemeBlurTintColor, rgba(255,255,255,0.1)) !important;
                border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)) !important;
                font-weight: 600;
            }

            /* ===== 莫兰迪日间米色配色 ===== */
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-major-tabs-bar {
                background: rgba(0,0,0,0.05) !important;
                border-bottom-color: rgba(100,80,60,0.15) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-tabs-bar {
                background: rgba(0,0,0,0.04) !important;
                border-bottom-color: rgba(100,80,60,0.12) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-tab-btn {
                color: #5a4d42 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-tab-btn.active {
                background: rgba(100,80,60,0.12) !important;
                border-color: rgba(100,80,60,0.2) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-major-tab-btn {
                color: #5a4d42 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .avatar-adv-major-tab-btn.active {
                background: rgba(100,80,60,0.15) !important;
                border-color: rgba(100,80,60,0.25) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .menu_button {
                background: rgba(100,80,60,0.12) !important;
                color: #5a4d42 !important;
                border-color: rgba(100,80,60,0.18) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .menu_button:hover {
                background: rgba(100,80,60,0.22) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige input[type="range"] {
                accent-color: #a08060;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .text_pole {
                background: rgba(255,255,255,0.45) !important;
                border-color: rgba(100,80,60,0.2) !important;
                color: #4a3f35 !important;
            }
            /* 绑定界面元素（美化主题列表）— 日间米色 */
            #avatar-adv-panel.tm-scheme-morandi-beige .theme-group-header {
                background: rgba(100,80,60,0.07) !important;
                color: #4a3f35 !important;
                border-radius: 5px;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .theme-group-header:hover {
                background: rgba(100,80,60,0.14) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .theme-row-item {
                color: #4a3f35 !important;
                background: rgba(100,80,60,0.04) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .theme-row-item:hover {
                background: rgba(100,80,60,0.1) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige .theme-row-item.active {
                background: rgba(100,80,60,0.18) !important;
                border-left-color: #a08060 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige #bind-themes-list {
                border-color: rgba(100,80,60,0.18) !important;
                background: rgba(255,255,255,0.25) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige label {
                color: #4a3f35;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige #btn-save-theme-binding {
                background-color: #a08060 !important;
                color: #ffffff !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige #btn-save-theme-binding:hover {
                background-color: #8c7053 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-beige input[type="checkbox"] {
                background: rgba(100,80,60,0.15) !important;
                border-color: rgba(100,80,60,0.3) !important;
            }

            /* ===== 莫兰迪夜间深灰配色 ===== */
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-major-tabs-bar {
                background: rgba(0,0,0,0.18) !important;
                border-bottom-color: rgba(255,255,255,0.06) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-tabs-bar {
                background: rgba(0,0,0,0.12) !important;
                border-bottom-color: rgba(255,255,255,0.05) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-tab-btn {
                color: #b8bdc4 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-tab-btn.active {
                background: rgba(255,255,255,0.08) !important;
                border-color: rgba(255,255,255,0.1) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-major-tab-btn {
                color: #b8bdc4 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .avatar-adv-major-tab-btn.active {
                background: rgba(255,255,255,0.1) !important;
                border-color: rgba(255,255,255,0.12) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .menu_button {
                background: rgba(255,255,255,0.07) !important;
                color: #c8cdd4 !important;
                border-color: rgba(255,255,255,0.08) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .menu_button:hover {
                background: rgba(255,255,255,0.13) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark input[type="range"] {
                accent-color: #7a8a96;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .text_pole {
                background: rgba(0,0,0,0.2) !important;
                border-color: rgba(255,255,255,0.08) !important;
                color: #c8cdd4 !important;
            }
            /* 绑定界面元素（美化主题列表）— 夜间深灰 */
            #avatar-adv-panel.tm-scheme-morandi-dark .theme-group-header {
                background: rgba(255,255,255,0.05) !important;
                color: #c8cdd4 !important;
                border-radius: 5px;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .theme-group-header:hover {
                background: rgba(255,255,255,0.1) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .theme-row-item {
                color: #c8cdd4 !important;
                background: rgba(255,255,255,0.03) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .theme-row-item:hover {
                background: rgba(255,255,255,0.07) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark .theme-row-item.active {
                background: rgba(255,255,255,0.12) !important;
                border-left-color: #7a8a96 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark #bind-themes-list {
                border-color: rgba(255,255,255,0.08) !important;
                background: rgba(0,0,0,0.15) !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark label {
                color: #c8cdd4;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark #btn-save-theme-binding {
                background-color: #7a8a96 !important;
                color: #ffffff !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark #btn-save-theme-binding:hover {
                background-color: #657480 !important;
            }
            #avatar-adv-panel.tm-scheme-morandi-dark input[type="checkbox"] {
                background: rgba(0,0,0,0.2) !important;
                border-color: rgba(255,255,255,0.15) !important;
            }

            /* 窄拖拽条 */
            .avatar-adv-drag-strip {
                width: 100%;
                height: 8px;
                cursor: move;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.35;
                transition: opacity 0.2s;
                margin: 4px 0 0 0;
            }
            .avatar-adv-drag-strip::after {
                content: '';
                display: block;
                width: 36px;
                height: 3px;
                border-radius: 3px;
                background: currentColor;
            }
            .avatar-adv-drag-strip:hover {
                opacity: 0.7;
            }
        `;
        document.head.appendChild(style);
    }

    // 更新整个酒馆界面的头像样式规则
    function applyAvatarStyles() {
        let styleEl = document.getElementById('avatar-adv-dynamic-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'avatar-adv-dynamic-style';
            document.head.appendChild(styleEl);
        }

        let adjustments = {};
        try {
            adjustments = JSON.parse(localStorage.getItem(ADJUSTMENTS_KEY)) || {};
        } catch (e) {
            console.error('[Theme Manager Avatar] Failed to parse adjustments:', e);
        }
        
        let customFrames = [];
        try {
            customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
        } catch (e) {}
        
        const isFrameEnabled = localStorage.getItem('themeManager_enableAvatarFrame') === 'true';
        let css = '';

        Object.keys(adjustments).forEach(key => {
            const adj = adjustments[key];
            if (!adj) return;
            
            let type = 'char';
            let imgSelector = '';
            let parentSelector = '';

            // 1. 角色卡配置样式渲染生成 (基于独特的 charName 绝对隔离)
            if (key.startsWith('char_')) {
                type = 'char';
                const targetCharName = key.substring(5);
                
                // 判断如果是带有常见文件后缀的老版本 Key，采用 src 进行模糊匹配兼容
                if (targetCharName.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
                    imgSelector = `#chat .mes:not([is_user="true"]) .mesAvatarWrapper img[src*="${targetCharName}"]`;
                    parentSelector = `#chat .mes:not([is_user="true"]):has(img[src*="${targetCharName}"]) .mesAvatarWrapper`;
                } else {
                    // 新版完美的以 data-ch-name 驱动 of the sender CSS 匹配，百分百杜绝对相同头像文件名的角色造成的串台污染
                    imgSelector = `#chat .mes[data-ch-name="${targetCharName}"]:not([is_user="true"]) .mesAvatarWrapper img`;
                    parentSelector = `#chat .mes[data-ch-name="${targetCharName}"]:not([is_user="true"]) .mesAvatarWrapper`;
                }
            } 
            // 2. 角色绑定的用户头像配置样式
            else if (key.startsWith('user_char_')) {
                type = 'user';
                // 格式: user_char_${charName}_${file}
                const parts = key.substring(10).split('_');
                const file = parts[parts.length - 1];
                const targetCharName = parts.slice(0, parts.length - 1).join('_');

                imgSelector = `body[data-active-char="${targetCharName}"] #chat .mes[is_user="true"] .mesAvatarWrapper img[src*="${file}"]`;
                parentSelector = `body[data-active-char="${targetCharName}"] #chat .mes[is_user="true"]:has(img[src*="${file}"]) .mesAvatarWrapper`;
            } 
            // 3. 全局用户头像配置样式 (降级兼容)
            else if (key.startsWith('user_global_')) {
                type = 'user';
                const file = key.substring(12);
                imgSelector = `#chat .mes[is_user="true"] .mesAvatarWrapper img[src*="${file}"]`;
                parentSelector = `#chat .mes[is_user="true"]:has(img[src*="${file}"]) .mesAvatarWrapper`;
            }

            if (!imgSelector) return;

            // 1. 本地图库视觉覆盖替换
            const resolvedUrl = resolveImageUrl(adj.overrideUrl);
            if (resolvedUrl) {
                css += `
                    ${imgSelector} {
                        content: url("${resolvedUrl}") !important;
                    }
                `;
            }

            // 2. 图像属性微调 (缩放与位移)
            const zoom = adj.zoom || 1;
            const x = adj.x || 0;
            const y = adj.y || 0;

            css += `
                ${imgSelector} {
                    transform: scale(${zoom}) translate(${x}%, ${y}%) !important;
                    transform-origin: center center !important;
                }
            `;

            // 仅为进行了微调或替换的头像容器子元素应用尺寸撑满与裁剪，防止图片位移重叠溢出，同时确保兼容自定义头像大小的主题，避免全局污染
            css += `
                ${parentSelector} .avatar, ${parentSelector} .user_avatar {
                    width: 100%;
                    height: 100%;
                    overflow: hidden !important;
                }
                ${parentSelector} .avatarimg {
                    overflow: hidden !important;
                }
            `;

            // 3. 头像框渲染
            if (isFrameEnabled && adj.frame && adj.frame !== 'none') {
                let frameStyle = '';
                const frameObj = customFrames.find(f => f.id === adj.frame);
                if (frameObj) {
                    frameStyle = `background: url("${frameObj.url}") no-repeat center/contain; border: none; box-shadow: none;`;
                }

                if (frameStyle) {
                    const size = adj.frameSize !== undefined ? adj.frameSize : 2;
                    const opacity = adj.frameOpacity !== undefined ? adj.frameOpacity : 1;
                    const fx = adj.frameX !== undefined ? adj.frameX : 0;
                    const fy = adj.frameY !== undefined ? adj.frameY : 0;
                    const fs = adj.frameScale !== undefined ? adj.frameScale : 1;

                    css += `
                        ${parentSelector} {
                            position: relative !important;
                        }
                        ${parentSelector}::after {
                            content: "";
                            position: absolute;
                            width: var(--avatar-base-width, 40px) !important;
                            height: var(--avatar-base-height, 40px) !important;
                            top: 0 !important;
                            left: 50% !important;
                            pointer-events: none;
                            z-index: 5;
                            border-radius: var(--avatar-base-border-radius-round, 50%);
                            opacity: ${opacity};
                            ${frameStyle}
                            transform: translate(-50%, 0) scale(${fs}) translate(${fx}px, ${fy}px) !important;
                            transform-origin: center center !important;
                        }
                    `;
                }
            }
        });

        styleEl.textContent = css;
        console.log('[Theme Manager Avatar] Applied dynamic CSS styles to document.');
    }

    // 获取特定 key 的配置
    function getAdjustment(type, file) {
        let adjustments = {};
        try {
            adjustments = JSON.parse(localStorage.getItem(ADJUSTMENTS_KEY)) || {};
        } catch (e) {}
        
        const key = getAdjustmentKey(type, file);
        return adjustments[key] || {
            zoom: 1,
            x: 0,
            y: 0,
            frame: 'none',
            frameSize: 2,
            frameOpacity: 1,
            frameX: 0,
            frameY: 0,
            frameScale: 1,
            overrideUrl: '',
            gallery: []
        };
    }

    // 保存特定 key 的配置
    function saveAdjustment(type, file, data) {
        let adjustments = {};
        try {
            adjustments = JSON.parse(localStorage.getItem(ADJUSTMENTS_KEY)) || {};
        } catch (e) {}
        
        const key = getAdjustmentKey(type, file);
        adjustments[key] = data;
        localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(adjustments));
        applyAvatarStyles();
    }

    // ==========================================================
    // ================== IndexedDB 存储优化 ====================
    // ==========================================================
    const DB_NAME = 'ThemeManagerGalleryDB';
    const STORE_NAME = 'images';
    let dbInstance = null;
    const galleryBlobUrlCache = {};

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            request.onerror = (e) => {
                console.error('[Theme Manager DB] Failed to open IndexedDB:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    function saveImageBlob(id, name, blob) {
        return new Promise((resolve, reject) => {
            if (!dbInstance) return reject(new Error('Database not initialized'));
            const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ id, name, blob });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    function getImageBlob(id) {
        return new Promise((resolve, reject) => {
            if (!dbInstance) return reject(new Error('Database not initialized'));
            const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = (e) => resolve(e.target.result ? e.target.result.blob : null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    function deleteImageBlob(id) {
        return new Promise((resolve, reject) => {
            if (!dbInstance) return reject(new Error('Database not initialized'));
            const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    function getAllImages() {
        return new Promise((resolve, reject) => {
            if (!dbInstance) return reject(new Error('Database not initialized'));
            const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = (e) => resolve(e.target.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // 辅助转换 base64 到 Blob
    function dataURLtoBlob(dataurl) {
        try {
            const arr = dataurl.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            return new Blob([u8arr], { type: mime });
        } catch (e) {
            console.error('[Theme Manager DB] dataURLtoBlob conversion failed:', e);
            return null;
        }
    }

    // 迁移旧版 localStorage 中的 Base64 图片到 IndexedDB 中以节省 5MB 容量
    async function migrateBase64Gallery() {
        let adjustments = {};
        try {
            adjustments = JSON.parse(localStorage.getItem(ADJUSTMENTS_KEY)) || {};
        } catch (e) {}

        let globalGallery = [];
        try {
            globalGallery = JSON.parse(localStorage.getItem('themeManager_globalUserGallery')) || [];
        } catch (e) {}

        let migratedAny = false;

        // 1. 迁移 adjustments 角色卡私有图库
        for (const key in adjustments) {
            const adj = adjustments[key];
            if (adj && adj.gallery && Array.isArray(adj.gallery)) {
                for (let i = 0; i < adj.gallery.length; i++) {
                    const item = adj.gallery[i];
                    if (item && item.url && item.url.startsWith('data:')) {
                        const blob = dataURLtoBlob(item.url);
                        if (blob) {
                            const id = item.id || `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                            item.id = id;
                            await saveImageBlob(id, item.name, blob);
                            item.url = `db://${id}`;
                            migratedAny = true;
                        }
                    }
                }
            }
            // 额外支持直接覆盖的 base64 迁移
            if (adj && adj.overrideUrl && adj.overrideUrl.startsWith('data:')) {
                const blob = dataURLtoBlob(adj.overrideUrl);
                if (blob) {
                    const id = `img_override_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                    await saveImageBlob(id, 'override_avatar', blob);
                    adj.overrideUrl = `db://${id}`;
                    migratedAny = true;
                }
            }
        }

        // 2. 迁移全局用户图库
        if (Array.isArray(globalGallery)) {
            for (let i = 0; i < globalGallery.length; i++) {
                const item = globalGallery[i];
                if (item && item.url && item.url.startsWith('data:')) {
                    const blob = dataURLtoBlob(item.url);
                    if (blob) {
                        const id = item.id || `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                        item.id = id;
                        await saveImageBlob(id, item.name, blob);
                        item.url = `db://${id}`;
                        migratedAny = true;
                    }
                }
            }
        }

        if (migratedAny) {
            localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(adjustments));
            localStorage.setItem('themeManager_globalUserGallery', JSON.stringify(globalGallery));
            console.log('[Theme Manager DB] Successfully migrated legacy base64 images to IndexedDB.');
        }
    }

    // 预加载所有 IndexedDB 中的 Blob 并生成临时 Object URL 存入缓存
    async function loadGalleryBlobsToCache() {
        try {
            const list = await getAllImages();
            list.forEach(item => {
                if (item.blob) {
                    if (galleryBlobUrlCache[item.id]) {
                        URL.revokeObjectURL(galleryBlobUrlCache[item.id]);
                    }
                    galleryBlobUrlCache[item.id] = URL.createObjectURL(item.blob);
                }
            });
            console.log(`[Theme Manager DB] Cached ${list.length} gallery images as Blob Object URLs.`);
        } catch (e) {
            console.error('[Theme Manager DB] Failed to load blobs to cache:', e);
        }
    }

    // 解析 db:// 前缀协议并映射为临时的 Blob URL，若非 db:// 则直接放行 URL 原文
    function resolveImageUrl(url) {
        if (url && url.startsWith('db://')) {
            const id = url.substring(5);
            return galleryBlobUrlCache[id] || '';
        }
        return url || '';
    }

    // 识别点击元素属于 char 还是 user
    function identifyAvatar(element) {
        const mesBlock = element.closest('.mes');
        let type = 'char';
        let src = '';

        if (mesBlock) {
            const isUserAttr = mesBlock.getAttribute('is_user');
            if (isUserAttr === 'true') {
                type = 'user';
            }
        } else if (element.closest('#persona-management-block') || element.closest('#user_avatar_block')) {
            type = 'user';
        }

        // 尝试获取 img src
        const img = element.tagName === 'IMG' ? element : element.querySelector('img');
        if (img) {
            src = img.getAttribute('src') || '';
        } else {
            const bg = window.getComputedStyle(element).backgroundImage;
            if (bg && bg !== 'none') {
                const match = bg.match(/url\("?([^"]*)"?\)/);
                if (match) src = match[1];
            }
        }

        let file = '';
        if (type === 'char') {
            const charSelect = element.closest('.character_select');
            let charObj = null;
            const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
            if (context && context.characters) {
                if (charSelect && charSelect.dataset.chid !== undefined) {
                    charObj = context.characters[charSelect.dataset.chid];
                } else if (mesBlock) {
                    const charName = mesBlock.getAttribute('data-ch-name') || mesBlock.querySelector('.name_text')?.textContent?.trim();
                    if (charName) {
                        charObj = context.characters.find(c => c.name === charName);
                    }
                } else {
                    charObj = context.characters[context.characterId];
                }
            }

            if (charObj && charObj.avatar) {
                file = charObj.avatar;
            }
        }

        if (!file) {
            file = getAvatarFilename(src);
        }

        return { type, file, src };
    }

    // 动态获取当前活动的角色头像/用户头像文件及 URL 信息
    function getActiveAvatarInfo(type) {
        let file = '';
        let src = '';
        if (type === 'char') {
            const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
            if (context && context.characters && context.characterId !== undefined) {
                const charObj = context.characters[context.characterId];
                if (charObj && charObj.avatar) {
                    file = charObj.avatar;
                }
            }
            const charImg = document.querySelector('#avatar_div img, #right-nav-panel .character_select.selected img, .avatar img');
            src = charImg ? charImg.src : (file ? `/characters/${file}` : '');
            if (!file && src) file = getAvatarFilename(src);
        } else {
            const userImg = document.querySelector('#user_avatar_block img, .user_avatar img');
            src = userImg ? userImg.src : '';
            file = getAvatarFilename(src);
        }
        return { file, src };
    }

    // 弹窗创建
    function openPanel(type, file, src) {
        // 如果未传入 file/src，则动态获取
        if (!file || !src) {
            const info = getActiveAvatarInfo(type);
            file = info.file;
            src = info.src;
        }

        // 在打开任何新弹窗前，绝对优先关闭并清除已有的弹窗资源，防止多个弹窗 DOM 并存导致冲突卡死
        closePanel();

        currentTargetType = type;
        currentAvatarFile = file;
        originalAvatarUrl = src;

        // 打标签保证新加载的弹窗下背景也是正确的
        tagAllMessages();

        // 所有的头像调整与头像框应用配置默认与该角色卡强绑定，不再设置外部应用范围单选框
        let adj = getAdjustment(type, file);

        // 图库子选项卡类型记录，默认为全局（仅 user 才有全局/角色分流，char 只有唯一的角色图库）
        let gallerySubtab = (type === 'user') ? 'global' : 'char';

        const panel = document.createElement('div');
        panel.id = 'avatar-adv-panel';
        panel.style.backgroundColor = getSolidTavernColor();

        // 基于绝对视口 window 物理尺寸计算，防范 parent.getBoundingClientRect().height 读零导致的高塌陷
        let geom = null;
        try {
            geom = JSON.parse(localStorage.getItem(GEOMETRY_KEY));
        } catch (e) {}

        const viewW = window.innerWidth;
        const viewH = window.innerHeight;

        if (geom && geom.width && geom.height && geom.left && geom.top) {
            panel.style.width = geom.width;
            panel.style.height = geom.height;
            panel.style.left = geom.left;
            panel.style.top = geom.top;
            panel.style.transform = 'none';
        } else {
            let w = 480;
            let h = 540;
            
            // 确保弹窗初始大小决不超过视口的 95%
            if (w > viewW * 0.95) w = Math.floor(viewW * 0.95);
            if (h > viewH * 0.95) h = Math.floor(viewH * 0.95);
            
            const leftPx = Math.floor((viewW - w) / 2);
            const topPx = Math.floor((viewH - h) / 2);

            panel.style.width = `${w}px`;
            panel.style.height = `${h}px`;
            panel.style.left = `${leftPx}px`;
            panel.style.top = `${topPx}px`;
            panel.style.transform = 'none';
        }

        // 拼接选项卡列表
        let tabButtonsHtml = `
            <button class="avatar-adv-tab-btn active" data-tab="adjust" title="调整与自由裁剪"><i class="fa-solid fa-crop-simple"></i></button>
            <button class="avatar-adv-tab-btn" data-tab="frame" title="配置头像框"><i class="fa-solid fa-border-all"></i></button>
            <button class="avatar-adv-tab-btn" data-tab="gallery" title="本地视觉图库"><i class="fa-solid fa-images"></i></button>
        `;
        if (type === 'char') {
            tabButtonsHtml += `<button class="avatar-adv-tab-btn" data-tab="bind" title="美化主题绑定"><i class="fa-solid fa-link"></i></button>`;
        }

        // 针对 user 构建图库 subtab (全局图库 vs 角色图库)
        let galleryHeaderHtml = '';
        if (type === 'user') {
            galleryHeaderHtml = `
                <div style="display:flex; flex-direction:row; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:5px; margin-bottom:5px; flex-shrink:0;">
                    <button class="avatar-adv-tab-btn active" style="padding:4px; font-size:12px;" id="btn-gallery-subtab-global" title="全局图库">全局图库</button>
                    <button class="avatar-adv-tab-btn" style="padding:4px; font-size:12px;" id="btn-gallery-subtab-char" title="角色图库">角色图库</button>
                </div>
            `;
        }

        panel.innerHTML = `
            <!-- 窄拖拽条：最顶部，方便随处拖动弹窗 -->
            <div class="avatar-adv-drag-strip" id="avatar-adv-drag-strip" title="拖动弹窗"></div>

            <!-- 大选项卡栏：图标精简版 + 右侧功能按钮 -->
            <div class="avatar-adv-major-tabs-bar" id="avatar-adv-header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.08)); background: rgba(0,0,0,0.12); padding: 2px 10px; gap: 6px; flex-shrink: 0;">
                <!-- 左侧大选项卡（纯图标） -->
                <div style="display: flex; gap: 2px;">
                    <button class="avatar-adv-major-tab-btn ${type === 'char' ? 'active' : ''}" data-major-tab="char" title="角色头像">
                        <i class="fa-solid fa-robot"></i>
                    </button>
                    <button class="avatar-adv-major-tab-btn ${type === 'user' ? 'active' : ''}" data-major-tab="user" title="用户头像">
                        <i class="fa-solid fa-user"></i>
                    </button>
                    <button class="avatar-adv-major-tab-btn" data-major-tab="settings" title="弹窗设置">
                        <i class="fa-solid fa-gear"></i>
                    </button>
                </div>
                <!-- 右侧功能按钮 -->
                <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                    <button class="avatar-adv-toggle-preview-btn" style="background: none; border: none; color: inherit; font-size: 15px; cursor: pointer; opacity: 0.7; transition: opacity 0.2s; display: inline-flex; align-items: center;" title="显示/隐藏预览"><i class="fa-solid fa-eye"></i></button>
                    <button class="avatar-adv-close-btn" style="background: none; border: none; color: inherit; font-size: 16px; cursor: pointer; opacity: 0.7; transition: opacity 0.2s; display: inline-flex; align-items: center;" title="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <!-- 共享预览区域 -->
            <div class="avatar-adv-preview-container" style="margin: 10px 14px 0 14px;">
                <div class="avatar-adv-preview-wrapper" id="shared-preview-wrapper">
                    <img class="avatar-adv-preview-img" id="shared-preview-img" src="${src}">
                    <div id="shared-frame-preview"></div>
                </div>
            </div>

            <div class="avatar-adv-tabs-bar">
                ${tabButtonsHtml}
            </div>
            
            <div class="avatar-adv-content">
                <!-- 调整与裁剪选项卡 -->
                <div class="avatar-adv-tab-content active" id="tab-adjust">
                    <div class="avatar-adv-form-row" style="margin-bottom: 2px; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 8px;">
                        <div style="display:inline-flex; flex-direction:column; gap:6px;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12px;">
                                <input type="checkbox" id="chk-disable-zoom"> 禁用点击头像放大
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12px;">
                                <input type="checkbox" id="chk-enable-hd"> 启用头像高清渲染
                            </label>
                        </div>
                        <div style="display:inline-flex; align-items:center; gap:6px; align-self: flex-start;">
                            <label style="font-size: 11px; opacity: 0.8; white-space: nowrap;">呼出触发:</label>
                            <select id="sel-trigger-method" class="text_pole" style="height:26px; font-size:11px; padding:0 4px; margin:0; width:110px;">
                                <option value="all">双击 与 长按</option>
                                <option value="dblclick">仅限 双击头像</option>
                                <option value="longpress">仅限 长按头像</option>
                            </select>
                        </div>
                    </div>

                    <div class="avatar-adv-control-group">
                        <div class="avatar-adv-control-row">
                            <label>缩放比例</label>
                            <input type="range" id="adj-zoom" min="1" max="10" step="0.05" value="1">
                            <span id="lbl-zoom">1.0x</span>
                        </div>
                        <div class="avatar-adv-control-row">
                            <label>水平偏移</label>
                            <input type="range" id="adj-x" min="-200" max="200" step="1" value="0">
                            <span id="lbl-x">0%</span>
                        </div>
                        <div class="avatar-adv-control-row">
                            <label>垂直偏移</label>
                            <input type="range" id="adj-y" min="-200" max="200" step="1" value="0">
                            <span id="lbl-y">0%</span>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:row; gap:10px; margin-top:5px; flex-wrap:nowrap;">
                        <button class="menu_button" id="btn-start-crop" style="flex:1; justify-content:center;" title="自由裁剪"><i class="fa-solid fa-crop-simple"></i></button>
                        <button class="menu_button" id="btn-reset-adj" style="width:50px; justify-content:center;" title="重置"><i class="fa-solid fa-rotate-left"></i></button>
                    </div>
                    <div id="crop-section" style="display:none; flex-direction:column; gap:10px; margin-top:5px;">
                        <div class="cropper-container-wrapper">
                            <img id="cropper-img" src="${src}" style="max-width:100%; display:block;">
                        </div>
                        <div style="display:flex; flex-direction:row; gap:6px; flex-wrap:nowrap;">
                            <button class="menu_button" id="btn-save-crop" style="flex:1; justify-content:center; background-color:var(--SmartThemeQuoteColor); font-size:11px; padding:6px 0;" title="裁剪物理文件，直接修改和保存头像文件"><i class="fa-solid fa-file-image"></i> 覆盖原图</button>
                            <button class="menu_button" id="btn-save-visual-crop" style="flex:1; justify-content:center; background-color:var(--SmartThemeBlurTintColor, rgba(30,30,30,0.8)); font-size:11px; padding:6px 0;" title="仅保存为视觉偏移，不修改原图文件，对图库图片也有效"><i class="fa-solid fa-eye"></i> 视觉裁剪</button>
                            <button class="menu_button" id="btn-cancel-crop" style="width:40px; justify-content:center;" title="取消"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                </div>

                <!-- 头像框选项卡 -->
                <div class="avatar-adv-tab-content" id="tab-frame">
                    <div style="display:flex; flex-direction:row; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:5px;">
                        <div style="display:flex; flex-direction:row; gap:4px;">
                            <button class="avatar-adv-tab-btn active" style="padding:4px;" id="btn-subtab-apply" title="应用调整"><i class="fa-solid fa-sliders"></i></button>
                            <button class="avatar-adv-tab-btn" style="padding:4px;" id="btn-subtab-store" title="储存与批量导入"><i class="fa-solid fa-folder-plus"></i></button>
                        </div>
                        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; margin:0 5px 0 0;">
                            <input type="checkbox" id="chk-enable-avatar-frame" style="margin:0; width:14px; height:14px; cursor:pointer;"> 启用头像框
                        </label>
                    </div>
                    
                    <!-- 头像框应用子页 -->
                    <div id="subtab-apply-content" style="display:flex; flex-direction:column; gap:10px; flex:1;">
                        <!-- 动态载入当前选中项的控制器 -->
                        <div id="active-frame-adjust-panel" style="display:flex; flex-direction:column; gap:10px; flex:1;"></div>
                    </div>

                    <!-- 头像框储存子页 -->
                    <div id="subtab-store-content" style="display:none; flex-direction:column; gap:10px; flex:1;">
                        <div class="avatar-adv-form-row">
                            <input type="text" id="input-frame-url" class="text_pole" placeholder="图片 URL 地址" style="flex:1; min-width:0;">
                            <input type="text" id="input-frame-name" class="text_pole" placeholder="名称" style="width:100px; flex-shrink:0;">
                            <button class="menu_button" id="btn-import-frame-url" style="margin:0; width:40px; flex-shrink:0;" title="添加单URL"><i class="fa-solid fa-plus"></i></button>
                        </div>
                        
                        <!-- 批量导入折叠框：默认折叠状态 -->
                        <div class="theme-group-header" id="btn-toggle-batch-import" style="margin-top: 4px;">
                            <span><i class="fa-solid fa-chevron-right" style="margin-right:6px; font-size:10px;"></i> 批量导入 (URLs / 本地图片)</span>
                        </div>
                        <div id="batch-import-collapsible" style="display:none; flex-direction:column; gap:6px; padding:8px; border:1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08)); border-radius:6px; margin-top:2px;">
                            <textarea id="textarea-frame-batch-urls" class="text_pole" placeholder="粘贴多行图片 URL (一行一个)" style="height:50px; font-size:11px; resize:none; box-sizing:border-box;"></textarea>
                            <div style="display:flex; flex-direction:row; gap:8px; align-items:center; margin-top:3px; flex-wrap:nowrap;">
                                <button class="menu_button" id="btn-batch-import-urls" style="margin:0; flex:1; justify-content:center;" title="批量导入 URLs"><i class="fa-solid fa-link"></i></button>
                                <input type="file" id="input-batch-frame-files" accept="image/*" multiple style="display:none;">
                                <button class="menu_button" id="btn-batch-select-files" style="margin:0; flex:1; justify-content:center;" title="批量选择本地图片"><i class="fa-solid fa-folder-open"></i></button>
                            </div>
                        </div>

                        <div style="flex:1; overflow-y:auto; min-height:100px; border:1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08)); border-radius:8px; padding:8px;" id="custom-frames-manage">
                            <!-- 管理自定义框 -->
                        </div>
                    </div>
                </div>

                <!-- 图库选项卡 -->
                <div class="avatar-adv-tab-content" id="tab-gallery">
                    ${galleryHeaderHtml}
                    <div style="display:flex; flex-direction:column; gap:6px; border:1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08)); padding:10px; border-radius:8px; flex-shrink:0;">
                        <!-- 三个功能图标强制一行排列，不折行 -->
                        <div style="display:flex; flex-direction:row; gap:5px; flex-wrap:nowrap; width:100%; align-items:center;">
                            <input type="text" id="input-gallery-url" class="text_pole" placeholder="输入外部替换图片 URL" style="flex:1; min-width:0; margin:0; height:32px; font-size:12px;">
                            <button class="menu_button" id="btn-apply-gallery-url" style="margin:0; width:36px; height:32px; flex-shrink:0; justify-content:center;" title="使用 URL"><i class="fa-solid fa-link"></i></button>
                            <input type="file" id="input-gallery-file" accept="image/*" style="display:none;">
                            <button class="menu_button" id="btn-upload-gallery-file" style="margin:0; width:36px; height:32px; flex-shrink:0; justify-content:center;" title="上传本地图片"><i class="fa-solid fa-upload"></i></button>
                            <button class="menu_button" id="btn-clear-gallery-override" style="margin:0; background:rgba(220,53,69,0.25); width:36px; height:32px; flex-shrink:0; justify-content:center;" title="清除覆盖/恢复原貌"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                    <div class="gallery-grid" id="gallery-list" style="flex:1;">
                        <!-- 动态载入候选图库 -->
                    </div>
                </div>

                <!-- 美化绑定选项卡 -->
                <div class="avatar-adv-tab-content" id="tab-bind">
                    <div class="theme-binder-container" style="display:flex; flex-direction:column; gap:8px; height:100%;">
                        <div style="display:flex; flex-direction:row; gap:5px; width:100%; align-items:center; flex-wrap:nowrap;">
                            <!-- 使用 fontawesome 的放大镜作为图标在输入框左侧 -->
                            <div style="position:relative; flex:1; display:flex; flex-direction:row;">
                                <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); opacity:0.5; pointer-events:none;"></i>
                                <input type="text" id="bind-search-input" class="text_pole" placeholder="搜索主题或标签..." style="flex:1; padding-left:28px; box-sizing:border-box; margin:0; height:32px; font-size:12px;">
                            </div>
                            <button class="menu_button" id="btn-save-theme-binding" style="margin:0; background-color:var(--SmartThemeQuoteColor); width:45px; height:32px; flex-shrink:0; justify-content:center;" title="保存美化绑定"><i class="fa-solid fa-floppy-disk"></i></button>
                        </div>
                        <div style="display:flex; align-items:center; margin: 0 4px; flex-shrink:0;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:11px; opacity:0.8;">
                                <input type="checkbox" id="chk-apply-on-bind" checked> 绑定时立即切换主题
                            </label>
                        </div>
                        <div id="bind-themes-list" style="flex:1; overflow-y:auto; border:1px solid var(--SmartThemeBorderColor, rgba(0,0,0,0.08)); border-radius:6px; padding:5px;">
                            <!-- 动态渲染按标签折叠的列表 -->
                        </div>
                    </div>
                </div>
            </div>

                <!-- 弹窗设置选项卡 -->
                <div class="avatar-adv-tab-content avatar-adv-settings-panel" id="major-tab-settings" style="display:none; flex-direction:column; gap:16px; padding:16px; overflow-y:auto; flex:1;">
                    <div style="font-size:12px; opacity:0.6; margin-bottom:4px;">弹窗配色方案</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <label class="avatar-scheme-option" data-scheme="default" style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:10px 14px; border-radius:8px; border:2px solid transparent; transition:all 0.2s;">
                            <input type="radio" name="avatar-color-scheme" value="default" style="margin:0;">
                            <span style="display:flex; flex-direction:column; gap:2px;">
                                <span style="font-size:13px; font-weight:500;">跟随酒馆主题</span>
                                <span style="font-size:11px; opacity:0.55;">使用酒馆全局背景色，保持默认外观</span>
                            </span>
                            <span style="margin-left:auto; display:flex; gap:5px;">
                                <span style="width:16px; height:16px; border-radius:50%; background:var(--SmartThemeBlurTintColor, #2a2a2a); border:1px solid rgba(255,255,255,0.15); display:inline-block;"></span>
                            </span>
                        </label>
                        <label class="avatar-scheme-option" data-scheme="morandi-beige" style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:10px 14px; border-radius:8px; border:2px solid transparent; transition:all 0.2s;">
                            <input type="radio" name="avatar-color-scheme" value="morandi-beige" style="margin:0;">
                            <span style="display:flex; flex-direction:column; gap:2px;">
                                <span style="font-size:13px; font-weight:500;">莫兰迪日间米色</span>
                                <span style="font-size:11px; opacity:0.55;">低饱和暖米色调，柔和淡雅的日间风格</span>
                            </span>
                            <span style="margin-left:auto; display:flex; gap:5px;">
                                <span style="width:16px; height:16px; border-radius:50%; background:#c8baa8; border:1px solid rgba(0,0,0,0.1); display:inline-block;"></span>
                                <span style="width:16px; height:16px; border-radius:50%; background:#e8e0d4; border:1px solid rgba(0,0,0,0.1); display:inline-block;"></span>
                            </span>
                        </label>
                        <label class="avatar-scheme-option" data-scheme="morandi-dark" style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:10px 14px; border-radius:8px; border:2px solid transparent; transition:all 0.2s;">
                            <input type="radio" name="avatar-color-scheme" value="morandi-dark" style="margin:0;">
                            <span style="display:flex; flex-direction:column; gap:2px;">
                                <span style="font-size:13px; font-weight:500;">莫兰迪夜间深灰</span>
                                <span style="font-size:11px; opacity:0.55;">低饱和深灰蓝调，沉稳内敛的夜间风格</span>
                            </span>
                            <span style="margin-left:auto; display:flex; gap:5px;">
                                <span style="width:16px; height:16px; border-radius:50%; background:#3d4147; border:1px solid rgba(255,255,255,0.08); display:inline-block;"></span>
                                <span style="width:16px; height:16px; border-radius:50%; background:#52565c; border:1px solid rgba(255,255,255,0.08); display:inline-block;"></span>
                            </span>
                        </label>
                    </div>
                </div>

            </div>
            <div class="avatar-adv-resizer"></div>
        `;

        // 统一作为 fixed 层挂载到最顶层 document.body
        document.body.appendChild(panel);

        // 应用已保存的配色方案
        const savedScheme = localStorage.getItem('themeManager_avatarPanelScheme') || 'default';
        applyPanelColorScheme(panel, savedScheme);

        // 统一应用图库视觉替换保存
        function applyOverride(url) {
            const current = getAdjustment(type, file);
            current.overrideUrl = url;
            saveAdjustment(type, file, current);
            
            updatePanelLivePreview(current);
            renderGalleryGrid();
            toastr.success('头像视觉覆盖应用成功！');
        }

        // 实时更新头部共享预览区的图像微调效果与头像框样式
        function updatePanelLivePreview(currentAdj) {
            const img = document.getElementById('shared-preview-img');
            const frameOverlay = document.getElementById('shared-frame-preview');

            if (!img) return;

            // 1. 应用图像偏移与放大
            const zoom = currentAdj.zoom || 1;
            const x = currentAdj.x || 0;
            const y = currentAdj.y || 0;
            img.style.transform = `scale(${zoom}) translate(${x}%, ${y}%)`;
            img.style.transformOrigin = 'center center';

            // 2. 应用视觉覆盖头像源
            img.src = resolveImageUrl(currentAdj.overrideUrl) || originalAvatarUrl;

            // 3. 渲染头像框
            const isFrameEnabled = localStorage.getItem('themeManager_enableAvatarFrame') === 'true';
            if (isFrameEnabled && currentAdj.frame && currentAdj.frame !== 'none') {
                let customFrames = [];
                try {
                    customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
                } catch (e) {}
                
                const frameObj = customFrames.find(f => f.id === currentAdj.frame);
                if (frameObj && frameOverlay) {
                    const size = currentAdj.frameSize !== undefined ? currentAdj.frameSize : 2;
                    const opacity = currentAdj.frameOpacity !== undefined ? currentAdj.frameOpacity : 1;
                    const fx = currentAdj.frameX !== undefined ? currentAdj.frameX : 0;
                    const fy = currentAdj.frameY !== undefined ? currentAdj.frameY : 0;
                    const fs = currentAdj.frameScale !== undefined ? currentAdj.frameScale : 1;

                    frameOverlay.style.display = 'block';
                    frameOverlay.style.background = `url("${frameObj.url}") no-repeat center/contain`;
                    frameOverlay.style.opacity = opacity;
                    
                    frameOverlay.style.width = `calc(100% + ${size * 2}px)`;
                    frameOverlay.style.height = `calc(100% + ${size * 2}px)`;
                    frameOverlay.style.top = '50%';
                    frameOverlay.style.left = '50%';
                    frameOverlay.style.transform = `translate(-50%, -50%) scale(${fs}) translate(${fx}px, ${fy}px)`;
                    frameOverlay.style.transformOrigin = 'center center';
                } else if (frameOverlay) {
                    frameOverlay.style.display = 'none';
                }
            } else if (frameOverlay) {
                frameOverlay.style.display = 'none';
            }
        }

        // 渲染“应用调整”界面：只显示选定的那一个头像框极其细节调整滑动条
        function renderActiveFramePanel() {
            const container = panel.querySelector('#active-frame-adjust-panel');
            if (!container) return;
            container.innerHTML = '';

            const current = getAdjustment(type, file);
            if (!current.frame || current.frame === 'none') {
                container.innerHTML = `
                    <div style="text-align:center; font-size:12px; opacity:0.6; padding:40px 20px; display:flex; flex-direction:column; align-items:center; gap:10px;">
                        <i class="fa-solid fa-border-none" style="font-size:24px; opacity:0.5;"></i>
                        <span>当前未激活头像框。请前往 [储存与批量导入] 子页面导入或点击选择一个头像框进行绑定。</span>
                    </div>
                `;
                return;
            }

            let customFrames = [];
            try {
                customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
            } catch (e) {}
            
            const frameObj = customFrames.find(f => f.id === current.frame);

            if (!frameObj) {
                // 如果发现关联的数据项已不存在，静默切回无头像框，防范递归死锁造成卡死
                current.frame = 'none';
                saveAdjustment(type, file, current);
                container.innerHTML = `
                    <div style="text-align:center; font-size:12px; opacity:0.6; padding:40px 20px; display:flex; flex-direction:column; align-items:center; gap:10px;">
                        <i class="fa-solid fa-border-none" style="font-size:24px; opacity:0.5;"></i>
                        <span>当前未激活头像框。请前往 [储存与批量导入] 子页面导入或点击选择一个头像框进行绑定。</span>
                    </div>
                `;
                return;
            }

            // 初始化滑块参数默认值
            const fSize = current.frameSize !== undefined ? current.frameSize : 2;
            const fOpacity = current.frameOpacity !== undefined ? current.frameOpacity : 1;
            const fX = current.frameX !== undefined ? current.frameX : 0;
            const fY = current.frameY !== undefined ? current.frameY : 0;
            const fScale = current.frameScale !== undefined ? current.frameScale : 1;

            container.innerHTML = `
                <div style="display:flex; flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.06); padding:8px 12px; border-radius:6px; flex-wrap:nowrap;">
                    <div style="display:flex; flex-direction:row; align-items:center; gap:8px; flex-wrap:nowrap;">
                        <div style="width:30px; height:30px; border-radius:var(--avatar-base-border-radius-round, 50%); background: url('${frameObj.url}') no-repeat center/contain; flex-shrink:0;"></div>
                        <span style="font-size:12px; font-weight:600;">已激活: ${escapeHtml(frameObj.name)}</span>
                    </div>
                    <button id="btn-remove-active-frame" class="menu_button" style="margin:0; background:rgba(220,53,69,0.2); width:36px; height:32px; justify-content:center; flex-shrink:0;" title="清除绑定"><i class="fa-solid fa-ban"></i></button>
                </div>

                <div class="avatar-adv-control-group" style="margin-top:5px;">
                    <div class="avatar-adv-control-row">
                        <label>框体延伸</label>
                        <input type="range" id="frame-size" min="-20" max="20" step="1" value="${fSize}">
                        <span id="lbl-frame-size">${fSize}px</span>
                    </div>
                    <div class="avatar-adv-control-row">
                        <label>不透明度</label>
                        <input type="range" id="frame-opacity" min="0" max="1" step="0.05" value="${fOpacity}">
                        <span id="lbl-frame-opacity">${fOpacity}</span>
                    </div>
                    <div class="avatar-adv-control-row">
                        <label>水平偏移</label>
                        <input type="range" id="frame-x" min="-50" max="50" step="1" value="${fX}">
                        <span id="lbl-frame-x">${fX}px</span>
                    </div>
                    <div class="avatar-adv-control-row">
                        <label>垂直偏移</label>
                        <input type="range" id="frame-y" min="-50" max="50" step="1" value="${fY}">
                        <span id="lbl-frame-y">${fY}px</span>
                    </div>
                    <div class="avatar-adv-control-row">
                        <label>缩放比例</label>
                        <input type="range" id="frame-scale" min="0.5" max="2.0" step="0.05" value="${fScale}">
                        <span id="lbl-frame-scale">${Number(fScale).toFixed(2)}x</span>
                    </div>
                </div>
            `;

            // 绑定事件和实时共享更新
            const updateFrameLive = () => {
                const size = parseInt(panel.querySelector('#frame-size').value);
                const opacity = parseFloat(panel.querySelector('#frame-opacity').value);
                const fx = parseInt(panel.querySelector('#frame-x').value);
                const fy = parseInt(panel.querySelector('#frame-y').value);
                const fs = parseFloat(panel.querySelector('#frame-scale').value);

                panel.querySelector('#lbl-frame-size').textContent = `${size}px`;
                panel.querySelector('#lbl-frame-opacity').textContent = opacity;
                panel.querySelector('#lbl-frame-x').textContent = `${fx}px`;
                panel.querySelector('#lbl-frame-y').textContent = `${fy}px`;
                panel.querySelector('#lbl-frame-scale').textContent = `${fs.toFixed(2)}x`;

                const activeGeom = getAdjustment(type, file);
                activeGeom.frameSize = size;
                activeGeom.frameOpacity = opacity;
                activeGeom.frameX = fx;
                activeGeom.frameY = fy;
                activeGeom.frameScale = fs;

                updatePanelLivePreview(activeGeom);
                saveAdjustment(type, file, activeGeom);
            };

            const inputs = ['#frame-size', '#frame-opacity', '#frame-x', '#frame-y', '#frame-scale'];
            inputs.forEach(sel => {
                const el = container.querySelector(sel);
                if (el) {
                    el.addEventListener('input', updateFrameLive);
                    el.addEventListener('change', updateFrameLive);
                }
            });

            // 取消选择按钮
            container.querySelector('#btn-remove-active-frame').addEventListener('click', () => {
                const currentVal = getAdjustment(type, file);
                currentVal.frame = 'none';
                saveAdjustment(type, file, currentVal);
                updatePanelLivePreview(currentVal);
                renderActiveFramePanel();
            });
        }

        // 渲染储存与添加列表：以卡片预览形式展现导入的头像框画廊
        function renderCustomFramesManage() {
            const container = panel.querySelector('#custom-frames-manage');
            if (!container) return;
            container.innerHTML = '';

            let customFrames = [];
            try {
                customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
            } catch (e) {}
            
            if (customFrames.length === 0) {
                container.innerHTML = '<div style="text-align:center; font-size:11px; opacity:0.5; padding:20px;">暂无自定义头像框，请在上方导入。</div>';
                return;
            }

            const grid = document.createElement('div');
            grid.className = 'frame-list-grid';

            customFrames.forEach(frame => {
                const card = document.createElement('div');
                const current = getAdjustment(type, file);
                card.className = `frame-item-card${current.frame === frame.id ? ' active' : ''}`;
                
                card.innerHTML = `
                    <div class="frame-item-card-preview">
                        <!-- 利用 JS 动态赋值背景图以规避 CSS HTML 实体解析 base64 造成的预览丢失 Bug -->
                        <div class="frame-card-preview-layer" style="position:absolute; top:-2px; left:-2px; right:-2px; bottom:-2px; border-radius:var(--avatar-base-border-radius-round, 50%); z-index:3;"></div>
                        <div style="width:100%; height:100%; border-radius:var(--avatar-base-border-radius-round, 50%); background:#444; display:flex; align-items:center; justify-content:center; font-size:18px; color:rgba(255,255,255,0.25); z-index:1;"><i class="fa-solid fa-user"></i></div>
                    </div>
                    <span class="frame-item-card-text">${escapeHtml(frame.name)}</span>
                    <button class="menu_button delete-custom-frame-btn" data-id="${frame.id}" style="margin:0; padding:2px 6px; font-size:10px; width:auto; height:auto; background:rgba(220,53,69,0.15); color:#ff8888;" title="删除"><i class="fa-solid fa-trash"></i></button>
                `;

                // 用 JS 赋值背景，确保 100% 预览生效
                const previewLayer = card.querySelector('.frame-card-preview-layer');
                if (previewLayer) {
                    previewLayer.style.backgroundImage = `url(${JSON.stringify(frame.url)})`;
                    previewLayer.style.backgroundRepeat = 'no-repeat';
                    previewLayer.style.backgroundPosition = 'center';
                    previewLayer.style.backgroundSize = 'contain';
                }

                card.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-custom-frame-btn')) return;
                    
                    const currentVal = getAdjustment(type, file);
                    currentVal.frame = frame.id;
                    saveAdjustment(type, file, currentVal);
                    updatePanelLivePreview(currentVal);

                    grid.querySelectorAll('.frame-item-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    toastr.success(`已应用头像框 "${frame.name}"`);
                });

                card.querySelector('.delete-custom-frame-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要删除头像框 "${frame.name}" 吗？`)) {
                        let updated = customFrames.filter(f => f.id !== frame.id);
                        localStorage.setItem(FRAMES_KEY, JSON.stringify(updated));
                        toastr.info('头像框已删除');
                        
                        const currentVal = getAdjustment(type, file);
                        if (currentVal.frame === frame.id) {
                            currentVal.frame = 'none';
                            saveAdjustment(type, file, currentVal);
                            updatePanelLivePreview(currentVal);
                        }

                        renderCustomFramesManage();
                    }
                });

                grid.appendChild(card);
            });

            container.appendChild(grid);
        }

        // 渲染候选图库 (支持全局图库 vs 角色专有图库)
        function renderGalleryGrid() {
            const galleryGrid = panel.querySelector('#gallery-list');
            if (!galleryGrid) return;
            galleryGrid.innerHTML = '';

            const current = getAdjustment(type, file);

            // 原始头像项 (使用缓存原生头像源，防范空引用崩溃)
            const origItem = document.createElement('div');
            origItem.className = `gallery-item${!current.overrideUrl || current.overrideUrl === '' ? ' active' : ''}`;
            origItem.innerHTML = `<img src="${originalAvatarUrl}" alt="原始头像" title="原始头像">`;
            origItem.addEventListener('click', () => {
                applyOverride('');
                panel.querySelector('#input-gallery-url').value = '';
            });
            galleryGrid.appendChild(origItem);

            // 获取数据源列表
            let dataSourceList = [];

            if (type === 'char') {
                // 角色卡专属私有图库
                dataSourceList = current.gallery || [];
            } else {
                // 用户头像：区分为“全局图库”与“角色图库”
                if (gallerySubtab === 'global') {
                    try {
                        dataSourceList = JSON.parse(localStorage.getItem('themeManager_globalUserGallery')) || [];
                    } catch (e) {}
                } else {
                    const charUserAdj = getAdjustment(type, file); // 永远读取该角色下的用户专属数据配置
                    dataSourceList = charUserAdj.gallery || [];
                }
            }

            dataSourceList.forEach(itemData => {
                const item = document.createElement('div');
                item.className = `gallery-item${current.overrideUrl === itemData.url ? ' active' : ''}`;
                item.innerHTML = `
                    <img src="${resolveImageUrl(itemData.url)}" alt="${itemData.name}" title="${itemData.name}">
                    <button class="gallery-item-delete" title="从图库中移除"><i class="fa-solid fa-trash"></i></button>
                `;

                // 切换选择
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.gallery-item-delete')) return;
                    applyOverride(itemData.url);
                    panel.querySelector('#input-gallery-url').value = (itemData.url.startsWith('data:') || itemData.url.startsWith('db://')) ? '' : itemData.url;
                });

                // 从图库删除项
                item.querySelector('.gallery-item-delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要将图片从当前图库中移除吗？`)) {
                        // 清除 IndexedDB 存储资源
                        if (itemData.url && itemData.url.startsWith('db://')) {
                            const id = itemData.url.substring(5);
                            deleteImageBlob(id).catch(err => console.error('[Theme Manager DB] Delete blob failed:', err));
                            if (galleryBlobUrlCache[id]) {
                                URL.revokeObjectURL(galleryBlobUrlCache[id]);
                                delete galleryBlobUrlCache[id];
                            }
                        }

                        if (type === 'char') {
                            const currentVal = getAdjustment(type, file);
                            currentVal.gallery = (currentVal.gallery || []).filter(img => img.id !== itemData.id);
                            if (currentVal.overrideUrl === itemData.url) {
                                currentVal.overrideUrl = '';
                                panel.querySelector('#input-gallery-url').value = '';
                            }
                            saveAdjustment(type, file, currentVal);
                        } else {
                            if (gallerySubtab === 'global') {
                                let globalGallery = [];
                                try {
                                    globalGallery = JSON.parse(localStorage.getItem('themeManager_globalUserGallery')) || [];
                                } catch (e) {}
                                globalGallery = globalGallery.filter(img => img.id !== itemData.id);
                                localStorage.setItem('themeManager_globalUserGallery', JSON.stringify(globalGallery));
                            } else {
                                const currentVal = getAdjustment(type, file);
                                currentVal.gallery = (currentVal.gallery || []).filter(img => img.id !== itemData.id);
                                saveAdjustment(type, file, currentVal);
                            }
                            
                            // 如果当前选中的就是被删除的图片，清除激活态并清空 overrideUrl
                            const currentVal = getAdjustment(type, file);
                            if (currentVal.overrideUrl === itemData.url) {
                                currentVal.overrideUrl = '';
                                panel.querySelector('#input-gallery-url').value = '';
                                saveAdjustment(type, file, currentVal);
                            }
                        }

                        updatePanelLivePreview(getAdjustment(type, file));
                        renderGalleryGrid();
                        toastr.info('已从图库中移除');
                    }
                });

                galleryGrid.appendChild(item);
            });
        }

        // 绑定各 Tab 页面逻辑与基础控制事件 (关闭/拖拽/缩放/选项卡)
        try {
            bindAdjustTab(panel, type, file);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding adjust tab:', e);
        }

        try {
            bindFrameTab(panel, type, file);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding frame tab:', e);
        }

        try {
            bindGalleryTab(panel, type, file);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding gallery tab:', e);
        }

        if (type === 'char') {
            try {
                bindThemeBindingTab(panel, file);
            } catch (e) {
                console.error('[Theme Manager Avatar] Error binding theme binding tab:', e);
            }
        }

        // 绑定关闭/拖动/拉伸缩放/选项卡切换事件，保障基本交互可用
        try {
            const closeBtn = panel.querySelector('.avatar-adv-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', closePanel);
            }
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding close button:', e);
        }

        try {
            const togglePreviewBtn = panel.querySelector('.avatar-adv-toggle-preview-btn');
            if (togglePreviewBtn) {
                // 初始化眼睛图标
                togglePreviewBtn.querySelector('i').className = isPreviewVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
                
                togglePreviewBtn.addEventListener('click', () => {
                    isPreviewVisible = !isPreviewVisible;
                    localStorage.setItem(PREVIEW_VISIBLE_KEY, isPreviewVisible ? 'true' : 'false');
                    
                    // 更新图标
                    togglePreviewBtn.querySelector('i').className = isPreviewVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
                    
                    // 重新调整显示状态
                    adjustPreviewVisibility(panel);
                });
            }
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding toggle preview button:', e);
        }

        try {
            bindDrag(panel);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding drag events:', e);
        }

        try {
            bindResize(panel);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding resize events:', e);
        }

        try {
            bindTabs(panel);
        } catch (e) {
            console.error('[Theme Manager Avatar] Error binding tab switcher events:', e);
        }

        // 绑定大选项卡切换事件
        panel.querySelectorAll('.avatar-adv-major-tab-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const targetType = this.dataset.majorTab;

                // 设置 Tab 特殊处理：不重新打开面板，只显示设置区域
                if (targetType === 'settings') {
                    // 高亮 settings tab，取消其他 major tab 高亮
                    panel.querySelectorAll('.avatar-adv-major-tab-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');

                    // 隐藏主内容区，显示设置面板
                    const mainContent = panel.querySelector('.avatar-adv-content');
                    const previewContainer = panel.querySelector('.avatar-adv-preview-container');
                    const tabsBar = panel.querySelector('.avatar-adv-tabs-bar');
                    const settingsPanel = panel.querySelector('#major-tab-settings');

                    if (mainContent) mainContent.style.display = 'none';
                    if (previewContainer) previewContainer.style.display = 'none';
                    if (tabsBar) tabsBar.style.display = 'none';
                    if (settingsPanel) settingsPanel.style.display = 'flex';

                    // 初始化配色方案单选按钮状态
                    const currentScheme = localStorage.getItem('themeManager_avatarPanelScheme') || 'default';
                    const radio = settingsPanel.querySelector(`input[value="${currentScheme}"]`);
                    if (radio) radio.checked = true;

                    // 更新选项高亮
                    settingsPanel.querySelectorAll('.avatar-scheme-option').forEach(opt => {
                        const isSelected = opt.dataset.scheme === currentScheme;
                        opt.style.border = isSelected ? '2px solid var(--SmartThemeQuoteColor, rgba(90,140,180,0.7))' : '2px solid transparent';
                        opt.style.background = isSelected ? 'rgba(255,255,255,0.06)' : '';
                    });

                    // 绑定配色方案切换事件（仅绑定一次）
                    if (!settingsPanel.dataset.bound) {
                        settingsPanel.dataset.bound = '1';
                        settingsPanel.querySelectorAll('input[name="avatar-color-scheme"]').forEach(radio => {
                            radio.addEventListener('change', () => {
                                const scheme = radio.value;
                                localStorage.setItem('themeManager_avatarPanelScheme', scheme);
                                applyPanelColorScheme(panel, scheme);

                                // 更新选项高亮
                                settingsPanel.querySelectorAll('.avatar-scheme-option').forEach(opt => {
                                    const isSelected = opt.dataset.scheme === scheme;
                                    opt.style.border = isSelected ? '2px solid var(--SmartThemeQuoteColor, rgba(90,140,180,0.7))' : '2px solid transparent';
                                    opt.style.background = isSelected ? 'rgba(255,255,255,0.06)' : '';
                                });
                            });
                        });
                    }
                    return;
                }

                // char / user Tab：若当前已显示同类型则不操作，否则重新打开面板
                if (targetType === currentTargetType) {
                    // 若当前处于 settings tab 状态，则切回主内容
                    const mainContent = panel.querySelector('.avatar-adv-content');
                    const previewContainer = panel.querySelector('.avatar-adv-preview-container');
                    const tabsBar = panel.querySelector('.avatar-adv-tabs-bar');
                    const settingsPanel = panel.querySelector('#major-tab-settings');
                    if (settingsPanel && settingsPanel.style.display !== 'none') {
                        if (mainContent) mainContent.style.display = '';
                        if (previewContainer) previewContainer.style.display = '';
                        if (tabsBar) tabsBar.style.display = '';
                        settingsPanel.style.display = 'none';
                        panel.querySelectorAll('.avatar-adv-major-tab-btn').forEach(b => b.classList.remove('active'));
                        this.classList.add('active');
                    }
                    return;
                }

                // 销毁裁剪器实例，防止内存泄漏或渲染残留
                if (cropperInstance) {
                    try { cropperInstance.destroy(); } catch(e) {}
                    cropperInstance = null;
                }

                // 获取目标类型的头像信息并重新打开面板（无缝复用 openPanel）
                const info = getActiveAvatarInfo(targetType);
                openPanel(targetType, info.file, info.src);
            });
        });

        // 根据当前打开的状态动态设置常驻预览区域显示或隐藏
        adjustPreviewVisibility(panel);

        // 首次打开面板时，立即应用并渲染正确的图像视觉覆盖与样式参数
        updatePanelLivePreview(adj);

        // 选项卡1：头像调整与自由裁剪
        function bindAdjustTab(tabPanel, targetType, targetFile) {
            const zoomInput = tabPanel.querySelector('#adj-zoom');
            const xInput = tabPanel.querySelector('#adj-x');
            const yInput = tabPanel.querySelector('#adj-y');

            const zoomLbl = tabPanel.querySelector('#lbl-zoom');
            const xLbl = tabPanel.querySelector('#lbl-x');
            const yLbl = tabPanel.querySelector('#lbl-y');

            const chkDisableZoom = tabPanel.querySelector('#chk-disable-zoom');

            // 载入初始状态
            const currentAdj = getAdjustment(targetType, targetFile);
            zoomInput.value = currentAdj.zoom || 1;
            xInput.value = currentAdj.x || 0;
            yInput.value = currentAdj.y || 0;

            chkDisableZoom.checked = isZoomDisabled;
            chkDisableZoom.addEventListener('change', (e) => {
                isZoomDisabled = e.target.checked;
                localStorage.setItem(DISABLE_ZOOM_KEY, isZoomDisabled ? 'true' : 'false');
            });

            const chkEnableHd = tabPanel.querySelector('#chk-enable-hd');
            if (chkEnableHd) {
                chkEnableHd.checked = isHdEnabled;
                chkEnableHd.addEventListener('change', (e) => {
                    isHdEnabled = e.target.checked;
                    localStorage.setItem('themeManager_enableAvatarHD', isHdEnabled ? 'true' : 'false');
                    document.body.classList.toggle('tm-avatar-hd-rendering', isHdEnabled);
                });
            }

            const selTriggerMethod = tabPanel.querySelector('#sel-trigger-method');
            if (selTriggerMethod) {
                selTriggerMethod.value = avatarTriggerMethod;
                selTriggerMethod.addEventListener('change', (e) => {
                    avatarTriggerMethod = e.target.value;
                    localStorage.setItem('themeManager_avatarTriggerMethod', avatarTriggerMethod);
                });
            }

            const updatePreview = () => {
                const zoom = zoomInput.value;
                const x = xInput.value;
                const y = yInput.value;

                zoomLbl.textContent = `${Number(zoom).toFixed(2)}x`;
                xLbl.textContent = `${x}%`;
                yLbl.textContent = `${y}%`;

                const currentVal = getAdjustment(targetType, targetFile);
                currentVal.zoom = parseFloat(zoom);
                currentVal.x = parseInt(x);
                currentVal.y = parseInt(y);
                updatePanelLivePreview(currentVal);
            };

            const saveChanges = () => {
                const currentVal = getAdjustment(targetType, targetFile);
                currentVal.zoom = parseFloat(zoomInput.value);
                currentVal.x = parseInt(xInput.value);
                currentVal.y = parseInt(yInput.value);
                saveAdjustment(targetType, targetFile, currentVal);
            };

            [zoomInput, xInput, yInput].forEach(inp => {
                inp.addEventListener('input', updatePreview);
                inp.addEventListener('change', saveChanges);
            });

            // 重置按钮
            tabPanel.querySelector('#btn-reset-adj').addEventListener('click', () => {
                zoomInput.value = 1;
                xInput.value = 0;
                yInput.value = 0;
                updatePreview();
                saveChanges();
            });

            // 裁剪逻辑
            const startCropBtn = tabPanel.querySelector('#btn-start-crop');
            const saveCropBtn = tabPanel.querySelector('#btn-save-crop');
            const cancelCropBtn = tabPanel.querySelector('#btn-cancel-crop');
            const cropSection = tabPanel.querySelector('#crop-section');
            const controlGroup = tabPanel.querySelector('.avatar-adv-control-group');

            startCropBtn.addEventListener('click', () => {
                if (!window.Cropper) {
                    toastr.warning('酒馆内置 Cropper.js 尚未加载，无法执行裁剪。');
                    return;
                }
                controlGroup.style.display = 'none';
                startCropBtn.style.display = 'none';
                cropSection.style.display = 'flex';

                const currentVal = getAdjustment(targetType, targetFile);
                const activeSrc = resolveImageUrl(currentVal.overrideUrl) || originalAvatarUrl;
                const cropperImg = tabPanel.querySelector('#cropper-img');
                cropperImg.src = activeSrc;

                cropperInstance = new Cropper(cropperImg, {
                    aspectRatio: NaN,
                    viewMode: 1,
                    dragMode: 'move',
                    autoCropArea: 0.8
                });
            });

            cancelCropBtn.addEventListener('click', () => {
                if (cropperInstance) {
                    cropperInstance.destroy();
                    cropperInstance = null;
                }
                cropSection.style.display = 'none';
                controlGroup.style.display = 'flex';
                startCropBtn.style.display = 'inline-flex';
            });

            saveCropBtn.addEventListener('click', () => {
                if (!cropperInstance) return;

                const canvas = cropperInstance.getCroppedCanvas();
                if (!canvas) {
                    toastr.error('获取裁剪画布失败。');
                    return;
                }

                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        toastr.error('生成图片二进制数据失败。');
                        return;
                    }

                    const { getRequestHeaders, showLoader, hideLoader } = SillyTavern.getContext();
                    showLoader();

                    try {
                        const formData = new FormData();
                        let uploadUrl = '';

                        if (targetType === 'char') {
                            uploadUrl = '/api/characters/edit-avatar';
                            formData.append('avatar', blob, 'avatar.png');
                            formData.append('avatar_url', targetFile);
                        } else {
                            uploadUrl = '/api/avatars/upload';
                            formData.append('avatar', blob, 'avatar.png');
                            formData.append('overwrite_name', targetFile);
                        }

                        const response = await fetch(uploadUrl, {
                            method: 'POST',
                            headers: getRequestHeaders({ omitContentType: true }),
                            body: formData
                        });

                        if (!response.ok) {
                            throw new Error(await response.text());
                        }

                        const timestamp = Date.now();
                        
                        if (targetType === 'char') {
                            await fetch(`/characters/${targetFile}`, { method: 'GET', cache: 'reload' });
                        } else {
                            await fetch(`/User Avatars/${targetFile}`, { method: 'GET', cache: 'reload' });
                        }

                        document.querySelectorAll(`img[src*="${targetFile}"]`).forEach(img => {
                            const s = new URL(img.src, window.location.href);
                            s.searchParams.set('v', String(timestamp));
                            img.src = s.toString();
                        });

                        const sharedImg = document.getElementById('shared-preview-img');
                        if (sharedImg) {
                            const s = new URL(sharedImg.src, window.location.href);
                            s.searchParams.set('v', String(timestamp));
                            sharedImg.src = s.toString();
                        }

                        toastr.success('头像裁剪并应用成功！');
                        cancelCropBtn.click();
                    } catch (err) {
                        console.error('[Theme Manager Avatar] Upload failed:', err);
                        toastr.error(`头像上传更新失败: ${err.message}`);
                    } finally {
                        hideLoader();
                    }
                }, 'image/png');
            });

            const saveVisualCropBtn = tabPanel.querySelector('#btn-save-visual-crop');
            if (saveVisualCropBtn) {
                saveVisualCropBtn.addEventListener('click', () => {
                    if (!cropperInstance) return;

                    const data = cropperInstance.getData(true);
                    const imageData = cropperInstance.getImageData();

                    const w_c = data.width;
                    const h_c = data.height;
                    const w_i = imageData.naturalWidth;
                    const h_i = imageData.naturalHeight;

                    if (w_c <= 0 || h_c <= 0) {
                        toastr.error('无效的裁剪尺寸。');
                        return;
                    }

                    // 1. 计算缩放倍率 (zoom)
                    const zoom = Math.max(w_i / w_c, h_i / h_c);

                    // 2. 计算偏移量百分比 (x, y)
                    const shiftX = (w_i / 2) - (data.x + w_c / 2);
                    const shiftY = (h_i / 2) - (data.y + h_c / 2);

                    const pctX = (shiftX / w_i) * 100;
                    const pctY = (shiftY / h_i) * 100;

                    // 3. 应用并保存属性
                    const currentVal = getAdjustment(targetType, targetFile);
                    currentVal.zoom = parseFloat(zoom.toFixed(4));
                    currentVal.x = parseFloat(pctX.toFixed(2));
                    currentVal.y = parseFloat(pctY.toFixed(2));

                    saveAdjustment(targetType, targetFile, currentVal);
                    updatePanelLivePreview(currentVal);

                    // 同步更新滑动条输入控件
                    zoomInput.value = currentVal.zoom;
                    xInput.value = currentVal.x;
                    yInput.value = currentVal.y;

                    zoomLbl.textContent = `${currentVal.zoom.toFixed(2)}x`;
                    xLbl.textContent = `${currentVal.x.toFixed(0)}%`;
                    yLbl.textContent = `${currentVal.y.toFixed(0)}%`;

                    cancelCropBtn.click();
                    toastr.success('视觉裁剪应用成功！已转换为缩放与偏移参数。');
                });
            }
        }

        // 选项卡2：头像框页
        function bindFrameTab(tabPanel, targetType, targetFile) {
            const btnApply = tabPanel.querySelector('#btn-subtab-apply');
            const btnStore = tabPanel.querySelector('#btn-subtab-store');
            const applyContent = tabPanel.querySelector('#subtab-apply-content');
            const storeContent = tabPanel.querySelector('#subtab-store-content');

            const toggleBatchBtn = tabPanel.querySelector('#btn-toggle-batch-import');
            const batchImportPanel = tabPanel.querySelector('#batch-import-collapsible');

            const chkEnableFrame = tabPanel.querySelector('#chk-enable-avatar-frame');
            if (chkEnableFrame) {
                chkEnableFrame.checked = localStorage.getItem('themeManager_enableAvatarFrame') === 'true';
                chkEnableFrame.addEventListener('change', () => {
                    localStorage.setItem('themeManager_enableAvatarFrame', chkEnableFrame.checked ? 'true' : 'false');
                    applyAvatarStyles();
                    const current = getAdjustment(targetType, targetFile);
                    updatePanelLivePreview(current);
                });
            }

            toggleBatchBtn.addEventListener('click', () => {
                const isCollapsed = batchImportPanel.style.display === 'none';
                batchImportPanel.style.display = isCollapsed ? 'flex' : 'none';
                const icon = toggleBatchBtn.querySelector('i');
                if (icon) {
                    icon.className = isCollapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
                }
            });

            btnApply.addEventListener('click', () => {
                btnApply.classList.add('active');
                btnStore.classList.remove('active');
                applyContent.style.display = 'flex';
                storeContent.style.display = 'none';
                renderActiveFramePanel();
                adjustPreviewVisibility(panel); // 切换子页，实时更新常驻预览显示
            });

            btnStore.addEventListener('click', () => {
                btnStore.classList.add('active');
                btnApply.classList.remove('active');
                storeContent.style.display = 'flex';
                applyContent.style.display = 'none';
                renderCustomFramesManage();
                adjustPreviewVisibility(panel); // 切换子页，实时更新常驻预览显示
            });

            renderActiveFramePanel();

            // 1. URL 单个导入
            const frameUrlInput = tabPanel.querySelector('#input-frame-url');
            const frameNameInput = tabPanel.querySelector('#input-frame-name');
            tabPanel.querySelector('#btn-import-frame-url').addEventListener('click', () => {
                const url = frameUrlInput.value.trim();
                let name = frameNameInput.value.trim();
                if (!url) {
                    toastr.warning('请输入头像框 URL');
                    return;
                }
                if (!name) name = `导入-${Date.now().toString().slice(-4)}`;

                let customFrames = [];
                try {
                    customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
                } catch (e) {}
                
                customFrames.push({ id: `frame_${Date.now()}`, name, url });
                localStorage.setItem(FRAMES_KEY, JSON.stringify(customFrames));
                toastr.success(`头像框 "${name}" 导入成功`);
                frameUrlInput.value = '';
                frameNameInput.value = '';
                renderCustomFramesManage();
            });

            // 2. URLs 批量导入
            const batchUrlsArea = tabPanel.querySelector('#textarea-frame-batch-urls');
            tabPanel.querySelector('#btn-batch-import-urls').addEventListener('click', () => {
                const text = batchUrlsArea.value.trim();
                if (!text) {
                    toastr.warning('请输入 URL 列表');
                    return;
                }

                const urls = text.split('\n').map(u => u.trim()).filter(u => u.length > 0);
                if (urls.length === 0) return;

                let customFrames = [];
                try {
                    customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
                } catch (e) {}
                
                urls.forEach((url, i) => {
                    customFrames.push({
                        id: `frame_${Date.now()}_${i}`,
                        name: `批量-${Date.now().toString().slice(-4)}-${i + 1}`,
                        url: url
                    });
                });
                localStorage.setItem(FRAMES_KEY, JSON.stringify(customFrames));
                toastr.success(`成功导入 ${urls.length} 个头像框！`);
                batchUrlsArea.value = '';
                renderCustomFramesManage();
            });

            // 3. 本地图片批量选择导入
            const fileInput = tabPanel.querySelector('#input-batch-frame-files');
            const selectFilesBtn = tabPanel.querySelector('#btn-batch-select-files');
            selectFilesBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;

                let customFrames = [];
                try {
                    customFrames = JSON.parse(localStorage.getItem(FRAMES_KEY)) || [];
                } catch (err) {}
                
                let loadedCount = 0;

                const readFile = (fileObj) => {
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            customFrames.push({
                                id: `frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                name: fileObj.name.substring(0, fileObj.name.lastIndexOf('.')) || fileObj.name,
                                url: reader.result
                            });
                            loadedCount++;
                            resolve();
                        };
                        reader.readAsDataURL(fileObj);
                    });
                };

                for (const fileObj of files) {
                    await readFile(fileObj);
                }

                localStorage.setItem(FRAMES_KEY, JSON.stringify(customFrames));
                toastr.success(`成功导入 ${loadedCount} 个本地头像框！`);
                fileInput.value = '';
                renderCustomFramesManage();
            });
        }

        // 选项卡3：图库页
        function bindGalleryTab(tabPanel, targetType, targetFile) {
            const urlInput = tabPanel.querySelector('#input-gallery-url');
            const fileInput = tabPanel.querySelector('#input-gallery-file');
            const uploadBtn = tabPanel.querySelector('#btn-upload-gallery-file');
            const clearBtn = tabPanel.querySelector('#btn-clear-gallery-override');

            const btnGalleryGlobal = tabPanel.querySelector('#btn-gallery-subtab-global');
            const btnGalleryChar = tabPanel.querySelector('#btn-gallery-subtab-char');

            if (btnGalleryGlobal && btnGalleryChar) {
                btnGalleryGlobal.addEventListener('click', () => {
                    btnGalleryGlobal.classList.add('active');
                    btnGalleryChar.classList.remove('active');
                    gallerySubtab = 'global';
                    renderGalleryGrid();
                });
                btnGalleryChar.addEventListener('click', () => {
                    btnGalleryChar.classList.add('active');
                    btnGalleryGlobal.classList.remove('active');
                    gallerySubtab = 'char';
                    renderGalleryGrid();
                });
            }

            // 1. URL 绑定
            tabPanel.querySelector('#btn-apply-gallery-url').addEventListener('click', () => {
                const url = urlInput.value.trim();
                if (!url) {
                    toastr.warning('请输入图片地址');
                    return;
                }
                
                if (targetType === 'char') {
                    const currentVal = getAdjustment(targetType, targetFile);
                    if (!currentVal.gallery) currentVal.gallery = [];
                    if (!currentVal.gallery.some(img => img.url === url)) {
                        currentVal.gallery.push({ id: `img_${Date.now()}`, name: `外链-${Date.now().toString().slice(-4)}`, url });
                    }
                    saveAdjustment(targetType, targetFile, currentVal);
                } else {
                    if (gallerySubtab === 'global') {
                        let globalGallery = [];
                        try {
                            globalGallery = JSON.parse(localStorage.getItem('themeManager_globalUserGallery')) || [];
                        } catch (e) {}
                        
                        if (!globalGallery.some(img => img.url === url)) {
                            globalGallery.push({ id: `img_${Date.now()}`, name: `全局外链-${Date.now().toString().slice(-4)}`, url });
                            localStorage.setItem('themeManager_globalUserGallery', JSON.stringify(globalGallery));
                        }
                    } else {
                        const currentVal = getAdjustment(targetType, targetFile);
                        if (!currentVal.gallery) currentVal.gallery = [];
                        if (!currentVal.gallery.some(img => img.url === url)) {
                            currentVal.gallery.push({ id: `img_${Date.now()}`, name: `角色外链-${Date.now().toString().slice(-4)}`, url });
                        }
                        saveAdjustment(targetType, targetFile, currentVal);
                    }
                }

                applyOverride(url);
            });

            // 2. 本地上传
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (!f) return;

                const id = `img_${Date.now()}`;
                const name = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;

                saveImageBlob(id, name, f).then(() => {
                    // 缓存 Blob 的 Object URL
                    galleryBlobUrlCache[id] = URL.createObjectURL(f);
                    const url = `db://${id}`;

                    if (targetType === 'char') {
                        const currentVal = getAdjustment(targetType, targetFile);
                        if (!currentVal.gallery) currentVal.gallery = [];
                        currentVal.gallery.push({ id, name, url });
                        saveAdjustment(targetType, targetFile, currentVal);
                    } else {
                        if (gallerySubtab === 'global') {
                            let globalGallery = [];
                            try {
                                globalGallery = JSON.parse(localStorage.getItem('themeManager_globalUserGallery')) || [];
                            } catch (e) {}
                            
                            globalGallery.push({ id, name, url });
                            localStorage.setItem('themeManager_globalUserGallery', JSON.stringify(globalGallery));
                        } else {
                            const currentVal = getAdjustment(targetType, targetFile);
                            if (!currentVal.gallery) currentVal.gallery = [];
                            currentVal.gallery.push({ id, name, url });
                            saveAdjustment(targetType, targetFile, currentVal);
                        }
                    }

                    applyOverride(url);
                    urlInput.value = '';
                    fileInput.value = '';
                }).catch(err => {
                    console.error('[Theme Manager DB] Failed to save uploaded image:', err);
                    toastr.error('本地数据库保存图片失败。');
                });
            });

            // 3. 清除
            clearBtn.addEventListener('click', () => {
                applyOverride('');
                urlInput.value = '';
                toastr.info('已重置并恢复默认原始头像。');
            });

            renderGalleryGrid();
        }

        // 选项卡4：美化主题绑定 (仅角色卡)
        function bindThemeBindingTab(tabPanel, targetFile) {
            const searchInput = tabPanel.querySelector('#bind-search-input');
            const listContainer = tabPanel.querySelector('#bind-themes-list');
            const saveBtn = tabPanel.querySelector('#btn-save-theme-binding');
            const chkApplyOnBind = tabPanel.querySelector('#chk-apply-on-bind');

            const APPLY_ON_BIND_KEY = 'themeManager_applyThemeOnBind';
            if (chkApplyOnBind) {
                const applyOnBind = localStorage.getItem(APPLY_ON_BIND_KEY) !== 'false';
                chkApplyOnBind.checked = applyOnBind;
                chkApplyOnBind.addEventListener('change', (e) => {
                    localStorage.setItem(APPLY_ON_BIND_KEY, e.target.checked ? 'true' : 'false');
                });
            }

            let bindings = {};
            try {
                bindings = JSON.parse(localStorage.getItem(BINDINGS_KEY)) || {};
            } catch (e) {}
            
            let selectedValue = bindings[targetFile] || '';

            const stThemesSelect = document.querySelector('#themes');
            const allThemes = [];
            if (stThemesSelect) {
                Array.from(stThemesSelect.options).forEach(opt => {
                    if (opt.value) {
                        allThemes.push({ value: opt.value, display: opt.textContent });
                    }
                });
            }

            let tags = [];
            try {
                tags = JSON.parse(localStorage.getItem(TAGS_KEY)) || [];
            } catch (e) {}

            // 改为使用 FontAwesome 字体图标名称定义折叠列表，杜绝 Emoji 符号混杂
            const buildThemeGroups = () => {
                const groups = [];
                if (tags.length > 0) {
                    groups.push({
                        id: 'group_random',
                        name: 'dice',
                        displayName: '随机标签切换绑定',
                        items: tags.map(t => ({
                            value: `[Tag] ${t.id}`,
                            display: `随机切换: ${t.name}`,
                            searchText: `随机切换: ${t.name}`.toLowerCase()
                        }))
                    });
                }
                tags.forEach(t => {
                    if (t.themes && t.themes.length > 0) {
                        const matchedThemes = allThemes.filter(th => t.themes.includes(th.value));
                        if (matchedThemes.length > 0) {
                            groups.push({
                                id: `group_tag_${t.id}`,
                                name: 'tags',
                                displayName: `标签分组: ${t.name}`,
                                items: matchedThemes.map(th => ({
                                    value: th.value,
                                    display: th.display,
                                    searchText: `${th.display} ${t.name}`.toLowerCase()
                                }))
                            });
                        }
                    }
                });
                const allTaggedThemeNames = new Set();
                tags.forEach(t => {
                    if (t.themes) t.themes.forEach(name => {
                        if (name) allTaggedThemeNames.add(name);
                    });
                });
                const uncategorizedThemes = allThemes.filter(th => !allTaggedThemeNames.has(th.value));
                if (uncategorizedThemes.length > 0) {
                    groups.push({
                        id: 'group_uncategorized',
                        name: 'folder-open',
                        displayName: '未分类美化主题',
                        items: uncategorizedThemes.map(th => ({
                            value: th.value,
                            display: th.display,
                            searchText: th.display.toLowerCase()
                        }))
                    });
                }
                return groups;
            };

            const themeGroups = buildThemeGroups();
            const collapsedStates = {};
            themeGroups.forEach(g => {
                const hasActive = g.items.some(item => item.value === selectedValue);
                collapsedStates[g.id] = !hasActive;
            });

            const renderList = (filterQuery = '') => {
                listContainer.innerHTML = '';

                const noneItem = document.createElement('div');
                noneItem.className = `theme-row-item${selectedValue === '' ? ' active' : ''}`;
                noneItem.style.marginBottom = '6px';
                noneItem.style.background = 'rgba(255,255,255,0.03)';
                // 清除绑定也使用 FontAwesome 图标，去掉 emoji
                noneItem.innerHTML = `<i class="fa-solid fa-ban" style="margin-right:6px;"></i> 取消并清除当前美化绑定`;
                noneItem.addEventListener('click', () => {
                    selectedValue = '';
                    listContainer.querySelectorAll('.theme-row-item').forEach(el => el.classList.remove('active'));
                    noneItem.classList.add('active');
                });
                listContainer.appendChild(noneItem);

                let groupRendered = 0;

                themeGroups.forEach(g => {
                    let filteredItems = g.items;
                    if (filterQuery) {
                        filteredItems = g.items.filter(item => item.searchText.includes(filterQuery));
                    }
                    if (filteredItems.length === 0) return;
                    groupRendered++;

                    const header = document.createElement('div');
                    header.className = 'theme-group-header';
                    const isCollapsed = filterQuery ? false : collapsedStates[g.id];
                    const chevronIcon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
                    
                    // 将 name 分组标识直接转译为 FontAwesome 实体
                    let groupIconClass = 'fa-folder';
                    if (g.name === 'dice') groupIconClass = 'fa-dice';
                    else if (g.name === 'tags') groupIconClass = 'fa-tags';
                    else if (g.name === 'folder-open') groupIconClass = 'fa-folder-open';

                    header.innerHTML = `
                        <span>
                            <i class="fa-solid ${chevronIcon}" style="margin-right:6px; font-size:10px;"></i>
                            <i class="fa-solid ${groupIconClass}" style="margin-right:6px;"></i>
                            ${escapeHtml(g.displayName)}
                        </span>
                        <span style="font-size:11px; opacity:0.6;">(${filteredItems.length})</span>
                    `;

                    const content = document.createElement('div');
                    content.className = 'theme-group-content';
                    content.style.display = isCollapsed ? 'none' : 'flex';

                    filteredItems.forEach(item => {
                        const row = document.createElement('div');
                        row.className = `theme-row-item${selectedValue === item.value ? ' active' : ''}`;
                        row.textContent = item.display;
                        row.title = item.display;

                        row.addEventListener('click', () => {
                            selectedValue = item.value;
                            listContainer.querySelectorAll('.theme-row-item').forEach(el => el.classList.remove('active'));
                            row.classList.add('active');
                            noneItem.classList.remove('active');
                        });
                        content.appendChild(row);
                    });

                    header.addEventListener('click', () => {
                        if (filterQuery) return;
                        collapsedStates[g.id] = !collapsedStates[g.id];
                        content.style.display = collapsedStates[g.id] ? 'none' : 'flex';
                        const icon = header.querySelector('.fa-chevron-right, .fa-chevron-down');
                        if (icon) {
                            icon.className = collapsedStates[g.id] ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';
                        }
                    });

                    listContainer.appendChild(header);
                    listContainer.appendChild(content);
                });

                if (groupRendered === 0) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.style = 'text-align:center; font-size:11px; opacity:0.5; padding:20px;';
                    emptyMsg.textContent = '未找到匹配的主题或标签';
                    listContainer.appendChild(emptyMsg);
                }
            };

            searchInput.addEventListener('input', (e) => {
                renderList(e.target.value.trim().toLowerCase());
            });

            saveBtn.addEventListener('click', () => {
                let updatedBindings = {};
                try {
                    updatedBindings = JSON.parse(localStorage.getItem(BINDINGS_KEY)) || {};
                } catch (e) {}

                if (selectedValue) {
                    updatedBindings[targetFile] = selectedValue;
                    let displayValue = selectedValue;
                    if (selectedValue.startsWith('[Tag] ')) {
                        const tagId = selectedValue.replace('[Tag] ', '');
                        const tag = tags.find(t => t.id === tagId);
                        displayValue = tag ? `标签: ${tag.name} (随机切换)` : selectedValue;
                    }
                    toastr.success(`已成功将该角色绑定到美化：<b>${displayValue}</b>`, '', { escapeHtml: false });
                } else {
                    delete updatedBindings[targetFile];
                    toastr.info('已取消该角色的美化绑定。');
                }
                localStorage.setItem(BINDINGS_KEY, JSON.stringify(updatedBindings));
                
                const shouldApplyNow = chkApplyOnBind ? chkApplyOnBind.checked : true;
                if (shouldApplyNow && window.themeManager && typeof window.themeManager.applyBoundThemeForCharacter === 'function') {
                    window.themeManager.applyBoundThemeForCharacter(targetFile);
                }
            });

            renderList();
        }
    }

    function closePanel() {
        const existing = document.getElementById('avatar-adv-panel');
        if (existing) {
            existing.remove();
        }
        if (cropperInstance) {
            try {
                cropperInstance.destroy();
            } catch (e) {}
            cropperInstance = null;
        }
    }

    // 拖拽逻辑 (相对于 fixed 视口进行绝对像素控制，内置边界保护以防 header 移出屏幕，支持 PC 鼠标和手机触摸)
    function bindDrag(panel) {
        const header = panel.querySelector('#avatar-adv-header');
        let isDragging = false;
        let startX, startY;
        let panelX, panelY;
        let rafId = null;
        let latestClientX = 0;
        let latestClientY = 0;

        const startDrag = (clientX, clientY) => {
            isDragging = true;
            startX = clientX;
            startY = clientY;

            const rect = panel.getBoundingClientRect();
            panel.style.transform = 'none';
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;

            panelX = rect.left;
            panelY = rect.top;

            latestClientX = clientX;
            latestClientY = clientY;
        };

        const updatePosition = () => {
            if (!isDragging) return;
            const dx = latestClientX - startX;
            const dy = latestClientY - startY;

            // 限制弹窗不能拖出视口上方，防止 header 丢失无法关闭
            let nextLeft = panelX + dx;
            let nextTop = Math.max(0, panelY + dy); // 限制 top 不能小于 0

            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
            
            rafId = null;
        };

        const moveDrag = (clientX, clientY) => {
            if (!isDragging) return;
            latestClientX = clientX;
            latestClientY = clientY;
            if (!rafId) {
                rafId = requestAnimationFrame(updatePosition);
            }
        };

        const endDrag = () => {
            if (isDragging) {
                isDragging = false;
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                savePanelGeometry(panel);
            }
        };

        // PC 鼠标事件监听
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.avatar-adv-close-btn') || e.target.closest('.avatar-adv-toggle-preview-btn') || e.target.closest('.avatar-adv-major-tab-btn')) return;
            startDrag(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            moveDrag(e.clientX, e.clientY);
        }

        function onMouseUp() {
            endDrag();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        // 移动端触摸事件监听
        header.addEventListener('touchstart', (e) => {
            if (e.target.closest('.avatar-adv-close-btn') || e.target.closest('.avatar-adv-toggle-preview-btn') || e.target.closest('.avatar-adv-major-tab-btn')) return;
            const touch = e.touches[0];
            startDrag(touch.clientX, touch.clientY);
            // 阻止默认行为以防拖动时触发整个页面背景滚动
            e.preventDefault();
        }, { passive: false });

        header.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            moveDrag(touch.clientX, touch.clientY);
            e.preventDefault();
        }, { passive: false });

        header.addEventListener('touchend', endDrag, { passive: true });
        header.addEventListener('touchcancel', endDrag, { passive: true });

        // 窄拖拽条：绑定与 header 相同的拖拽事件
        const dragStrip = panel.querySelector('#avatar-adv-drag-strip');
        if (dragStrip) {
            dragStrip.addEventListener('mousedown', (e) => {
                startDrag(e.clientX, e.clientY);
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            dragStrip.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                startDrag(touch.clientX, touch.clientY);
                e.preventDefault();
            }, { passive: false });

            dragStrip.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                const touch = e.touches[0];
                moveDrag(touch.clientX, touch.clientY);
                e.preventDefault();
            }, { passive: false });

            dragStrip.addEventListener('touchend', endDrag, { passive: true });
            dragStrip.addEventListener('touchcancel', endDrag, { passive: true });
        }
    }

    // 缩放大小 (支持 PC 鼠标和手机触摸)
    function bindResize(panel) {
        const resizer = panel.querySelector('.avatar-adv-resizer');
        let isResizing = false;
        let startWidth, startHeight;
        let startX, startY;
        let rafId = null;
        let latestClientX = 0;
        let latestClientY = 0;

        const startResize = (clientX, clientY) => {
            isResizing = true;
            startX = clientX;
            startY = clientY;
            startWidth = panel.offsetWidth;
            startHeight = panel.offsetHeight;

            const rect = panel.getBoundingClientRect();
            panel.style.transform = 'none';
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;

            latestClientX = clientX;
            latestClientY = clientY;
        };

        const updateSize = () => {
            if (!isResizing) return;
            const dw = latestClientX - startX;
            const dh = latestClientY - startY;
            
            // 动态计算最小与最大边界，防范移动端窄屏死锁
            const minW = Math.min(320, window.innerWidth - 20);
            const minH = Math.min(350, window.innerHeight - 20);
            const maxW = window.innerWidth - panel.offsetLeft - 10;
            const maxH = window.innerHeight - panel.offsetTop - 10;
            
            // 保证 maxW 不小于 minW，防止 Math.min / Math.max 交叉冲突
            const finalMaxW = Math.max(minW, maxW);
            const finalMaxH = Math.max(minH, maxH);
            
            panel.style.width = `${Math.max(minW, Math.min(finalMaxW, startWidth + dw))}px`;
            panel.style.height = `${Math.max(minH, Math.min(finalMaxH, startHeight + dh))}px`;
            
            rafId = null;
        };

        const moveResize = (clientX, clientY) => {
            if (!isResizing) return;
            latestClientX = clientX;
            latestClientY = clientY;
            if (!rafId) {
                rafId = requestAnimationFrame(updateSize);
            }
        };

        const endResize = () => {
            if (isResizing) {
                isResizing = false;
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                savePanelGeometry(panel);
            }
        };

        // PC 鼠标事件监听
        resizer.addEventListener('mousedown', (e) => {
            startResize(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        function onMouseMove(e) {
            moveResize(e.clientX, e.clientY);
        }

        function onMouseUp() {
            endResize();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        // 移动端触摸事件监听
        resizer.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startResize(touch.clientX, touch.clientY);
            e.preventDefault();
        }, { passive: false });

        resizer.addEventListener('touchmove', (e) => {
            if (!isResizing) return;
            const touch = e.touches[0];
            moveResize(touch.clientX, touch.clientY);
            e.preventDefault();
        }, { passive: false });

        resizer.addEventListener('touchend', endResize, { passive: true });
        resizer.addEventListener('touchcancel', endResize, { passive: true });
    }

    // 选项卡切换
    function bindTabs(panel) {
        const tabs = panel.querySelectorAll('.avatar-adv-tab-btn[data-tab]');
        const contents = panel.querySelectorAll('.avatar-adv-tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                
                tabs.forEach(t => t.classList.toggle('active', t === tab));
                contents.forEach(c => c.classList.toggle('active', c.id === `tab-${targetTab}`));
                
                // 动态隐藏/显示常驻预览组件
                adjustPreviewVisibility(panel);

                // 切走时销毁裁剪器
                if (targetTab !== 'adjust' && cropperInstance) {
                    try {
                        cropperInstance.destroy();
                    } catch (e) {}
                    cropperInstance = null;
                    panel.querySelector('#crop-section').style.display = 'none';
                    panel.querySelector('.avatar-adv-control-group').style.display = 'flex';
                    panel.querySelector('#btn-start-crop').style.display = 'inline-flex';
                }
            });
        });
    }

    // 辅助安全转义
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // 注册魔法棒菜单（Wand Menu）按钮
    function registerWandButtons() {
        if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
        // 1. 角色魔法棒按钮
        const charWandMenu = document.getElementById('extensionsMenu');
        if (charWandMenu) {
            if (!document.getElementById('theme-manager-char-avatar-wand-btn')) {
                const btn = document.createElement('div');
                btn.id = 'theme-manager-char-avatar-wand-btn';
                btn.className = 'list-group-item flex-container flexGap5 clickable';
                btn.title = '头像管理';
                btn.innerHTML = `
                    <div class="fa-solid fa-user-gear extensionsMenuExtensionButton"></div>
                    <span>头像管理</span>
                `;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    $('#extensionsMenu').hide();

                    const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                    if (context && context.characters && context.characterId !== undefined) {
                        const charObj = context.characters[context.characterId];
                        if (charObj && charObj.avatar) {
                            const file = charObj.avatar;
                            const charImg = document.querySelector('#avatar_div img, #right-nav-panel .character_select.selected img, .avatar img');
                            const src = charImg ? charImg.src : `/characters/${file}`;
                            openPanel('char', file, src);
                            return;
                        }
                    }
                    toastr.warning('未找到当前活动的聊天角色。');
                });
                charWandMenu.appendChild(btn);
            }
        }

        // 2. 用户魔法棒按钮
        const userWandMenu = document.getElementById('userExtensionsMenu');
        if (userWandMenu) {
            if (!document.getElementById('theme-manager-user-avatar-wand-btn')) {
                const btn = document.createElement('div');
                btn.id = 'theme-manager-user-avatar-wand-btn';
                btn.className = 'list-group-item flex-container flexGap5 clickable';
                btn.title = '头像管理';
                btn.innerHTML = `
                    <div class="fa-solid fa-user-gear extensionsMenuExtensionButton"></div>
                    <span>头像管理</span>
                `;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    $('#userExtensionsMenu').hide();

                    const userImg = document.querySelector('#user_avatar_block img, .user_avatar img');
                    const src = userImg ? userImg.src : '';
                    const file = getAvatarFilename(src);
                    if (file) {
                        openPanel('user', file, src);
                    } else {
                        toastr.warning('未找到用户头像，请先在用户面板上传头像。');
                    }
                });
                userWandMenu.appendChild(btn);
            }
        }
    }

    // 设置双击/长按监听逻辑
    function setupInteractionListeners() {
        let pressTimer = null;
        let startX = 0, startY = 0;
        let clickedElement = null;
        
        let lastClickTime = 0;
        let lastClickElement = null;

        function handleAvatarTrigger(target, e) {
            const info = identifyAvatar(target);
            if (info.file) {
                if (e && typeof e.preventDefault === 'function') {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (err) {}
                }
                openPanel(info.type, info.file, info.src);
            }
        }

        const cancelPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        // 1. Mousedown (鼠标点击和长按)
        document.body.addEventListener('mousedown', (e) => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
            const target = e.target.closest('.avatar, .avatarimg, #avatar_div, .user_avatar, .character_select img');
            if (!target) return;

            const triggerMethod = avatarTriggerMethod;
            const now = Date.now();

            // 双击触发判定
            if (triggerMethod !== 'longpress') {
                if (now - lastClickTime < 450 && lastClickElement === target) {
                    lastClickTime = 0;
                    lastClickElement = null;
                    cancelPress();
                    handleAvatarTrigger(target, e);
                    return;
                }
            }
            lastClickTime = now;
            lastClickElement = target;

            // 长按触发判定
            if (triggerMethod !== 'dblclick') {
                clickedElement = target;
                startX = e.clientX;
                startY = e.clientY;
                cancelPress();

                pressTimer = setTimeout(() => {
                    handleAvatarTrigger(clickedElement);
                }, 600);
            }
        }, true);

        document.body.addEventListener('mousemove', (e) => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
            if (!clickedElement) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.sqrt(dx*dx + dy*dy) > 10) {
                cancelPress();
            }
        }, true);

        document.body.addEventListener('mouseup', cancelPress, true);
        document.body.addEventListener('mouseleave', cancelPress, true);

        // 2. Touch (移动端触屏双击与长按)
        let lastTouchTime = 0;
        let lastTouchElement = null;

        document.body.addEventListener('touchstart', (e) => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
            const target = e.target.closest('.avatar, .avatarimg, #avatar_div, .user_avatar, .character_select img');
            if (!target) return;

            const triggerMethod = avatarTriggerMethod;
            const touch = e.touches[0];
            const now = Date.now();

            // 移动端双击判定
            if (triggerMethod !== 'longpress') {
                if (now - lastTouchTime < 450 && lastTouchElement === target) {
                    lastTouchTime = 0;
                    lastTouchElement = null;
                    cancelPress();
                    handleAvatarTrigger(target, e);
                    return;
                }
            }
            lastTouchTime = now;
            lastTouchElement = target;

            // 移动端长按判定
            if (triggerMethod !== 'dblclick') {
                clickedElement = target;
                startX = touch.clientX;
                startY = touch.clientY;
                cancelPress();

                pressTimer = setTimeout(() => {
                    handleAvatarTrigger(clickedElement);
                }, 600);
            }
        }, { capture: true, passive: false });

        document.body.addEventListener('touchmove', (e) => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
            if (!clickedElement) return;
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            if (Math.sqrt(dx*dx + dy*dy) > 10) {
                cancelPress();
            }
        }, { capture: true, passive: true });

        document.body.addEventListener('touchend', cancelPress, { capture: true, passive: true });
        document.body.addEventListener('touchcancel', cancelPress, { capture: true, passive: true });

        // 3. 点击头像放大阻止器 (仅在 #chat 区域内拦截)
        document.body.addEventListener('click', (e) => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') === 'false') return;
            if (!isZoomDisabled) return;

            const target = e.target.closest('.avatar, .avatarimg, #avatar_div, .user_avatar');
            if (target && target.closest('#chat')) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    // 运行初始化
    const isHelperEnabled = localStorage.getItem('themeManager_enableAvatarHelper') !== 'false';
    if (isHelperEnabled) {
        document.body.classList.toggle('tm-avatar-hd-rendering', isHdEnabled);
        initStyles();
        registerWandButtons();
    }
    setupInteractionListeners();
    updateActiveCharacterAttr();
    tagAllMessages();

    // 监听聊天容器变化，实现绝对零延迟的头像视觉替换打标签
    try {
        const chatEl = document.getElementById('chat');
        if (chatEl) {
            const chatObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.classList.contains('mes')) {
                                tagMessageElementsWithCharName(node);
                            } else {
                                node.querySelectorAll('.mes').forEach(tagMessageElementsWithCharName);
                            }
                        }
                    });
                });
            });
            chatObserver.observe(chatEl, { childList: true, subtree: true });
        }
    } catch (e) {
        console.warn('[Theme Manager Avatar] Failed to setup chat MutationObserver:', e);
    }

    // 初始化 IndexedDB，执行 Base64 迁移并预加载 Blobs 缓存，然后应用 CSS 头像微调样式
    initDB()
        .then(() => migrateBase64Gallery())
        .then(() => loadGalleryBlobsToCache())
        .then(() => {
            if (localStorage.getItem('themeManager_enableAvatarHelper') !== 'false') {
                applyAvatarStyles();
            }
            console.log('[Theme Manager Avatar] Database initialization and asset loading completed successfully.');
        })
        .catch(err => {
            console.error('[Theme Manager Avatar] Database initialization failed:', err);
            // 降级使用同步样式渲染
            if (localStorage.getItem('themeManager_enableAvatarHelper') !== 'false') {
                applyAvatarStyles();
            }
        });

    // 监听酒馆底层事件，实时改变 data-active-char 属性以驱动前端 CSS 隔离替换
    try {
        const { eventSource, eventTypes } = SillyTavern.getContext();
        
        // 绑定消息渲染时机，动态插入发送者 data-ch-name 标签
        eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (mesId) => {
            const el = document.querySelector(`.mes[mesid="${mesId}"]`);
            if (el) tagMessageElementsWithCharName(el);
        });
        eventSource.on(eventTypes.USER_MESSAGE_RENDERED, (mesId) => {
            const el = document.querySelector(`.mes[mesid="${mesId}"]`);
            if (el) tagMessageElementsWithCharName(el);
        });

        eventSource.on(eventTypes.CHARACTER_SELECTED, () => {
            updateActiveCharacterAttr();
            setTimeout(tagAllMessages, 100);
            registerWandButtons();
        });
        eventSource.on(eventTypes.CHAT_CHANGED, () => {
            updateActiveCharacterAttr();
            setTimeout(tagAllMessages, 100);
            registerWandButtons();
        });
        
        // 兼容右侧角色切换
        $(document).on('click', '.character_select', () => {
            setTimeout(() => {
                updateActiveCharacterAttr();
                tagAllMessages();
                registerWandButtons();
            }, 100);
        });
    } catch (e) {
        console.warn('[Theme Manager Avatar] Failed to register event listeners:', e);
    }

    // 监听设置更改，以实现无刷新热更新
    document.addEventListener('themeManager:enableAvatarHelperChanged', (e) => {
        const enabled = e.detail;
        if (enabled) {
            initStyles();
            applyAvatarStyles();
            registerWandButtons();
            document.body.classList.toggle('tm-avatar-hd-rendering', isHdEnabled);
        } else {
            // 1. 清空动态头像微调 CSS 样式
            const styleEl = document.getElementById('avatar-adv-dynamic-style');
            if (styleEl) styleEl.textContent = '';
            
            // 2. 移除基础 CSS 样式
            const baseStyleEl = document.getElementById('avatar-adv-base-css');
            if (baseStyleEl) baseStyleEl.remove();

            // 3. 移除魔法棒按钮
            document.getElementById('theme-manager-char-avatar-wand-btn')?.remove();
            document.getElementById('theme-manager-user-avatar-wand-btn')?.remove();
            
            // 4. 关闭高级调整面板
            closePanel();
            
            // 5. 移除 HD 渲染 class
            document.body.classList.remove('tm-avatar-hd-rendering');
        }
    });

    // 暴露全局接口
    window.ThemeManagerAvatarAdjuster = {
        open: openPanel,
        close: closePanel,
        refresh: applyAvatarStyles
    };

    console.log('Theme Manager: 头像高级助手 (v2.4) 初始化完成。双击/长按任意头像以召出界面。');
})();
