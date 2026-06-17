(function () {
    'use strict';

    // 延时执行以确保 SillyTavern 核心弹出库完全就绪
    setTimeout(() => {
        try {
            if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return;
            const { callGenericPopup } = SillyTavern.getContext();
            if (!callGenericPopup) return;

            // 一经加载立即设定为已显示，防止关闭页面或刷新时重复弹出
            const shownKey = 'themeManager_firstRunNotificationShown';
            localStorage.setItem(shownKey, 'true');

            // 弹窗 HTML 模板 (磨砂配合 ST 当前主题配色)
            const popupHtml = `
                <div class="theme-manager-first-run-popup" style="
                    max-width: 500px;
                    font-size: 14.5px;
                    line-height: 1.6;
                    color: var(--SmartThemeBodyColor);
                    padding: 8px;
                ">
                    <div style="
                        margin-bottom: 20px;
                        border-bottom: 1px solid var(--SmartThemeBorderColor);
                        padding-bottom: 15px;
                    ">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">须知</h3>
                        <span style="font-size: 12px; opacity: 0.7;">首次安装运行声明</span>
                    </div>
                    
                    <div style="margin-bottom: 15px; display: flex; flex-direction: column; gap: 14px;">
                        <p style="margin: 0;">本拓展原作者为 <strong>@inkfoxxxx</strong>，原帖地址：<br>
                        <a href="https://discord.com/channels/1291925535324110879/1415255443017699329/1415255443017699329" target="_blank" style="color: #00b0ff; text-decoration: underline;">点击前往 Discord 原帖</a></p>
                        
                        <p style="margin: 0;">二改不保留任何权利，一切以原作者为准。</p>
                        
                        <p style="margin: 0; color: #ff5252; font-weight: bold;">请注意，本拓展存在破坏性更新，已无法与原拓展兼容，请选择其中之一进行使用。</p>
                        
                        <p style="margin: 0;">具体更新细则请查看 DC 资源贴。</p>
                    </div>
                </div>
            `;

            // 调用 SillyTavern 原生弹出库显示弹窗
            callGenericPopup(popupHtml, 'confirm', null, {
                okButton: '已知悉',
                cancelButton: false, // 显式传入 false 以彻底隐藏取消按钮
            });
        } catch (error) {
            console.error('[Theme Manager] 首次运行通知展示失败:', error);
        }
    }, 1000);
})();
