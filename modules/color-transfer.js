/**
 * color-transfer.js
 * 提取配色方案模态框与智能推荐算法
 */

import { state } from './state.js';
import { loadThemeTags } from './tags-core.js';
import { isThemeMatchingSearch } from './utils.js';
import { saveTheme, updateSTThemeMemory, syncCustomCssToST, showLoader, hideLoader } from './api.js';
import { applyThemeColors } from './theme-apply.js';

let _colorTransferTargetTheme = null;

export function extractThemeBaseName(name) {
    if (!name) return '';
    let base = name;
    base = base.replace(/by\s*.*$/i, '');
    base = base.replace(/v\d+(\.\d+)?/gi, '');
    const modifierRegex = /(深色|浅色|暗色|亮色|黑色|白色|红色|蓝色|绿色|黄色|粉色|紫色|灰色|米色|棕色|金|银|莫兰迪|莫兰迪米|莫兰迪暗|Dark|Light|Black|White|Red|Blue|Green|Yellow|Pink|Purple|Grey|Gray|Beige|Night|Day|版|模式|配色|主题|美化|[·・\-_s])/gi;
    base = base.replace(modifierRegex, '').trim();
    return base.toLowerCase();
}

export function getSmartRecommendedThemes(targetThemeName, allThemes) {
    const targetBase = extractThemeBaseName(targetThemeName);
    const recommendations = [];

    allThemes.forEach(t => {
        if (t.value === targetThemeName) return;
        const sourceBase = extractThemeBaseName(t.value);

        let isRecommended = false;
        let score = 0;

        if (targetBase && sourceBase) {
            if (targetBase === sourceBase) {
                isRecommended = true;
                score = 100;
            } else if (targetBase.length >= 2 && sourceBase.includes(targetBase)) {
                isRecommended = true;
                score = 80;
            } else if (sourceBase.length >= 2 && targetBase.includes(sourceBase)) {
                isRecommended = true;
                score = 70;
            }
        }

        if (!isRecommended && targetThemeName.length >= 3 && t.value.length >= 3) {
            const prefixTarget = targetThemeName.slice(0, 3).toLowerCase();
            const prefixSource = t.value.slice(0, 3).toLowerCase();
            if (prefixTarget === prefixSource) {
                isRecommended = true;
                score = 50;
            }
        }

        if (isRecommended) {
            recommendations.push({ theme: t, score });
        }
    });

    recommendations.sort((a, b) => b.score - a.score);
    return recommendations.map(r => r.theme);
}

export function closeColorTransferModal() {
    const modal = document.querySelector('#tm-color-transfer-modal');
    if (modal) modal.style.display = 'none';
    _colorTransferTargetTheme = null;
}

export async function transferThemeColors(sourceName, targetName) {
    const sourceObj = state.allThemeObjectsMap.get(sourceName);
    const targetObj = state.allThemeObjectsMap.get(targetName);
    if (!sourceObj || !targetObj) {
        toastr.error('获取美化主题数据失败！');
        return;
    }

    showLoader();
    try {
        const colorKeys = [
            'main_text_color', 'italics_text_color', 'underline_text_color', 'quote_text_color',
            'blur_tint_color', 'chat_tint_color', 'user_mes_blur_tint_color', 'bot_mes_blur_tint_color',
            'shadow_color', 'border_color', 'blur_strength', 'shadow_width', 'font_scale', 'chat_width'
        ];

        colorKeys.forEach(key => {
            if (sourceObj[key] !== undefined) {
                targetObj[key] = sourceObj[key];
            }
        });

        await saveTheme(targetObj);
        updateSTThemeMemory(targetObj, 'add');
        state.allThemeObjectsMap.set(targetName, targetObj);

        const originalSelect = document.querySelector('#themes');
        if (originalSelect && originalSelect.value === targetName) {
            applyThemeColors(targetObj);
            syncCustomCssToST(targetObj.custom_css);
        }

        toastr.success(`已成功从「${sourceName}」提取配色应用至「${targetName}」！`);
    } catch (err) {
        console.error('[Theme Manager Error] 提取配色应用失败:', err);
        toastr.error('配色应用失败，请检查控制台。');
    } finally {
        hideLoader();
    }
}

