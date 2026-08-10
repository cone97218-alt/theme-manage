/**
 * auto-group.js
 * 智能美化分组向导、候选算法提取、逐个审核与全景矩阵
 */

import { state, ctx } from './state.js';
import { escapeHtml } from './utils.js';
import { loadThemeTags, saveThemeTags } from './tags-core.js';
import { renderTagsUI } from './tags-ui.js';
import { softRefreshUI, updateActiveState } from './theme-ui.js';
import { isTextMatchingCompositeSearch } from './search-filter.js';

export const AUTO_GROUP_STOPWORDS = new Set([
    'json', 'theme', 'themes', 'preset', 'presets', 'copy', 'new', 'fixed', 'final',
    '360px', '1080p', '720p', 'v1', 'v2', 'v3', 'v4', 'v5', 'v1.0', 'v2.0', 'v3.0',
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
    'mode', 'ui', 'dark', 'light', 'st', 'sillytavern', 'main', 'card', 'style', 'test', 'demo',
    '美化', '主题', '预设', '整合', '重置', '修改', '修复', '最终', '完整', '通用', '版本', '备份', '副本', '版', '新'
]);

export function extractCandidateThemeGroups(themePool, minMatch = 2, targetLevel = 'l1', parentId = null, maxCandidates = 200) {
    const list = themePool || state.allParsedThemes || [];
    const candidateMap = new Map();

    const existingTags = loadThemeTags();
    const existingTagNamesAtLevel = new Set(
        existingTags
            .filter(t => (targetLevel === 'l2' ? t.parentId === parentId : (!t.parentId || !existingTags.some(p => p.id === t.parentId))))
            .map(t => t.name.trim().toLowerCase())
    );

    function sanitizeThemeTitle(rawName) {
        if (!rawName) return '';
        return rawName
            .replace(/[\[\]【】（）()《》<>\{\}]/g, ' ')
            .replace(/\bv?\d+(\.\d+)*\b/gi, ' ')
            .replace(/[_\-\+\/\\]+/g, ' ')
            .trim();
    }

    list.forEach(t => {
        const name = t.display || t.value;
        if (!name) return;

        let match;
        const bRegex = /[\[【（(《<](.+?)[\]】）)》>]/g;
        while ((match = bRegex.exec(name)) !== null) {
            const kw = match[1].replace(/\bv?\d+(\.\d+)*\b/gi, '').trim();
            const kwLower = kw.toLowerCase();
            if (kw.length >= 1 && kw.length <= 20 && !AUTO_GROUP_STOPWORDS.has(kwLower) && !existingTagNamesAtLevel.has(kwLower)) {
                if (!candidateMap.has(kw)) candidateMap.set(kw, new Set());
                candidateMap.get(kw).add(t.value);
            }
        }
    });

    list.forEach(t => {
        const name = t.display || t.value;
        if (!name) return;

        const sanitized = sanitizeThemeTitle(name);
        const tokens = sanitized.split(/\s+/).filter(Boolean);

        tokens.forEach(token => {
            const tokenLower = token.toLowerCase();
            if (token.length >= 2 && token.length <= 15) {
                if (!/^\d+$/.test(token) && !AUTO_GROUP_STOPWORDS.has(tokenLower) && !existingTagNamesAtLevel.has(tokenLower)) {
                    if (!candidateMap.has(token)) candidateMap.set(token, new Set());
                    candidateMap.get(token).add(t.value);
                }
            }
        });
    });

    list.forEach(t => {
        const name = t.display || t.value;
        if (!name) return;

        const numMatches = name.match(/\b\d{3,8}\b/g);
        if (numMatches) {
            numMatches.forEach(numStr => {
                if (!AUTO_GROUP_STOPWORDS.has(numStr) && !existingTagNamesAtLevel.has(numStr)) {
                    if (!candidateMap.has(numStr)) candidateMap.set(numStr, new Set());
                    candidateMap.get(numStr).add(t.value);
                }
            });
        }
    });

    const nGramMap = new Map();

    list.forEach(t => {
        const name = t.display || t.value;
        if (!name) return;

        const cleanedStr = name
            .replace(/[\[\]【】（）()《》<>{}\-_+/\s]/g, '')
            .replace(/\d+/g, '');

        if (!cleanedStr) return;

        const maxGram = Math.min(6, cleanedStr.length);
        for (let len = 2; len <= maxGram; len++) {
            for (let i = 0; i <= cleanedStr.length - len; i++) {
                const subStr = cleanedStr.substring(i, i + len).trim();
                const subLower = subStr.toLowerCase();

                if (subStr.length >= 2 && !AUTO_GROUP_STOPWORDS.has(subLower) && !existingTagNamesAtLevel.has(subLower)) {
                    if (!nGramMap.has(subStr)) nGramMap.set(subStr, new Set());
                    nGramMap.get(subStr).add(t.value);
                }
            }
        }
    });

    nGramMap.forEach((themesSet, subStr) => {
        if (themesSet.size >= minMatch) {
            const subLower = subStr.toLowerCase();
            const fullMatchedSet = new Set();

            list.forEach(t => {
                const titleLower = (t.display || t.value).toLowerCase();
                if (titleLower.includes(subLower)) {
                    fullMatchedSet.add(t.value);
                }
            });

            if (fullMatchedSet.size >= minMatch) {
                if (!candidateMap.has(subStr)) {
                    candidateMap.set(subStr, fullMatchedSet);
                } else {
                    const existingSet = candidateMap.get(subStr);
                    fullMatchedSet.forEach(val => existingSet.add(val));
                }
            }
        }
    });

    let candidateList = [];
    candidateMap.forEach((themesSet, kw) => {
        if (themesSet.size >= minMatch) {
            candidateList.push({
                keyword: kw,
                themes: Array.from(themesSet)
            });
        }
    });

    candidateList.sort((a, b) => b.keyword.length - a.keyword.length);

    const finalCandidates = [];

    for (const item of candidateList) {
        const kwLower = item.keyword.toLowerCase();

        const isChildOfExistingLonger = finalCandidates.some(longer => {
            const longerKwLower = longer.keyword.toLowerCase();
            if (longerKwLower.includes(kwLower)) {
                const itemSet = new Set(item.themes);
                const overlap = longer.themes.filter(t => itemSet.has(t)).length;
                if (overlap / longer.themes.length >= 0.7) {
                    return true;
                }
            }
            return false;
        });

        if (!isChildOfExistingLonger) {
            finalCandidates.push(item);
        }
    }

    const jaccardDeduped = [];
    for (const item of finalCandidates) {
        const isDuplicate = jaccardDeduped.some(existing => {
            const existingSet = new Set(existing.themes);
            const intersection = item.themes.filter(t => existingSet.has(t)).length;
            const union = new Set([...item.themes, ...existing.themes]).size;
            if (union === 0) return false;
            const jaccard = intersection / union;
            if (jaccard >= 0.75) {
                if (existing.keyword.length < item.keyword.length) {
                    existing.keyword = item.keyword;
                }
                return true;
            }
            return false;
        });
        if (!isDuplicate) jaccardDeduped.push(item);
    }

    const coveredByPrev = new Set();
    jaccardDeduped.sort((a, b) => b.themes.length - a.themes.length);
    jaccardDeduped.forEach(item => {
        const newCount = item.themes.filter(t => !coveredByPrev.has(t)).length;
        item._valueScore = newCount + item.themes.length * 0.1;
        item.themes.forEach(t => coveredByPrev.add(t));
    });
    jaccardDeduped.sort((a, b) => b._valueScore - a._valueScore);

    if (maxCandidates && maxCandidates > 0 && isFinite(maxCandidates)) {
        return jaccardDeduped.slice(0, maxCandidates);
    }
    return jaccardDeduped;
}

