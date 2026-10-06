// modules/auto-theme.js
// 日夜自动切换、定时任务、日夜独立配对与设置弹窗模块

export function initAutoTheme(options) {
    const {
        AUTO_THEME_KEY,
        THEME_DAY_NIGHT_PAIRS_KEY,
        managerPanel,
        originalSelect,
        allParsedThemes,
        themeItemMap,
        loadThemeTags,
        getThemeForTarget,
        applyThemeDirect,
        applyBackgroundDirectly,
        themeBackgroundBindings,
        escapeHtml
    } = options;

    let currentAutoThemeState = null;
    let autoThemeCheckInterval = null;
    let currentTargetThemeForPair = null;

    let autoThemeSettings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {
        enabled: false,
        enableManualToggle: false,
        mode: 'system',
        dayStart: '06:00',
        nightStart: '18:00',
        dayTarget: '',
        nightTarget: ''
    };

    let themeDayNightPairs = loadThemeDayNightPairs();

    function loadThemeDayNightPairs() {
        try {
            const raw = JSON.parse(localStorage.getItem(THEME_DAY_NIGHT_PAIRS_KEY));
            if (Array.isArray(raw)) {
                return raw.filter(p => p && (p.dayTheme || p.nightTheme));
            }
            if (raw && typeof raw === 'object') {
                // 兼容性迁移：将旧版字典模式自动平滑迁移为统一日夜组数组模式
                const list = [];
                const processed = new Set();
                Object.keys(raw).forEach(k => {
                    const targetNight = raw[k]?.nightTarget;
                    const targetDay = raw[k]?.dayTarget;
                    if (targetNight && !processed.has(`${k}-${targetNight}`)) {
                        list.push({ dayTheme: k, nightTheme: targetNight });
                        processed.add(`${k}-${targetNight}`);
                        processed.add(`${targetNight}-${k}`);
                    }
                    if (targetDay && !processed.has(`${targetDay}-${k}`)) {
                        list.push({ dayTheme: targetDay, nightTheme: k });
                        processed.add(`${targetDay}-${k}`);
                        processed.add(`${k}-${targetDay}`);
                    }
                });
                localStorage.setItem(THEME_DAY_NIGHT_PAIRS_KEY, JSON.stringify(list));
                return list;
            }
        } catch (e) {}
        return [];
    }

    function saveThemeDayNightPairs(pairs) {
        themeDayNightPairs = pairs;
        localStorage.setItem(THEME_DAY_NIGHT_PAIRS_KEY, JSON.stringify(themeDayNightPairs));
    }

    function getPairForTheme(themeName) {
        if (!themeName || !Array.isArray(themeDayNightPairs)) return null;
        return themeDayNightPairs.find(p => p && (p.dayTheme === themeName || p.nightTheme === themeName)) || null;
    }

    function executeManualThemeToggle() {
        const currentTheme = originalSelect.value;
        const pair = getPairForTheme(currentTheme);
        let target = null;
        let nextState = 'night';

        if (pair && (pair.dayTheme || pair.nightTheme)) {
            if (currentTheme === pair.dayTheme) {
                nextState = 'night';
                target = pair.nightTheme || pair.dayTheme;
            } else if (currentTheme === pair.nightTheme) {
                nextState = 'day';
                target = pair.dayTheme || pair.nightTheme;
            } else {
                nextState = (currentAutoThemeState === 'day') ? 'night' : 'day';
                target = nextState === 'night' ? (pair.nightTheme || pair.dayTheme) : (pair.dayTheme || pair.nightTheme);
            }
        } else {
            const globalDayTheme = typeof getThemeForTarget === 'function' ? getThemeForTarget(autoThemeSettings.dayTarget) : autoThemeSettings.dayTarget;
            const globalNightTheme = typeof getThemeForTarget === 'function' ? getThemeForTarget(autoThemeSettings.nightTarget) : autoThemeSettings.nightTarget;

            if (currentTheme === globalDayTheme) {
                nextState = 'night';
                target = autoThemeSettings.nightTarget;
            } else if (currentTheme === globalNightTheme) {
                nextState = 'day';
                target = autoThemeSettings.dayTarget;
            } else {
                nextState = (currentAutoThemeState === 'day') ? 'night' : 'day';
                target = nextState === 'day' ? autoThemeSettings.dayTarget : autoThemeSettings.nightTarget;
            }
        }

        if (!target) {
            toastr.warning('未配置对应的日/夜间主题或全局目标。', '快捷切换');
            return;
        }

        const themeToApply = typeof getThemeForTarget === 'function' ? getThemeForTarget(target) : target;
        if (!themeToApply) {
            toastr.warning(`找不到目标主题: ${target}`, '快捷切换');
            return;
        }

        if (originalSelect.value !== themeToApply) {
            applyThemeDirect(themeToApply);
            toastr.success(`手动切换至 ${nextState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '快捷切换', { escapeHtml: false });
        } else {
            toastr.info(`当前已是 ${nextState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '快捷切换', { escapeHtml: false });
        }

        const boundBg = themeBackgroundBindings ? themeBackgroundBindings[themeToApply] : null;
        if (boundBg && typeof applyBackgroundDirectly === 'function') {
            applyBackgroundDirectly(boundBg);
        }

        currentAutoThemeState = nextState;
    }

    function getSystemThemeMode() {
        if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) {
            return 'night';
        }
        if (document.documentElement.classList.contains('light') || document.body.classList.contains('light')) {
            return 'day';
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'night';
        }
        return 'day';
    }

    function performAutoThemeSwitch(newState) {
        if (currentAutoThemeState === newState) return;

        let target = null;
        const currentTheme = originalSelect.value;
        const pair = getPairForTheme(currentTheme);
        if (pair) {
            if (newState === 'night') {
                target = pair.nightTheme || pair.dayTheme;
            } else if (newState === 'day') {
                target = pair.dayTheme || pair.nightTheme;
            }
        }

        if (!target) {
            target = newState === 'day' ? autoThemeSettings.dayTarget : autoThemeSettings.nightTarget;
        }

        const themeToApply = typeof getThemeForTarget === 'function' ? getThemeForTarget(target) : target;

        if (themeToApply) {
            const themeChanged = originalSelect.value !== themeToApply;
            if (themeChanged) {
                applyThemeDirect(themeToApply);
                toastr.info(`自动切换至 ${newState === 'day' ? '日间' : '夜间'} 主题: <b>${escapeHtml(themeToApply)}</b>`, '主题随动', { escapeHtml: false });
            }
            const boundBg = themeBackgroundBindings ? themeBackgroundBindings[themeToApply] : null;
            if (boundBg && typeof applyBackgroundDirectly === 'function') {
                applyBackgroundDirectly(boundBg);
            }
        }
        currentAutoThemeState = newState;
    }

    function checkAutoTheme() {
        if (!autoThemeSettings.enabled) return;

        let newState = null;
        if (autoThemeSettings.mode === 'system') {
            newState = getSystemThemeMode();
        } else if (autoThemeSettings.mode === 'time') {
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const [dayH, dayM] = (autoThemeSettings.dayStart || '06:00').split(':').map(Number);
            const [nightH, nightM] = (autoThemeSettings.nightStart || '18:00').split(':').map(Number);
            const dayTime = dayH * 60 + dayM;
            const nightTime = nightH * 60 + nightM;

            if (dayTime < nightTime) {
                newState = (currentTime >= dayTime && currentTime < nightTime) ? 'day' : 'night';
            } else {
                newState = (currentTime >= nightTime && currentTime < dayTime) ? 'night' : 'day';
            }
        }
        if (newState) performAutoThemeSwitch(newState);
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (autoThemeSettings.enabled && autoThemeSettings.mode === 'system') {
            currentAutoThemeState = null;
            performAutoThemeSwitch(e.matches ? 'night' : 'day');
        }
    });

    const setupTauriThemeListener = () => {
        const tauri = window.__TAURI__ || window.parent?.__TAURI__ || window.top?.__TAURI__;
        if (tauri && tauri.event && typeof tauri.event.listen === 'function') {
            try {
                tauri.event.listen('tauri://theme-changed', (event) => {
                    if (autoThemeSettings.enabled && autoThemeSettings.mode === 'system') {
                        const themePayload = typeof event.payload === 'string' ? event.payload : (event.payload?.theme || '');
                        const newState = themePayload.includes('dark') ? 'night' : 'day';
                        currentAutoThemeState = null;
                        performAutoThemeSwitch(newState);
                    }
                });
                console.log('[Theme Manager] 已成功注册 Tauri 原生主题监听事件 (tauri://theme-changed)');
            } catch (e) {
                console.warn('[Theme Manager] 注册 Tauri 主题监听事件失败:', e);
            }
        }
    };
    setupTauriThemeListener();

    window.addEventListener('focus', () => {
        if (autoThemeSettings.enabled) {
            checkAutoTheme();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && autoThemeSettings.enabled) {
            checkAutoTheme();
        }
    });

    function applyAutoThemeLoop() {
        if (autoThemeCheckInterval) clearInterval(autoThemeCheckInterval);
        if (autoThemeSettings.enabled) {
            checkAutoTheme();
            autoThemeCheckInterval = setInterval(checkAutoTheme, 60000);
        }
    }

    function updateManualToggleBtnVisibility() {
        const btn = managerPanel ? managerPanel.querySelector('#tm-quick-manual-toggle-btn') : null;
        if (btn) {
            btn.style.display = autoThemeSettings.enableManualToggle ? 'inline-flex' : 'none';
        }
    }

    function updateThemeItemDayNightState(themeName) {
        if (!themeItemMap) return;
        const item = themeItemMap.get(themeName);
        if (!item) return;
        const buttonsDiv = item.querySelector('.theme-item-buttons') || item.children[1];
        if (!buttonsDiv) return;
        const linkDaynightBtn = buttonsDiv.children[2];
        if (!linkDaynightBtn) return;
        const pair = getPairForTheme(themeName);
        if (pair) {
            linkDaynightBtn.classList.add('daynight-linked');
            const otherTheme = pair.dayTheme === themeName ? pair.nightTheme : pair.dayTheme;
            linkDaynightBtn.title = `已绑定日夜组合 (对应美化: ${otherTheme || '未指定'})`;
        } else {
            linkDaynightBtn.classList.remove('daynight-linked');
            linkDaynightBtn.title = '绑定日夜美化';
        }
    }

    // 日夜绑定配对模态框
    const daynightModal = managerPanel ? managerPanel.querySelector('#tm-daynight-pair-modal') : null;
    const closeTmDaynightBtn = daynightModal ? daynightModal.querySelector('#close-tm-daynight-modal') : null;
    const saveTmDaynightBtn = daynightModal ? daynightModal.querySelector('#save-tm-daynight-btn') : null;
    const clearTmDaynightBtn = daynightModal ? daynightModal.querySelector('#clear-tm-daynight-btn') : null;

    if (daynightModal && daynightModal.parentElement !== document.body) {
        daynightModal.style.display = 'none';
        document.body.appendChild(daynightModal);
    }

    function openDayNightPairModal(themeName) {
        currentTargetThemeForPair = themeName;
        if (!daynightModal) return;

        const titleSpan = daynightModal.querySelector('#tm-daynight-current-name');
        const nightSelect = daynightModal.querySelector('#tm-daynight-night-select');
        const daySelect = daynightModal.querySelector('#tm-daynight-day-select');

        if (titleSpan) titleSpan.textContent = themeName;

        if (window.jQuery && $(nightSelect).data('select2')) $(nightSelect).select2('destroy');
        if (window.jQuery && $(daySelect).data('select2')) $(daySelect).select2('destroy');

        let optionsHtml = '<option value="">(未指定/不关联)</option>';
        if (Array.isArray(allParsedThemes)) {
            allParsedThemes.forEach(t => {
                optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
            });
        }
        if (nightSelect) nightSelect.innerHTML = optionsHtml;
        if (daySelect) daySelect.innerHTML = optionsHtml;

        const existingPair = getPairForTheme(themeName);
        if (existingPair) {
            if (daySelect) daySelect.value = existingPair.dayTheme || '';
            if (nightSelect) nightSelect.value = existingPair.nightTheme || '';
        } else {
            const isNightName = /(深色|暗色|黑色|Dark|Night|黑)/i.test(themeName);
            if (isNightName) {
                if (nightSelect) nightSelect.value = themeName;
                if (daySelect) daySelect.value = '';
            } else {
                if (daySelect) daySelect.value = themeName;
                if (nightSelect) nightSelect.value = '';
            }
        }

        daynightModal.style.display = 'flex';

        if (window.jQuery) {
            setTimeout(() => {
                $([nightSelect, daySelect]).select2({
                    dropdownParent: $(daynightModal).find('.tm-modal-content'),
                    width: '100%'
                });
            }, 0);
        }
    }

    if (closeTmDaynightBtn) {
        closeTmDaynightBtn.addEventListener('click', () => {
            if (daynightModal) daynightModal.style.display = 'none';
        });
    }

    if (saveTmDaynightBtn) {
        saveTmDaynightBtn.addEventListener('click', () => {
            if (!currentTargetThemeForPair || !daynightModal) return;
            const nightVal = daynightModal.querySelector('#tm-daynight-night-select')?.value || '';
            const dayVal = daynightModal.querySelector('#tm-daynight-day-select')?.value || '';

            themeDayNightPairs = themeDayNightPairs.filter(p => {
                if (!p) return false;
                if (p.dayTheme === currentTargetThemeForPair || p.nightTheme === currentTargetThemeForPair) return false;
                if (dayVal && (p.dayTheme === dayVal || p.nightTheme === dayVal)) return false;
                if (nightVal && (p.dayTheme === nightVal || p.nightTheme === nightVal)) return false;
                return true;
            });

            if (dayVal || nightVal) {
                const finalDay = dayVal || currentTargetThemeForPair;
                const finalNight = nightVal || currentTargetThemeForPair;
                themeDayNightPairs.push({
                    dayTheme: finalDay,
                    nightTheme: finalNight
                });
            }

            saveThemeDayNightPairs(themeDayNightPairs);

            if (dayVal) updateThemeItemDayNightState(dayVal);
            if (nightVal) updateThemeItemDayNightState(nightVal);
            updateThemeItemDayNightState(currentTargetThemeForPair);

            toastr.success(`已更新美化日夜组合绑定！`);
            daynightModal.style.display = 'none';
        });
    }

    if (clearTmDaynightBtn) {
        clearTmDaynightBtn.addEventListener('click', () => {
            if (!currentTargetThemeForPair || !daynightModal) return;
            const pair = getPairForTheme(currentTargetThemeForPair);
            if (pair) {
                themeDayNightPairs = themeDayNightPairs.filter(p => p !== pair);
                saveThemeDayNightPairs(themeDayNightPairs);
                if (pair.dayTheme) updateThemeItemDayNightState(pair.dayTheme);
                if (pair.nightTheme) updateThemeItemDayNightState(pair.nightTheme);
                toastr.info(`已解除该美化的日夜组合关联。`);
            }
            daynightModal.style.display = 'none';
        });
    }

    // 自动切换设置模态框
    const autoThemeBtn = managerPanel ? managerPanel.querySelector('#auto-theme-settings-btn') : null;
    const autoThemeModal = managerPanel ? managerPanel.querySelector('#auto-theme-modal') : null;
    const closeAutoThemeModalBtn = autoThemeModal ? autoThemeModal.querySelector('#close-auto-theme-modal') : null;
    const saveAutoThemeBtn = autoThemeModal ? autoThemeModal.querySelector('#save-auto-theme-btn') : null;

    if (autoThemeModal && autoThemeModal.parentElement !== document.body) {
        autoThemeModal.style.display = 'none';
        document.body.appendChild(autoThemeModal);
    }

    function populateAutoThemePairsList() {
        if (!autoThemeModal) return;
        const pairsContainer = autoThemeModal.querySelector('#tm-pairs-list-container');
        if (!pairsContainer) return;

        if (!Array.isArray(themeDayNightPairs) || themeDayNightPairs.length === 0) {
            pairsContainer.innerHTML = '<div style="opacity:0.7; font-style:italic; text-align:center; padding:10px;">暂无独立日夜组（可在各个美化卡片上点击 <i class="fa-solid fa-circle-half-stroke"></i> 进行关联绑定）</div>';
            return;
        }

        let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
        themeDayNightPairs.forEach((pair, index) => {
            html += `<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
                <div style="font-size:12px;">
                    <span style="color:#fadb14;"><i class="fa-solid fa-sun"></i> ${escapeHtml(pair.dayTheme || '未指定')}</span>
                    <span style="margin: 0 8px; opacity:0.7;">⇄</span>
                    <span style="color:#fa8c16;"><i class="fa-solid fa-moon"></i> ${escapeHtml(pair.nightTheme || '未指定')}</span>
                </div>
                <button class="tm-remove-pair-btn menu_button" data-index="${index}" style="padding:1px 6px; font-size:11px; margin:0; width:auto;"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        });
        html += '</div>';
        pairsContainer.innerHTML = html;

        pairsContainer.querySelectorAll('.tm-remove-pair-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                if (!isNaN(idx) && themeDayNightPairs[idx]) {
                    const removed = themeDayNightPairs.splice(idx, 1)[0];
                    saveThemeDayNightPairs(themeDayNightPairs);
                    if (removed?.dayTheme) updateThemeItemDayNightState(removed.dayTheme);
                    if (removed?.nightTheme) updateThemeItemDayNightState(removed.nightTheme);
                    populateAutoThemePairsList();
                }
            });
        });
    }

    function populateAutoThemeDropdowns() {
        if (!autoThemeModal) return;
        const dayTarget = autoThemeModal.querySelector('#auto-theme-day-target');
        const nightTarget = autoThemeModal.querySelector('#auto-theme-night-target');
        const tags = typeof loadThemeTags === 'function' ? loadThemeTags() : [];

        if (!dayTarget || !nightTarget) return;

        if (window.jQuery && $(dayTarget).data('select2')) $(dayTarget).select2('destroy');
        if (window.jQuery && $(nightTarget).data('select2')) $(nightTarget).select2('destroy');

        let optionsHtml = '<option value="">(不改变)</option>';
        if (tags.length > 0) {
            optionsHtml += '<optgroup label="[随机] 从标签中选择">';
            tags.forEach(t => {
                optionsHtml += `<option value="[Tag] ${t.id}">随机标签: ${escapeHtml(t.name)}</option>`;
            });
            optionsHtml += '</optgroup>';
        }
        optionsHtml += '<optgroup label="[指定] 特定主题">';
        if (Array.isArray(allParsedThemes)) {
            allParsedThemes.forEach(t => {
                optionsHtml += `<option value="${escapeHtml(t.value)}">${escapeHtml(t.display)}</option>`;
            });
        }
        optionsHtml += '</optgroup>';

        dayTarget.innerHTML = optionsHtml;
        nightTarget.innerHTML = optionsHtml;
        dayTarget.value = autoThemeSettings.dayTarget;
        nightTarget.value = autoThemeSettings.nightTarget;

        populateAutoThemePairsList();

        if (window.jQuery) {
            setTimeout(() => {
                $([dayTarget, nightTarget]).select2({
                    dropdownParent: $(autoThemeModal).find('.tm-modal-content'),
                    width: '100%'
                });
            }, 0);
        }
    }

    if (autoThemeBtn && autoThemeModal) {
        autoThemeBtn.addEventListener('click', () => {
            const enableChk = autoThemeModal.querySelector('#auto-theme-enable');
            const manualChk = autoThemeModal.querySelector('#auto-theme-enable-manual');
            const modeRadio = autoThemeModal.querySelector(`input[name="auto-theme-mode"][value="${autoThemeSettings.mode}"]`);
            const dayStartInput = autoThemeModal.querySelector('#auto-theme-day-start');
            const nightStartInput = autoThemeModal.querySelector('#auto-theme-night-start');
            const timeSettings = autoThemeModal.querySelector('#auto-theme-time-settings');

            if (enableChk) enableChk.checked = autoThemeSettings.enabled;
            if (manualChk) manualChk.checked = !!autoThemeSettings.enableManualToggle;
            if (modeRadio) modeRadio.checked = true;
            if (dayStartInput) dayStartInput.value = autoThemeSettings.dayStart;
            if (nightStartInput) nightStartInput.value = autoThemeSettings.nightStart;
            if (timeSettings) timeSettings.style.display = autoThemeSettings.mode === 'time' ? 'block' : 'none';

            populateAutoThemeDropdowns();
            autoThemeModal.style.display = 'flex';
        });

        autoThemeModal.querySelectorAll('input[name="auto-theme-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const timeSettings = autoThemeModal.querySelector('#auto-theme-time-settings');
                if (timeSettings) timeSettings.style.display = e.target.value === 'time' ? 'block' : 'none';
            });
        });
    }

    if (closeAutoThemeModalBtn) {
        closeAutoThemeModalBtn.addEventListener('click', () => {
            if (autoThemeModal) autoThemeModal.style.display = 'none';
        });
    }

    if (saveAutoThemeBtn && autoThemeModal) {
        saveAutoThemeBtn.addEventListener('click', () => {
            const enableChk = autoThemeModal.querySelector('#auto-theme-enable');
            const manualChk = autoThemeModal.querySelector('#auto-theme-enable-manual');
            const modeRadio = autoThemeModal.querySelector('input[name="auto-theme-mode"]:checked');
            const dayStartInput = autoThemeModal.querySelector('#auto-theme-day-start');
            const nightStartInput = autoThemeModal.querySelector('#auto-theme-night-start');
            const dayTargetSelect = autoThemeModal.querySelector('#auto-theme-day-target');
            const nightTargetSelect = autoThemeModal.querySelector('#auto-theme-night-target');

            autoThemeSettings.enabled = enableChk ? enableChk.checked : false;
            autoThemeSettings.enableManualToggle = manualChk ? manualChk.checked : false;
            autoThemeSettings.mode = modeRadio ? modeRadio.value : 'system';
            autoThemeSettings.dayStart = dayStartInput ? dayStartInput.value || '06:00' : '06:00';
            autoThemeSettings.nightStart = nightStartInput ? nightStartInput.value || '18:00' : '18:00';
            autoThemeSettings.dayTarget = dayTargetSelect ? dayTargetSelect.value : '';
            autoThemeSettings.nightTarget = nightTargetSelect ? nightTargetSelect.value : '';

            localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(autoThemeSettings));
            updateManualToggleBtnVisibility();
            toastr.success('自动切换主题设置已保存！');
            autoThemeModal.style.display = 'none';

            currentAutoThemeState = null;
            applyAutoThemeLoop();
        });
    }

    // 重命名与删除的主题联动清理助手
    function handleThemeRenamed(oldName, finalNewName) {
        let settings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {};
        let autoThemeChanged = false;
        if (settings.dayTarget === oldName) {
            settings.dayTarget = finalNewName;
            autoThemeChanged = true;
        }
        if (settings.nightTarget === oldName) {
            settings.nightTarget = finalNewName;
            autoThemeChanged = true;
        }
        if (autoThemeChanged) {
            autoThemeSettings = { ...autoThemeSettings, ...settings };
            localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(settings));
        }

        if (Array.isArray(themeDayNightPairs)) {
            let pairsChanged = false;
            themeDayNightPairs.forEach(p => {
                if (p.dayTheme === oldName) { p.dayTheme = finalNewName; pairsChanged = true; }
                if (p.nightTheme === oldName) { p.nightTheme = finalNewName; pairsChanged = true; }
            });
            if (pairsChanged) saveThemeDayNightPairs(themeDayNightPairs);
        }
    }

    function handleThemeDeleted(deletedName) {
        let settings = JSON.parse(localStorage.getItem(AUTO_THEME_KEY)) || {};
        let autoThemeChanged = false;
        if (settings.dayTarget === deletedName) {
            settings.dayTarget = '';
            autoThemeChanged = true;
        }
        if (settings.nightTarget === deletedName) {
            settings.nightTarget = '';
            autoThemeChanged = true;
        }
        if (autoThemeChanged) {
            autoThemeSettings = { ...autoThemeSettings, ...settings };
            localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(settings));
        }

        if (Array.isArray(themeDayNightPairs)) {
            themeDayNightPairs = themeDayNightPairs.filter(p => p && p.dayTheme !== deletedName && p.nightTheme !== deletedName);
            saveThemeDayNightPairs(themeDayNightPairs);
        }
    }

    // 初始化时同步快速切换按钮可见性
    updateManualToggleBtnVisibility();

    return {
        getAutoThemeSettings: () => autoThemeSettings,
        getThemeDayNightPairs: () => themeDayNightPairs,
        loadThemeDayNightPairs,
        saveThemeDayNightPairs,
        getPairForTheme,
        executeManualThemeToggle,
        applyAutoThemeLoop,
        updateManualToggleBtnVisibility,
        updateThemeItemDayNightState,
        openDayNightPairModal,
        handleThemeRenamed,
        handleThemeDeleted
    };
}