export function getOrBuildColorTransferModal() {
    let modal = document.querySelector('#tm-color-transfer-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'tm-color-transfer-modal';
        modal.className = 'tm-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="tm-modal-content" style="max-width: 440px;">
                <div class="tm-modal-header">
                    <h3><i class="fa-solid fa-palette"></i> 提取配色方案</h3>
                    <button id="close-color-transfer-modal" class="tm-modal-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="tm-modal-body">
                    <div style="margin-bottom: 12px; font-size: 13px;">
                        <strong>目标美化:</strong> <span id="color-transfer-target-name" style="color: var(--SmartThemeQuoteColor, #4a90e2); font-weight: bold;"></span>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 12px;"><strong>选择来源美化 (提取其颜色配置):</strong></label>
                        <div style="position: relative; margin-bottom: 8px;">
                            <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.5; font-size: 12px; pointer-events: none;"></i>
                            <input type="search" id="color-transfer-search-input" class="text_pole" placeholder="搜索来源美化名称..." style="width: 100%; height: 32px; padding-left: 30px; font-size: 12px; box-sizing: border-box; margin: 0;">
                        </div>
                        <select id="color-transfer-source-select" class="text_pole" size="8" style="width: 100%; height: 200px; font-size: 12px; margin: 0; padding: 4px; box-sizing: border-box;"></select>
                    </div>
                </div>
                <div class="tm-modal-footer" style="display:flex; justify-content:flex-end; gap:8px; padding-top:10px;">
                    <button id="cancel-color-transfer-btn" class="menu_button" style="margin:0;">取消</button>
                    <button id="confirm-color-transfer-btn" class="menu_button menu_button_icon primary" style="background: var(--SmartThemeQuoteColor, #4a90e2) !important; color: #fff !important; margin:0;"><i class="fa-solid fa-check"></i> 确认覆盖配色</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelector('#close-color-transfer-modal').addEventListener('click', closeColorTransferModal);
        modal.querySelector('#cancel-color-transfer-btn').addEventListener('click', closeColorTransferModal);
        modal.querySelector('#confirm-color-transfer-btn').addEventListener('click', async () => {
            if (!_colorTransferTargetTheme) return;
            const sourceSelect = modal.querySelector('#color-transfer-source-select');
            const sourceThemeName = sourceSelect ? sourceSelect.value : '';
            if (!sourceThemeName) {
                toastr.warning('请先选择一个来源美化！');
                return;
            }
            const targetThemeName = _colorTransferTargetTheme;
            closeColorTransferModal();
            await transferThemeColors(sourceThemeName, targetThemeName);
        });
    }
    return modal;
}

export function openColorTransferModal(targetThemeName) {
    _colorTransferTargetTheme = targetThemeName;
    const modal = getOrBuildColorTransferModal();
    const targetNameSpan = modal.querySelector('#color-transfer-target-name');
    const sourceSelect = modal.querySelector('#color-transfer-source-select');
    const searchInput = modal.querySelector('#color-transfer-search-input');

    if (targetNameSpan) targetNameSpan.textContent = targetThemeName;
    if (searchInput) searchInput.value = '';

    const otherThemes = state.allParsedThemes.filter(t => t.value !== targetThemeName);
    const recommendedThemes = getSmartRecommendedThemes(targetThemeName, otherThemes);
    const recommendedSet = new Set(recommendedThemes.map(t => t.value));

    const cachedTags = loadThemeTags();
    const tagMap = new Map();
    cachedTags.forEach(tag => {
        tagMap.set(tag.id, { name: tag.name, themes: [] });
    });

    const unclassifiedThemes = [];

    otherThemes.forEach(t => {
        if (recommendedSet.has(t.value)) return;

        if (t.tags && t.tags.length > 0) {
            let added = false;
            t.tags.forEach(tagId => {
                const group = tagMap.get(tagId);
                if (group) {
                    group.themes.push(t);
                    added = true;
                }
            });
            if (!added) unclassifiedThemes.push(t);
        } else {
            unclassifiedThemes.push(t);
        }
    });

    function renderSourceSelectOptions(filterKeyword = '') {
        if (!sourceSelect) return;
        sourceSelect.innerHTML = '';
        let firstSelectableOption = null;

        const addGroup = (groupTitle, themes, isRecommend = false) => {
            const cachedTags = loadThemeTags();
            const tagsMap = new Map(cachedTags.map(t => [t.id, t]));
            const matched = themes.filter(t => isThemeMatchingSearch(t, filterKeyword, tagsMap));
            if (matched.length === 0) return;

            const groupEl = document.createElement('optgroup');
            groupEl.label = groupTitle;

            matched.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.value;
                opt.textContent = isRecommend ? `${t.display} (智能推荐)` : t.display;
                groupEl.appendChild(opt);
                if (!firstSelectableOption) {
                    firstSelectableOption = opt;
                }
            });

            sourceSelect.appendChild(groupEl);
        };

        if (recommendedThemes.length > 0) {
            addGroup('智能推荐 (同系列美化)', recommendedThemes, true);
        }

        cachedTags.forEach(tag => {
            const groupData = tagMap.get(tag.id);
            if (groupData && groupData.themes.length > 0) {
                addGroup(`标签: ${groupData.name}`, groupData.themes);
            }
        });

        if (unclassifiedThemes.length > 0) {
            addGroup('未分类美化', unclassifiedThemes);
        }

        if (firstSelectableOption) {
            firstSelectableOption.selected = true;
        }
    }

    renderSourceSelectOptions();

    if (searchInput) {
        searchInput.oninput = (e) => {
            renderSourceSelectOptions(e.target.value);
        };
    }

    modal.style.display = 'flex';
}