export async function openAutoGroupBatchMatrix(candidates, level, parentId) {
    if (!candidates || candidates.length === 0) {
        toastr.info('没有候选分组可供审核。');
        return;
    }

    const totalThemesCount = new Set(candidates.flatMap(c => c.themes)).size;

    const matrixHtml = `
        <div class="tm-matrix-container">
            <div class="tm-matrix-header">
                <div style="display:flex; align-items:center; gap:8px; flex:1; flex-wrap:wrap;">
                    <label style="cursor:pointer; font-size:12px; display:inline-flex; align-items:center; gap:4px; margin:0;">
                        <input type="checkbox" id="matrix-select-all-chk" checked style="margin:0;">
                        <span>全选 / 取消</span>
                    </label>
                    <input type="search" id="matrix-search-box" class="text_pole" placeholder="搜索候选分组或美化..." style="font-size:12px; height:26px; padding:2px 8px; width:160px; margin:0; flex:1; min-width:100px;">
                    <select id="matrix-sort-select" class="text_pole" style="font-size:12px; height:26px; padding:2px 6px; width:130px; margin:0;">
                        <option value="value">按价值评分↓</option>
                        <option value="count-desc">美化数量 多→少</option>
                        <option value="count-asc">美化数量 少→多</option>
                        <option value="name-asc">名称 A→Z</option>
                    </select>
                    <button id="matrix-merge-btn" class="menu_button" style="font-size:11px; padding:2px 8px; margin:0; height:26px; min-height:26px; white-space:nowrap; background:rgba(74,144,226,0.2) !important;" title="将选中的多个候选词合并为一个标签"><i class="fa-solid fa-object-group"></i> 合并选中</button>
                </div>
                <div id="matrix-stats-summary" style="font-size:12px; opacity:0.85; white-space:nowrap;">
                    已选中 <b><span id="matrix-selected-count">${candidates.length}</span></b> / ${candidates.length} 个分组 (涉及 <b>${totalThemesCount}</b> 个美化)
                </div>
            </div>

            <div id="tm-matrix-list" class="tm-matrix-list">
                ${candidates.map((c, idx) => `
                    <div class="tm-matrix-card" data-idx="${idx}">
                        <div class="tm-matrix-card-header">
                            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                                <input type="checkbox" class="matrix-group-chk" data-idx="${idx}" checked style="margin:0; flex-shrink:0;">
                                <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap; flex-shrink:0; margin:0;">
                                    <i class="fa-solid fa-tag" style="color:#ffc107;"></i>
                                </label>
                                <input type="text" class="matrix-tag-name-input text_pole" data-idx="${idx}" value="${escapeHtml(c.keyword)}" style="flex:1; min-width:100px; max-width:260px; height:28px; padding:2px 8px; font-size:12.5px; margin:0;">
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                                <span style="font-size:11.5px; opacity:0.75; white-space:nowrap;">
                                    <i class="fa-solid fa-layer-group" style="margin-right:3px;"></i>${c.themes.length}个美化
                                </span>
                                <button class="menu_button matrix-toggle-themes-btn" data-idx="${idx}" style="font-size:11px; padding:2px 8px; margin:0; height:24px; min-height:24px; white-space:nowrap;" title="查看/编辑关联的美化"><i class="fa-solid fa-chevron-down"></i> 明细</button>
                                <button class="menu_button matrix-remove-card-btn" data-idx="${idx}" style="font-size:11px; padding:2px 6px; margin:0; height:24px; min-height:24px; background:rgba(220,53,69,0.2) !important; color:#ff8888 !important; white-space:nowrap;" title="移除此分组"><i class="fa-solid fa-trash-can"></i></button>
                            </div>
                        </div>
                        <div id="matrix-themes-wrapper-${idx}" class="tm-matrix-themes-wrapper">
                            <div style="font-size:11px; opacity:0.75; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; white-space:nowrap;">
                                <span>勾选加入的美化 (${c.themes.length}):</span>
                                <label style="cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0;">
                                    <input type="checkbox" class="matrix-sub-select-all" data-idx="${idx}" checked style="margin:0;"> 全选美化
                                </label>
                            </div>
                            ${c.themes.map(tName => `
                                <label style="display:flex; align-items:center; gap:6px; font-size:11.5px; cursor:pointer; padding:3px 6px; background:rgba(255,255,255,0.02); border-radius:3px; user-select:none; white-space:nowrap;">
                                    <input type="checkbox" class="matrix-theme-chk matrix-theme-chk-${idx}" value="${escapeHtml(tName)}" checked style="margin:0;">
                                    <span style="word-break:break-all;">${escapeHtml(tName)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="tm-matrix-footer">
                <button id="matrix-cancel-btn" class="menu_button" style="margin:0; font-size:12px; padding:5px 12px; background:rgba(128,128,128,0.2) !important; white-space:nowrap;"><i class="fa-solid fa-xmark"></i> 取消退出</button>
                <button id="matrix-apply-all-btn" class="menu_button active" style="margin:0; font-size:12.5px; font-weight:bold; padding:5px 16px; background:var(--SmartThemeQuoteColor, #007bff) !important; color:#ffffff !important; white-space:nowrap;"><i class="fa-solid fa-circle-check"></i> 一键生成/应用已选分组(<span id="matrix-apply-count">${candidates.length}</span>)</button>
            </div>
        </div>
    `;

    const createTagAndSaveSilent = (cItem, tagName, themesList) => {
        if (!themesList || themesList.length === 0) return { success: false, isNew: false };
        let tags = loadThemeTags();

        let isNew = false;
        let tagObj = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase() && (parentId ? t.parentId === parentId : (!t.parentId || !tags.some(p => p.id === t.parentId))));
        if (!tagObj) {
            isNew = true;
            tagObj = {
                id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: tagName,
                parentId: parentId || null,
                themes: [],
                keywords: [tagName]
            };
            tags.push(tagObj);
        } else {
            if (parentId && !tagObj.parentId) tagObj.parentId = parentId;
            if (!tagObj.keywords) tagObj.keywords = [];
            if (!tagObj.keywords.includes(tagName)) tagObj.keywords.push(tagName);
        }

        if (!tagObj.themes) tagObj.themes = [];
        themesList.forEach(tn => {
            if (!tagObj.themes.includes(tn)) tagObj.themes.push(tn);
        });

        saveThemeTags(tags);
        return { success: true, isNew: isNew, tagId: tagObj.id };
    };

    await ctx.callGenericPopup(matrixHtml, 'confirm', null, {
        title: `自动分组全景矩阵 (${candidates.length} 个候选分组)`,
        okButton: null,
        cancelButton: null,
        wide: true,
        onOpen: (popup) => {
            const dlg = popup.dlg;
            if (dlg) {
                dlg.style.width = '85vw';
                dlg.style.height = '85vh';
                dlg.style.maxWidth = '980px';
                dlg.style.maxHeight = '85vh';
                dlg.style.display = 'flex';
                dlg.style.flexDirection = 'column';
            }

            const matrixList = dlg ? dlg.querySelector('#tm-matrix-list') : null;
            const selectAllChk = dlg ? dlg.querySelector('#matrix-select-all-chk') : null;
            const searchBox = dlg ? dlg.querySelector('#matrix-search-box') : null;
            const sortSelect = dlg ? dlg.querySelector('#matrix-sort-select') : null;
            const mergeBtn = dlg ? dlg.querySelector('#matrix-merge-btn') : null;
            const applyBtn = dlg ? dlg.querySelector('#matrix-apply-all-btn') : null;
            const cancelBtn = dlg ? dlg.querySelector('#matrix-cancel-btn') : null;
            const selectedCountSpan = dlg ? dlg.querySelector('#matrix-selected-count') : null;
            const applyCountSpan = dlg ? dlg.querySelector('#matrix-apply-count') : null;

            const updateStats = () => {
                if (!matrixList) return;
                const checkedGroupChks = matrixList.querySelectorAll('.matrix-group-chk:checked');
                const checkedCount = checkedGroupChks.length;
                if (selectedCountSpan) selectedCountSpan.textContent = checkedCount;
                if (applyCountSpan) applyCountSpan.textContent = checkedCount;
                if (applyBtn) applyBtn.disabled = (checkedCount === 0);
            };

            if (searchBox && matrixList) {
                searchBox.addEventListener('input', (e) => {
                    const q = e.target.value;
                    matrixList.querySelectorAll('.tm-matrix-card').forEach(card => {
                        const idx = card.dataset.idx;
                        const c = candidates[idx];
                        const nameVal = card.querySelector('.matrix-tag-name-input')?.value || '';
                        const themesVal = c ? c.themes.join(' ') : '';
                        const targetText = (nameVal + ' ' + themesVal).toLowerCase();
                        const match = isTextMatchingCompositeSearch(targetText, q);
                        card.style.display = match ? 'flex' : 'none';
                    });
                });
            }

            if (sortSelect && matrixList) {
                sortSelect.addEventListener('change', () => {
                    const mode = sortSelect.value;
                    const cards = Array.from(matrixList.querySelectorAll('.tm-matrix-card'));
                    cards.sort((a, b) => {
                        const ca = candidates[a.dataset.idx];
                        const cb = candidates[b.dataset.idx];
                        if (!ca || !cb) return 0;
                        if (mode === 'count-desc') return cb.themes.length - ca.themes.length;
                        if (mode === 'count-asc') return ca.themes.length - cb.themes.length;
                        if (mode === 'name-asc') return (ca.keyword || '').localeCompare(cb.keyword || '');
                        return parseInt(a.dataset.idx) - parseInt(b.dataset.idx);
                    });
                    cards.forEach(c => matrixList.appendChild(c));
                });
            }

            if (mergeBtn && matrixList) {
                mergeBtn.addEventListener('click', () => {
                    const checkedCards = Array.from(matrixList.querySelectorAll('.tm-matrix-card')).filter(card => {
                        const chk = card.querySelector('.matrix-group-chk');
                        return chk && chk.checked;
                    });
                    if (checkedCards.length < 2) {
                        toastr.warning('请先勾选 2 个或以上候选分组再进行合并。');
                        return;
                    }
                    const firstCard = checkedCards[0];
                    const firstNameInput = firstCard.querySelector('.matrix-tag-name-input');
                    const mergedName = firstNameInput ? firstNameInput.value.trim() : candidates[firstCard.dataset.idx]?.keyword || '合并标签';
                    const newName = prompt(`将 ${checkedCards.length} 个分组合并为一个标签，请输入标签名：`, mergedName);
                    if (!newName || !newName.trim()) return;

                    const mergedThemes = new Set();
                    checkedCards.forEach(card => {
                        const idx = card.dataset.idx;
                        const c = candidates[idx];
                        if (c) c.themes.forEach(t => mergedThemes.add(t));
                    });

                    if (firstNameInput) firstNameInput.value = newName.trim();
                    const firstIdx = firstCard.dataset.idx;
                    if (candidates[firstIdx]) {
                        candidates[firstIdx].themes = Array.from(mergedThemes);
                        const countSpan = firstCard.querySelector('.fa-layer-group')?.parentElement;
                        if (countSpan) countSpan.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right:3px;"></i>${mergedThemes.size}个美化`;
                    }

                    checkedCards.slice(1).forEach(card => card.remove());
                    updateStats();
                    toastr.success(`已将 ${checkedCards.length} 个候选分组合并为「${newName.trim()}」，涉及 ${mergedThemes.size} 个美化！`);
                });
            }

            if (selectAllChk && matrixList) {
                selectAllChk.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    matrixList.querySelectorAll('.matrix-group-chk').forEach(chk => {
                        chk.checked = isChecked;
                    });
                    updateStats();
                });
            }

            if (matrixList) {
                matrixList.querySelectorAll('.matrix-toggle-themes-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const idx = btn.dataset.idx;
                        const wrapper = matrixList.querySelector(`#matrix-themes-wrapper-${idx}`);
                        if (wrapper) {
                            const isExpanded = wrapper.classList.toggle('expanded');
                            btn.innerHTML = isExpanded
                                ? '<i class="fa-solid fa-chevron-up"></i> 收起'
                                : '<i class="fa-solid fa-chevron-down"></i> 明细';
                        }
                    });
                });

                matrixList.querySelectorAll('.matrix-sub-select-all').forEach(subChk => {
                    subChk.addEventListener('change', (e) => {
                        const idx = subChk.dataset.idx;
                        const isChecked = e.target.checked;
                        matrixList.querySelectorAll(`.matrix-theme-chk-${idx}`).forEach(chk => {
                            chk.checked = isChecked;
                        });
                    });
                });

                matrixList.querySelectorAll('.matrix-remove-card-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const idx = btn.dataset.idx;
                        const card = matrixList.querySelector(`.tm-matrix-card[data-idx="${idx}"]`);
                        if (card) {
                            card.remove();
                            updateStats();
                        }
                    });
                });

                matrixList.addEventListener('change', (e) => {
                    if (e.target.classList.contains('matrix-group-chk')) {
                        updateStats();
                    }
                });
            }

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    popup.dlg.querySelector('.popup-button-cancel')?.click();
                });
            }

            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    let createdCount = 0;
                    let totalAssignedThemes = 0;

                    if (matrixList) {
                        matrixList.querySelectorAll('.tm-matrix-card').forEach(card => {
                            const groupChk = card.querySelector('.matrix-group-chk');
                            if (groupChk && groupChk.checked) {
                                const idx = card.dataset.idx;
                                const cItem = candidates[idx];
                                const nameInput = card.querySelector('.matrix-tag-name-input');
                                const tagName = (nameInput ? nameInput.value.trim() : cItem.keyword) || cItem.keyword;
                                const checkedThemeChks = card.querySelectorAll(`.matrix-theme-chk-${idx}:checked`);
                                const themesList = Array.from(checkedThemeChks).map(cb => cb.value);

                                if (themesList.length > 0) {
                                    const saveRes = createTagAndSaveSilent(cItem, tagName, themesList);
                                    if (saveRes.success) {
                                        createdCount++;
                                        totalAssignedThemes += themesList.length;
                                    }
                                }
                            }
                        });
                    }

                    renderTagsUI();
                    updateActiveState();
                    softRefreshUI();
                    toastr.success(`🎉 批量审核完成！成功创建/合并共 ${createdCount} 个标签分类，挂载共 ${totalAssignedThemes} 个美化关联！`);
                    popup.dlg.querySelector('.popup-button-ok')?.click();
                });
            }
        }
    });
}

