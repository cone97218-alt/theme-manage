/**
 * modules/background-batch.js
 * 注入原生背景抽屉 - 批量删除背景功能
 */
export function initBackgroundEnhancements({ getRequestHeaders, showLoader, hideLoader, limitConcurrency }) {
    const bgDrawer = document.getElementById('Backgrounds');
    if (!bgDrawer) return;

    // 查找背景面板的 header 区域
    const headerRow = bgDrawer.querySelector('.bg-header-row-1');
    if (!headerRow || document.getElementById('tm-bg-batch-toggle-btn')) return;

    let isBatchMode = false;
    const selectedBgs = new Set();

    // --- 创建批量管理按钮 ---
    const batchToggleBtn = document.createElement('div');
    batchToggleBtn.id = 'tm-bg-batch-toggle-btn';
    batchToggleBtn.className = 'menu_button menu_button_icon';
    batchToggleBtn.title = '批量删除背景';
    batchToggleBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
    headerRow.appendChild(batchToggleBtn);

    // --- 创建操作栏 ---
    const actionsBar = document.createElement('div');
    actionsBar.id = 'tm-bg-batch-actions-bar';
    actionsBar.style.display = 'none';
    actionsBar.innerHTML = `
        <button id="tm-bg-select-all-btn" class="menu_button menu_button_icon"><i class="fa-solid fa-check-double"></i>全选</button>
        <button id="tm-bg-batch-delete-btn" class="menu_button menu_button_icon" disabled><i class="fa-solid fa-trash-can"></i>删除选中</button>
        <span class="tm-bg-count"></span>
    `;
    // 插入到 #bg_tabs 之前
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

    // 给所有 .bg_example 添加 checkbox
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

    // 初始注入
    const bgMenuContent = document.getElementById('bg_menu_content');
    const bgCustomContent = document.getElementById('bg_custom_content');
    injectCheckboxes(bgMenuContent);
    injectCheckboxes(bgCustomContent);

    // 监听背景列表变化，自动注入 checkbox 并在执行前防抖 (Debounce)
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

    // --- 切换批量模式 ---
    batchToggleBtn.addEventListener('click', () => {
        isBatchMode = !isBatchMode;
        batchToggleBtn.classList.toggle('active', isBatchMode);

        // 给 bg_menu_content 和 bg_custom_content 的父容器添加模式 class
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

    // --- 全选 ---
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

    // --- 批量删除 ---
    deleteBtn.addEventListener('click', async () => {
        if (selectedBgs.size === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedBgs.size} 个背景图吗？此操作不可撤销。`)) return;

        showLoader();
        const headers = typeof getRequestHeaders === 'function' ? getRequestHeaders() : {};
        const bgsToDelete = Array.from(selectedBgs);

        // 并发发送 API 请求 (限制并发为 5)
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

        // 批量从 DOM 中移除已删除的背景元素
        successfullyDeleted.forEach(bgFile => {
            const elements = document.querySelectorAll(`.bg_example[bgfile="${bgFile}"]`);
            elements.forEach(el => el.remove());
            selectedBgs.delete(bgFile);
        });

        hideLoader();

        let message = `删除完成！成功 ${successCount} 个`;
        if (errorCount > 0) {
            message += `，失败 ${errorCount} 个。`;
            if (typeof toastr !== 'undefined') toastr.warning(message);
        } else {
            message += '。';
            if (typeof toastr !== 'undefined') toastr.success(message);
        }

        updateCount();
    });
}