export async function runAutoGroupReviewStep(candidates, currentIndex, level, parentId, createdTagsCount, assignedThemesCount, historyStack = []) {
    if (currentIndex >= candidates.length) {
        renderTagsUI();
        updateActiveState();
        softRefreshUI();
        toastr.success(`🎉 分组向导已完成！共创建/更新共 ${createdTagsCount} 个标签分类。`);
        return;
    }

    const candidate = candidates[currentIndex];
    const targetLevelLabel = level === 'l2' ? '二级子标签' : '一级主标签';
    const MAX_INITIAL_THEMES = 25;
    const initialThemes = candidate.themes.slice(0, MAX_INITIAL_THEMES);
    const remainingThemes = candidate.themes.slice(MAX_INITIAL_THEMES);

    const wizardHtml = `
        <div class="tm-wizard-container" style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:8px;">
                <span style="font-weight:bold; font-size:14px; color:var(--SmartThemeQuoteColor, #4a90e2); display:inline-flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-list-check" style="color:#ffc107;"></i> 审核分组向导 (${currentIndex + 1} / ${candidates.length})
                </span>
                <span style="font-size:12px; padding:3px 10px; border-radius:12px; background:rgba(0,123,255,0.18); color:#4dabf7; font-weight:bold;">
                    <i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>${targetLevelLabel}
                </span>
            </div>
            <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:6px; margin-bottom:10px; flex:1; display:flex; flex-direction:column; min-height:0;">
                <div style="font-size:13px; font-weight:bold; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <label style="display:inline-flex; align-items:center; gap:6px; margin:0; cursor:pointer;">
                        <i class="fa-solid fa-tag" style="color:#ffc107;"></i>
                        <span>标签名称：</span>
                        <input type="text" id="wizard-tag-name-input" class="text_pole" value="${escapeHtml(candidate.keyword)}" style="display:inline-block; width:220px; height:28px; padding:2px 8px; font-size:13px; margin:0;">
                    </label>
                    <span style="font-size:12px; font-weight:normal; opacity:0.85;">
                        <i class="fa-solid fa-layer-group" style="margin-right:4px;"></i> 匹配 <b>${candidate.themes.length}</b> 个美化
                    </span>
                </div>
                <div style="font-size:12px; opacity:0.8; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                    <i class="fa-solid fa-tags"></i>
                    <span>勾选加入该标签的美化：</span>
                </div>
                <div id="wizard-themes-container" style="flex:1; max-height:calc(80vh - 180px); overflow-y:auto; background:rgba(0,0,0,0.15); padding:8px; border-radius:4px; display:flex; flex-direction:column; gap:4px;">
                    ${initialThemes.map(tName => `
                        <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px;">
                            <input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;">
                            <span>${escapeHtml(tName)}</span>
                        </label>
                    `).join('')}
                    ${remainingThemes.length > 0 ? `
                        <button id="wizard-load-more-btn" class="menu_button" style="margin:6px 0 0 0; font-size:11px; width:100%; justify-content:center; background:rgba(255,255,255,0.06);"><i class="fa-solid fa-chevron-down"></i> 展开余下 ${remainingThemes.length} 个美化...</button>
                    ` : ''}
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-top:6px;">
                <div style="display:flex; gap:6px;">
                    ${historyStack.length > 0 ? `
                        <button id="wizard-undo-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(255,193,7,0.2) !important; color:#ffc107 !important;" title="撤销上一步操作"><i class="fa-solid fa-rotate-left"></i> 上一步</button>
                    ` : ''}
                    <button id="wizard-stop-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(220,53,69,0.2) !important; color:#ff8888 !important;" title="结束向导并保存已建立的分组"><i class="fa-solid fa-circle-stop"></i> 结束向导</button>
                </div>
                <button id="wizard-pass-all-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(0,123,255,0.2) !important; color:#4dabf7 !important;" title="将剩余候选全自动通过"><i class="fa-solid fa-forward-fast"></i> 全部剩余通过</button>
            </div>
        </div>
    `;

    const popupRes = await ctx.callGenericPopup(wizardHtml, 'confirm', null, {
        title: `美化分组审核 (${currentIndex + 1}/${candidates.length})`,
        okButton: '✔ 通过并创建/合并',
        cancelButton: '✕ 不通过 / 跳过',
        wide: true,
        onOpen: (popup) => {
            const loadMoreBtn = popup.dlg.querySelector('#wizard-load-more-btn');
            if (loadMoreBtn) {
                loadMoreBtn.addEventListener('click', () => {
                    const container = popup.dlg.querySelector('#wizard-themes-container');
                    loadMoreBtn.remove();
                    remainingThemes.forEach(tName => {
                        const lbl = document.createElement('label');
                        lbl.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px;';
                        lbl.innerHTML = `<input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;"><span>${escapeHtml(tName)}</span>`;
                        container.appendChild(lbl);
                    });
                });
            }
        }
    });

    if (popupRes) {
        const tagNameInput = document.querySelector('#wizard-tag-name-input');
        const tagName = tagNameInput ? tagNameInput.value.trim() : candidate.keyword;
        const checkedChks = document.querySelectorAll('.wizard-theme-chk:checked');
        const selectedThemes = Array.from(checkedChks).map(cb => cb.value);

        if (tagName && selectedThemes.length > 0) {
            let tags = loadThemeTags();
            let tagObj = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase() && (parentId ? t.parentId === parentId : (!t.parentId || !tags.some(p => p.id === t.parentId))));
            if (!tagObj) {
                tagObj = {
                    id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    name: tagName,
                    parentId: parentId || null,
                    themes: [],
                    keywords: [tagName]
                };
                tags.push(tagObj);
            }
            if (!tagObj.themes) tagObj.themes = [];
            selectedThemes.forEach(th => {
                if (!tagObj.themes.includes(th)) tagObj.themes.push(th);
            });
            saveThemeTags(tags);
            createdTagsCount++;
            assignedThemesCount += selectedThemes.length;
        }
    }

    runAutoGroupReviewStep(candidates, currentIndex + 1, level, parentId, createdTagsCount, assignedThemesCount, historyStack);
}

export async function openAutoGroupWizard() {
    if (!state.allParsedThemes || state.allParsedThemes.length === 0) {
        toastr.info('当前没有可供提取标签的美化主题。');
        return;
    }

    const existingTags = loadThemeTags();

    function buildTagTreeOptionsHtml(allTags, parentTagId = null, depth = 0) {
        let optionsHtml = '';
        const children = allTags.filter(t => (parentTagId ? t.parentId === parentTagId : (!t.parentId || !allTags.some(p => p.id === t.parentId))));
        children.forEach(c => {
            const indent = '&nbsp;&nbsp;'.repeat(depth);
            const prefix = depth > 0 ? '└ ' : '';
            optionsHtml += `<option value="${c.id}">${indent}${prefix}${escapeHtml(c.name)} (${c.themes ? c.themes.length : 0})</option>`;
            optionsHtml += buildTagTreeOptionsHtml(allTags, c.id, depth + 1);
        });
        return optionsHtml;
    }

    let l1SelectOptionsHtml = buildTagTreeOptionsHtml(existingTags);
    if (!l1SelectOptionsHtml) {
        l1SelectOptionsHtml = '<option value="">(尚未创建主标签分类)</option>';
    }

    const setupHtml = `
        <div style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
            <h4 style="margin:0 0 10px 0; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-wand-magic-sparkles" style="color:#ffc107;"></i> 智能美化分组向导
            </h4>
            <div style="background:rgba(255,255,255,0.04); border-radius:6px; padding:16px; flex:1; display:flex; flex-direction:column; gap:16px; overflow-y:auto;">
                <div>
                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2);">
                        <i class="fa-solid fa-layer-group"></i> 1. 选择分析的美化基数范围：
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                            <input type="radio" name="tm-auto-scope" value="all" checked style="margin:0;">
                            <span>全部美化主题 (共 <b>${state.allParsedThemes.length}</b> 个)</span>
                        </label>
                    </div>
                </div>

                <div>
                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2);">
                        <i class="fa-solid fa-eye"></i> 2. 选择审核视图模式：
                    </div>
                    <div style="display:flex; gap:16px; padding-left:12px;">
                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                            <input type="radio" name="tm-auto-view" value="matrix" checked style="margin:0;">
                            <span>全景矩阵视图 (一键全览与批量操作)</span>
                        </label>
                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                            <input type="radio" name="tm-auto-view" value="review" style="margin:0;">
                            <span>逐个卡片审核 (逐项精细微调)</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (ctx && ctx.callGenericPopup) {
        const popupRes = await ctx.callGenericPopup(setupHtml, 'confirm', null, {
            title: '分组提取设置',
            okButton: '▶ 开始分析提取',
            cancelButton: '✕ 取消',
            wide: true
        });

        if (popupRes) {
            const candidates = extractCandidateThemeGroups(state.allParsedThemes);
            if (candidates.length > 0) {
                const viewMode = document.querySelector('input[name="tm-auto-view"]:checked')?.value || 'matrix';
                toastr.success(`成功分析出 ${candidates.length} 个候选分组！`);
                if (viewMode === 'matrix') {
                    openAutoGroupBatchMatrix(candidates, 'l1', null);
                } else {
                    runAutoGroupReviewStep(candidates, 0, 'l1', null, 0, 0, []);
                }
            } else {
                toastr.info('未分析出符合门槛的候选分组。');
            }
        }
    }
}
